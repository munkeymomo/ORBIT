import { expect, test, type Page } from '@playwright/test';

/*
 * "Something changed" seen from far away: a moon with flag "changed" marks its planet; the system's star, the galaxy's
 * counts and the whole-universe view all say how many. The demo "Notes" verse has changed moons: Garden has two
 * (on two notes of one notebook), House move, Workshop and Bakery one each, the Saturday market stall none.
 */

const verseButton = (page: Page, id: string) => page.locator(`[data-verse="${id}"]`);
const crumbs = (page: Page) => page.getByRole('navigation', { name: 'Where you are in the universe' });

async function openNotes(page: Page) {
  await page.goto('/?orbit-host=demo#universe');
  await expect(page.getByRole('button', { name: /^Garden galaxy/ })).toBeVisible();
  await verseButton(page, 'notes').click();
  await expect(verseButton(page, 'notes')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(1000);
}

test('universe, galaxy and system level each say what changed, and the panels list it first', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'desktop canvas');
  await openNotes(page);

  // universe: each galaxy's counts say "n changed" in red, and its name for a screen reader says so too
  const garden = page.locator('[data-galaxy="g-garden"]');
  await expect(garden).toHaveAttribute('data-changed', '2');
  await expect(garden).toHaveAttribute('aria-label', /Garden galaxy: .*2 changed\./);
  await expect(garden.locator('[data-galaxy-changed="2"]')).toHaveText(/2 changed/);
  await expect(page.locator('[data-galaxy="g-move"] [data-galaxy-changed="1"]')).toBeVisible();
  // a galaxy with nothing changed says nothing
  await expect(page.locator('[data-galaxy="g-market"]')).not.toHaveAttribute('data-changed', /.+/);
  await expect(page.locator('[data-galaxy="g-market"] [data-galaxy-changed]')).toHaveCount(0);
  // the whole-universe view answers "is anything stale?": the sum is what the galaxies say
  const sums = await page.locator('[data-galaxy][data-changed]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-changed'))));
  expect(sums.reduce((a, b) => a + b, 0)).toBe(5);

  // galaxy: the star carries a badge "n changed" and its subtitle says so
  await garden.click();
  await expect(crumbs(page).getByRole('button', { name: 'Garden' })).toBeVisible();
  await page.waitForTimeout(900);
  const star = page.locator('[data-system="nt-gd-diary"]');
  await expect(star).toHaveAttribute('data-changed', '2');
  await expect(star.locator('[data-changed-badge="2"]')).toHaveAccessibleName('2 changed');
  await expect(star).toHaveAttribute('aria-label', /2 changed\./);
  await expect(page.locator('[data-system-changed="2"]')).toHaveText(/2 changed/);

  // the galaxy's panel (click its name while inside it) lists Changed first, with its planets and moons
  await page.getByRole('button', { name: /^Garden galaxy/ }).click();
  const gpanel = page.getByRole('complementary', { name: 'Galaxy details' });
  const gsection = gpanel.locator('[data-changed-section="2"]');
  await expect(gsection).toBeVisible();
  await expect(gsection.locator('[data-changed-planet]')).toHaveCount(2);
  await expect(gsection.locator('[data-changed-planet="n-soil"] [data-changed-moons]')).toHaveText('Site photo, March');
  // first: no other section title comes before it
  expect(await gpanel.locator('h2, h3, [data-changed-section]').evaluateAll((els) => els.findIndex((e) => e.hasAttribute('data-changed-section')))).toBeLessThanOrEqual(1);

  // system: the planets with a changed moon wear a notch and a pill that reads without selecting them
  await star.click();
  await page.waitForTimeout(1400);
  for (const id of ['n-soil', 'n-plan']) {
    const planet = page.locator(`[data-item="${id}"]`);
    await expect(planet).toHaveAttribute('data-changed', '1');
    await expect(planet.locator('[data-changed-rim]')).toHaveCount(1);
    await expect(planet.locator('[data-changed-pill]')).toContainText('1 changed');
  }
  await expect(page.locator('[data-item="n-pond"]')).not.toHaveAttribute('data-changed', /.+/);
  await expect(page.locator('[data-item="n-pond"] [data-changed-rim]')).toHaveCount(0);

  // the system's panel lists Changed first; a row selects (and flies to) its planet
  await page.getByRole('button', { name: /^Garden diary\./ }).click();
  const spanel = page.getByRole('complementary', { name: 'System details' });
  const ssection = spanel.locator('[data-changed-section="2"]');
  await expect(ssection).toBeVisible();
  await expect(ssection.locator('[data-changed-planet]')).toHaveCount(2);
  await ssection.locator('[data-changed-planet="n-plan"]').click();
  const ipanel = page.getByRole('complementary', { name: 'Item details' });
  await expect(ipanel.getByRole('heading', { name: 'Planting plan 2026' })).toBeVisible();
  // the per-moon badge is still there
  await expect(ipanel.getByText('Changed', { exact: true })).toBeVisible();
});

test('the filter “Has something changed” highlights marked planets and dims the rest', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'desktop canvas');
  await openNotes(page);
  await page.getByRole('button', { name: /^Garden galaxy/ }).first().click();
  await page.waitForTimeout(900);
  await page.locator('[data-system="nt-gd-diary"]').click();
  await page.waitForTimeout(1400);
  const fade = (id: string) => page.locator(`[data-item="${id}"] [data-fade]`).evaluate((e) => Number(getComputedStyle(e).opacity));
  expect(await fade('n-pond')).toBe(1);
  await page.getByRole('button', { name: /^Filters/ }).click();
  await page.getByRole('menuitemcheckbox', { name: /Has something changed/ }).click();
  await expect.poll(() => fade('n-pond')).toBeLessThan(0.5);
  expect(await fade('n-soil')).toBe(1);
  expect(await fade('n-plan')).toBe(1);
  await page.getByRole('menuitemcheckbox', { name: /Has something changed/ }).click();
  await expect.poll(() => fade('n-pond')).toBe(1);
});

test('standalone ORBIT has no “Has something changed” filter, and the work verse’s Today does not mention changes', async ({ page }) => {
  await page.goto('/#universe');
  await page.getByRole('button', { name: /example workspace/i }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /^Filters/ }).click();
  await expect(page.getByRole('menuitemcheckbox', { name: /Has something changed/ })).toHaveCount(0);
  await expect(page.locator('[data-changed], [data-changed-badge], [data-galaxy-changed]')).toHaveCount(0);
});
