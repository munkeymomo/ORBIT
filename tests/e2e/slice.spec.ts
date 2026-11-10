import { expect, test, type Page } from '@playwright/test';

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1440) < 768;

async function createFirstProject(page: Page, name: string) {
  await page.goto('/');
  await page.getByPlaceholder('e.g. Thesis, Website, House move').fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
}

async function addTaskInProjectPanel(page: Page, title: string) {
  const input = page.getByLabel('New task title').first();
  await input.fill(title);
  await input.press('Enter');
}

test('vertical slice: create project → task → Universe → focus → park → resume → complete', async ({ page }) => {
  await createFirstProject(page, 'Thesis');
  // The project panel opens automatically for the new project.
  await expect(page.getByLabel('Project name')).toHaveValue('Thesis');
  await addTaskInProjectPanel(page, 'Write chapter 3');
  await addTaskInProjectPanel(page, 'Check references');

  // View in Universe
  if (isPhone(page)) {
    await page.getByRole('button', { name: 'Close (Esc)' }).click();
    await expect(page.getByRole('button', { name: /Write chapter 3/ })).toBeVisible();
    await page.getByRole('button', { name: /Write chapter 3/ }).click();
  } else {
    const node = page.getByRole('button', { name: /^Write chapter 3 · Normal priority/ });
    await expect(node).toBeVisible();
    await node.click();
  }
  await expect(page.getByLabel('Task title')).toHaveValue('Write chapter 3');

  // Start focus
  await page.getByRole('button', { name: /^Start focus/ }).click();
  await expect(page.getByText('Focusing')).toBeVisible();

  // Park with context
  await page.getByRole('button', { name: 'Park', exact: true }).first().click();
  await page.getByLabel('Where I stopped').fill('Section 3.2, second paragraph');
  await page.getByLabel('My next action').fill('Rewrite the opening sentence');
  await page.getByLabel('My next action').press('Enter');
  await expect(page.getByText(/Parked “Write chapter 3”/)).toBeVisible();

  // Persistence: reload immediately (no grace period) and the parked task is still there with its note
  await page.reload();
  if (isPhone(page)) {
    await page.getByRole('button', { name: /Write chapter 3.*Rewrite the opening sentence/ }).first().click();
  } else {
    await page.getByRole('button', { name: /Resume “Write chapter 3”/ }).click();
  }

  // Resume card restores the checkpoint
  const card = page.getByRole('dialog', { name: 'Welcome back' });
  await expect(card).toBeVisible();
  await expect(card.getByText('Rewrite the opening sentence')).toBeVisible();
  await expect(card.getByText('Section 3.2, second paragraph')).toBeVisible();
  await card.getByRole('button', { name: /Continue timer/ }).click();

  // Focus view shows the carried-over checkpoint and a running timer
  await expect(page).toHaveURL(/#focus$/);
  await expect(page.getByText('Picking up from your checkpoint')).toBeVisible();
  await expect(page.getByRole('main').getByRole('button', { name: 'Pause', exact: true })).toBeVisible();

  // Complete
  await page.getByRole('main').getByRole('button', { name: 'Complete', exact: true }).click();
  await expect(page.getByText('Completed “Write chapter 3”.')).toBeVisible();

  // Persisted as done
  await page.reload();
  await page.goto('/#insights');
  await expect(page.getByText('Write chapter 3')).toBeVisible();
});

test('timer is timestamp based: overtime after the countdown, never forced to stop', async ({ page }) => {
  await page.clock.install();
  await createFirstProject(page, 'Timers');
  await addTaskInProjectPanel(page, 'Long task');
  await page.goto('/#focus');
  await page.getByRole('button', { name: '15m' }).click();
  await page.getByRole('main').getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByLabel(/Timer 15:00|Timer 14:5\d/)).toBeVisible();
  await page.clock.fastForward('10:00');
  await expect(page.getByLabel(/Timer [45]:\d\d/)).toBeVisible();
  // Reload mid-session: the clock carries on from stored timestamps
  await page.reload();
  await expect(page.getByLabel(/Timer [45]:\d\d/)).toBeVisible();
  await page.clock.fastForward('06:00');
  await expect(page.getByText('Time is up — keep going if you are in the zone.')).toBeVisible();
  await expect(page.getByLabel(/Timer \+\d:\d\d/)).toBeVisible();
  await expect(page.getByRole('main').getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
});

test('quick capture routes #project to a project and the rest to the Inbox', async ({ page }) => {
  await createFirstProject(page, 'Website');
  await page.goto('/#inbox');
  if (isPhone(page)) await page.getByRole('button', { name: 'Capture', exact: true }).click();
  else await page.keyboard.press('c');
  const box = page.getByLabel('Capture text');
  await box.fill('Fix the footer #web');
  await box.press('Enter');
  await box.fill('Remember to call the bank');
  await box.press('Enter');
  await page.getByRole('button', { name: 'Done' }).click();
  const main = page.getByRole('main');
  await expect(main.getByText('Remember to call the bank')).toBeVisible();
  await expect(main.getByText('Fix the footer')).toHaveCount(0); // went straight into Website
  await page.goto('/#universe');
  if (!isPhone(page)) await expect(page.getByRole('main').getByRole('button', { name: /^Fix the footer · / })).toBeVisible();
  await page.goto('/#inbox');
  await page.getByRole('button', { name: 'Sort' }).first().click();
  await page.getByRole('button', { name: 'Create task' }).click();
  await expect(page.getByText(/Filed “Remember to call the bank”/)).toBeVisible();
});

test('backup: download, erase, restore', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'covered on desktop');
  await page.goto('/');
  await page.getByRole('button', { name: /Explore an example workspace/ }).click();
  await expect(page.getByText(/Example workspace loaded/)).toBeVisible();
  await page.goto('/#preferences');
  await expect(page.getByText(/^[1-9]\d* projects · /)).toBeVisible();
  const counts = (await page.getByText(/\d+ projects? · \d+ tasks?/).textContent())!.match(/\d+ projects? · \d+ tasks?/)![0];
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()]);
  const path = await download.path();
  await page.getByRole('button', { name: 'Erase all data' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Erase all data' }).click();
  await expect(page.getByText('0 projects · 0 tasks')).toBeVisible();
  await page.getByLabel('Choose a backup file').setInputFiles(path!);
  await expect(page.getByText('Backup looks good.')).toBeVisible();
  await page.getByRole('button', { name: 'Replace all data with this backup' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Replace and restore' }).click();
  await expect(page.getByText('Backup restored.')).toBeVisible();
  await expect(page.getByText(counts)).toBeVisible();
  await page.reload();
  await expect(page.getByText(counts)).toBeVisible();
});

test('day board: drag an unplanned task into a slot', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'phone uses menus; drag tested on desktop');
  await page.goto('/');
  await page.getByRole('button', { name: /Explore an example workspace/ }).click();
  await expect(page.getByText(/Example workspace loaded/)).toBeVisible();
  await page.goto('/#today');
  const handle = page.getByRole('button', { name: 'Drag “Write hero copy” onto the day' });
  const later = page.getByRole('region', { name: /^Later/ });
  const a = (await handle.boundingBox())!;
  const b = (await later.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 30, a.y + 10, { steps: 5 });
  await page.mouse.move(b.x + b.width / 2, b.y + 120, { steps: 15 });
  await page.mouse.up();
  await expect(later.getByText('Write hero copy')).toBeVisible();
  // and via the menu (keyboard/touch path)
  await later.getByRole('button', { name: 'More' }).first().click();
  await page.getByRole('menuitem', { name: 'Move to Morning' }).click();
  await expect(page.getByRole('region', { name: /^Morning/ }).getByText('Write hero copy')).toBeVisible();
});

test('universe: fly into galaxies and systems, step back out, jump between them', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'phones use the card universe');
  await page.goto('/');
  await page.getByRole('button', { name: /Explore an example workspace/ }).click();
  await expect(page.getByText(/Example workspace loaded/)).toBeVisible();
  const crumbs = page.getByRole('navigation', { name: 'Where you are in the universe' });
  await expect(crumbs).toContainText('Galaxies');

  // universe → galaxy (click the galaxy) → system (click the star)
  await page.getByRole('button', { name: /^Work \(example\) galaxy/ }).click();
  await expect(crumbs).toContainText('Work (example)');
  await page.getByRole('button', { name: /^Quarterly report\./ }).click();
  await expect(crumbs).toContainText('Quarterly report');
  // planets are interactive at system level
  await page.getByRole('button', { name: /^Make charts for slides 4–7/ }).click();
  await expect(page.getByLabel('Task title')).toHaveValue('Make charts for slides 4–7');

  // Esc: closes the panel first, then steps up one level at a time
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Task title')).toHaveCount(0);
  await expect(crumbs).toContainText('Quarterly report');
  await page.keyboard.press('Escape');
  await expect(crumbs).not.toContainText('Quarterly report');
  await expect(crumbs).toContainText('Work (example)');
  await page.keyboard.press(']');
  await expect(crumbs).toContainText('Life (example)');
  await page.keyboard.press('Escape');
  await expect(crumbs).toContainText('Galaxies');

  // jump straight to a system from the breadcrumb menus
  await page.getByRole('button', { name: /^Life \(example\) galaxy/ }).click();
  await crumbs.getByRole('button', { name: /Systems/ }).click();
  await page.getByRole('menuitem', { name: 'Learn Spanish' }).click();
  await expect(crumbs).toContainText('Learn Spanish');
  await expect(page.getByRole('button', { name: /^Lesson 12: past tense/ })).toBeVisible();

  // drag a galaxy by its name; its new position is saved
  await page.keyboard.press('0');
  await expect(crumbs).toContainText('Galaxies');
  const label = page.getByRole('button', { name: /^Life \(example\) galaxy/ });
  const before = (await label.boundingBox())!;
  await page.mouse.move(before.x + before.width / 2, before.y + 10);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 - 40, before.y + 30, { steps: 6 });
  await page.mouse.move(before.x + before.width / 2 - 120, before.y + 60, { steps: 6 });
  await page.mouse.up();
  const moved = (await label.boundingBox())!;
  expect(moved.x).toBeLessThan(before.x - 80);
  await page.reload();
  // a key pressed before the app is ready (still loading its data) does nothing: wait for it first
  await expect(page.locator('#main')).toBeVisible();
  await page.keyboard.press('0');
  await expect(page.getByRole('button', { name: /^Life \(example\) galaxy/ })).toBeVisible();
});

test('universe: new galaxy, then a new system inside it', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'desktop canvas');
  await createFirstProject(page, 'Loose project');
  await page.getByRole('button', { name: 'Close (Esc)' }).click();
  await page.getByRole('button', { name: 'New system or galaxy' }).click();
  await page.getByRole('menuitem', { name: 'New galaxy' }).click();
  await page.getByPlaceholder('e.g. Research, Teaching, Home').fill('Research');
  await page.getByRole('button', { name: 'Create galaxy' }).click();
  const crumbs = page.getByRole('navigation', { name: 'Where you are in the universe' });
  await expect(crumbs).toContainText('Research');
  await page.getByRole('button', { name: 'New system or galaxy' }).click();
  await page.getByRole('menuitem', { name: 'New system in Research' }).click();
  await expect(page.getByRole('group', { name: 'Galaxy' }).getByRole('combobox')).toHaveValue(/.+/);
  await page.getByPlaceholder('e.g. Thesis chapter 3').fill('XPS paper');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(crumbs).toContainText('Research');
  await expect(crumbs).toContainText('XPS paper');
});

test('universe: drag a star onto another galaxy to move it; Esc cancels a drag; tidy into a spiral', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'desktop canvas');
  await page.goto('/');
  await page.getByRole('button', { name: /Explore an example workspace/ }).click();
  await expect(page.getByText(/Example workspace loaded/)).toBeVisible();
  const crumbs = page.getByRole('navigation', { name: 'Where you are in the universe' });
  await expect(crumbs).toContainText('Galaxies');

  const star = page.getByRole('button', { name: /^Quarterly report in Work \(example\)\./ });
  const life = page.getByRole('button', { name: /^Life \(example\) galaxy/ });
  const centre = async (l: typeof star) => {
    const b = (await l.boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };

  // Esc mid-drag puts it back and does not leave the universe view
  let from = await centre(star);
  let to = await centre(life);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 8 });
  await page.mouse.move(to.x, to.y - 20, { steps: 8 });
  await expect(page.getByText('Move to Life (example)')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.getByText('Move to Life (example)')).toHaveCount(0);
  await expect(star).toBeVisible();
  await expect(crumbs).toContainText('Galaxies');

  // a real drop moves it, and Undo moves it back
  from = await centre(star);
  to = await centre(life);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 8 });
  await page.mouse.move(to.x, to.y - 20, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByText(/Moved “Quarterly report” to Life \(example\)/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Quarterly report in Life \(example\)\./ })).toBeVisible();
  await expect(crumbs).toContainText('Galaxies'); // a drop is not a click: no flight
  await page.reload();
  await expect(page.getByRole('button', { name: /^Quarterly report in Life \(example\)\./ })).toBeVisible();
  // its tasks travel with it
  await page.getByRole('button', { name: /^Quarterly report in Life \(example\)\./ }).click();
  await expect(crumbs).toContainText('Life (example)');
  await expect(crumbs).toContainText('Quarterly report');
  await expect(page.getByRole('button', { name: /^Make charts for slides 4–7/ })).toBeVisible();

  // tidy galaxies into a spiral (undoable)
  await page.keyboard.press('0');
  await page.getByRole('button', { name: 'New system or galaxy' }).click();
  await page.getByRole('menuitem', { name: 'Tidy galaxies into a spiral' }).click();
  await expect(page.getByText('Galaxies arranged in a spiral, oldest at the centre.')).toBeVisible();
  await expect(crumbs).toContainText('Galaxies');
});
