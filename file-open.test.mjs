import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];

page.on('pageerror', (error) => errors.push(error.message));
await page.goto(pathToFileURL(new URL('./index.html', import.meta.url).pathname).href);
await page.waitForTimeout(500);

assert.equal(errors.length, 0, `Opening index.html directly raised: ${errors.join('; ')}`);
assert.equal(await page.locator('.choice input').count(), 4, 'A question renders without an HTTP server');
assert.match(await page.locator('#sourceStatus').innerText(), /1,019 questions loaded/);

await browser.close();
console.log('direct file-open test passed');
