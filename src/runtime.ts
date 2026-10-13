import { mkdir, open, readFile, unlink, appendFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export const states = ['READY', 'BROWSER_OPEN', 'SEARCH_READY', 'SEARCH_PREPARED', 'TRAIN_SELECTED', 'BOOKING_STARTED', 'USER_HANDOFF', 'FAILED', 'CLOSED'] as const;
export type State = typeof states[number];
const allowed: Record<State, State[]> = {
  READY: ['BROWSER_OPEN', 'FAILED'],
  BROWSER_OPEN: ['SEARCH_READY', 'FAILED', 'CLOSED'],
  SEARCH_READY: ['SEARCH_PREPARED', 'CLOSED', 'FAILED'],
  SEARCH_PREPARED: ['TRAIN_SELECTED', 'CLOSED', 'FAILED'],
  TRAIN_SELECTED: ['BOOKING_STARTED', 'CLOSED', 'FAILED'],
  BOOKING_STARTED: ['USER_HANDOFF', 'FAILED'],
  USER_HANDOFF: ['CLOSED', 'FAILED'],
  FAILED: ['CLOSED'],
  CLOSED: [],
};

export class Journal {
  readonly runId = randomUUID();
  private state: State = 'READY';
  constructor(private directory: string) {}
  async transition(next: State): Promise<void> {
    if (!allowed[this.state].includes(next)) throw new Error(`Invalid transition: ${this.state} -> ${next}`);
    await mkdir(this.directory, { recursive: true });
    // Intentionally no passenger, credential, URL, or page content fields.
    await appendFile(path.join(this.directory, `${this.runId}.jsonl`), JSON.stringify({
      at: new Date().toISOString(), runId: this.runId, from: this.state, to: next,
    }) + '\n');
    this.state = next;
  }
}

function ownerIsGone(pid: number): boolean {
  try { process.kill(pid, 0); return false; }
  catch (error) {
    // Access denied and other errors do not prove the owner has exited.
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

async function recoverStaleLock(filename: string): Promise<void> {
  // Serialize recovery so two new launches cannot delete one another's lock.
  const recoveryFile = `${filename}.recovery`;
  let guard;
  try { guard = await open(recoveryFile, 'wx'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('Lock recovery is already in progress. Retry shortly. If a recovery crashed, verify no assistant is running before removing .local/run.lock.recovery.');
    }
    throw error;
  }
  try {
    let lock;
    try { lock = JSON.parse(await readFile(filename, 'utf8')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw new Error('The run lock is unreadable. Verify no assistant is running before removing .local/run.lock.');
    }
    if (!Number.isSafeInteger(lock?.pid) || lock.pid <= 0 || typeof lock.token !== 'string') {
      throw new Error('The run lock is invalid. Verify no assistant is running before removing .local/run.lock.');
    }
    if (!ownerIsGone(lock.pid)) {
      throw new Error(`Another run is still active (PID ${lock.pid}). Close its Chrome window or press Ctrl+C in its terminal before restarting.`);
    }
    await unlink(filename);
  } finally {
    await guard.close();
    await unlink(recoveryFile);
  }
}

export async function acquireLock(directory: string): Promise<() => Promise<void>> {
  await mkdir(directory, { recursive: true });
  const filename = path.join(directory, 'run.lock');
  const token = randomUUID();
  let handle;
  try { handle = await open(filename, 'wx'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      await recoverStaleLock(filename);
      // Exclusive creation still arbitrates if a different launcher won the race.
      try { handle = await open(filename, 'wx'); }
      catch (retryError) {
        if ((retryError as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new Error('Another run acquired the lock. Close that run before restarting.');
        }
        throw retryError;
      }
    } else {
      throw error;
    }
  }
  try { await handle.writeFile(JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() })); }
  finally { await handle.close(); }
  return async () => {
    try {
      const lock = JSON.parse(await readFile(filename, 'utf8'));
      if (lock.token === token) await unlink(filename);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  };
}
