import { Router } from 'express';
import OpenAI from 'openai';
import { newId, now } from '../config.js';
import { db, type ModelRow } from '../db.js';
import { asString, asyncRoute, HttpError } from '../http.js';

export const modelsRouter = Router();

function publicModel(row: ModelRow) {
  const key = row.api_key || '';
  return {
    id: row.id,
    name: row.name,
    base_url: row.base_url,
    model_name: row.model_name,
    enabled: Boolean(row.enabled),
    sort_order: row.sort_order,
    created_at: row.created_at,
    has_key: Boolean(key),
    key_hint: key ? `••••${key.slice(-4)}` : '',
  };
}

function orderedModels(): ModelRow[] {
  return db.prepare('SELECT * FROM models ORDER BY sort_order ASC, created_at ASC').all() as ModelRow[];
}

function normalizeOrder(): void {
  const rows = orderedModels();
  const update = db.prepare('UPDATE models SET sort_order = ? WHERE id = ?');
  rows.forEach((row, index) => update.run(index, row.id));
}

function validateBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(400, 'Base URL must be a valid URL, e.g. https://api.deepseek.com.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpError(400, 'Base URL must use http or https.');
  }
  return value.replace(/\/+$/, '');
}

modelsRouter.get('/', (_req, res) => {
  res.json({ models: orderedModels().map(publicModel) });
});

modelsRouter.post('/', (req, res) => {
  const name = asString(req.body?.name, 'name', { max: 120 });
  const baseUrl = validateBaseUrl(asString(req.body?.base_url, 'base_url', { max: 500 }));
  const apiKey = asString(req.body?.api_key, 'api_key', { max: 500 });
  const modelName = asString(req.body?.model_name, 'model_name', { max: 200 });
  const id = newId();
  db.prepare(
    `INSERT INTO models (id, name, base_url, api_key, model_name, enabled, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(id, name, baseUrl, apiKey, modelName, orderedModels().length, now());
  const row = db.prepare('SELECT * FROM models WHERE id = ?').get(id) as ModelRow;
  res.status(201).json({ model: publicModel(row) });
});

modelsRouter.patch('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM models WHERE id = ?').get(req.params.id) as
    | ModelRow
    | undefined;
  if (!row) throw new HttpError(404, 'Model not found.');

  if (req.body?.name !== undefined) {
    db.prepare('UPDATE models SET name = ? WHERE id = ?').run(
      asString(req.body.name, 'name', { max: 120 }),
      row.id,
    );
  }
  if (req.body?.base_url !== undefined) {
    db.prepare('UPDATE models SET base_url = ? WHERE id = ?').run(
      validateBaseUrl(asString(req.body.base_url, 'base_url', { max: 500 })),
      row.id,
    );
  }
  if (req.body?.model_name !== undefined) {
    db.prepare('UPDATE models SET model_name = ? WHERE id = ?').run(
      asString(req.body.model_name, 'model_name', { max: 200 }),
      row.id,
    );
  }
  if (typeof req.body?.api_key === 'string' && req.body.api_key.trim() && !req.body.api_key.startsWith('••')) {
    db.prepare('UPDATE models SET api_key = ? WHERE id = ?').run(req.body.api_key.trim(), row.id);
  }
  if (req.body?.enabled !== undefined) {
    const enabled = req.body.enabled ? 1 : 0;
    db.prepare('UPDATE models SET enabled = ? WHERE id = ?').run(enabled, row.id);
    if (!enabled) {
      const max = db.prepare('SELECT MAX(sort_order) AS m FROM models').get() as { m: number | null };
      db.prepare('UPDATE models SET sort_order = ? WHERE id = ?').run((max.m ?? 0) + 1, row.id);
      normalizeOrder();
    }
  }

  const updated = db.prepare('SELECT * FROM models WHERE id = ?').get(row.id) as ModelRow;
  res.json({ model: publicModel(updated) });
});

modelsRouter.post('/:id/move', (req, res) => {
  const direction = req.body?.direction;
  if (direction !== 'up' && direction !== 'down') {
    throw new HttpError(400, 'direction must be up or down.');
  }
  const rows = orderedModels();
  const index = rows.findIndex((row) => row.id === req.params.id);
  if (index === -1) throw new HttpError(404, 'Model not found.');
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= rows.length) {
    res.json({ models: rows.map(publicModel) });
    return;
  }
  [rows[index], rows[target]] = [rows[target], rows[index]];
  const update = db.prepare('UPDATE models SET sort_order = ? WHERE id = ?');
  rows.forEach((row, position) => update.run(position, row.id));
  res.json({ models: orderedModels().map(publicModel) });
});

modelsRouter.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM models WHERE id = ?').run(req.params.id);
  if (result.changes === 0) throw new HttpError(404, 'Model not found.');
  normalizeOrder();
  res.json({ ok: true });
});

modelsRouter.post(
  '/:id/test',
  asyncRoute(async (req, res) => {
    const row = db.prepare('SELECT * FROM models WHERE id = ?').get(req.params.id) as
      | ModelRow
      | undefined;
    if (!row) throw new HttpError(404, 'Model not found.');
    const started = Date.now();
    try {
      const client = new OpenAI({
        apiKey: row.api_key,
        baseURL: row.base_url,
        timeout: 30_000,
        maxRetries: 0,
      });
      const completion = await client.chat.completions.create({
        model: row.model_name,
        messages: [{ role: 'user', content: 'Reply with the single word: pong' }],
        max_tokens: 16,
        temperature: 0,
      });
      res.json({
        ok: true,
        latency_ms: Date.now() - started,
        reply: completion.choices[0]?.message?.content?.trim() || '(empty reply)',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed.';
      throw new HttpError(400, `Connection failed: ${message}`);
    }
  }),
);
