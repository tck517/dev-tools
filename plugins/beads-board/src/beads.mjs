import { execFileSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

const EXEC_ENV = {
  ...process.env,
  PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || "/usr/bin:/bin"}`,
};
const BD_TIMEOUT_MS = 12_000;
const DELIVERED_LABELS = new Set(
  (process.env.BDBOARD_DELIVERED_LABELS || "committed,in-review")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

function execText(cmd, args, cwd) {
  try {
    return execFileSync(cmd, args, {
      cwd,
      env: EXEC_ENV,
      encoding: "utf8",
      timeout: BD_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

function bdJson(args, cwd) {
  const out = execText("bd", [...args, "--json"], cwd);
  if (!out) return null;
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

export function repoUrlFromOrigin(remote) {
  if (!remote) return null;
  const m = /github\.com[:/]([^/]+)\/([^/\s]+?)(?:\.git)?$/.exec(remote.trim());
  return m ? `https://github.com/${m[1]}/${m[2]}` : null;
}

export function discoverProjects() {
  const home = homedir();
  const seen = new Map();
  const add = (dir) => {
    if (!dir) return;
    let abs = resolve(dir.replace(/^~/, home));
    if (!existsSync(join(abs, ".beads"))) return;
    try {
      abs = realpathSync(abs);
    } catch {
      // keep resolved path
    }
    const key = abs.toLowerCase();
    if (seen.has(key)) return;
    seen.set(key, {
      path: abs,
      name: basename(abs),
      shortPath: abs.startsWith(home) ? `~${abs.slice(home.length)}` : abs,
    });
  };

  // Prioritize default project + bdboard recent file
  if (process.env.BDBOARD_DEFAULT_PROJECT) {
    add(process.env.BDBOARD_DEFAULT_PROJECT);
  }

  const recentFile = join(
    process.env.XDG_STATE_HOME || join(home, ".local/state"),
    "bdboard/recent",
  );
  if (existsSync(recentFile)) {
    try {
      for (const line of readFileSync(recentFile, "utf8").split(/\r?\n/)) {
        if (line.trim()) add(line.trim());
      }
    } catch {
      // ignore
    }
  }

  const roots = (
    process.env.BDBOARD_ROOTS ||
    `${home}/projects:${home}/Projects:${home}/src:${home}/code`
  )
    .split(":")
    .filter(Boolean);

  const walk = (dir, depth) => {
    if (depth > 3 || !existsSync(dir)) return;
    if (existsSync(join(dir, ".beads"))) {
      add(dir);
      return;
    }
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name.startsWith(".") || name === "node_modules" || name === "dist") {
        continue;
      }
      const next = join(dir, name);
      try {
        if (statSync(next).isDirectory()) walk(next, depth + 1);
      } catch {
        // ignore unreadable entries
      }
    }
  };

  for (const r of roots) walk(r, 0);
  return [...seen.values()];
}

function byPriorityThenId(a, b) {
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function parseMeta(labels) {
  const meta = {
    effort: null,
    safety: null,
    verdict: null,
    prNumber: null,
    commits: [],
    track: null,
    campaign: null,
    delivered: false,
    rework: false,
    humanOps: false,
  };
  for (const l of labels) {
    if (DELIVERED_LABELS.has(l)) meta.delivered = true;
    if (l === "rework") meta.rework = true;
    if (l === "human-ops") meta.humanOps = true;
    if (l.startsWith("effort:")) meta.effort = l.slice(7);
    else if (l.startsWith("safety:")) meta.safety = l.slice(7);
    else if (l.startsWith("verdict:")) meta.verdict = l.slice(8);
    else if (l.startsWith("track:")) meta.track = l.slice(6);
    else if (l.startsWith("campaign:")) meta.campaign = l.slice(9);
    else if (l.startsWith("commit:")) meta.commits.push(l.slice(7));
    else if (l.startsWith("pr:")) {
      const n = Number.parseInt(l.slice(3), 10);
      if (Number.isFinite(n) && (meta.prNumber === null || n > meta.prNumber)) {
        meta.prNumber = n;
      }
    }
  }
  if (meta.rework) meta.delivered = false;
  return meta;
}

function buildEpicTree(items) {
  const epics = new Map();
  const childrenByEpic = new Map();
  for (const b of items) {
    if (b.issueType === "epic") {
      epics.set(b.id, b);
      childrenByEpic.set(b.id, []);
    }
  }

  let looseOpen = 0;
  const beadToEpic = new Map();
  for (const b of items) {
    if (b.issueType === "epic") continue;
    if (b.parent && childrenByEpic.has(b.parent)) {
      childrenByEpic.get(b.parent).push(b);
      beadToEpic.set(b.id, b.parent);
    } else if (b.status === "open" || b.status === "in_progress") {
      looseOpen++;
    }
  }

  const activeIds = [...childrenByEpic.entries()]
    .filter(([, kids]) => kids.length > 0)
    .map(([id]) => id)
    .sort();

  if (!activeIds.length) {
    return { epics: [], edges: [], criticalPath: [], looseOpen };
  }

  const edgeSet = new Set();
  for (const b of items) {
    if (b.issueType === "epic") continue;
    const toEpic = beadToEpic.get(b.id);
    if (!toEpic) continue;
    for (const d of b.rawDeps) {
      if (d.type !== "blocks") continue;
      const fromEpic = beadToEpic.get(d.depends_on_id);
      if (fromEpic && fromEpic !== toEpic) edgeSet.add(`${fromEpic}->${toEpic}`);
    }
  }
  const edges = [...edgeSet]
    .sort()
    .map((k) => {
      const [from, to] = k.split("->");
      return { from, to };
    });

  const out = new Map(activeIds.map((id) => [id, []]));
  const into = new Map(activeIds.map((id) => [id, []]));
  for (const e of edges) {
    out.get(e.from)?.push(e.to);
    into.get(e.to)?.push(e.from);
  }

  // Kahn topological order + tiers
  const indeg = new Map(activeIds.map((id) => [id, into.get(id).length]));
  const q = activeIds.filter((id) => indeg.get(id) === 0).sort();
  const topo = [];
  while (q.length) {
    q.sort();
    const id = q.shift();
    topo.push(id);
    for (const s of out.get(id)) {
      indeg.set(s, indeg.get(s) - 1);
      if (indeg.get(s) === 0) q.push(s);
    }
  }

  const tier = new Map(activeIds.map((id) => [id, 0]));
  for (const id of topo) {
    for (const s of out.get(id)) {
      tier.set(s, Math.max(tier.get(s), tier.get(id) + 1));
    }
  }

  // Critical path
  const longest = new Map();
  const nextHop = new Map();
  for (const id of [...topo].reverse()) {
    let best = 0;
    let bestSucc = null;
    for (const s of [...out.get(id)].sort()) {
      const len = 1 + (longest.get(s) ?? 0);
      if (len > best || (len === best && bestSucc !== null && s < bestSucc)) {
        best = len;
        bestSucc = s;
      }
    }
    longest.set(id, best);
    nextHop.set(id, bestSucc);
  }
  let start = null;
  for (const id of topo) {
    if (into.get(id).length > 0) continue;
    if (
      start === null ||
      longest.get(id) > longest.get(start) ||
      (longest.get(id) === longest.get(start) && id < start)
    ) {
      start = id;
    }
  }
  const criticalPath = [];
  for (let id = start; id; id = nextHop.get(id)) criticalPath.push(id);
  const cpSet = new Set(criticalPath);

  const epicRawState = new Map();
  for (const eid of activeIds) {
    const kids = childrenByEpic.get(eid);
    const closedCount = kids.filter((k) => k.status === "closed").length;
    const deliveredCount = kids.filter((k) => k.status !== "closed" && k.delivered).length;
    const wipCount = kids.filter(
      (k) => k.status === "in_progress" && !k.delivered,
    ).length;
    if (closedCount === kids.length) epicRawState.set(eid, "done");
    else if (wipCount > 0 || deliveredCount > 0) epicRawState.set(eid, "in-progress");
    else epicRawState.set(eid, "pending");
  }

  const epicNodes = activeIds
    .map((eid) => {
      const eb = epics.get(eid);
      const kids = childrenByEpic.get(eid);
      const closedCount = kids.filter((k) => k.status === "closed").length;
      const deliveredCount = kids.filter((k) => k.status !== "closed" && k.delivered).length;
      const wipCount = kids.filter(
        (k) => k.status === "in_progress" && !k.delivered,
      ).length;
      const raw = epicRawState.get(eid);
      const blockers = into.get(eid).filter((src) => epicRawState.get(src) !== "done");
      const state = raw === "pending" ? (blockers.length ? "blocked" : "ready") : raw;
      return {
        id: eid,
        title: eb?.title || eid,
        priority: eb?.priority ?? 2,
        track: eb?.track || "general",
        tier: tier.get(eid) ?? 0,
        state,
        onCriticalPath: cpSet.has(eid),
        closedCount,
        deliveredCount,
        wipCount,
        totalCount: kids.length,
        blockedBy: blockers,
        blocks: out.get(eid),
      };
    })
    .sort((a, b) => a.tier - b.tier || byPriorityThenId(a, b));

  return { epics: epicNodes, edges, criticalPath, looseOpen };
}

export function loadBoardSnapshot(projectPath) {
  const abs = resolve(projectPath);
  if (!existsSync(join(abs, ".beads"))) {
    return {
      ok: false,
      error: `No .beads directory found at ${abs}`,
      project: abs,
    };
  }

  const rawList = bdJson(["list", "--status", "all", "--limit", "0"], abs);
  if (!Array.isArray(rawList)) {
    return {
      ok: false,
      error: `Failed to run 'bd list --status all --limit 0 --json' in ${abs}`,
      project: abs,
    };
  }

  const repoUrl = repoUrlFromOrigin(
    execText("git", ["remote", "get-url", "origin"], abs),
  );

  // Build normalized items matching bdboard semantics
  const normalized = rawList.map((r) => {
    const labels = r.labels || [];
    const meta = parseMeta(labels);
    return {
      id: r.id,
      title: r.title || "",
      status: r.status || "open",
      priority: typeof r.priority === "number" ? r.priority : 2,
      issueType: r.issue_type || "task",
      parent: r.parent || null,
      assignee: r.assignee || null,
      labels,
      updatedAt: r.updated_at || null,
      closedAt: r.closed_at || null,
      rawDeps: r.dependencies || [],
      ...meta,
    };
  });

  // A blocker is cleared once closed OR delivered (same rule as bdboard)
  const cleared = new Map(
    normalized.map((b) => [b.id, b.status === "closed" || b.delivered]),
  );

  const withWaits = normalized.map((b) => {
    const waits = b.rawDeps
      .filter((d) => d.type === "blocks" && !cleared.get(d.depends_on_id))
      .map((d) => d.depends_on_id);
    return { ...b, waits };
  });

  const slim = (b) => ({
    id: b.id,
    title: b.title,
    status: b.status,
    priority: b.priority,
    issueType: b.issueType,
    parent: b.parent,
    assignee: b.assignee,
    effort: b.effort,
    safety: b.safety,
    verdict: b.verdict,
    prNumber: b.prNumber,
    prUrl: b.prNumber && repoUrl ? `${repoUrl}/pull/${b.prNumber}` : null,
    commits: b.commits.slice(0, 3),
    track: b.track,
    rework: b.rework,
    humanOps: b.humanOps,
    waits: b.waits,
    updatedAt: b.updatedAt ? b.updatedAt.slice(0, 10) : null,
    closedAt: b.closedAt ? b.closedAt.slice(0, 10) : null,
  });

  const wip = withWaits
    .filter((b) => b.status === "in_progress" && !b.delivered)
    .sort(byPriorityThenId)
    .map(slim);

  const openNonEpic = withWaits
    .filter((b) => b.status === "open" && b.issueType !== "epic")
    .sort(byPriorityThenId);

  const next = openNonEpic.filter((b) => b.waits.length === 0).map(slim);
  const blocked = openNonEpic.filter((b) => b.waits.length > 0).map(slim);

  const dlv = withWaits
    .filter((b) => b.status === "in_progress" && b.delivered)
    .sort(byPriorityThenId)
    .map(slim);

  // Cap DONE list to most recent 120 so payload stays snappy & well under 1 MiB
  const allDone = withWaits
    .filter((b) => b.status === "closed")
    .sort((a, b) => {
      const ta = a.closedAt || a.updatedAt || "";
      const tb = b.closedAt || b.updatedAt || "";
      if (ta !== tb) return ta < tb ? 1 : -1;
      return a.id < b.id ? -1 : 1;
    });
  const doneTotal = allDone.length;
  const done = allDone.slice(0, 120).map(slim);

  const techTree = buildEpicTree(normalized);

  const home = homedir();
  return {
    ok: true,
    project: abs,
    projectName: basename(abs),
    projectShort: abs.startsWith(home) ? `~${abs.slice(home.length)}` : abs,
    repoUrl,
    refreshedAt: new Date().toISOString(),
    counts: {
      wip: wip.length,
      next: next.length,
      dlv: dlv.length,
      blocked: blocked.length,
      done: doneTotal,
      total: normalized.length,
    },
    sections: { wip, next, dlv, blocked, done },
    techTree,
  };
}

/** Extract repo-relative file paths from bead text that exist on disk. */
function extractExistingFiles(projectPath, text) {
  if (!text) return [];
  const regex =
    /(?:^|[\s`"'(\[])((?:app|components|lib|scripts|docs|studio|supabase|features|__tests__|\.agents|\.claude|\.github)\/[A-Za-z0-9._/@-]+\.[A-Za-z0-9]+|AGENTS\.md|CLAUDE\.md|package\.json|next\.config\.[a-z]+|render\.yaml)/gm;
  const found = new Set();
  let m;
  while ((m = regex.exec(text)) !== null) {
    const rel = m[1].replace(/[),.:;]+$/, "");
    const abs = resolve(projectPath, rel);
    if (abs.startsWith(resolve(projectPath)) && existsSync(abs)) {
      found.add(rel);
      if (found.size >= 16) break;
    }
  }
  return [...found].map((rel) => ({
    rel,
    uri: `file://${resolve(projectPath, rel)}`,
  }));
}

export function loadBeadDetail(projectPath, id) {
  const abs = resolve(projectPath);
  if (!id || !/^[A-Za-z0-9._-]+$/.test(id)) {
    return { ok: false, error: `Invalid bead id: ${id}` };
  }
  const shown =
    bdJson(["show", id, "--include-comments"], abs) ??
    bdJson(["show", id], abs);
  const raw = Array.isArray(shown) ? shown[0] : shown;
  if (!raw) {
    return { ok: false, error: `Bead ${id} not found in ${abs}` };
  }

  const repoUrl = repoUrlFromOrigin(
    execText("git", ["remote", "get-url", "origin"], abs),
  );
  const labels = raw.labels || [];
  const meta = parseMeta(labels);

  const comments = Array.isArray(raw.comments)
    ? raw.comments
        .map((c, idx) => ({
          id: String(c?.id ?? idx),
          author: typeof c?.author === "string" ? c.author : "",
          text:
            typeof c?.text === "string"
              ? c.text
              : typeof c?.body === "string"
                ? c.body
                : "",
          createdAt: typeof c?.created_at === "string" ? c.created_at : null,
        }))
        .filter((c) => c.text.trim().length > 0)
    : [];

  const combinedText = [
    raw.description || "",
    raw.acceptance_criteria || "",
    raw.design || "",
    raw.notes || "",
    ...comments.map((c) => c.text),
  ].join("\n");
  const files = extractExistingFiles(abs, combinedText);

  const prUrl =
    meta.prNumber && repoUrl ? `${repoUrl}/pull/${meta.prNumber}` : null;

  // Build concise plain-text context block for app.updateModelContext
  const ctxLines = [
    `Bead ${raw.id}: ${raw.title}`,
    `Project: ${abs}`,
    `Status: ${raw.status} | Priority: P${raw.priority ?? 2} | Type: ${raw.issue_type || "task"}${raw.parent ? ` | Epic: ${raw.parent}` : ""}`,
  ];
  if (labels.length) ctxLines.push(`Labels: ${labels.join(", ")}`);
  if (prUrl) ctxLines.push(`PR: #${meta.prNumber} (${prUrl})`);
  if (raw.description) ctxLines.push("", "Description:", raw.description);
  if (raw.acceptance_criteria) {
    ctxLines.push("", "Acceptance Criteria:", raw.acceptance_criteria);
  }
  if (raw.notes) ctxLines.push("", "Notes:", raw.notes);
  if (raw.dependencies?.length) {
    ctxLines.push(
      "",
      "Depends on:",
      ...raw.dependencies.map(
        (d) => `- ${d.id} [${d.status}] (${d.dependency_type}): ${d.title}`,
      ),
    );
  }
  if (raw.dependents?.length) {
    ctxLines.push(
      "",
      "Unblocks:",
      ...raw.dependents.map(
        (d) => `- ${d.id} [${d.status}] (${d.dependency_type}): ${d.title}`,
      ),
    );
  }

  return {
    ok: true,
    bead: {
      id: raw.id,
      title: raw.title || "",
      status: raw.status || "open",
      priority: raw.priority ?? 2,
      issueType: raw.issue_type || "task",
      parent: raw.parent || null,
      assignee: raw.assignee || null,
      labels,
      description: raw.description || "",
      acceptanceCriteria: raw.acceptance_criteria || "",
      design: raw.design || "",
      notes: raw.notes || "",
      comments,
      closeReason: raw.close_reason || "",
      updatedAt: raw.updated_at || null,
      closedAt: raw.closed_at || null,
      dependencies: (raw.dependencies || []).map((d) => ({
        id: d.id,
        title: d.title,
        status: d.status,
        type: d.dependency_type,
      })),
      dependents: (raw.dependents || []).map((d) => ({
        id: d.id,
        title: d.title,
        status: d.status,
        type: d.dependency_type,
      })),
      prNumber: meta.prNumber,
      prUrl,
      files,
      contextText: ctxLines.join("\n"),
    },
  };
}
