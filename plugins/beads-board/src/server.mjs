import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  discoverProjects,
  loadBeadDetail,
  loadBoardSnapshot,
} from "./beads.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, "..");
const APP_URI = "ui://beads-board/app.html";

function parseDataDir(argv) {
  for (const arg of argv) {
    if (arg.startsWith("--data_dir=")) return arg.slice("--data_dir=".length);
  }
  return join(PLUGIN_ROOT, ".data");
}

const DATA_DIR = parseDataDir(process.argv.slice(2));
const PREFS_FILE = join(DATA_DIR, "prefs.json");

function readPrefs() {
  try {
    if (existsSync(PREFS_FILE)) {
      return JSON.parse(readFileSync(PREFS_FILE, "utf8"));
    }
  } catch {
    // ignore corrupt prefs
  }
  return { project: null, collapsed: ["done"], view: "board" };
}

function writePrefs(patch) {
  const next = { ...readPrefs(), ...patch };
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(PREFS_FILE, JSON.stringify(next, null, 2));
  } catch {
    // best-effort persistence
  }
  return next;
}

function resolveProject(requested, projects, prefs) {
  if (requested && existsSync(join(resolve(requested), ".beads"))) {
    return resolve(requested);
  }
  if (prefs.project && existsSync(join(resolve(prefs.project), ".beads"))) {
    return resolve(prefs.project);
  }
  if (projects.length > 0) return projects[0].path;
  return requested || process.env.BDBOARD_DEFAULT_PROJECT || process.cwd();
}

function buildBoardResponse(args = {}) {
  const projects = discoverProjects();
  const prefs = readPrefs();
  const project = resolveProject(args.project, projects, prefs);
  const view = args.view === "techtree" || args.view === "board"
    ? args.view
    : prefs.view || "board";
  const filter = typeof args.filter === "string" ? args.filter : "";

  if (args.project || args.view) {
    writePrefs({ project, view });
  }

  const snapshot = loadBoardSnapshot(project);
  const structuredContent = {
    ...snapshot,
    projects,
    prefs: {
      view,
      filter,
      collapsed: Array.isArray(prefs.collapsed) ? prefs.collapsed : ["done"],
    },
  };

  const summary = snapshot.ok
    ? `Beads Board (${snapshot.projectName}): ${snapshot.counts.wip} in process, ${snapshot.counts.next} up next, ${snapshot.counts.dlv} delivered, ${snapshot.counts.blocked} blocked, ${snapshot.counts.done} done (${snapshot.techTree.epics.length} active epics).`
    : `Beads Board error: ${snapshot.error}`;

  return {
    content: [{ type: "text", text: summary }],
    structuredContent,
    isError: !snapshot.ok,
  };
}

const server = new Server(
  { name: "beads-board", version: "1.0.0" },
  { capabilities: { tools: {}, resources: {} } },
);

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: APP_URI,
      name: "Beads Board",
      description:
        "Interactive Beads (bd) board and Epic Tech Tree side pane app.",
      mimeType: "text/html;profile=mcp-app",
      _meta: { ui: { prefersBorder: false } },
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  if (request.params.uri !== APP_URI) {
    throw new Error(`Unknown resource: ${request.params.uri}`);
  }
  const htmlPath =
    process.env.BEADS_BOARD_APP_HTML || join(PLUGIN_ROOT, "dist/app.html");
  const html = readFileSync(htmlPath, "utf8");
  return {
    contents: [
      {
        uri: APP_URI,
        mimeType: "text/html;profile=mcp-app",
        text: html,
        _meta: { ui: { prefersBorder: false } },
      },
    ],
  };
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "open_beads_board",
      title: "Beads Board",
      description:
        "Open the interactive Beads Board (bdboard sections + Epic Tech Tree) in the side pane.",
      inputSchema: {
        type: "object",
        properties: {
          project: {
            type: "string",
            description: "Optional absolute path to a repo containing .beads/",
          },
          view: {
            type: "string",
            enum: ["board", "techtree"],
            description: "Initial view mode (default: board)",
          },
          filter: {
            type: "string",
            description: "Optional initial search/filter query",
          },
        },
      },
      _meta: {
        ui: { resourceUri: APP_URI },
        "com.google.antigravity/ui": {
          entrypoints: [
            { type: "aux_pane", title: "Beads Board" },
            { type: "global", title: "Beads Board" },
          ],
        },
      },
    },
    {
      name: "beads_board_refresh",
      title: "Refresh Beads Board",
      description: "Reload live bd state for a beads project (app-only).",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string" },
          view: { type: "string", enum: ["board", "techtree"] },
        },
      },
      _meta: { ui: { visibility: ["app"] } },
    },
    {
      name: "beads_board_detail",
      title: "Load Bead Detail",
      description:
        "Hydrate full bead description, notes, dependencies, PR link, and referenced workspace files (app-only).",
      inputSchema: {
        type: "object",
        required: ["project", "id"],
        properties: {
          project: { type: "string" },
          id: { type: "string" },
        },
      },
      _meta: { ui: { visibility: ["app"] } },
    },
    {
      name: "beads_board_save_prefs",
      title: "Save Board Preferences",
      description: "Persist view mode, selected project, and folded sections (app-only).",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string" },
          view: { type: "string", enum: ["board", "techtree"] },
          collapsed: { type: "array", items: { type: "string" } },
        },
      },
      _meta: { ui: { visibility: ["app"] } },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  if (name === "open_beads_board" || name === "beads_board_refresh") {
    return buildBoardResponse(args);
  }
  if (name === "beads_board_detail") {
    const detail = loadBeadDetail(args.project, args.id);
    return {
      content: [
        {
          type: "text",
          text: detail.ok ? detail.bead.contextText : detail.error,
        },
      ],
      structuredContent: detail,
      isError: !detail.ok,
    };
  }
  if (name === "beads_board_save_prefs") {
    const patch = {};
    if (typeof args.project === "string") patch.project = args.project;
    if (args.view === "board" || args.view === "techtree") patch.view = args.view;
    if (Array.isArray(args.collapsed)) patch.collapsed = args.collapsed;
    const saved = writePrefs(patch);
    return {
      content: [{ type: "text", text: "Preferences saved." }],
      structuredContent: { ok: true, prefs: saved },
    };
  }
  throw new Error(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
