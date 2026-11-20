# LitAnvil

Local paper reader with persistent Codex and Claude sessions, PDF annotations, Markdown/math notes, and agent-controlled navigation.

![LitAnvil reader showing a paper, topic labels, annotations, and an agent conversation](docs/images/reader.png)

*Reader view with demonstration content. The example paper is [VideoTetris](https://videotetris.github.io/).*

## Run

Install Node.js and the Codex / Claude Code CLIs you want to use, then complete their account login.

```sh
npm ci
npm run dev
```

The API listens on `127.0.0.1:8787`; Vite prints the frontend URL (default port 5173). The Agent selector uses the installed CLI backends. Both the homepage and reader sidebar use the same chat UI and server-owned sessions.

Choose a notes directory from the header. Agent sessions are separated by directory and provider. Switching providers resumes that provider's own conversation. Clearing context affects the selected provider only.

## Local CLI

Install the checkout as a local command (requires Node.js and the dependencies above):

```sh
npm run install-cli
lita start          # Build the web app, then run API and Web in the background
lita open           # Start if needed and show the app in your default browser
lita status
lita stop
```

`lita start --open`, `restart`, `web` (alias for `open`), `logs` and `--help` are also available. Commands work from any directory. Web uses `http://localhost:5173`, API uses port 8787. Occupied ports are reported without closing unrelated processes. A small local supervisor owns the child processes, waits for readiness and forwards graceful shutdown. Repeated starts reuse the running service. Runtime metadata lives under `data/cli/`; logs are in `logs/service.log`. `npm unlink -g lita` removes the command; this installation points at the current checkout.

The CLI resolves the Codex executable before starting the Agent. If the Codex installation is outside the service PATH, set `CODEX_BIN` to its absolute path and rerun `npm run install-cli`; on macOS, `command -v codex` shows the path.

## Reader

- Import an arXiv URL from chat, or upload PDF / Markdown / text from the library.
- Select PDF text and save a highlight or Markdown comment from the right composer. Comments support `$inline math$` and `$$display math$$`; the left panel opens the same right-side editor and provides deletion.
- Drag panel boundaries to resize sidebars and document/annotation sections. At narrow widths the PDF/chat boundary adjusts their heights. The header and reader toolbar also have draggable lower edges.
- Deleted documents and comments can be undone immediately or restored from the library recycle bin.
- Double-click a separator to restore its default size; focused separators support arrow keys and Home. Layout dimensions are saved in this browser.
- Agents use the local MCP interface to navigate pages, preview text, import/rename/restore documents and create/edit/delete/restore annotations. Temporary previews do not create annotations. All open tabs update automatically.

## Development

```sh
npm test
npm run build
```

Provider adapters and the common runtime are tested independently of live accounts. See [architecture](docs/architecture.md) for the v1 session contract, endpoints, storage and extension boundaries, and [acceptance](docs/acceptance.md) for verified behavior and remaining work.

Local `data/`, `uploads/`, `notes/`, logs and credentials are excluded from Git.


Codex and Claude load project configuration for the notes workspace. Codex keeps a private native home under ignored runtime data and reuses the existing file-based login; global user plugins, MCP servers and skills are not automatically inherited. Put project Codex settings in `.codex/config.toml` and skills in `.agents/skills/` within the project. Existing native thread history remains shared through its selected rollout file. System policy still applies.
