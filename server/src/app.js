import express from 'express';
import cors from 'cors';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { authRouter, authRequired } from './auth.js';
import { initLive } from './live.js';
import { groupsRouter } from './routes/groups.js';
import { tasksRouter } from './routes/tasks.js';
import { announcementsRouter } from './routes/announcements.js';
import { chatRouter } from './routes/chat.js';
import {
  notificationsRouter,
  activityRouter,
  usersRouter,
  searchRouter,
  adminRouter,
} from './routes/misc.js';

/**
 * Browser origins allowed to call the API cross-origin (HTTP and Socket.IO).
 * Same-origin traffic (the SPA served by this process, or the Vite proxy in
 * dev) never needs CORS and bots/curl are not subject to it, so production
 * uses a short allowlist derived from the hostnames Caddy serves. Development
 * reflects any origin. Override with ATRIUM_ORIGINS="https://a https://b".
 */
export function corsOrigins() {
  if (process.env.ATRIUM_ORIGINS) return process.env.ATRIUM_ORIGINS.split(/[\s,]+/).filter(Boolean);
  if (process.env.NODE_ENV !== 'production') return true;
  const origins = (process.env.ATRIUM_HOST || '').split(/\s+/).filter(Boolean).map((h) => `https://${h}`);
  if (process.env.ATRIUM_IP) origins.push(`http://${process.env.ATRIUM_IP}`);
  return origins.length ? origins : false;
}

/**
 * Content-Security-Policy for the HTML shell. Scripts may only come from this
 * origin plus the exact inline theme bootstrap in index.html (allowed by hash,
 * computed from the built file so a rebuild can never break it). Styles allow
 * inline because the drag-and-drop library injects <style> tags at runtime;
 * fonts come from Google Fonts. Everything else (frames, plugins, form posts,
 * fetch/WebSocket targets) is locked to this origin.
 */
export function buildCsp(indexHtml, host) {
  const hashes = [];
  for (const m of indexHtml.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    if (/\ssrc=/i.test(m[1] || '')) continue;
    hashes.push(`'sha256-${crypto.createHash('sha256').update(m[2]).digest('base64')}'`);
  }
  const self = host ? ` ws://${host} wss://${host}` : '';
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(' ')}`.trim(),
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    `connect-src 'self'${self}`,
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join('; ');
}

/**
 * Stamp the HTML shell with the running build id. The client compares this
 * stamp with the id the server announces on every socket connection, so a tab
 * left open across a deploy knows it is stale (see web/src/lib/version.ts).
 */
export function injectBuild(html, buildId) {
  const tag = `<meta name="atrium-build" content="${buildId}" />`;
  if (/<meta name="atrium-build"[^>]*>/.test(html)) return html.replace(/<meta name="atrium-build"[^>]*>/, tag);
  return html.replace(/<head>/i, `<head>\n    ${tag}`);
}

export function createServer() {
  const app = express();
  // Reported by /api/health and the socket handshake; set from the built shell below.
  let buildId = 'dev';
  app.disable('x-powered-by');
  // Exactly one reverse proxy (Caddy in production, Vite in dev) sits in front,
  // so trust one hop of X-Forwarded-For — enough for the login rate limiter,
  // without letting clients forge their address through extra headers.
  app.set('trust proxy', 1);
  const origin = corsOrigins();
  app.use(cors({ origin, credentials: true }));
  app.use(express.json({ limit: '1mb' }));

  // API responses are live data: no browser, proxy or back/forward cache may reuse them.
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', (req, res) => res.json({ ok: true, build: buildId }));
  app.use('/api/auth', authRouter);
  app.use('/api/groups', authRequired, groupsRouter);
  app.use('/api', authRequired, tasksRouter); // /groups/:id/tasks, /tasks/:id..., /my-tasks
  app.use('/api/announcements', authRequired, announcementsRouter);
  app.use('/api/chat', authRequired, chatRouter);
  app.use('/api/notifications', authRequired, notificationsRouter);
  app.use('/api/activity', authRequired, activityRouter);
  app.use('/api/users', authRequired, usersRouter);
  app.use('/api/search', authRequired, searchRouter);
  app.use('/api/admin', authRequired, adminRouter);

  // Production: serve the built frontend (web/dist) with an SPA fallback.
  // The reverse proxy strips any URL prefix, so paths arrive rooted here.
  const webDist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist');
  if (existsSync(webDist)) {
    const rawIndex = readFileSync(path.join(webDist, 'index.html'), 'utf8');
    // The build id is a hash of the built shell: it changes whenever any chunk
    // or stylesheet it references changes, and is stable across restarts.
    buildId = crypto.createHash('sha256').update(rawIndex).digest('base64url').slice(0, 10);
    const indexHtml = injectBuild(rawIndex, buildId);
    const cspFor = (req) => buildCsp(indexHtml, req.headers.host);
    // index.html must NOT be cached: a stale copy points at asset hashes that
    // vanish on the next deploy and the app fails to boot. (res.send still
    // gives conditional requests an ETag, so unchanged shells answer 304.)
    const serveIndex = (req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Content-Security-Policy', cspFor(req));
      res.type('html').send(indexHtml);
    };
    app.get('/index.html', serveIndex);
    // Vite fingerprints everything under /assets, so those files may be cached forever.
    app.use(
      express.static(webDist, {
        index: false,
        maxAge: '1y',
        immutable: true,
        setHeaders: (res, filePath) => {
          if (!filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      })
    );
    // SPA fallback: every other GET renders the shell and the router takes over.
    app.use((req, res, next) => {
      if ((req.method === 'GET' || req.method === 'HEAD') && !req.path.startsWith('/api') && !req.path.startsWith('/socket.io')) {
        return serveIndex(req, res);
      }
      next();
    });
  }

  // Uniform error handler: never leak stack traces to clients
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server' });
  });

  const httpServer = http.createServer(app);
  initLive(httpServer, { corsOrigin: origin, buildId });
  return httpServer;
}
