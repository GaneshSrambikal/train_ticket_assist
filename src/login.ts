import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';

export interface Credentials { username: string; password: string }

function validateCredentials(value: unknown): Credentials {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid login configuration.');
  const data = value as Record<string, unknown>;
  if (typeof data.username !== 'string' || !data.username.trim() || typeof data.password !== 'string' || !data.password.length) {
    throw new Error('Login autofill requires both username and password. Fill .local/credentials.json or set IRCTC_USERNAME and IRCTC_PASSWORD.');
  }
  return { username: data.username.trim(), password: data.password };
}

export async function loadCredentials(directory: string, env: NodeJS.ProcessEnv = process.env): Promise<Credentials | undefined> {
  if (env.IRCTC_USERNAME !== undefined || env.IRCTC_PASSWORD !== undefined) {
    return validateCredentials({ username: env.IRCTC_USERNAME, password: env.IRCTC_PASSWORD });
  }
  let contents;
  try { contents = await readFile(path.join(directory, 'credentials.json'), 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error('Cannot read .local/credentials.json. Check file permissions.');
  }
  let data: unknown;
  try { data = JSON.parse(contents.replace(/^\uFEFF/, '')); }
  catch { throw new Error('Invalid JSON in .local/credentials.json.'); }
  return validateCredentials(data);
}

export async function autofillLogin(
  page: Page, credentials: Credentials, timeout = 600000,
): Promise<'filled' | 'already-past-login' | 'manual-required'> {
  const username = page.locator('input[placeholder="User Name" i], input[autocomplete="username"], input[formcontrolname="userid"]').filter({ visible: true });
  const passenger = page.locator('input[formcontrolname="passengerName"], input[placeholder="Name"]').filter({ visible: true });
  try {
    // Book Now may first show a station dialog, or skip login if already signed in.
    await username.or(passenger).first().waitFor({ state: 'visible', timeout });
    if (await passenger.count()) return 'already-past-login';
    await username.fill(credentials.username);
    await page.locator('input[type="password"]').filter({ visible: true }).fill(credentials.password);
    const captcha = page.locator('input#captcha, input[placeholder*="captcha" i]').filter({ visible: true });
    if (await captcha.count() === 1) await captcha.focus();
    return 'filled';
  } catch {
    // Playwright errors can contain the value supplied to fill(). Never propagate
    // those messages/call logs when handling credentials.
    return 'manual-required';
  }
}
