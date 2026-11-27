import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";
import { z } from "zod";
import { escapeHtml, renderMarkdown } from "./markdown";
import {
  boardFingerprint,
  createAutoRefresher,
  findBeadSummary,
} from "./refresh";
import {
  buildTechTreeLayout,
  collectLineage,
  edgeKey,
  type DepLink,
  type EpicEdge,
  type EpicNode,
  type TechTreeLayout,
  type TechTreeNodeView,
} from "./techtree";

type BeadSummary = {
  id: string;
  title: string;
  status: string;
  priority: number;
  issueType: string;
  parent: string | null;
  assignee: string | null;
  effort: string | null;
  safety: string | null;
  verdict: string | null;
  prNumber: number | null;
  prUrl: string | null;
  commits: string[];
  track: string | null;
  rework: boolean;
  humanOps: boolean;
  waits: string[];
  updatedAt: string | null;
  closedAt: string | null;
};

type BoardPayload = {
  ok: boolean;
  error?: string;
  project: string;
  projectName?: string;
  projectShort?: string;
  repoUrl?: string | null;
  refreshedAt?: string;
  counts?: {
    wip: number;
    next: number;
    dlv: number;
    blocked: number;
    done: number;
    total: number;
  };
  sections?: {
    wip: BeadSummary[];
    next: BeadSummary[];
    dlv: BeadSummary[];
    blocked: BeadSummary[];
    done: BeadSummary[];
  };
  techTree?: {
    epics: EpicNode[];
    edges: { from: string; to: string }[];
    criticalPath: string[];
    looseOpen: number;
  };
  projects?: { path: string; name: string; shortPath: string }[];
  prefs?: {
    view: "board" | "techtree";
    filter: string;
    collapsed: string[];
  };
};

type BeadComment = {
  id: string;
  author: string;
  text: string;
  createdAt: string | null;
};

type BeadDetail = {
  id: string;
  title: string;
  status: string;
  priority: number;
  issueType: string;
  parent: string | null;
  assignee: string | null;
  labels: string[];
  description: string;
  acceptanceCriteria: string;
  design: string;
  notes: string;
  comments?: BeadComment[];
  closeReason: string;
  updatedAt: string | null;
  closedAt: string | null;
  dependencies: { id: string; title: string; status: string; type: string }[];
  dependents: { id: string; title: string; status: string; type: string }[];
  prNumber: number | null;
  prUrl: string | null;
  files: { rel: string; uri: string }[];
  contextText: string;
};

const SECTIONS = [
  { key: "wip", label: "IN PROCESS", tone: "warning" },
  { key: "next", label: "UP NEXT", tone: "info" },
  { key: "dlv", label: "DELIVERED", tone: "accent" },
  { key: "blocked", label: "BLOCKED", tone: "danger" },
  { key: "done", label: "DONE", tone: "success" },
] as const;

const app = new App({ name: "Beads Board", version: "1.0.0" }, {});

let board: BoardPayload | null = null;
let view: "board" | "techtree" = "board";
let filterText = "";
let collapsed = new Set<string>(["done"]);
let selectedId: string | null = null;
let selectedDetail: BeadDetail | null = null;
let detailLoading = false;
let attachedId: string | null = null;
let toastMsg = "";
let toastTimer: number | null = null;
let busy = false;
let pollInFlight = false;
let showCompletedEpics = false;
let pinnedEpicId: string | null = null;
let lastTechTreeLayout: TechTreeLayout | null = null;
let treeResizeObserver: ResizeObserver | null = null;

const AUTO_REFRESH_INTERVAL_MS = 10_000;
const FOCUS_REFRESH_COOLDOWN_MS = 3_000;

const rootEl = document.getElementById("root")!;

function showToast(msg: string) {
  toastMsg = msg;
  render();
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastMsg = "";
    render();
  }, 2600);
}

function esc(s: string): string {
  return escapeHtml(s);
}

function formatShortTimestamp(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 16).replace("T", " ");
}

function caps() {
  const c = (app.getHostCapabilities() || {}) as Record<string, unknown>;
  return {
    canMessage: Boolean(c.message),
    canContext: Boolean(c.updateModelContext),
    canOpenLinks: Boolean(c.openLinks),
    canServerTools: Boolean(c.serverTools),
  };
}

function formatRefreshTooltip(iso: string | undefined): string {
  const base = "Refresh live bd state (auto-refreshes every 10s)";
  if (!iso) return base;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return base;
  return `${base} · updated ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
}

function applyPayload(
  data: BoardPayload | undefined,
  opts: { preserveUiState?: boolean } = {},
) {
  if (!data) return;
  const prevBoard = board;
  const prevFp = boardFingerprint(prevBoard);
  const nextFp = boardFingerprint(data);
  board = data;

  if (!opts.preserveUiState && data.prefs) {
    if (data.prefs.view === "board" || data.prefs.view === "techtree") {
      view = data.prefs.view;
    }
    if (data.prefs.filter && !filterText) {
      filterText = data.prefs.filter;
    }
    if (Array.isArray(data.prefs.collapsed)) {
      collapsed = new Set(data.prefs.collapsed);
    }
  }

  if (opts.preserveUiState && prevFp === nextFp) {
    // Nothing changed on disk: update tooltip only, avoiding any DOM redraw
    const refreshBtn = document.getElementById("refresh-btn");
    if (refreshBtn) refreshBtn.title = formatRefreshTooltip(data.refreshedAt);
    return;
  }

  render();

  if (opts.preserveUiState && selectedId && !detailLoading) {
    const prevItem = findBeadSummary(prevBoard?.sections, selectedId);
    const nextItem = findBeadSummary(data.sections, selectedId);
    if (JSON.stringify(prevItem) !== JSON.stringify(nextItem)) {
      void refreshSelectedDetailSilently(selectedId);
    }
  }
}

async function refreshSelectedDetailSilently(id: string) {
  const project = board?.project;
  if (!project || selectedId !== id) return;
  try {
    const res = await app.callServerTool({
      name: "beads_board_detail",
      arguments: { project, id },
    });
    if (selectedId !== id || board?.project !== project) return;
    const sc = res.structuredContent as
      | { ok: boolean; bead?: BeadDetail; error?: string }
      | undefined;
    if (sc?.ok && sc.bead) {
      selectedDetail = sc.bead;
      render();
    }
  } catch {
    // non-fatal during background refresh
  }
}

async function pollBoardSilently() {
  const project = board?.project;
  if (!project || busy || pollInFlight || detailLoading || !caps().canServerTools) {
    return;
  }
  const sel = window.getSelection?.()?.toString().trim();
  if (sel) return;
  pollInFlight = true;
  try {
    const res = await app.callServerTool({
      name: "beads_board_refresh",
      arguments: { project, view, background: true },
    });
    if (board?.project !== project) return;
    const sc = res.structuredContent as BoardPayload | undefined;
    if (sc) {
      applyPayload(sc, { preserveUiState: true });
    }
  } catch {
    // non-fatal; retry on next poll tick
  } finally {
    pollInFlight = false;
  }
}

const autoRefresher = createAutoRefresher({
  intervalMs: AUTO_REFRESH_INTERVAL_MS,
  focusCooldownMs: FOCUS_REFRESH_COOLDOWN_MS,
  isVisible: () => document.visibilityState === "visible",
  canPoll: () =>
    Boolean(board?.project) &&
    caps().canServerTools &&
    !busy &&
    !pollInFlight &&
    !detailLoading,
  poll: pollBoardSilently,
});

async function persistPrefs() {
  if (!board?.project) return;
  try {
    await app.callServerTool({
      name: "beads_board_save_prefs",
      arguments: {
        project: board.project,
        view,
        collapsed: [...collapsed],
      },
    });
  } catch {
    // non-fatal
  }
}

async function refreshBoard(projectOverride?: string) {
  if (busy) return;
  busy = true;
  render();
  try {
    const res = await app.callServerTool({
      name: "beads_board_refresh",
      arguments: {
        project: projectOverride || board?.project,
        view,
      },
    });
    const sc = res.structuredContent as BoardPayload | undefined;
    if (sc) {
      if (projectOverride && projectOverride !== board?.project) {
        selectedId = null;
        selectedDetail = null;
        pinnedEpicId = null;
      }
      applyPayload(sc);
      autoRefresher.markRefreshed();
      showToast(`Refreshed ${sc.projectName || "board"}`);
    }
  } catch (err) {
    showToast(`Refresh failed: ${String(err)}`);
  } finally {
    busy = false;
    render();
  }
}

async function selectBead(id: string) {
  if (!board?.project) return;
  if (selectedId === id && selectedDetail?.id === id) {
    selectedId = null;
    selectedDetail = null;
    render();
    return;
  }
  selectedId = id;
  selectedDetail = null;
  detailLoading = true;
  render();
  try {
    const res = await app.callServerTool({
      name: "beads_board_detail",
      arguments: { project: board.project, id },
    });
    const sc = res.structuredContent as
      | { ok: boolean; bead?: BeadDetail; error?: string }
      | undefined;
    if (sc?.ok && sc.bead) {
      selectedDetail = sc.bead;
    } else {
      showToast(sc?.error || `Could not load ${id}`);
    }
  } catch (err) {
    showToast(`Detail failed: ${String(err)}`);
  } finally {
    detailLoading = false;
    render();
  }
}

async function attachContext(detail: BeadDetail) {
  try {
    await app.updateModelContext({
      content: [{ type: "text", text: detail.contextText }],
    });
    attachedId = detail.id;
    showToast(`Attached ${detail.id} to next chat message`);
  } catch (err) {
    showToast(`Attach failed: ${String(err)}`);
  }
}

async function clearContext() {
  try {
    await app.updateModelContext({ content: [] });
    attachedId = null;
    showToast("Cleared attached bead context");
  } catch (err) {
    showToast(`Clear failed: ${String(err)}`);
  }
}

async function sendChatCommand(text: string, background = false) {
  try {
    const payload: Record<string, unknown> = {
      role: "user",
      content: [{ type: "text", text }],
    };
    if (background) {
      payload._meta = { "com.google.antigravity/message": { target: "new" } };
    }
    await app.sendMessage(payload as Parameters<App["sendMessage"]>[0]);
    showToast(
      background ? `Started background thread: ${text}` : `Sent to chat: ${text}`,
    );
  } catch (err) {
    showToast(`Send failed: ${String(err)}`);
  }
}

async function openExternalUrl(url: string) {
  try {
    await app.openLink({ url });
  } catch (err) {
    showToast(`Could not open link: ${String(err)}`);
  }
}

async function openWorkspaceFile(uri: string, rel: string) {
  try {
    const res = await app.request(
      {
        method: "com.google.antigravity/toggle-aux-pane",
        params: { tabType: "fileView", uri },
      },
      z.object({ isError: z.boolean().optional() }).passthrough(),
    );
    if (res?.isError) {
      showToast(`File tab unavailable in this view (${rel})`);
    }
  } catch {
    showToast(`Cannot open file tab from this surface (${rel})`);
  }
}

function matchesFilter(b: BeadSummary, q: string): boolean {
  if (!q) return true;
  const hay = [
    b.id,
    b.title,
    b.parent || "",
    b.effort || "",
    b.safety || "",
    b.track || "",
    b.prNumber ? `pr:${b.prNumber} #${b.prNumber}` : "",
    b.assignee || "",
  ]
    .join(" ")
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((tok) => hay.includes(tok));
}

function renderBeadRow(b: BeadSummary): string {
  const isSelected = selectedId === b.id;
  const isAttached = attachedId === b.id;
  const badges: string[] = [];
  badges.push(`<span class="pill prio-p${b.priority}">P${b.priority}</span>`);
  if (b.effort) badges.push(`<span class="pill">${esc(b.effort)}</span>`);
  if (b.safety) {
    badges.push(
      `<span class="pill safety-${esc(b.safety)}">${esc(b.safety)}</span>`,
    );
  }
  if (b.parent) {
    badges.push(`<span class="pill epic-ref">${esc(b.parent)}</span>`);
  }
  if (b.rework) badges.push(`<span class="pill danger">rework</span>`);
  if (b.humanOps) badges.push(`<span class="pill warning">human-ops</span>`);
  if (b.prNumber) {
    if (b.prUrl) {
      badges.push(
        `<button class="pill link-pill" data-open-url="${esc(b.prUrl)}" title="Open PR #${b.prNumber}">#${b.prNumber}</button>`,
      );
    } else {
      badges.push(`<span class="pill">#${b.prNumber}</span>`);
    }
  }
  if (b.verdict) {
    badges.push(
      `<span class="pill ${b.verdict === "go" ? "success" : "danger"}">${esc(b.verdict.toUpperCase())}</span>`,
    );
  }
  if (b.waits.length) {
    badges.push(
      `<span class="pill danger">waits: ${esc(b.waits.join(", "))}</span>`,
    );
  }
  if (isAttached) {
    badges.push(`<span class="pill attached">in chat</span>`);
  }

  return `
    <div class="bead-row ${isSelected ? "selected" : ""}" data-bead-id="${esc(b.id)}">
      <div class="bead-main">
        <span class="bead-id">${esc(b.id)}</span>
        <span class="bead-title">${esc(b.title)}</span>
      </div>
      <div class="bead-meta">${badges.join("")}</div>
    </div>
  `;
}

function renderBoardView(): string {
  if (!board?.sections) return "";
  const q = filterText.trim();
  return SECTIONS.map((sec) => {
    const allItems = board!.sections![sec.key];
    const items = q ? allItems.filter((b) => matchesFilter(b, q)) : allItems;
    const isCollapsed = !q && collapsed.has(sec.key);
    const totalCount =
      sec.key === "done" && board!.counts ? board!.counts.done : allItems.length;
    const countLabel = q ? `${items.length}/${totalCount}` : `${totalCount}`;
    return `
      <section class="board-section">
        <button class="section-header tone-${sec.tone}" data-toggle-section="${sec.key}">
          <span class="chev">${isCollapsed ? "▸" : "▾"}</span>
          <span class="section-label">${sec.label}</span>
          <span class="section-count">${countLabel}</span>
        </button>
        ${
          isCollapsed
            ? ""
            : items.length === 0
              ? `<div class="empty-row">${q ? "No matching beads" : "Empty"}</div>`
              : `<div class="section-list">${items.map(renderBeadRow).join("")}</div>`
        }
      </section>
    `;
  }).join("");
}

function formatEpicStateLabel(state: EpicNode["state"]): string {
  if (state === "in-progress") return "in progress";
  return state;
}

function renderDepRow(
  label: string,
  links: DepLink[],
  kind: "blocker" | "done" | "unlocks",
): string {
  if (!links.length) return "";
  const prefix = kind === "blocker" ? "↑ " : kind === "done" ? "✓ " : "↓ ";
  const chips = links
    .map((d) => {
      const tip = `${d.id} — ${d.title} (${formatEpicStateLabel(d.state)})${d.visible ? "" : " · click to reveal"}`;
      return `<button class="dep-chip dep-chip-${kind}" data-dep-target="${esc(d.id)}" title="${esc(tip)}">${prefix}${esc(d.id)}</button>`;
    })
    .join("");
  return `<div class="epic-deps-row"><span class="dep-label">${label}</span><div class="dep-chips">${chips}</div></div>`;
}

function renderEpicCard(ep: TechTreeNodeView): string {
  const pct = ep.totalCount
    ? Math.round((ep.closedCount / ep.totalCount) * 100)
    : 0;
  const isPinned = pinnedEpicId === ep.id;
  const trackPill =
    ep.track && ep.track !== "general"
      ? `<span class="pill">${esc(ep.track)}</span>`
      : "";
  const depsHtml = [
    renderDepRow("Needs", ep.activeBlockers, "blocker"),
    renderDepRow("After", ep.donePrereqs, "done"),
    renderDepRow("Unblocks", ep.unblocks, "unlocks"),
  ]
    .filter(Boolean)
    .join("");

  return `
    <div class="epic-card state-${ep.state} ${ep.onVisibleCriticalPath ? "critical" : ""} ${isPinned ? "pinned" : ""}" data-epic-node="${esc(ep.id)}" data-filter-epic="${esc(ep.id)}">
      <div class="epic-top">
        <span class="bead-id">${esc(ep.id)}</span>
        <span class="pill state-pill-${ep.state}">${esc(formatEpicStateLabel(ep.state))}</span>
        ${ep.onVisibleCriticalPath ? `<span class="pill warning">critical path</span>` : ""}
        ${trackPill}
        <button class="epic-inspect-btn" data-inspect-epic="${esc(ep.id)}" title="Open epic details">ℹ</button>
      </div>
      <div class="epic-title">${esc(ep.title)}</div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div class="epic-stats">
        <span>${ep.closedCount}/${ep.totalCount} closed (${pct}%)</span>
        ${ep.deliveredCount ? `<span>${ep.deliveredCount} delivered</span>` : ""}
        ${ep.wipCount ? `<span>${ep.wipCount} wip</span>` : ""}
      </div>
      ${depsHtml ? `<div class="epic-deps-wrap">${depsHtml}</div>` : ""}
    </div>
  `;
}

function renderTechTreeView(): string {
  const tree = board?.techTree;
  if (!tree) return "";
  if (tree.epics.length === 0) {
    lastTechTreeLayout = null;
    return `<div class="empty-state">No active epics with child beads found. Open loose beads: ${tree.looseOpen}.</div>`;
  }

  const layout = buildTechTreeLayout(tree.epics, tree.edges || [], {
    showCompleted: showCompletedEpics,
    filterText,
  });
  lastTechTreeLayout = layout;

  const toolbarHtml = `
    <div class="tree-toolbar">
      <div class="tree-counts">
        <span><strong>${layout.activeCount}</strong> active</span>
        <span><strong>${layout.completedCount}</strong> done</span>
        <span><strong>${tree.looseOpen}</strong> loose open</span>
      </div>
      ${
        layout.completedCount > 0 && !layout.hasFilter
          ? `<button class="toggle-pill ${showCompletedEpics ? "active" : ""}" id="toggle-completed-epics" title="Toggle completed historical epics">${showCompletedEpics ? "Showing" : "Show"} completed (${layout.completedCount})</button>`
          : ""
      }
    </div>
  `;

  const cycleWarningHtml = layout.cycleIds.length
    ? `<div class="tree-warning">Dependency cycle detected involving ${layout.cycleIds.map((id) => `<code>${esc(id)}</code>`).join(", ")}. Run <code>bd dep cycles</code> to fix wiring.</div>`
    : "";

  if (layout.visibleCount === 0) {
    const emptyBody = layout.hasFilter
      ? `<div class="empty-state">No epics match "${esc(filterText.trim())}".</div>`
      : `<div class="empty-state">All ${layout.completedCount} epics are completed.<div class="empty-action"><button class="btn btn-secondary" id="empty-show-completed">Show completed (${layout.completedCount})</button></div></div>`;
    return `${toolbarHtml}${cycleWarningHtml}${emptyBody}`;
  }

  let chainsHtml = "";
  if (layout.stages.length > 0) {
    const stagesHtml = layout.stages
      .map(
        (stage) => `
          <div class="stage-band" data-stage="${stage.index}">
            <div class="stage-head">
              <span class="stage-badge">${esc(stage.badge)}</span>
              <span class="stage-title">${esc(stage.title)}</span>
              <span class="stage-sub">${esc(stage.subtitle)}</span>
            </div>
            <div class="stage-cards">${stage.nodes.map(renderEpicCard).join("")}</div>
          </div>
        `,
      )
      .join("");

    chainsHtml = `
      <section class="dep-section">
        <div class="dep-section-head">
          <div>
            <div class="dep-section-title">Dependency Chains</div>
            <div class="dep-section-sub">Arrows flow blocker → unlocked · hover to trace lineage · click card to view beads</div>
          </div>
          ${
            pinnedEpicId
              ? `<button class="toggle-pill active" id="clear-pinned-epic">Clear trace ✕</button>`
              : ""
          }
        </div>
        <div class="dep-graph-well" id="dep-graph-well">
          <svg class="dep-edges-svg" id="dep-edges-base" aria-hidden="true"></svg>
          <div class="dep-stages">${stagesHtml}</div>
          <svg class="dep-edges-svg dep-edges-overlay" id="dep-edges-overlay" aria-hidden="true"></svg>
        </div>
      </section>
    `;
  }

  let independentHtml = "";
  if (layout.independent.length > 0) {
    const sub =
      layout.stages.length === 0 && !showCompletedEpics && !layout.hasFilter
        ? "No active cross-epic blockers — these can run in any order · click a card to view its beads"
        : layout.stages.length === 0
          ? "No cross-epic blocking dependencies between these epics · click a card to view its beads"
          : "No blocking links to the chains above — can run in parallel";
    independentHtml = `
      <section class="dep-section">
        <div class="dep-section-head">
          <div>
            <div class="dep-section-title">Independent Epics (${layout.independent.length})</div>
            <div class="dep-section-sub">${sub}</div>
          </div>
        </div>
        <div class="epic-grid">${layout.independent.map(renderEpicCard).join("")}</div>
      </section>
    `;
  }

  return `${toolbarHtml}${cycleWarningHtml}${chainsHtml}${independentHtml}`;
}

function buildEdgeSvgParts(
  well: HTMLElement,
  edges: EpicEdge[],
  layout: TechTreeLayout,
  nodeStates: Map<string, EpicNode["state"]>,
  focusEdgeKeys: Set<string> | null,
): { baseHtml: string; overlayHtml: string; width: number; height: number } {
  const wellRect = well.getBoundingClientRect();
  const width = Math.max(1, Math.round(wellRect.width));
  const height = Math.max(1, Math.round(wellRect.height));

  const cardRects = new Map<string, DOMRect>();
  well.querySelectorAll<HTMLElement>("[data-epic-node]").forEach((el) => {
    const id = el.dataset.epicNode;
    if (id) cardRects.set(id, el.getBoundingClientRect());
  });

  const baseParts: string[] = [];
  const overlayParts: string[] = [];

  for (const e of edges) {
    const ra = cardRects.get(e.from);
    const rb = cardRects.get(e.to);
    if (!ra || !rb) continue;

    const x1 = ra.left + ra.width / 2 - wellRect.left;
    const y1 = ra.bottom - wellRect.top;
    const x2 = rb.left + rb.width / 2 - wellRect.left;
    const y2 = rb.top - wellRect.top;

    const dy =
      y2 >= y1 - 4 ? Math.max(20, (y2 - y1) * 0.5) : Math.max(28, Math.abs(y2 - y1) * 0.4);
    const d = `M${x1.toFixed(1)},${y1.toFixed(1)} C${x1.toFixed(1)},${(y1 + dy).toFixed(1)} ${x2.toFixed(1)},${(y2 - dy).toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;

    const k = edgeKey(e.from, e.to);
    const isCritical = layout.criticalEdgeKeys.has(k);
    const bothDone =
      nodeStates.get(e.from) === "done" && nodeStates.get(e.to) === "done";
    const color = isCritical
      ? "var(--color-text-warning, #f59e0b)"
      : bothDone
        ? "var(--color-text-tertiary, #888)"
        : "var(--color-text-info, #38bdf8)";

    const arrowPts = `${x2.toFixed(1)},${y2.toFixed(1)} ${(x2 - 4).toFixed(1)},${(y2 - 7).toFixed(1)} ${(x2 + 4).toFixed(1)},${(y2 - 7).toFixed(1)}`;

    const inFocus = focusEdgeKeys ? focusEdgeKeys.has(k) : false;
    if (focusEdgeKeys && inFocus) {
      overlayParts.push(
        `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.2" opacity="0.95" stroke-linecap="round"/>`,
        `<polygon points="${arrowPts}" fill="${color}" opacity="0.95"/>`,
      );
    } else {
      const opacity = focusEdgeKeys ? "0.1" : bothDone ? "0.4" : "0.6";
      const strokeW = isCritical ? "2" : "1.6";
      baseParts.push(
        `<path d="${d}" fill="none" stroke="${color}" stroke-width="${strokeW}" opacity="${opacity}" stroke-linecap="round"/>`,
        `<polygon points="${arrowPts}" fill="${color}" opacity="${opacity}"/>`,
      );
    }
  }

  return {
    baseHtml: baseParts.join(""),
    overlayHtml: overlayParts.join(""),
    width,
    height,
  };
}

function bindTechTreeInteractions() {
  if (treeResizeObserver) {
    treeResizeObserver.disconnect();
    treeResizeObserver = null;
  }

  const toggleCompleted = () => {
    showCompletedEpics = !showCompletedEpics;
    if (!showCompletedEpics) pinnedEpicId = null;
    render();
  };
  document
    .getElementById("toggle-completed-epics")
    ?.addEventListener("click", toggleCompleted);
  document
    .getElementById("empty-show-completed")
    ?.addEventListener("click", () => {
      showCompletedEpics = true;
      render();
    });

  document
    .getElementById("clear-pinned-epic")
    ?.addEventListener("click", () => {
      pinnedEpicId = null;
      render();
    });

  rootEl.querySelectorAll<HTMLElement>("[data-inspect-epic]").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const id = btn.dataset.inspectEpic;
      if (id) void selectBead(id);
    });
  });

  const well = document.getElementById("dep-graph-well");
  const baseSvg = document.getElementById("dep-edges-base");
  const overlaySvg = document.getElementById("dep-edges-overlay");
  const layout = lastTechTreeLayout;

  const nodeStates = new Map<string, EpicNode["state"]>();
  for (const ep of board?.techTree?.epics ?? []) {
    nodeStates.set(ep.id, ep.state);
  }

  let hoveredId: string | null = null;
  let rafId: number | null = null;

  const paintGraph = () => {
    rafId = null;
    if (!well || !baseSvg || !overlaySvg || !layout) return;
    const focusId = hoveredId ?? pinnedEpicId;
    const lineage = focusId ? collectLineage(focusId, layout.drawnEdges) : null;

    well.classList.toggle("focusing", Boolean(lineage));
    well.querySelectorAll<HTMLElement>("[data-epic-node]").forEach((card) => {
      const id = card.dataset.epicNode || "";
      card.classList.toggle("in-lineage", Boolean(lineage?.nodes.has(id)));
      card.classList.toggle("pinned", pinnedEpicId === id);
    });

    const { baseHtml, overlayHtml, width, height } = buildEdgeSvgParts(
      well,
      layout.drawnEdges,
      layout,
      nodeStates,
      lineage ? lineage.edgeKeys : null,
    );
    for (const svg of [baseSvg, overlaySvg]) {
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      svg.setAttribute("width", String(width));
      svg.setAttribute("height", String(height));
    }
    baseSvg.innerHTML = baseHtml;
    overlaySvg.innerHTML = overlayHtml;
  };

  const schedulePaint = () => {
    if (rafId === null) rafId = window.requestAnimationFrame(paintGraph);
  };

  rootEl.querySelectorAll<HTMLElement>("[data-dep-target]").forEach((chip) => {
    chip.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const targetId = chip.dataset.depTarget;
      if (!targetId) return;

      const existing = rootEl.querySelector<HTMLElement>(
        `[data-epic-node="${CSS.escape(targetId)}"]`,
      );
      if (!existing && !showCompletedEpics) {
        showCompletedEpics = true;
        pinnedEpicId = targetId;
        render();
        window.requestAnimationFrame(() => {
          const revealed = rootEl.querySelector<HTMLElement>(
            `[data-epic-node="${CSS.escape(targetId)}"]`,
          );
          revealed?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
        return;
      }

      pinnedEpicId = pinnedEpicId === targetId ? null : targetId;
      existing?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (well) {
        schedulePaint();
      } else {
        render();
      }
    });
  });

  if (well && layout) {
    well.querySelectorAll<HTMLElement>("[data-epic-node]").forEach((card) => {
      const id = card.dataset.epicNode;
      if (!id) return;
      card.addEventListener("mouseenter", () => {
        hoveredId = id;
        schedulePaint();
      });
      card.addEventListener("mouseleave", () => {
        if (hoveredId === id) {
          hoveredId = null;
          schedulePaint();
        }
      });
    });

    well.addEventListener("click", (ev) => {
      const target = ev.target as HTMLElement | null;
      if (target && !target.closest("[data-epic-node]") && pinnedEpicId) {
        pinnedEpicId = null;
        render();
      }
    });

    if (typeof ResizeObserver !== "undefined") {
      treeResizeObserver = new ResizeObserver(schedulePaint);
      treeResizeObserver.observe(well);
    }
    schedulePaint();
  }
}

function renderDetailDrawer(): string {
  if (!selectedId) return "";
  if (detailLoading || !selectedDetail) {
    return `
      <aside class="detail-drawer">
        <div class="detail-header">
          <strong>${esc(selectedId)}</strong>
          <button class="icon-btn" data-close-detail="1" title="Close">✕</button>
        </div>
        <div class="detail-body">Loading details…</div>
      </aside>
    `;
  }

  const d = selectedDetail;
  const hostCaps = caps();
  const isAttached = attachedId === d.id;

  const actions: string[] = [];
  if (hostCaps.canContext) {
    actions.push(
      isAttached
        ? `<button class="btn btn-secondary" data-clear-context="1">Clear Context Pill</button>`
        : `<button class="btn btn-primary" data-attach-context="1">Attach to Chat</button>`,
    );
  }
  if (hostCaps.canMessage) {
    actions.push(
      `<button class="btn btn-secondary" data-deliver-bead="${esc(d.id)}">/deliver</button>`,
    );
    actions.push(
      `<button class="btn btn-secondary" data-explain-bead="${esc(d.id)}" title="Runs /explain-bead in a separate background conversation">Explain (bg)</button>`,
    );
  }
  if (d.prUrl && hostCaps.canOpenLinks) {
    actions.push(
      `<button class="btn btn-secondary" data-open-url="${esc(d.prUrl)}">PR #${d.prNumber} ↗</button>`,
    );
  }

  const filesHtml = d.files.length
    ? `
      <div class="detail-block">
        <div class="detail-label">Referenced Files (open in side pane)</div>
        <div class="chip-wrap">
          ${d.files
            .map(
              (f) =>
                `<button class="file-chip" data-open-file-uri="${esc(f.uri)}" data-open-file-rel="${esc(f.rel)}">${esc(f.rel)}</button>`,
            )
            .join("")}
        </div>
      </div>
    `
    : "";

  const depsHtml =
    d.dependencies.length || d.dependents.length
      ? `
      <div class="detail-block">
        ${
          d.dependencies.length
            ? `<div class="detail-label">Depends on</div>
               <ul class="dep-list">${d.dependencies
                 .map(
                   (dep) =>
                     `<li><button class="link-inline" data-jump-bead="${esc(dep.id)}">${esc(dep.id)}</button> <span class="muted">[${esc(dep.status)}]</span> ${esc(dep.title)}</li>`,
                 )
                 .join("")}</ul>`
            : ""
        }
        ${
          d.dependents.length
            ? `<div class="detail-label">Unblocks</div>
               <ul class="dep-list">${d.dependents
                 .map(
                   (dep) =>
                     `<li><button class="link-inline" data-jump-bead="${esc(dep.id)}">${esc(dep.id)}</button> <span class="muted">[${esc(dep.status)}]</span> ${esc(dep.title)}</li>`,
                 )
                 .join("")}</ul>`
            : ""
        }
      </div>
    `
      : "";

  return `
    <aside class="detail-drawer">
      <div class="detail-header">
        <div class="detail-title-wrap">
          <span class="bead-id">${esc(d.id)}</span>
          <span class="pill prio-p${d.priority}">P${d.priority}</span>
          <span class="pill">${esc(d.status)}</span>
          ${d.parent ? `<span class="pill epic-ref">${esc(d.parent)}</span>` : ""}
        </div>
        <button class="icon-btn" data-close-detail="1" title="Close">✕</button>
      </div>
      <div class="detail-sub">${esc(d.title)}</div>
      ${actions.length ? `<div class="detail-actions">${actions.join("")}</div>` : ""}
      <div class="detail-body">
        ${
          d.labels.length
            ? `<div class="chip-wrap">${d.labels.map((l) => `<span class="pill">${esc(l)}</span>`).join("")}</div>`
            : ""
        }
        ${filesHtml}
        ${depsHtml}
        ${
          d.description
            ? `<div class="detail-block"><div class="detail-label">Description</div><div class="detail-md">${renderMarkdown(d.description)}</div></div>`
            : ""
        }
        ${
          d.acceptanceCriteria
            ? `<div class="detail-block"><div class="detail-label">Acceptance Criteria</div><div class="detail-md">${renderMarkdown(d.acceptanceCriteria)}</div></div>`
            : ""
        }
        ${
          d.design
            ? `<div class="detail-block"><div class="detail-label">Design</div><div class="detail-md">${renderMarkdown(d.design)}</div></div>`
            : ""
        }
        ${
          d.notes
            ? `<div class="detail-block"><div class="detail-label">Notes</div><div class="detail-md">${renderMarkdown(d.notes)}</div></div>`
            : ""
        }
        ${
          d.comments?.length
            ? `<div class="detail-block">
                 <div class="detail-label">Comments (${d.comments.length})</div>
                 <div class="comment-list">
                   ${d.comments
                     .map((c) => {
                       const ts = formatShortTimestamp(c.createdAt);
                       const metaHtml =
                         c.author || ts
                           ? `<div class="comment-meta">${c.author ? `<span class="comment-author">${esc(c.author)}</span>` : ""}${ts ? `<span>${esc(ts)}</span>` : ""}</div>`
                           : "";
                       return `<div class="comment-item">${metaHtml}<div class="detail-md">${renderMarkdown(c.text)}</div></div>`;
                     })
                     .join("")}
                 </div>
               </div>`
            : ""
        }
        ${
          d.closeReason
            ? `<div class="detail-block"><div class="detail-label">Close Reason</div><div class="muted">${esc(d.closeReason)}</div></div>`
            : ""
        }
      </div>
    </aside>
  `;
}

function render() {
  if (!board) {
    rootEl.innerHTML = `<div class="empty-state">Loading Beads Board…</div>`;
    return;
  }

  const prevContentScroll =
    rootEl.querySelector<HTMLElement>(".content")?.scrollTop ?? 0;
  const prevDetailScroll =
    rootEl.querySelector<HTMLElement>(".detail-body")?.scrollTop ?? 0;
  const activeFilter =
    document.activeElement?.id === "filter-input"
      ? (document.activeElement as HTMLInputElement)
      : null;
  const filterSelStart = activeFilter?.selectionStart ?? null;
  const filterSelEnd = activeFilter?.selectionEnd ?? null;

  const projectOptions = (board.projects || [])
    .map(
      (p) =>
        `<option value="${esc(p.path)}" ${p.path === board!.project ? "selected" : ""}>${esc(p.name)} (${esc(p.shortPath)})</option>`,
    )
    .join("");

  const headerHtml = `
    <header class="topbar">
      <div class="topbar-row">
        <select class="project-select" id="project-select" title="Switch beads project">
          ${projectOptions || `<option value="${esc(board.project)}">${esc(board.projectName || board.project)}</option>`}
        </select>
        <div class="segmented">
          <button class="seg-btn ${view === "board" ? "active" : ""}" data-view="board">Board</button>
          <button class="seg-btn ${view === "techtree" ? "active" : ""}" data-view="techtree">Tech Tree</button>
        </div>
        <button class="icon-btn" id="refresh-btn" title="${esc(formatRefreshTooltip(board.refreshedAt))}" ${busy ? "disabled" : ""}>${busy ? "…" : "↻"}</button>
      </div>
      <div class="topbar-row">
        <input class="search-input" id="filter-input" type="search" placeholder="Filter by id, title, epic, effort, safety…" value="${esc(filterText)}" />
        ${
          filterText
            ? `<button class="icon-btn" id="clear-filter" title="Clear filter">✕</button>`
            : ""
        }
      </div>
    </header>
  `;

  const bodyHtml = !board.ok
    ? `<div class="error-box">${esc(board.error || "Unable to load beads")}</div>`
    : `<main class="content">${view === "board" ? renderBoardView() : renderTechTreeView()}</main>`;

  const toastHtml = toastMsg ? `<div class="toast">${esc(toastMsg)}</div>` : "";

  rootEl.innerHTML = `
    <div class="shell">
      ${headerHtml}
      ${bodyHtml}
      ${renderDetailDrawer()}
      ${toastHtml}
    </div>
  `;

  // Bind controls
  const selectEl = document.getElementById("project-select") as HTMLSelectElement | null;
  selectEl?.addEventListener("change", () => {
    void refreshBoard(selectEl.value);
  });

  const filterEl = document.getElementById("filter-input") as HTMLInputElement | null;
  if (filterEl) {
    filterEl.addEventListener("input", () => {
      const pos = filterEl.selectionStart;
      filterText = filterEl.value;
      render();
      const nextEl = document.getElementById("filter-input") as HTMLInputElement | null;
      if (nextEl) {
        nextEl.focus();
        if (pos !== null) nextEl.setSelectionRange(pos, pos);
      }
    });
  }

  document.getElementById("clear-filter")?.addEventListener("click", () => {
    filterText = "";
    render();
  });

  document.getElementById("refresh-btn")?.addEventListener("click", () => {
    void refreshBoard();
  });

  rootEl.querySelectorAll<HTMLElement>("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const nextView = btn.dataset.view as "board" | "techtree";
      if (nextView !== view) {
        view = nextView;
        void persistPrefs();
        render();
      }
    });
  });

  rootEl.querySelectorAll<HTMLElement>("[data-toggle-section]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.toggleSection!;
      if (collapsed.has(key)) collapsed.delete(key);
      else collapsed.add(key);
      void persistPrefs();
      render();
    });
  });

  rootEl.querySelectorAll<HTMLElement>("[data-open-url]").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const url = btn.dataset.openUrl;
      if (url) void openExternalUrl(url);
    });
  });

  rootEl.querySelectorAll<HTMLElement>("[data-bead-id]").forEach((row) => {
    row.addEventListener("click", () => {
      void selectBead(row.dataset.beadId!);
    });
  });

  rootEl.querySelectorAll<HTMLElement>("[data-filter-epic]").forEach((card) => {
    card.addEventListener("click", () => {
      filterText = card.dataset.filterEpic!;
      view = "board";
      void persistPrefs();
      render();
    });
  });

  rootEl.querySelector("[data-close-detail]")?.addEventListener("click", () => {
    selectedId = null;
    selectedDetail = null;
    render();
  });

  rootEl.querySelector("[data-attach-context]")?.addEventListener("click", () => {
    if (selectedDetail) void attachContext(selectedDetail);
  });

  rootEl.querySelector("[data-clear-context]")?.addEventListener("click", () => {
    void clearContext();
  });

  rootEl.querySelectorAll<HTMLElement>("[data-deliver-bead]").forEach((btn) => {
    btn.addEventListener("click", () => {
      void sendChatCommand(`/deliver ${btn.dataset.deliverBead!}`, false);
    });
  });

  rootEl.querySelectorAll<HTMLElement>("[data-explain-bead]").forEach((btn) => {
    btn.addEventListener("click", () => {
      void sendChatCommand(`/explain-bead ${btn.dataset.explainBead!}`, true);
    });
  });

  rootEl.querySelectorAll<HTMLElement>("[data-open-file-uri]").forEach((btn) => {
    btn.addEventListener("click", () => {
      void openWorkspaceFile(
        btn.dataset.openFileUri!,
        btn.dataset.openFileRel || "",
      );
    });
  });

  rootEl.querySelectorAll<HTMLElement>("[data-jump-bead]").forEach((btn) => {
    btn.addEventListener("click", () => {
      void selectBead(btn.dataset.jumpBead!);
    });
  });

  if (view === "techtree") {
    bindTechTreeInteractions();
  } else if (treeResizeObserver) {
    treeResizeObserver.disconnect();
    treeResizeObserver = null;
  }

  const nextContent = rootEl.querySelector<HTMLElement>(".content");
  if (nextContent && prevContentScroll > 0) {
    nextContent.scrollTop = prevContentScroll;
  }
  const nextDetail = rootEl.querySelector<HTMLElement>(".detail-body");
  if (nextDetail && prevDetailScroll > 0) {
    nextDetail.scrollTop = prevDetailScroll;
  }
  if (activeFilter) {
    const nextFilter = document.getElementById(
      "filter-input",
    ) as HTMLInputElement | null;
    if (nextFilter) {
      nextFilter.focus();
      if (filterSelStart !== null && filterSelEnd !== null) {
        nextFilter.setSelectionRange(filterSelStart, filterSelEnd);
      }
    }
  }
}

// Register handlers BEFORE connect() per MCP Apps lifecycle
app.ontoolinput = () => {
  render();
};

app.ontoolresult = (result) => {
  applyPayload(result.structuredContent as BoardPayload | undefined);
  autoRefresher.markRefreshed();
};

app.onhostcontextchanged = (ctx) => {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
};

await app.connect();
const initialCtx = app.getHostContext();
if (initialCtx?.theme) applyDocumentTheme(initialCtx.theme);
if (initialCtx?.styles?.variables) {
  applyHostStyleVariables(initialCtx.styles.variables);
}
render();

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    void autoRefresher.notifyVisible();
  }
});
window.addEventListener("focus", () => {
  void autoRefresher.notifyVisible();
});
autoRefresher.start();
