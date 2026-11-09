import { chromium } from '@playwright/test';
const base = 'http://localhost:4174/';
const out = '/tmp/orbit-shots';
const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const clearToasts = async () => {
  for (const b of await page.getByRole('button', { name: 'Dismiss' }).all()) await b.click().catch(() => {});
  await page.waitForTimeout(300);
};
const shot = async (name) => {
  await clearToasts();
  await page.mouse.move(1590, 990);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('saved', name);
};

await page.goto(base + '#preferences');
await page.getByLabel('Choose a backup file').setInputFiles('/tmp/orbit-demo-backup.json');
await page.getByRole('button', { name: 'Replace all data with this backup' }).click();
await page.getByRole('button', { name: 'Replace and restore' }).click();
await page.waitForTimeout(1500);

// 1. the universe
await page.goto(base + '#universe');
await page.waitForTimeout(800);
await page.keyboard.press('0');
await page.waitForTimeout(1800);
await shot('01-universe');

// 2. a galaxy
await page.getByRole('button', { name: /^Work galaxy/ }).click();
await page.waitForTimeout(1800);
await shot('02-galaxy');

// 3. a star system with a task open
await page.getByRole('button', { name: /^Quarterly report\./ }).click();
await page.waitForTimeout(1800);
await page.getByRole('button', { name: /^Make charts for slides 4–7/ }).click();
await page.waitForTimeout(900);
await shot('03-system-and-task');

// 4. focus
await page.getByRole('button', { name: /^Start focus/ }).first().click();
await page.waitForTimeout(500);
await page.keyboard.press('Escape');
await page.keyboard.press('3');
await page.waitForTimeout(4200);
await shot('04-focus');

// 5. context parking
await page.keyboard.press('p');
await page.waitForTimeout(600);
await page.getByLabel('Where I stopped').fill('Charts 4 and 5 done; 6 needs the regional split');
await page.getByLabel('My next action').fill('Pull the regional numbers into chart 6');
await page.waitForTimeout(300);
await shot('05-park');
await page.getByLabel('My next action').press('Enter');
await page.waitForTimeout(800);

// 6. today
await page.keyboard.press('2');
await page.waitForTimeout(1200);
await shot('06-today');

// 7. what next
await page.keyboard.press('5');
await page.waitForTimeout(1200);
await shot('07-what-next');

// 8. insights
await page.keyboard.press('6');
await page.waitForTimeout(1500);
await shot('08-insights');

// 9. light theme, today
await page.keyboard.press('7');
await page.waitForTimeout(600);
await page.getByRole('radio', { name: 'Light' }).or(page.getByRole('button', { name: 'Light', exact: true })).first().click();
await page.keyboard.press('2');
await page.waitForTimeout(1200);
await shot('09-today-light');

await browser.close();
