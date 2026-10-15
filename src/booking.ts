import { open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { Page, Locator } from 'playwright';
import type { Journey } from './config.js';
import { assertBookable, clickBookNow, type TrainSelection } from './trains.js';
import { autofillLogin, type Credentials } from './login.js';
import { passengerFields } from './passenger-fields.js';
import { selectUpi } from './payment-mode.js';

export function requireRealJourney(file: string, journey: Journey): void {
  if (/\.example\.json$/i.test(file) || journey.passengers.some((p) => /^(Example|Synthetic|Test)\s+(Passenger|Person)$/i.test(p.name))) {
    throw new Error('Booking is disabled for example data. Copy your journey to .local/journey.json and enter real passenger details first.');
  }
}

export async function assertNoPendingBooking(directory: string): Promise<void> {
  try { await readFile(path.join(directory, 'booking-attempt.json')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  throw new Error('An earlier booking attempt needs reconciliation. Check IRCTC booking/transaction history, then run npm.cmd run resolve-booking. No new attempt was started.');
}

export async function markBookingAttempt(directory: string, journey: Journey): Promise<void> {
  const file = await open(path.join(directory, 'booking-attempt.json'), 'wx');
  try {
    await file.writeFile(JSON.stringify({
      at: new Date().toISOString(), status: 'OUTCOME_NOT_VERIFIED',
      train: journey.trainNumber, date: journey.journeyDate, quota: journey.quota,
    }, null, 2));
  } finally { await file.close(); }
}

export async function resolveBookingAttempt(directory: string): Promise<void> {
  await unlink(path.join(directory, 'booking-attempt.json'));
}

async function choose(select: Locator, values: string[], label: RegExp): Promise<void> {
  const options = await select.locator('option').evaluateAll((elements) => elements.map((el) => ({
    value: (el as HTMLOptionElement).value, text: el.textContent?.trim() || '',
  })));
  const option = options.find((o) => label.test(o.text)) || options.find((o) => values.includes(o.value));
  if (!option) throw new Error('A required passenger option is missing; finish this field manually.');
  await select.selectOption(option.value);
}

export async function fillPassengers(page: Page, journey: Journey): Promise<void> {
  const { names, ages, genders, berths } = passengerFields(page);
  await names.first().waitFor({ state: 'visible', timeout: 600000 });
  while (await names.count() < journey.passengers.length) {
    const count = await names.count();
    await page.getByText(/^\+?\s*Add Passenger(?:\s*\/\s*Add Infant With Berth)?\s*$/i).filter({ visible: true }).click();
    await names.nth(count).waitFor({ state: 'visible' });
  }
  if (await names.count() !== journey.passengers.length) throw new Error('Passenger row count differs from your configuration. Review the page manually.');
  for (const [label, fields] of [['age', ages], ['gender', genders], ['berth', berths]] as const) {
    if (await fields.count() !== journey.passengers.length) {
      throw new Error(`Could not identify one ${label} field per passenger. Finish the passenger form manually.`);
    }
  }
  console.log('Passenger form detected. Filling configured passenger details.');
  const preferences = {
    NO_PREFERENCE: { values: ['', 'NP'], label: /^(No Preference|Select Berth Preference)$/i },
    LOWER: { values: ['LB'], label: /^Lower(?:\s|$)/i },
    MIDDLE: { values: ['MB'], label: /^Middle(?:\s|$)/i },
    UPPER: { values: ['UB'], label: /^Upper(?:\s|$)/i },
    SIDE_LOWER: { values: ['SL'], label: /^Side Lower(?:\s|$)/i },
    SIDE_UPPER: { values: ['SU'], label: /^Side Upper(?:\s|$)/i },
  };
  for (const [index, passenger] of journey.passengers.entries()) {
    await names.nth(index).fill(passenger.name);
    await ages.nth(index).fill(String(passenger.age));
    await choose(genders.nth(index), [passenger.gender], { M: /^Male$/i, F: /^Female$/i, T: /^Transgender$/i }[passenger.gender]);
    const berth = preferences[passenger.berthPreference];
    await choose(berths.nth(index), berth.values, berth.label);
    await names.nth(index).blur();
    if (await names.nth(index).inputValue() !== passenger.name || await ages.nth(index).inputValue() !== String(passenger.age)) {
      throw new Error('Passenger details were not retained. Review the page manually.');
    }
  }
}

export async function beginGuidedBooking(
  page: Page, journey: Journey, selection: TrainSelection, directory: string, credentials?: Credentials,
): Promise<void> {
  assertBookable(journey, selection);
  await assertNoPendingBooking(directory);
  // Written before the first booking action. A crash or ambiguous result must
  // not cause an automatic restart and possible duplicate booking.
  await markBookingAttempt(directory, journey);
  await clickBookNow(page, journey, selection);
  if (credentials) {
    console.log('Waiting for login. Complete any station-confirmation dialog in Chrome; username/password will be filled when the login form appears.');
    const result = await autofillLogin(page, credentials);
    if (result === 'filled') console.log('Username and password filled. Complete the visible CAPTCHA/OTP and click Sign In in Chrome.');
    else if (result === 'submitted') console.log('Sign In clicked. Complete any verification requested next in Chrome.');
    else if (result === 'manual-required') console.log('Login autofill could not complete. Enter credentials manually in Chrome.');
  }
  console.log('Waiting for the passenger form (up to 10 minutes). Complete any remaining login, verification or station-confirmation dialogs in Chrome.');
  await fillPassengers(page, journey);
  await selectUpi(page);
  console.log('BHIM/UPI selected. Automatic Continue is disabled for testing. Click Continue yourself in this Chrome window.');
  console.log(`Passenger fields filled. Review boarding station (${journey.boardingStation}), contact details, nationality, food preferences and ALL passenger details in Chrome.`);
  console.log(`Verify the final TOTAL is within Rs ${journey.maxFare}; the search fare is not a guaranteed final total.`);
  console.log('Complete CAPTCHA/OTP and authorize payment yourself. This command never clicks Pay or retries Book Now.');
  console.log('After checking booking/transaction history, close this browser and run npm.cmd run resolve-booking before another booking attempt.');
}
