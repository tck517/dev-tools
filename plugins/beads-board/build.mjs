import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const result = await build({
  entryPoints: [join(__dirname, "src/app.ts")],
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
  write: false,
});

const js = result.outputFiles[0].text.replace(/<\/script>/gi, "<\\/script>");

const css = `
:root {
  color-scheme: light dark;
}
* { box-sizing: border-box; }
html, body, #root {
  margin: 0;
  padding: 0;
  height: 100%;
  background: var(--color-background-primary, #111318);
  color: var(--color-text-primary, #e6e8ee);
  font-family: var(--font-sans, system-ui, -apple-system, sans-serif);
  font-size: 13px;
  line-height: 1.4;
}
.shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  position: relative;
}
.topbar {
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-border-primary, rgba(128,128,128,0.25));
  background: var(--color-background-secondary, rgba(128,128,128,0.06));
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}
.topbar-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.project-select {
  flex: 1;
  min-width: 0;
  padding: 5px 8px;
  border-radius: 6px;
  border: 1px solid var(--color-border-primary, rgba(128,128,128,0.3));
  background: var(--color-background-primary, #111318);
  color: var(--color-text-primary, #e6e8ee);
  font-size: 12px;
}
.search-input {
  flex: 1;
  padding: 5px 8px;
  border-radius: 6px;
  border: 1px solid var(--color-border-primary, rgba(128,128,128,0.3));
  background: var(--color-background-primary, #111318);
  color: var(--color-text-primary, #e6e8ee);
  font-size: 12px;
}
.segmented {
  display: inline-flex;
  border: 1px solid var(--color-border-primary, rgba(128,128,128,0.3));
  border-radius: 6px;
  overflow: hidden;
  flex-shrink: 0;
}
.seg-btn {
  border: 0;
  padding: 4px 9px;
  font-size: 12px;
  cursor: pointer;
  background: transparent;
  color: var(--color-text-secondary, #9aa1b2);
}
.seg-btn.active {
  background: var(--color-background-info, rgba(56,189,248,0.2));
  color: var(--color-text-primary, #fff);
  font-weight: 600;
}
.icon-btn {
  border: 1px solid var(--color-border-primary, rgba(128,128,128,0.3));
  background: transparent;
  color: var(--color-text-primary, #e6e8ee);
  border-radius: 6px;
  padding: 4px 8px;
  cursor: pointer;
  font-size: 12px;
}
.icon-btn:hover { background: var(--color-background-tertiary, rgba(128,128,128,0.12)); }
.content {
  flex: 1;
  overflow-y: auto;
  padding: 8px 10px 24px;
}
.board-section { margin-bottom: 10px; }
.section-header {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 6px;
  border: 0;
  border-radius: 6px;
  background: var(--color-background-secondary, rgba(128,128,128,0.08));
  color: var(--color-text-primary, #e6e8ee);
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.04em;
  cursor: pointer;
  text-align: left;
}
.section-header.tone-warning .section-label { color: var(--color-text-warning, #f59e0b); }
.section-header.tone-info .section-label { color: var(--color-text-info, #38bdf8); }
.section-header.tone-accent .section-label { color: #a78bfa; }
.section-header.tone-danger .section-label { color: var(--color-text-danger, #f87171); }
.section-header.tone-success .section-label { color: var(--color-text-success, #34d399); }
.section-count {
  margin-left: auto;
  opacity: 0.7;
  font-weight: 600;
}
.section-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 4px;
}
.bead-row {
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 0.1s ease;
}
.bead-row:hover {
  background: var(--color-background-secondary, rgba(128,128,128,0.1));
}
.bead-row.selected {
  background: var(--color-background-info, rgba(56,189,248,0.15));
  border-color: var(--color-border-info, rgba(56,189,248,0.5));
}
.bead-main {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.bead-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  font-weight: 700;
  opacity: 0.85;
  flex-shrink: 0;
}
.bead-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bead-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}
.pill {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10.5px;
  background: var(--color-background-tertiary, rgba(128,128,128,0.16));
  color: var(--color-text-secondary, #b8becb);
  border: 1px solid transparent;
}
.pill.prio-p0, .pill.danger, .pill.safety-hot {
  background: var(--color-background-danger, rgba(248,113,113,0.18));
  color: var(--color-text-danger, #f87171);
}
.pill.prio-p1, .pill.warning, .pill.safety-reversible {
  background: var(--color-background-warning, rgba(245,158,11,0.18));
  color: var(--color-text-warning, #f59e0b);
}
.pill.success, .pill.safety-internal {
  background: var(--color-background-success, rgba(52,211,153,0.16));
  color: var(--color-text-success, #34d399);
}
.pill.safety-flagged, .pill.epic-ref {
  background: var(--color-background-info, rgba(56,189,248,0.15));
  color: var(--color-text-info, #38bdf8);
}
.pill.attached {
  background: #6d28d9;
  color: #fff;
  font-weight: 600;
}
.link-pill {
  cursor: pointer;
  border-color: var(--color-border-info, rgba(56,189,248,0.4));
  color: var(--color-text-info, #38bdf8);
}
.link-pill:hover { text-decoration: underline; }
.empty-row {
  padding: 6px 10px;
  font-size: 12px;
  color: var(--color-text-tertiary, #888);
}
.empty-state, .error-box {
  padding: 20px;
  text-align: center;
  color: var(--color-text-secondary, #9aa1b2);
}
.error-box { color: var(--color-text-danger, #f87171); }

/* Tech Tree / Dependency View */
.tree-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11.5px;
  color: var(--color-text-secondary, #9aa1b2);
  margin-bottom: 12px;
}
.tree-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.toggle-pill {
  border: 1px solid var(--color-border-primary, rgba(128,128,128,0.35));
  background: var(--color-background-secondary, rgba(128,128,128,0.08));
  color: var(--color-text-secondary, #b8becb);
  border-radius: 999px;
  padding: 3px 9px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.toggle-pill:hover {
  border-color: var(--color-border-info, rgba(56,189,248,0.55));
  color: var(--color-text-primary, #e6e8ee);
}
.toggle-pill.active {
  background: var(--color-background-info, rgba(56,189,248,0.18));
  border-color: var(--color-border-info, rgba(56,189,248,0.55));
  color: var(--color-text-info, #38bdf8);
}
.tree-warning {
  margin-bottom: 12px;
  padding: 8px 10px;
  border-radius: 7px;
  border: 1px solid var(--color-border-warning, rgba(245,158,11,0.5));
  background: var(--color-background-warning, rgba(245,158,11,0.12));
  color: var(--color-text-warning, #f59e0b);
  font-size: 12px;
}
.empty-action {
  margin-top: 10px;
}
.dep-section {
  margin-bottom: 18px;
}
.dep-section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.dep-section-title {
  font-size: 11.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-primary, #e6e8ee);
}
.dep-section-sub {
  font-size: 11px;
  color: var(--color-text-tertiary, #888);
  margin-top: 2px;
}
.dep-graph-well {
  position: relative;
  padding: 12px 10px 14px;
  border-radius: 10px;
  border: 1px solid var(--color-border-primary, rgba(128,128,128,0.22));
  background: var(--color-background-secondary, rgba(128,128,128,0.04));
}
.dep-edges-svg {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
}
.dep-edges-overlay {
  z-index: 3;
}
.dep-stages {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 28px;
}
.stage-band {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.stage-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
}
.stage-badge {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--color-background-tertiary, rgba(128,128,128,0.2));
  color: var(--color-text-primary, #e6e8ee);
}
.stage-title {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--color-text-secondary, #b8becb);
}
.stage-sub {
  font-size: 11px;
  color: var(--color-text-tertiary, #888);
}
.stage-cards,
.epic-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 10px;
}
.epic-card {
  position: relative;
  padding: 9px 10px;
  border-radius: 8px;
  border: 1px solid var(--color-border-primary, rgba(128,128,128,0.28));
  background: var(--color-background-primary, #111318);
  cursor: pointer;
  transition: opacity 0.14s ease, border-color 0.14s ease, box-shadow 0.14s ease;
}
.epic-card:hover {
  border-color: var(--color-border-info, #38bdf8);
}
.epic-card.state-done {
  opacity: 0.72;
}
.epic-card.state-done:hover {
  opacity: 0.96;
}
.epic-card.critical {
  border-left: 3px solid var(--color-text-warning, #f59e0b);
}
.epic-card.pinned {
  border-color: var(--color-border-info, #38bdf8);
  box-shadow: 0 0 0 1px var(--color-border-info, rgba(56,189,248,0.45));
}
.dep-graph-well.focusing .epic-card {
  opacity: 0.24;
}
.dep-graph-well.focusing .epic-card.in-lineage {
  opacity: 1;
}
.epic-top {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  margin-bottom: 5px;
}
.epic-inspect-btn {
  margin-left: auto;
  border: 0;
  background: transparent;
  color: var(--color-text-tertiary, #888);
  font-size: 12px;
  line-height: 1;
  padding: 2px 5px;
  border-radius: 4px;
  cursor: pointer;
}
.epic-inspect-btn:hover {
  background: var(--color-background-tertiary, rgba(128,128,128,0.2));
  color: var(--color-text-primary, #e6e8ee);
}
.pill.state-pill-in-progress {
  background: var(--color-background-warning, rgba(245,158,11,0.18));
  color: var(--color-text-warning, #f59e0b);
  font-weight: 600;
}
.pill.state-pill-ready {
  background: var(--color-background-info, rgba(56,189,248,0.16));
  color: var(--color-text-info, #38bdf8);
  font-weight: 600;
}
.pill.state-pill-blocked {
  background: var(--color-background-danger, rgba(248,113,113,0.18));
  color: var(--color-text-danger, #f87171);
  font-weight: 600;
}
.pill.state-pill-done {
  background: var(--color-background-success, rgba(52,211,153,0.16));
  color: var(--color-text-success, #34d399);
}
.epic-title {
  font-weight: 600;
  margin-bottom: 6px;
}
.progress-track {
  height: 5px;
  border-radius: 999px;
  background: var(--color-background-tertiary, rgba(128,128,128,0.2));
  overflow: hidden;
  margin-bottom: 5px;
}
.progress-fill {
  height: 100%;
  background: var(--color-text-success, #34d399);
}
.epic-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 11px;
  color: var(--color-text-secondary, #9aa1b2);
}
.epic-deps-wrap {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed var(--color-border-primary, rgba(128,128,128,0.24));
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.epic-deps-row {
  display: flex;
  align-items: baseline;
  gap: 5px;
  font-size: 10.5px;
}
.dep-label {
  color: var(--color-text-tertiary, #888);
  flex-shrink: 0;
  font-weight: 600;
}
.dep-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.dep-chip {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
  border: 1px solid var(--color-border-primary, rgba(128,128,128,0.3));
  background: transparent;
  cursor: pointer;
}
.dep-chip:hover {
  text-decoration: underline;
}
.dep-chip-blocker {
  color: var(--color-text-danger, #f87171);
  border-color: var(--color-border-danger, rgba(248,113,113,0.4));
  background: var(--color-background-danger, rgba(248,113,113,0.1));
}
.dep-chip-done {
  color: var(--color-text-success, #34d399);
  border-color: var(--color-border-success, rgba(52,211,153,0.35));
  background: var(--color-background-success, rgba(52,211,153,0.08));
}
.dep-chip-unlocks {
  color: var(--color-text-info, #38bdf8);
  border-color: var(--color-border-info, rgba(56,189,248,0.38));
  background: var(--color-background-info, rgba(56,189,248,0.08));
}

/* Detail Drawer */
.detail-drawer {
  border-top: 2px solid var(--color-border-info, rgba(56,189,248,0.5));
  background: var(--color-background-secondary, #171a22);
  max-height: 48%;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}
.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 10px 3px;
}
.detail-title-wrap { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.detail-sub {
  padding: 0 10px 6px;
  font-weight: 600;
  font-size: 13px;
}
.detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 10px 8px;
  border-bottom: 1px solid var(--color-border-primary, rgba(128,128,128,0.2));
}
.btn {
  padding: 4px 9px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid var(--color-border-primary, rgba(128,128,128,0.35));
}
.btn-primary {
  background: var(--color-background-info, #0284c7);
  color: var(--color-text-primary, #fff);
  border-color: var(--color-border-info, #38bdf8);
}
.btn-secondary {
  background: var(--color-background-primary, transparent);
  color: var(--color-text-primary, #e6e8ee);
}
.btn:hover { opacity: 0.9; }
.detail-body {
  padding: 8px 10px 14px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.detail-block { display: flex; flex-direction: column; gap: 4px; }
.detail-label {
  font-size: 10.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-tertiary, #888);
}
.detail-pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 12px;
  background: var(--color-background-primary, rgba(0,0,0,0.18));
  padding: 7px 8px;
  border-radius: 6px;
  border: 1px solid var(--color-border-primary, rgba(128,128,128,0.18));
}
.detail-md {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--color-text-primary, #e6e8ee);
  background: var(--color-background-primary, rgba(128,128,128,0.08));
  padding: 7px 9px;
  border-radius: 6px;
  border: 1px solid var(--color-border-primary, rgba(128,128,128,0.2));
  overflow-wrap: break-word;
  word-break: break-word;
  min-width: 0;
}
.detail-md > :first-child { margin-top: 0; }
.detail-md > :last-child { margin-bottom: 0; }
.detail-md .md-h {
  margin: 9px 0 4px;
  font-weight: 700;
  line-height: 1.3;
  color: var(--color-text-primary, #e6e8ee);
}
.detail-md .md-h1 {
  font-size: 13px;
  padding-bottom: 2px;
  border-bottom: 1px solid var(--color-border-primary, rgba(128,128,128,0.22));
}
.detail-md .md-h2 {
  font-size: 12.5px;
  padding-bottom: 2px;
  border-bottom: 1px solid var(--color-border-primary, rgba(128,128,128,0.16));
}
.detail-md .md-h3 {
  font-size: 12px;
  color: var(--color-text-secondary, #b8becb);
}
.detail-md .md-h4,
.detail-md .md-h5,
.detail-md .md-h6 {
  font-size: 11.5px;
  color: var(--color-text-secondary, #b8becb);
}
.detail-md .md-p {
  margin: 0 0 6px;
}
.detail-md .md-list {
  margin: 0 0 6px;
  padding-left: 18px;
}
.detail-md .md-list .md-list {
  margin-top: 2px;
  margin-bottom: 2px;
}
.detail-md .md-list li {
  margin: 2px 0;
}
.detail-md .md-task-item {
  list-style: none;
  margin-left: -16px;
  display: flex;
  align-items: flex-start;
  gap: 6px;
}
.detail-md .md-checkbox {
  margin: 2px 0 0;
  flex-shrink: 0;
  accent-color: var(--color-text-info, #38bdf8);
  pointer-events: none;
}
.detail-md .md-task-body {
  min-width: 0;
  flex: 1;
}
.detail-md .md-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--color-background-tertiary, rgba(128,128,128,0.16));
  border: 1px solid var(--color-border-primary, rgba(128,128,128,0.18));
  overflow-wrap: anywhere;
  word-break: break-word;
}
.detail-md .md-code-block {
  margin: 6px 0;
  padding: 7px 8px;
  border-radius: 5px;
  background: var(--color-background-secondary, rgba(128,128,128,0.1));
  border: 1px solid var(--color-border-primary, rgba(128,128,128,0.22));
  overflow-x: auto;
  max-width: 100%;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  line-height: 1.4;
}
.detail-md .md-code-block code {
  white-space: pre;
  word-break: normal;
  overflow-wrap: normal;
  font-family: inherit;
  font-size: inherit;
}
.detail-md .md-blockquote {
  margin: 6px 0;
  padding: 3px 8px;
  border-left: 3px solid var(--color-border-info, rgba(56,189,248,0.5));
  color: var(--color-text-secondary, #9aa1b2);
  background: var(--color-background-secondary, rgba(128,128,128,0.06));
  border-radius: 0 4px 4px 0;
}
.detail-md .md-blockquote > :first-child { margin-top: 0; }
.detail-md .md-blockquote > :last-child { margin-bottom: 0; }
.detail-md .md-hr {
  border: 0;
  border-top: 1px solid var(--color-border-primary, rgba(128,128,128,0.25));
  margin: 8px 0;
}
.detail-md .md-link {
  color: var(--color-text-info, #38bdf8);
  text-decoration: underline;
  overflow-wrap: anywhere;
}
.detail-md .md-link:hover {
  opacity: 0.85;
}
.comment-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.comment-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.comment-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--color-text-tertiary, #888);
}
.comment-author {
  font-weight: 600;
  color: var(--color-text-secondary, #9aa1b2);
}
.chip-wrap { display: flex; flex-wrap: wrap; gap: 4px; }
.file-chip {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 5px;
  border: 1px solid var(--color-border-primary, rgba(128,128,128,0.35));
  background: var(--color-background-primary, transparent);
  color: var(--color-text-info, #38bdf8);
  cursor: pointer;
}
.file-chip:hover { text-decoration: underline; }
.dep-list {
  margin: 0;
  padding-left: 16px;
  font-size: 12px;
}
.link-inline {
  background: none;
  border: 0;
  padding: 0;
  color: var(--color-text-info, #38bdf8);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11.5px;
  cursor: pointer;
  text-decoration: underline;
}
.muted { opacity: 0.72; }
.toast {
  position: absolute;
  bottom: 10px;
  right: 10px;
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--color-background-inverse, #1f2937);
  color: var(--color-text-inverse, #f9fafb);
  font-size: 12px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  pointer-events: none;
}
`;

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Beads Board</title>
  <style>${css}</style>
</head>
<body>
  <div id="root"></div>
  <script type="module">${js}</script>
</body>
</html>
`;

mkdirSync(join(__dirname, "dist"), { recursive: true });
writeFileSync(join(__dirname, "dist/app.html"), html, "utf8");
console.log(
  `Built dist/app.html (${Buffer.byteLength(html, "utf8")} bytes)`,
);
