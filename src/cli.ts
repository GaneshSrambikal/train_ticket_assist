import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { createInterface } from 'node:readline/promises';
import { launchBrowser, openSearch } from './browser.js';
import { loadJourney } from './config.js';
import { tatkalOpensAt } from './tatkal-clock.js';
import { acquireLock, Journal } from './runtime.js';
import { prepareSearch } from './search.js';
import { searchAndSelect, assertBookable } from './trains.js';
import { requireRealJourney, assertNoPendingBooking, beginGuidedBooking, resolveBookingAttempt } from './booking.js';
import { loadCredentials } from './login.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const command = process.argv[2] || 'open';
const configFile = process.argv[3];

async function confirm(message: string, expected: string, signal?: AbortSignal): Promise<boolean> {
  if (!process.stdin.isTTY) throw new Error('Booking requires an interactive terminal.');
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await terminal.question(`${message}\nType ${expected}: `, { signal })).trim() === expected; }
  finally { terminal.close(); }
}

async function main(): Promise<void> {
  if (!['open', 'check', 'validate', 'prepare', 'search', 'book', 'resolve-booking'].includes(command)) {
    throw new Error('Commands: open | check | validate | prepare | search | book | resolve-booking');
  }
  if (['validate', 'prepare', 'search', 'book'].includes(command) && !configFile) {
    throw new Error('Provide a journey JSON path, for example: npm.cmd run validate -- config/journey.general.example.json');
  }
  const journey = configFile ? await loadJourney(path.resolve(configFile)) : undefined;
  if (journey) {
    console.log(`${journey.quota}: ${journey.from} -> ${journey.to}, ${journey.journeyDate}, ${journey.travelClass}`);
    console.log('Local format checks passed. Route, quota eligibility, fare and reservation window require live verification.');
    const opening = tatkalOpensAt(journey);
    if (opening) console.log(`Tatkal opening guidance: ${opening.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);
  }
  if (command === 'validate') return;
  // Validate credentials before any browser/booking action. Values are never logged.
  const credentials = command === 'book' ? await loadCredentials(path.join(root, '.local')) : undefined;

  if (command === 'book' && journey) {
    requireRealJourney(configFile!, journey);
    if (!process.stdin.isTTY) throw new Error('Use an interactive terminal for booking.');
    await assertNoPendingBooking(path.join(root, '.local'));
  }

  const release = await acquireLock(path.join(root, '.local'));
  if (command === 'resolve-booking') {
    try {
      if (await confirm('Check IRCTC booking AND transaction history. Clear the guard only when the previous outcome is known and no payment is pending.', 'CHECKED')) {
        await resolveBookingAttempt(path.join(root, '.local'));
        console.log('Previous attempt acknowledged. A new booking can now be started.');
      }
    } finally { await release(); }
    return;
  }
  const journal = new Journal(path.join(root, '.local', 'runs'));
  let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
  const close = () => { void browser?.close(); };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  try {
    browser = await launchBrowser();
    await journal.transition('BROWSER_OPEN');
    const context = await browser.newContext({ viewport: { width: 1478, height: 1056 } });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    let passed = false;
    let failure: string | undefined;
    try {
      await openSearch(page);
      await journal.transition('SEARCH_READY');
      console.log('IRCTC search form is visible and editable.');
      if (['prepare', 'search', 'book'].includes(command) && journey) {
        await prepareSearch(page, journey);
        await journal.transition('SEARCH_PREPARED');
        if (command === 'prepare') console.log('Search fields prepared. Review them in Chrome; no search or booking was submitted.');
        else {
          const selection = await searchAndSelect(page, journey);
          await journal.transition('TRAIN_SELECTED');
          console.log(`${selection.train}\n${selection.route}\n${journey.quota} / ${journey.travelClass}: ${selection.availability}; displayed fare Rs ${selection.quotedFare} (verify final total at review).`);
          if (!selection.routeMatches) console.log('WARNING: the train uses different stations from your search. Booking will be stopped; review your station codes.');
          if (command === 'book') {
            assertBookable(journey, selection);
            const abort = new AbortController();
            const abortPrompt = () => abort.abort();
            page.once('close', abortPrompt);
            let approved;
            try {
              approved = await confirm(`Review this train/date/quota, ${journey.passengers.length} passenger(s), and your configuration. Continue to Book Now?`, `BOOK ${journey.trainNumber}`, abort.signal);
            } finally { page.removeListener('close', abortPrompt); }
            if (approved) {
              await journal.transition('BOOKING_STARTED');
              await beginGuidedBooking(page, journey, selection, path.join(root, '.local'), credentials);
              await journal.transition('USER_HANDOFF');
            } else console.log('Booking cancelled before Book Now.');
          } else console.log('Search complete. Book Now was not clicked.');
        }
      }
      passed = true;
    } catch (error) {
      // Error text is shown only locally; the persistent report stores no page content.
      console.error(error instanceof Error ? error.message : 'Browser operation failed.');
      failure = 'Workflow stopped; inspect the local terminal and any pending booking guard before retrying.';
      await journal.transition('FAILED');
      process.exitCode = 1;
    }
    const directory = path.join(root, 'artifacts');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `${journal.runId}.json`), JSON.stringify({
      runId: journal.runId, at: new Date().toISOString(), command,
      browserVersion: browser.version(), searchCheckPassed: passed, failure,
    }, null, 2));
    console.log(`Run report: artifacts/${journal.runId}.json`);
    if (command !== 'check' && browser.isConnected()) {
      console.log('Chrome stays open. Close it or press Ctrl+C when finished.');
      await new Promise<void>((resolve) => {
        browser!.once('disconnected', () => resolve());
        context.once('close', () => { void browser!.close(); });
        if (!browser!.isConnected()) resolve();
      });
    }
    await journal.transition('CLOSED');
  } finally {
    try { await browser?.close(); }
    finally {
      process.removeListener('SIGINT', close);
      process.removeListener('SIGTERM', close);
      await release();
    }
  }
}

main().catch((error: unknown) => {
  if (error instanceof z.ZodError) {
    // Do not print the parsed input, which may contain passenger details.
    for (const issue of error.issues) console.error(`${issue.path.join('.')}: ${issue.message}`);
  } else console.error(error instanceof Error ? error.message : 'Run failed.');
  process.exitCode = 1;
});
