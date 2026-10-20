# TODO

Living task list. Keep completed items for history; move detailed discussion to the dev log.

## v0.1 — shipped

- [x] Monorepo: React/Vite web + Express API, strict TypeScript
- [x] PaperLens branding and English product plan (`docs/PLAN.md`)
- [x] Random token login, persisted in `localStorage`, `?token=` helper, sign out
- [x] SQLite schema for folders, papers, annotations, messages, models, skills, settings
- [x] Nested folder tree: subfolders, expand/collapse, drag-to-reparent, delete promotion
- [x] PDF upload (multi-file, 100 MB limit), folder drop targets, move-by-drag
- [x] Sidebar collapse, search, paper list with annotation counts
- [x] PDF.js reader: lazy pages, fit-width, zoom, page navigation, text layer
- [x] Highlight/underline from native text selection; box via drag rectangle
- [x] Selection popover to highlight/underline a selection with the active colour
- [x] Highlight, underline and box annotations with normalized coordinates
- [x] Hover annotation for 0.5 s to show its label at the cursor; click-away clears selection
- [x] Visible translucent highlight colours
- [x] Editable paper titles from the sidebar
- [x] LLM auto-detects paper titles on upload with metadata/filename fallback
- [x] KaTeX LaTeX rendering in chat (dollar and backslash delimiters, code-safe)
- [x] Centered app dialogs for confirm/rename; instant annotation deletion
- [x] Consistent FolderPlus icon for root and subfolder creation
- [x] Annotation toolbar: recolour, note, delete
- [x] Double-click note stickers aligned to annotations in a notes rail
- [x] SSE AI chat with Markdown rendering, tool trace, stop, clear, history
- [x] Drag annotations into chat as `@page:label` citations; box crops
- [x] Model list with priority, enable/disable-to-bottom, test, delete
- [x] Model fallback chain + warning event
- [x] Response language preference, system prompt enforcement
- [x] Skills zip upload, safe extraction, 4-column folder grid, delete
- [x] Agent skill tools (`list_skills`, `use_skill`, `read_skill_file`)
- [x] Theme colour presets + custom colour
- [x] Documentation, smoke test, dev log

## Next

### Reading experience

- [ ] Cross-page native selections (currently anchored to the first page)
- [ ] Folder contents roll-up counts / recursive paper totals
- [ ] Annotation comments on hover in the page, not only in the notes rail
- [ ] Drag note stickers vertically to detach them from the anchor
- [ ] PDF outline / table of contents and thumbnail sidebar
- [ ] Remember last page and zoom per paper
- [ ] Two-page spread and dark reading mode
- [ ] Keyboard navigation (`j`/`k`, `PageUp`/`PageDown`) and a shortcuts cheatsheet
- [ ] OCR fallback for scanned PDFs

### Library

- [ ] Backfill LLM titles for existing papers that still show filenames
- [ ] Folder sorting modes (name/date/manual) and keyboard tree navigation
- [ ] Tags, authors, year, venue metadata + editable metadata panel
- [ ] Import from DOI/arXiv/Zotero
- [ ] Export annotations (Markdown, JSON, BibTeX)
- [ ] Duplicate detection and attachment relinking
- [ ] Bulk select, multi-delete, multi-move
- [ ] Sort papers by title/date/last opened

### AI

- [ ] Editable model entries (currently delete/re-add to rotate keys)
- [ ] Per-paper chat threads instead of one thread per paper
- [ ] Token/usage accounting and cost display
- [ ] Retry with a specific model button
- [ ] Citation verification (highlight unsupported claims)
- [ ] Tool permission toggles per skill
- [ ] Anthropic/Gemini native adapters (currently OpenAI-compatible only)

### Skills

- [ ] Enable/disable individual skills
- [ ] Skill detail preview and file browser
- [ ] Skill versioning and update-on-reupload
- [ ] Optional sandboxed execution for skill scripts (explicit opt-in)

### Engineering

- [ ] Unit tests (geometry helpers, label allocation, settings validation)
- [ ] API integration test suite (extend smoke test)
- [ ] Frontend component tests / Playwright happy path
- [ ] Structured logging and request IDs
- [ ] Database migrations with `user_version`
- [x] Dockerfile and compose example (loopback-only, non-root, data volume, healthcheck)
- [x] Deployment guide (`docs/DEPLOYMENT.md`) and `deploy` branch workflow
- [ ] CI workflow (typecheck, build, smoke, Docker image)
- [ ] Accessibility pass (focus rings, aria labels, reduced motion)
- [ ] i18n scaffolding for the UI (UI copy stays English for now)
