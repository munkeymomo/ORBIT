import { expect, test, type Page } from '@playwright/test';

/*
 * Several verses (the demo host offers Everything, Map, Things and Notes on the same galaxies): switching keeps the
 * galaxy, items have panels with facts, moons and wormholes, portals lead across, the dock keeps working on the
 * work verse's tasks, and a verse's own action calls the host. Standalone ORBIT has no verse switcher at all.
 */

type HostWindow = Window & { orbitHost: { log: { op: string; args: unknown[] }[] } };

const crumbs = (page: Page) => page.getByRole('navigation', { name: 'Where you are in the universe' });
const verseButton = (page: Page, id: string) => page.locator(`[data-verse="${id}"]`);

async function openDemo(page: Page) {
  await page.goto('/?orbit-host=demo#universe');
  await expect(page.getByRole('button', { name: /^Garden galaxy/ })).toBeVisible();
}

async function intoGalaxy(page: Page, name: string) {
  await page.getByRole('button', { name: new RegExp(`^${name} galaxy`) }).first().click();
  await expect(crumbs(page).getByRole('button', { name })).toBeVisible();
  await page.waitForTimeout(800);
}

test('switching verse keeps the same galaxy; the verse on screen says what its shapes mean', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'desktop canvas');
  await openDemo(page);
  const group = page.getByRole('group', { name: 'Views of the same records' });
  await expect(group.getByRole('button')).toHaveCount(4);
  await expect(verseButton(page, 'main')).toHaveAttribute('aria-pressed', 'true');
  await expect(verseButton(page, 'things')).toContainText('Tools & materials');

  await intoGalaxy(page, 'Workshop');
  await verseButton(page, 'things').click();
  await expect(verseButton(page, 'things')).toHaveAttribute('aria-pressed', 'true');
  // still in the Workshop, now arranged as tools and materials
  await expect(crumbs(page).getByRole('button', { name: 'Workshop' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Screws and fixings: / }).or(page.getByRole('button', { name: /^Screws and fixings\./ }))).toBeVisible();
  await expect(page.getByText(/Colour: kind of thing/)).toBeVisible();
  // nothing of ORBIT's own can be made in a verse that is not editable
  await expect(page.getByRole('button', { name: 'New system or galaxy' })).toHaveCount(0);

  // from inside a system, the next verse lands at the galaxy level of the same galaxy
  await page.getByRole('button', { name: /^Workshop tools\./ }).click();
  await expect(crumbs(page).getByText('Workshop tools')).toBeVisible();
  await verseButton(page, 'notes').click();
  await expect(crumbs(page).getByRole('button', { name: 'Workshop' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Workshop log\./ })).toBeVisible();
});

test('an item panel shows facts and moons; a wormhole leads to the task that uses it, and back', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'desktop canvas');
  await openDemo(page);
  await verseButton(page, 'things').click();
  await intoGalaxy(page, 'Workshop');
  await page.getByRole('button', { name: /^Workshop tools\./ }).click();
  await page.locator('[data-item="i-saw"] button').first().click();

  const panel = page.getByRole('complementary', { name: 'Item details' });
  await expect(panel.getByRole('heading', { name: 'Mitre saw' })).toBeVisible();
  await expect(panel.getByText('Blade', { exact: true })).toBeVisible();
  await expect(panel.getByText('254 mm, 60 teeth')).toBeVisible();
  await expect(panel.locator('[data-item-moons] li')).toHaveCount(2);
  await expect(panel.getByText('New blade fitted')).toBeVisible();
  // read-only: no edit controls on items, ever
  await expect(panel.getByRole('textbox')).toHaveCount(0);

  // through the wormhole to the task verse: the task is selected
  await panel.getByRole('button', { name: /Everything.*uses it/ }).click();
  await expect(verseButton(page, 'main')).toHaveAttribute('aria-pressed', 'true');
  const task = page.getByRole('complementary', { name: 'Task details' });
  await expect(task.getByLabel('Task title')).toHaveValue('Build the raised bed');
  await expect(crumbs(page).getByText('Vegetable beds')).toBeVisible();

  // and back again from the task's own wormholes
  await task.getByRole('button', { name: /Things.*uses Mitre saw/ }).click();
  await expect(verseButton(page, 'things')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('complementary', { name: 'Item details' }).getByRole('heading', { name: 'Mitre saw' })).toBeVisible();
});

test('a portal’s chip lands in the other verse, in the same galaxy', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'desktop canvas');
  await openDemo(page);
  await verseButton(page, 'map').click();
  await intoGalaxy(page, 'Garden');
  await page.locator('[data-portal-chip="map-g-garden-notes"]').click();
  await expect(verseButton(page, 'notes')).toHaveAttribute('aria-pressed', 'true');
  await expect(crumbs(page).getByRole('button', { name: 'Garden' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Garden diary\./ })).toBeVisible();
});

test('the dock’s focus timer keeps running across a verse switch; a task found by search brings its verse back', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'desktop canvas');
  await openDemo(page);
  const dock = page.getByRole('contentinfo', { name: 'Working memory dock' });
  await dock.getByRole('button', { name: 'Start' }).click();
  await expect(dock.getByText('Nothing in focus')).toHaveCount(0);
  const clock = dock.locator('.font-display').first();
  const t0 = await clock.textContent();
  await verseButton(page, 'things').click();
  await expect(verseButton(page, 'things')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(2200);
  await expect(dock.getByText('Nothing in focus')).toHaveCount(0);
  expect(await clock.textContent()).not.toBe(t0);
  // a task found by search while Things is on screen: the task verse comes back with it selected
  await page.keyboard.press('/');
  await page.keyboard.type('Book the van');
  await page.keyboard.press('Enter');
  await expect(verseButton(page, 'main')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('complementary', { name: 'Task details' }).getByLabel('Task title')).toHaveValue('Book the van');
  await expect(dock.getByText('Nothing in focus')).toHaveCount(0);
  await verseButton(page, 'things').click();
  // Today still has the work verse's tasks while Things is on screen
  await page.getByRole('link', { name: /Today/ }).or(page.getByRole('button', { name: /^Today/ })).first().click();
  await expect(page.getByText(/Seal around the window|Order 1\d\d/).first()).toBeVisible();
});

test('a verse’s own action calls the host, which answers with a new notebook', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'desktop canvas');
  await openDemo(page);
  await verseButton(page, 'notes').click();
  await intoGalaxy(page, 'House move');
  await page.locator('[data-verse-action="new-notebook"]').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as HostWindow).orbitHost.log.filter((l) => l.op === 'action').map((l) => l.args))).toEqual([['new-notebook', { verse: 'notes', galaxy: 'g-move' }]]);
  await expect(page.getByRole('button', { name: /^Notebook \d+\./ })).toBeVisible();
});

test('standalone ORBIT has no verse switcher', async ({ page }) => {
  await page.goto('/#universe');
  await page.getByRole('button', { name: /example workspace/i }).click();
  await expect(page.getByRole('button', { name: /example workspace/i })).toHaveCount(0);
  await page.waitForTimeout(500);
  await expect(page.getByRole('group', { name: 'Views of the same records' })).toHaveCount(0);
  await expect(page.locator('[data-verse]')).toHaveCount(0);
});
