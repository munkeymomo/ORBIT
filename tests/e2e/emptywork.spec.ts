import { expect, test, type Page } from '@playwright/test';

/*
 * A host whose work verse (the tasks) holds nothing yet, while its other verses do: somebody who has brought their
 * records in and made no task. The empty card must not hide the other verses, and a verse that has records shows them.
 */

const verseButton = (page: Page, id: string) => page.locator(`[data-verse="${id}"]`);

test('read-only host: the empty work verse says so, and the other verses are one click away', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'desktop canvas');
  await page.goto('/?orbit-host=demo-readonly&work=empty#universe');
  await expect(page.getByText('Nothing to show yet')).toBeVisible();
  const group = page.getByRole('group', { name: 'Views of the same records' });
  await expect(group.getByRole('button')).toHaveCount(4);
  await verseButton(page, 'things').click();
  await expect(verseButton(page, 'things')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Nothing to show yet')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Workshop galaxy/ }).first()).toBeVisible();
  // and back: the work verse is still empty, and still says so
  await verseButton(page, 'main').click();
  await expect(page.getByText('Nothing to show yet')).toBeVisible();
  await expect(group.getByRole('button')).toHaveCount(4);
});

test('a host that keeps ORBIT’s own records: the first system is offered only in the work verse', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'desktop canvas');
  await page.goto('/?orbit-host=demo&work=empty#universe');
  await expect(page.getByRole('heading', { name: 'Welcome to ORBIT' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Views of the same records' })).toBeVisible();
  await verseButton(page, 'notes').click();
  await expect(verseButton(page, 'notes')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Welcome to ORBIT' })).toHaveCount(0);
});

test('going straight to a verse that has records shows it, whatever the work verse holds', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'desktop canvas');
  await page.goto('/?orbit-host=demo-readonly&work=empty&at=verse:things#universe');
  await expect(verseButton(page, 'things')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /^Workshop galaxy/ }).first()).toBeVisible();
  await expect(page.getByText('Nothing to show yet')).toHaveCount(0);
});
