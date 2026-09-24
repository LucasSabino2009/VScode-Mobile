/**
 * lint.js — diagnóstico leve e real para JavaScript, HTML e CSS.
 *
 * O objetivo aqui é produzir diagnósticos úteis sem fingir ser ESLint/HTML
 * validator completo. Erros de sintaxe JS são reais (Acorn); HTML/CSS usam
 * analisadores conservadores para evitar falsos positivos comuns.
 */
import * as acorn from "https://esm.sh/acorn@8";
import { simple as walkSimple, ancestor as walkAncestor } from "https://esm.sh/acorn-walk@8";

const JS_GLOBALS = new Set([
  "window", "document", "console", "Math", "JSON", "Array", "Object", "String",
  "Number", "Boolean", "Date", "RegExp", "Error", "TypeError", "RangeError",
  "Promise", "Map", "Set", "WeakMap", "WeakSet", "Symbol", "Proxy", "Reflect",
  "fetch", "setTimeout", "setInterval", "clearTimeout", "clearInterval",
  "localStorage", "sessionStorage", "indexedDB", "navigator", "location", "history",
  "undefined", "NaN", "Infinity", "globalThis", "self", "alert", "confirm", "prompt",
  "requestAnimationFrame", "cancelAnimationFrame", "CustomEvent", "Event", "EventTarget",
  "URL", "URLSearchParams", "Blob", "FormData", "Headers", "Request", "Response",
  "structuredClone", "queueMicrotask", "performance", "crypto", "XMLHttpRequest",
  "WebSocket", "Worker", "FileReader", "arguments", "this", "super", "module", "exports",
  "require", "process", "__dirname", "console", "Intl", "BigInt", "URLPattern",
]);

function offsetToLineCol(text, offset) {
  const safe = Math.max(0, Math.min(Number.isFinite(offset) ? offset : 0, text.length));
  const before = text.slice(0, safe);
  return { line: before.split("\n").length, col: safe - before.lastIndexOf("\n") };
}

function problem(severity, code, from, to, message) {
  const { line, col } = offsetToLineCol(code, from);
  return { severity, line, col, message, from, to: Math.max(from + 1, to) };
}

function dedupe(problems) {
  const seen = new Set();
  return problems.filter((p) => {
    const key = `${p.severity}|${p.from}|${p.to}|${p.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectPatternNames(node, set) {
  if (!node) return;
  switch (node.type) {
    case "Identifier": set.add(node.name); break;
    case "ObjectPattern": node.properties.forEach((p) => collectPatternNames(p.value || p.argument, set)); break;
    case "ArrayPattern": node.elements.forEach((e) => collectPatternNames(e, set)); break;
    case "AssignmentPattern": collectPatternNames(node.left, set); break;
    case "RestElement": collectPatternNames(node.argument, set); break;
  }
}

function parseProgram(code) {
  const attempts = [
    { sourceType: "module" },
    { sourceType: "script" },
  ];
  let lastError = null;
  for (const opts of attempts) {
    try {
      return acorn.parse(code, {
        ecmaVersion: "latest",
        sourceType: opts.sourceType,
        allowReturnOutsideFunction: true,
        allowAwaitOutsideFunction: true,
        locations: true,
      });
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

function declaredNamesFromAst(ast) {
  const declared = new Set();
  walkSimple(ast, {
    VariableDeclarator(node) { collectPatternNames(node.id, declared); },
    FunctionDeclaration(node) {
      if (node.id) declared.add(node.id.name);
      node.params.forEach((p) => collectPatternNames(p, declared));
    },
    FunctionExpression(node) {
      if (node.id) declared.add(node.id.name);
      node.params.forEach((p) => collectPatternNames(p, declared));
    },
    ArrowFunctionExpression(node) { node.params.forEach((p) => collectPatternNames(p, declared)); },
    ClassDeclaration(node) { if (node.id) declared.add(node.id.name); },
    CatchClause(node) { collectPatternNames(node.param, declared); },
    ImportDefaultSpecifier(node) { declared.add(node.local.name); },
    ImportSpecifier(node) { declared.add(node.local.name); },
    ImportNamespaceSpecifier(node) { declared.add(node.local.name); },
  });
  return declared;
}

function isReferenceIdentifier(node, ancestors) {
  const parent = ancestors[ancestors.length - 2];
  if (!parent) return true;
  if (parent.type === "MemberExpression" && parent.property === node && !parent.computed) return false;
  if (parent.type === "Property" && parent.key === node && !parent.computed && !parent.shorthand) return false;
  if ((parent.type === "MethodDefinition" || parent.type === "PropertyDefinition") && parent.key === node && !parent.computed) return false;
  if ((parent.type === "LabeledStatement" || parent.type === "BreakStatement" || parent.type === "ContinueStatement") && parent.label === node) return false;
  if (parent.type === "ImportDeclaration" || parent.type === "ImportSpecifier" || parent.type === "ImportDefaultSpecifier" || parent.type === "ImportNamespaceSpecifier") return false;
  if (parent.type === "VariableDeclarator" && parent.id === node) return false;
  if (["FunctionDeclaration", "FunctionExpression", "ClassDeclaration", "ClassExpression"].includes(parent.type) && parent.id === node) return false;
  return true;
}

function contextDeclaredNames(contextCode) {
  if (!contextCode) return new Set();
  try { return declaredNamesFromAst(parseProgram(contextCode)); } catch { return new Set(); }
}

export function lintJS(code, options = {}) {
  const problems = [];
  try {
    parseProgram(code);
  } catch (err) {
    const offset = typeof err?.pos === "number" ? err.pos : code.length;
    problems.push(problem("error", code, offset, Math.min(offset + 1, code.length), String(err.message || "Erro de sintaxe").replace(/\s*\(\d+:\d+\)$/, "")));
  }
  // Importante: não tentamos adivinhar variáveis globais/definidas em outros
  // arquivos. Isso causava falsos positivos em projetos reais (Three.js,
  // módulos, APIs próprias, bundlers etc.). O diagnóstico JS fica restrito
  // a erros de sintaxe reais.
  return dedupe(problems);
}

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const OPTIONAL_END_TAGS = new Set(["li", "dt", "dd", "p", "rt", "rp", "optgroup", "option", "colgroup", "thead", "tbody", "tfoot", "tr", "th", "td"]);
const AUTO_CLOSE_ON_OPEN = {
  li: new Set(["li"]),
  dt: new Set(["dt", "dd"]),
  dd: new Set(["dt", "dd"]),
  p: new Set(["address", "article", "aside", "blockquote", "div", "dl", "fieldset", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "main", "nav", "ol", "p", "pre", "section", "table", "ul"]),
  option: new Set(["option", "optgroup"]),
  optgroup: new Set(["optgroup"]),
  tr: new Set(["tr"]),
  th: new Set(["th", "td"]),
  td: new Set(["th", "td"]),
  thead: new Set(["tbody", "tfoot"]),
  tbody: new Set(["tbody", "tfoot"]),
};

function maskHtmlNonMarkup(code) {
  return code.replace(/<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, (m) => m.replace(/[^\n]/g, " "));
}

export function lintHTML(code, options = {}) {
  const problems = [];
  const masked = maskHtmlNonMarkup(code);
  const stack = [];
  const tagRe = /<(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)(?:\s+[^<>]*?)?\s*(\/?)>/g;
  let m;

  while ((m = tagRe.exec(masked))) {
    const [full, closing, rawName, selfClose] = m;
    const tag = rawName.toLowerCase();
    const from = m.index;
    if (closing) {
      if (VOID_TAGS.has(tag) || OPTIONAL_END_TAGS.has(tag)) continue;
      const top = stack[stack.length - 1];
      if (!top) {
        problems.push(problem("error", code, from, from + full.length, `Tag de fechamento </${tag}> sem abertura correspondente.`));
      } else if (top.tag === tag) {
        stack.pop();
      } else {
        const idx = [...stack].reverse().findIndex((x) => x.tag === tag);
        if (idx < 0) {
          problems.push(problem("error", code, from, from + full.length, `Tag de fechamento </${tag}> inesperada; esperava </${top.tag}>.`));
        } else {
          // Só sinaliza a estrutura realmente quebrada; não transforma tags
          // opcionais do HTML em erros.
          for (let i = 0; i <= idx; i++) {
            const unclosed = stack.pop();
            if (unclosed.tag !== tag && !OPTIONAL_END_TAGS.has(unclosed.tag)) {
              problems.push(problem("error", code, unclosed.from, unclosed.from + unclosed.raw.length, `Tag <${unclosed.tag}> não foi fechada.`));
            }
          }
        }
      }
      continue;
    }
    const auto = AUTO_CLOSE_ON_OPEN[stack[stack.length - 1]?.tag];
    if (auto?.has(tag)) stack.pop();
    if (!selfClose && !VOID_TAGS.has(tag)) stack.push({ tag, from, raw: full });
  }

  stack.forEach((item) => {
    if (!OPTIONAL_END_TAGS.has(item.tag)) {
      problems.push(problem("error", code, item.from, item.from + item.raw.length, `Tag <${item.tag}> não foi fechada.`));
    }
  });

  // Referências locais só são verificadas quando o chamador fornece o caminho
  // do arquivo atual. Isso evita falsos positivos quando o projeto veio de um
  // ZIP com uma pasta-raiz (ex.: projeto/css/style.css).
  const knownPaths = new Set(options.knownPaths || []);
  const currentPath = String(options.currentPath || "");
  if (knownPaths.size) {
    const refRe = /\b(?:src|href)\s*=\s*(["'])(.*?)\1/gi;
    let rm;
    while ((rm = refRe.exec(code))) {
      const url = rm[2].trim();
      if (!url || /^(?:https?:|data:|\/\/|#|mailto:|tel:|javascript:)/i.test(url)) continue;
      const clean = normalizeRelativePath(currentPath, url);
      const direct = normalizeProjectPath(url);
      if (!knownPaths.has(clean) && !knownPaths.has(direct)) {
        problems.push(problem("warning", code, rm.index, rm.index + rm[0].length, `Arquivo referenciado não encontrado: "${url}".`));
      }
    }
  }
  return dedupe(problems);
}

function normalizeProjectPath(path) {
  return String(path || "").split("/").filter(Boolean).join("/");
}

function normalizeRelativePath(currentPath, target) {
  const base = normalizeProjectPath(currentPath).split("/");
  base.pop();
  for (const part of String(target || "").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") base.pop();
    else base.push(part);
  }
  return base.join("/");
}

const KNOWN_CSS_PROPS = new Set([
  "align-content","align-items","align-self","animation","animation-delay","animation-direction","animation-duration","animation-fill-mode","animation-iteration-count","animation-name","animation-play-state","animation-timing-function","appearance","aspect-ratio","backdrop-filter","background","background-attachment","background-clip","background-color","background-image","background-origin","background-position","background-repeat","background-size","border","border-bottom","border-bottom-color","border-bottom-left-radius","border-bottom-right-radius","border-bottom-style","border-bottom-width","border-collapse","border-color","border-image","border-left","border-left-color","border-left-style","border-left-width","border-radius","border-right","border-right-color","border-right-style","border-right-width","border-spacing","border-style","border-top","border-top-color","border-top-left-radius","border-top-right-radius","border-top-style","border-top-width","border-width","bottom","box-shadow","box-sizing","clear","clip-path","color","column-count","column-gap","column-rule","column-width","columns","content","counter-increment","counter-reset","cursor","direction","display","empty-cells","filter","flex","flex-basis","flex-direction","flex-flow","flex-grow","flex-shrink","flex-wrap","float","font","font-display","font-family","font-feature-settings","font-size","font-size-adjust","font-stretch","font-style","font-variant","font-weight","gap","grid","grid-area","grid-auto-columns","grid-auto-flow","grid-auto-rows","grid-column","grid-column-end","grid-column-gap","grid-column-start","grid-gap","grid-row","grid-row-end","grid-row-gap","grid-row-start","grid-template","grid-template-areas","grid-template-columns","grid-template-rows","height","inset","isolation","justify-content","justify-items","justify-self","left","letter-spacing","line-height","list-style","list-style-image","list-style-position","list-style-type","margin","margin-bottom","margin-left","margin-right","margin-top","max-height","max-width","min-height","min-width","object-fit","object-position","opacity","order","outline","outline-color","outline-offset","outline-style","outline-width","overflow","overflow-wrap","overflow-x","overflow-y","padding","padding-bottom","padding-left","padding-right","padding-top","perspective","perspective-origin","pointer-events","place-content","place-items","place-self","position","quotes","resize","right","scroll-behavior","scrollbar-width","tab-size","table-layout","text-align","text-align-last","text-decoration","text-decoration-color","text-decoration-line","text-decoration-style","text-indent","text-overflow","text-shadow","text-transform","top","transform","transform-origin","transform-style","transition","transition-delay","transition-duration","transition-property","transition-timing-function","user-select","vertical-align","visibility","white-space","width","will-change","word-break","word-spacing","word-wrap","writing-mode","z-index"
]);

function maskCssStringsAndComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g, (m) => m.replace(/[^\n]/g, " "));
}

export function lintCSS(code) {
  const problems = [];
  const masked = maskCssStringsAndComments(code);
  let depth = 0;
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === "{") depth++;
    else if (masked[i] === "}") {
      depth--;
      if (depth < 0) {
        problems.push(problem("error", code, i, i + 1, '"}" sem "{" correspondente.'));
        depth = 0;
      }
    }
  }
  if (depth > 0) problems.push(problem("error", code, Math.max(0, code.length - 1), code.length, `${depth} bloco(s) "{" não foram fechados.`));

  const blockRe = /\{([^{}]*)\}/g;
  let bm;
  while ((bm = blockRe.exec(masked))) {
    const body = bm[1];
    const bodyStart = bm.index + 1;
    const declRe = /([a-zA-Z-][\w-]*)\s*:\s*([^;{}]*)(;|$)/g;
    let dm;
    while ((dm = declRe.exec(body))) {
      const prop = dm[1].toLowerCase();
      const value = dm[2].trim();
      const hasSemicolon = dm[3] === ";";
      const offset = bodyStart + dm.index;
      if (prop.startsWith("--")) continue;
      if (!value) problems.push(problem("error", code, offset, Math.min(code.length, offset + dm[0].length), `Valor vazio para a propriedade "${prop}".`));
    }
  }
  return dedupe(problems);
}

export function lintByExt(ext, code, options = {}) {
  switch ((ext || "").toLowerCase()) {
    case "js":
    case "mjs": return lintJS(code, options);
    case "html":
    case "htm": return lintHTML(code, options);
    case "css": return lintCSS(code, options);
    default: return [];
  }
}
