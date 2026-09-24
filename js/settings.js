import { DB } from "./db.js";

export const DEFAULT_SETTINGS = {
  theme: "dark", // 'dark' | 'light'
  fontSize: 14,
  lineHeight: 1.5,
  wordWrap: true,
  autocomplete: true,
  autosave: true,
  autosaveIntervalMs: 1500,
  aiProvider: "anthropic", // 'anthropic' | 'openai-compatible'
  aiApiKey: "",
  aiModel: "",
  aiBaseUrl: "",
};

export async function loadSettings() {
  const stored = await DB.getSetting("app-settings", {});
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(settings) {
  await DB.setSetting("app-settings", settings);
}
