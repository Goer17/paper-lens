# AGENTS.md — PaperLens

Instructions for AI coding agents (and humans) working on **PaperLens**.

Read this file before changing code. For product intent see [docs/PLAN.md](docs/PLAN.md); for
architecture, API and history see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
[docs/API.md](docs/API.md), [docs/TODO.md](docs/TODO.md) and [docs/DEVLOG.md](docs/DEVLOG.md).

---

## 1. What PaperLens is

PaperLens is a local, single-user, Zotero-inspired AI paper reader. The product name is **PaperLens**
even though a few internal identifiers are kept for data compatibility: the `paper-reader-token`
localStorage key, the `paper-reader.db` SQLite filename and the `PAPER_READER_DATA` env var. Do not
rename those without a safe migration.

- React 19 + TypeScript + Vite SPA.
- Express + TypeScript API.
- SQLite through Node's built-in `node:sqlite` (no native addon).
- PDFs, annotation crops and skills live on local disk.
- PDF.js renders PDFs in the browser; `unpdf` extracts text on the server for AI tools.
- AI providers are OpenAI-compatible and called through the `openai` SDK.
- Frontend and backend are separate packages in one npm workspace.

The user's library, annotations and chat history are **real data**. Treat `server/data/` as
production data.

---

## 2. First five minutes

```bash
npm install                 # already installed in normal dev environments
npm run dev                 # API :8787 + Vite :5173
npm run typecheck           # both packages
npm run build               # server + web production build
npm run smoke               # isolated API end-to-end test (builds server first)
npm run token               # print the current access token
```

Open http://localhost:5173. The API binds to `127.0.0.1:8787` by default. Vite proxies `/api` to
`http://127.0.0.1:8787`.

```bash
git checkout deploy        # all development happens here
npm run build              # then serve the production SPA + API
docker compose up -d --build   # optional containerized deployment
```

### Branch workflow (mandatory)

- **`deploy` is the working branch.** Do all development, fixes, documentation and deployment
  changes there.
- **`main` is the stable, user-approved branch.** Never push directly to `main` and never merge
  `deploy` into `main` on your own initiative.
- After the user explicitly confirms that the `deploy` branch is good, merge it into `main`:

  ```bash
  git checkout deploy && git pull
  git checkout main && git pull
  git merge --no-ff deploy
  git push origin main
  git checkout deploy && git merge main   # keep deploy in sync
  ```

- If the user has not explicitly approved the work, stop after pushing `deploy` and report the
  branch, commits and verification results.

Useful env vars:

| Variable | Purpose |
| --- | --- |
| `PORT` | API port, default `8787` |
| `HOST` | API bind address, default `127.0.0.1` |
| `APP_TOKEN` | Overrides the generated workspace token |
| `PAPER_READER_DATA` | Data directory, default `server/data` |

No AI provider is seeded from environment variables. Users add their own OpenAI-compatible model in
**Settings → Models**.

Token file: `server/data/token.txt` (mode `0600`). The token is intentionally not printed by the
server at startup; use `npm run token` or read the file when you need it.

---

## 3. Non-negotiable rules

1. **Never delete or rewrite `server/data/`** unless the user explicitly asks. It contains the live
   library, annotations, chats, skills, API keys and token.
2. **Never expose secrets.** Do not return raw provider API keys from the API, log tokens, print
   `.env` contents, or commit `.env`.
3. **Do not run destructive tests against the live server.** Use the smoke test or a separate
   isolated server/data directory (section 12).
4. **Run `npm run typecheck`, `npm run build` and `npm run smoke`** before declaring backend work
   done. Run at least typecheck + build for frontend-only work.
5. **Use the app's centered dialogs**, never `window.confirm` / `window.prompt` / `window.alert`.
   Use `useConfirm()` / `usePrompt()` from `web/src/components/DialogProvider.tsx`.
6. **Deleting an annotation must stay instant.** The annotation toolbar trash button must not open a
   confirmation dialog.
7. **Do not regress annotation input modes:**
   - Highlight/underline = native browser text selection mapped through the PDF.js text layer.
   - Box = drag rectangle. Only Box mode may put the annotation layer into pointer-capturing mode.
   - Annotation names are a hover tooltip: after 0.5 s over an annotation, show `@page:label` at the
     cursor's bottom-right. Clear it on leave, click, scroll, drag start, paper switch and unmount. Do
     not reintroduce persistent on-page labels, the old Tags toggle, or a native `title` tooltip.
   - Clicking outside an annotation clears the blue selection ring.
8. **Paper titles are editable.** Use the centered prompt dialog and `PATCH /api/papers/:id`.
   Uploaded papers also get an automatic LLM title from the first page; keep the filename fallback.
9. **Subfolder add actions use the same `FolderPlus` icon as the FOLDERS header.**
10. **Keep all UI copy in English** and use the existing monospace design system. Do not introduce
   Tailwind, a component library, or a new font without discussion.
11. **Keep annotation coordinates normalized** (`0..1` relative to the rendered page). Never store
   pixel coordinates tied to one zoom level.
12. **Do not execute uploaded skill code.** Skills are readable instructions/files only.
13. **Do not add telemetry, cloud storage, analytics, or a multi-user auth system** without explicit
    approval.
14. Update documentation when behavior, API shape, data model or workflow changes:
    `README.md`, `docs/PLAN.md`, `docs/ARCHITECTURE.md`, `docs/API.md`, `docs/DEPLOYMENT.md`,
    `docs/TODO.md`, `docs/DEVLOG.md`.
15. **Develop on `deploy`; merge to `main` only after explicit user approval.** Never commit
    application or deployment changes directly to `main`, and never rewrite published history.
16. **Keep loopback the default.** Binding to `0.0.0.0` requires explicit approval, must stay opt-in
    (`PAPERLENS_BIND` for Docker, `HOST` for native), and must be documented with TLS guidance.
    Never commit `.env`.

---

## 4. Repository map

```
paperlens/
├── AGENTS.md                 # this file
├── README.md                 # user-facing setup and feature overview
├── Dockerfile                # multi-stage production image
├── docker-compose.yml        # loopback deployment + persistent data volume
├── .dockerignore
├── .gitignore
├── package.json              # npm workspace + root scripts
├── node_modules/             # gitignored
├── docs/
│   ├── PLAN.md               # product plan, requirements, milestones
│   ├── ARCHITECTURE.md       # data model, flows, design decisions
│   ├── API.md                # HTTP API and SSE contract
│   ├── DEPLOYMENT.md         # Docker, systemd, backups, security
│   ├── TODO.md               # shipped + roadmap
│   └── DEVLOG.md             # decisions and change history
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── scripts/
│   │   ├── print-token.mjs
│   │   └── smoke.mjs         # isolated end-to-end API test
│   ├── src/
│   │   ├── index.ts          # Express bootstrap, auth gate, static SPA
│   │   ├── config.ts         # env, dirs, token, ids
│   │   ├── db.ts             # schema, inline migrations, seed
│   │   ├── auth.ts           # bearer token check
│   │   ├── http.ts           # HttpError, asyncRoute, validation helpers
│   │   ├── routes/
│   │   │   ├── auth.ts
│   │   │   ├── collections.ts
│   │   │   ├── papers.ts
│   │   │   ├── annotations.ts
│   │   │   ├── settings.ts
│   │   │   ├── models.ts
│   │   │   ├── skills.ts
│   │   │   └── chat.ts
│   │   └── services/
│   │       ├── pdf.ts        # metadata, first-page text, lazy page-text cache
│   │       ├── title.ts      # LLM paper-title detection + fallbacks
│   │       ├── llm.ts        # prompt, tools, SSE, fallback, history
│   │       └── skills.ts     # zip extraction, metadata, safe reads
│   └── data/                 # gitignored LIVE DATA
└── web/
    ├── package.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── main.tsx          # React root + DialogProvider
        ├── App.tsx           # session, library state, layout, toasts
        ├── components/
        │   ├── Login.tsx
        │   ├── Sidebar.tsx           # folder tree, paper list, upload/search
        │   ├── Reader.tsx            # PDF doc, toolbar, zoom, page nav, selection
        │   ├── PdfPage.tsx           # canvas, text layer, annotation layer, box drag
        │   ├── NotesRail.tsx         # aligned note stickers
        │   ├── ChatPanel.tsx         # SSE chat, citations, tool trace
        │   ├── Markdown.tsx          # GFM + KaTeX + citation links
        │   ├── SettingsModal.tsx     # Basic / Models / Skills tabs
        │   ├── DialogProvider.tsx    # centered confirm/prompt dialogs
        │   ├── ToastStack.tsx
        │   └── EmptyReader.tsx
        ├── lib/
        │   ├── api.ts                # typed API client + SSE parser
        │   ├── pdf.ts                # PDF.js setup + text geometry
        │   ├── selection.ts          # native selection -> page rects
        │   ├── constants.ts          # colors, theme presets, Tool type
        │   └── types.ts
        └── styles/index.css          # the whole design system
```

---

## 5. Architecture at a glance

```
Browser
  Sidebar ── collections/papers ──┐
  Reader ── PDF.js canvas+text ───┤
  NotesRail ── notes ─────────────┤── api.ts (Bearer token, SSE)
  ChatPanel ── messages ──────────┘
                  │
Express /api
  auth · collections · papers · annotations · settings · models · skills · chat
  chat ──> services/llm.ts ──> OpenAI-compatible provider chain + tool loop
  pdf  ──> services/pdf.ts ──> metadata + first page + unpdf page-text cache
  upload ──> services/title.ts ──> first enabled LLM -> paper title
  skills ──> adm-zip extraction + SKILL.md metadata
                  │
SQLite (node:sqlite) + local files in server/data/
```

Key flows:

- **Upload**: multipart → validate PDF → `inspectPdf` (page count, metadata title, first-page text)
  → file in `server/data/uploads/<uuid>.pdf` → row in `papers` with a provisional title →
  `services/title.ts` asks the first enabled model for the real title (20 s timeout, parallel for
  multi-file uploads) → title updates in SQLite and the upload response. Any failure keeps the
  metadata/filename fallback.
- **Render**: PDF.js loads `/api/papers/:id/file` with an Authorization header. Pages are sized from
  `getViewport({scale:1})`; the reader fits the widest page to available width; first 6 pages render
  eagerly, the rest via `IntersectionObserver`. Text layers are PDF.js `TextLayer` instances with
  `--scale-factor`.
- **Annotate**: native selection rectangles (`lib/selection.ts`) for highlight/underline, drag
  rectangle for box → normalize → `POST /api/annotations` → server allocates `type_N` label and
  optionally stores a PNG crop.
- **Chat**: POST ids only → server snapshots annotations → prompt + history → first enabled model →
  streaming tool loop → SSE (`meta`, `delta`, `tool_call`, `tool_result`, `warning`, `error`,
  `done`) → assistant message + tool trace saved in `messages`.
- **Fallback**: models ordered by `sort_order`; a failure before any visible content or successful
  tool execution moves to the next model and emits `warning`.

---

## 6. Database conventions

Schema lives inline in `server/src/db.ts`. There is no migration framework yet.

### Current tables

| Table | Notes |
| --- | --- |
| `collections` | `parent_id` self-reference = folder tree |
| `papers` | `collection_id` nullable (`ON DELETE SET NULL`), PDF metadata |
| `annotations` | `paper_id` cascade, `type`, `page`, `label`, `color`, `rects` JSON, `text`, `note`, `image_name` |
| `paper_pages` | lazy text cache, PK `(paper_id, page)` |
| `messages` | chat history, `citations`/`tools` JSON |
| `models` | provider chain, `enabled`, `sort_order`, plaintext `api_key` (local only); legacy `vision` column is unused |
| `skills` | extracted skill metadata |
| `settings` | key/value (`theme_color`, `ai_language`, `notes_rail`) |

### Rules

- Use `newId()` (UUID) and `now()` (ISO string) from `server/src/config.ts`.
- JSON columns are TEXT: always `JSON.stringify` on write and `JSON.parse` on read; tolerate bad
  legacy values defensively.
- Foreign keys are ON. Respect existing cascade semantics:
  - paper delete → annotations/messages/page cache cascade;
  - folder delete → papers become uncategorized, direct subfolders are manually promoted one level.
- Schema changes must be **additive migrations**. Follow the existing pattern:

  ```ts
  const columns = db.prepare('PRAGMA table_info(my_table)').all() as { name: string }[];
  if (!columns.some((column) => column.name === 'new_column')) {
    db.exec('ALTER TABLE my_table ADD COLUMN new_column TEXT;');
  }
  ```

- Never `DROP TABLE`, recreate the DB, or assume an empty database. The user's DB may already
  contain data.
- Add indexes for foreign keys used in list/lookup paths.
- If a migration needs data backfill, write it idempotently and document it in `docs/DEVLOG.md`.
- Folder moves must reject cycles (`isDescendant` in `routes/collections.ts`).

---

## 7. Backend conventions

- ESM + `NodeNext`: **all relative imports end in `.js`** (e.g. `import { db } from '../db.js'`).
- Strict TypeScript. No `any` unless unavoidable and local.
- Route mounting and auth live in `server/src/index.ts`. Every `/api` route is protected except
  `/api/health` and `/api/auth/login`.
- Use `HttpError(status, message)` and `asyncRoute(...)` from `http.ts`. Express 4 does not catch
  rejected async handlers automatically.
- Validate every external input in the route/service (`asString`, `asNumber`, `optionalString`,
  explicit checks). Do not trust client-side validation.
- Return JSON errors as `{ error: "..." }`; the frontend already parses this shape.
- Never return raw API keys. `publicModel()` masks them; PATCH ignores masked values.
- Upload limits: 100 MB/PDF, 20 files; JSON 16 MB; box crops 8 MB; skills 50 MB zip / 60 MB
  uncompressed / 500 files.
- Skill archive paths must be checked for absolute paths, `..` and NUL bytes. Never extract outside
  the skill directory.
- PDFs are streamed with `res.sendFile` so range requests work.
- Annotation image URLs may carry `?token=` because `<img>` cannot send headers; the auth middleware
  accepts header or query token.
- Keep the server bound to loopback by default. If you add network exposure, document the security
  implications.

### Adding an endpoint (checklist)

1. Implement in the relevant `routes/*.ts` (or a new route file) with validation.
2. Mount it under `/api` in `index.ts` **after** the auth gate.
3. Add a typed method in `web/src/lib/api.ts`.
4. Update `docs/API.md`.
5. Add a check to `server/scripts/smoke.mjs` when it is testable without an LLM.
6. Run typecheck/build/smoke.

### Adding a setting

1. Add the key to `server/src/routes/settings.ts` with validation.
2. Seed a default in `db.ts` if necessary.
3. Add it to `web/src/lib/types.ts` (`Settings`).
4. Use it in `App.tsx` / Reader / Chat etc., and update Settings UI.
5. Document it.

---

## 8. Frontend conventions

- React function components + hooks. No class components, no state library, no router.
- `App.tsx` owns session, settings, collections, paper list, active paper, annotations, panel state
  and toasts. Pass callbacks down; do not duplicate server state in unrelated components.
- Network access goes through `web/src/lib/api.ts` (or `streamChat`). Do not scatter raw fetch calls
  in components.
- Error UX: call `pushToast(message, 'error')` in App (or pass `onNotice`). Do not alert.
- Confirmation/prompt UX: `useConfirm()` / `usePrompt()` from `DialogProvider`. Dialogs are centered,
  keyboard-friendly and promise-based.
- Annotation deletion is intentionally unconfirmed.
- All UI copy is English, compact and monospace. Use CSS variables (`--accent`, `--panel`,
  `--border`, `--text`, `--muted`, `--danger`, …) and existing class names.
- Icons come from `lucide-react`.
- CSS lives in `web/src/styles/index.css`; keep additions near the related section and use
  `color-mix(in srgb, ...)` for tints.
- Never import PDF.js CSS or use browser dialogs.
- Respect `prefers-reduced-motion` if you add large animations (not currently handled globally).
- Do not add a new dependency for a small UI helper. Prefer existing primitives.

### Important frontend structures

- `Reader` has a local state variable named `document` (the PDF document). **Use `window.document`**
  when attaching global DOM listeners inside this component.
- Reader measures available width after every render and via `ResizeObserver`; opening the notes rail
  or AI panel must re-fit pages.
- `PdfPage` owns the canvas, PDF.js text layer and annotation overlay. `ann-layer` must only have
  `drawing-mode` (pointer capture) for **Box**; otherwise native text selection must pass through.
- `lib/selection.ts` maps the native selection anchor to a page, merges line rects and returns
  normalized rects + text + a popover anchor. Do not replace native selection with a text-drag
  rectangle for highlight/underline.
- Annotation names are not persistent. `PdfPage` reports hover enter/move/leave to `Reader`; after a
  500 ms timer Reader shows a fixed tooltip at cursor-bottom-right. Do not add a native `title`
  attribute (it would create a second browser tooltip). Clicking anywhere outside an annotation
  clears `selectedId`.
- Paper titles are renamed from the sidebar (double-click or pencil) through the centered prompt and
  `PATCH /api/papers/:id`; App updates both the list and the open paper.
- `NotesRail` positions stickers at `pageTop + rect.y * pageHeight`, measures card heights with a
  `ResizeObserver`, and pushes overlapping cards down.
- Chat streaming is a manual SSE parser in `api.ts`; keep the `event:`/`data:` framing and handle
  partial chunks. Aborting must stop the server request.
- Chat markdown: `remark-gfm`, `remark-math`, `rehype-katex`, custom citation links. Backslash
  delimiters are normalized outside fenced/inline code. Keep citation links (`#cite:page:label`)
  working.
- Dialogs: `DialogProvider` stores the active dialog in a ref as well as state. Keep the ref in sync
  when the input changes; resolve promises outside `setState` updaters.

### Adding a UI action (checklist)

1. Add the API method and server route/validation.
2. Keep state in App (or local if truly ephemeral).
3. Use existing icons, dialog helpers, toasts and CSS tokens.
4. Verify keyboard and click paths, empty states and error paths.
5. Update docs/TODO/DEVLOG when behavior is user-visible.

---

## 9. AI subsystem

Primary file: `server/src/services/llm.ts`.

### Prompt and history

- System prompt includes paper title/pages, today's date, response language, citation rules, strict
  Markdown + LaTeX rules, and installed skills.
- Language comes from the `ai_language` setting; native language names are used in the prompt.
- History is loaded **before** the new user message is inserted (otherwise it would be duplicated).
- Attached citations are snapshotted **server-side from annotation ids**. Never trust client-supplied
  annotation text.
- Citation labels are `@page:label`; the model is instructed to cite with the exact labels.

### Tools

- `search_paper`, `read_page`, `read_pages`, `list_annotations`, `read_annotation`,
  `get_paper_info`, and (when skills exist) `list_skills`, `use_skill`, `read_skill_file`.
- Max 6 tool steps per model attempt.
- Tool traces are streamed and persisted as JSON on the assistant message.
- Short model narration before a tool call (under 240 chars) is buffered and discarded; longer text
  streams immediately. Do not remove this without considering UX.
- Page text is extracted lazily by `services/pdf.ts` and cached in `paper_pages`.

### Title detection

- `services/title.ts` runs during upload, uses the highest-priority enabled model once with
  `temperature: 0`, `max_tokens: 100`, a 20 s timeout and only the first-page text (max 8k chars),
  metadata title and filename.
- It must return one line, strip prefixes/quotes/Markdown, preserve the original language, and never
  invent a title. If no model exists or the call fails, return null and keep metadata/filename.
- Title detection is awaited by the upload response even for multiple files (parallel). Do not move
  it into an unobservable background job without adding a way for the UI to refresh titles.

### Providers

- Models are ordered by `sort_order`; only `enabled = 1` are called.
- Disable moves a model to the bottom and disables it; delete removes it.
- Fallback happens only if there is no streamed visible text and no successful tool execution.
- Box-crop images are attached as `image_url` parts for every model. If a provider rejects image input, the fallback chain continues and the UI reports that the model does not support vision. The legacy `vision` column is ignored.
- Never return un-masked keys to the client.

### SSE contract

Keep these event names and JSON shapes:

```
event: meta          { model, modelName, attempt, total }
event: delta         { text }
event: tool_call     { id, name, args }
event: tool_result   { id, name, ok, summary }
event: warning       { message }
event: error         { message }
event: done          { userMessageId, assistantMessageId, model, error, aborted }
```

The frontend parser and smoke test depend on this. End each event with a blank line and call
`res.end()` when finished.

---

## 10. PDF and annotation details

- Annotations store an array of normalized rects plus extracted text.
- Labels are allocated per paper/type using the max numeric suffix (`highlight_3` → next
  `highlight_4`), not row count.
- Highlights render as translucent annotation-colour fills with `mix-blend-mode: multiply`; do not
  remove the background (it makes them invisible).
- Underlines render as bottom borders per line.
- Boxes render as an outlined rectangle, capture the text inside, and store a PNG crop of the
  rendered canvas.
- Only Box puts `.ann-layer` into `drawing-mode`. Highlight/underline rely on native selection.
- Selection popover: Select mode opens a floating menu with colour swatches + Highlight/Underline;
  Highlight/Underline tool modes apply immediately and return to Select.
- The notes rail is outside the page, width-matched to the rail, and vertically aligned to the first
  annotation rect (with collision push-down).
- Hovering an annotation for 500 ms shows `@page:label` in a floating tooltip at the cursor's
  bottom-right. The tooltip is not a native `title`, does not block pointer events, moves with the
  cursor and disappears on leave/click. The blue selection ring is cleared by clicking outside the
  annotation.

---

## 11. Feature recipes

### New folder capability

- Server: `routes/collections.ts` owns tree validation (`parent_id`, cycles, duplicate names in the
  same parent). Deleting promotes children one level.
- Client: `Sidebar.tsx` builds the tree from the flat list, sorts siblings by name, keeps collapsed
  ids in local state, and supports drag-to-reparent.
- Do not assume an `Inbox` folder exists; the user may delete it.

### New annotation type

This is a larger change. Touch all of:
- DB `type` validation (`routes/annotations.ts`),
- `web/src/lib/types.ts` + constants,
- `PdfPage` rendering and creation logic,
- Reader tool state/keyboard shortcuts,
- AI tools/citation formatting,
- CSS, docs and smoke test.

### New model setting

Add columns via idempotent migration, include them in `publicModel`, PATCH validation and the
Settings form. Never return secret fields.

### New skill capability

- Upload/extraction lives in `services/skills.ts`; keep path traversal and size protections.
- `SKILL.md` frontmatter supplies name/description.
- The agent can only read skill files; never execute them.
- If you expose a file browser, enforce the same path checks.

---

## 12. Testing and validation

### Automated

```bash
npm run typecheck
npm run build
npm run smoke       # builds the server, then runs isolated API checks
```

`npm run smoke`:
- spawns `server/dist/index.js` on port **8899**;
- uses a fresh temp data dir and `APP_TOKEN=smoke-test-token`;
- starts with no models, so no external model call is made;
- covers auth, folders/subfolders/cycles, upload, PDF streaming, annotations/crops/notes, search,
  settings, model masking/disable, skills, empty history, no-model chat error and cleanup.

Add checks for new API behavior. Do not make the smoke test depend on the network or an LLM.

For deployment changes, also verify the production image:

```bash
docker compose build
docker compose up -d
curl -fsS http://127.0.0.1:8787/api/health
```

Use an isolated Compose project name (`docker compose -p paperlens-check ...`) or a temporary volume
when you do not want to touch an existing deployment.

### Isolated manual testing (recommended)

Avoid mutating the live library:

```bash
PORT=8898 PAPER_READER_DATA=/tmp/paper-reader-agent-data APP_TOKEN=agent-token \
  npm run dev -w server
```

For a fully isolated SPA, build and run the production server on the alternate port:

```bash
npm run build
PORT=8898 PAPER_READER_DATA=/tmp/paper-reader-agent-data APP_TOKEN=agent-token \
  npm start
# http://127.0.0.1:8898/?token=agent-token
```

If you must use the running dev app, create temporary folders/papers/annotations and delete them
afterwards. Never bulk-delete library data.

### UI checklist for relevant changes

- Token login, reload persistence, sign out.
- Folder tree: create root/child (`FolderPlus` icons), collapse/expand, rename, drag-reparent,
  delete promotion.
- Upload/search; empty states; LLM title detection (filename fallback when no model).
- Paper rename via double-click or pencil → centered prompt; list and open paper update.
- PDF render, page nav, zoom, re-fit when notes/chat open.
- Native selection → popover highlight/underline; Highlight/Underline mode auto-apply; box drag.
- Highlight colour visible; hover an annotation 0.5 s → tooltip at cursor bottom-right; click
  elsewhere clears the blue selection ring.
- Double-click annotation → note sticker aligned and persisted.
- Drag annotation → chat citation chip; inline citation click jumps/flashes.
- Streaming chat, tool trace, Markdown, KaTeX, code blocks, citation links, stop, clear.
- Model fallback and language preference.
- Settings Basic/Models/Skills.
- Centered confirm/prompt dialogs; instant annotation deletion.

### Headless browser notes (if used)

- Chrome headless may report `document.visibilityState === 'hidden'`, which pauses
  `requestAnimationFrame` and stalls PDF.js rendering. Use CDP
  `Emulation.setFocusEmulationEnabled` + `Page.setWebLifecycleState({state:'active'})`.
- Smooth scrolling and CSS transitions may be frozen in headless; verify final state, not intermediate
  animation.
- Injecting `?token=` is the easiest way to authenticate a headless session.

---

## 13. Definition of done

A change is complete only when:

- [ ] Behavior matches [docs/PLAN.md](docs/PLAN.md) and the user's request.
- [ ] `npm run typecheck` passes for both packages.
- [ ] `npm run build` passes.
- [ ] `npm run smoke` passes when server/API behavior changed.
- [ ] Relevant browser flows were exercised (or the limitation is called out).
- [ ] No live user data was deleted or mutated without permission.
- [ ] Work was committed to `deploy`; `main` was updated only after explicit user approval.
- [ ] `docker compose build` and `/api/health` pass when deployment files changed.
- [ ] No secrets are logged, returned or committed.
- [ ] No `window.confirm` / `window.prompt` / `window.alert` were introduced.
- [ ] UI copy is English and styling uses existing tokens.
- [ ] Docs updated: README/ARCHITECTURE/API/TODO/DEVLOG as applicable.
- [ ] `git status` contains only intended files (`server/data`, `dist`, `.env`, `node_modules` are
      ignored).
- [ ] Commit message is descriptive (project uses conventional prefixes such as `feat:`, `fix:`,
      `docs:`).

---

## 14. Common pitfalls

- **PDF page scaling**: don't measure width once. Opening/closing the sidebar, notes rail or AI panel
  changes available width; re-measure after render and via `ResizeObserver`.
- **`document` shadowing**: `Reader` has a `document` state for the PDF. Use `window.document`.
- **Text layer**: do not block it with a pointer-capturing overlay outside Box mode; highlight and
  underline depend on native selection.
- **Selection mapping**: filter `Range.getClientRects()` to the anchor page, merge per line, normalize
  against the page rect, and ignore empty selections.
- **Hover labels**: use the 500 ms timer and cursor position; clear on leave, click, scroll, drag
  start, paper switch and unmount. Never add a `title` attribute (duplicate native tooltip) or persistent label badges.
  Highlights still need a real background.
- **Dialogs**: keep the active dialog ref and React state in sync. Resolve promises outside state
  updater functions to avoid StrictMode surprises.
- **SSE**: preserve framing and flush events. Abort requests when the panel unmounts.
- **Fallback**: only fall back before visible content or successful tool calls; otherwise surface the
  error and keep the partial answer.
- **Skills**: never write outside the skill directory; never execute scripts.
- **Auth**: `<img>` crop URLs use `?token=`; API calls use the Authorization header.
- **Vite**: the dev proxy targets `127.0.0.1:8787`. Changing the API host/port requires updating the
  proxy or using the production build.
- **`node:sqlite`**: it is synchronous and prints an experimental warning in Node 22+. That warning
  is expected.
- **Dependencies**: the web bundle is large because of PDF.js + KaTeX; do not add heavy libraries
  casually.

---

## 15. When to ask before acting

Ask the user before:

- deleting/resetting `server/data` or any library content;
- changing the auth/token model or binding the API to `0.0.0.0`;
- adding multi-user support, cloud sync, telemetry or external services;
- executing skill scripts or introducing a sandbox;
- replacing core libraries (PDF.js, React, SQLite, Express, OpenAI SDK);
- changing the UI language or design system;
- large schema rewrites or destructive migrations;
- force-pushing or rewriting git history;
- merging `deploy` into `main` without explicit approval;
- changing deployment networking or exposing the API beyond loopback without explicit approval
  (public binding is opt-in via `PAPERLENS_BIND` / `HOST`; document the TLS and token risks).
