# PaperLens HTTP API

Base URL: `http://localhost:8787/api`

All routes except `GET /health` and `POST /auth/login` require:

```
Authorization: Bearer <token>
```

Errors use `{ "error": "message" }` with an appropriate status code.

## Auth

| Method | Path | Body | Description |
| --- | --- | --- | --- |
| `POST` | `/auth/login` | `{ token }` | Validate the workspace token |
| `GET` | `/auth/me` | — | Check the current bearer token |

## Health

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | `{ ok, name, version }`, public |

## Collections

| Method | Path | Body | Description |
| --- | --- | --- | --- |
| `GET` | `/collections` | — | Flat list `{ id, name, parent_id, paper_count, created_at }` plus `uncategorized` |
| `POST` | `/collections` | `{ name, parent_id? }` | Create a root folder or subfolder (409 on duplicate name in the same parent) |
| `PATCH` | `/collections/:id` | `{ name?, parent_id? }` | Rename and/or re-parent; cycles are rejected |
| `DELETE` | `/collections/:id` | — | Delete; direct subfolders move up one level, papers become uncategorized |

## Papers

| Method | Path | Body | Description |
| --- | --- | --- | --- |
| `GET` | `/papers` | query: `collection_id`, `q` | List/search papers. `collection_id=none` = uncategorized |
| `POST` | `/papers` | multipart: `files[]`, `collection_id?` | Upload up to 20 PDFs (100 MB each); the configured LLM detects titles from the first page |
| `GET` | `/papers/:id` | — | Paper detail |
| `PATCH` | `/papers/:id` | `{ title?, collection_id? }` | Rename or move |
| `DELETE` | `/papers/:id` | — | Delete paper, annotations, crops |
| `GET` | `/papers/:id/file` | — | Stream the PDF (supports range requests) |

Paper object: `{ id, title, filename, size, pages, collection_id, collection_name, annotation_count,
created_at, last_opened_at }`. `title` is the LLM-detected/editable display title; `filename` keeps the
original upload name. `PATCH /papers/:id` is used by the sidebar rename prompt.

## Annotations

| Method | Path | Body | Description |
| --- | --- | --- | --- |
| `GET` | `/papers/:paperId/annotations` | — | List annotations with parsed `rects` and `image_url` |
| `POST` | `/annotations` | see below | Create; server assigns the label |
| `PATCH` | `/annotations/:id` | `{ note?, color?, rects? }` | Update note/colour/geometry |
| `DELETE` | `/annotations/:id` | — | Delete annotation and crop |
| `GET` | `/annotations/:id/image` | — | PNG crop for box annotations |

Create body:

```json
{
  "paper_id": "uuid",
  "type": "highlight | underline | box",
  "page": 3,
  "color": "#ffd54a",
  "rects": [{ "x": 0.12, "y": 0.33, "w": 0.5, "h": 0.02 }],
  "text": "captured text",
  "note": "",
  "image_data_url": "data:image/png;base64,… (box only, optional)"
}
```

Rectangles are normalized to the page (`0..1`). Labels are `type_N` per paper. The client builds
rectangles from native text selection for highlights/underlines, and from a drag rectangle for
boxes (which may also include `image_data_url`).

## Settings

| Method | Path | Body | Description |
| --- | --- | --- | --- |
| `GET` | `/settings` | — | `{ settings, languages }` |
| `PUT` | `/settings` | `{ theme_color?, ai_language?, notes_rail? }` | Update known keys |

`theme_color` must be `#rrggbb`. `ai_language` must be in the supported list. `notes_rail` is `"0"`
or `"1"`.

## Models

| Method | Path | Body | Description |
| --- | --- | --- | --- |
| `GET` | `/models` | — | Ordered list; keys are masked |
| `POST` | `/models` | `{ name, base_url, api_key, model_name }` | Add at lowest priority |
| `PATCH` | `/models/:id` | any of the fields + `enabled` | Edit. Disabling moves it to the bottom |
| `POST` | `/models/:id/move` | `{ direction: "up" \| "down" }` | Swap priority |
| `POST` | `/models/:id/test` | — | Ping the provider with `max_tokens: 16` |
| `DELETE` | `/models/:id` | — | Delete |

Model object: `{ id, name, base_url, model_name, enabled, sort_order, has_key, key_hint,
created_at }`. Raw API keys are never returned.

## Skills

| Method | Path | Body | Description |
| --- | --- | --- | --- |
| `GET` | `/skills` | — | Installed skills |
| `POST` | `/skills` | multipart `file` (zip) | Extract and register; returns skill + files |
| `GET` | `/skills/:id` | — | Skill, file list, instructions |
| `DELETE` | `/skills/:id` | — | Delete skill and its folder |

## Chat

| Method | Path | Body | Description |
| --- | --- | --- | --- |
| `GET` | `/papers/:id/messages` | — | Persisted thread (messages with citations/tools) |
| `DELETE` | `/papers/:id/messages` | — | Clear the thread |
| `POST` | `/chat` | `{ paper_id, message, citation_ids: [] }` | SSE stream |

SSE events: `meta`, `delta`, `tool_call`, `tool_result`, `warning`, `error`, `done`. See
[ARCHITECTURE.md](ARCHITECTURE.md#sse-contract).
