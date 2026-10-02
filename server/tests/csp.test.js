import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildCsp } from '../src/app.js';

const inline = "\n  try { document.documentElement.classList.add('dark'); } catch (e) {}\n";
const html = `<!doctype html><html><head>
<script>${inline}</script>
<script type="module" crossorigin src="/assets/index-abc.js"></script>
</head><body></body></html>`;

test('CSP allows the inline bootstrap by hash, external scripts only from self', () => {
  const csp = buildCsp(html, 'atrium.example.com');
  const hash = crypto.createHash('sha256').update(inline).digest('base64');
  const script = csp.split('; ').find((d) => d.startsWith('script-src '));
  assert.equal(script, `script-src 'self' 'sha256-${hash}'`);
  assert.ok(!csp.includes("'unsafe-inline' 'self'"), 'scripts never allow unsafe-inline');
  assert.ok(!script.includes('index-abc'), 'src scripts are not hashed');
});

test('CSP pins WebSocket targets to the serving host and locks frames, plugins and forms', () => {
  const csp = buildCsp(html, 'atrium.example.com');
  assert.match(csp, /connect-src 'self' ws:\/\/atrium\.example\.com wss:\/\/atrium\.example\.com/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'self'/);
  assert.match(csp, /form-action 'self'/);
  assert.match(csp, /font-src [^;]*https:\/\/fonts\.gstatic\.com/);
  // Without a Host header the policy still parses and stays same-origin.
  assert.match(buildCsp(html, undefined), /connect-src 'self';/);
});
