import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Repository root (one level above the server package). */
export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
export const SERVER_ROOT = path.resolve(import.meta.dirname, '..');

const dataDir = process.env.PAPER_READER_DATA
  ? path.resolve(process.env.PAPER_READER_DATA)
  : path.join(SERVER_ROOT, 'data');

export const config = {
  port: Number(process.env.PORT || 8787),
  host: process.env.HOST || '127.0.0.1',
  dataDir,
  uploadsDir: path.join(dataDir, 'uploads'),
  annotationDir: path.join(dataDir, 'annotations'),
  skillsDir: path.join(dataDir, 'skills'),
  tokenFile: path.join(dataDir, 'token.txt'),
  dbFile: path.join(dataDir, 'paper-reader.db'),
  webDist: path.join(REPO_ROOT, 'web', 'dist'),
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
  },
  maxUploadBytes: 100 * 1024 * 1024,
};

for (const dir of [config.dataDir, config.uploadsDir, config.annotationDir, config.skillsDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

function loadToken(): string {
  if (process.env.APP_TOKEN?.trim()) return process.env.APP_TOKEN.trim();
  try {
    const existing = fs.readFileSync(config.tokenFile, 'utf8').trim();
    if (existing) return existing;
  } catch {
    // generate below
  }
  const token = crypto.randomBytes(24).toString('base64url');
  fs.writeFileSync(config.tokenFile, token + '\n', { mode: 0o600 });
  return token;
}

export const APP_TOKEN = loadToken();

export function newId(): string {
  return crypto.randomUUID();
}

export function now(): string {
  return new Date().toISOString();
}
