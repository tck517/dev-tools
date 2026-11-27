import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTechTreeLayout,
  collectLineage,
  edgeKey,
  type EpicEdge,
  type EpicNode,
} from "../src/techtree.ts";

function makeEpic(overrides: Partial<EpicNode> & { id: string }): EpicNode {
  return {
    title: `Epic ${overrides.id}`,
    priority: 2,
    track: "general",
    tier: 0,
    state: "ready",
    onCriticalPath: false,
    closedCount: 0,
    deliveredCount: 0,
    wipCount: 0,
    totalCount: 4,
    blockedBy: [],
    blocks: [],
    ...overrides,
  };
}

test("hides completed epics by default and keeps done prerequisites visible on active cards", () => {
  const epics: EpicNode[] = [
    makeEpic({ id: "ep-done", state: "done", closedCount: 4, totalCount: 4 }),
    makeEpic({ id: "ep-after", state: "ready", tier: 1 }),
    makeEpic({ id: "ep-standalone", state: "in-progress", wipCount: 1 }),
  ];
  const edges: EpicEdge[] = [{ from: "ep-done", to: "ep-after" }];

  const layout = buildTechTreeLayout(epics, edges, { showCompleted: false });

  assert.equal(layout.activeCount, 2);
  assert.equal(layout.completedCount, 1);
  assert.equal(layout.stages.length, 0);
  assert.deepEqual(
    layout.independent.map((n) => n.id),
    ["ep-standalone", "ep-after"],
  );
  const after = layout.independent.find((n) => n.id === "ep-after")!;
  assert.equal(after.activeBlockers.length, 0);
  assert.deepEqual(
    after.donePrereqs.map((d) => ({ id: d.id, visible: d.visible })),
    [{ id: "ep-done", visible: false }],
  );
});

test("separates connected chains into stages and keeps unlinked epics independent", () => {
  const epics: EpicNode[] = [
    makeEpic({ id: "a", state: "in-progress" }),
    makeEpic({ id: "b", state: "blocked" }),
    makeEpic({ id: "c", state: "blocked" }),
    makeEpic({ id: "solo", state: "ready" }),
  ];
  // Includes redundant transitive edge a -> c alongside a -> b -> c
  const edges: EpicEdge[] = [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
    { from: "a", to: "c" },
  ];

  const layout = buildTechTreeLayout(epics, edges, { showCompleted: false });

  assert.equal(layout.stages.length, 3);
  assert.equal(layout.stages[0].badge, "Stage 1");
  assert.equal(layout.stages[0].title, "Foundations");
  assert.deepEqual(
    layout.stages.map((s) => s.nodes.map((n) => n.id)),
    [["a"], ["b"], ["c"]],
  );
  assert.deepEqual(
    layout.independent.map((n) => n.id),
    ["solo"],
  );
  // Transitive reduction drops redundant a -> c
  assert.deepEqual(layout.drawnEdges, [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
  ]);
  assert.deepEqual(layout.criticalPath, ["a", "b", "c"]);
  assert.equal(layout.stages[0].nodes[0].onVisibleCriticalPath, true);
  assert.equal(layout.independent[0].onVisibleCriticalPath, false);
});

test("shows full historical dependency chains when showCompleted is true", () => {
  const epics: EpicNode[] = [
    makeEpic({ id: "p0-a", state: "done" }),
    makeEpic({ id: "p0-b", state: "done" }),
    makeEpic({ id: "p1-live", state: "done" }),
    makeEpic({ id: "p2-next", state: "ready" }),
    makeEpic({ id: "old-solo", state: "done" }),
  ];
  const edges: EpicEdge[] = [
    { from: "p0-a", to: "p0-b" },
    { from: "p1-live", to: "p2-next" },
  ];

  const layout = buildTechTreeLayout(epics, edges, { showCompleted: true });

  assert.equal(layout.stages.length, 2);
  assert.deepEqual(
    layout.stages[0].nodes.map((n) => n.id).sort(),
    ["p0-a", "p1-live"],
  );
  assert.deepEqual(
    layout.stages[1].nodes.map((n) => n.id).sort(),
    ["p0-b", "p2-next"],
  );
  assert.deepEqual(
    layout.independent.map((n) => n.id),
    ["old-solo"],
  );
  const p2 = layout.stages[1].nodes.find((n) => n.id === "p2-next")!;
  assert.equal(p2.donePrereqs[0].id, "p1-live");
  assert.equal(p2.donePrereqs[0].visible, true);
});

test("search filter matches completed epics even when showCompleted is false", () => {
  const epics: EpicNode[] = [
    makeEpic({ id: "bb-o7m5", title: "Web chat live demo", state: "done" }),
    makeEpic({ id: "bb-r6uv", title: "Staff takeover", state: "ready" }),
  ];
  const edges: EpicEdge[] = [{ from: "bb-o7m5", to: "bb-r6uv" }];

  const layout = buildTechTreeLayout(epics, edges, {
    showCompleted: false,
    filterText: "web chat",
  });

  assert.equal(layout.visibleCount, 1);
  assert.equal(layout.independent[0].id, "bb-o7m5");
});

test("collectLineage traces ancestors and descendants in both directions", () => {
  const edges: EpicEdge[] = [
    { from: "root", to: "mid" },
    { from: "mid", to: "leaf1" },
    { from: "mid", to: "leaf2" },
    { from: "other1", to: "other2" },
  ];

  const lineage = collectLineage("mid", edges);
  assert.deepEqual([...lineage.nodes].sort(), ["leaf1", "leaf2", "mid", "root"]);
  assert.equal(lineage.edgeKeys.has(edgeKey("root", "mid")), true);
  assert.equal(lineage.edgeKeys.has(edgeKey("mid", "leaf1")), true);
  assert.equal(lineage.edgeKeys.has(edgeKey("other1", "other2")), false);
});

test("reports cycles without throwing", () => {
  const epics: EpicNode[] = [
    makeEpic({ id: "x", state: "blocked" }),
    makeEpic({ id: "y", state: "blocked" }),
  ];
  const edges: EpicEdge[] = [
    { from: "x", to: "y" },
    { from: "y", to: "x" },
  ];

  const layout = buildTechTreeLayout(epics, edges, { showCompleted: false });
  assert.deepEqual(layout.cycleIds, ["x", "y"]);
  assert.equal(layout.stages.length, 1);
});
