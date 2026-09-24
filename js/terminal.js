/**
 * terminal.js — Painel de terminal.
 *
 * IMPORTANTE: um navegador não tem como executar comandos reais do
 * sistema operacional (ls, npm, git, etc.) — isso exigiria um backend
 * com um processo real, que este projeto (100% estático, sem
 * servidor) não tem. Por isso este terminal SÓ executa um punhado de
 * comandos reais sobre os dados do próprio app (não finge o restante):
 *
 *   ls              — lista arquivos/pastas do diretório atual do projeto
 *   cat <arquivo>    — mostra o conteúdo real do arquivo
 *   run              — abre o preview real do projeto
 *   clear            — limpa o terminal
 *   help             — lista os comandos disponíveis
 *
 * Qualquer outro comando retorna uma mensagem explícita dizendo que
 * não há um ambiente de execução real conectado — nunca finge rodar
 * algo que não rodou.
 *
 * connectRemote(url) já vem pronto para, no futuro, abrir um
 * WebSocket para um backend real (ex: um contêiner com um shell de
 * verdade) e passar a repassar comandos/saída por ele.
 */
import { pathFor } from "./explorer.js";

let remoteSocket = null;

export function connectRemote(url) {
  return new Promise((resolve, reject) => {
    try {
      const ws = new WebSocket(url);
      ws.onopen = () => {
        remoteSocket = ws;
        resolve(ws);
      };
      ws.onerror = (e) => reject(e);
    } catch (e) {
      reject(e);
    }
  });
}

export function isRemoteConnected() {
  return Boolean(remoteSocket && remoteSocket.readyState === WebSocket.OPEN);
}

export function runCommand(raw, { nodes, onOpenPreview, onClear }) {
  const cmd = raw.trim();
  if (!cmd) return "";

  if (isRemoteConnected()) {
    remoteSocket.send(cmd);
    return null; // saída chega de forma assíncrona via onmessage, tratado no main.js
  }

  const [name, ...args] = cmd.split(/\s+/);
  const nodesById = new Map(nodes.map((n) => [n.id, n]));

  switch (name) {
    case "help":
      return "Comandos simulados disponíveis: ls, cat <arquivo>, run, clear, help.\nNenhum ambiente de execução real está conectado (veja js/terminal.js).";
    case "ls":
      return nodes
        .filter((n) => !n.parentId)
        .map((n) => (n.type === "folder" ? n.name + "/" : n.name))
        .join("\n") || "(projeto vazio)";
    case "cat": {
      const target = nodes.find((n) => n.type === "file" && pathFor(n.id, nodesById) === args[0]);
      if (!target) return `cat: ${args[0] || "(arquivo)"}: arquivo não encontrado`;
      return target.content || "(arquivo vazio)";
    }
    case "run":
      onOpenPreview && onOpenPreview();
      return "Abrindo preview...";
    case "clear":
      onClear && onClear();
      return "";
    default:
      return `"${name}": comando não reconhecido. Este terminal é simulado — não há um SO real por trás dele. Digite "help" para ver o que está disponível.`;
  }
}
