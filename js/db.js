/**
 * db.js — Camada de persistência real usando IndexedDB.
 *
 * Estrutura:
 *  - store "projects": { id, name, createdAt, updatedAt }
 *  - store "nodes": { id, projectId, parentId, type('file'|'folder'), name, ext, lang, content, updatedAt }
 *  - store "settings": { key, value }  (key-value simples, key = string)
 *  - store "history": { id, nodeId, content, timestamp }  (últimas N versões por arquivo)
 *
 * Tudo aqui é assíncrono (Promises). Nenhuma parte do app deve usar
 * localStorage para dados de projeto — apenas IndexedDB.
 */

const DB_NAME = "code-ai-mobile";
const DB_VERSION = 2;
const MAX_HISTORY_PER_FILE = 20;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      if (!db.objectStoreNames.contains("projects")) {
        db.createObjectStore("projects", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("nodes")) {
        const nodes = db.createObjectStore("nodes", { keyPath: "id" });
        nodes.createIndex("byProject", "projectId");
        nodes.createIndex("byParent", "parentId");
      }
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("history")) {
        const hist = db.createObjectStore("history", { keyPath: "id" });
        hist.createIndex("byNode", "nodeId");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeNames, mode = "readonly") {
  return openDB().then((db) => db.transaction(storeNames, mode));
}

function promisifyRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function uid() {
  return (
    Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10)
  );
}

// ---------------- Projects ----------------

async function listProjects() {
  const t = await tx(["projects"]);
  const store = t.objectStore("projects");
  const all = await promisifyRequest(store.getAll());
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

async function createProject(name) {
  const project = { id: uid(), name, createdAt: Date.now(), updatedAt: Date.now() };
  const t = await tx(["projects"], "readwrite");
  t.objectStore("projects").put(project);
  await txDone(t);
  return project;
}

async function touchProject(projectId) {
  const t = await tx(["projects"], "readwrite");
  const store = t.objectStore("projects");
  const p = await promisifyRequest(store.get(projectId));
  if (p) {
    p.updatedAt = Date.now();
    store.put(p);
  }
  await txDone(t);
}

async function deleteProject(projectId) {
  const nodes = await listNodes(projectId);
  const nodeIds = new Set(nodes.map((n) => n.id));

  // Lê o histórico antes da transação de escrita para evitar deixar uma
  // transação IndexedDB inativa enquanto aguardamos várias requisições.
  const readTx = await tx(["history"]);
  const allHistory = await promisifyRequest(readTx.objectStore("history").getAll());
  const historyIds = allHistory.filter((item) => nodeIds.has(item.nodeId)).map((item) => item.id);

  const writeTx = await tx(["projects", "nodes", "history"], "readwrite");
  writeTx.objectStore("projects").delete(projectId);
  const nodeStore = writeTx.objectStore("nodes");
  const historyStore = writeTx.objectStore("history");
  for (const nodeId of nodeIds) nodeStore.delete(nodeId);
  for (const historyId of historyIds) historyStore.delete(historyId);
  await txDone(writeTx);
}

function txDone(t) {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

// ---------------- Nodes (files/folders) ----------------

async function listNodes(projectId) {
  const t = await tx(["nodes"]);
  const idx = t.objectStore("nodes").index("byProject");
  return promisifyRequest(idx.getAll(projectId));
}

async function getNode(nodeId) {
  const t = await tx(["nodes"]);
  return promisifyRequest(t.objectStore("nodes").get(nodeId));
}

async function createNode(node) {
  const full = {
    id: uid(),
    parentId: null,
    ext: "",
    lang: "Texto",
    content: "",
    updatedAt: Date.now(),
    ...node,
  };
  const t = await tx(["nodes"], "readwrite");
  t.objectStore("nodes").put(full);
  await txDone(t);
  await touchProject(full.projectId);
  return full;
}

async function updateNode(nodeId, patch) {
  const t = await tx(["nodes"], "readwrite");
  const store = t.objectStore("nodes");
  const node = await promisifyRequest(store.get(nodeId));
  if (!node) {
    await txDone(t);
    return null;
  }
  Object.assign(node, patch, { updatedAt: Date.now() });
  store.put(node);
  await txDone(t);
  await touchProject(node.projectId);
  return node;
}

async function deleteNode(nodeId) {
  const node = await getNode(nodeId);
  if (!node) return;
  if (node.type === "folder") {
    const t0 = await tx(["nodes"]);
    const idx = t0.objectStore("nodes").index("byParent");
    const children = await promisifyRequest(idx.getAll(nodeId));
    for (const c of children) await deleteNode(c.id);
  }
  const t = await tx(["nodes", "history"], "readwrite");
  t.objectStore("nodes").delete(nodeId);
  const histIdx = t.objectStore("history").index("byNode");
  const req = histIdx.getAllKeys(nodeId);
  req.onsuccess = () => {
    req.result.forEach((k) => t.objectStore("history").delete(k));
  };
  await txDone(t);
  await touchProject(node.projectId);
}

// ---------------- Settings ----------------

async function getSetting(key, fallback) {
  const t = await tx(["settings"]);
  const row = await promisifyRequest(t.objectStore("settings").get(key));
  return row ? row.value : fallback;
}

async function setSetting(key, value) {
  const t = await tx(["settings"], "readwrite");
  t.objectStore("settings").put({ key, value });
  await txDone(t);
}

// ---------------- History (undo/versões básicas) ----------------

async function pushHistory(nodeId, content) {
  const t = await tx(["history"], "readwrite");
  const store = t.objectStore("history");
  const idx = store.index("byNode");
  const existing = await promisifyRequest(idx.getAll(nodeId));
  const last = existing.sort((a, b) => b.timestamp - a.timestamp)[0];
  if (last && last.content === content) {
    await txDone(t);
    return;
  }
  store.put({ id: uid(), nodeId, content, timestamp: Date.now() });
  const keys = await promisifyRequest(idx.getAllKeys(nodeId));
  if (keys.length > MAX_HISTORY_PER_FILE) {
    // remove os mais antigos (getAllKeys preserva ordem de inserção por chave, então
    // buscamos os registros para ordenar por timestamp real)
    const all = await promisifyRequest(idx.getAll(nodeId));
    all.sort((a, b) => a.timestamp - b.timestamp);
    const excess = all.length - MAX_HISTORY_PER_FILE;
    for (let i = 0; i < excess; i++) store.delete(all[i].id);
  }
  await txDone(t);
}

async function listHistory(nodeId) {
  const t = await tx(["history"]);
  const idx = t.objectStore("history").index("byNode");
  const all = await promisifyRequest(idx.getAll(nodeId));
  return all.sort((a, b) => b.timestamp - a.timestamp);
}

export const DB = {
  listProjects,
  createProject,
  deleteProject,
  touchProject,
  listNodes,
  getNode,
  createNode,
  updateNode,
  deleteNode,
  getSetting,
  setSetting,
  pushHistory,
  listHistory,
  uid,
};
