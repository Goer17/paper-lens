import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { APP_TOKEN, config } from './config.js';
import { db } from './db.js';
import { requireAuth } from './auth.js';
import { HttpError } from './http.js';
import { authRouter } from './routes/auth.js';
import { collectionsRouter } from './routes/collections.js';
import { papersRouter } from './routes/papers.js';
import { annotationsRouter } from './routes/annotations.js';
import { settingsRouter } from './routes/settings.js';
import { modelsRouter } from './routes/models.js';
import { skillsRouter } from './routes/skills.js';
import { chatRouter } from './routes/chat.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, name: 'paperlens', version: '0.1.0' });
});

app.use('/api/auth', authRouter);

// Every other API route requires the generated access token.
app.use('/api', requireAuth, (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use('/api/collections', collectionsRouter);
app.use('/api/papers', papersRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/models', modelsRouter);
app.use('/api/skills', skillsRouter);
app.use('/api', annotationsRouter);
app.use('/api', chatRouter);

// Serve the built single-page app when it exists (npm run build && npm start).
if (fs.existsSync(config.webDist)) {
  app.use(express.static(config.webDist, { index: false, maxAge: '1h' }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }
    res.sendFile(path.join(config.webDist, 'index.html'));
  });
}

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found.' });
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof multer.MulterError) {
    const message =
      error.code === 'LIMIT_FILE_SIZE'
        ? `File is too large (max ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB).`
        : error.message;
    res.status(400).json({ error: message });
    return;
  }
  const message = error instanceof Error ? error.message : 'Unexpected server error.';
  console.error('[error]', error);
  res.status(500).json({ error: message });
});

const server = app.listen(config.port, config.host, () => {
  const line = '─'.repeat(64);
  console.log(`\n${line}`);
  console.log('  PAPERLENS · API server');
  console.log(`  URL    http://${config.host}:${config.port}`);
  console.log(`  Token  ${APP_TOKEN}`);
  console.log(`  File   ${config.tokenFile}`);
  console.log(`${line}`);
  console.log('  Open the web app and paste the token once.');
  console.log('  Dev: npm run dev  ·  Prod: npm run build && npm start\n');
});

function shutdown() {
  server.close(() => {
    try {
      db.close();
    } catch {
      // ignore
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
