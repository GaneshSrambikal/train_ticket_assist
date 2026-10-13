import type { Page } from 'playwright';

export function passengerNames(page: Page) {
  return page.locator('input[formcontrolname="passengerName"], input[placeholder="Name" i], input[placeholder^="Full Name" i]')
    .filter({ visible: true });
}

export function passengerFields(page: Page) {
  return {
    names: passengerNames(page),
    ages: page.locator('input[formcontrolname="passengerAge"], input[placeholder="Age" i]').filter({ visible: true }),
    genders: page.locator('select[formcontrolname="passengerGender"]')
      .or(page.locator('select').filter({ has: page.locator('option').filter({ hasText: /^\s*Male\s*$/i }) }))
      .filter({ visible: true }),
    berths: page.locator('select[formcontrolname="passengerBerthChoice"]')
      .or(page.locator('select').filter({ has: page.locator('option').filter({ hasText: /^\s*No Preference\s*$/i }) }))
      .filter({ visible: true }),
  };
}
