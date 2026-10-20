import { Router } from 'express';
import { db, setSetting } from '../db.js';
import { HttpError } from '../http.js';

export const settingsRouter = Router();

export const ALLOWED_LANGUAGES = [
  'English',
  'Chinese',
  'Japanese',
  'Korean',
  'Spanish',
  'French',
  'German',
];

function allSettings(): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

settingsRouter.get('/', (_req, res) => {
  res.json({ settings: allSettings(), languages: ALLOWED_LANGUAGES });
});

settingsRouter.put('/', (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;

  if (body.theme_color !== undefined) {
    if (typeof body.theme_color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(body.theme_color)) {
      throw new HttpError(400, 'theme_color must be a hex colour like #5b67f1.');
    }
    setSetting('theme_color', body.theme_color);
  }

  if (body.ai_language !== undefined) {
    if (typeof body.ai_language !== 'string' || !ALLOWED_LANGUAGES.includes(body.ai_language)) {
      throw new HttpError(400, 'Unsupported response language.');
    }
    setSetting('ai_language', body.ai_language);
  }

  if (body.notes_rail !== undefined) {
    setSetting('notes_rail', body.notes_rail === '1' || body.notes_rail === true ? '1' : '0');
  }

  res.json({ settings: allSettings() });
});
