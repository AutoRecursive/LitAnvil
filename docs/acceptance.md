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
- Real browser stop/clear/reconnect and multiple-tab synchronization (transport tests cover stop/clear/resume; real restart/resume already verified).
- Audit App Server crash recovery retries and thread-switch races beyond existing lifecycle tests.
- Global plugins/MCP currently inherited; restrict to intended project config without changing global config.
- Further visual selection checks at different zooms, multiline agent preview, and manual page navigation.
- Documents: improve imported PDF titles, recoverable deletion and legacy-file hash coverage.
- Extend MCP reader controls with accurate UI state, loaded-page acknowledgement, tab targeting and remaining document/annotation operations.
- Export Markdown formatting, import failure cleanup, modal keyboard focus, and final runtime launch audit.

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
- ProjectWorkspace persists directory in project data, exports papers by ID; browser pwd test returned project notes directory. Global skill/MCP inheritance remains to isolate.
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
