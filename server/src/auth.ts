import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { APP_TOKEN } from './config.js';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function extractToken(req: Request): string {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  const query = req.query.token;
  if (typeof query === 'string') return query;
  return '';
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!safeEqual(extractToken(req), APP_TOKEN)) {
    res.status(401).json({ error: 'Unauthorized. A valid access token is required.' });
    return;
  }
  next();
}

export function isValidToken(token: string): boolean {
  return safeEqual(token, APP_TOKEN);
}
