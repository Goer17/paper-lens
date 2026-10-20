# PaperLens

**A local-first, annotation-grounded AI paper reader.**

PaperLens is a compact research workspace for reading PDFs, marking them up, and asking an AI
assistant questions that are grounded in the actual paper. It borrows the useful parts of Zotero —
folders, annotations, notes — and keeps the interface small, fast and entirely local.

The app runs as a React SPA plus a small Express API. PDFs, annotations, chats, model settings and
skills stay on your machine in SQLite and a local data directory.

---

## Why PaperLens

- **Local-first.** Your library and annotations never leave `server/data/`; only the text/images you
  explicitly send to a configured model leave the machine.
- **Evidence, not vibes.** Attach a highlight, underline or box to the chat and the assistant sees
  exactly what you marked. Answers cite labels such as `@4:underline_1`.
- **Built for real reading.** Native text selection, a notes rail, a nested folder tree, search,
  zoom and page navigation — without a heavyweight reference manager.

## Features

### Library

- Collapsible sidebar with a **nested folder tree**: create subfolders, expand/collapse, rename,
  drag folders between parents, and drop PDFs straight onto a folder.
- Drag papers between folders; delete folders without losing their contents (subfolders move up one
  level, papers become uncategorized).
- Full-text title/filename search and annotation counts.
- **AI paper titles**: on upload, the first enabled model identifies the title from the first page
  and replaces the provisional filename. Titles remain editable from the sidebar.

### Reading and annotation

- PDF.js rendering with lazy pages, fit-width zoom, page navigation and a PDF.js text layer.
- **Highlight and underline with normal native text selection** (drag across text exactly as usual).
  Select mode offers a floating Highlight/Underline menu; the H/U tools apply immediately.
- **Box annotations** use a drag rectangle and save both the captured text and a PNG crop.
- Hover an annotation for 0.5 s to see its `@page:label` at the cursor. Clicking elsewhere clears the
  blue selection ring; deleting an annotation is instant.
- Double-click an annotation to pin a note sticker in the right-hand notes rail, vertically aligned
  with the annotation. Notes autosave.
- Translucent annotation colours, independent of the UI theme.

### AI assistant

- Slide-over chat with streaming SSE, visible tool-call traces and full conversation history.
- Drag annotations into the composer to add citations like `@3:underline_1`; box citations also carry
  a crop that vision-capable models can inspect.
- Tools for full-text search, page reading, annotation reading, paper info and installed skills.
- Strict Markdown rendering with GFM tables/code and **KaTeX LaTeX** (`$...$`, `$$...$$`, `\(...\)`,
  `\[...\]` outside code blocks). Citation labels in answers are clickable and jump to the page.
- Stop generation, clear the thread and replay tool traces.

### Models, skills and UI

- OpenAI-compatible provider list: base URL, API key, model name, optional vision flag. Reorder by
  priority; failures fall back to the next enabled model automatically. Disabled models move to the
  bottom; keys are never returned unmasked.
- Response language preference (English, Chinese, Japanese, Korean, Spanish, French, German).
- Agent **Skills**: upload a `.zip`, it is extracted safely, parsed from `SKILL.md`, and shown in a
  four-column folder grid. The agent loads skills through `use_skill` / `read_skill_file`.
- Accent-colour presets plus a custom colour picker.
- Centered app dialogs for confirmations and renames; all UI copy is English and monospace.

## Stack

| Layer | Choice |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, PDF.js, react-markdown, KaTeX, Lucide |
| Backend | Node.js, Express 4, TypeScript, SSE |
| Database | SQLite via Node's built-in `node:sqlite` |
| Files | Local disk (`server/data/uploads`, `annotations`, `skills`) |
| AI | OpenAI SDK against any OpenAI-compatible provider |
| PDF text | `unpdf` on the server, cached page-by-page in SQLite |

---

## Quick start

Requirements: **Node.js 22+** and npm.

```bash
npm install

# Optional: seed the debug model on a fresh database
export DEEPSEEK_API_KEY=sk-your-key

npm run dev
```

- Web app: <http://localhost:5173>
- API: <http://127.0.0.1:8787>
- The access token is stored in `server/data/token.txt` (or supplied through `APP_TOKEN`).
  Paste it once on the login screen; the browser remembers it. `npm run token` prints it.
  The token is intentionally not written to the server log.
- Shortcut: open `http://localhost:5173/?token=<TOKEN>`; the token is stored and removed from the URL.

### Debug model

On the first run, if `DEEPSEEK_API_KEY` is present, PaperLens seeds this model:

| Setting | Value |
| --- | --- |
| Base URL | `https://api.deepseek.com` |
| API key | `$DEEPSEEK_API_KEY` |
| Model | `deepseek-flash` |

Any other OpenAI-compatible provider can be added in **Settings → Models**.

### Production

```bash
npm run build
npm start
```

The API server serves the built SPA on <http://127.0.0.1:8787>. Override with `HOST` / `PORT`.

Docker is the recommended deployment:

```bash
git clone -b deploy git@github.com:Goer17/paper-lens.git
cd paper-lens
cp .env.example .env      # optional: set APP_TOKEN or DEEPSEEK_API_KEY
docker compose up -d --build
docker compose exec paperlens cat /data/token.txt
```

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for backups, upgrades, native systemd setup and
security notes.

### Branch workflow

All development happens on the **`deploy`** branch. Changes are merged into `main` only after the
user has reviewed and approved them. See [AGENTS.md](AGENTS.md).

---

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | API + Vite dev server with hot reload |
| `npm run build` | Type-check and build server + web |
| `npm start` | Run the compiled API server (serves `web/dist` when present) |
| `npm run typecheck` | TypeScript checks for both packages |
| `npm run smoke` | Isolated end-to-end API test (builds the server first) |
| `npm run token` | Print the current access token |

## Configuration

| Variable | Purpose |
| --- | --- |
| `DEEPSEEK_API_KEY` | Seeds the debug model on the first empty database |
| `DEEPSEEK_BASE_URL` | Defaults to `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | Defaults to `deepseek-flash` |
| `HOST` | API bind address, default `127.0.0.1` |
| `PORT` | API port, default `8787` |
| `APP_TOKEN` | Override the generated workspace token |
| `PAPER_READER_DATA` | Data directory, default `server/data` |

## Project layout

```
paperlens/
├── AGENTS.md               # Guide for AI coding agents and contributors
├── README.md
├── Dockerfile              # Multi-stage production image
├── docker-compose.yml      # Loopback-only deployment with a data volume
├── docs/
│   ├── PLAN.md             # Product plan and requirements
│   ├── ARCHITECTURE.md     # Data model, flows, decisions
│   ├── API.md              # HTTP API and SSE contract
│   ├── DEPLOYMENT.md       # Docker, systemd, backups and security
│   ├── TODO.md             # Shipped work and roadmap
│   └── DEVLOG.md           # Development log
├── server/                 # Express API, SQLite, SSE, AI tools
│   ├── src/
│   │   ├── routes/         # auth, collections, papers, annotations, models, skills, chat
│   │   ├── services/       # pdf, title detection, llm (tools + fallback), skills
│   │   ├── db.ts           # schema + idempotent migrations + seed
│   │   └── index.ts
│   ├── scripts/            # print-token, smoke test
│   └── data/               # runtime data (gitignored)
└── web/                    # React SPA
    └── src/
        ├── components/     # Reader, PdfPage, NotesRail, ChatPanel, Settings, dialogs…
        ├── lib/            # API client, PDF/selection helpers, types
        └── styles/
```

## How it works

- **Upload** parses the PDF, stores it locally, then asks the first enabled model for the real title
  from the first-page text (metadata/filename fallback).
- **Annotations** are stored as normalized rectangles (`0..1`) plus extracted text. Highlights and
  underlines come from native selection; boxes come from a drag rectangle and save a PNG crop.
- **The notes rail** positions stickers at the annotation's page offset and pushes overlapping cards
  down, keeping them aligned with the page.
- **Chat** sends a system prompt (paper, language, citation and LaTeX rules), recent history and
  server-snapshotted citations to the first enabled model. The model can call paper tools and
  installed skills. Streaming events, tool traces and the final message are persisted.
- **Fallback** tries the next enabled model if a request fails before producing visible content or a
  successful tool call.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design.

## Data and privacy

- Everything is local: SQLite and files under `server/data/`.
- Provider API keys are stored in the local database and only returned masked. They are sent only to
  the base URL you configure.
- The app is a single-user local workspace. Do not expose port 8787 publicly without TLS and a proper
  authentication story.
- Delete `server/data/` to reset the workspace (a new token will be generated). Back it up to keep
  your library.

## Documentation

- [Agent development guide](AGENTS.md)
- [Product plan](docs/PLAN.md)
- [Architecture](docs/ARCHITECTURE.md)
- [HTTP API](docs/API.md)
- [Deployment](docs/DEPLOYMENT.md)
- [TODO / roadmap](docs/TODO.md)
- [Development log](docs/DEVLOG.md)

## Status

v0.1.0 — usable end-to-end. See [docs/PLAN.md](docs/PLAN.md) and [docs/TODO.md](docs/TODO.md) for
the next milestones.
