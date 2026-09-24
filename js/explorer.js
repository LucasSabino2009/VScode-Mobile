/**
 * explorer.js — Árvore de arquivos/pastas real, com CRUD completo
 * apoiado em IndexedDB (via db.js). Suporta: criar arquivo, criar
 * pasta, renomear, excluir (com confirmação), abrir, estrutura
 * hierárquica, ícones por tipo e menu de contexto (toque longo /
 * botão direito).
 */
import { DB } from "./db.js";
import { ICONS, fileIconSvg } from "./icons.js";

const LANG_BY_EXT = { html: "HTML", htm: "HTML", css: "CSS", js: "JavaScript", mjs: "JavaScript", json: "JSON", md: "Markdown" };
const TEMPLATE_BY_EXT = {
  html: '<!DOCTYPE html>\n<html lang="pt-BR">\n<head>\n  <meta charset="UTF-8" />\n  <title>Nova página</title>\n</head>\n<body>\n  \n</body>\n</html>\n',
  css: "/* novo arquivo CSS */\n",
  js: "// novo arquivo JavaScript\n",
  json: "{\n  \n}\n",
};

const collapsed = new Set();

export function extOf(name) {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function buildTree(nodes) {
  const byParent = new Map();
  nodes.forEach((n) => {
    const key = n.parentId || "root";
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(n);
  });
  // Ordenação semelhante ao VS Code: pastas primeiro, depois arquivos,
  // com ordenação numérica (item2 antes de item10) e sem diferenciar maiúsculas.
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  byParent.forEach((list) =>
    list.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return collator.compare(a.name, b.name);
    })
  );
  return byParent;
}

export function pathFor(nodeId, nodesById) {
  const parts = [];
  let cur = nodesById.get(nodeId);
  while (cur) {
    parts.unshift(cur.name);
    cur = cur.parentId ? nodesById.get(cur.parentId) : null;
  }
  return parts.join("/");
}

export function renderExplorer(container, { nodes, activeNodeId, dirtySet, onOpen, onContextMenu }) {
  container.innerHTML = "";
  const byParent = buildTree(nodes);
  const nodesById = new Map(nodes.map((n) => [n.id, n]));

  function renderLevel(parentKey, depth, ancestry = new Set()) {
    const children = byParent.get(parentKey) || [];
    children.forEach((node) => {
      // Evita loops acidentais caso uma estrutura importada tenha uma
      // referência de pai inválida/cíclica.
      if (ancestry.has(node.id)) return;

      const row = document.createElement("div");
      row.className = `tree-row ${node.type}` + (node.id === activeNodeId ? " active" : "");
      row.style.setProperty("--tree-depth", depth);
      row.dataset.id = node.id;
      row.setAttribute("role", node.type === "folder" ? "treeitem" : "treeitem");
      row.setAttribute("aria-level", String(depth + 1));

      if (node.type === "folder") {
        const isCollapsed = collapsed.has(node.id);
        const hasChildren = (byParent.get(node.id) || []).length > 0;
        row.setAttribute("aria-expanded", String(!isCollapsed));
        row.innerHTML = `
          <span class="tree-chevron ${isCollapsed ? "collapsed" : ""} ${hasChildren ? "" : "empty"}">${ICONS.chevron}</span>
          <span class="tree-icon">${isCollapsed || !hasChildren ? ICONS.folder : ICONS.folderOpen}</span>
          <span class="tree-label" title="${escapeHtml(node.name)}">${escapeHtml(node.name)}</span>`;
        row.addEventListener("click", (ev) => {
          ev.stopPropagation();
          if (hasChildren) {
            if (collapsed.has(node.id)) collapsed.delete(node.id);
            else collapsed.add(node.id);
            renderExplorer(container, { nodes, activeNodeId, dirtySet, onOpen, onContextMenu });
          }
        });
      } else {
        const dirty = dirtySet && dirtySet.has(node.id);
        row.innerHTML = `<span class="tree-spacer"></span>${fileIconSvg(node.ext)}<span class="tree-label" title="${escapeHtml(node.name)}">${escapeHtml(node.name)}</span>${dirty ? '<span class="dirty-dot" title="Alterações não salvas"></span>' : ""}`;
        row.addEventListener("click", () => onOpen(node));
      }

      let pressTimer;
      row.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        onContextMenu(node, ev.clientX, ev.clientY);
      });
      row.addEventListener("touchstart", () => {
        pressTimer = setTimeout(() => {
          const t = row.getBoundingClientRect();
          onContextMenu(node, t.left + 20, t.top + 20);
        }, 500);
      }, { passive: true });
      row.addEventListener("touchend", () => clearTimeout(pressTimer));
      row.addEventListener("touchmove", () => clearTimeout(pressTimer));

      container.appendChild(row);

      if (node.type === "folder" && !collapsed.has(node.id)) {
        const nextAncestry = new Set(ancestry);
        nextAncestry.add(node.id);
        renderLevel(node.id, depth + 1, nextAncestry);
      }
    });
  }

  renderLevel("root", 0);

  if (nodes.length === 0) {
    const empty = document.createElement("div");
    empty.className = "tree-empty";
    empty.textContent = "Nenhum arquivo ainda. Toque em + para criar.";
    container.appendChild(empty);
  }
}

export async function createFileNode(projectId, parentId, rawName) {
  const name = rawName.trim();
  if (!name) throw new Error("Digite um nome de arquivo.");
  const siblings = await DB.listNodes(projectId);
  if (siblings.some((n) => n.parentId === (parentId || null) && n.name === name)) {
    throw new Error(`"${name}" já existe nesta pasta.`);
  }
  const ext = extOf(name);
  const lang = LANG_BY_EXT[ext] || "Texto";
  const content = TEMPLATE_BY_EXT[ext] || "";
  return DB.createNode({ projectId, parentId: parentId || null, type: "file", name, ext, lang, content });
}

export async function createFolderNode(projectId, parentId, rawName) {
  const name = rawName.trim().replace(/\/+$/, "");
  if (!name) throw new Error("Digite um nome de pasta.");
  const siblings = await DB.listNodes(projectId);
  if (siblings.some((n) => n.parentId === (parentId || null) && n.name === name && n.type === "folder")) {
    throw new Error(`A pasta "${name}" já existe aqui.`);
  }
  return DB.createNode({ projectId, parentId: parentId || null, type: "folder", name });
}

export async function renameNode(nodeId, newName) {
  const name = newName.trim();
  if (!name) throw new Error("Digite um nome válido.");
  const node = await DB.getNode(nodeId);
  if (!node) throw new Error("Item não encontrado.");
  const siblings = await DB.listNodes(node.projectId);
  if (siblings.some((n) => n.id !== nodeId && n.parentId === node.parentId && n.name === name)) {
    throw new Error(`"${name}" já existe nesta pasta.`);
  }
  const patch = { name };
  if (node.type === "file") {
    const ext = extOf(name);
    patch.ext = ext;
    patch.lang = LANG_BY_EXT[ext] || "Texto";
  }
  return DB.updateNode(nodeId, patch);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
