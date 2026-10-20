import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { config, newId, now } from '../config.js';
import { db, type AnnotationRow, type PaperRow } from '../db.js';
import { asNumber, asString, HttpError, optionalString } from '../http.js';

export const annotationsRouter = Router();

const TYPES = new Set(['highlight', 'underline', 'box']);
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

type Rect = { x: number; y: number; w: number; h: number };

function parseRects(value: unknown): Rect[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 400) {
    throw new HttpError(400, 'rects must be a non-empty array of rectangles.');
  }
  return value.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new HttpError(400, 'Invalid rectangle.');
    const rect = raw as Record<string, unknown>;
    const parsed = {
      x: Number(rect.x),
      y: Number(rect.y),
      w: Number(rect.w),
      h: Number(rect.h),
    };
    if (Object.values(parsed).some((n) => !Number.isFinite(n))) {
      throw new HttpError(400, 'Invalid rectangle values.');
    }
    return {
      x: Math.max(0, Math.min(1, parsed.x)),
      y: Math.max(0, Math.min(1, parsed.y)),
      w: Math.max(0, Math.min(1, parsed.w)),
      h: Math.max(0, Math.min(1, parsed.h)),
    };
  });
}

function nextLabel(paperId: string, type: string): string {
  const rows = db
    .prepare('SELECT label FROM annotations WHERE paper_id = ? AND type = ?')
    .all(paperId, type) as { label: string }[];
  let max = 0;
  for (const row of rows) {
    const match = row.label.match(/_(\d+)$/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${type}_${max + 1}`;
}

function getPaper(id: string): PaperRow {
  const paper = db.prepare('SELECT * FROM papers WHERE id = ?').get(id) as PaperRow | undefined;
  if (!paper) throw new HttpError(404, 'Paper not found.');
  return paper;
}

annotationsRouter.get('/papers/:paperId/annotations', (req, res) => {
  getPaper(req.params.paperId);
  const rows = db
    .prepare('SELECT * FROM annotations WHERE paper_id = ? ORDER BY page ASC, created_at ASC')
    .all(req.params.paperId) as AnnotationRow[];
  res.json({
    annotations: rows.map((row) => ({
      ...row,
      rects: JSON.parse(row.rects) as Rect[],
      image_url: row.image_name ? `/api/annotations/${row.id}/image` : null,
    })),
  });
});

annotationsRouter.post('/annotations', (req, res) => {
  const paperId = asString(req.body?.paper_id, 'paper_id', { max: 64 });
  getPaper(paperId);
  const type = asString(req.body?.type, 'type', { max: 20 });
  if (!TYPES.has(type)) throw new HttpError(400, 'type must be highlight, underline, or box.');
  const page = Math.round(asNumber(req.body?.page, 'page'));
  if (page < 1) throw new HttpError(400, 'page must be 1 or greater.');
  const color = typeof req.body?.color === 'string' && COLOR_RE.test(req.body.color)
    ? req.body.color
    : '#ffd54a';
  const rects = parseRects(req.body?.rects);
  const text = optionalString(req.body?.text, 20_000) ?? '';
  const note = optionalString(req.body?.note, 20_000) ?? '';

  const id = newId();
  let imageName: string | null = null;
  const imageData = req.body?.image_data_url;
  if (typeof imageData === 'string' && imageData.startsWith('data:image/png;base64,')) {
    const base64 = imageData.slice('data:image/png;base64,'.length);
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length > 8 * 1024 * 1024) throw new HttpError(400, 'Box image is too large.');
    imageName = `${id}.png`;
    fs.writeFileSync(path.join(config.annotationDir, imageName), buffer);
  }

  const label = nextLabel(paperId, type);
  const createdAt = now();
  db.prepare(
    `INSERT INTO annotations (id, paper_id, type, page, label, color, rects, text, note, image_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    paperId,
    type,
    page,
    label,
    color,
    JSON.stringify(rects),
    text,
    note,
    imageName,
    createdAt,
  );
  res.status(201).json({
    annotation: {
      id,
      paper_id: paperId,
      type,
      page,
      label,
      color,
      rects,
      text,
      note,
      image_name: imageName,
      image_url: imageName ? `/api/annotations/${id}/image` : null,
      created_at: createdAt,
    },
  });
});

annotationsRouter.patch('/annotations/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM annotations WHERE id = ?').get(req.params.id) as
    | AnnotationRow
    | undefined;
  if (!row) throw new HttpError(404, 'Annotation not found.');

  if (typeof req.body?.note === 'string') {
    db.prepare('UPDATE annotations SET note = ? WHERE id = ?').run(
      req.body.note.slice(0, 20_000),
      row.id,
    );
  }
  if (typeof req.body?.color === 'string' && COLOR_RE.test(req.body.color)) {
    db.prepare('UPDATE annotations SET color = ? WHERE id = ?').run(req.body.color, row.id);
  }
  if (req.body?.rects !== undefined) {
    const rects = parseRects(req.body.rects);
    db.prepare('UPDATE annotations SET rects = ? WHERE id = ?').run(JSON.stringify(rects), row.id);
  }
  const updated = db.prepare('SELECT * FROM annotations WHERE id = ?').get(row.id) as AnnotationRow;
  res.json({ annotation: { ...updated, rects: JSON.parse(updated.rects) as Rect[] } });
});

annotationsRouter.delete('/annotations/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM annotations WHERE id = ?').get(req.params.id) as
    | AnnotationRow
    | undefined;
  if (!row) throw new HttpError(404, 'Annotation not found.');
  db.prepare('DELETE FROM annotations WHERE id = ?').run(row.id);
  if (row.image_name) {
    fs.rmSync(path.join(config.annotationDir, row.image_name), { force: true });
  }
  res.json({ ok: true });
});

annotationsRouter.get('/annotations/:id/image', (req, res) => {
  const row = db.prepare('SELECT * FROM annotations WHERE id = ?').get(req.params.id) as
    | AnnotationRow
    | undefined;
  if (!row?.image_name) throw new HttpError(404, 'Annotation image not found.');
  const file = path.join(config.annotationDir, row.image_name);
  if (!fs.existsSync(file)) throw new HttpError(404, 'Annotation image is missing on disk.');
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.sendFile(file);
});
