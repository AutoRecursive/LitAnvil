# LitAnvil MVP architecture

The MVP keeps a stable HTTP API between the reader and storage/AI adapters.

- `server/index.ts` exposes document, annotation, chat-stream, and Markdown export endpoints.
- The current persistence adapter is `data/db.json` plus `uploads/`, so local development works without provisioning Postgres/S3. The API shape is intentionally storage-neutral and can be moved to Postgres/S3 later.
- A document is the source of truth for title, URL/file, normalized text, HTML snapshot, tags, and progress. An annotation stores `quote`, `textHash`, format-specific `location`, note, AI answer, and timestamps.
- The browser directory connector writes one folder per paper with `paper.md` (source text + metadata) and `notes.md` (annotations + AI discussion). The server export remains available for agents.
- AI requests are streamed over `/api/ai/stream`. The request includes the document title, selected quote, user question, and relevant existing annotations. A production adapter can route this request to multiple LLM backends or skills without changing the reader.
- An agent workspace should index the selected notes directory with QMD (or another local index) and query only relevant notes. The reader does not load the entire vault on every request; it sends the selected passage plus retrieved context.

Recommended next storage adapters: Postgres for metadata/annotations, S3-compatible object storage for original files and HTML snapshots, and a provider registry for OpenAI-compatible, local, or skill-backed AI streams.
