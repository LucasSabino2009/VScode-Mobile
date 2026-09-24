/**
 * onedrive.js — Integração real com OneDrive via MSAL.js (MSAL Browser,
 * fluxo Authorization Code + PKCE) e Microsoft Graph API.
 *
 * STATUS: arquitetura pronta e funcional, mas INATIVA até que você
 * registre um app na Microsoft Entra ID (Azure AD) e configure o
 * Client ID abaixo. Isso não pode ser feito por mim: requer uma conta
 * Microsoft/Azure sua para criar o "App registration". Sem isso, esta
 * integração não pode funcionar de verdade — e por isso o app mostra
 * "OneDrive não configurado" em vez de fingir uma tela de login.
 *
 * Como habilitar (resumo — o passo a passo completo fica no relatório
 * final e no README):
 *  1. portal.azure.com → Microsoft Entra ID → App registrations → New.
 *  2. Tipo de conta: "Accounts in any organizational directory and
 *     personal Microsoft accounts" (para aceitar contas pessoais).
 *  3. Platform: "Single-page application", Redirect URI = a URL onde
 *     este app roda (ex: https://seu-dominio/).
 *  4. Nenhum "client secret" é necessário (SPA usa PKCE, sem segredo).
 *  5. API permissions → Microsoft Graph → Delegated →
 *     Files.ReadWrite, Files.ReadWrite.AppFolder, offline_access, User.Read.
 *  6. Copie o "Application (client) ID" e cole em ONEDRIVE_CONFIG.clientId.
 *
 * Segurança: nenhuma senha da Microsoft passa por este app em momento
 * algum — a tela de login é sempre a página oficial da Microsoft
 * (login.microsoftonline.com), aberta pelo MSAL. Este app só recebe
 * um token de acesso de curta duração, guardado pelo MSAL (não por
 * nós) na sessionStorage do navegador.
 */

export const ONEDRIVE_CONFIG = {
  clientId: "", // <-- preencha com o Application (client) ID do seu App registration
  authority: "https://login.microsoftonline.com/consumers", // "consumers" aceita contas pessoais da Microsoft
  scopes: ["Files.ReadWrite", "Files.ReadWrite.AppFolder", "offline_access", "User.Read"],
};

let msalInstance = null;

export function isOneDriveConfigured() {
  return Boolean(ONEDRIVE_CONFIG.clientId);
}

async function getMsal() {
  if (!isOneDriveConfigured()) {
    throw new Error("OneDrive não configurado: falta o Client ID do Azure App registration (veja js/onedrive.js).");
  }
  if (msalInstance) return msalInstance;
  const { PublicClientApplication } = await import("https://esm.sh/@azure/msal-browser@3");
  msalInstance = new PublicClientApplication({
    auth: {
      clientId: ONEDRIVE_CONFIG.clientId,
      authority: ONEDRIVE_CONFIG.authority,
      redirectUri: window.location.origin + window.location.pathname,
    },
    cache: { cacheLocation: "sessionStorage" },
  });
  await msalInstance.initialize();
  return msalInstance;
}

export async function connectOneDrive() {
  const msal = await getMsal();
  const result = await msal.loginPopup({ scopes: ONEDRIVE_CONFIG.scopes });
  if (result.account) msal.setActiveAccount(result.account);
  return result.account;
}

export async function disconnectOneDrive() {
  if (!msalInstance) return;
  const account = msalInstance.getActiveAccount();
  if (account) await msalInstance.logoutPopup({ account });
}

async function getToken() {
  const msal = await getMsal();
  const account = msalInstance.getActiveAccount() || msalInstance.getAllAccounts()[0];
  if (!account) throw new Error("Nenhuma conta Microsoft conectada.");
  try {
    const res = await msal.acquireTokenSilent({ scopes: ONEDRIVE_CONFIG.scopes, account });
    return res.accessToken;
  } catch {
    const res = await msal.acquireTokenPopup({ scopes: ONEDRIVE_CONFIG.scopes, account });
    return res.accessToken;
  }
}

async function graphFetch(path, options = {}) {
  const token = await getToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Microsoft Graph erro ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

export async function listOneDriveFolder(itemId = "root") {
  const path = itemId === "root" ? "/me/drive/root/children" : `/me/drive/items/${itemId}/children`;
  const data = await graphFetch(path);
  return data.value;
}

export async function downloadOneDriveFile(itemId) {
  const token = await getToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${itemId}/content`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Falha ao baixar arquivo do OneDrive (${res.status}).`);
  return res.text();
}

export async function uploadOneDriveFile(parentId, filename, content) {
  return graphFetch(`/me/drive/items/${parentId}:/${encodeURIComponent(filename)}:/content`, {
    method: "PUT",
    headers: { "Content-Type": "text/plain" },
    body: content,
  });
}

export async function createOneDriveFolder(parentId, name) {
  return graphFetch(`/me/drive/items/${parentId}/children`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, folder: {}, "@microsoft.graph.conflictBehavior": "rename" }),
  });
}

export async function deleteOneDriveItem(itemId) {
  return graphFetch(`/me/drive/items/${itemId}`, { method: "DELETE" });
}
