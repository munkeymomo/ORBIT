import { chromium, expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('single-file edition: opens from disk with nothing beside it, and keeps data in the browser', async () => {
  const profile = mkdtempSync(path.join(tmpdir(), 'orbit-single-'));
  const ctx = await chromium.launchPersistentContext(profile, { channel: 'chrome' });
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    const failed: string[] = [];
    page.on('requestfailed', (r) => failed.push(r.url()));
    page.on('pageerror', (e) => failed.push(e.message));
    await page.goto(pathToFileURL(path.resolve('dist-single/index.html')).href);
    await page.getByPlaceholder('e.g. Thesis, Website, House move').fill('From a file');
    await page.getByRole('button', { name: 'Create project' }).click();
    await page.waitForTimeout(400);
    await page.reload();
    await expect(page.getByRole('button', { name: /^From a file/ }).first()).toBeVisible();
    await expect(page.getByText('This browser is not letting ORBIT save')).toHaveCount(0);
    await page.keyboard.press('7');
    await expect(page.getByText('This copy of ORBIT runs straight from a file and works offline.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Buy me a coffee' })).toHaveAttribute('href', 'https://ko-fi.com/markisaacschem');
    await expect(page.getByRole('link', { name: 'SourceForge' })).toHaveAttribute('href', 'https://sourceforge.net/projects/orbit-productivity/');
    expect(failed).toEqual([]);
  } finally {
    await ctx.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
