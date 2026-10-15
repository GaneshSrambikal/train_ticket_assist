import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { selectUpi, selectUpiAndContinue } from '../src/payment-mode.js';

test('manual Continue mode selects UPI without submitting the passenger form', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<label><input id="upi" type="radio">Pay through BHIM/UPI</label>
      <button onclick="window.continues++">Continue</button>
      <script>window.continues=0;</script>`);
    await selectUpi(page);
    assert.equal(await page.locator('#upi').isChecked(), true);
    assert.equal(await page.evaluate('window.continues'), 0);
  } finally { await browser.close(); }
});

test('UPI selection supports native and hidden widget radios and continues once without paying', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    for (const hidden of [false, true]) {
      await page.setContent(`<input placeholder="Full Name as per Govt. ID">
        <label><input type="radio" name="mode" checked>Cards</label>
        <div><input id="upi" type="radio" name="mode" ${hidden ? 'style="display:none"' : ''}>
        <label for="upi">Pay through BHIM/UPI</label></div>
        <button id="continue">Continue</button><button id="pay">Pay</button>
        <script>window.continues=0;window.pays=0;document.querySelector('#continue').onclick=()=>{
          window.continues++;if(document.querySelector('#upi').checked){document.querySelector('input[placeholder]').remove();document.body.insertAdjacentHTML('beforeend','<h2>Review Journey</h2>')};
        };document.querySelector('#pay').onclick=()=>window.pays++;</script>`);
      await selectUpiAndContinue(page);
      assert.equal(await page.locator('#upi').isChecked(), true);
      assert.equal(await page.evaluate('window.continues'), 1);
      assert.equal(await page.evaluate('window.pays'), 0);
    }
    await page.setContent('<button>Continue</button>');
    await assert.rejects(selectUpiAndContinue(page, 100), /Cannot identify/);
  } finally { await browser.close(); }
});

test('delayed PrimeNG payment widget uses its visible box instead of the covered input', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<input placeholder="Full Name as per Govt. ID"><section id="payment" style="display:none">
      <div><input type="radio" name="mode" checked><span>Cards</span></div>
      <div><p-radiobutton style="position:relative;display:inline-block;width:24px;height:24px">
        <input id="upi" type="radio" name="mode" style="position:absolute;width:20px;height:20px">
        <div class="ui-radiobutton-box" style="position:absolute;inset:0;background:orange"></div>
      </p-radiobutton><span>Pay through BHIM/UPI</span></div>
      <button aria-label="Proceed to review your journey">Continue</button></section>
      <script>window.continues=0;
      setTimeout(()=>document.querySelector('#payment').style.display='block',300);
      document.querySelector('.ui-radiobutton-box').onclick=()=>document.querySelector('#upi').checked=true;
      document.querySelector('button').onclick=()=>{window.continues++;document.querySelector('input[placeholder]').remove();document.body.insertAdjacentHTML('beforeend','<h2>Review Journey</h2>')};</script>`);
    await selectUpiAndContinue(page);
    assert.equal(await page.locator('#upi').isChecked(), true);
    assert.equal(await page.evaluate('window.continues'), 1);
  } finally { await browser.close(); }
});

test('Continue waits for validation and delayed review, and does not mistake logout for success', async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    for (const outcome of ['review', 'login', 'error', 'navigation-error', 'loading']) {
      await page.setContent(`<input placeholder="Full Name as per Govt. ID"><div class="ng-pending">Validating</div>
        <label><input type="radio" checked>Pay through BHIM/UPI</label><button>Continue</button>
        <script>window.continues=0;window.premature=false;
        setTimeout(()=>document.querySelector('.ng-pending').remove(),200);
        document.querySelector('button').onclick=()=>{
          window.continues++;window.premature=!!document.querySelector('.ng-pending');
          document.querySelector('input[placeholder]').remove();
          setTimeout(()=>document.body.insertAdjacentHTML('beforeend',${JSON.stringify(outcome === 'review' ? '<h2>Review Journey Details</h2>' : outcome === 'login' ? '<input type="password">' : outcome === 'error' ? '<p>Session expired</p>' : outcome === 'navigation-error' ? '<h2>Sorry!!! Please Try again!!</h2><button>Click here to login.</button>' : '<p>Loading...</p>')}),300);
        };</script>`);
      if (outcome === 'review') await selectUpiAndContinue(page, 1500, 2000);
      else await assert.rejects(selectUpiAndContinue(page, 1500, 1000), outcome === 'login' ? /returned to login/ : outcome === 'error' ? /session or processing error/ : outcome === 'navigation-error' ? /generic session\/navigation error/ : /not confirmed/);
      assert.equal(await page.evaluate('window.continues'), 1);
      assert.equal(await page.evaluate('window.premature'), false);
    }
  } finally { await browser.close(); }
});
