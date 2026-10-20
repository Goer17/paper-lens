#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const dataDir = process.env.PAPER_READER_DATA
  ? path.resolve(process.env.PAPER_READER_DATA)
  : path.resolve(import.meta.dirname, '..', 'data');
const tokenFile = path.join(dataDir, 'token.txt');

try {
  const token = fs.readFileSync(tokenFile, 'utf8').trim();
  if (!token) throw new Error('empty token file');
  console.log(token);
} catch {
  console.error(`No token found at ${tokenFile}`);
  console.error('Start the server once (npm run dev) to generate one, or set APP_TOKEN.');
  process.exit(1);
}
