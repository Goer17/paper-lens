# PaperLens Architecture

## Overview

```
┌──────────────────────────── Browser (React SPA) ────────────────────────────┐
│                                                                              │
│  Sidebar            Reader (PDF.js)                    AI panel              │
│  folders/papers     pages + text + annotation layers   SSE chat + tools      │
│         │                    │                              │                │
│         └────────── api.ts (Bearer token) ──────────────────┘                │
└──────────────────────────────────┬───────────────────────────────────────────┘
                                   │ /api (JSON, multipart, SSE)
┌──────────────────────────────────▼───────────────────────────────────────────┐
│ Express API                                                                  │
│  auth · collections · papers · annotations · settings · models · skills      │
│  chat ──> services/llm.ts ──> OpenAI SDK (provider chain + tool loop)        │
│  papers ──> services/pdf.ts (unpdf text extraction, cached in SQLite)        │
│  skills ──> adm-zip (safe extraction, SKILL.md metadata)                     │
│                                                                              │
│ SQLite (node:sqlite)   server/data/{uploads,annotations,skills}              │
└──────────────────────────────────────────────────────────────────────────────┘
```

The frontend never talks to an LLM directly. All API keys stay server-side and are returned to the
client only in masked form.

## Packages and responsibilities

### `server/`

| Area | Files | Responsibility |
| --- | --- | --- |
| Bootstrap | `src/index.ts`, `src/config.ts` | env, directories, token, middleware, static SPA, error handling |
| Persistence | `src/db.ts` | schema creation, seed data, settings helpers |
| Auth | `src/auth.ts` | bearer token check (constant-time), login route |
| Library | `routes/collections.ts`, `routes/papers.ts` | folder CRUD, upload, search, PDF streaming |
| Reading | `routes/annotations.ts` | normalized rectangles, label allocation, crops |
| AI | `services/llm.ts` | system prompt, tools, tool-call loop, fallback, SSE, history |
| PDF | `services/pdf.ts` | metadata, lazy text extraction, page text cache |
| Skills | `services/skills.ts` | zip extraction, metadata parsing, safe file reads |
| Settings / models | `routes/settings.ts`, `routes/models.ts` | preferences, provider chain, connection test |

### `web/`

| Area | Files | Responsibility |
| --- | --- | --- |
| Shell | `App.tsx`, `main.tsx` | auth bootstrap, library state, toasts, layout |
| Library | `components/Sidebar.tsx` | folders, paper list, search, drag/drop upload |
| Reader | `components/Reader.tsx` | PDF document, zoom/fit, page nav, tools, notes rail |
| Page | `components/PdfPage.tsx` | canvas + text layer + annotation layer + drag creation |
| Notes | `components/NotesRail.tsx` | anchored note stickers and autosave |
| Chat | `components/ChatPanel.tsx`, `Markdown.tsx` | SSE stream, tool trace, citations, Markdown |
| Settings | `components/SettingsModal.tsx` | Basic / Models / Skills tabs |
| Client | `lib/api.ts`, `lib/pdf.ts`, `lib/types.ts` | requests, SSE parser, text-geometry helpers |

## Data model

SQLite, WAL mode, foreign keys ON.

| Table | Key columns |
| --- | --- |
| `collections` | `id`, `name`, `parent_id → collections` (tree), `created_at` |
| `papers` | `id`, `collection_id → collections`, `title`, `filename`, `stored_name`, `size`, `pages`, timestamps |
| `annotations` | `id`, `paper_id → papers`, `type` (`highlight`/`underline`/`box`), `page`, `label`, `color`, `rects` JSON, `text`, `note`, `image_name` |
| `paper_pages` | `(paper_id, page)` → extracted text (lazy cache) |
| `messages` | `id`, `paper_id`, `role`, `content`, `citations` JSON, `tools` JSON, `model`, `created_at` |
| `models` | `id`, `name`, `base_url`, `api_key`, `model_name`, `enabled`, `sort_order` (legacy `vision` column is unused) |
| `skills` | `id`, `name`, `description`, `dir_name`, `file_count`, `created_at` |
| `settings` | `key` / `value` (`theme_color`, `ai_language`, `notes_rail`) |

`ON DELETE CASCADE` removes annotations, messages and cached page text with a paper. Deleting a
folder sets `collection_id` to `NULL` (Uncategorized).

## Authentication

- A random 24-byte URL-safe token is generated on first boot (or taken from `APP_TOKEN`), written to
  `server/data/token.txt` with mode `0600`, and never printed in the server log. `npm run token`
  prints it on demand.
- Clients store it in `localStorage` and send `Authorization: Bearer <token>`.
- `timingSafeEqual` comparison. All `/api` routes except `/api/health` and `/api/auth/login` are
  protected.
- `<img>` requests for annotation crops may pass `?token=` because browsers cannot attach headers to
  image tags; the server accepts either form.
- A 401 triggers the client to clear the token and show the login screen.

## Upload and title detection

1. `POST /api/papers` validates each PDF and calls `inspectPdf` (page count, metadata title,
   first-page text).
2. The file is written to `server/data/uploads/<uuid>.pdf` and a row is inserted with a provisional
   title (`metadata title` or filename without `.pdf`).
3. `services/title.ts` asks the highest-priority enabled model to return only the paper title. The
   prompt receives the filename, metadata title and up to 8k characters of first-page text;
   temperature is `0`, max output 100 tokens, timeout 20 s. Multi-file uploads run these calls in
   parallel.
4. The title is cleaned (single line, no quotes/prefixes/Markdown) and written to `papers.title`.
   If no model is configured, the document has no text, or the call fails, the provisional title is
   kept.
5. The upload response already contains the final title. Paper titles remain editable via the
   sidebar rename prompt and `PATCH /api/papers/:id`.

## Annotation geometry

- Rectangles are normalized to `[0, 1]` against the rendered page, so zoom, notes rail, and AI panel
  toggles do not change stored data.
- Highlights/underlines use the browser's native text selection. On `mouseup`, the selection's
  client rectangles are intersected with the page that owns the anchor, merged per line, normalized,
  and paired with the selected text. They render as per-line blocks (translucent colour fill for
  highlights, bottom border for underlines). In Select mode a small floating menu offers
  Highlight/Underline; in Highlight or Underline mode the annotation is created immediately and the
  tool returns to Select.
- Annotation names are shown on demand: after hovering an annotation for 500 ms, Reader displays a
  floating `@page:label` tooltip at the cursor's bottom-right. It follows the cursor, never blocks
  pointer events, and disappears on leave, click, scroll, drag start, paper switch or unmount. There are no persistent
  on-page label badges. Clicking outside an annotation clears the blue selection ring.
- Boxes are the only drag mode: a free rectangle plus the text captured inside it. On the client,
  the rendered canvas is cropped to a PNG (`image_data_url`) and stored by the server.
- Labels are allocated per paper and type (`highlight_1`, `underline_2`, `box_1`).
- Server validates type, page, color, and every rectangle before writing.

## Reader layout and scaling

- The sidebar renders `collections` as a tree (sorted by name per level). Rows can be collapsed,
  dragged onto another folder to re-parent (the server rejects cycles), and dropped onto All Papers
  to move back to the root. New subfolders are created from the row action. Deleting a folder
  promotes its direct subfolders one level and lets its papers fall back to Uncategorized.
- Page sizes come from `page.getViewport({ scale: 1 })` for every page. The reader measures the
  scroll container's content width, subtracts the notes rail when visible, and fits the widest page
  to the remaining width, multiplied by the zoom factor.
- Measurement runs after every render and on `ResizeObserver`/window resize so opening the sidebar,
  notes rail, or AI panel immediately re-fits the page.
- Pages render lazily: the first six pages eagerly, the rest when they approach the viewport
  (`IntersectionObserver`). Text layers come from PDF.js `TextLayer` with `--scale-factor`.
- The notes rail is a sibling column inside the same scroll area. A note's target top is
  `pageTop + rect.y * pageHeight`; cards are measured and pushed down to avoid overlap, keeping each
  sticker aligned with its annotation unless a collision forces a nudge. Sticker width equals the
  rail width.

## Chat pipeline

1. Client posts `{ paper_id, message, citation_ids }` to `POST /api/chat`.
2. Server snapshots the referenced annotations (never trusts client text), saves the user message,
   and builds a prompt:
   - system: paper title/pages, `ai_language`, citation rules, Markdown rules, available skills;
   - last 16 messages (with citation excerpts re-attached);
   - current user message + `<citation>` blocks.
3. For box citations, the saved PNG crop is attached as an image part.
4. The provider chain is ordered by `sort_order`. Each model runs the OpenAI SDK streaming tool loop:
   five rounds with `tool_choice: "auto"`, then one final round with `tool_choice: "none"` (or no tool
   definitions if the provider rejects `none`) so the attempt always ends with prose. Tools:
   `search_paper`, `read_page`, `read_pages`, `list_annotations`, `read_annotation`,
   `get_paper_info`, `list_skills`, `use_skill`, `read_skill_file`.
   - An identical tool call (same name and arguments) is skipped and answered with a
     `duplicate` result telling the model to use the earlier result and answer.
   - A model that still writes no text is not persisted: the SSE stream ends with an `error` event
     instead of saving an empty assistant message.
5. SSE events: `meta`, `delta`, `tool_call`, `tool_result`, `warning`, `error`, `done`.
6. Short narrative preambles before tool calls are buffered and dropped; content longer than 240
   characters streams immediately.
7. If a model fails before emitting content or executing a tool, the next model is tried and a
   `warning` is sent. Otherwise the error is surfaced and the partial answer is kept.
8. The assistant message and tool trace are saved to SQLite; the UI can replay the thread. Rows
   without answer text are never written, and the chat renders a muted note for legacy empty rows.
9. Markdown is rendered with `react-markdown` + GFM + `remark-math`/`rehype-katex`. Backslash
   delimiters `\(...\)` and `\[...\]` are normalized to dollar delimiters outside fenced/inline code
   before parsing, and citation tokens (`@page:label`) become clickable links.

### SSE contract

```
event: meta
data: {"model":"Example Model","modelName":"example-model","attempt":1,"total":2}

event: tool_call
data: {"id":"call_…","name":"read_page","args":"{\"page\":1}"}

event: tool_result
data: {"id":"call_…","name":"read_page","ok":true,"summary":"…"}

event: delta
data: {"text":"## Answer…"}

event: done
data: {"userMessageId":"…","assistantMessageId":"…","model":"Example Model","error":null,"aborted":false}
```

## Skills

- Upload accepts `.zip` only, max 50 MB, 500 files, 60 MB uncompressed.
- Entries with absolute paths, `..`, or NUL bytes are rejected; extraction is bounded to the skill
  directory.
- `SKILL.md` (or `README.md`, also inside a single top-level folder) is parsed for YAML-like
  frontmatter `name`/`description`; the first non-heading line is a fallback description.
- The agent can call `use_skill` to load the instructions and `read_skill_file` to read supporting
  text. The server does **not** execute uploaded code.

## Frontend state

- `App.tsx` owns session token, settings, collections, paper list, active paper, annotations, and
  panel state. Components receive callbacks.
- `DialogProvider` wraps the app and exposes promise-based `useConfirm()` / `usePrompt()` helpers.
  Dialogs are rendered as a centered overlay (never `window.confirm`/`window.prompt`), support
  Escape/Enter, focus Cancel for destructive actions, and return typed results. Deleting an
  annotation bypasses confirmation and removes it immediately.
- Annotation updates are optimistic for notes/colors; creates wait for the server so labels and
  crops are authoritative.
- The API client centralizes auth headers, error parsing, unauthorized handling, and SSE framing.
- The chat panel keeps a local streaming message and reconciles it with the persisted IDs on `done`.

## Decisions and tradeoffs

- **Node full-stack** keeps install to a single `npm install`; `node:sqlite` avoids native builds.
- **SQLite** is sufficient for a single-user local library and makes backups trivial.
- **Local disk for PDFs** avoids base64 blobs in SQLite and supports PDF.js range requests.
- **Server-side text extraction** (`unpdf`) gives the AI a reliable search corpus; client-side
  PDF.js only handles rendering and text geometry.
- **Normalized rects + text items** avoid storing per-zoom positions and keep highlights crisp.
- **SSE over WebSockets** is enough for one-way token streaming and survives simple proxies.
- **No arbitrary skill execution** is a deliberate safety boundary; skills are instructions plus
  readable files.

## Known limitations

- Scanned PDFs without a text layer yield empty annotation text; no OCR yet.
- Cross-page native text selections are anchored to the page where the selection starts; the other
  pages are ignored.
- Folder paper counts are direct counts (subfolder contents are not rolled up).
- PDF outline/bookmarks and cross-page note dragging are not implemented.
- The app is single-user; no multi-account isolation.
