import type { Locator, Page } from 'playwright';
import type { Journey } from './config.js';
import { searchFields, dismissWelcome } from './browser.js';

export const classNames: Record<Journey['travelClass'], string> = {
  '1A': 'AC First Class (1A)', '2A': 'AC 2 Tier (2A)', '3A': 'AC 3 Tier (3A)',
  '3E': 'AC 3 Economy (3E)', CC: 'AC Chair car (CC)', EC: 'Exec. Chair Car (EC)',
  SL: 'Sleeper (SL)', '2S': 'Second Sitting (2S)', FC: 'First Class (FC)',
};

async function station(page: Page, input: Locator, code: string): Promise<void> {
  await input.fill(code);
  const match = page.getByRole('option').filter({ hasText: new RegExp(`\\b${code}\\b`) });
  await match.first().waitFor({ state: 'visible' });
  if (await match.count() !== 1) throw new Error(`Station ${code} is ambiguous; select it manually.`);
  await match.click();
  if (!new RegExp(`\\b${code}\\b`).test(await input.inputValue())) {
    throw new Error(`Station selection did not retain ${code}.`);
  }
}

async function dropdown(page: Page, control: Locator, label: string): Promise<void> {
  await control.click();
  await page.getByRole('option', { name: label, exact: true }).click();
  if (!(await control.innerText()).includes(label)) throw new Error('The selected option did not match the requested value.');
}

export async function prepareSearch(page: Page, journey: Journey): Promise<void> {
  await dismissWelcome(page);
  const fields = searchFields(page);
  await station(page, fields.from, journey.from);
  await station(page, fields.to, journey.to);
  const [year, month, day] = journey.journeyDate.split('-');
  const date = `${day}/${month}/${year}`;
  // PrimeNG updates its date model on keyboard events; fill() alone is reverted
  // on blur even though the DOM briefly shows the requested value.
  await fields.date.fill('');
  await fields.date.pressSequentially(date);
  await fields.date.press('Tab');
  if (await fields.date.inputValue() !== date) throw new Error('Journey date was not retained by the form.');
  await dropdown(page, fields.travelClass, classNames[journey.travelClass]);
  await dropdown(page, fields.quota, journey.quota);
  // Deliberately stop before Search: this milestone only prepares inputs.
}
