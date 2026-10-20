import AdmZip from 'adm-zip';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config, newId, now } from '../config.js';
import { db } from '../db.js';
import { HttpError } from '../http.js';

const MAX_FILES = 500;
const MAX_UNCOMPRESSED = 60 * 1024 * 1024;
const MAX_SKILL_FILE = 200 * 1024;

type SkillRow = {
  id: string;
  name: string;
  description: string;
  dir_name: string;
  file_count: number;
  created_at: string;
};

function parseFrontmatter(markdown: string): { name?: string; description?: string; body: string } {
  if (!markdown.startsWith('---')) return { body: markdown };
  const end = markdown.indexOf('\n---', 3);
  if (end === -1) return { body: markdown };
  const header = markdown.slice(3, end);
  const body = markdown.slice(end + 4);
  const fields: Record<string, string> = {};
  for (const line of header.split('\n')) {
    const match = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (match) fields[match[1].toLowerCase()] = match[2].replace(/^["']|["']$/g, '').trim();
  }
  return { name: fields.name, description: fields.description, body };
}

function findSkillFile(root: string): string | null {
  const candidates = ['SKILL.md', 'skill.md', 'README.md', 'readme.md'];
  for (const candidate of candidates) {
    const full = path.join(root, candidate);
    if (fs.existsSync(full)) return full;
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const candidate of candidates) {
      const full = path.join(root, entry.name, candidate);
      if (fs.existsSync(full)) return full;
    }
  }
  return null;
}

function countFiles(root: string): number {
  let count = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) count += countFiles(path.join(root, entry.name));
    else count += 1;
  }
  return count;
}

export function installSkill(zipBuffer: Buffer, fallbackName: string): SkillRow {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();
  if (entries.length > MAX_FILES) throw new HttpError(400, `A skill may contain at most ${MAX_FILES} files.`);

  const total = entries.reduce((sum, entry) => sum + (entry.header.size || 0), 0);
  if (total > MAX_UNCOMPRESSED) throw new HttpError(400, 'The skill archive is too large once uncompressed.');

  const id = newId();
  const dirName = id;
  const target = path.join(config.skillsDir, dirName);
  fs.mkdirSync(target, { recursive: true });

  let written = 0;
  for (const entry of entries) {
    const rawName = entry.entryName.replace(/\\/g, '/');
    if (!rawName || rawName.endsWith('/')) {
      fs.mkdirSync(path.join(target, rawName), { recursive: true });
      continue;
    }
    if (rawName.startsWith('/') || rawName.includes('\0') || rawName.split('/').includes('..')) {
      fsp.rm(target, { recursive: true, force: true }).catch(() => {});
      throw new HttpError(400, 'The archive contains an unsafe path.');
    }
    const destination = path.join(target, rawName);
    if (!destination.startsWith(target + path.sep)) {
      fsp.rm(target, { recursive: true, force: true }).catch(() => {});
      throw new HttpError(400, 'The archive contains an unsafe path.');
    }
    const data = entry.getData();
    written += data.length;
    if (written > MAX_UNCOMPRESSED) {
      fsp.rm(target, { recursive: true, force: true }).catch(() => {});
      throw new HttpError(400, 'The skill archive is too large once uncompressed.');
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, data);
  }

  const skillFile = findSkillFile(target);
  let name = fallbackName;
  let description = '';
  if (skillFile) {
    const markdown = fs.readFileSync(skillFile, 'utf8').slice(0, 100_000);
    const parsed = parseFrontmatter(markdown);
    if (parsed.name) name = parsed.name;
    if (parsed.description) description = parsed.description;
    else {
      const firstLine = parsed.body
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line && !line.startsWith('#'));
      description = (firstLine || '').slice(0, 240);
    }
  }

  const fileCount = countFiles(target);
  const row: SkillRow = {
    id,
    name: name.slice(0, 120),
    description: description.slice(0, 400),
    dir_name: dirName,
    file_count: fileCount,
    created_at: now(),
  };
  db.prepare(
    'INSERT INTO skills (id, name, description, dir_name, file_count, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(row.id, row.name, row.description, row.dir_name, row.file_count, row.created_at);
  return row;
}

export function listSkills(): SkillRow[] {
  return db.prepare('SELECT * FROM skills ORDER BY created_at DESC').all() as SkillRow[];
}

export function getSkill(id: string): SkillRow | undefined {
  return db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as SkillRow | undefined;
}

export function getSkillByName(name: string): SkillRow | undefined {
  return db.prepare('SELECT * FROM skills WHERE lower(name) = lower(?)').get(name) as
    | SkillRow
    | undefined;
}

export function deleteSkill(id: string): boolean {
  const skill = getSkill(id);
  if (!skill) return false;
  db.prepare('DELETE FROM skills WHERE id = ?').run(id);
  fs.rmSync(path.join(config.skillsDir, skill.dir_name), { recursive: true, force: true });
  return true;
}

function skillRoot(skill: SkillRow): string {
  return path.join(config.skillsDir, skill.dir_name);
}

export function readSkillInstructions(skill: SkillRow): string {
  const root = skillRoot(skill);
  const skillFile = findSkillFile(root);
  if (!skillFile) return '(This skill has no SKILL.md file.)';
  return fs.readFileSync(skillFile, 'utf8').slice(0, 30_000);
}

export function readSkillFile(skill: SkillRow, relativePath: string): string {
  const root = skillRoot(skill);
  const clean = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const full = path.resolve(root, clean);
  if (!full.startsWith(root + path.sep) && full !== root) {
    throw new HttpError(400, 'Unsafe skill file path.');
  }
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    throw new HttpError(404, 'Skill file not found.');
  }
  const stat = fs.statSync(full);
  if (stat.size > MAX_SKILL_FILE) throw new HttpError(400, 'Skill file is too large to read.');
  return fs.readFileSync(full, 'utf8');
}

export function listSkillFiles(skill: SkillRow): string[] {
  const root = skillRoot(skill);
  const files: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else files.push(rel);
      if (files.length > MAX_FILES) return;
    }
  };
  if (fs.existsSync(root)) walk(root, '');
  return files;
}
