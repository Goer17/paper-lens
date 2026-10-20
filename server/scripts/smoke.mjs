#!/usr/bin/env node
/**
 * End-to-end smoke test against a throw-away server instance.
 * Usage: npm run smoke   (builds the server first)
 */
import AdmZip from 'adm-zip';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TOKEN = 'smoke-test-token';
const PORT = 8899;
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paperlens-smoke-'));
const serverDir = path.resolve(import.meta.dirname, '..');
let child = null;
let passed = 0;

function check(condition, message) {
  if (!condition) throw new Error(message);
  passed += 1;
  console.log(`  ✓ ${message}`);
}

function makePdf() {
  const stream = 'BT /F1 18 Tf 72 700 Td (PaperLens smoke test) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

async function request(pathname, options = {}, token = TOKEN) {
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${BASE}${pathname}`, { ...options, headers });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: response.status, body, headers: response.headers };
}

async function waitForServer() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Server did not become healthy in time.');
}

async function main() {
  child = spawn(process.execPath, ['dist/index.js'], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: String(PORT),
      PAPER_READER_DATA: dataDir,
      APP_TOKEN: TOKEN,
      DEEPSEEK_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (chunk) => {
    if (process.env.SMOKE_VERBOSE) process.stderr.write(chunk);
  });
  child.on('exit', (code) => {
    if (code && child) console.error(`Server exited with code ${code}`);
  });

  await waitForServer();
  console.log('Smoke test · isolated data dir', dataDir);

  const health = await request('/api/health', {}, '');
  check(health.status === 200 && health.body.ok === true, 'health endpoint is public');

  const denied = await request('/api/collections', {}, 'wrong-token');
  check(denied.status === 401, 'protected routes reject an invalid token');

  const login = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: TOKEN }),
  }, '');
  check(login.status === 200 && login.body.ok === true, 'login accepts the generated token');

  const folder = await request('/api/collections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Smoke Folder' }),
  });
  check(folder.status === 201 && folder.body.name === 'Smoke Folder', 'create a folder');

  const childFolder = await request('/api/collections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Smoke Child', parent_id: folder.body.id }),
  });
  check(childFolder.status === 201 && childFolder.body.parent_id === folder.body.id, 'create a subfolder');

  const cycle = await request(`/api/collections/${folder.body.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parent_id: childFolder.body.id }),
  });
  check(cycle.status === 400, 'reject a folder cycle');

  const reParented = await request(`/api/collections/${childFolder.body.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parent_id: null }),
  });
  check(reParented.status === 200 && reParented.body.parent_id === null, 'move a folder to the root');

  const upload = new FormData();
  upload.append('files', new Blob([makePdf()], { type: 'application/pdf' }), 'smoke.pdf');
  upload.append('collection_id', folder.body.id);
  const paperResponse = await request('/api/papers', { method: 'POST', body: upload });
  check(paperResponse.status === 201, 'upload a PDF');
  const paper = paperResponse.body.papers[0];
  check(paper.pages === 1 && paper.collection_id === folder.body.id, 'PDF page count and folder assignment');
  check(typeof paper.title === 'string' && paper.title.length > 0, 'upload returns a display title');
  const pdfFile = await fetch(`${BASE}/api/papers/${paper.id}/file`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  check(pdfFile.status === 200 && pdfFile.headers.get('content-type') === 'application/pdf', 'stream the PDF');

  const annotationResponse = await request('/api/annotations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      paper_id: paper.id,
      type: 'highlight',
      page: 1,
      color: '#ffd54a',
      rects: [{ x: 0.1, y: 0.2, w: 0.5, h: 0.02 }],
      text: 'PaperLens smoke test',
    }),
  });
  check(annotationResponse.status === 201, 'create a highlight');
  const annotation = annotationResponse.body.annotation;
  check(annotation.label === 'highlight_1', 'annotation labels use the type_N scheme');

  const boxResponse = await request('/api/annotations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      paper_id: paper.id,
      type: 'box',
      page: 1,
      color: '#7cc4ff',
      rects: [{ x: 0.1, y: 0.3, w: 0.2, h: 0.1 }],
      text: 'boxed text',
      image_data_url:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    }),
  });
  check(boxResponse.status === 201 && boxResponse.body.annotation.image_url, 'create a box annotation with an image');
  const image = await fetch(`${BASE}${boxResponse.body.annotation.image_url}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  check(image.status === 200 && image.headers.get('content-type') === 'image/png', 'serve the box crop');

  const note = await request(`/api/annotations/${annotation.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: 'A smoke-test note.' }),
  });
  check(note.status === 200 && note.body.annotation.note === 'A smoke-test note.', 'save a note');

  const listed = await request(`/api/papers/${paper.id}/annotations`);
  check(listed.body.annotations.length === 2, 'list annotations for a paper');

  const search = await request('/api/papers?q=smoke');
  check(search.body.papers.length === 1, 'search papers by title');

  const settings = await request('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ theme_color: '#c4553d', ai_language: 'Chinese' }),
  });
  check(
    settings.body.settings.theme_color === '#c4553d' && settings.body.settings.ai_language === 'Chinese',
    'persist settings',
  );

  const brokenModel = await request('/api/models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Smoke Model',
      base_url: 'http://127.0.0.1:9/v1',
      api_key: 'smoke-key',
      model_name: 'smoke-model',
    }),
  });
  check(brokenModel.status === 201 && brokenModel.body.model.has_key, 'add a model with a masked key');
  check(!JSON.stringify(brokenModel.body.model).includes('smoke-key'), 'never return the raw API key');

  const disabled = await request(`/api/models/${brokenModel.body.model.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: false }),
  });
  check(disabled.body.model.enabled === false, 'disable a model');

  const zip = new AdmZip();
  zip.addFile(
    'smoke-skill/SKILL.md',
    Buffer.from(
      '---\nname: Smoke Skill\ndescription: A skill created by the smoke test.\n---\n\n# Smoke Skill\n',
    ),
  );
  zip.addFile('smoke-skill/checklist.md', Buffer.from('- check\n'));
  const skillForm = new FormData();
  skillForm.append('file', new Blob([zip.toBuffer()], { type: 'application/zip' }), 'skill.zip');
  const skillResponse = await request('/api/skills', { method: 'POST', body: skillForm });
  check(
    skillResponse.status === 201 && skillResponse.body.skill.name === 'Smoke Skill',
    'install and parse a skill zip',
  );
  check(skillResponse.body.skill.file_count === 2, 'count extracted skill files');

  const messages = await request(`/api/papers/${paper.id}/messages`);
  check(Array.isArray(messages.body.messages) && messages.body.messages.length === 0, 'start with an empty chat thread');

  const chat = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      paper_id: paper.id,
      message: 'Hello',
      citation_ids: [annotation.id],
    }),
  });
  const chatText = await chat.text();
  check(chat.status === 200 && chatText.includes('No AI model is enabled'), 'chat fails gracefully without a model');

  const removed = await request(`/api/skills/${skillResponse.body.skill.id}`, { method: 'DELETE' });
  check(removed.status === 200, 'delete a skill');

  const removedPaper = await request(`/api/papers/${paper.id}`, { method: 'DELETE' });
  check(removedPaper.status === 200, 'delete a paper and its annotations');

  const finalList = await request('/api/papers');
  check(finalList.body.papers.length === 0, 'paper list is clean after deletion');

  console.log(`\nSmoke test passed: ${passed} checks.`);
}

try {
  await main();
} catch (error) {
  console.error('\nSmoke test failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (child) {
    child.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  fs.rmSync(dataDir, { recursive: true, force: true });
}
