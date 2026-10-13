import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { validateJourney, indiaDate } from '../src/config.js';
import { tatkalOpensAt, millisecondsUntilOpening } from '../src/tatkal-clock.js';
import { acquireLock, Journal } from '../src/runtime.js';

const now = new Date('2026-10-13T06:00:00Z');
const input = {
  quota: 'GENERAL', from: 'NDLS', to: 'BCT', boardingStation: 'NDLS',
  journeyDate: '2026-11-15', trainNumber: '12952', travelClass: '3A',
  passengers: [{ name: 'Test Person', age: 30, gender: 'M' }], maxFare: 5000,
};

test('General has no Tatkal opening gate', () => {
  const journey = validateJourney(input, now);
  assert.equal(tatkalOpensAt(journey), null);
  assert.equal(millisecondsUntilOpening(journey, now), 0);
});

test('Tatkal uses origin date, not the later boarding date', () => {
  const journey = validateJourney({ ...input, quota: 'TATKAL', trainOriginDate: '2026-11-14' }, now);
  assert.equal(tatkalOpensAt(journey)?.toISOString(), '2026-11-13T04:30:00.000Z');
  assert.equal(tatkalOpensAt({ ...journey, travelClass: 'SL' })?.toISOString(), '2026-11-13T05:30:00.000Z');
  assert.equal(millisecondsUntilOpening(journey, new Date('2026-11-13T04:29:59Z')), 1000);
  assert.equal(millisecondsUntilOpening(journey, new Date('2026-11-13T04:30:01Z')), 0);
});

test('Tatkal crosses year boundaries correctly', () => {
  const journey = validateJourney({ ...input, quota: 'TATKAL', journeyDate: '2027-01-01', trainOriginDate: '2027-01-01' }, now);
  assert.equal(tatkalOpensAt(journey)?.toISOString(), '2026-12-31T04:30:00.000Z');
});

test('validation rejects invalid dates, missing origin date and accidental secret fields', () => {
  for (const change of [
    { journeyDate: '2026-02-30' }, { journeyDate: '2026-10-12' },
    { quota: 'TATKAL' }, { to: 'NDLS' }, { quota: 'PREMIUM_TATKAL' },
    { password: 'do-not-store' }, { trainOriginDate: '2026-11-16' },
  ]) assert.throws(() => validateJourney({ ...input, ...change }, now));
});

test('calendar date validation uses IST at midnight', () => {
  const midnight = new Date('2026-10-13T18:30:00Z');
  assert.equal(indiaDate(midnight), '2026-10-14');
  assert.throws(() => validateJourney({ ...input, journeyDate: '2026-10-13' }, midnight));
});

test('single-run lock refuses concurrent runs and releases cleanly', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'irctc-lock-test-'));
  try {
    const release = await acquireLock(directory);
    await assert.rejects(acquireLock(directory), /Another run/);
    await release();
    await release();
    const nextRelease = await acquireLock(directory);
    await nextRelease();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('journal enforces transitions and records only metadata', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'irctc-journal-test-'));
  try {
    const journal = new Journal(directory);
    await assert.rejects(journal.transition('SEARCH_PREPARED'), /Invalid transition/);
    await journal.transition('BROWSER_OPEN');
    await journal.transition('SEARCH_READY');
    await journal.transition('CLOSED');
    const file = (await readdir(directory))[0];
    const records = (await readFile(path.join(directory, file), 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(records.length, 3);
    assert.deepEqual(Object.keys(records[0]).sort(), ['at', 'from', 'runId', 'to']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('an exited owner is recovered and concurrent recovery admits only one run', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'irctc-stale-test-'));
  try {
    const child = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' });
    assert.equal(child.status, 0);
    await writeFile(path.join(directory, 'run.lock'), JSON.stringify({ pid: Number(child.stdout.trim()), token: 'old-owner' }));
    const results = await Promise.allSettled([acquireLock(directory), acquireLock(directory)]);
    const winners = results.filter((result) => result.status === 'fulfilled');
    assert.equal(winners.length, 1);
    assert.equal(JSON.parse(await readFile(path.join(directory, 'run.lock'), 'utf8')).pid, process.pid);
    for (const result of winners) if (result.status === 'fulfilled') await result.value();
    assert.deepEqual(await readdir(directory), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('malformed locks are preserved rather than guessed stale', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'irctc-invalid-lock-test-'));
  try {
    await writeFile(path.join(directory, 'run.lock'), '{}');
    await assert.rejects(acquireLock(directory), /invalid/);
    assert.equal(await readFile(path.join(directory, 'run.lock'), 'utf8'), '{}');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
