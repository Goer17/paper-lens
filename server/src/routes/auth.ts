import { Router } from 'express';
import { isValidToken } from '../auth.js';

export const authRouter = Router();

authRouter.post('/login', (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (!isValidToken(token)) {
    res.status(401).json({ error: 'Invalid access token.' });
    return;
  }
  res.json({ ok: true, token });
});

authRouter.get('/me', (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  res.json({ ok: isValidToken(token) });
});
