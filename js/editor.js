/**
 * editor.js — Editor de código real baseado em CodeMirror 6.
 *
 * Carregado via ESM diretamente do CDN esm.sh (sem passo de build).
 * Isso NÃO foi testado em navegador real neste ambiente (sandbox sem
 * acesso de rede) — teste no dispositivo. Se aparecer o erro
 * "Cannot use two instances of X" no console, é conflito de versões
 * entre pacotes do CodeMirror; avise para eu fixar versões compatíveis.
 */

import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor, rectangularSelection, crosshairCursor } from "https://esm.sh/@codemirror/view@6";
import { EditorState, Compartment } from "https://esm.sh/@codemirror/state@6";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "https://esm.sh/@codemirror/commands@6";
import { searchKeymap, openSearchPanel, closeSearchPanel } from "https://esm.sh/@codemirror/search@6";
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from "https://esm.sh/@codemirror/autocomplete@6";
import { indentOnInput, bracketMatching, foldGutter, foldKeymap, syntaxHighlighting, defaultHighlightStyle, indentUnit } from "https://esm.sh/@codemirror/language@6";
import { lintGutter, setDiagnostics } from "https://esm.sh/@codemirror/lint@6";
import { html } from "https://esm.sh/@codemirror/lang-html@6";
import { css } from "https://esm.sh/@codemirror/lang-css@6";
import { javascript } from "https://esm.sh/@codemirror/lang-javascript@6";
import { json } from "https://esm.sh/@codemirror/lang-json@6";
import { oneDark } from "https://esm.sh/@codemirror/theme-one-dark@6";

const languageCompartment = new Compartment();
const themeCompartment = new Compartment();
const fontCompartment = new Compartment();
const wrapCompartment = new Compartment();
const tabSizeCompartment = new Compartment();
const editableCompartment = new Compartment();
const autocompleteCompartment = new Compartment();

function langExtFor(ext) {
  switch ((ext || "").toLowerCase()) {
    case "html":
    case "htm":
      return html();
    case "css":
      return css();
    case "js":
    case "mjs":
    case "jsx":
      return javascript({ jsx: ext === "jsx" });
    case "json":
      return json();
    default:
      return [];
  }
}

const lightThemeExt = EditorView.theme({}, { dark: false });

export function createEditor({ parent, onChange, onCursor }) {
  const state = EditorState.create({
    doc: "",
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      history(),
      drawSelection(),
      dropCursor(),
      rectangularSelection(),
      crosshairCursor(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      foldGutter(),
      lintGutter(),
      autocompleteCompartment.of(autocompletion()),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      languageCompartment.of([]),
      themeCompartment.of(oneDark),
      fontCompartment.of(EditorView.theme({ "&": { fontSize: "14px" } })),
      wrapCompartment.of([]),
      tabSizeCompartment.of(indentUnit.of("  ")),
      editableCompartment.of(EditorView.editable.of(true)),
      keymap.of([
        indentWithTab,
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && onChange && !settingDoc) {
          onChange(update.state.doc.toString());
        }
        if ((update.selectionSet || update.docChanged) && onCursor) {
          const pos = update.state.selection.main.head;
          const line = update.state.doc.lineAt(pos);
          onCursor({ line: line.number, col: pos - line.from + 1 });
        }
      }),
    ],
  });

  let settingDoc = false;

  const view = new EditorView({ state, parent });

  return {
    view,

    setDoc(content, ext) {
      settingDoc = true;
      try {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: content || "" },
          effects: languageCompartment.reconfigure(langExtFor(ext)),
        });
      } finally {
        settingDoc = false;
      }
    },

    getDoc() {
      return view.state.doc.toString();
    },

    focus() {
      view.focus();
    },

    setTheme(dark) {
      view.dispatch({ effects: themeCompartment.reconfigure(dark ? oneDark : lightThemeExt) });
    },

    setFontSize(px, lineHeight = 1.5) {
      view.dispatch({
        effects: fontCompartment.reconfigure(
          EditorView.theme({
            "&": { fontSize: px + "px" },
            ".cm-content": { fontFamily: "'Fira Code', 'Consolas', monospace", lineHeight: String(lineHeight) },
            ".cm-line": { lineHeight: String(lineHeight) },
          })
        ),
      });
    },

    setAutocomplete(on) {
      view.dispatch({ effects: autocompleteCompartment.reconfigure(on ? autocompletion() : []) });
    },

    setWordWrap(on) {
      view.dispatch({ effects: wrapCompartment.reconfigure(on ? EditorView.lineWrapping : []) });
    },

    setTabSize(size) {
      view.dispatch({ effects: tabSizeCompartment.reconfigure(indentUnit.of(" ".repeat(size))) });
    },

    setEditable(on) {
      view.dispatch({ effects: editableCompartment.reconfigure(EditorView.editable.of(on)) });
    },

    openSearch() {
      openSearchPanel(view);
    },

    closeSearch() {
      closeSearchPanel(view);
    },

    setDiagnostics(diagnostics) {
      // diagnostics: [{from, to, severity: 'error'|'warning'|'info', message}]
      view.dispatch(setDiagnostics(view.state, diagnostics));
    },

    gotoLineCol(line, col) {
      const ln = Math.min(Math.max(1, line), view.state.doc.lines);
      const lineInfo = view.state.doc.line(ln);
      const pos = Math.min(lineInfo.from + Math.max(0, (col || 1) - 1), lineInfo.to);
      view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
      view.focus();
    },

    insertAtCursor(text) {
      const sel = view.state.selection.main;
      view.dispatch({ changes: { from: sel.from, to: sel.to, insert: text } });
    },

    getSelectionText() {
      const sel = view.state.selection.main;
      return view.state.doc.sliceString(sel.from, sel.to);
    },

    destroy() {
      view.destroy();
    },
  };
}
