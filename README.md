# LitAnvil

Local paper reader with persistent Codex and Claude sessions, PDF annotations, Markdown/math notes, and agent-controlled navigation.

## Run

Install Node.js and the Codex / Claude Code CLIs you want to use, then complete their account login.

```sh
npm ci
npm run dev
```

The API listens on `127.0.0.1:8787`; Vite prints the frontend URL (default port 5173). The Agent selector uses the installed CLI backends. Both the homepage and reader sidebar use the same chat UI and server-owned sessions.

Choose a notes directory from the header. Agent sessions are separated by directory and provider. Switching providers resumes that provider's own conversation. Clearing context affects the selected provider only.

## Reader

- Import an arXiv URL from chat, or upload PDF / Markdown / text from the library.
- Select PDF text and save a highlight or Markdown comment from the right composer. Comments support `$inline math$` and `$$display math$$`, with editing and deletion in the left panel.
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
