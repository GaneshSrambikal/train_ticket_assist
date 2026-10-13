import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { prepareSearch } from '../src/search.js';
import { validateJourney } from '../src/config.js';
import { dismissWelcome } from '../src/browser.js';

// Offline fixture: an autocomplete must commit a suggested station, not just
// accept typed text; dropdown choices must persist; no submit is permitted.
const fixture = `
<input placeholder="From*" aria-label="Enter From station. Input is Mandatory."><input placeholder="To*" aria-label="Enter To station. Input is Mandatory.">
<p-calendar><input></p-calendar>
<div id="journeyClass" tabindex="0">All Classes</div>
<div id="journeyQuota" tabindex="0">GENERAL</div>
<button id="search">Search</button><div id="options"></div>
<script>
window.submissions = 0;
const dateInput = document.querySelector('p-calendar input');
let dateModel = '13/10/2026';
dateInput.onkeyup = () => { dateModel = dateInput.value; };
dateInput.onblur = () => { dateInput.value = dateModel; };
document.querySelector('#search').onclick = () => window.submissions++;
const options = document.querySelector('#options');
function option(label, action) {
  options.replaceChildren();
  const item = document.createElement('div');
  item.setAttribute('role', 'option'); item.textContent = label;
  item.onclick = () => { action(label); options.replaceChildren(); };
  options.append(item);
}
for (const input of document.querySelectorAll('input[placeholder]')) {
  input.oninput = () => option('STATION - ' + input.value, label => input.value = label);
}
document.querySelector('#journeyClass').onclick = function () {
  option('AC 3 Tier (3A)', label => this.textContent = label);
};
document.querySelector('#journeyQuota').onclick = function () {
  options.replaceChildren();
  for (const label of ['GENERAL', 'TATKAL']) {
    const item = document.createElement('div');
    item.setAttribute('role', 'option'); item.textContent = label;
    item.onclick = () => { this.textContent = label; options.replaceChildren(); };
    options.append(item);
  }
};
</script>`;

test('prepares both quotas offline without submitting or silently changing stations', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const quota of ['GENERAL', 'TATKAL'] as const) {
      const page = await browser.newPage();
      await page.setContent(fixture);
      const journey = validateJourney({
        quota, from: 'NDLS', to: 'BCT', boardingStation: 'NDLS',
        journeyDate: '2026-11-15', trainOriginDate: '2026-11-15',
        trainNumber: '12952', travelClass: '3A', maxFare: 5000,
        passengers: [{ name: 'Synthetic Person', age: 30, gender: 'F' }],
      }, new Date('2026-10-13T00:00:00Z'));
      await prepareSearch(page, journey);
      assert.equal(await page.locator('#journeyQuota').innerText(), quota);
      assert.equal(await page.locator('input[placeholder="From*"]').inputValue(), 'STATION - NDLS');
      assert.equal(await page.locator('input[placeholder="To*"]').inputValue(), 'STATION - BCT');
      assert.equal(await page.locator('p-calendar input').inputValue(), '15/11/2026');
      assert.equal(await page.evaluate('window.submissions'), 0);
      await page.close();
    }
  } finally { await browser.close(); }
});

test('ambiguous station suggestions stop form preparation', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(fixture);
    await page.locator('input[placeholder="From*"]').evaluate((input) => {
      (input as HTMLInputElement).oninput = () => {
        document.querySelector('#options')!.innerHTML = '<div role="option">STATION NDLS</div><div role="option">OTHER NDLS</div>';
      };
    });
    const journey = validateJourney({
      quota: 'GENERAL', from: 'NDLS', to: 'BCT', boardingStation: 'NDLS',
      journeyDate: '2026-11-15', trainNumber: '12952', travelClass: '3A', maxFare: 5000,
      passengers: [{ name: 'Synthetic Person', age: 30, gender: 'F' }],
    }, new Date('2026-10-13T00:00:00Z'));
    await assert.rejects(prepareSearch(page, journey), /ambiguous/);
    assert.equal(await page.evaluate('window.submissions'), 0);
  } finally { await browser.close(); }
});

test('welcome language button works when aria-label overrides its visible text', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div role="dialog"><button aria-label="Confirmation. Welcome to IRCTC" onclick="this.parentElement.remove()">English</button></div>');
    await dismissWelcome(page);
    assert.equal(await page.getByRole('dialog').count(), 0);
  } finally { await browser.close(); }
});
