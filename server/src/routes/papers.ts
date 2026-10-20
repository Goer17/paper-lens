import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { config, newId, now } from '../config.js';
import { db, type PaperRow } from '../db.js';
import { asString, asyncRoute, HttpError, optionalString } from '../http.js';
import { inspectPdf } from '../services/pdf.js';
import { detectPaperTitle } from '../services/title.js';

export const papersRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 20 },
});

function toPublicPaper(paper: PaperRow & { collection_name?: string | null; annotation_count?: number }) {
  return {
    id: paper.id,
    title: paper.title,
    filename: paper.filename,
    size: paper.size,
    pages: paper.pages,
    collection_id: paper.collection_id,
    collection_name: paper.collection_name ?? null,
    annotation_count: paper.annotation_count ?? 0,
    created_at: paper.created_at,
    last_opened_at: paper.last_opened_at,
  };
}

papersRouter.get('/', (req, res) => {
  const collectionId = typeof req.query.collection_id === 'string' ? req.query.collection_id : '';
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (collectionId === 'none') clauses.push('p.collection_id IS NULL');
  else if (collectionId) {
    clauses.push('p.collection_id = ?');
    params.push(collectionId);
  }
  if (query) {
    clauses.push('(lower(p.title) LIKE ? OR lower(p.filename) LIKE ?)');
    params.push(`%${query.toLowerCase()}%`, `%${query.toLowerCase()}%`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT p.*, c.name AS collection_name,
        (SELECT COUNT(*) FROM annotations a WHERE a.paper_id = p.id) AS annotation_count
       FROM papers p LEFT JOIN collections c ON c.id = p.collection_id
       ${where}
       ORDER BY p.created_at DESC`,
    )
    .all(...params) as (PaperRow & { collection_name: string | null; annotation_count: number })[];
  res.json({ papers: rows.map(toPublicPaper) });
});

papersRouter.post(
  '/',
  upload.array('files', 20),
  asyncRoute(async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) throw new HttpError(400, 'Attach at least one PDF file.');
    const collectionId = optionalString(req.body?.collection_id) || null;
    if (collectionId) {
      const folder = db.prepare('SELECT id FROM collections WHERE id = ?').get(collectionId);
      if (!folder) throw new HttpError(404, 'Folder not found.');
    }

    type PendingPaper = {
      paper: PaperRow;
      firstPageText: string;
      metaTitle: string | null;
      baseName: string;
    };
    const pending: PendingPaper[] = [];

    for (const file of files) {
      const isPdf =
        file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');
      if (!isPdf) throw new HttpError(400, `${file.originalname} is not a PDF file.`);

      let pages = 0;
      let metaTitle: string | null = null;
      let firstPageText = '';
      try {
        const info = await inspectPdf(file.buffer);
        pages = info.pages;
        metaTitle = info.title;
        firstPageText = info.firstPageText;
      } catch {
        throw new HttpError(400, `${file.originalname} could not be parsed as a PDF.`);
      }

      const id = newId();
      const storedName = `${id}.pdf`;
      fs.writeFileSync(path.join(config.uploadsDir, storedName), file.buffer);
      const baseName = file.originalname.replace(/\.pdf$/i, '').trim() || 'Untitled';
      // Provisional title: PDF metadata when present, otherwise the filename.
      // The configured LLM refines this immediately after the file is stored.
      const title = (metaTitle || baseName).slice(0, 300);
      const createdAt = now();
      db.prepare(
        `INSERT INTO papers (id, collection_id, title, filename, stored_name, size, pages, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, collectionId, title, file.originalname.slice(0, 300), storedName, file.size, pages, createdAt);

      pending.push({
        paper: {
          id,
          collection_id: collectionId,
          title,
          filename: file.originalname,
          stored_name: storedName,
          size: file.size,
          pages,
          created_at: createdAt,
          last_opened_at: null,
        },
        firstPageText,
        metaTitle,
        baseName,
      });
    }

    // Ask the LLM for the real paper title. This runs in parallel for
    // multi-file uploads; any failure keeps the provisional title.
    const titles = await Promise.all(
      pending.map(async (item) => {
        try {
          const detected = await detectPaperTitle({
            firstPageText: item.firstPageText,
            metaTitle: item.metaTitle,
            filename: item.baseName,
          });
          if (detected && detected !== item.paper.title) {
            db.prepare('UPDATE papers SET title = ? WHERE id = ?').run(
              detected,
              item.paper.id,
            );
            return detected;
          }
        } catch {
          // fall through to the provisional title
        }
        return item.paper.title;
      }),
    );

    const created = pending.map((item, index) =>
      toPublicPaper({ ...item.paper, title: titles[index] }),
    );
    res.status(201).json({ papers: created });
  }),
);

papersRouter.get('/:id', (req, res) => {
  const paper = db.prepare('SELECT * FROM papers WHERE id = ?').get(req.params.id) as
    | PaperRow
    | undefined;
  if (!paper) throw new HttpError(404, 'Paper not found.');
  const count = db
    .prepare('SELECT COUNT(*) AS n FROM annotations WHERE paper_id = ?')
    .get(paper.id) as { n: number };
  res.json({ paper: toPublicPaper({ ...paper, annotation_count: count.n }) });
});

papersRouter.patch('/:id', (req, res) => {
  const paper = db.prepare('SELECT * FROM papers WHERE id = ?').get(req.params.id) as
    | PaperRow
    | undefined;
  if (!paper) throw new HttpError(404, 'Paper not found.');

  if (typeof req.body?.title === 'string') {
    const title = asString(req.body.title, 'title', { max: 300 });
    db.prepare('UPDATE papers SET title = ? WHERE id = ?').run(title, paper.id);
  }
  if (req.body?.collection_id !== undefined) {
    const collectionId = optionalString(req.body.collection_id) || null;
    if (collectionId && !db.prepare('SELECT id FROM collections WHERE id = ?').get(collectionId)) {
      throw new HttpError(404, 'Folder not found.');
    }
    db.prepare('UPDATE papers SET collection_id = ? WHERE id = ?').run(collectionId, paper.id);
  }
  res.json({ ok: true });
});

papersRouter.delete('/:id', (req, res) => {
  const paper = db.prepare('SELECT * FROM papers WHERE id = ?').get(req.params.id) as
    | PaperRow
    | undefined;
  if (!paper) throw new HttpError(404, 'Paper not found.');
  const images = db
    .prepare('SELECT image_name FROM annotations WHERE paper_id = ? AND image_name IS NOT NULL')
    .all(paper.id) as { image_name: string }[];
  db.prepare('DELETE FROM papers WHERE id = ?').run(paper.id);
  fs.rmSync(path.join(config.uploadsDir, paper.stored_name), { force: true });
  for (const image of images) {
    fs.rmSync(path.join(config.annotationDir, image.image_name), { force: true });
  }
  res.json({ ok: true });
});

papersRouter.get('/:id/file', (req, res) => {
  const paper = db.prepare('SELECT * FROM papers WHERE id = ?').get(req.params.id) as
    | PaperRow
    | undefined;
  if (!paper) throw new HttpError(404, 'Paper not found.');
  const file = path.join(config.uploadsDir, paper.stored_name);
  if (!fs.existsSync(file)) throw new HttpError(404, 'PDF file is missing on disk.');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${paper.stored_name}"`,
  );
  res.sendFile(file);
});
