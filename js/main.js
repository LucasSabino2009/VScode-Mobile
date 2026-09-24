import { DB } from "./db.js";
import { createEditor } from "./editor.js";
import { lintByExt } from "./lint.js";
import { ICONS } from "./icons.js";
import { renderExplorer, createFileNode, createFolderNode, renameNode } from "./explorer.js";
import { buildPreviewDoc, releasePreviewUrls } from "./preview.js";
import { exportProjectZip, exportSingleFile, saveAsWithPicker, importProjectFromZip } from "./zip.js";
import { askAI, buildActionPrompt, extractCodeBlock } from "./ai.js";
import { runCommand } from "./terminal.js";
import { loadSettings, saveSettings } from "./settings.js";
import { isOneDriveConfigured, connectOneDrive } from "./onedrive.js";

// ---------------------------------------------------------------
// 0. Ícones: substitui os elementos data-icon="x" pelo SVG real
// ---------------------------------------------------------------
function paintIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((elm) => {
    const key = elm.getAttribute("data-icon");
    if (ICONS[key]) elm.innerHTML = ICONS[key];
  });
}

// ---------------------------------------------------------------
// 1. Estado global em memória (espelha o que está no IndexedDB)
// ---------------------------------------------------------------
const state = {
  settings: null,
  project: null,
  nodes: [],
  openTabs: [], // array de nodeId
  activeNodeId: null,
  dirty: new Set(), // nodeIds com alterações não salvas no editor
  problemsByNode: new Map(),
  saveTimer: null,
  contextTargetId: null,
  previewBlobUrls: [],
};

const el = {};
function q(id) {
  return document.getElementById(id);
}

// ---------------------------------------------------------------
// 2. Toast
// ---------------------------------------------------------------
let toastTimer;
function showToast(text) {
  clearTimeout(toastTimer);
  el.toast.textContent = text;
  el.toast.classList.add("show");
  toastTimer = setTimeout(() => el.toast.classList.remove("show"), 2200);
}

// ---------------------------------------------------------------
// 3. Modal genérico de confirmação
// ---------------------------------------------------------------
function confirmDialog(title, message) {
  return new Promise((resolve) => {
    el.confirmTitle.textContent = title;
    el.confirmMessage.textContent = message;
    el.confirmModal.classList.add("open");
    el.confirmModal.setAttribute("aria-hidden", "false");
    el.modalScrim.classList.add("show");
    const cleanup = (result) => {
      el.confirmModal.classList.remove("open");
      el.confirmModal.setAttribute("aria-hidden", "true");
      el.modalScrim.classList.remove("show");
      el.confirmOk.removeEventListener("click", onOk);
      el.confirmCancel.removeEventListener("click", onCancel);
      resolve(result);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    el.confirmOk.addEventListener("click", onOk);
    el.confirmCancel.addEventListener("click", onCancel);
  });
}

// ---------------------------------------------------------------
// 4. Editor
// ---------------------------------------------------------------
let editor = null;

function initEditorOnce() {
  editor = createEditor({
    parent: q("cm-host"),
    onChange: (content) => onEditorChange(content),
    onCursor: ({ line, col }) => {
      q("status-pos").textContent = `Ln ${line}, Col ${col}`;
    },
  });
}

function onEditorChange(content) {
  const nodeId = state.activeNodeId;
  if (!nodeId) return;
  const node = state.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  node.content = content;
  state.dirty.add(nodeId);
  updateSaveIndicator();
  renderTabsUI();
  scheduleAutosave();
  scheduleLint(node);
}

let lintTimer;
function scheduleLint(node) {
  clearTimeout(lintTimer);
  lintTimer = setTimeout(() => runLint(node), 350);
}

function runLint(node) {
  const projectContext = state.nodes
    .filter((n) => n.type === "file" && n.id !== node.id && ["js", "mjs"].includes(n.ext))
    .map((n) => n.content || "")
    .join("\n");
  const knownPaths = state.nodes.filter((n) => n.type === "file").map((n) => {
    const byId = new Map(state.nodes.map((item) => [item.id, item]));
    const parts = [];
    let cur = n;
    while (cur) { parts.unshift(cur.name); cur = cur.parentId ? byId.get(cur.parentId) : null; }
    return parts.join("/");
  });
  const byId = new Map(state.nodes.map((item) => [item.id, item]));
  const currentPath = (() => {
    const parts = []; let cur = node;
    while (cur) { parts.unshift(cur.name); cur = cur.parentId ? byId.get(cur.parentId) : null; }
    return parts.join("/");
  })();
  const problems = lintByExt(node.ext, node.content || "", { knownPaths, currentPath });
  state.problemsByNode.set(node.id, problems);
  if (node.id === state.activeNodeId) {
    editor.setDiagnostics(
      problems.map((p) => ({
        from: p.from,
        to: Math.max(p.to, p.from + 1),
        severity: p.severity === "error" ? "error" : "warning",
        message: p.message,
      }))
    );
  }
  renderProblemsPanel();
}

// ---------------------------------------------------------------
// 5. Autosave (debounced) + indicador + histórico básico
// ---------------------------------------------------------------
function scheduleAutosave() {
  if (!state.settings.autosave) return;
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveActiveFile, state.settings.autosaveIntervalMs);
}

async function saveActiveFile() {
  const nodeId = state.activeNodeId;
  if (!nodeId || !state.dirty.has(nodeId)) return;
  const node = state.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  await DB.updateNode(nodeId, { content: node.content });
  await DB.pushHistory(nodeId, node.content);
  state.dirty.delete(nodeId);
  updateSaveIndicator();
  renderTabsUI();
  renderExplorerUI();
}

async function saveAllDirty() {
  for (const nodeId of Array.from(state.dirty)) {
    const node = state.nodes.find((n) => n.id === nodeId);
    if (node) {
      await DB.updateNode(nodeId, { content: node.content });
      await DB.pushHistory(nodeId, node.content);
    }
  }
  state.dirty.clear();
  updateSaveIndicator();
  renderTabsUI();
  renderExplorerUI();
}

function updateSaveIndicator() {
  el.saveIndicator.textContent = state.dirty.size > 0 ? `${state.dirty.size} não salvo(s)` : "Salvo";
  el.saveIndicator.classList.toggle("dirty", state.dirty.size > 0);
}

window.addEventListener("beforeunload", (ev) => {
  if (state.dirty.size > 0) {
    ev.preventDefault();
    ev.returnValue = "";
  }
});

// ---------------------------------------------------------------
// 6. Abas
// ---------------------------------------------------------------
function renderTabsUI() {
  const nodesById = new Map(state.nodes.map((n) => [n.id, n]));
  el.tabbar.innerHTML = "";
  state.openTabs.forEach((nodeId) => {
    const node = nodesById.get(nodeId);
    if (!node) return;
    const tab = document.createElement("div");
    tab.className = "tab" + (nodeId === state.activeNodeId ? " active" : "");
    const label = document.createElement("span");
    label.textContent = node.name + (state.dirty.has(nodeId) ? " ●" : "");
    label.addEventListener("click", () => openNode(nodeId));
    const close = document.createElement("span");
    close.className = "tab-close";
    close.innerHTML = ICONS.close;
    close.addEventListener("click", (ev) => {
      ev.stopPropagation();
      closeTab(nodeId);
    });
    tab.appendChild(label);
    tab.appendChild(close);
    el.tabbar.appendChild(tab);
  });
}

async function closeTab(nodeId) {
  if (state.dirty.has(nodeId)) {
    const ok = await confirmDialog("Fechar sem salvar?", "Este arquivo tem alterações não salvas. Fechar mesmo assim?");
    if (!ok) return;
    const fresh = await DB.getNode(nodeId);
    if (fresh) {
      const idx = state.nodes.findIndex((n) => n.id === nodeId);
      if (idx >= 0) state.nodes[idx] = fresh;
    }
    state.dirty.delete(nodeId);
  }
  state.openTabs = state.openTabs.filter((t) => t !== nodeId);
  if (state.activeNodeId === nodeId) {
    const next = state.openTabs[state.openTabs.length - 1];
    if (next) openNode(next);
    else {
      state.activeNodeId = null;
      editor.setDoc("", "");
      q("status-lang").textContent = "";
    }
  }
  renderTabsUI();
  persistOpenTabs();
}

function persistOpenTabs() {
  DB.setSetting("open-tabs:" + state.project.id, { openTabs: state.openTabs, activeNodeId: state.activeNodeId });
}

// ---------------------------------------------------------------
// 7. Abrir arquivo no editor
// ---------------------------------------------------------------
async function openNode(nodeId) {
  await saveActiveFile();
  const node = state.nodes.find((n) => n.id === nodeId);
  if (!node || node.type !== "file") return;
  if (!state.openTabs.includes(nodeId)) state.openTabs.push(nodeId);
  state.activeNodeId = nodeId;
  editor.setDoc(node.content || "", node.ext);
  q("status-lang").textContent = node.lang || "Texto";
  runLint(node);
  renderTabsUI();
  renderExplorerUI();
  // Mantém o Explorer aberto. Isso reproduz melhor o fluxo do VS Code:
  // abrir um arquivo não reorganiza nem esconde a árvore do projeto.
  persistOpenTabs();
}

// ---------------------------------------------------------------
// 8. Explorer
// ---------------------------------------------------------------
function renderExplorerUI() {
  // O Explorer deve continuar parecendo uma árvore de projeto mesmo no celular.
  // A seleção ativa é preservada ao trocar de arquivo.
  renderExplorer(q("sidebar-tree"), {
    nodes: state.nodes,
    activeNodeId: state.activeNodeId,
    dirtySet: state.dirty,
    onOpen: (node) => openNode(node.id),
    onContextMenu: (node, x, y) => openContextMenu(node, x, y),
  });
}

function openContextMenu(node, x, y) {
  state.contextTargetId = node.id;
  const menu = el.contextMenu;
  const isFolder = node.type === "folder";
  menu.innerHTML = `
    ${isFolder ? `<button data-act="new-file">${ICONS.plusFile}Novo arquivo aqui</button>` : ""}
    ${isFolder ? `<button data-act="new-folder">${ICONS.plusFolder}Nova pasta aqui</button>` : ""}
    <button data-act="rename">${ICONS.rename}Renomear</button>
    ${!isFolder ? `<button data-act="download">${ICONS.download}Baixar arquivo</button>` : ""}
    <button data-act="delete" class="danger">${ICONS.trash}Excluir</button>
  `;
  menu.style.left = Math.min(x, window.innerWidth - 220) + "px";
  menu.style.top = Math.min(y, window.innerHeight - 220) + "px";
  menu.classList.add("open");
  menu.setAttribute("aria-hidden", "false");
}

function closeContextMenu() {
  el.contextMenu.classList.remove("open");
  el.contextMenu.setAttribute("aria-hidden", "true");
}

async function handleContextAction(action) {
  const nodeId = state.contextTargetId;
  const node = state.nodes.find((n) => n.id === nodeId);
  closeContextMenu();
  if (!node) return;

  if (action === "new-file") return openNewItemModal("file", nodeId);
  if (action === "new-folder") return openNewItemModal("folder", nodeId);

  if (action === "rename") {
    const name = prompt("Novo nome:", node.name);
    if (!name || name === node.name) return;
    try {
      await renameNode(nodeId, name);
      await reloadNodes();
      showToast("Renomeado");
    } catch (e) {
      showToast(e.message);
    }
    return;
  }

  if (action === "download") {
    const { blob, filename } = await exportSingleFile(node);
    await saveAsWithPicker(blob, filename, "text/plain");
    showToast(`"${filename}" baixado`);
    return;
  }

  if (action === "delete") {
    const label = node.type === "folder" ? "esta pasta e todo o conteúdo dela" : `"${node.name}"`;
    const ok = await confirmDialog("Excluir?", `Tem certeza que deseja excluir ${label}? Essa ação não pode ser desfeita.`);
    if (!ok) return;
    await DB.deleteNode(nodeId);
    state.openTabs = state.openTabs.filter((t) => t !== nodeId);
    if (state.activeNodeId === nodeId) state.activeNodeId = null;
    await reloadNodes();
    if (!state.activeNodeId) {
      const firstFile = state.nodes.find((n) => n.type === "file");
      if (firstFile) openNode(firstFile.id);
      else editor.setDoc("", "");
    }
    renderTabsUI();
    showToast("Excluído");
  }
}

document.addEventListener("click", (ev) => {
  if (!el.contextMenu.contains(ev.target)) closeContextMenu();
});

// ---------------------------------------------------------------
// 9. Novo arquivo / pasta (modal)
// ---------------------------------------------------------------
let newItemKind = "file";
let newItemParentId = null;

function openNewItemModal(kind, parentId = null) {
  newItemKind = kind;
  newItemParentId = parentId;
  el.modalTitle.textContent = kind === "file" ? "Novo arquivo" : "Nova pasta";
  el.modalInput.placeholder = kind === "file" ? "nome.html" : "nome-da-pasta";
  el.modalHint.textContent =
    kind === "file" ? "Use a extensão para definir o tipo: .html, .css, .js, .json." : "A pasta é criada dentro da pasta selecionada (ou na raiz).";
  el.modalInput.value = "";
  el.modal.classList.add("open");
  el.modal.setAttribute("aria-hidden", "false");
  el.modalScrim.classList.add("show");
  setTimeout(() => el.modalInput.focus(), 50);
}
function closeNewItemModal() {
  el.modal.classList.remove("open");
  el.modal.setAttribute("aria-hidden", "true");
  el.modalScrim.classList.remove("show");
}

async function confirmNewItem() {
  const name = el.modalInput.value.trim();
  if (!name) return showToast("Digite um nome");
  try {
    if (newItemKind === "file") {
      const node = await createFileNode(state.project.id, newItemParentId, name);
      await reloadNodes();
      openNode(node.id);
      showToast(`"${name}" criado`);
    } else {
      await createFolderNode(state.project.id, newItemParentId, name);
      await reloadNodes();
      showToast(`Pasta "${name}" criada`);
    }
    closeNewItemModal();
  } catch (e) {
    showToast(e.message);
  }
}

// ---------------------------------------------------------------
// 10. Painel de Problemas
// ---------------------------------------------------------------
function renderProblemsPanel() {
  const container = q("bp-problems");
  const nodesById = new Map(state.nodes.map((n) => [n.id, n]));
  const rows = [];
  let total = 0;
  state.problemsByNode.forEach((problems, nodeId) => {
    const node = nodesById.get(nodeId);
    if (!node || !problems.length) return;
    total += problems.length;
    problems.forEach((p) => {
      rows.push({ node, p });
    });
  });
  q("status-problems").textContent = `${total} problema${total === 1 ? "" : "s"}`;

  if (!rows.length) {
    container.innerHTML = '<div class="problems-empty">Nenhum problema encontrado</div>';
    return;
  }
  container.innerHTML = "";
  rows.forEach(({ node, p }) => {
    const row = document.createElement("div");
    row.className = "problem-row";
    row.innerHTML = `<span class="problem-icon ${p.severity}">${p.severity === "error" ? ICONS.error : ICONS.warning}</span><span class="problem-text"><strong>${escapeHtml(node.name)}</strong> — Linha ${p.line}, Coluna ${p.col}<br/>${escapeHtml(p.message)}</span>`;
    row.addEventListener("click", async () => {
      if (node.id !== state.activeNodeId) await openNode(node.id);
      editor.gotoLineCol(p.line, p.col);
      openBottomPanel(); // mantém aberto, útil em telas grandes; some no toque em mobile via CSS
    });
    container.appendChild(row);
  });
}

// ---------------------------------------------------------------
// 11. Painéis (sidebar / ai / preview / settings / bottom)
// ---------------------------------------------------------------
function openSidebar() {
  el.sidebar.classList.add("open");
  el.sidebarScrim.classList.add("show");
  el.sidebar.setAttribute("aria-hidden", "false");
}
function closeSidebar() {
  el.sidebar.classList.remove("open");
  el.sidebarScrim.classList.remove("show");
  el.sidebar.setAttribute("aria-hidden", "true");
}
function openAiPanel() {
  el.aiPanel.classList.add("open");
  el.aiScrim.classList.add("show");
  el.aiPanel.setAttribute("aria-hidden", "false");
}
function closeAiPanel() {
  el.aiPanel.classList.remove("open");
  el.aiScrim.classList.remove("show");
  el.aiPanel.setAttribute("aria-hidden", "true");
}
function openSettingsPanel() {
  renderSettingsBody();
  el.settingsPanel.classList.add("open");
  el.settingsScrim.classList.add("show");
  el.settingsPanel.setAttribute("aria-hidden", "false");
}
function closeSettingsPanel() {
  el.settingsPanel.classList.remove("open");
  el.settingsScrim.classList.remove("show");
  el.settingsPanel.setAttribute("aria-hidden", "true");
}
function openBottomPanel(tab = "problems") {
  el.bottomPanel.classList.add("open");
  el.bottomPanel.setAttribute("aria-hidden", "false");
  switchBottomTab(tab);
}
function closeBottomPanel() {
  el.bottomPanel.classList.remove("open");
  el.bottomPanel.setAttribute("aria-hidden", "true");
}
function switchBottomTab(tab) {
  document.querySelectorAll(".bp-tab").forEach((b) => b.classList.toggle("active", b.dataset.panel === tab));
  document.querySelectorAll(".bp-view").forEach((v) => v.classList.toggle("active", v.id === "bp-" + tab));
}

// ---------------------------------------------------------------
// 12. Preview
// ---------------------------------------------------------------
async function openPreview() {
  releasePreviewUrls(state.previewBlobUrls);
  state.previewBlobUrls = [];
  const result = await buildPreviewDoc(state.nodes, "index.html");
  state.previewBlobUrls = result.blobUrls || [];
  el.previewFrame.srcdoc = result.doc;
  el.previewPanel.classList.add("open");
  el.previewPanel.setAttribute("aria-hidden", "false");
}
function closePreview() {
  el.previewPanel.classList.remove("open");
  el.previewPanel.setAttribute("aria-hidden", "true");
  releasePreviewUrls(state.previewBlobUrls);
  state.previewBlobUrls = [];
}
async function refreshPreview() {
  releasePreviewUrls(state.previewBlobUrls);
  state.previewBlobUrls = [];
  const result = await buildPreviewDoc(state.nodes, "index.html");
  state.previewBlobUrls = result.blobUrls || [];
  el.previewFrame.srcdoc = result.doc;
  showToast("Preview atualizado");
}
window.addEventListener("message", (ev) => {
  if (!ev.data || !ev.data.__previewConsole) return;
  const line = document.createElement("div");
  line.className = "console-line console-" + ev.data.kind;
  line.textContent = `[${ev.data.kind}] ${ev.data.args.join(" ")}`;
  q("bp-console").appendChild(line);
  q("bp-console").scrollTop = q("bp-console").scrollHeight;
});

// ---------------------------------------------------------------
// 13. Terminal
// ---------------------------------------------------------------
function initTerminal() {
  const output = q("terminal-output");
  const input = q("terminal-input");
  const printLine = (text, cls = "") => {
    const line = document.createElement("div");
    line.className = "terminal-line " + cls;
    line.textContent = text;
    output.appendChild(line);
    output.scrollTop = output.scrollHeight;
  };
  printLine("Terminal simulado — não há um SO real conectado. Digite \"help\".", "terminal-hint");
  input.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    const cmd = input.value;
    input.value = "";
    printLine("$ " + cmd, "terminal-cmd");
    const result = runCommand(cmd, {
      nodes: state.nodes,
      onOpenPreview: openPreview,
      onClear: () => { output.innerHTML = ""; },
    });
    if (result) result.split("\n").forEach((l) => printLine(l));
  });
}

// ---------------------------------------------------------------
// 14. IA
// ---------------------------------------------------------------
function addAiMessage(text, from, { withApply, codeToApply } = {}) {
  const msg = document.createElement("div");
  msg.className = "ai-message " + (from === "user" ? "ai-message-user" : "ai-message-bot");
  msg.textContent = text;
  if (withApply && codeToApply) {
    const btn = document.createElement("button");
    btn.className = "ai-apply-btn";
    btn.textContent = "Aplicar ao arquivo atual";
    btn.addEventListener("click", async () => {
      const ok = await confirmDialog("Aplicar alteração?", "Isso vai substituir o conteúdo do arquivo aberto pelo código sugerido pela IA.");
      if (!ok) return;
      editor.view.dispatch({ changes: { from: 0, to: editor.view.state.doc.length, insert: codeToApply } });
      showToast("Alteração aplicada");
    });
    msg.appendChild(document.createElement("br"));
    msg.appendChild(btn);
  }
  el.aiMessages.appendChild(msg);
  el.aiMessages.scrollTop = el.aiMessages.scrollHeight;
}

function currentAiContext(userMessage) {
  const node = state.nodes.find((n) => n.id === state.activeNodeId);
  const selection = editor ? editor.getSelectionText() : "";
  const problems = state.problemsByNode.get(state.activeNodeId) || [];
  return {
    fileName: node ? node.name : "(nenhum arquivo aberto)",
    lang: node ? node.ext : "",
    code: selection || (node ? node.content : ""),
    selection: Boolean(selection),
    userMessage,
    problemsText: problems.map((p) => `${p.severity === "error" ? "Erro" : "Aviso"} linha ${p.line}: ${p.message}`).join("\n"),
  };
}

async function runAiAction(action) {
  const node = state.nodes.find((n) => n.id === state.activeNodeId);
  if (!node) return showToast("Abra um arquivo primeiro");
  const ctx = currentAiContext(action);
  addAiMessage(`Ação "${action}" para ${node.name}`, "user");
  await sendToAi(buildActionPrompt(action, ctx), ctx);
}

async function sendToAi(prompt, ctx) {
  const thinking = document.createElement("div");
  thinking.className = "ai-message ai-message-bot ai-thinking";
  thinking.textContent = "Pensando...";
  el.aiMessages.appendChild(thinking);
  el.aiMessages.scrollTop = el.aiMessages.scrollHeight;
  try {
    const answer = await askAI({
      provider: state.settings.aiProvider,
      apiKey: state.settings.aiApiKey,
      model: state.settings.aiModel,
      baseUrl: state.settings.aiBaseUrl,
      userMessage: prompt,
      context: ctx,
    });
    thinking.remove();
    const code = extractCodeBlock(answer);
    addAiMessage(answer, "bot", { withApply: Boolean(code), codeToApply: code });
  } catch (e) {
    thinking.remove();
    addAiMessage("Erro: " + e.message, "bot");
  }
}

// ---------------------------------------------------------------
// 15. Configurações (renderização dinâmica)
// ---------------------------------------------------------------
function renderSettingsBody() {
  const s = state.settings;
  const body = q("settings-body");
  body.innerHTML = `
    <div class="settings-group">
      <h4>Aparência</h4>
      <label class="settings-row"><span>Tema</span>
        <select id="set-theme"><option value="dark">Escuro</option><option value="light">Claro</option></select>
      </label>
      <label class="settings-row"><span>Tamanho da fonte</span><input type="number" id="set-fontsize" min="10" max="28" /></label>
      <label class="settings-row"><span>Altura da linha</span><input type="number" step="0.1" min="1" max="2.5" id="set-lineheight" /></label>
      <label class="settings-row"><span>Quebra de linha (word wrap)</span><input type="checkbox" id="set-wordwrap" /></label>
    </div>
    <div class="settings-group">
      <h4>Editor</h4>
      <label class="settings-row"><span>Autocomplete</span><input type="checkbox" id="set-autocomplete" /></label>
    </div>
    <div class="settings-group">
      <h4>Salvamento</h4>
      <label class="settings-row"><span>Salvamento automático</span><input type="checkbox" id="set-autosave" /></label>
      <label class="settings-row"><span>Intervalo (ms)</span><input type="number" min="300" step="100" id="set-autosave-interval" /></label>
    </div>
    <div class="settings-group">
      <h4>Armazenamento local</h4>
      <p class="hint-text">Todos os projetos e arquivos ficam salvos no IndexedDB deste navegador/dispositivo. Nada é enviado para nenhum servidor a menos que você conecte o OneDrive ou configure a IA.</p>
    </div>
    <div class="settings-group">
      <h4><span data-icon="cloud"></span> OneDrive</h4>
      <p class="hint-text">${
        isOneDriveConfigured()
          ? "Configurado. Toque em Conectar para autenticar com sua conta Microsoft (fluxo oficial, sem senha passando pelo app)."
          : "Ainda não configurado neste build: falta registrar um app na Microsoft Entra ID e informar o Client ID em js/onedrive.js. A integração (MSAL + Microsoft Graph) já está implementada e pronta para ativar — veja os comentários do arquivo para o passo a passo."
      }</p>
      <button class="modal-btn primary" id="set-onedrive-connect" ${isOneDriveConfigured() ? "" : "disabled"}>Conectar conta Microsoft</button>
    </div>
    <div class="settings-group">
      <h4>Assistente de IA</h4>
      <p class="hint-text">Sua chave de API fica salva apenas neste dispositivo (IndexedDB) e as chamadas saem direto do navegador para o provedor escolhido. Nunca compartilhe uma chave num dispositivo público.</p>
      <label class="settings-row"><span>Provedor</span>
        <select id="set-ai-provider"><option value="anthropic">Anthropic (Claude)</option><option value="openai-compatible">OpenAI / compatível</option></select>
      </label>
      <label class="settings-row"><span>Chave de API</span><input type="password" id="set-ai-key" placeholder="sk-..." /></label>
      <label class="settings-row"><span>Modelo (opcional)</span><input type="text" id="set-ai-model" placeholder="ex: claude-sonnet-4-5" /></label>
      <label class="settings-row" id="row-ai-baseurl"><span>Base URL (para "compatível")</span><input type="text" id="set-ai-baseurl" placeholder="https://api.openai.com" /></label>
    </div>
    <div class="settings-group">
      <h4>Privacidade</h4>
      <p class="hint-text">Este app não envia telemetria. Os únicos dados que saem do dispositivo são: (1) chamadas à API de IA, se configurada, com o código que você mandar para a IA; (2) chamadas ao Microsoft Graph, se o OneDrive estiver conectado.</p>
    </div>
  `;
  paintIcons(body);
  q("set-theme").value = s.theme;
  q("set-fontsize").value = s.fontSize;
  q("set-lineheight").value = s.lineHeight;
  q("set-wordwrap").checked = s.wordWrap;
  q("set-autocomplete").checked = s.autocomplete;
  q("set-autosave").checked = s.autosave;
  q("set-autosave-interval").value = s.autosaveIntervalMs;
  q("set-ai-provider").value = s.aiProvider;
  q("set-ai-key").value = s.aiApiKey;
  q("set-ai-model").value = s.aiModel;
  q("set-ai-baseurl").value = s.aiBaseUrl;

  const persist = async (patch) => {
    Object.assign(state.settings, patch);
    await saveSettings(state.settings);
    applySettingsToEditor();
  };
  q("set-theme").addEventListener("change", (e) => persist({ theme: e.target.value }));
  q("set-fontsize").addEventListener("change", (e) => persist({ fontSize: Number(e.target.value) }));
  q("set-lineheight").addEventListener("change", (e) => persist({ lineHeight: Number(e.target.value) }));
  q("set-wordwrap").addEventListener("change", (e) => persist({ wordWrap: e.target.checked }));
  q("set-autocomplete").addEventListener("change", (e) => persist({ autocomplete: e.target.checked }));
  q("set-autosave").addEventListener("change", (e) => persist({ autosave: e.target.checked }));
  q("set-autosave-interval").addEventListener("change", (e) => persist({ autosaveIntervalMs: Number(e.target.value) || 1500 }));
  q("set-ai-provider").addEventListener("change", (e) => persist({ aiProvider: e.target.value }));
  q("set-ai-key").addEventListener("change", (e) => persist({ aiApiKey: e.target.value }));
  q("set-ai-model").addEventListener("change", (e) => persist({ aiModel: e.target.value }));
  q("set-ai-baseurl").addEventListener("change", (e) => persist({ aiBaseUrl: e.target.value }));
  q("set-onedrive-connect").addEventListener("click", async () => {
    try {
      const account = await connectOneDrive();
      q("onedrive-status").textContent = `Conectado como ${account.username}`;
      showToast("OneDrive conectado");
    } catch (e) {
      showToast("Falha ao conectar: " + e.message);
    }
  });
}

function applySettingsToEditor() {
  if (!editor) return;
  editor.setTheme(state.settings.theme === "dark");
  editor.setFontSize(state.settings.fontSize, state.settings.lineHeight);
  editor.setAutocomplete(state.settings.autocomplete);
  editor.setWordWrap(state.settings.wordWrap);
  document.body.classList.toggle("theme-light", state.settings.theme === "light");
  document.documentElement.style.setProperty("--editor-line-height", state.settings.lineHeight);
}

// ---------------------------------------------------------------
// 16. Projetos
// ---------------------------------------------------------------
async function reloadNodes() {
  state.nodes = await DB.listNodes(state.project.id);
  renderExplorerUI();
  state.problemsByNode.clear();
  state.nodes.filter((n) => n.type === "file").forEach((n) => runLint(n));
}

async function refreshProjectSelect() {
  const projects = await DB.listProjects();
  const sel = q("project-select");
  sel.innerHTML = projects.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  sel.value = state.project.id;
}

async function switchProject(projectId) {
  await saveAllDirty();
  const projects = await DB.listProjects();
  state.project = projects.find((p) => p.id === projectId);
  q("project-name").textContent = state.project.name;
  const tabsMeta = await DB.getSetting("open-tabs:" + state.project.id, {});
  state.openTabs = tabsMeta.openTabs || [];
  state.activeNodeId = null;
  await reloadNodes();
  const first = tabsMeta.activeNodeId && state.nodes.find((n) => n.id === tabsMeta.activeNodeId) ? tabsMeta.activeNodeId : (state.nodes.find((n) => n.type === "file") || {}).id;
  if (first) await openNode(first);
  await DB.setSetting("last-project-id", state.project.id);
}

async function seedInitialProject() {
  const project = await DB.createProject("MeuProjeto");
  const assets = await DB.createNode({ projectId: project.id, parentId: null, type: "folder", name: "assets" });
  await DB.createNode({ projectId: project.id, parentId: null, type: "folder", name: "css" });
  await DB.createNode({ projectId: project.id, parentId: null, type: "folder", name: "js" });
  const cssFolder = (await DB.listNodes(project.id)).find((n) => n.name === "css");
  const jsFolder = (await DB.listNodes(project.id)).find((n) => n.name === "js");
  await DB.createNode({
    projectId: project.id, parentId: null, type: "file", name: "index.html", ext: "html", lang: "HTML",
    content: '<!DOCTYPE html>\n<html lang="pt-BR">\n  <head>\n    <meta charset="UTF-8" />\n    <title>Meu Projeto</title>\n    <link rel="stylesheet" href="css/style.css" />\n  </head>\n  <body>\n    <h1>Olá, Codivex!</h1>\n    <script src="js/app.js"><\/script>\n  </body>\n</html>\n',
  });
  await DB.createNode({
    projectId: project.id, parentId: cssFolder.id, type: "file", name: "style.css", ext: "css", lang: "CSS",
    content: "body {\n  font-family: sans-serif;\n  background: #111;\n  color: #eee;\n}\n",
  });
  await DB.createNode({
    projectId: project.id, parentId: jsFolder.id, type: "file", name: "app.js", ext: "js", lang: "JavaScript",
    content: "console.log('Olá do app.js');\n",
  });
  return project;
}

// ---------------------------------------------------------------
// 17. Export / Import ZIP + Salvar como
// ---------------------------------------------------------------
async function handleExportZip() {
  await saveAllDirty();
  try {
    const { blob, filename } = await exportProjectZip(state.project.id, state.project.name);
    await saveAsWithPicker(blob, filename, "application/zip");
    showToast(`"${filename}" exportado`);
  } catch (e) {
    showToast(e.message);
  }
}

async function handleImportZip(file) {
  try {
    const name = prompt("Nome do novo projeto:", file.name.replace(/\.zip$/i, ""));
    if (!name) return;
    const project = await importProjectFromZip(file, name);
    await refreshProjectSelect();
    await switchProject(project.id);
    showToast(`Projeto "${name}" importado`);
  } catch (e) {
    showToast(e.message);
  }
}

// ---------------------------------------------------------------
// 18. Bootstrap
// ---------------------------------------------------------------
async function init() {
  Object.assign(el, {
    toast: q("toast"), sidebar: q("sidebar"), sidebarScrim: q("sidebar-scrim"),
    aiPanel: q("ai-panel"), aiScrim: q("ai-scrim"), aiMessages: q("ai-messages"), aiForm: q("ai-form"), aiInput: q("ai-input"),
    previewPanel: q("preview-panel"), previewFrame: q("preview-frame"),
    settingsPanel: q("settings-panel"), settingsScrim: q("settings-scrim"),
    modal: q("new-item-modal"), modalScrim: q("modal-scrim"), modalTitle: q("modal-title"), modalInput: q("modal-input"), modalHint: q("modal-hint"),
    confirmModal: q("confirm-modal"), confirmTitle: q("confirm-title"), confirmMessage: q("confirm-message"), confirmOk: q("confirm-ok"), confirmCancel: q("confirm-cancel"),
    contextMenu: q("context-menu"), tabbar: q("tabbar"), bottomPanel: q("bottom-panel"), saveIndicator: q("save-indicator"),
  });

  paintIcons();
  state.settings = await loadSettings();
  initEditorOnce();
  applySettingsToEditor();
  initTerminal();

  let projects = await DB.listProjects();
  if (projects.length === 0) {
    state.project = await seedInitialProject();
    projects = await DB.listProjects();
  } else {
    const lastId = await DB.getSetting("last-project-id", projects[0].id);
    state.project = projects.find((p) => p.id === lastId) || projects[0];
  }
  q("project-name").textContent = state.project.name;
  await refreshProjectSelect();

  const tabsMeta = await DB.getSetting("open-tabs:" + state.project.id, {});
  state.openTabs = tabsMeta.openTabs || [];
  await reloadNodes();
  const first =
    (tabsMeta.activeNodeId && state.nodes.find((n) => n.id === tabsMeta.activeNodeId)) ||
    state.nodes.find((n) => n.type === "file" && n.name === "index.html") ||
    state.nodes.find((n) => n.type === "file");
  if (first) await openNode(first.id);

  wireEvents();
}

function wireEvents() {
  q("btn-menu").addEventListener("click", openSidebar);
  q("btn-close-sidebar").addEventListener("click", closeSidebar);
  el.sidebarScrim.addEventListener("click", closeSidebar);
  q("btn-ai-top").addEventListener("click", openAiPanel);
  q("btn-close-ai").addEventListener("click", closeAiPanel);
  el.aiScrim.addEventListener("click", closeAiPanel);
  q("btn-close-settings").addEventListener("click", closeSettingsPanel);
  q("settings-scrim").addEventListener("click", closeSettingsPanel);
  q("btn-close-preview").addEventListener("click", closePreview);
  q("btn-refresh-preview").addEventListener("click", refreshPreview);
  q("btn-fullscreen-preview").addEventListener("click", () => {
    if (el.previewFrame.requestFullscreen) el.previewFrame.requestFullscreen();
  });
  q("btn-close-bottom").addEventListener("click", closeBottomPanel);
  document.querySelectorAll(".bp-tab").forEach((btn) => btn.addEventListener("click", () => switchBottomTab(btn.dataset.panel)));

  q("nav-files").addEventListener("click", openSidebar);
  q("nav-ai").addEventListener("click", openAiPanel);
  q("nav-search").addEventListener("click", () => { openSidebar(); q("search-panel").classList.add("open"); q("search-panel").setAttribute("aria-hidden", "false"); });
  q("btn-close-search").addEventListener("click", () => { q("search-panel").classList.remove("open"); q("search-panel").setAttribute("aria-hidden", "true"); });
  q("btn-open-cm-search").addEventListener("click", () => { editor.openSearch(); q("search-panel").classList.remove("open"); closeSidebar(); });
  q("nav-run").addEventListener("click", openPreview);
  q("nav-settings").addEventListener("click", openSettingsPanel);
  q("ab-explorer").addEventListener("click", openSidebar);
  q("ab-search").addEventListener("click", () => q("nav-search").click());
  q("ab-run").addEventListener("click", openPreview);
  q("ab-problems").addEventListener("click", () => openBottomPanel("problems"));
  q("ab-terminal").addEventListener("click", () => openBottomPanel("terminal"));
  q("ab-ai").addEventListener("click", openAiPanel);
  q("ab-settings").addEventListener("click", openSettingsPanel);
  q("ab-source-control").addEventListener("click", () => showToast("Controle de versão (Git) ainda não implementado — fica para uma próxima fase."));
  q("ab-extensions").addEventListener("click", () => showToast("Extensões ainda não implementadas — fica para uma próxima fase."));

  q("btn-new-file").addEventListener("click", () => openNewItemModal("file", null));
  q("btn-new-folder").addEventListener("click", () => openNewItemModal("folder", null));
  q("modal-cancel").addEventListener("click", closeNewItemModal);
  el.modalScrim.addEventListener("click", closeNewItemModal);
  q("modal-confirm").addEventListener("click", confirmNewItem);
  el.modalInput.addEventListener("keydown", (ev) => { if (ev.key === "Enter") confirmNewItem(); });

  el.contextMenu.addEventListener("click", (ev) => {
    const btn = ev.target.closest("button[data-act]");
    if (btn) handleContextAction(btn.dataset.act);
  });

  q("btn-export-zip").addEventListener("click", handleExportZip);
  q("btn-import-zip").addEventListener("click", () => q("zip-input").click());
  q("zip-input").addEventListener("change", (ev) => {
    if (ev.target.files[0]) handleImportZip(ev.target.files[0]);
    ev.target.value = "";
  });
  q("project-select").addEventListener("change", (ev) => switchProject(ev.target.value));
  q("btn-new-project").addEventListener("click", async () => {
    const name = prompt("Nome do novo projeto:");
    if (!name) return;
    await saveAllDirty();
    const project = await DB.createProject(name);
    await DB.createNode({ projectId: project.id, parentId: null, type: "file", name: "index.html", ext: "html", lang: "HTML", content: TEMPLATE_HTML });
    await refreshProjectSelect();
    await switchProject(project.id);
  });

  document.querySelectorAll(".ai-action").forEach((btn) => btn.addEventListener("click", () => runAiAction(btn.dataset.action)));
  el.aiForm.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const text = el.aiInput.value.trim();
    if (!text) return;
    el.aiInput.value = "";
    addAiMessage(text, "user");
    sendToAi(text, currentAiContext(text));
  });

  window.addEventListener("keydown", (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === "s") {
      ev.preventDefault();
      saveActiveFile();
      showToast("Salvo");
    }
  });
}

const TEMPLATE_HTML = '<!DOCTYPE html>\n<html>\n  <head>\n    <meta charset="UTF-8" />\n    <title>Novo projeto</title>\n  </head>\n  <body>\n    \n  </body>\n</html>\n';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

init().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<div style="padding:24px;color:#f66;font-family:monospace;white-space:pre-wrap">Erro ao iniciar o app:\n${err.message}\n\n${err.stack || ""}</div>`;
});
