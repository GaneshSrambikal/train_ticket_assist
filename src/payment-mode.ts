import type { Page, Response, Request } from 'playwright';

export async function selectUpi(page: Page, timeout = 15000): Promise<void> {
  console.log('Looking for the BHIM/UPI payment option.');
  const label = page.getByText(/^\s*Pay through BHIM\s*\/\s*UPI\s*$/i).filter({ visible: true });
  try { await label.waitFor({ state: 'visible', timeout }); }
  catch { throw new Error('Cannot identify the BHIM/UPI label uniquely. Select payment mode manually.'); }
  const group = label.locator('xpath=ancestor-or-self::*[.//input[@type="radio"] or .//*[@role="radio"]][1]');
  const accessible = page.getByRole('radio', { name: /Pay through BHIM\s*\/\s*UPI/i });
  let radio = accessible;
  if (await accessible.count() !== 1) {
    // PrimeNG may render a hidden native input next to a clickable text label.
    radio = group.locator('input[type="radio"], [role="radio"]');
    // Prefer the native input when the widget also has an ARIA wrapper.
    const native = group.locator('input[type="radio"]');
    if (await native.count() === 1) radio = native;
  }
  if (await radio.count() !== 1) throw new Error('Cannot identify the BHIM/UPI option uniquely. Select payment mode manually.');
  const isSelected = () => radio.evaluate(el => (el instanceof HTMLInputElement && el.checked) || el.getAttribute('aria-checked') === 'true');
  if (!await isSelected()) {
    // Styled widgets can cover a native input that Playwright still considers
    // visible. Click the visible widget box instead of that covered input.
    const box = group.locator('.ui-radiobutton-box, .p-radiobutton-box').filter({ visible: true });
    if (await box.count() === 1) await box.click({ timeout });
    else await label.click({ timeout });
  }
  try {
    await radio.and(page.locator(':checked, [aria-checked="true"]')).waitFor({ state: 'attached', timeout: 5000 });
  } catch {
    throw new Error('BHIM/UPI was clicked but its selected state was not confirmed. Continue was not clicked; inspect the payment option in Chrome.');
  }
}

export async function selectUpiAndContinue(page: Page, timeout = 15000, reviewTimeout = 120000): Promise<void> {
  await selectUpi(page, timeout);
  // Let blur-driven validation finish before submitting the passenger form.
  await page.locator('input:focus, select:focus').evaluateAll(elements => {
    for (const element of elements) (element as HTMLElement).blur();
  });
  const busy = page.locator('.ng-pending, [aria-busy="true"], .ui-blockui, .p-blockui, .ngx-spinner-overlay')
    .filter({ visible: true });
  await busy.first().waitFor({ state: 'hidden', timeout });
  console.log('BHIM/UPI selected. Clicking Continue once; review may take up to two minutes.');
  const continueButton = page.getByRole('button', { name: /^\s*Continue\s*$/i })
    .or(page.locator('button').filter({ hasText: /^\s*Continue\s*$/i })).filter({ visible: true });
  // Collect only status counts, never URLs, bodies, headers or passenger data.
  const statuses = new Set<number>();
  let failedRequests = 0;
  const isIrctc = (url: string) => { try { return /(^|\.)irctc\.co\.in$/i.test(new URL(url).hostname); } catch { return false; } };
  const onResponse = (response: Response) => { if (isIrctc(response.url()) && response.status() >= 400) statuses.add(response.status()); };
  const onFailed = (request: Request) => { if (isIrctc(request.url())) failedRequests++; };
  page.on('response', onResponse);
  page.on('requestfailed', onFailed);
  try {
    await continueButton.click({ timeout });
    // A disappearing passenger form can also mean an error or logout. Require
    // positive review content instead of treating disappearance as success.
    const outcome = await page.waitForFunction(() => {
      const text = document.body.innerText;
      if (/^\/nget\/error\/?$/i.test(location.pathname) || /Sorry!+\s*Please Try again!+/i.test(text)) return 'navigation-error';
      if (/session (?:has )?expired|session timed out|please login again|unable to process|something went wrong/i.test(text)) return 'error';
      if (Array.from(document.querySelectorAll('input[type="password"]')).some(el => (el as HTMLElement).offsetWidth > 0 || (el as HTMLElement).offsetHeight > 0)) return 'login';
      if (Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,div,span')).some(el =>
        ((el as HTMLElement).offsetWidth > 0 || (el as HTMLElement).offsetHeight > 0) && /^\s*Review (?:Journey|Booking)(?: Details)?\s*$/i.test(el.textContent || ''))) return 'review';
      return false;
    }, undefined, { timeout: reviewTimeout });
    const result = await outcome.jsonValue();
    await outcome.dispose();
    if (result === 'navigation-error') throw new Error('IRCTC opened its generic session/navigation error page after Continue. The page does not identify the underlying cause.');
    if (result !== 'review') throw new Error(result === 'login'
      ? 'IRCTC returned to login after Continue.' : 'IRCTC displayed a session or processing error after Continue.');
    console.log('Review page detected. Check journey details and the final total in Chrome before payment.');
  } catch (error) {
    const reason = error instanceof Error && error.message.startsWith('IRCTC ')
      ? error.message : 'The review page was not confirmed. The page may still be loading or showing validation errors.';
    const diagnostic = `IRCTC HTTP error statuses: ${[...statuses].join(', ') || 'none observed'}; failed requests: ${failedRequests}.`;
    throw new Error(`${reason} ${diagnostic} Inspect Chrome; Continue was not retried. Do not submit again while loading.`);
  } finally {
    page.removeListener('response', onResponse);
    page.removeListener('requestfailed', onFailed);
  }
}
