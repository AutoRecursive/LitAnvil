# Usability acceptance

## Verified 2026-11-10
- App Server connects with JSON-RPC; no CLI stderr parsing in the active Chat path.
- Backend owns persistent thread ID in data/session.json.
- SSE pushes snapshots independently of message POST responses.
- Homepage and PDF sidebar use src/Chat.tsx.
- Browser test: remember 蓝鲸42, reload, ask again: correct answer.
- Browser test: switch to paper, ask again: correct answer.
- Browser test: ask for paper summary: correct paper-specific answer; 18 canvases before/after.
- Build passes; tests/session.test.ts passes (stream projection and stale-thread isolation).

## Remaining verification / implementation
- Audit App Server crash recovery retries and thread-switch races beyond existing lifecycle tests.
- User-level Codex configuration isolation is verified below; system/organization policy remains applicable.
- Real title/body selection, save/edit/delete, zoom/reload alignment and simultaneous two-tab page controls are verified below. Broader PDF formats and touch/keyboard selection remain outside these manual checks.
- Audit in-flight library writes during shutdown, local API origin access and long-document performance.
- Final runtime launch audit and completion of the remaining interaction checks.

## Additional evidence
- 2026-11-10: highlight saved as normalized page rectangles; browser refresh restores 135 selected text rectangles. Comment edited and recovered after refresh.
- Removed active legacy CLI stream endpoint and stderr parsing middleware.
- Tests now launch an isolated server at 18787 with temporary DB/uploads; no real data backup/restore.
- Six tests pass, including five concurrent imports retained and arXiv URL identity/version preservation.
- Production server restarted: same persisted thread 01a1c459-3915-7ec0-9a2f-b75acf79523b recovered with eight items and last paper-specific answer.
- Reading selection survives page reload via sessionStorage document ID.

## Session and presentation regression coverage
- tests/session-lifecycle.test.ts uses an isolated JSON-RPC child transport to verify shared concurrent connection, interrupt, clear to new thread, and resumed history. Real UI stop/clear/multiple-tab testing remains pending.
- tests/chat-display.test.tsx renders actual message components: collapsed tools/error state, public reasoning summary only, Markdown answers, hidden reference context excluded from user bubbles.
- 13 tests pass; build passes. Real server restarted with current code.
- Failed sends restore unsent draft; progress-only DB updates skip notes export.
- ProjectWorkspace persists directory in project data, exports papers by ID; browser pwd test returned project notes directory. Global skill/MCP isolation was subsequently implemented and verified below.
- MCP control_reader real Codex call verified successful with pink temporary marks and unchanged annotation count.

## PDF resize regression (2026-11-10)
- PDF loading is independent of width/zoom; all page slots retain their final heights while replacement canvases render. Width observations are debounced and ignore height-only changes.
- Stable scrollbar gutter and inline size containment prevent scrollbar/render feedback. The narrow layout retains a bounded PDF scroller across the 900px breakpoint.
- Browser checked 899, 900, 901, 1000, 1100, 1199, 1200, 1201px: all 18 page slots persist; after layout settles, repeated scroll samples stay constant. Current page stays at page 4 across breakpoint changes and zoom to 110%.
- Clicking the left annotation jumps back to page 1 with 135 highlight rectangles intact.
- Three new component regressions cover persistent page slots during delayed rendering, batched width changes without reloading the document, and page-relative zoom anchoring. All 16 tests and production build pass.

## Interface cleanup (2026-11-10)
- Replaced accumulated themes with one monochrome stylesheet and shared light/dark variables. Theme survives reload; PDF pages remain white. Removed unused localStorage chat history and legacy renderer/state. App extracted for component testing.
- Real browser at 390px: directory opens, annotation click navigates and dismisses drawer, PDF and chat remain visible, controls do not overflow. Repeated resizing through 390/900/901/1201px keeps page 2 and all 18 slots.
- Homepage now has accessible upload, search, separate native open/delete buttons. Real Markdown upload enters the reader with correct content; the temporary fixture and its generated files were removed.
- Annotation fetch ignores stale document responses; clicking the current document no longer empties annotations. Save/edit failures preserve input and display a global error; failed deletion preserves library contents.
- 18 tests pass (including stale annotations/repeated clicks/deletion failure); production build passes with the existing large-bundle advisory.

## Unified agent runtime (2026-11-10)
- Happy-inspired adapter/runtime/presentation separation implemented with a v1 common protocol. Codex native JSON-RPC and Claude official Agent SDK stay inside provider adapters; frontend renders common messages/tools/notices.
- Workspace/provider histories, provider selection, atomic snapshot files and revisioned event journals persist under ignored data/agents. Original default-workspace Codex thread migrated and rendered with seven existing user messages.
- Real Claude account configuration reused through an authentication-only allowlist; project settings and explicit local HTTP MCP are passed to the SDK. Browser remember/reload/recall returned 海鸥73. Switching from homepage to PDF sidebar retained the same Claude messages.
- Real Claude MCP calls connected over HTTP and executed navigation/temporary previews. A stale state cache and first-visible-page heuristic were found during E2E; get_reader_state now obtains actual frontend acknowledgements, preview replies include matches/pages, and the most-visible page is used. Direct MCP verification returned page 2 and four cyan matches on page 2 with all 18 canvases retained.
- Adapter/runtime tests cover streamed text/tool reconciliation, native resume/interrupt, isolated projects/providers, selection recovery, failed-provider switching, storage failures and public-summary-only projection. No live account access is used by these tests.
- Temporary Markdown/math annotation fixture removed after confirming its source was unchanged.

## Resizable panes (2026-11-10)
- Drag separators adjust left and right sidebar widths, document/annotation split, narrow-screen PDF/chat split, header height and reader-toolbar height. Widths are bounded so the PDF retains usable space; hidden panels do not reserve width. Layout is persisted per browser.
- Pointer capture, keyboard arrows, Home and double-click reset supported; selection/cursor state is restored after dragging or cancellation.
- Real desktop drags: left 240→320px, right 360→460px, document share 40→29%, header 64→80px, toolbar 56→75px. Reload restored these values.
- Real 390px viewport drags changed PDF/chat share 60→50% and drawer width 320→280px. No horizontal overflow; 18 PDF page slots retained. Double-click restored all defaults.
- 37 tests pass, including drag bounds/keyboard/reset and current-page geometry. Production build passes with the existing large-bundle advisory.
- Final real-agent check: Claude reported page 2 and matches=4 after navigation/preview/state tools. Switching back to Codex restored its original seven-message history; a new Codex turn recalled 蓝鲸42 rather than Claude's 海鸥73. All 18 PDF canvases remained present.

## Library recovery and import/export reliability (2026-11-10)
- Library routes extracted to server/library.ts. Document and annotation deletion is recoverable; undo and a persistent recycle-bin dialog restore the same IDs, original files, notes and normalized PDF rectangles. No permanent purge route is exposed. Active library/MCP/context queries exclude deleted records. Annotation updates cannot rewrite identity or document ownership.
- Imports validate real PDF data, clean failed/duplicate temporary uploads, enforce 100MB upload/download limits, and serialize mutations until the handler completes even if the HTTP client disconnects. Tests prove a canceled client cannot overwrite a later import.
- Original-file SHA256 backfill and persistent URL aliases avoid duplicate records and repeated alias downloads. Metadata-only legacy PDF/arXiv records upgrade in place; reimporting a trashed cached document restores it. PDF title extraction rejects license boilerplate.
- Real legacy Attention Is All You Need record 0ab17e38-19ca-4a66-a03a-4d8186320db7 upgraded to a readable 15-page PDF. Both real documents retain their IDs; the existing Causal Forcing++ annotation remains present.
- Markdown export preserves actual line breaks, Markdown/math source and quoted frontmatter. Notes/config exports use atomic file replacement. A notes-export failure reports a warning after preserving committed DB records and PDF bytes, rather than deleting a referenced file.
- Browser recovery checks use an isolated temporary DB/uploads/notes and a deterministic transport, never the user's real library: document delete→undo, recycle-bin restore, annotation delete→undo/restore, restored PDF rendering/highlight/math, Tab containment, Esc, Enter and focus return all verified. Temporary data removed and the real server restored.
- Isolation exposed a dev file-address bug: PDF assets now resolve against the API origin, with matching agent readiness checks. Restored fixture PDF rendered from the isolated backend rather than Vite's filesystem.
- 48 tests pass; production build passes with the existing bundle-size advisory.

## Reading position and page navigation (2026-11-10)
- Replaced the static black page-count badge with a compact toolbar control: current page/total, previous/next and validated Enter-to-jump input. Invalid page values revert; Escape cancels input.
- Per-document local positions record page and within-page fraction, with backend progress as fallback. Restoration waits for the matching PDF source and all reserved page dimensions; opening another document cannot use the previous PDF's geometry.
- Scroll writes are debounced, include tiny movements, flush when leaving a document, and use keepalive for pending unload requests. Queued writes retain their document ID; progress updates do not reinitialize the active reader.
- Real browser: Attention page 4 → reload → page 4; zoom to 110% retains page 4; next → page 5 → library → reopen restores page 5. Switching to Causal Forcing++ and navigating independently does not overwrite Attention's position. At 390px, page tools remain usable without horizontal overflow and all 15 page slots remain present.
- 53 tests pass, including delayed PDF geometry, source mismatch, malformed storage/backend fallback, small-scroll debounce/close flush, cross-document isolation and page-input validation. Production build passes with the existing bundle-size advisory.

## MCP library operations and multiplexed live synchronization (2026-11-10)
- Added get_document, get_trash, manage_document (URL import, rename, recoverable delete/restore), and manage_annotation (create, edit, recoverable delete/restore). MCP operations reuse the same validated/serialized HTTP routes as manual UI operations, with no duplicate database mutation implementation. Claude permissions derive from the shared tool catalog. Codex and Claude share reading instructions describing editable highlights/comments.
- preview_text returns normalized quote/location for the nearest match while remaining temporary; saving requires an explicit manage_annotation call. control_reader close_document returns to the library. Fresh reader state includes annotation count.
- An initial two-tab E2E exposed a connection-starvation bug: three independent SSE connections per tab exhausted the browser's HTTP/1 connection limit, blocking PDF loads and message POSTs. The frontend now shares one live stream per tab for agent snapshots, reader commands and library invalidations. Cache replay is limited to display state, never reader commands.
- Library updates refetch current documents/annotations, preserve the open reader and unsent annotation input, ignore stale document responses, close a reader only when its document has been deleted, retry transient fetch failures and recover changes after reconnect. Reading-progress-only writes do not trigger full-library refreshes.
- Real isolated-browser/native-agent checks: Codex previewed a one-page fixture and created a positioned Markdown/math annotation; Claude read and edited that same ID/location. With two tabs open, another real Claude edit appeared in both tabs with their canvases intact. MCP delete removed the annotation/highlight in both tabs; restore preserved the ID and location. Document delete returned both tabs to the library; restore and immediate targeted open succeeded. close_document acknowledged the actual homepage state.
- Missing HTML doctype/meta viewport/title fixed; real browser now reports CSS1Compat and formula rendering no longer runs in quirks mode.
- Temporary fixture DB/uploads/notes removed after restoring the real server. Real library still has both original documents, the Causal Forcing++ annotation's 135 rectangles, all 18 PDF page slots and the original Codex history. Native account history created during integration checks is outside the temporary library.
- 60 tests pass, including MCP CRUD/recovery/validation, live server multiplexing, singleton client transport/cache/non-replayed commands, cross-tab UI updates and stale-response isolation. API tests inject a deterministic transport and wait for process exit during cleanup; no model calls are used by automated tests. Production build passes with the existing bundle-size advisory.

## Multiline PDF matching and exact text anchors (2026-11-10)
- Agent preview searches across original PDF text spans and lines, normalizing whitespace, ligatures and composed/decomposed accents. Printed line-break hyphenation is removed while same-line compound hyphens remain significant. Repeated occurrences are distinct matches; searches do not stitch unrelated pages together.
- Preview ranges map back to original text-node offsets and produce glyph-range rectangles, rather than whole-span or paragraph boxes. Normalized rectangles remain available for compatibility. Page-scoped matching waits for the target page; whole-document matching waits for the final rendered page. Invalid page numbers fail immediately. A failed search retains previous temporary previews, and append=true can mark a second passage without saving records.
- Real zoom testing found up to 1.55px of rounding drift when reusing only normalized rectangles captured at 75% at 150%. Version 2 locations now also store original page/text-node offsets. Newly selected/saved annotations and temporary previews reanchor after each page's text layer renders; legacy locations retain their normalized fallback. Rendering tests verify that saved annotations follow changed glyph metrics after zoom without reloading the PDF.
- Real Attention PDF: title marked pink and a phrase spanning two abstract lines marked cyan simultaneously. Observed preview-vs-text-range edge differences after reanchoring were below 0.03 CSS px at 75%, 100%, 150% and a settled 390px viewport. Screenshot inspection confirms the marks cover the corresponding title and body text. These marks remain temporary; the paper still has zero saved annotations.
- Real Causal Forcing++ PDF: complete two-line title matched as one result/two text ranges; a failed subsequent search retained both preview rectangles. Its original 135 saved rectangles and all 18 page slots remained present. Restored normal 100%/Agent-open layout and original connected Codex session.
- 69 tests pass, including split words/lines, ligatures/accents/repeated matches, line-break hyphens, page boundaries, clipping, cross-page user-selection offsets, text-metric reanchoring and legacy fallback. Production build passes with the existing bundle-size advisory.

## Project-only Codex configuration with shared login/history (2026-11-10)
- A native probe demonstrated that `-c mcp_servers={}` and a disabled plugin default still merge global MCP entries and explicitly enabled plugins. The fix therefore creates a private native home per workspace/provider; it never edits the user's global config.
- The native child starts in the notes workspace with the isolated home. Baseline configuration disables bundled skills, automatic account connectors and plugin defaults. Trusted project config/skills remain available. User `.agents/skills` paths outside the project are disabled; canonical path handling avoids treating macOS /var aliases or project symlinks as external. Cyclic skill symlinks are bounded.
- Existing file-based native credentials are linked, not copied into config or logged. A fake-credential native writer check proved this installed CLI preserves the auth link and updates its target. Login-only probes report ChatGPT authentication; native tests use isolated fake account directories and do not read real credentials. Keychain-only account migration is outside implemented support.
- Legacy resume links only the selected rollout file, not the entire history directory. Native resume-by-ID then succeeds; events written through either path remain visible through the other. Metadata saves are atomic. The installed build did not resume an external rollout by the experimental path field alone, so the implementation does not depend on that field.
- Real native inspection: original thread 01a1c459-3915-7ec0-9a2f-b75acf79523b resumed with all 24 native items; effective user config came from the private native home. MCP status contained only litanvil (8 tools), and enabled skills were empty for the real project. No global plugin skill or account connector tools remained. System policy config remains loaded.
- Separate temporary git project: its `.codex/config.toml` reasoning setting loaded and its sole project-fixture skill appeared enabled with repo scope. Temporary project data removed afterward.
- Real frontend after restarting the updated server: Codex successfully called get_reader_state and replied with page 1 and the original remembered 蓝鲸42. Reload preserved that answer, all 15 Attention page slots and the connected session.
- 73 tests pass, including private config permissions, absence of global config/instructions, shared fake auth updates, external skill/symlink handling, account mismatch preservation, selected-rollout migration and native history event sharing. Production build passes with the existing bundle-size advisory.

## Chat admission, context switching and startup recovery (2026-11-10)
- The frontend uses the same send eligibility for Enter and the send button. Connecting state retains drafts; synchronous request locks prevent duplicate Enter/click submissions. A separately guarded stop remains available while message admission is pending. Valid full arXiv links can still enter the import queue when the agent is unavailable; shared URL validation rejects non-HTTP URLs, partial IDs and misleading hostnames.
- Draft/recovery state is shared across homepage/PDF Chat remounts. A failed request restores its text when the input is empty; newer typing is retained with the failed request separately recoverable. Restoring one message preserves the other rather than silently combining unrelated questions.
- Frontend actions bind to the displayed native session and workspace. Runtime checks reject stale send/stop/clear/provider requests before changing context. Admission is serialized even before an adapter publishes running state. Directory changes lock out concurrent actions and connect the new authoritative session before returning; connection failures after a saved directory change are reported distinctly.
- Real native checks used a temporary notes workspace: Codex and Claude each stopped a newly submitted long turn, cleared to a different native session ID and answered the first short request in the new context. PDF retained all 15 page slots. Returning to the original notes directory restored the original Codex history/蓝鲸42 answer. The temporary workspace and its runtime scope were removed after stopping the server; original files/history were retained.
- Disconnect test reproduced an additional PDF-loss path: development watchers reacted to generated runtime cache files, reloaded the app while the backend was down, and the recovered library did not reopen the saved document. Vite now ignores data/uploads/notes/logs, limits optimizer entry discovery to index.html and denies direct development-server access to private runtime files. Writing HTML/package fixtures in all four runtime directories produced no new reload/connect/layout log events; /data/db.json returns 403.
- Startup failures now recover the saved document ID and project directory from a fresh live library event, while ignoring explicit user closes or switches. Stale startup errors clear after recovery. Real cold-open-with-backend-down test preserved the draft, then restored Attention's 15 pages, original Codex history and connected state after backend restart without another user navigation.
- 83 tests pass, including Enter/button admission, same-tick duplicate Enter, stop during pending submission, draft recovery across remounts, stale-session HTTP/runtime guards, workspace-change races and initial-library-failure recovery. Test discovery is restricted to project tests so runtime-cached plugin test files cannot enter the suite. Production build passes with the existing bundle-size advisory.

## Shared layout controls and authoritative exports (2026-11-10)
- Added MCP set_layout/reset_layout and download_annotations actions. Manual drag handles and MCP share a React-free bounds/defaults contract; invalid multi-property patches fail atomically. Reader state reports persisted preferences separately from responsive DOM dimensions. Zoom/panel/layout acknowledgements wait for a settled layout and a ready visible page.
- Page-number display observes reader size changes so a changed most-visible page updates even without a scroll event. A regression covers this visibility change.
- JSON export moved from frontend annotation memory to the authoritative library API. JSON and Markdown share filename/format handling; the manual buttons and reader download action call one download helper. export_document provides the same content/link to agents even without an open UI. Exports exclude trashed annotations/documents, preserve Markdown/math source and version 2 locations, and use bounded UTF-8 filenames with safe Content-Disposition encoding.
- Download anchors are attached before clicking and object URLs remain valid briefly afterward, avoiding immediate-revocation races. MCP acknowledgement says a browser download was requested rather than claiming saving completed.
- Real desktop MCP: left/right preferences 300/420 matched DOM measurements and survived reload. A mixed valid/invalid patch did not partially change the left width. reset_layout restored defaults. At 390px, preferences 500/700 resulted in actual drawer/Agent widths 331.5/390, with no horizontal overflow and all 18 Causal PDF page slots retained.
- Real manual JSON/Markdown downloads completed to Downloads. JSON retained the original annotation and all 135 saved rectangles. Real Codex then set widths to 280/400 and invoked the browser JSON download; the observed downloaded file parsed identically to the manual export, with no annotation changes. Original pane preferences, view size, Attention document, page and draft were restored afterward.
- 89 tests pass, including shared layout bounds/atomic validation, HTTP/MCP export equivalence and trash filtering, Unicode filename safety, download/error/object-URL lifecycle and resize-driven pagination. Production build passes with the existing bundle-size advisory.

## Queued reader commands and complete drag controls (2026-11-10)
- Reader commands execute in submission order per tab, with independent queues for other tabs. Queued commands have bounds and deadlines; disconnected/replaced tabs reject unfinished operations instead of replaying them after reconnection. Late acknowledgements cannot complete another tab's operation.
- Frontend cancellation interrupts pending fetches and readiness/layout waits. Already expired commands cannot start a download. Delayed imports still enter the library but cannot reopen the reader after a newer manual close or document switch; concurrent imports retain the busy state until all finish.
- Real connected reader received concurrent open-document, page-2 navigation, pink temporary preview and state requests. All completed in order on Causal Forcing++, preview returned four matches on page 2, and the existing saved annotation count stayed at one. Invalid page 999 failed without blocking the following valid page request. Temporary marks were cleared and Attention page 1 restored.
- Homepage and PDF sidebar share a draggable composer height preference. All separators now have visible grips; composer height adapts to available panel space. Real pointer drags adjusted left width 240→280, header 74→84, toolbar 56→75 and input height 64→104. Reload retained the input height and original PDF; reset restored the input height to 64. Original reading layout was restored.

## Interrupted journal recovery and graceful shutdown (2026-11-10)
- Startup repairs an unterminated final journal record after preserving the original bytes in a separate backup. A complete last JSON record lacking its newline is retained and separated from subsequent appends. Corrupt complete/middle records, invalid schemas, wrong providers and regressing revisions are reported explicitly without rewriting the original journal.
- Missing, stale or malformed snapshot files recover from complete journal events, including context resets and item replacement. Malformed snapshots are backed up; unrecoverable corruption does not silently start an empty conversation. Initial native-history reconciliation writes a full checkpoint, including removed items; a missing older journal cannot leave subsequent recovery without its base transcript.
- Shutdown interrupts adapters, waits for their final events and persistence queues, then flushes runtime snapshots. The fixed 500ms exit was removed; a bounded timeout or write failure exits unsuccessfully with diagnostic logs. Closing during connection setup cannot launch a new adapter after the shutdown gate. Codex thread metadata writes are serialized; Claude drains its interrupted output loop and metadata queue.
- Regression fixtures simulate truncated journals, broken snapshots, stale native transcripts, delayed final adapter output and shutdown during workspace lookup. No account/model access is used by these tests.
- Real API restarted twice with unchanged original native Codex session and all 32 projected items. Updated SIGTERM handling logged the final saved-session confirmation and exited with code 0; the next launch returned the identical transcript. No original conversation or annotation was cleared.
- 106 tests pass across 26 files; production build passes with the existing bundle-size advisory. Further manual PDF-selection cases and the remaining completion audit are still outstanding.

## Manual PDF selection and unified annotation editing (2026-11-10)
- Real pointer selection reproduced a title-edge bug: dragging beyond the final glyph included unrelated author blocks. PDF rendering now uses the installed PDF.js TextLayerBuilder for selection boundary handling, alongside the required span/line-break/end-marker styles. Existing text normalization is explicitly preserved to keep saved version-2 offsets compatible.
- On mouse release in whitespace beside a text line, the focus endpoint snaps to that line's text edge. Direct text targets, paragraph gaps and reverse selection are covered separately; normal browser selection is preserved elsewhere. Cancel clears the visible native selection.
- New and existing annotations share the right-hand composer. Editing opens Agent and, on narrow screens, dismisses the directory drawer; the left list retains Markdown/math display, jump, edit and delete. Failed edits retain their draft; clearing a comment converts the same annotation into a highlight. Pending saves prevent conflicting edit/cancel/selection changes.
- Real title and two-line abstract selections were saved, edited and recovered after reload. Three saved highlight rectangles matched their exact text-node ranges at 75%, 100% and 150% zoom; maximum observed edge error was 0.016 CSS px. Markdown bold and inline math rendered in the annotation list. Evidence: /tmp/litanvil-manual-selection-alignment.png.
- A second real tab received edited annotations and deletions live without losing its PDF. Concurrent client-targeted page requests left one tab on page 2 and the other on page 3; both retained the same document and annotations. Clicking a saved quote returned from page 2 to page 1.
- Both newly created acceptance annotations were deleted through the UI. Their exact, verified soft-deleted fixture records were then removed while the server was stopped; original data was backed up first. The library returned to its original two live documents and one original live annotation. The extra tab was closed, and the original Attention/page-1/100% reading view was restored.
- 109 tests pass across 26 files, including whitespace/reverse selection boundaries, right-side editing, failed-save draft retention and highlight conversion. Production build passes with the existing bundle-size advisory. Further work is paused at the user's request; this record does not claim full completion of the remaining audit.

## Project QMD cross-paper retrieval (2026-11-11)
- Added a project-scoped QMD adapter. It indexes only the configured notes `papers/` tree, updates after atomic note synchronization, and derives a separate index name from the workspace path. The adapter uses bounded `qmd search` retrieval and `qmd vsearch` when embeddings are available; it intentionally avoids QMD's optional generation-backed `query` command so an unavailable local model cannot block the Agent.
- Added read-only Agent tools `search_knowledge` and `find_similar_papers`. Search results expose document ID, score, line, source and snippet; provider instructions require fetching the referenced document before making claims. Similarity excludes the current paper and is intended for “find related work” flows.
- QMD failures are isolated to retrieval calls; normal chat, PDF reading and library operations continue. `LITANVIL_QMD=off` is available for deployments without QMD. No QMD skill, global index, or user-level collection is modified.
- Tests cover project initialization, result normalization, current-paper exclusion, disabled mode and bounded integration behavior. Production build passes.

## CLI Codex executable resolution (2026-11-12)
- Background `lita` services now resolve `codex` to an executable path using the service environment before spawning the native app-server. This prevents macOS shell-only PATH differences from surfacing as `spawn codex ENOENT`.
- If no executable is found, the error includes the effective PATH and the `CODEX_BIN` absolute-path override. A real `lita start` followed by `/api/agent/state` restored the existing native Codex session successfully.
- Added provider-path regression coverage. Full suite: 114 tests across 29 files; production build passes.

## Responsive chat controls and clear-context synchronization (2026-11-13)
- Reader controls now wrap into a dedicated action row at narrow widths; the page navigation keeps its own space and the 390px viewport has no horizontal overflow. The Agent selector is labeled, wider, and remains usable on the home page and reader sidebar; its status and clear-context control reflow without crowding.
- The clear-context request now returns the authoritative new Agent snapshot. The frontend applies that snapshot immediately and clears the shared draft/unsent-message store, so backend history, visible transcript and input state disappear together.
- Real 390px browser check measured a 120.75px reader toolbar, a 366px wrapped action row, no document overflow and a 318px Agent selector. Tests: 114 passed, 1 intentionally skipped due unavailable occupied-port fixture; production build passes.

## Persistent reader view state (2026-11-13)
- The last reader view is stored in local browser state: document ID, zoom, left/right panel state and document-section state. Each document already stores page/fraction/progress independently, so reopening the same document restores its scroll position after a refresh.
- Library recovery consults persistent view state as well as session state. A successful reconnect can reopen the saved document; a late response after an explicit close is rejected and cannot steal navigation back. Agent provider/session history remains server-owned and resumes through the same project workspace.
- Added a regression for fresh-session document restoration and the stale late-sync close race. Targeted reading-position and app-state tests pass; production build passes.
