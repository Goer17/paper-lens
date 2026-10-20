import { DatabaseSync } from 'node:sqlite';
import { config, now, newId } from './config.js';

export const db = new DatabaseSync(config.dbFile);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT REFERENCES collections(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS papers (
    id TEXT PRIMARY KEY,
    collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    filename TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    size INTEGER NOT NULL,
    pages INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_opened_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_papers_collection ON papers(collection_id);

  CREATE TABLE IF NOT EXISTS annotations (
    id TEXT PRIMARY KEY,
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    page INTEGER NOT NULL,
    label TEXT NOT NULL,
    color TEXT NOT NULL,
    rects TEXT NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    image_name TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_annotations_paper ON annotations(paper_id);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS models (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    api_key TEXT NOT NULL,
    model_name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    vision INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    dir_name TEXT NOT NULL,
    file_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    citations TEXT NOT NULL DEFAULT '[]',
    tools TEXT NOT NULL DEFAULT '[]',
    model TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_paper ON messages(paper_id, created_at);

  CREATE TABLE IF NOT EXISTS paper_pages (
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    page INTEGER NOT NULL,
    text TEXT NOT NULL,
    PRIMARY KEY (paper_id, page)
  );
`);

// Migration for databases created before nested folders existed.
const collectionColumns = db.prepare('PRAGMA table_info(collections)').all() as { name: string }[];
if (!collectionColumns.some((column) => column.name === 'parent_id')) {
  db.exec(
    'ALTER TABLE collections ADD COLUMN parent_id TEXT REFERENCES collections(id) ON DELETE SET NULL;',
  );
}
db.exec('CREATE INDEX IF NOT EXISTS idx_collections_parent ON collections(parent_id);');

function seed() {
  const settings = db.prepare('SELECT COUNT(*) AS n FROM settings').get() as { n: number };
  if (settings.n === 0) {
    const insert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    insert.run('theme_color', '#5b67f1');
    insert.run('ai_language', 'English');
    insert.run('notes_rail', '1');
  }

  const collections = db.prepare('SELECT COUNT(*) AS n FROM collections').get() as { n: number };
  if (collections.n === 0) {
    db.prepare('INSERT INTO collections (id, name, created_at) VALUES (?, ?, ?)').run(
      newId(),
      'Inbox',
      now(),
    );
  }

  const models = db.prepare('SELECT COUNT(*) AS n FROM models').get() as { n: number };
  if (models.n === 0 && config.deepseek.apiKey) {
    db.prepare(
      `INSERT INTO models (id, name, base_url, api_key, model_name, enabled, vision, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, 1, 0, 0, ?)`,
    ).run(
      newId(),
      'DeepSeek Flash',
      config.deepseek.baseUrl,
      config.deepseek.apiKey,
      config.deepseek.model,
      now(),
    );
  }
}

seed();

export type PaperRow = {
  id: string;
  collection_id: string | null;
  title: string;
  filename: string;
  stored_name: string;
  size: number;
  pages: number;
  created_at: string;
  last_opened_at: string | null;
};

export type AnnotationRow = {
  id: string;
  paper_id: string;
  type: 'highlight' | 'underline' | 'box';
  page: number;
  label: string;
  color: string;
  rects: string;
  text: string;
  note: string;
  image_name: string | null;
  created_at: string;
};

export type ModelRow = {
  id: string;
  name: string;
  base_url: string;
  api_key: string;
  model_name: string;
  enabled: number;
  vision: number;
  sort_order: number;
  created_at: string;
};

export function getSetting(key: string, fallback = ''): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? fallback;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}
