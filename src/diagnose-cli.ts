import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { launchBrowser, IRCTC_URL } from './browser.js';
import { acquireLock } from './runtime.js';
import { recordDiagnostics } from './diagnostics.js';

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const release = await acquireLock(path.join(root, '.local'));
  let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
  let recorder: ReturnType<typeof recordDiagnostics> | undefined;
  const close = () => { void browser?.close(); };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  try {
    const directory = path.join(root, 'artifacts');
    await mkdir(directory, { recursive: true });
    const file = path.join(directory, `diagnostic-${randomUUID()}.jsonl`);
    browser = await launchBrowser();
    const context = await browser.newContext({ viewport: { width: 1478, height: 1056 } });
    recorder = recordDiagnostics(context, file);
    const cdp = await browser.newBrowserCDPSession();
    const commandLine = await cdp.send('Browser.getBrowserCommandLine').catch(() => undefined);
    // Record switch names only: values can contain local paths or tokens.
    const switches = commandLine?.arguments.filter(arg => /^--[a-z0-9-]+(?:=|$)/i.test(arg)).map(arg => arg.split('=')[0]);
    recorder.write({ event: 'browser', version: browser.version(), channel: 'chrome', headless: false,
      context: 'fresh-nonpersistent', viewport: { width: 1478, height: 1056 }, launchSwitchNames: switches ?? 'unavailable-from-browser' });
    await cdp.detach();
    console.log(`Chrome version: ${browser.version()}`);
    if (!switches) console.log('Chrome did not expose launch switches. Inspect chrome://version locally in this browser if needed.');
    console.log(`Diagnostic file: ${file}`);
    console.log('Run the flow manually through Continue. No autofill or automatic button clicks are enabled.');
    console.log('After the error or review page appears, close this Chrome window. Recording contains metadata only.');
    const page = await context.newPage();
    context.once('close', close);
    try { await page.goto(IRCTC_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }); }
    catch { console.log('Initial navigation did not finish. Inspect Chrome; recording remains active.'); }
    if (browser.isConnected()) await new Promise<void>(resolve => {
      browser!.once('disconnected', () => resolve());
      if (!browser!.isConnected()) resolve();
    });
  } finally {
    try { await browser?.close(); }
    finally {
      recorder?.stop();
      process.removeListener('SIGINT', close);
      process.removeListener('SIGTERM', close);
      await release();
    }
  }
}

main().catch(() => { console.error('Diagnostic run failed. Check that no other assistant is running and Chrome is available.'); process.exitCode = 1; });
