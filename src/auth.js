import crypto from 'crypto';
import { config } from './config.js';

const COOKIE_NAME = 'mw_session';
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24h

function sign(data) {
  const hmac = crypto.createHmac('sha256', config.sessionSecret);
  hmac.update(data);
  return hmac.digest('hex');
}

function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  return Object.fromEntries(
    cookieHeader.split(';').map(c => {
      const [k, ...v] = c.trim().split('=');
      return [k, v.join('=')];
    })
  );
}

export function createSession(username) {
  const timestamp = Date.now().toString();
  const data = `${username}|${timestamp}`;
  const signature = sign(data);
  return Buffer.from(`${data}|${signature}`).toString('base64');
}

export function validateSession(token) {
  try {
    const decoded = Buffer.from(token, 'base64').toString();
    const parts = decoded.split('|');
    if (parts.length !== 3) return null;

    const [username, timestamp, signature] = parts;
    const expected = sign(`${username}|${timestamp}`);

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;

    const age = Date.now() - parseInt(timestamp);
    if (age > SESSION_DURATION) return null;

    return { username };
  } catch {
    return null;
  }
}

export function authMiddleware() {
  return async (c, next) => {
    const cookies = parseCookies(c.req.header('cookie'));
    const token = cookies[COOKIE_NAME];
    if (!token) return c.redirect('/login');

    const session = validateSession(decodeURIComponent(token));
    if (!session) return c.redirect('/login');

    c.set('user', session);
    await next();
  };
}

export function apiAuthMiddleware() {
  return async (c, next) => {
    const cookies = parseCookies(c.req.header('cookie'));
    const token = cookies[COOKIE_NAME];
    if (!token) return c.json({ error: 'Unauthorized' }, 401);

    const session = validateSession(decodeURIComponent(token));
    if (!session) return c.json({ error: 'Unauthorized' }, 401);

    c.set('user', session);
    await next();
  };
}

export { COOKIE_NAME };
