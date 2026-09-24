/**
 * icons.js — Ícones SVG inline reutilizados pela interface (item 13 do
 * pedido: usar SVG/lib de ícones em vez de depender de emojis nos
 * elementos de "chrome" da IDE — activity bar, explorer, painéis).
 * Emojis continuam sendo usados só em mensagens de chat (IA/toast),
 * onde são só texto decorativo, não controles de interface.
 */
function svg(path, viewBox = "0 0 24 24") {
  return `<svg viewBox="${viewBox}" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

export const ICONS = {
  explorer: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'),
  problems: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16h.01"/>'),
  sourceControl: svg('<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="12" r="2.5"/><path d="M6 8.5v7M8.3 12H15.7"/>'),
  run: svg('<path d="M6 4l14 8-14 8V4z"/>'),
  debug: svg('<circle cx="12" cy="8" r="3"/><path d="M6 21v-3a6 6 0 0 1 12 0v3M9 12l-3-2M15 12l3-2"/>'),
  extensions: svg('<path d="M4 8h4V4h8v4h4v8h-4v4H8v-4H4V8z"/>'),
  terminal: svg('<path d="M4 4h16v16H4z"/><path d="M7 9l3 3-3 3M13 15h4"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  ai: svg('<rect x="4" y="7" width="16" height="12" rx="2"/><path d="M12 3v4M8 12h.01M16 12h.01"/>'),
  file: svg('<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v4h4"/>'),
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>'),
  folderOpen: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2H8l-2 8H2z"/><path d="M8 15l2-6h12l-2 8H4z"/>'),
  chevron: svg('<path d="M9 6l6 6-6 6"/>'),
  close: svg('<path d="M18 6L6 18M6 6l12 12"/>'),
  plusFile: svg('<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v4h4"/><path d="M9 14h6M12 11v6"/>'),
  plusFolder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/><path d="M9 12h6M12 9v6"/>'),
  trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  rename: svg('<path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z"/>'),
  download: svg('<path d="M12 3v12M7 11l5 5 5-5M5 21h14"/>'),
  upload: svg('<path d="M12 21V9M7 13l5-5 5 5M5 3h14"/>'),
  cloud: svg('<path d="M7 18a4 4 0 1 1 .7-7.9 5 5 0 0 1 9.6 1.7A3.5 3.5 0 0 1 17 18H7z"/>'),
  refresh: svg('<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v6h-6"/>'),
  saveAs: svg('<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v6h8V4M8 15h8"/>'),
  menu: svg('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  play: svg('<path d="M6 4l14 8-14 8V4z"/>'),
  fullscreen: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  send: svg('<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>'),
  check: svg('<path d="M20 6L9 17l-5-5"/>'),
  warning: svg('<path d="M12 3l10 18H2z"/><path d="M12 9v5M12 17h.01"/>'),
  error: svg('<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/>'),
  dot: svg('<circle cx="12" cy="12" r="4"/>'),
};

export function fileIconSvg(ext) {
  const colors = { html: "#e34c26", css: "#2965f1", js: "#f0db4f", json: "#a1c181" };
  const c = colors[(ext || "").toLowerCase()] || "#8a8f98";
  return `<span class="file-type-icon" style="color:${c}">${ICONS.file}</span>`;
}
