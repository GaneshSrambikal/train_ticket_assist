import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { recordDiagnostics } from '../src/diagnostics.js';

test('diagnostic recording keeps status and timing but excludes sensitive request and response contents', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'irctc-diagnostics-'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext();
    const file = path.join(directory, 'report.jsonl');
    const recorder = recordDiagnostics(context, file);
    await context.route('**/*', async route => {
      if (route.request().url().includes('/failed')) return route.abort('connectionreset');
      return route.fulfill({ status: route.request().method() === 'POST' ? 403 : 200,
        contentType: 'text/html', headers: { 'x-secret': 'response-secret' }, body: '<body>passenger-secret</body>' });
    });
    const page = await context.newPage();
    await page.goto('https://www.irctc.co.in/nget/error?token=query-secret');
    await page.evaluate(async () => {
      await fetch('/private-path-secret', { method: 'POST', headers: { Authorization: 'Bearer header-secret' }, body: 'password=body-secret' });
      await fetch('/failed').catch(() => {});
    });
    recorder.stop();
    const text = await readFile(file, 'utf8');
    assert.doesNotMatch(text, /secret|Authorization|password|https:\/\//);
    const events = text.trim().split('\n').map(line => JSON.parse(line));
    assert.ok(events.some(event => event.status === 403));
    assert.ok(events.some(event => event.event === 'failed'));
    assert.ok(events.some(event => event.route === 'irctc-error'));
    assert.ok(events.some(event => event.durationMs >= 0));
  } finally {
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
});
