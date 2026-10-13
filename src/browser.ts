import { chromium, type Browser, type Page } from 'playwright';

export const IRCTC_URL = 'https://www.irctc.co.in/nget/train-search';

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({ channel: 'chrome', headless: false });
}

export function searchFields(page: Page) {
  return {
    from: page.locator('input[placeholder^="From" i], input[aria-label^="Enter From station"], #origin input').filter({ visible: true }),
    to: page.locator('input[placeholder^="To" i], input[aria-label^="Enter To station"], #destination input').filter({ visible: true }),
    date: page.locator('p-calendar input').filter({ visible: true }),
    quota: page.locator('#journeyQuota').filter({ visible: true }),
    travelClass: page.locator('#journeyClass, p-dropdown[formcontrolname="journeyClass"]').filter({ visible: true }),
  };
}

export async function dismissWelcome(page: Page): Promise<void> {
  // IRCTC overrides this button's accessible name with the entire alert text.
  const english = page.getByRole('dialog').locator('button').filter({ hasText: /^\s*English\s*$/ });
  if (await english.isVisible()) await english.click();
  const ok = page.getByRole('button', { name: /^(OK|Ok)$/ });
  if (await ok.isVisible()) await ok.click();
}

export async function openSearch(page: Page): Promise<void> {
  // The welcome overlays may appear after the underlying search form renders.
  // Handlers run when they obstruct a normal Playwright action.
  const english = page.getByRole('dialog').locator('button').filter({ hasText: /^\s*English\s*$/ });
  await page.addLocatorHandler(english, async () => { await english.click(); });
  const betaDialog = page.locator('.ui-dialog').filter({
    has: page.getByRole('button', { name: /Explore beta now/i }),
  });
  await page.addLocatorHandler(betaDialog, async () => {
    await betaDialog.getByRole('button', { name: '×', exact: true }).click();
  });
  const response = await page.goto(IRCTC_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (response && !response.ok()) throw new Error(`IRCTC returned HTTP ${response.status()}.`);
  const fields = searchFields(page);
  await fields.from.waitFor({ state: 'visible', timeout: 30000 });
  await fields.to.waitFor({ state: 'visible', timeout: 30000 });
  await dismissWelcome(page);
  await fields.from.click({ trial: true });
  // A real editable search form is stronger evidence than a 200 response/title.
  if (!await fields.from.isEditable() || !await fields.to.isEditable()) {
    throw new Error('The station fields are not editable.');
  }
  await fields.date.waitFor({ state: 'visible' });
  await fields.quota.waitFor({ state: 'visible' });
}
