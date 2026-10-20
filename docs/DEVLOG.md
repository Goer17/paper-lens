# Development log

## 2026-10-20 — remove provider seeding

- Removed the `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL` and `DEEPSEEK_MODEL` environment variables and
  the `config.deepseek` object. A fresh database no longer seeds any AI provider.
- New model forms start empty, so users enter their own base URL, API key and model name in
  **Settings → Models**. Removed the DeepSeek defaults from the form.
- Updated README, PLAN, DEPLOYMENT, AGENTS and `.env.example`: provider credentials are configured in
  the app, never read from environment variables. Genericized the DeepSeek URL example in the model
  route validation and the SSE examples in ARCHITECTURE.
- Added a smoke check that a fresh database starts with zero models.
- Verified: `npm run typecheck`, web production build, `npm run smoke` (32 checks), Docker image
  rebuild and healthy container. No current documentation or env file references a seeded provider.

## 2026-10-20 — remove vision toggle, simplify UI copy

- Removed the per-model **Vision** checkbox, `VISION` badge, API field and client types. Box-crop
  images are now attached as `image_url` parts for every model by default.
- Text-only providers now surface a clear error instead of being pre-filtered: if the provider rejects
  an image request, the warning/error says the model does not support image input (vision) and
  suggests removing the box citation or using a vision-capable model. The fallback chain still runs.
- Kept the legacy `models.vision` SQLite column for compatibility but stopped reading, writing or
  exposing it. Added smoke checks that the field is gone and legacy PATCH updates are ignored.
- Removed technical and redundant UI copy: the SQLite/library paragraph on the empty reader, the
  `LOCAL · SQLITE` / `MONO UI` sidebar footer, the login token instructions, settings hints and
  notes, and the "workspace preferences" subtitle.
- Removed model-form input placeholders and placeholder-style strings (`No description provided.`,
  `drag & drop accepted`).
- Verified: `npm run typecheck`, production builds for both packages, `npm run smoke` (31 checks),
  Docker image rebuild, healthy container, authenticated models call without a `vision` field, and a
  public HTTP 200 from an external check node.

## 2026-10-20 — opt-in public binding

- Added `PAPERLENS_BIND` (published address, default `127.0.0.1`) and `PAPERLENS_PORT` (host port,
  default `8787`) to Compose. Public deployment is now explicit: `PAPERLENS_BIND=0.0.0.0` in `.env`.
- Documented public access, firewall/security-group requirements, direct-HTTP risks and an HTTPS
  reverse-proxy example in `docs/DEPLOYMENT.md`. The local deployment was switched to
  `0.0.0.0:8787` for public access.
- Added rule 16 to `AGENTS.md`: loopback stays the default, public binding is opt-in and must be
  documented with TLS guidance; `.env` is never committed.
- Verified: Compose interpolation, container recreated, listener bound to `0.0.0.0:8787`, health and
  authenticated API checks pass, token still absent from logs.

## 2026-10-20 — repository, deploy branch, Docker deployment

- Completed `.gitignore` (workspace deps, build output, runtime data, secrets, test artifacts, OS /
  editor files, local Compose overrides) and initialised the repository with `main` as the stable
  branch. Pushed to `git@github.com:Goer17/paper-lens.git` over SSH.
- Created the **`deploy`** working branch. All future development, fixes and deployment changes go
  there; `main` is updated only after explicit user approval. This workflow is now enforced in
  `AGENTS.md`.
- Added a multi-stage `Dockerfile` (Node 22 slim; builds both packages, runtime installs only server
  production dependencies, runs as the unprivileged `node` user, healthcheck) plus `.dockerignore`
  and `docker-compose.yml` with a named data volume and a loopback-only port binding.
- Added `docs/DEPLOYMENT.md`: Docker quick start, token retrieval, upgrades, backup/restore, native
  systemd deployment, deploy checklist and security notes. Updated README, PLAN, TODO, ARCHITECTURE
  and AGENTS accordingly.
- The server no longer prints the access token at startup. The token stays in
  `server/data/token.txt` (mode `0600`) or `APP_TOKEN`; use `npm run token` when needed. This keeps
  container logs free of credentials.
- Verified: `npm run typecheck`, `npm run build`, `npm run smoke` (29 checks), `docker compose build`
  (338 MB image), `docker compose up -d`, `/api/health` OK, SPA `200`, authorized collections call,
  and the token is absent from container logs. The deployment uses its own `paperlens-data` volume and
  does not touch `server/data/`.

## 2026-10-20 — Renamed to PaperLens

- Product/display name is now **PaperLens** (README, UI title, login, app header, server banner,
  health payload, AI identity, package names and docs).
- Package names: `paperlens`, `@paperlens/server`, `@paperlens/web`.
- Moved the product brief from the repository root to [PLAN.md](PLAN.md) and rewrote it in English
  with current shipped requirements, milestones and acceptance criteria.
- Root `plan.md` was removed (git history still contains it).
- Kept compatibility identifiers intentionally: `paper-reader-token` localStorage key,
  `paper-reader.db` SQLite filename and `PAPER_READER_DATA`. Renaming them would log users out or
  orphan existing data.
- Updated `README.md` and `AGENTS.md` for the new name, product plan location and current behavior.

## 2026-10-20 — hover labels, paper rename, AI title detection

### Annotation hover labels

- Removed the persistent `@page:label` badges and the Tags toolbar toggle.
- Annotations now report mouse enter/move/leave to Reader. After a 500 ms hover timer, a floating
  tooltip appears at the cursor's bottom-right and follows the cursor. It disappears on leave, click,
  scroll, drag start, paper switch or unmount.
- Removed the annotation `title` attribute so the browser does not draw a second native tooltip.
- Added a global pointer-down handler: clicking anywhere outside an annotation clears the blue
  selection ring and dismisses the tooltip. Clicking the annotation's own toolbar keeps the selection.
- Verified: no tooltip at 300 ms, `@1:highlight_1` at 700 ms with a `+14/+16` cursor offset, selection
  ring cleared by clicking the page.

### Paper titles

- New uploads now run `services/title.ts` after the PDF is stored. It uses the first enabled model
  and the first-page text (8k chars), metadata title and filename; the prompt asks for the exact title
  only. Output is cleaned to one line, capped at 300 chars, with metadata/filename fallback when no
  model exists or the request fails (20 s timeout, parallel for multi-file uploads).
- The upload response waits for detection and returns the final title. The original filename is kept
  in `papers.filename`; the display title lives in `papers.title`.
- Paper titles are editable: double-click a paper title or use the hover pencil in the sidebar. It
  uses the centered prompt and `PATCH /api/papers/:id`, updating both the list and the open paper.
- Subfolder creation now uses `FolderPlus` everywhere (tree leaf toggle, row action, FOLDERS header)
  for icon consistency.
- Verified with the debug model: uploading `sample.pdf` returned “Paper Reader Sample Paper” in about
  one second; renaming through the prompt updated the list, open paper and API.

## 2026-10-20 — centered app dialogs

- Removed every remaining `window.confirm` / `window.prompt` call. A new `DialogProvider` wraps the
  app and exposes promise-based `useConfirm()` and `usePrompt()` hooks.
- Dialogs render as a fixed, centered overlay with the app's existing tokens: title, optional
  message, accent/danger icon, Cancel/Confirm actions, input for prompts, Escape to cancel, Enter to
  accept, and focus on Cancel for destructive confirmations.
- Replaced confirmations in: folder rename/delete, paper delete, note clear, chat clear, model
  delete, and skill delete.
- Annotation deletion no longer asks for confirmation at all; the toolbar trash button removes the
  annotation immediately (the app still reports server errors via toast).
- Fixed prompt state sync by keeping the active dialog ref updated on every keystroke; previously
  the confirm action could read the default value.
- Verified: rename via centered prompt persisted, delete folder via centered confirm (Cancel focused)
  removed only the target, annotation delete produced no dialog and removed the row immediately.

## 2026-10-20 — annotation visibility + LaTeX rendering

### Annotation visibility

- The highlight CSS rule only had `mix-blend-mode: multiply` and no background, so highlights were
  effectively invisible. Added `background: color-mix(in srgb, var(--ann-color) 48%, transparent)`
  with a small radius.
- Labels (`@page:label`) were only rendered for the selected annotation, so the only way to see the
  name was the native browser tooltip. Labels are now always rendered on the first rectangle of every
  annotation, tinted with the annotation colour. When anchors collide (e.g. a highlight and
  underline on the same sentence) labels stack vertically by 15 px; the selected label lifts above
  the action toolbar.
- Added a reader-toolbar toggle for label visibility (persisted in `localStorage`), in case a dense
  page feels crowded.
- Verified computed styles: highlight background `color(srgb … / 0.48)`, labels at `-16px` and
  `-31px` for two annotations sharing an anchor, opacity `0.88`.

### LaTeX in chat Markdown

- Added `remark-math`, `rehype-katex`, `katex` and the KaTeX stylesheet.
- `Markdown.tsx` normalizes `\(...\)` and `\[...\]` to dollar delimiters before parsing, while
  protecting fenced and inline code segments. Native `$...$` / `$$...$$` continues to work.
- Citation linkification still runs afterwards; code blocks keep literal dollars.
- System prompt now explicitly requires `$...$` for inline math and `$$...$$` on their own lines and
  forbids putting math inside code fences.
- Tested with a crafted assistant message: 5 KaTeX nodes, 2 display blocks, backslash delimiters
  rendered, citations still linked, code spans preserved. Test paper/folder removed afterwards.

## 2026-10-20 — nested folders + native text selection

### Scope

Follow-up requested after the first run:

1. Folders can form a tree (subfolders of arbitrary depth).
2. Highlight and underline must behave like normal text selection; only boxes keep the drag-rectangle
   mode.

### Folder tree

- Added `collections.parent_id` with an in-place migration (`PRAGMA table_info` → `ALTER TABLE`) so
  existing databases keep their folders and papers.
- `GET /collections` now returns a flat list with `parent_id`; the sidebar builds and sorts the tree.
- `POST /collections` accepts `parent_id`; `PATCH` can rename and re-parent. The server walks
  ancestors to reject self-parenting and cycles, and duplicate names are checked within the target
  parent.
- Deleting a folder promotes its direct subfolders one level (`UPDATE … SET parent_id = parent`) and
  relies on the existing `ON DELETE SET NULL` for papers, so nothing below the deleted folder is
  lost.
- The sidebar recursively renders rows with indentation and chevrons, persists collapse state in
  component state, adds an inline “new subfolder” form per row, and supports dragging folders onto
  another folder (or onto All Papers for the root).
- Creating a folder selects it; errors such as duplicate names are shown inline in the form.

### Native selection annotations

- Removed the rectangle-drag path for highlight/underline. The annotation layer only captures
  pointers in **Box** mode; otherwise pointer events pass through to the PDF.js text layer, so
  selection behaves exactly like the browser default.
- Added `lib/selection.ts`: on `mouseup`, it verifies the selection anchor is inside a text layer,
  maps `Range.getClientRects()` to the page, filters/merges rectangles per line, normalizes them, and
  returns the selected text plus an anchor for a popover.
- Select mode shows a small floating menu (colour swatches + Highlight/Underline). Highlight or
  Underline mode applies immediately on the next selection and then returns to Select, so notes and
  annotations can be double-clicked straight away.
- The menu dismisses on scroll or pointer-down elsewhere and is clamped to the viewport.
- Removed the now-unused text-drag geometry helper (`selectTextInRect`); box text extraction still
  uses the same text-item intersection code (`textInBox`).

### Verification

- API: created nested folders, rejected a parent cycle with `400`, moved a folder by PATCH, and
  confirmed list shape.
- Browser: tree indentation (`18px → 32px → 46px`), collapse/expand, synthetic folder drag between
  parents, selection popover, highlight via popover, underline via tool mode, box drag, and automatic
  return to Select.
- Test papers/folders/annotations were removed afterwards; the pre-existing user library (Multimodal
  + its paper and annotations) was preserved.

## 2026-10-20 — v0.1.0

### Scope

Built the first end-to-end version from the product brief (now [PLAN.md](PLAN.md)): token-protected library, PDF reader, Zotero-like
annotations and notes, grounded streaming AI with tool traces, model fallback, theme preference,
and skills.

### Decisions

- **Single language across the stack.** Node 22+ everywhere keeps `npm install` simple and lets us
  use Node's built-in `node:sqlite` instead of a native SQLite addon.
- **React + Vite** rather than Next.js. This is a local single-user SPA behind one API; a server
  rendering framework adds no value, and Vite keeps the PDF worker setup straightforward.
- **SQLite + local files.** Papers live in `server/data/uploads`; annotations, messages, settings,
  and provider keys live in SQLite. Deleting `server/data` resets the workspace.
- **PDF.js on the client, `unpdf` on the server.** The client needs the text layer for selection
  geometry and canvas rendering; the server needs plain text for search tools. Page text is cached
  lazily in `paper_pages`.
- **Normalized annotation rectangles.** Storing `0..1` coordinates per line avoids re-projecting
  annotations when the reader is resized, zoomed, or when the notes/AI panels open.
- **SSE for chat.** One-way streaming, simple to debug with `curl -N`, and no WebSocket state.
- **Provider chain with automatic fallback.** Models are ordered rows; failures before any content
  or tool execution transparently move to the next enabled model.
- **Skills as instructions, not executables.** Uploaded zips are extracted with path-traversal
  protection. The agent reads `SKILL.md` and supporting files; the server never runs the scripts.
  This keeps a malicious skill from becoming remote code execution.

### Implementation notes

- `server/src/services/llm.ts` contains the system prompt, tool schemas, tool execution, streaming
  loop, fallback logic, and persistence. Tools are only advertised to the model when relevant
  (skills tools appear when at least one skill is installed).
- Annotation labels are allocated per paper/type by scanning existing labels, so deleting an
  annotation does not cause a duplicate label.
- Text-line rectangles are derived from PDF.js text items transformed by the viewport. Items on the
  same baseline are merged; highlight/underline rendering uses one block per line.
- Box annotations crop the already-rendered canvas to PNG at creation time. Vision-capable models
  receive the image; text-only models receive the extracted box text.
- Note stickers are absolutely positioned in a rail that scrolls with the pages. Their target top is
  `pageTop + rect.y * pageHeight`; overlap resolution measures card heights with a `ResizeObserver`
  and pushes later cards down. Sticker width equals the rail width.
- Chat preambles ("Let me look that up…") are buffered. If a tool call follows within 240
  characters, the preamble is dropped; otherwise it streams. This keeps the final answer clean while
  preserving streaming for long responses.
- The response language is enforced in the system prompt with native language labels (`中文`,
  `日本語`, …) after observing that a terse rule could be ignored by the model.

### Issues found and fixed during validation

- **Double-click didn't work right after annotating.** Drawing tools put the annotation layer in
  capture mode. The reader now switches back to Select after a successful create, matching Zotero.
- **Flat horizontal drags were ignored.** The minimum-height threshold rejected thin selections;
  text tools now accept 1 px-high drags while boxes still require a real area.
- **Layout didn't re-fit when panels opened.** Width was measured once on mount. It is now measured
  after every render plus via `ResizeObserver`/window resize, and the scrollbar gutter is stable.
- **Paper titles.** PDF metadata titles are used when present; otherwise the filename is used as
  the preliminary title.
- **Assistant history stored a placeholder.** The first stream implementation saved `"streamed"` as
  message content; it now saves the accumulated answer.
- **Current user message was duplicated in the prompt.** History is loaded before inserting the new
  user message; citations are re-attached when replaying history.

### Verification

- `npm run typecheck` and `npm run build` pass for both packages.
- `npm run smoke` covers auth, folders, upload, PDF streaming, annotations, box crops, notes,
  search, settings, model masking/disable, skill extraction, empty-thread state, no-model chat error,
  and deletion against an isolated data directory.
- Manual browser validation with sample PDFs (single page and five pages):
  - token login and persistence across reloads;
  - highlight/underline/box creation, auto-select, recolour, delete;
  - note sticker save, reload persistence, and exact vertical alignment (`noteTop === annotationTop`)
    on page 3 of a five-page PDF;
  - page navigation and current-page tracking;
  - drag-to-chat citation chips, streaming Markdown + tool trace;
  - `use_skill` tool call returning the uploaded skill;
  - fallback from a dead provider to DeepSeek with a `warning` event;
  - theme colour and response-language persistence.

### Follow-ups

See [TODO.md](TODO.md). Highest value next: text-selection annotations, remembered page/zoom,
annotation export, and a real test suite around geometry and the chat loop.
