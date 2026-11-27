import assert from "node:assert/strict";
import test from "node:test";
import {
  boardFingerprint,
  createAutoRefresher,
  findBeadSummary,
  type FingerprintableBoard,
} from "../src/refresh.ts";

function makeBoard(overrides: Partial<FingerprintableBoard> = {}): FingerprintableBoard {
  return {
    ok: true,
    project: "/repo/example",
    counts: { wip: 0, next: 1, dlv: 0, blocked: 0, done: 0, total: 1 },
    sections: {
      wip: [],
      next: [{ id: "ex-1", title: "Example", status: "open", updatedAt: "2026-11-27" }],
      dlv: [],
      blocked: [],
      done: [],
    },
    techTree: { epics: [], edges: [], criticalPath: [], looseOpen: 1 },
    ...overrides,
  };
}

test("boardFingerprint ignores volatile refreshedAt and detects real bead changes", () => {
  const a = { ...makeBoard(), refreshedAt: "2026-11-27T10:00:00Z" };
  const b = { ...makeBoard(), refreshedAt: "2026-11-27T10:00:10Z" };
  assert.equal(boardFingerprint(a), boardFingerprint(b));

  const claimed = makeBoard({
    counts: { wip: 1, next: 0, dlv: 0, blocked: 0, done: 0, total: 1 },
    sections: {
      wip: [{ id: "ex-1", title: "Example", status: "in_progress", updatedAt: "2026-11-27" }],
      next: [],
      dlv: [],
      blocked: [],
      done: [],
    },
  });
  assert.notEqual(boardFingerprint(a), boardFingerprint(claimed));
});

test("findBeadSummary locates a bead across sections", () => {
  const sections = {
    wip: [{ id: "va-1", status: "in_progress" }],
    dlv: [{ id: "va-2", status: "in_progress" }],
  };
  assert.deepEqual(findBeadSummary(sections, "va-2"), {
    id: "va-2",
    status: "in_progress",
  });
  assert.equal(findBeadSummary(sections, "missing"), null);
  assert.equal(findBeadSummary(sections, null), null);
});

test("createAutoRefresher skips hidden/blocked ticks, prevents overlap, and respects focus cooldown", async () => {
  let visible = false;
  let allowed = true;
  let clock = 1_000;
  let polls = 0;
  let releasePoll: (() => void) | null = null;
  let scheduledFn: (() => void) | null = null;
  let cleared = false;

  const refresher = createAutoRefresher({
    intervalMs: 10_000,
    focusCooldownMs: 3_000,
    isVisible: () => visible,
    canPoll: () => allowed,
    now: () => clock,
    setIntervalFn: (fn) => {
      scheduledFn = fn;
      return "timer-1";
    },
    clearIntervalFn: () => {
      cleared = true;
    },
    poll: async () => {
      polls++;
      if (releasePoll) {
        await new Promise<void>((resolve) => {
          const prev = releasePoll;
          releasePoll = () => {
            prev?.();
            resolve();
          };
        });
      }
    },
  });

  refresher.start();
  assert.ok(scheduledFn);

  // Hidden: skips poll
  assert.equal(await refresher.tick(), false);
  assert.equal(polls, 0);

  // Visible + allowed: polls immediately on focus/visibility
  visible = true;
  assert.equal(await refresher.notifyVisible(), true);
  assert.equal(polls, 1);

  // Focus again within cooldown: skipped
  clock += 1_500;
  assert.equal(await refresher.notifyVisible(), false);
  assert.equal(polls, 1);

  // Focus after cooldown: polls again
  clock += 2_000;
  assert.equal(await refresher.notifyVisible(), true);
  assert.equal(polls, 2);

  // canPoll() false: skipped
  allowed = false;
  assert.equal(await refresher.tick(), false);
  assert.equal(polls, 2);

  // Prevent overlapping concurrent polls
  allowed = true;
  let finishInFlight!: () => void;
  const blockingRefresher = createAutoRefresher({
    intervalMs: 10_000,
    focusCooldownMs: 3_000,
    isVisible: () => true,
    canPoll: () => true,
    now: () => clock,
    poll: () =>
      new Promise<void>((resolve) => {
        polls++;
        finishInFlight = resolve;
      }),
  });
  const first = blockingRefresher.tick();
  const second = blockingRefresher.tick();
  assert.equal(await second, false);
  finishInFlight();
  assert.equal(await first, true);
  assert.equal(polls, 3);

  refresher.stop();
  assert.equal(cleared, true);
});
