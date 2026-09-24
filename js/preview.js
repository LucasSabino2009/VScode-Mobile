/**
 * Preview engine with a real virtual filesystem for local web projects.
 *
 * Important: ES modules cannot reliably use relative imports when every file is
 * converted to a data: URL. This version creates Blob URLs for project files,
 * so `type="module" src="js/main.js"` keeps normal browser module semantics.
 */
import { pathFor } from "./explorer.js";

const CONSOLE_BRIDGE = `
<script>
(function () {
  function send(kind, args) {
    try {
      parent.postMessage({ __previewConsole: true, kind, args: args.map(function (a) {
        try { return typeof a === "object" ? JSON.stringify(a) : String(a); } catch (e) { return String(a); }
      }) }, "*");
    } catch (e) {}
  }
  ["log", "warn", "error", "info"].forEach(function (kind) {
    var orig = console[kind];
    console[kind] = function () {
      send(kind, Array.prototype.slice.call(arguments));
      orig.apply(console, arguments);
    };
  });
  window.addEventListener("error", function (ev) {
    send("error", [ev.message + " (linha " + ev.lineno + ", coluna " + ev.colno + ")"]);
  });
  window.addEventListener("unhandledrejection", function (ev) {
    send("error", ["Promise rejeitada: " + (ev.reason && ev.reason.message || ev.reason)]);
  });
})();
<\/script>
`;

function normalizePath(path) {
  const clean = decodeURIComponent(String(path || "").split(/[?#]/)[0]).replace(/\\/g, "/");
  const parts = [];
  for (const part of clean.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function resolveRelative(baseFilePath, target) {
  const base = normalizePath(baseFilePath).split("/");
  base.pop();
  for (const part of String(target || "").replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") base.pop();
    else base.push(part);
  }
  return normalizePath(base.join("/"));
}

function makeIndex(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const byPath = new Map();
  for (const n of nodes) {
    if (n.type !== "file") continue;
    const full = normalizePath(pathFor(n.id, byId));
    byPath.set(full, n);
    const parts = full.split("/");
    if (parts.length > 1) byPath.set(parts.slice(1).join("/"), n);
  }
  return { byId, byPath };
}

function resolveNode(index, target, baseFilePath = "") {
  if (!target) return null;
  const raw = String(target).trim().replace(/^\.\//, "");
  const candidates = [];
  if (baseFilePath) candidates.push(resolveRelative(baseFilePath, raw));
  candidates.push(normalizePath(raw));
  const expanded = [];
  for (const p of candidates) {
    expanded.push(p);
    if (!/\.[a-z0-9]+$/i.test(p)) {
      expanded.push(`${p}.js`, `${p}.mjs`, `${p}.css`, `${p}.json`, `${p}/index.js`);
    }
  }
  for (const p of expanded) {
    const node = index.byPath.get(normalizePath(p));
    if (node) return node;
  }
  return null;
}

function guessMime(ext) {
  return {
    css: "text/css", js: "text/javascript", mjs: "text/javascript", json: "application/json",
    svg: "image/svg+xml", html: "text/html", htm: "text/html", txt: "text/plain",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", ico: "image/x-icon",
    mp3: "audio/mpeg", wav: "audio/wav", mp4: "video/mp4", webm: "video/webm",
    woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf"
  }[String(ext || "").toLowerCase()] || "text/plain";
}

function isExternal(url) {
  return /^(?:https?:|data:|blob:|\/\/|#|mailto:|tel:|javascript:|about:)/i.test(String(url || "").trim());
}

function stripQuery(url) { return String(url || "").split(/[?#]/)[0]; }
function isBinaryExt(ext) { return /^(png|jpg|jpeg|gif|webp|avif|ico|mp3|wav|mp4|webm|woff|woff2|ttf|otf)$/i.test(String(ext || "")); }
function escapeAttr(value) { return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

function createResolver(nodes, referenced = new Set()) {
  const index = makeIndex(nodes);
  const blobUrls = new Set();
  const cache = new Map();
  const building = new Set();

  function mark(node) { if (node) referenced.add(node.id); }

  function rawContent(node) {
    return typeof node?.content === "string" ? node.content : "";
  }

  function localNode(url, basePath) {
    if (isExternal(url)) return null;
    const node = resolveNode(index, stripQuery(url), basePath);
    mark(node);
    return node;
  }

  async function assetUrl(node, fromPath = "") {
    if (!node) return "";
    if (node.content?.startsWith("data:")) return node.content;
    const key = `${node.id}|${fromPath}|asset`;
    if (cache.has(key)) return cache.get(key);
    // Keep non-binary local assets self-contained. This is especially important
    // inside the sandboxed srcdoc preview, where blob: resources can be treated
    // as cross-origin. Data URLs avoid that problem after all relative CSS URLs
    // have already been rewritten.
    const mime = guessMime(node.ext);
    const url = `data:${mime};charset=utf-8,${encodeURIComponent(rawContent(node))}`;
    cache.set(key, url);
    return url;
  }

  async function moduleUrl(node, fromPath = "") {
    if (!node) return "";
    const key = `${node.id}|module`;
    if (cache.has(key)) return cache.get(key);
    if (building.has(node.id)) return "";
    building.add(node.id);

    let code = rawContent(node);
    const nodePath = normalizePath(pathFor(node.id, index.byId));

    // Resolve static and dynamic local module imports to real Blob URLs.
    code = await rewriteJs(code, nodePath);

    const blob = new Blob([code], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    blobUrls.add(url);
    cache.set(key, url);
    building.delete(node.id);
    return url;
  }

  async function rewriteJs(js, basePath) {
    let out = js;
    const importRe = /(\b(?:import|export)\s+(?:[^;\n]*?\s+from\s+)?)(["'])(\.\.?\/[^"']+)\2/g;
    const matches = [...out.matchAll(importRe)];
    for (const m of matches.reverse()) {
      const node = localNode(m[3], basePath);
      if (!node) continue;
      const uri = await moduleUrl(node, basePath);
      if (!uri) continue;
      const replacement = `${m[1]}${m[2]}${uri}${m[2]}`;
      out = out.slice(0, m.index) + replacement + out.slice(m.index + m[0].length);
    }
    const dyn = [...out.matchAll(/(\bimport\s*\(\s*)(["'])(\.\.?\/[^"']+)\2(\s*\))/g)];
    for (const m of dyn.reverse()) {
      const node = localNode(m[3], basePath);
      if (!node) continue;
      const uri = await moduleUrl(node, basePath);
      if (!uri) continue;
      const replacement = `${m[1]}${m[2]}${uri}${m[2]}${m[4]}`;
      out = out.slice(0, m.index) + replacement + out.slice(m.index + m[0].length);
    }
    return out;
  }

  async function rewriteCss(css, basePath) {
    let out = css;
    const imports = [...out.matchAll(/@import\s+(?:url\(\s*)?(["']?)([^"'\)\s]+)\1\s*\)?/gi)];
    for (const m of imports.reverse()) {
      const node = localNode(m[2], basePath);
      if (!node) continue;
      const uri = node.ext === "css" ? await styleUrl(node, basePath) : await assetUrl(node, basePath);
      out = out.slice(0, m.index) + m[0].replace(m[2], uri) + out.slice(m.index + m[0].length);
    }
    const urls = [...out.matchAll(/url\(\s*(["']?)([^"'\)]+?)\1\s*\)/gi)];
    for (const m of urls.reverse()) {
      const target = m[2].trim();
      if (isExternal(target)) continue;
      const node = localNode(target, basePath);
      if (!node) continue;
      const uri = node.ext === "css" ? await styleUrl(node, basePath) : await assetUrl(node, basePath);
      out = out.slice(0, m.index) + `url(${m[1]}${uri}${m[1]})` + out.slice(m.index + m[0].length);
    }
    return out;
  }

  async function styleUrl(node, fromPath = "") {
    const key = `${node.id}|style`;
    if (cache.has(key)) return cache.get(key);
    if (building.has(node.id)) return "";
    building.add(node.id);
    const css = await rewriteCss(rawContent(node), normalizePath(pathFor(node.id, index.byId)));
    // Use a data URL for CSS. The preview runs in a sandboxed srcdoc iframe;
    // in that context a blob: stylesheet may be treated as a cross-origin
    // resource and be blocked. Local asset references inside the CSS are already
    // rewritten by rewriteCss, so the stylesheet itself needs no blob URL.
    const url = `data:text/css;charset=utf-8,${encodeURIComponent(css)}`;
    cache.set(key, url);
    building.delete(node.id);
    return url;
  }

  async function rewriteHtml(html, basePath) {
    let out = html;
    // The async replacements are done below with a scanner, because String.replace
    // does not await promises.
    const linkRe = /<link\b([^>]*?)href\s*=\s*(["'])([^"']+)\2([^>]*)>/gi;
    const links = [...out.matchAll(linkRe)];
    for (const m of links.reverse()) {
      const url = m[3];
      if (isExternal(url)) continue;
      const rel = `${m[1]} ${m[4]}`.match(/\brel\s*=\s*["']([^"']+)["']/i);
      const node = localNode(url, basePath);
      if (!node || !rel || !/\bstylesheet\b/i.test(rel[1])) continue;
      const css = await rewriteCss(rawContent(node), normalizePath(pathFor(node.id, index.byId)));
      // Inline project CSS in the preview document instead of relying on a
      // cross-origin blob: stylesheet. This behaves like a normal <style> tag
      // and is reliable inside the sandboxed mobile preview.
      const replacement = `<style data-preview-css="${escapeAttr(pathFor(node.id, index.byId))}">\n${css}\n</style>`;
      out = out.slice(0, m.index) + replacement + out.slice(m.index + m[0].length);
    }

    const scriptRe = /<script\b([^>]*?)\bsrc\s*=\s*(["'])([^"']+)\2([^>]*)>\s*<\/script>/gi;
    const scripts = [...out.matchAll(scriptRe)];
    for (const m of scripts.reverse()) {
      const url = m[3];
      if (isExternal(url)) continue;
      const node = localNode(url, basePath);
      if (!node) continue;
      const srcUrl = (node.ext === "js" || node.ext === "mjs") ? await moduleUrl(node, basePath) : await assetUrl(node, basePath);
      const attrs = `${m[1]} ${m[4]}`.replace(/\bsrc\s*=\s*(["']).*?\1/gi, "").trim();
      const typeModule = /\btype\s*=\s*["']module["']/i.test(attrs) || node.ext === "mjs";
      const cleanAttrs = attrs.replace(/\btype\s*=\s*(["'])module\1/gi, "").trim();
      const finalAttrs = `${typeModule ? 'type="module"' : ""}${cleanAttrs ? " " + cleanAttrs : ""}`.trim();
      out = out.slice(0, m.index) + `<script ${finalAttrs} src="${srcUrl}"></script>` + out.slice(m.index + m[0].length);
    }

    const inlineModuleRe = /<script\b([^>]*\btype\s*=\s*(["'])module\2[^>]*)>([\s\S]*?)<\/script>/gi;
    const inlineModules = [...out.matchAll(inlineModuleRe)];
    for (const m of inlineModules.reverse()) {
      const code = await rewriteJs(m[3], basePath);
      const replacement = `<script${m[1]}>\n${code}\n<\/script>`;
      out = out.slice(0, m.index) + replacement + out.slice(m.index + m[0].length);
    }

    const styleTagRe = /<style\b([^>]*)>([\s\S]*?)<\/style>/gi;
    const styleTags = [...out.matchAll(styleTagRe)];
    for (const m of styleTags.reverse()) {
      const css = await rewriteCss(m[2], basePath);
      const replacement = `<style${m[1]}>\n${css}\n</style>`;
      out = out.slice(0, m.index) + replacement + out.slice(m.index + m[0].length);
    }

    const attrRe = /\b(src|href)=(['"])(.*?)\2/gi;
    const attrs = [...out.matchAll(attrRe)];
    for (const m of attrs.reverse()) {
      const url = m[3];
      if (isExternal(url) || url.startsWith("#")) continue;
      const node = localNode(url, basePath);
      if (!node) continue;
      const uri = await assetUrl(node, basePath);
      out = out.slice(0, m.index) + `${m[1]}=${m[2]}${uri}${m[2]}` + out.slice(m.index + m[0].length);
    }
    return out;
  }

  return { index, rewriteHtml, blobUrls };
}

export async function buildPreviewDoc(nodes, entryPath = "index.html") {
  const { byId, byPath } = makeIndex(nodes);
  let entry = byPath.get(normalizePath(entryPath));
  if (!entry) {
    const candidates = nodes.filter((n) => n.type === "file" && /^index\.html?$/i.test(n.name))
      .sort((a, b) => pathFor(a.id, byId).split("/").length - pathFor(b.id, byId).split("/").length);
    entry = candidates[0];
  }
  if (!entry) return { doc: `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:24px;color:#ccc;background:#1e1e1e"><h3>Sem index.html</h3><p>Não encontrei um arquivo index.html no projeto.</p></body></html>`, blobUrls: [] };

  const referenced = new Set([entry.id]);
  const resolver = createResolver(nodes, referenced);
  const entryPathReal = normalizePath(pathFor(entry.id, byId));
  let doc = await resolver.rewriteHtml(entry.content || "", entryPathReal);

  const headInjection = `${CONSOLE_BRIDGE}`;
  doc = /<head[^>]*>/i.test(doc) ? doc.replace(/<head([^>]*)>/i, `<head$1>\n${headInjection}`) : `${headInjection}${doc}`;
  return { doc, blobUrls: [...resolver.blobUrls] };
}

export function releasePreviewUrls(urls = []) {
  for (const url of urls) {
    try { URL.revokeObjectURL(url); } catch (_) {}
  }
}
