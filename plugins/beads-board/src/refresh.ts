/**
 * Visibility-aware auto-refresh helpers for the Beads Board MCP App.
 *
 * Keeps the board live (matching bdboard's 10s cadence) without jarring DOM
 * redraws when nothing changed or while the pane is hidden.
 */

export type FingerprintableBoard = {
  ok: boolean;
  error?: string;
  project: string;
  counts?: Record<string, number>;
  sections?: Record<string, unknown[]>;
  techTree?: unknown;
};

/**
 * Deterministic content fingerprint excluding volatile timestamps (`refreshedAt`)
 * and `projects`/`prefs`, so background polls skip re-rendering on no-op ticks.
 */
export function boardFingerprint(
  board: FingerprintableBoard | null | undefined,
): string {
  if (!board) return "";
  return JSON.stringify({
    ok: board.ok,
    error: board.error ?? null,
    project: board.project,
    counts: board.counts ?? null,
    sections: board.sections ?? null,
    techTree: board.techTree ?? null,
  });
}

/**
 * Decide whether an incoming board payload should replace the currently
 * rendered board. Prevents transient `bd` / Dolt lock errors during background
 * polling or same-project manual refreshes from wiping out a healthy board UI.
 */
export function shouldApplyBoardUpdate(
  current: Pick<FingerprintableBoard, "ok" | "project"> | null | undefined,
  incoming: Pick<FingerprintableBoard, "ok" | "project"> | null | undefined,
  opts: { isBackground?: boolean; isProjectSwitch?: boolean } = {},
): boolean {
  if (!incoming) return false;
  if (incoming.ok) return true;
  // Incoming payload failed: only replace the board if we don't already have a
  // healthy snapshot for the same project (e.g. initial load or project switch).
  if (!current || !current.ok) return true;
  if (opts.isProjectSwitch && incoming.project !== current.project) return true;
  return false;
}

/**
 * Look up a bead's summary record across all board sections for change detection.
 */
export function findBeadSummary<T extends { id: string }>(
  sections: Record<string, T[]> | undefined,
  id: string | null,
): T | null {
  if (!sections || !id) return null;
  for (const list of Object.values(sections)) {
    for (const item of list) {
      if (item.id === id) return item;
    }
  }
  return null;
}

export type AutoRefresherOptions = {
  intervalMs: number;
  focusCooldownMs: number;
  isVisible: () => boolean;
  canPoll: () => boolean;
  poll: () => Promise<void>;
  now?: () => number;
  setIntervalFn?: (fn: () => void, ms: number) => unknown;
  clearIntervalFn?: (handle: unknown) => void;
};

export type AutoRefresher = {
  start: () => void;
  stop: () => void;
  tick: () => Promise<boolean>;
  notifyVisible: () => Promise<boolean>;
  markRefreshed: () => void;
};

/**
 * Create a visibility-aware polling controller that:
 * - Polls every `intervalMs` only while visible and `canPoll()` is true
 * - Triggers an immediate refresh on visibility/focus return after `focusCooldownMs`
 * - Never overlaps concurrent poll calls
 */
export function createAutoRefresher(opts: AutoRefresherOptions): AutoRefresher {
  const now = opts.now ?? (() => Date.now());
  const setIntervalFn =
    opts.setIntervalFn ?? ((fn, ms) => globalThis.setInterval(fn, ms));
  const clearIntervalFn =
    opts.clearIntervalFn ??
    ((handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>));

  let timer: unknown = null;
  let inFlight = false;
  let lastRefreshAt = 0;

  async function runPoll(): Promise<boolean> {
    if (inFlight || !opts.isVisible() || !opts.canPoll()) return false;
    inFlight = true;
    try {
      await opts.poll();
      lastRefreshAt = now();
      return true;
    } catch {
      return false;
    } finally {
      inFlight = false;
    }
  }

  return {
    start() {
      if (timer !== null) return;
      timer = setIntervalFn(() => {
        void runPoll();
      }, opts.intervalMs);
    },
    stop() {
      if (timer !== null) {
        clearIntervalFn(timer);
        timer = null;
      }
    },
    async tick() {
      return runPoll();
    },
    async notifyVisible() {
      if (!opts.isVisible()) return false;
      if (lastRefreshAt > 0 && now() - lastRefreshAt < opts.focusCooldownMs) {
        return false;
      }
      return runPoll();
    },
    markRefreshed() {
      lastRefreshAt = now();
    },
  };
}
