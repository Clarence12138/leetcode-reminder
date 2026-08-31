export const EDITOR_COVER_ATTR = 'data-xiaoshuaji-cover';
export const EDITOR_COVER_STYLE_ID = 'xiaoshuaji-editor-cover';

const COVER_CSS = `
html[${EDITOR_COVER_ATTR}] .monaco-editor {
  position: relative !important;
}
html[${EDITOR_COVER_ATTR}] .monaco-editor .overflow-guard {
  visibility: hidden !important;
}
html[${EDITOR_COVER_ATTR}] .monaco-editor .view-lines,
html[${EDITOR_COVER_ATTR}] .monaco-editor .view-line,
html[${EDITOR_COVER_ATTR}] .monaco-editor .minimap,
html[${EDITOR_COVER_ATTR}] .monaco-editor .margin-view-overlays,
html[${EDITOR_COVER_ATTR}] .monaco-editor textarea {
  opacity: 0 !important;
}
html[${EDITOR_COVER_ATTR}] .monaco-editor::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 20;
  pointer-events: none;
  background: var(--vscode-editor-background, var(--layer-01, #ffffff));
}
html.dark[${EDITOR_COVER_ATTR}] .monaco-editor::after {
  background: var(--vscode-editor-background, var(--layer-01, #1a1a1a));
}
html[${EDITOR_COVER_ATTR}] [role="dialog"],
html[${EDITOR_COVER_ATTR}] [role="alertdialog"] {
  opacity: 0 !important;
}
`;

export function coverEditorCode(doc: Document = document): () => void {
  ensureCoverStyle(doc);
  doc.documentElement.setAttribute(EDITOR_COVER_ATTR, '');
  return () => {
    doc.documentElement.removeAttribute(EDITOR_COVER_ATTR);
    doc.getElementById(EDITOR_COVER_STYLE_ID)?.remove();
  };
}

function ensureCoverStyle(doc: Document): void {
  if (doc.getElementById(EDITOR_COVER_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = EDITOR_COVER_STYLE_ID;
  style.textContent = COVER_CSS;
  doc.documentElement.append(style);
}
