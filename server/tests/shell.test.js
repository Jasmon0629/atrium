import { test } from 'node:test';
import assert from 'node:assert/strict';
import { injectBuild } from '../src/app.js';

test('injectBuild replaces the dev stamp with the build id', () => {
  const html = '<!doctype html><html><head>\n<meta name="atrium-build" content="dev" />\n<title>x</title></head></html>';
  const out = injectBuild(html, 'abc123XYZ_');
  assert.match(out, /<meta name="atrium-build" content="abc123XYZ_" \/>/);
  assert.ok(!out.includes('content="dev"'), 'the dev placeholder is gone');
  assert.equal(out.match(/atrium-build/g).length, 1, 'exactly one stamp');
});

test('injectBuild adds a stamp when the shell has none', () => {
  const out = injectBuild('<html><head><title>x</title></head></html>', 'b1');
  assert.match(out, /<head>\s*<meta name="atrium-build" content="b1" \/>/);
});
