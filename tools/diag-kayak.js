// Diagnostic: open one Kayak search for a fixed demo route (not any user's search) and print what the page shows.
// Run by .github/workflows/diag.yml when Kayak returns no results from GitHub's machines.
const { chromium } = require('playwright');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const DEMO = 'TLV-ATH/2027-03-10-flexible-3days/2027-03-17-flexible-3days?sort=price_a';
(async () => {
  const browser = await chromium.launch();
  console.log('chromium', browser.version());
  for (const [host, locale, ua] of [['www.he.kayak.com', 'he-IL', UA], ['www.kayak.com.au', 'en-AU', UA], ['www.he.kayak.com', 'he-IL', null]]) {
    const ctx = await browser.newContext({ locale, viewport: { width: 1366, height: 1000 }, ...(ua ? { userAgent: ua } : {}) });
    const page = await ctx.newPage();
    try {
      const r = await page.goto(`https://${host}/flights/${DEMO}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(25000);
      const t = await page.evaluate(() => document.body ? document.body.innerText : '');
      console.log(`\n== ${host} ua=${ua ? 'fixed' : 'default'} HTTP ${r && r.status()} final=${page.url().replace(/\?.*/, '')}`);
      console.log('title:', await page.title());
      console.log('result cards:', t.split(/המשך לפרטי התוצאה|Go to result details/).length - 1, '| text length:', t.length);
      console.log('text start:', t.slice(0, 700).replace(/\n+/g, ' | '));
    } catch (e) { console.log(`== ${host}: ${e.message.split('\n')[0]}`); }
    await ctx.close();
  }
  await browser.close();
})();
