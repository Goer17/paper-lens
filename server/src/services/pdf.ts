import fs from 'node:fs/promises';
import path from 'node:path';
import { extractText, getDocumentProxy } from 'unpdf';
import { config } from '../config.js';
import { db, type PaperRow } from '../db.js';

export async function inspectPdf(
  buffer: Buffer,
): Promise<{ pages: number; title: string | null; firstPageText: string }> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  let title: string | null = null;
  try {
    const meta = await pdf.getMetadata();
    const info = meta.info as Record<string, unknown> | undefined;
    if (typeof info?.Title === 'string' && info.Title.trim()) title = info.Title.trim();
  } catch {
    // metadata is optional
  }

  let firstPageText = '';
  try {
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();
    firstPageText = content.items
      .map((item) => {
        const text = (item as { str?: unknown }).str;
        return typeof text === 'string' ? text : '';
      })
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 8000);
  } catch {
    // scanned PDFs may have no text layer
  }

  return { pages: pdf.numPages, title, firstPageText };
}

const extractionCache = new Map<string, Promise<string[]>>();

/**
 * Returns the text of every page, storing it in SQLite. Extraction is lazy:
 * it only happens when the AI needs the paper contents.
 */
export async function getPageTexts(paper: PaperRow): Promise<string[]> {
  const cachedRows = db
    .prepare('SELECT page, text FROM paper_pages WHERE paper_id = ? ORDER BY page')
    .all(paper.id) as { page: number; text: string }[];

  if (cachedRows.length >= paper.pages && paper.pages > 0) {
    return cachedRows.map((row) => row.text);
  }

  const existing = extractionCache.get(paper.id);
  if (existing) return existing;

  const task = (async () => {
    const file = await fs.readFile(path.join(config.uploadsDir, paper.stored_name));
    const pdf = await getDocumentProxy(new Uint8Array(file));
    const result = await extractText(pdf, { mergePages: false });
    const texts = result.text;
    const insert = db.prepare(
      'INSERT OR REPLACE INTO paper_pages (paper_id, page, text) VALUES (?, ?, ?)',
    );
    texts.forEach((text, index) => insert.run(paper.id, index + 1, text || ''));
    return texts.map((text) => text || '');
  })();

  extractionCache.set(paper.id, task);
  try {
    return await task;
  } finally {
    extractionCache.delete(paper.id);
  }
}

export function paperFilePath(paper: PaperRow): string {
  return path.join(config.uploadsDir, paper.stored_name);
}
