import { test, expect, type Page } from '@playwright/test';

/*
 * Depth (src/host/depth.ts; PROTOCOL.md "Depth"): the demo host with `&depth=1` has a group, "Around the house",
 * with a group inside it, "Trade and markets"; and in the verses other than the first, the market stall is a galaxy
 * inside the bakery, reached by a portal there.
 */

const crumbs = (page: Page) => page.getByRole('navigation', { name: 'Where you are in the universe' });
const galaxy = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`^${name} galaxy`) });
const group = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`^${name} group`) });

test('the sky holds one level: groups are gone into and come back out of', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'desktop canvas');
  await page.goto('/?orbit-host=demo-readonly&depth=1#universe');

  // the top: one body for the group, none of the galaxies inside it
  await expect(group(page, 'Around the house')).toBeVisible();
  await expect(group(page, 'Around the house')).toHaveAccessibleName(/5 galaxies · 1 group\. 1 changed\. Go in\./);
  await expect(galaxy(page, 'Garden')).toHaveCount(0);
  await expect(galaxy(page, 'Bakery')).toHaveCount(0);
  await expect(page.getByText('Around the house', { exact: true })).toHaveCount(1);
  // what changed inside it is still seen from outside
  await expect(page.locator('[data-galaxy="c-home"]')).toHaveAttribute('data-changed', /^[1-9]/);

  // in: its three galaxies and the group inside it; the path says where
  await group(page, 'Around the house').click();
  await expect(galaxy(page, 'Garden')).toBeVisible();
  await expect(galaxy(page, 'House move')).toBeVisible();
  await expect(galaxy(page, 'Workshop')).toBeVisible();
  await expect(group(page, 'Trade and markets')).toHaveAccessibleName(/2 galaxies\. Go in\./);
  await expect(galaxy(page, 'Bakery')).toHaveCount(0);
  await expect(crumbs(page).getByRole('button', { name: 'Around the house' })).toHaveAttribute('aria-current', 'location');

  // further in, then back by the path, by Escape, and by the up arrow
  await group(page, 'Trade and markets').click();
  await expect(galaxy(page, 'Bakery')).toBeVisible();
  await expect(galaxy(page, 'Garden')).toHaveCount(0);
  await expect(crumbs(page).locator('[data-depth-step]')).toHaveCount(2);
  await crumbs(page).getByRole('button', { name: 'Around the house' }).click();
  await expect(galaxy(page, 'Garden')).toBeVisible();
  await group(page, 'Trade and markets').click();
  await expect(galaxy(page, 'Saturday market stall')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(galaxy(page, 'Garden')).toBeVisible();
  await crumbs(page).getByRole('button', { name: 'Up a level (Esc)' }).click();
  await expect(group(page, 'Around the house')).toBeVisible();
  await expect(crumbs(page).locator('[data-depth-step]')).toHaveCount(0);

  // a galaxy inside a group still flies in and back as before
  await group(page, 'Around the house').click();
  await galaxy(page, 'Garden').click();
  await expect(crumbs(page).getByRole('button', { name: 'Garden' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(crumbs(page).getByRole('button', { name: 'Around the house' })).toHaveAttribute('aria-current', 'location');
});

test('a flight to something inside a group goes into the groups on the way', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'desktop canvas');
  // the host says where to start: a galaxy two groups down
  await page.goto('/?orbit-host=demo-readonly&depth=1&at=galaxy:g-bakery#universe');
  await expect(crumbs(page).getByRole('button', { name: 'Bakery' })).toBeVisible();
  await expect(crumbs(page).locator('[data-depth-step]')).toHaveCount(2);
  await expect(crumbs(page).getByRole('button', { name: 'Trade and markets' })).toBeVisible();
});

test('a galaxy inside a galaxy is reached by its portal, and the path leads back', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'desktop canvas');
  await page.goto('/?orbit-host=demo-readonly&depth=1#universe');
  await page.locator('[data-verse="things"]').click();
  await expect(page.locator('[data-verse="things"]')).toHaveAttribute('aria-pressed', 'true');
  // a change of verse from the top stays at the top
  await expect(group(page, 'Around the house')).toBeVisible();
  // ... and from inside a group, it lands inside the same group in the other verse
  await group(page, 'Around the house').click();
  await expect(galaxy(page, 'Garden')).toBeVisible();
  await page.locator('[data-verse="notes"]').click();
  await expect(page.locator('[data-verse="notes"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(crumbs(page).locator('[data-depth-step]')).toHaveCount(1);
  await expect(galaxy(page, 'Garden')).toBeVisible();
  await expect(group(page, 'Around the house')).toHaveCount(0);
  await page.locator('[data-verse="things"]').click();
  await expect(page.locator('[data-verse="things"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(galaxy(page, 'Garden')).toBeVisible();
  await group(page, 'Trade and markets').click();
  // the stall is not in the sky beside the bakery: it is inside it
  await expect(galaxy(page, 'Bakery')).toBeVisible();
  await expect(galaxy(page, 'Saturday market stall')).toHaveCount(0);
  await galaxy(page, 'Bakery').click();
  await expect(crumbs(page).getByRole('button', { name: 'Bakery' })).toBeVisible();
  await page.getByRole('button', { name: 'Go in', exact: true }).click();
  await expect(crumbs(page).getByRole('button', { name: 'Saturday market stall' })).toBeVisible();
  // the path: the two groups, then the bakery it is inside, then the stall itself
  await expect(crumbs(page).locator('[data-depth-step]')).toHaveCount(3);
  await crumbs(page).locator('[data-depth-step]').nth(2).getByRole('button').click();
  await expect(galaxy(page, 'Saturday market stall')).toBeVisible();
});
