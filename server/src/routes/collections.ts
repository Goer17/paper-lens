import { Router } from 'express';
import { newId, now } from '../config.js';
import { db } from '../db.js';
import { asString, HttpError } from '../http.js';

export const collectionsRouter = Router();

type CollectionRow = {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
};

function getCollection(id: string): CollectionRow {
  const row = db.prepare('SELECT * FROM collections WHERE id = ?').get(id) as
    | CollectionRow
    | undefined;
  if (!row) throw new HttpError(404, 'Folder not found.');
  return row;
}

function normalizeParent(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new HttpError(400, 'parent_id must be a string.');
  const parent = db.prepare('SELECT id FROM collections WHERE id = ?').get(value);
  if (!parent) throw new HttpError(404, 'Parent folder not found.');
  return value;
}

function isDescendant(candidateParentId: string | null, collectionId: string): boolean {
  let current = candidateParentId;
  while (current) {
    if (current === collectionId) return true;
    const row = db.prepare('SELECT parent_id FROM collections WHERE id = ?').get(current) as
      | { parent_id: string | null }
      | undefined;
    current = row?.parent_id ?? null;
  }
  return false;
}

function assertUniqueName(name: string, parentId: string | null, exceptId = '') {
  const duplicate = db
    .prepare(
      `SELECT id FROM collections
       WHERE lower(name) = lower(?) AND COALESCE(parent_id, '') = COALESCE(?, '') AND id != ?`,
    )
    .get(name, parentId, exceptId);
  if (duplicate) throw new HttpError(409, 'A folder with that name already exists here.');
}

collectionsRouter.get('/', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT c.id, c.name, c.parent_id, c.created_at,
        (SELECT COUNT(*) FROM papers p WHERE p.collection_id = c.id) AS paper_count
       FROM collections c ORDER BY c.created_at ASC`,
    )
    .all() as (CollectionRow & { paper_count: number })[];
  const uncategorized = db
    .prepare('SELECT COUNT(*) AS n FROM papers WHERE collection_id IS NULL')
    .get() as { n: number };
  res.json({ collections: rows, uncategorized: uncategorized.n });
});

collectionsRouter.post('/', (req, res) => {
  const name = asString(req.body?.name, 'name', { max: 120 });
  const parentId = normalizeParent(req.body?.parent_id);
  assertUniqueName(name, parentId);
  const id = newId();
  db.prepare('INSERT INTO collections (id, name, parent_id, created_at) VALUES (?, ?, ?, ?)').run(
    id,
    name,
    parentId,
    now(),
  );
  res.status(201).json({ id, name, parent_id: parentId, paper_count: 0 });
});

collectionsRouter.patch('/:id', (req, res) => {
  const existing = getCollection(req.params.id);
  const name = req.body?.name !== undefined
    ? asString(req.body.name, 'name', { max: 120 })
    : existing.name;
  const parentId = req.body?.parent_id !== undefined
    ? normalizeParent(req.body.parent_id)
    : existing.parent_id;

  if (parentId === existing.id) throw new HttpError(400, 'A folder cannot be its own parent.');
  if (isDescendant(parentId, existing.id)) {
    throw new HttpError(400, 'A folder cannot be moved inside its own descendant.');
  }
  if (name !== existing.name || parentId !== existing.parent_id) {
    assertUniqueName(name, parentId, existing.id);
  }

  db.prepare('UPDATE collections SET name = ?, parent_id = ? WHERE id = ?').run(
    name,
    parentId,
    existing.id,
  );
  res.json({ id: existing.id, name, parent_id: parentId });
});

collectionsRouter.delete('/:id', (req, res) => {
  const existing = getCollection(req.params.id);
  // Promote direct subfolders one level instead of cascading the deletion.
  db.prepare('UPDATE collections SET parent_id = ? WHERE parent_id = ?').run(
    existing.parent_id,
    existing.id,
  );
  db.prepare('DELETE FROM collections WHERE id = ?').run(existing.id);
  res.json({ ok: true });
});
