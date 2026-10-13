import type { Locator, Page } from 'playwright';
import type { Journey } from './config.js';
import { searchFields } from './browser.js';
import { classNames } from './search.js';
import { millisecondsUntilOpening } from './tatkal-clock.js';

export interface TrainSelection {
  card: Locator;
  train: string;
  route: string;
  routeMatches: boolean;
  availability: string;
  quotedFare: number;
}

export function dateLabel(date: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short',
  }).formatToParts(new Date(`${date}T12:00:00Z`));
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part('weekday')}, ${part('day')} ${part('month')}`;
}

export function availabilityKind(text: string): 'AVAILABLE' | 'WAITLIST' | 'RAC' | 'UNAVAILABLE' {
  if (/REGRET|NOT AVAILABLE|NOT OPEN|CANCELLED|DEPARTED|TRAIN DELETED/i.test(text)) return 'UNAVAILABLE';
  if (/\b(?:GNWL|RLWL|PQWL|TQWL|WL)\s*\d+/i.test(text)) return 'WAITLIST';
  if (/\bRAC\s*\d+/i.test(text)) return 'RAC';
  const available = text.match(/\bAVAILABLE\s*[-:]?\s*(\d+)/i);
  return available && Number(available[1]) > 0 ? 'AVAILABLE' : 'UNAVAILABLE';
}

export function assertBookable(journey: Journey, selection: Omit<TrainSelection, 'card'>, now = new Date()): void {
  if (!selection.routeMatches) throw new Error('This train uses a different boarding/destination station from the search. Correct the journey configuration before booking.');
  const kind = availabilityKind(selection.availability);
  if (kind === 'UNAVAILABLE') throw new Error('The requested date is not currently available for booking.');
  if (kind !== 'AVAILABLE' && !journey.allowWaitlist) {
    throw new Error(`${kind} requires allowWaitlist: true in your journey file. No alternative date or quota will be chosen.`);
  }
  if (selection.quotedFare > journey.maxFare) throw new Error('The displayed train fare already exceeds maxFare.');
  if (millisecondsUntilOpening(journey, now) > 0) throw new Error('Tatkal has not opened for the configured train-origin date. Run again after its opening time.');
}

function stationName(value: string): string {
  return value.split(/\s+-\s+/)[0].trim().replace(/\s+/g, ' ').toUpperCase();
}

export async function verifySearch(page: Page, journey: Journey): Promise<void> {
  const fields = searchFields(page);
  for (const [input, code] of [[fields.from, journey.from], [fields.to, journey.to]] as const) {
    if (!new RegExp(`\\b${code}\\b`).test(await input.inputValue())) throw new Error('Station fields changed; stopping before selection.');
  }
  const [year, month, day] = journey.journeyDate.split('-');
  if (await fields.date.inputValue() !== `${day}/${month}/${year}`) throw new Error('Journey date changed; stopping before selection.');
  const label = fields.quota.locator('.ui-dropdown-label');
  const quota = await label.count() ? await label.innerText() : await fields.quota.innerText();
  if (quota.trim().toUpperCase() !== journey.quota) throw new Error('Quota changed; stopping before selection.');
}

export async function searchAndSelect(page: Page, journey: Journey): Promise<TrainSelection> {
  await verifySearch(page, journey);
  const fields = searchFields(page);
  const from = stationName(await fields.from.inputValue());
  const to = stationName(await fields.to.inputValue());
  await page.getByRole('button', { name: /^Search Trains$/i }).click();
  // Angular host elements have no layout box; wait for the heading inside them.
  const card = page.locator('app-train-avl-enq').filter({
    has: page.locator('.train-heading').filter({ hasText: new RegExp(`\\(${journey.trainNumber}\\)`) }),
  });
  await card.locator('.train-heading').waitFor({ state: 'visible', timeout: 45000 });
  if (await card.count() !== 1) throw new Error('The configured train is ambiguous in these results.');
  await verifySearch(page, journey);
  await card.getByText(classNames[journey.travelClass], { exact: true }).click();
  const date = card.locator('.pre-avl').filter({ has: page.getByText(dateLabel(journey.journeyDate), { exact: true }) });
  await date.waitFor({ state: 'visible', timeout: 30000 });
  const availability = (await date.innerText()).replace(dateLabel(journey.journeyDate), '').trim();
  await date.click();
  const selectedClass = card.locator('[role="tab"][aria-selected="true"]');
  if (!(await selectedClass.innerText()).includes(`(${journey.travelClass})`)) throw new Error('Class selection did not match configuration.');
  const route = (await card.locator('.white-back').first().innerText()).replace(/\s+/g, ' ').trim();
  const fareText = await card.locator('strong').filter({ hasText: /₹\s*[\d,]+/ }).first().innerText();
  const fare = Number(fareText.match(/₹\s*([\d,]+(?:\.\d+)?)/)?.[1].replaceAll(',', ''));
  if (!Number.isFinite(fare) || fare <= 0) throw new Error('Cannot verify the displayed train fare.');
  return {
    card, train: (await card.locator('.train-heading').innerText()).trim(), route,
    routeMatches: route.toUpperCase().includes(from) && route.toUpperCase().includes(to),
    availability, quotedFare: fare,
  };
}

export async function clickBookNow(page: Page, journey: Journey, selection: TrainSelection): Promise<void> {
  await verifySearch(page, journey);
  if (!(await selection.card.locator('[role="tab"][aria-selected="true"]').innerText()).includes(`(${journey.travelClass})`)) {
    throw new Error('Selected class changed during review.');
  }
  const currentRoute = (await selection.card.locator('.white-back').first().innerText()).replace(/\s+/g, ' ').trim();
  if (currentRoute !== selection.route) throw new Error('Train route changed during review.');
  // Re-read availability and price after user review; never trust the old quote.
  const tile = selection.card.locator('.pre-avl').filter({ has: page.getByText(dateLabel(journey.journeyDate), { exact: true }) });
  const availability = (await tile.innerText()).replace(dateLabel(journey.journeyDate), '').trim();
  const fareText = await selection.card.locator('strong').filter({ hasText: /₹\s*[\d,]+/ }).first().innerText();
  const fare = Number(fareText.match(/₹\s*([\d,]+(?:\.\d+)?)/)?.[1].replaceAll(',', ''));
  if (availability !== selection.availability || fare !== selection.quotedFare) throw new Error('Availability or fare changed during review. Search again before booking.');
  assertBookable(journey, selection);
  await tile.click();
  const button = selection.card.getByRole('button', { name: /^Book Now$/i });
  if (!await button.isEnabled() || /disable-book/.test(await button.getAttribute('class') || '')) {
    throw new Error('Book Now is disabled for this selection.');
  }
  // No automatic retry: this action may start a booking session.
  await button.click();
}
