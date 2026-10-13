import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';
import { autofillLogin, loadCredentials } from '../src/login.js';

test('credentials are optional, validated, and environment pairs override the file', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'irctc-login-test-'));
  try {
    assert.equal(await loadCredentials(directory, {}), undefined);
    await writeFile(path.join(directory, 'credentials.json'), JSON.stringify({ username: ' local-user ', password: ' exact password ' }));
    assert.deepEqual(await loadCredentials(directory, {}), { username: 'local-user', password: ' exact password ' });
    assert.deepEqual(await loadCredentials(directory, { IRCTC_USERNAME: 'env-user', IRCTC_PASSWORD: 'env-password' }), { username: 'env-user', password: 'env-password' });
    await assert.rejects(loadCredentials(directory, { IRCTC_USERNAME: 'env-user' }), /both username and password/);
    await writeFile(path.join(directory, 'credentials.json'), '{broken secret-data');
    await assert.rejects(loadCredentials(directory, {}), (error: Error) => error.message === 'Invalid JSON in .local/credentials.json.');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('login autofill waits for a dialog, preserves CAPTCHA and never submits', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(1000);
    await page.setContent(`<form style="display:none" id="login"><input placeholder="User Name"><input type="password"><input id="captcha" value="manual-code"><button>Sign In</button></form><script>window.submissions=0;document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submissions++};setTimeout(()=>document.querySelector('form').style.display='block',150);</script>`);
    assert.equal(await autofillLogin(page, { username: 'fixture-user', password: 'fixture-password' }, 3000), 'filled');
    assert.equal(await page.getByPlaceholder('User Name').inputValue(), 'fixture-user');
    assert.equal(await page.locator('input[type=password]').inputValue(), 'fixture-password');
    assert.equal(await page.locator('#captcha').inputValue(), 'manual-code');
    assert.equal(await page.evaluate('window.submissions'), 0);
    assert.equal(await page.locator('#captcha').evaluate(el => el === document.activeElement), true);
    await page.setContent('<input placeholder="Name">');
    assert.equal(await autofillLogin(page, { username: 'fixture-user', password: 'fixture-password' }, 1000), 'already-past-login');
    await page.setContent('<input placeholder="User Name"><input type="password" disabled>');
    assert.equal(await autofillLogin(page, { username: 'fixture-user', password: 'fixture-password' }, 1000), 'manual-required');
  } finally { await browser.close(); }
});
