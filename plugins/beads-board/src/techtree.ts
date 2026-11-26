export type EpicState = "done" | "in-progress" | "blocked" | "ready";

export type EpicNode = {
  id: string;
  title: string;
  priority: number;
  track: string;
  tier: number;
  state: EpicState;
  onCriticalPath: boolean;
  closedCount: number;
  deliveredCount: number;
  wipCount: number;
  totalCount: number;
  blockedBy: string[];
  blocks: string[];
};

export type EpicEdge = {
  from: string;
  to: string;
};

export type DepLink = {
  id: string;
  title: string;
  state: EpicState;
  visible: boolean;
};

export type TechTreeNodeView = EpicNode & {
  visibleStage: number | null;
  onVisibleCriticalPath: boolean;
  activeBlockers: DepLink[];
  donePrereqs: DepLink[];
  unblocks: DepLink[];
};

export type TechTreeStage = {
  index: number;
  badge: string;
  title: string;
  subtitle: string;
  nodes: TechTreeNodeView[];
};

export type TechTreeLayout = {
  stages: TechTreeStage[];
  independent: TechTreeNodeView[];
  drawnEdges: EpicEdge[];
  criticalPath: string[];
  criticalEdgeKeys: Set<string>;
  cycleIds: string[];
  activeCount: number;
  completedCount: number;
  visibleCount: number;
  totalCount: number;
  hasFilter: boolean;
};

const STATE_ORDER: Record<EpicState, number> = {
  "in-progress": 0,
  ready: 1,
  blocked: 2,
  done: 3,
};

function byStatePriorityId(a: EpicNode, b: EpicNode): number {
  const sa = STATE_ORDER[a.state] ?? 9;
  const sb = STATE_ORDER[b.state] ?? 9;
  if (sa !== sb) return sa - sb;
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function matchesEpicFilter(ep: EpicNode, query: string): boolean {
  const hay = `${ep.id} ${ep.title} ${ep.track} ${ep.state}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((tok) => hay.includes(tok));
}

export function edgeKey(from: string, to: string): string {
  return `${from}->${to}`;
}

/**
 * Compute an understandable dependency layout over epic nodes and cross-epic
 * blocking edges:
 * - Hides completed (`done`) epics by default unless `showCompleted` is true or
 *   a search filter is active.
 * - Separates epics that participate in visible dependency chains from
 *   independent epics (no visible cross-epic blockers or dependents).
 * - Computes topological stages and transitive-reduced edges over the visible
 *   connected subgraph so stage numbers always reflect what is actually shown.
 * - Preserves full upstream/downstream provenance on every card, including
 *   completed prerequisites (`donePrereqs`), so placement is never opaque.
 */
export function buildTechTreeLayout(
  epics: EpicNode[],
  edges: EpicEdge[],
  opts: { showCompleted?: boolean; filterText?: string } = {},
): TechTreeLayout {
  const showCompleted = Boolean(opts.showCompleted);
  const query = (opts.filterText || "").trim();
  const hasFilter = query.length > 0;

  const byId = new Map<string, EpicNode>();
  for (const ep of epics) byId.set(ep.id, ep);

  const activeCount = epics.filter((e) => e.state !== "done").length;
  const completedCount = epics.length - activeCount;

  // When searching, search across all epics (including completed) so the user
  // can always locate historical work by id or title.
  const visibleEpics = epics.filter((ep) => {
    if (hasFilter) return matchesEpicFilter(ep, query);
    return showCompleted || ep.state !== "done";
  });
  const visibleIds = new Set(visibleEpics.map((e) => e.id));

  // Build full upstream/downstream maps from the complete edge list so cards
  // always show completed prerequisites and hidden links honestly.
  const allInto = new Map<string, string[]>();
  const allOut = new Map<string, string[]>();
  for (const ep of epics) {
    allInto.set(ep.id, []);
    allOut.set(ep.id, []);
  }
  const dedupedEdges: EpicEdge[] = [];
  const seenEdges = new Set<string>();
  for (const e of edges) {
    if (!byId.has(e.from) || !byId.has(e.to) || e.from === e.to) continue;
    const k = edgeKey(e.from, e.to);
    if (seenEdges.has(k)) continue;
    seenEdges.add(k);
    dedupedEdges.push(e);
    allOut.get(e.from)!.push(e.to);
    allInto.get(e.to)!.push(e.from);
  }
  for (const arr of allInto.values()) arr.sort();
  for (const arr of allOut.values()) arr.sort();

  // Edges strictly between currently visible epics.
  const visibleEdges = dedupedEdges.filter(
    (e) => visibleIds.has(e.from) && visibleIds.has(e.to),
  );

  // Partition visible epics into connected (participates in >=1 visible edge)
  // vs independent (no visible edges in either direction).
  const connectedIds = new Set<string>();
  for (const e of visibleEdges) {
    connectedIds.add(e.from);
    connectedIds.add(e.to);
  }

  const connectedList = [...connectedIds].sort();
  const out = new Map<string, string[]>(connectedList.map((id) => [id, []]));
  const into = new Map<string, string[]>(connectedList.map((id) => [id, []]));
  for (const e of visibleEdges) {
    out.get(e.from)!.push(e.to);
    into.get(e.to)!.push(e.from);
  }
  for (const arr of out.values()) arr.sort();
  for (const arr of into.values()) arr.sort();

  // Kahn topological sort on the visible connected subgraph.
  const indeg = new Map<string, number>(
    connectedList.map((id) => [id, into.get(id)!.length]),
  );
  const queue = connectedList.filter((id) => indeg.get(id) === 0).sort();
  const topo: string[] = [];
  while (queue.length) {
    queue.sort();
    const id = queue.shift()!;
    topo.push(id);
    for (const s of out.get(id)!) {
      indeg.set(s, indeg.get(s)! - 1);
      if (indeg.get(s) === 0) queue.push(s);
    }
  }
  const topoSet = new Set(topo);
  const cycleIds = connectedList.filter((id) => !topoSet.has(id)).sort();

  // Stage depth = longest path from a root in the visible connected subgraph.
  const stageOf = new Map<string, number>(connectedList.map((id) => [id, 0]));
  for (const id of topo) {
    for (const s of out.get(id)!) {
      stageOf.set(s, Math.max(stageOf.get(s)!, stageOf.get(id)! + 1));
    }
  }

  // Transitive reduction on visible edges so shortcut arrows (A->C when A->B->C)
  // do not clutter the diagram.
  const reach = new Map<string, Set<string>>();
  for (const id of [...topo].reverse()) {
    const r = new Set<string>();
    for (const s of out.get(id)!) {
      r.add(s);
      for (const rr of reach.get(s) ?? []) r.add(rr);
    }
    reach.set(id, r);
  }
  const drawnEdges = visibleEdges.filter((e) => {
    if (!topoSet.has(e.from) || !topoSet.has(e.to)) return true;
    for (const mid of out.get(e.from)!) {
      if (mid !== e.to && (reach.get(mid)?.has(e.to) ?? false)) return false;
    }
    return true;
  });

  // Critical path over visible connected epics (only highlighted if length >= 2).
  const longest = new Map<string, number>();
  const nextHop = new Map<string, string | null>();
  for (const id of [...topo].reverse()) {
    let best = 0;
    let bestSucc: string | null = null;
    for (const s of out.get(id)!) {
      const len = 1 + (longest.get(s) ?? 0);
      if (len > best || (len === best && bestSucc !== null && s < bestSucc)) {
        best = len;
        bestSucc = s;
      }
    }
    longest.set(id, best);
    nextHop.set(id, bestSucc);
  }
  let cpStart: string | null = null;
  for (const id of topo) {
    if (into.get(id)!.length > 0) continue;
    if (
      cpStart === null ||
      (longest.get(id) ?? 0) > (longest.get(cpStart) ?? 0) ||
      ((longest.get(id) ?? 0) === (longest.get(cpStart) ?? 0) && id < cpStart)
    ) {
      cpStart = id;
    }
  }
  const criticalPath: string[] = [];
  for (let id: string | null = cpStart; id; id = nextHop.get(id) ?? null) {
    criticalPath.push(id);
  }
  const cpSet = new Set(criticalPath.length >= 2 ? criticalPath : []);
  const criticalEdgeKeys = new Set<string>();
  if (criticalPath.length >= 2) {
    for (let i = 0; i < criticalPath.length - 1; i++) {
      criticalEdgeKeys.add(edgeKey(criticalPath[i], criticalPath[i + 1]));
    }
  }

  const toDepLink = (id: string): DepLink => {
    const ep = byId.get(id);
    return {
      id,
      title: ep?.title || id,
      state: ep?.state || "ready",
      visible: visibleIds.has(id),
    };
  };

  const toNodeView = (ep: EpicNode): TechTreeNodeView => {
    const upstream = (allInto.get(ep.id) ?? []).map(toDepLink);
    const activeBlockers = upstream.filter((d) => d.state !== "done");
    const donePrereqs = upstream.filter((d) => d.state === "done");
    const unblocks = (allOut.get(ep.id) ?? []).map(toDepLink);
    return {
      ...ep,
      visibleStage: connectedIds.has(ep.id) ? (stageOf.get(ep.id) ?? 0) : null,
      onVisibleCriticalPath: cpSet.has(ep.id),
      activeBlockers,
      donePrereqs,
      unblocks,
    };
  };

  // Group connected epics into ordered stages.
  const byStage = new Map<number, TechTreeNodeView[]>();
  for (const ep of visibleEpics) {
    if (!connectedIds.has(ep.id)) continue;
    const s = stageOf.get(ep.id) ?? 0;
    const list = byStage.get(s) ?? [];
    list.push(toNodeView(ep));
    byStage.set(s, list);
  }

  const stages: TechTreeStage[] = [...byStage.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, nodes]) => {
      nodes.sort(byStatePriorityId);
      const isRoot = index === 0;
      return {
        index,
        badge: `Stage ${index + 1}`,
        title: isRoot ? "Foundations" : "Downstream",
        subtitle: isRoot
          ? "No upstream blockers — starts a dependency chain"
          : `Unlocks after Stage ${index}`,
        nodes,
      };
    });

  const independent = visibleEpics
    .filter((ep) => !connectedIds.has(ep.id))
    .map(toNodeView)
    .sort(byStatePriorityId);

  return {
    stages,
    independent,
    drawnEdges,
    criticalPath: criticalPath.length >= 2 ? criticalPath : [],
    criticalEdgeKeys,
    cycleIds,
    activeCount,
    completedCount,
    visibleCount: visibleEpics.length,
    totalCount: epics.length,
    hasFilter,
  };
}

/**
 * BFS both directions from `targetId` across `edges` to find its full
 * upstream/downstream lineage for hover or pin highlighting.
 */
export function collectLineage(
  targetId: string,
  edges: EpicEdge[],
): { nodes: Set<string>; edgeKeys: Set<string> } {
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const e of edges) {
    if (!children.has(e.from)) children.set(e.from, []);
    children.get(e.from)!.push(e.to);
    if (!parents.has(e.to)) parents.set(e.to, []);
    parents.get(e.to)!.push(e.from);
  }

  const nodes = new Set<string>([targetId]);
  const upQueue = [targetId];
  while (upQueue.length) {
    const cur = upQueue.shift()!;
    for (const p of parents.get(cur) ?? []) {
      if (!nodes.has(p)) {
        nodes.add(p);
        upQueue.push(p);
      }
    }
  }
  const downQueue = [targetId];
  while (downQueue.length) {
    const cur = downQueue.shift()!;
    for (const c of children.get(cur) ?? []) {
      if (!nodes.has(c)) {
        nodes.add(c);
        downQueue.push(c);
      }
    }
  }

  const edgeKeys = new Set<string>();
  for (const e of edges) {
    if (nodes.has(e.from) && nodes.has(e.to)) {
      edgeKeys.add(edgeKey(e.from, e.to));
    }
  }

  return { nodes, edgeKeys };
}
