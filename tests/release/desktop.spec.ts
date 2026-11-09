import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dataDir = mkdtempSync(path.join(tmpdir(), 'orbit-desktop-'));
const launch = () =>
  electron.launch({
    args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), '.'],
    env: { ...process.env, ORBIT_USER_DATA: dataDir },
  });

test.afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

test('desktop app: fixed origin, data kept between launches, links open outside, no service worker', async () => {
  let app: ElectronApplication = await launch();
  let page = await app.firstWindow();
  expect(page.url()).toMatch(/^orbit:\/\/app\//);
  expect(await page.evaluate(() => (window as unknown as { orbitDesktop?: { dataPath: string } }).orbitDesktop?.dataPath)).toBe(dataDir);
  await page.getByPlaceholder('e.g. Thesis, Website, House move').fill('Desktop project');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByLabel('New task title').first().fill('Check it survives a restart');
  await page.getByLabel('New task title').first().press('Enter');
  await page.waitForTimeout(500);
  await app.close();

  app = await launch();
  page = await app.firstWindow();
  await expect(page.getByRole('button', { name: /^Desktop project/ }).first()).toBeVisible();
  // no service worker (the custom scheme cannot have one; ORBIT does not try)
  expect(
    await page.evaluate(async () => {
      try {
        return (await navigator.serviceWorker.getRegistrations()).length;
      } catch {
        return 0;
      }
    }),
  ).toBe(0);

  // Settings: desktop section and the coffee link, which opens in the default browser
  await app.evaluate(({ shell }) => {
    (globalThis as unknown as { opened: string[] }).opened = [];
    shell.openExternal = async (url: string) => void (globalThis as unknown as { opened: string[] }).opened.push(url);
  });
  await page.keyboard.press('7');
  await expect(page.getByText('You are using the ORBIT desktop app.')).toBeVisible();
  await expect(page.getByText(dataDir)).toBeVisible();
  const before = page.url();
  await page.getByRole('link', { name: 'Buy me a coffee' }).click();
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened)).toEqual(['https://ko-fi.com/markisaacschem']);
  expect(page.url()).toBe(before);
  await expect(page.getByRole('link', { name: 'New versions' })).toHaveAttribute('href', 'https://sourceforge.net/projects/orbit-productivity/');
  await app.close();
});
