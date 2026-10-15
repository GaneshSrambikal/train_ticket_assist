const { chromium } = require('../irctc-booking-assistant/node_modules/playwright');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(path.join(__dirname, 'irctc-project-final-report.html')).href);
    await page.evaluate(() => document.fonts.ready);
    const dimensions = await page.locator('.sheet').evaluateAll(sheets => sheets.map(sheet => {
      const footer = sheet.querySelector('.footer');
      const content = Array.from(sheet.children).filter(el => el !== footer);
      return { scrollHeight: sheet.scrollHeight, clientHeight: sheet.clientHeight,
        contentBottom: Math.max(...content.map(el => el.getBoundingClientRect().bottom)),
        footerTop: footer.getBoundingClientRect().top };
    }));
    if (dimensions.some(d => d.scrollHeight > d.clientHeight || d.contentBottom > d.footerTop - 10)) {
      throw new Error('Report content overlaps footer or overflows: ' + JSON.stringify(dimensions));
    }
    const pdf = path.join(__dirname, 'IRCTC_Project_Final_Report.pdf');
    await page.pdf({ path: pdf, format: 'A4', printBackground: true, preferCSSPageSize: true });
    for (let index = 0; index < 3; index++) await page.locator('.sheet').nth(index).screenshot({ path: path.join(__dirname, `preview-${index+1}.png`) });
    const contents = fs.readFileSync(pdf).toString('latin1');
    const pages = (contents.match(/\/Type\s*\/Page\b/g) || []).length;
    const links = (contents.match(/\/Subtype\s*\/Link\b/g) || []).length;
    if (pages !== 3 || links < 5) throw new Error(`Unexpected PDF structure: ${pages} pages, ${links} links`);
    console.log(JSON.stringify({ pdf, pages, links, bytes: fs.statSync(pdf).size, layout: 'no overflow' }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
