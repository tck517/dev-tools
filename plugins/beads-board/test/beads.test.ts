import assert from "node:assert/strict";
import test from "node:test";
import { buildSnapshotFromRaw, parseBdJsonOutput } from "../src/beads.mjs";

test("separates deferred children in Board and Tech Tree so completed+deferred epics finish cleanly", () => {
  const raw = [
    { id: "ep-auth", title: "Epic: Accounts & Auth", status: "open", issue_type: "epic", priority: 1 },
    { id: "ep-shop", title: "Epic: Commerce", status: "open", issue_type: "epic", priority: 1 },
    // 16 closed + 6 deferred children under ep-auth
    ...Array.from({ length: 16 }, (_, i) => ({
      id: `ep-auth.${i + 1}`,
      title: `Closed task ${i + 1}`,
      status: "closed",
      issue_type: "task",
      parent: "ep-auth",
      priority: 2,
      closed_at: `2026-10-${String(i + 1).padStart(2, "0")}T12:00:00Z`,
    })),
    ...Array.from({ length: 6 }, (_, i) => ({
      id: `ep-auth.d${i + 1}`,
      title: `Deferred task ${i + 1}`,
      status: "deferred",
      issue_type: "task",
      parent: "ep-auth",
      priority: 3,
    })),
    // Active child in downstream epic blocked by a closed child of ep-auth
    {
      id: "ep-shop.1",
      title: "Checkout",
      status: "open",
      issue_type: "task",
      parent: "ep-shop",
      priority: 1,
      dependencies: [{ type: "blocks", depends_on_id: "ep-auth.1" }],
    },
  ];

  const snap = buildSnapshotFromRaw(raw, { projectPath: "/tmp/example" });

  assert.equal(snap.counts.deferred, 6);
  assert.equal(snap.sections.deferred.length, 6);
  assert.equal(snap.counts.done, 16);
  assert.equal(snap.sections.done.length, 16);

  const authEpic = snap.techTree.epics.find((e) => e.id === "ep-auth");
  const shopEpic = snap.techTree.epics.find((e) => e.id === "ep-shop");
  assert.ok(authEpic);
  assert.ok(shopEpic);

  assert.equal(authEpic.closedCount, 16);
  assert.equal(authEpic.totalCount, 16);
  assert.equal(authEpic.deferredCount, 6);
  assert.equal(authEpic.state, "done");

  // Downstream epic should no longer be blocked by ep-auth
  assert.equal(shopEpic.state, "ready");
  assert.deepEqual(shopEpic.blockedBy, []);
});

test("includes status=blocked beads in BLOCKED and preserves >120 closed beads for epic filtering", () => {
  const raw = [
    { id: "ep-old", title: "Older Epic", status: "open", issue_type: "epic", priority: 2 },
    // 250 newer closed beads
    ...Array.from({ length: 250 }, (_, i) => ({
      id: `new-${i + 1}`,
      title: `Recent done ${i + 1}`,
      status: "closed",
      issue_type: "task",
      priority: 2,
      closed_at: `2026-11-20T${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00Z`,
    })),
    // Older closed bead under ep-old
    {
      id: "ep-old.1",
      title: "Old epic work",
      status: "closed",
      issue_type: "task",
      parent: "ep-old",
      priority: 2,
      closed_at: "2026-01-05T00:00:00Z",
    },
    // Explicitly status: "blocked" bead
    {
      id: "blk-1",
      title: "Blocked directly",
      status: "blocked",
      issue_type: "task",
      priority: 1,
    },
  ];

  const snap = buildSnapshotFromRaw(raw, { projectPath: "/tmp/example" });

  assert.equal(snap.counts.done, 251);
  assert.equal(snap.sections.done.length, 251);
  assert.ok(snap.sections.done.some((b) => b.id === "ep-old.1"));
  assert.equal(snap.counts.blocked, 1);
  assert.equal(snap.sections.blocked[0].id, "blk-1");
});

test("respects maxDoneBytes budget for very large repositories", () => {
  const raw = Array.from({ length: 400 }, (_, i) => ({
    id: `done-${i + 1}`,
    title: `Closed bead with a moderately long title number ${i + 1}`,
    status: "closed",
    issue_type: "task",
    priority: 2,
    closed_at: `2026-11-01T00:00:${String(i % 60).padStart(2, "0")}Z`,
  }));

  const snap = buildSnapshotFromRaw(raw, {
    projectPath: "/tmp/example",
    maxDoneBytes: 5_000,
  });

  assert.equal(snap.counts.done, 400);
  assert.ok(snap.sections.done.length > 0 && snap.sections.done.length < 400);
  const doneBytes = Buffer.byteLength(JSON.stringify(snap.sections.done), "utf8");
  assert.ok(doneBytes <= 5_000);
});

test("parseBdJsonOutput sanitizes stray control characters in bead text", () => {
  const raw = '[{"id":"va-1","title":"hello\u0007world"}]';
  const parsed = parseBdJsonOutput(raw);
  assert.deepEqual(parsed, [{ id: "va-1", title: "hello world" }]);
  assert.equal(parseBdJsonOutput("not json"), null);
  assert.equal(parseBdJsonOutput(""), null);
});
