import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium, type Page } from 'playwright';
import { validateJourney } from '../src/config.js';
import { searchAndSelect, clickBookNow, assertBookable, availabilityKind, dateLabel } from '../src/trains.js';
import { requireRealJourney, fillPassengers, assertNoPendingBooking, markBookingAttempt, resolveBookingAttempt } from '../src/booking.js';

const journey = validateJourney({
  quota: 'GENERAL', from: 'NDLS', to: 'MAS', boardingStation: 'NDLS',
  journeyDate: '2026-11-15', trainNumber: '12622', travelClass: '3A', maxFare: 5000,
  passengers: [{ name: 'Example Passenger', age: 30, gender: 'M' }],
}, new Date('2026-10-13T00:00:00Z'));

const fixture = `
<input placeholder="From*" value="NEW DELHI - NDLS"><input placeholder="To*" value="CHENNAI CENTRAL - MAS">
<p-calendar><input value="15/11/2026"></p-calendar><div id="journeyQuota">GENERAL</div>
<button id="search">Search Trains</button><section id="results"></section>
<script>
window.bookClicks = 0;
document.querySelector('#search').onclick = () => {
  document.querySelector('input[placeholder="From*"]').placeholder = 'FROM *';
  document.querySelector('input[placeholder="To*"]').placeholder = 'TO *';
  const hidden = document.createElement('div'); hidden.style.display = 'none';
  hidden.innerHTML = '<input placeholder="FROM *"><input placeholder="TO *"><p-calendar><input></p-calendar><div id="journeyQuota">TATKAL</div>';
  document.body.append(hidden);
  document.querySelector('#results').innerHTML = '<app-train-avl-enq><div class="train-heading">WRONG TRAIN (12623)</div></app-train-avl-enq>' +
  '<app-train-avl-enq><div class="train-heading">TAMIL NADU EXP (12622)</div><div class="white-back">NEW DELHI | CHENNAI CENTRAL</div>' +
  '<div role="tab" aria-selected="true"><span>AC 3 Tier (3A)</span></div>' +
  '<div class="pre-avl"><strong>Sun, 15 Nov</strong><span id="availability">AVAILABLE-0020</span></div>' +
  '<div class="pre-avl"><strong>Mon, 16 Nov</strong><span>AVAILABLE-0030</span></div>' +
  '<strong id="fare">₹ 1790</strong><button id="book">Book Now</button></app-train-avl-enq>';
  document.querySelector('#book').onclick = () => window.bookClicks++;
};
</script>`;

async function withPage(action: (page: Page) => Promise<void>): Promise<void> {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(1500);
    await page.setContent(fixture);
    await action(page);
  } finally { await browser.close(); }
}

test('search selects the exact train/date and never clicks Book Now', async () => {
  await withPage(async (page) => {
    const selected = await searchAndSelect(page, journey);
    assert.match(selected.train, /12622/);
    assert.equal(selected.routeMatches, true);
    assert.equal(selected.quotedFare, 1790);
    assert.equal(selected.availability, 'AVAILABLE-0020');
    assert.equal(await page.evaluate('window.bookClicks'), 0);
    await clickBookNow(page, journey, selected);
    assert.equal(await page.evaluate('window.bookClicks'), 1);
  });
});

test('changed fare prevents the booking click', async () => {
  await withPage(async (page) => {
    const selected = await searchAndSelect(page, journey);
    await page.locator('#fare').evaluate((el) => { el.textContent = '₹ 2000'; });
    await assert.rejects(clickBookNow(page, journey, selected), /changed during review/);
    assert.equal(await page.evaluate('window.bookClicks'), 0);
  });
});

test('quota mismatches stop before even searching', async () => {
  await withPage(async (page) => {
    await page.locator('#journeyQuota').evaluate((el) => { el.textContent = 'TATKAL'; });
    await assert.rejects(searchAndSelect(page, journey), /Quota changed/);
    assert.equal(await page.locator('app-train-avl-enq').count(), 0);
  });
});

test('eligibility rejects different stations, unknown availability, waitlist and excessive fare', () => {
  const selected = { train: '12622', route: '', routeMatches: true, quotedFare: 1790, availability: 'AVAILABLE-0020' };
  assert.throws(() => assertBookable(journey, { ...selected, routeMatches: false }), /different/);
  assert.throws(() => assertBookable(journey, { ...selected, availability: 'WL37' }), /allowWaitlist/);
  assert.throws(() => assertBookable(journey, { ...selected, availability: 'RAC 7' }), /allowWaitlist/);
  assert.throws(() => assertBookable(journey, { ...selected, quotedFare: 6000 }), /maxFare/);
  assert.throws(() => assertBookable(journey, { ...selected, availability: 'UNKNOWN' }), /not currently/);
  assert.doesNotThrow(() => assertBookable({ ...journey, allowWaitlist: true }, { ...selected, availability: 'WL37' }));
  assert.throws(() => assertBookable({ ...journey, quota: 'TATKAL', trainOriginDate: journey.journeyDate }, selected, new Date('2026-11-14T04:29:59Z')), /not opened/);
  assert.equal(availabilityKind('NOT AVAILABLE'), 'UNAVAILABLE');
  assert.equal(availabilityKind('AVAILABLE-0000'), 'UNAVAILABLE');
  assert.equal(dateLabel(journey.journeyDate), 'Sun, 15 Nov');
});

test('example files and placeholder passengers cannot be booked', () => {
  assert.throws(() => requireRealJourney('journey.example.json', journey), /example data/);
  assert.throws(() => requireRealJourney('.local/journey.json', journey), /example data/);
  assert.doesNotThrow(() => requireRealJourney('.local/journey.json', { ...journey, passengers: [{ ...journey.passengers[0], name: 'Local User' }] }));
});

test('passenger autofill adds rows but never continues to payment', async () => {
  await withPage(async (page) => {
    await page.setContent(`<div id="rows"></div><button id="add">+ Add Passenger</button><button id="continue">Continue</button>
      <script>window.continues=0;const row='<div><input placeholder="Name"><input formcontrolname="passengerAge"><select formcontrolname="passengerGender"><option value="M">Male</option><option value="F">Female</option></select><select formcontrolname="passengerBerthChoice"><option value="NP">No Preference</option><option value="LB">Lower</option></select></div>';document.querySelector('#rows').innerHTML=row;document.querySelector('#add').onclick=()=>document.querySelector('#rows').insertAdjacentHTML('beforeend',row);document.querySelector('#continue').onclick=()=>window.continues++;</script>`);
    await fillPassengers(page, { ...journey, passengers: [journey.passengers[0], { ...journey.passengers[0], name: 'Second Person', gender: 'F', berthPreference: 'LOWER' }] });
    assert.equal(await page.locator('input[placeholder="Name"]').nth(1).inputValue(), 'Second Person');
    assert.equal(await page.locator('select[formcontrolname="passengerGender"]').nth(1).inputValue(), 'F');
    assert.equal(await page.locator('select[formcontrolname="passengerBerthChoice"]').nth(1).inputValue(), 'LB');
    assert.equal(await page.evaluate('window.continues'), 0);
  });
});

test('unfinished attempt blocks another booking until explicitly reconciled', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'irctc-attempt-test-'));
  try {
    await assertNoPendingBooking(directory);
    await markBookingAttempt(directory, journey);
    await assert.rejects(assertNoPendingBooking(directory), /reconciliation/);
    await assert.rejects(markBookingAttempt(directory, journey));
    assert.doesNotMatch(await readFile(path.join(directory, 'booking-attempt.json'), 'utf8'), /Example Passenger/);
    await resolveBookingAttempt(directory);
    await assertNoPendingBooking(directory);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
