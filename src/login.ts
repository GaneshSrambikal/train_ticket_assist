import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';
import { passengerNames } from './passenger-fields.js';

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
): Promise<'filled' | 'submitted' | 'already-past-login' | 'manual-required'> {
  const username = page.locator('input[placeholder="User Name" i], input[autocomplete="username"], input[formcontrolname="userid"]').filter({ visible: true });
  const passenger = passengerNames(page);
  try {
    // Book Now may first show a station dialog, or skip login if already signed in.
    await username.or(passenger).first().waitFor({ state: 'visible', timeout });
    if (await passenger.count()) return 'already-past-login';
    await username.fill(credentials.username);
    await page.locator('input[type="password"]').filter({ visible: true }).fill(credentials.password);
    const challenge = page.locator([
      'input#captcha', 'input[placeholder*="captcha" i]',
      'input[formcontrolname*="captcha" i]', 'input[name*="captcha" i]',
      'input[placeholder*="otp" i]', 'input[formcontrolname*="otp" i]:not([type="checkbox"])',
      'input[autocomplete="one-time-code"]', 'input[placeholder*="verification code" i]',
      'iframe[src*="captcha" i]', 'img[src*="captcha" i]',
    ].join(',')).filter({ visible: true });
    const signIn = page.getByRole('button', { name: /^\s*(Sign\s*In|Log\s*In)\s*$/i }).filter({ visible: true });
    await signIn.waitFor({ state: 'visible', timeout: 5000 });
    // Allow dynamically loaded verification controls to appear before submitting.
    await challenge.first().waitFor({ state: 'visible', timeout: 1500 }).catch(() => {});
    if (await challenge.count()) {
      const input = challenge.and(page.locator('input')).first();
      if (await input.count()) await input.focus();
      return 'filled';
    }
    if (!await signIn.isEnabled()) return 'manual-required';
    await signIn.click({ timeout: 5000 });
    // Submit once only. Any subsequent verification or login error is manual.
    return 'submitted';
  } catch {
    // Playwright errors can contain the value supplied to fill(). Never propagate
    // those messages/call logs when handling credentials.
    return 'manual-required';
  }
}
