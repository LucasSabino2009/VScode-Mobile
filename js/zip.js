/**
 * zip.js — Exportação/importação real de projetos em .zip.
 *
 * Depende da biblioteca JSZip, carregada globalmente via <script> no
 * index.html (https://cdnjs.cloudflare.com — permitido pela política
 * deste ambiente). Se `window.JSZip` não existir, as funções abaixo
 * lançam erro explicando o problema (nunca fingem que funcionou).
 */
import { DB } from "./db.js";
import { pathFor } from "./explorer.js";

function requireJSZip() {
  if (typeof window.JSZip === "undefined") {
    throw new Error("JSZip não carregou (verifique sua conexão). Exportar/Importar ZIP não está disponível agora.");
  }
  return window.JSZip;
}

export async function exportProjectZip(projectId, projectName) {
  const JSZip = requireJSZip();
  const nodes = await DB.listNodes(projectId);
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const zip = new JSZip();
  nodes
    .filter((n) => n.type === "file")
    .forEach((n) => {
      const path = pathFor(n.id, nodesById);
      zip.file(path, n.content || "");
    });
  // pastas vazias também entram, para preservar a estrutura
  nodes
    .filter((n) => n.type === "folder")
    .forEach((n) => {
      const path = pathFor(n.id, nodesById);
      zip.folder(path);
    });
  const blob = await zip.generateAsync({ type: "blob" });
  return { blob, filename: `${sanitizeFilename(projectName)}.zip` };
}

export async function exportSingleFile(node) {
  return { blob: new Blob([node.content || ""], { type: "text/plain" }), filename: node.name };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Tenta usar a File System Access API (showSaveFilePicker) quando
 * disponível — dá ao usuário um seletor real de local/nome ("Salvar
 * como..." de verdade). Hoje isso só existe em navegadores baseados em
 * Chromium (principalmente desktop; suporte em Android é parcial e
 * ainda não existe em iOS Safari). Quando não disponível, cai para
 * download comum, que é o único mecanismo universal em navegador.
 */
export async function saveAsWithPicker(blob, suggestedName, mimeType) {
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: "Arquivo", accept: { [mimeType || "text/plain"]: ["." + (suggestedName.split(".").pop() || "txt")] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { method: "picker" };
    } catch (err) {
      if (err && err.name === "AbortError") return { method: "cancelled" };
      // cai para download se o picker falhar por outro motivo
    }
  }
  downloadBlob(blob, suggestedName);
  return { method: "download" };
}

export async function importProjectFromZip(file, projectName) {
  const JSZip = requireJSZip();
  const zip = await JSZip.loadAsync(file);
  const project = await DB.createProject(projectName || file.name.replace(/\.zip$/i, ""));
  const folderIds = new Map(); // "a/b" -> nodeId

  async function ensureFolder(path) {
    if (!path) return null;
    if (folderIds.has(path)) return folderIds.get(path);
    const parts = path.split("/");
    let parentId = null;
    let acc = "";
    for (const part of parts) {
      acc = acc ? acc + "/" + part : part;
      if (folderIds.has(acc)) {
        parentId = folderIds.get(acc);
        continue;
      }
      const node = await DB.createNode({ projectId: project.id, parentId, type: "folder", name: part });
      folderIds.set(acc, node.id);
      parentId = node.id;
    }
    return parentId;
  }

  const entries = Object.values(zip.files);
  for (const entry of entries) {
    const cleanPath = entry.name.replace(/\/$/, "");
    if (entry.dir) {
      await ensureFolder(cleanPath);
      continue;
    }
    const lastSlash = cleanPath.lastIndexOf("/");
    const dir = lastSlash >= 0 ? cleanPath.slice(0, lastSlash) : "";
    const name = lastSlash >= 0 ? cleanPath.slice(lastSlash + 1) : cleanPath;
    const parentId = await ensureFolder(dir);
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
    const binaryExt = /^(png|jpg|jpeg|gif|webp|avif|ico|mp3|wav|mp4|webm|woff|woff2|ttf|otf)$/i.test(ext);
    // Mantém arquivos binários utilizáveis no preview. Texto continua sendo
    // salvo normalmente para permanecer editável no CodeMirror.
    const content = binaryExt
      ? `data:${mimeForExtension(ext)};base64,${await entry.async("base64")}`
      : await entry.async("string");
    const lang = { html: "HTML", htm: "HTML", css: "CSS", js: "JavaScript", mjs: "JavaScript", json: "JSON" }[ext] || "Texto";
    await DB.createNode({ projectId: project.id, parentId, type: "file", name, ext, lang, content });
  }

  return project;
}

function mimeForExtension(ext) {
  return {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    webp: "image/webp", avif: "image/avif", ico: "image/x-icon",
    mp3: "audio/mpeg", wav: "audio/wav", mp4: "video/mp4", webm: "video/webm",
    woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  }[ext] || "application/octet-stream";
}

function sanitizeFilename(name) {
  return (name || "projeto").replace(/[\\/:*?"<>|]/g, "-").trim() || "projeto";
}
