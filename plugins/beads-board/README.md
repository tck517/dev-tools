# beads-board (Antigravity MCP App Plugin)

Interactive Beads (`bd`) board and Epic Tech Tree MCP App for Antigravity's side pane and sidebar — mirrors `scripts/bdboard` sections with Markdown-rendered bead details, comments, two-way chat context pills, one-click `/deliver`, background `/explain-bead`, PR links, and side-pane file opening.

## Setup

`install.sh` symlinks this directory to `~/.gemini/config/plugins/beads-board`.

On a fresh clone, install dependencies and build the bundled HTML app:

```sh
cd plugins/beads-board
npm install
npm run build
```

## Development & Tests

```sh
cd plugins/beads-board
npm test         # runs Markdown, XSS, and Tech Tree unit tests
npm run build    # rebuilds dist/app.html
```

After rebuilding `dist/app.html`, close and reopen the **Beads Board** pane to pick up UI changes. After editing `src/server.mjs` or `src/beads.mjs`, restart `beads-board_board` from Antigravity's **Customizations → MCP Servers** settings.

## Environment Variables

| Variable | Default | Meaning |
|---|---|---|
| `BDBOARD_DEFAULT_PROJECT` | *(unset)* | Optional preferred beads project path |
| `BDBOARD_ROOTS` | `~/projects:~/Projects:~/src:~/code` | Colon-separated directories scanned for `.beads` repos |
| `BDBOARD_DELIVERED_LABELS` | `committed,in-review` | Comma-separated labels treated as delivered |
| `BEADS_BOARD_APP_HTML` | `dist/app.html` | Override HTML path for local UI iteration |
