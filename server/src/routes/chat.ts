import { Router } from 'express';
import { db, type PaperRow } from '../db.js';
import { asString, asyncRoute, HttpError } from '../http.js';
import { streamChat } from '../services/llm.js';

export const chatRouter = Router();

chatRouter.get('/papers/:id/messages', (req, res) => {
  const paper = db.prepare('SELECT id FROM papers WHERE id = ?').get(req.params.id);
  if (!paper) throw new HttpError(404, 'Paper not found.');
  const rows = db
    .prepare('SELECT * FROM messages WHERE paper_id = ? ORDER BY created_at ASC, rowid ASC')
    .all(req.params.id) as {
    id: string;
    role: string;
    content: string;
    citations: string;
    tools: string;
    model: string | null;
    created_at: string;
  }[];
  res.json({
    messages: rows.map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      citations: JSON.parse(row.citations || '[]'),
      tools: JSON.parse(row.tools || '[]'),
      model: row.model,
      created_at: row.created_at,
    })),
  });
});

chatRouter.delete('/papers/:id/messages', (req, res) => {
  db.prepare('DELETE FROM messages WHERE paper_id = ?').run(req.params.id);
  res.json({ ok: true });
});

chatRouter.post(
  '/chat',
  asyncRoute(async (req, res) => {
    const paperId = asString(req.body?.paper_id, 'paper_id', { max: 64 });
    const message = asString(req.body?.message, 'message', { max: 20_000 });
    const paper = db.prepare('SELECT * FROM papers WHERE id = ?').get(paperId) as
      | PaperRow
      | undefined;
    if (!paper) throw new HttpError(404, 'Paper not found.');

    const rawCitations = req.body?.citation_ids;
    const citationIds = Array.isArray(rawCitations)
      ? rawCitations.filter((value): value is string => typeof value === 'string').slice(0, 20)
      : [];

    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    await streamChat(res, {
      paperId,
      message,
      citationIds,
      signal: controller.signal,
    });
  }),
);
