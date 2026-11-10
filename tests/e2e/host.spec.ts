import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/*
 * ORBIT embedded in a host application (src/host). The read-only demo host (?orbit-host=demo-readonly) has
 * every capability false; the editable one (?orbit-host=demo) lets host tasks be changed and keeps ORBIT's
 * working state for them (its store lasts for the tab, in the demo host's own sessionStorage). Another test
 * proves detection of a host defined on the PARENT frame.
 */

/** Counts IndexedDB opens and localStorage use in every frame: a hosted ORBIT must do neither. */
const STORAGE_SPY = () => {
  const w = window as unknown as { __idbOpens: number; __lsUses: number };
  w.__idbOpens = 0;
  w.__lsUses = 0;
  try {
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = ((...a: Parameters<IDBFactory['open']>) => {
      w.__idbOpens++;
      return open(...a);
    }) as IDBFactory['open'];
  } catch {
    /* no IndexedDB here */
  }
  for (const k of ['getItem', 'setItem', 'removeItem'] as const) {
    const orig = Storage.prototype[k] as (...a: unknown[]) => unknown;
    (Storage.prototype as unknown as Record<string, unknown>)[k] = function (this: Storage, ...a: unknown[]) {
      if (this === window.localStorage) w.__lsUses++;
      return orig.apply(this, a);
    };
  }
};

type HostWindow = Window & {
  orbitHost: {
    opened: { kind: string; id: string }[];
    store: {
      load(): Promise<{
        placements: { id: string; x: number; y: number }[];
        prefs: { layers: { moons: boolean } };
        taskWork: { id: string; parked?: boolean }[];
        checkpoints: { taskId: string; nextAction: string }[];
        focus: { taskId: string | null } | null;
      }>;
    };
    change(fn: (v: { planets: { id: string; title: string }[] }) => void): void;
    current(): { planets: { id: string; title: string; status?: string; dropped?: boolean }[] };
    log: { op: string; args: unknown[] }[];
    refuseNext(reason: string): void;
    setLocked(text?: string): void;
    calls: { verse: number; unchanged: number };
  };
  __idbOpens: number;
  __lsUses: number;
};

async function center(page: Page, name: RegExp) {
  const box = (await page.getByRole('button', { name }).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('demo host: read-only sky, linked items, layers, and positions kept across a refresh', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'desktop canvas');
  await page.addInitScript(STORAGE_SPY);
  await page.goto('/?orbit-host=demo-readonly#universe');

  // the host's galaxies, without the finished one
  await expect(page.getByRole('button', { name: /^Garden galaxy/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^House move galaxy/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Bakery galaxy/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Old flat galaxy/ })).toHaveCount(0);
  await expect(page.getByText('Outdoor · in season')).toBeVisible();

  // no top bar, no creation controls, no capture
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New system or galaxy' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Capture/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Today/ })).toHaveCount(0);

  // fly into a system: planets, but no "add a task" slot
  await page.getByRole('button', { name: /^Garden galaxy/ }).click();
  await page.getByRole('button', { name: /^Vegetable beds\./ }).click();
  const planet = page.getByRole('button', { name: /^Build the raised bed/ });
  await expect(planet).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add a task to this system' })).toHaveCount(0);

  // select a task: where it is kept, its linked items, and no editing or focus controls
  await planet.click();
  const panel = page.getByRole('complementary', { name: 'Task details' });
  await expect(panel.getByText('Linked items')).toBeVisible();
  await expect(panel.getByText('Mitre saw', { exact: true })).toBeVisible();
  await expect(panel.getByText('+3 more in Demo host')).toBeVisible();
  await expect(panel.getByText('Kept by Demo host')).toBeVisible();
  await expect(panel.getByRole('button', { name: /^Start focus/ })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Complete' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'More actions' })).toHaveCount(0);
  await expect(panel.getByLabel('Task title')).toHaveAttribute('readonly', '');
  await panel.getByRole('button', { name: 'Open in Demo host' }).click();
  expect(await page.evaluate(() => (window as unknown as HostWindow).orbitHost.opened)).toContainEqual({ kind: 'task', id: 't-raised-bed' });

  // close up, the selected planet's moons are named; the Moons layer switch hides them (and is remembered)
  const chips = page.getByRole('list', { name: 'What this task uses' });
  await expect(chips).toBeVisible();
  const moons = page.getByRole('group', { name: 'Layers' }).getByRole('button', { name: 'Moons' });
  await expect(moons).toHaveAttribute('aria-pressed', 'true');
  await moons.click();
  await expect(moons).toHaveAttribute('aria-pressed', 'false');
  await expect(chips).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () => (await (window as unknown as HostWindow).orbitHost.store.load()).prefs.layers.moons)).toBe(false);
  await moons.click();
  await expect(chips).toBeVisible();

  // drag a galaxy; its new place is a placement in the host's store and survives a refresh with changes
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Whole universe (0)' }).click();
  await page.waitForTimeout(900);
  const before = await center(page, /^Workshop galaxy/);
  await page.mouse.move(before.x, before.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(before.x - i * 15, before.y + i * 6);
  await page.mouse.up();
  const moved = await center(page, /^Workshop galaxy/);
  expect(Math.hypot(moved.x - before.x, moved.y - before.y)).toBeGreaterThan(60);
  await expect
    .poll(() => page.evaluate(async () => (await (window as unknown as HostWindow).orbitHost.store.load()).placements.map((p) => p.id)))
    .toContain('g|g-workshop');

  // the host changes something; ORBIT refreshes on focus (no reload) and the galaxy stays where it was put
  await page.evaluate(() => {
    const w = window as unknown as HostWindow;
    w.orbitHost.change((v) => {
      v.planets.find((p) => p.id === 't-brackets')!.title = 'Buy shelf brackets and screws';
    });
    window.dispatchEvent(new Event('focus'));
  });
  // a full verse came back (not "unchanged"): the first load and this refresh
  await expect.poll(() => page.evaluate(() => { const c = (window as unknown as HostWindow).orbitHost.calls; return c.verse - c.unchanged; })).toBe(2);
  await page.waitForTimeout(200);
  const after = await center(page, /^Workshop galaxy/);
  expect(Math.abs(after.x - moved.x)).toBeLessThan(2);
  expect(Math.abs(after.y - moved.y)).toBeLessThan(2);
  await page.getByRole('button', { name: /^Workshop galaxy/ }).click();
  await page.getByRole('button', { name: /^Shelves\./ }).click();
  await expect(page.getByRole('button', { name: /^Buy shelf brackets and screws/ })).toBeVisible();

  // hosted: never IndexedDB, never localStorage
  expect(await page.evaluate(() => (window as unknown as HostWindow).__idbOpens)).toBe(0);
  expect(await page.evaluate(() => (window as unknown as HostWindow).__lsUses)).toBe(0);
});

test('a host defined on the parent frame is found from a same-origin iframe', async ({ page, context, baseURL }, info) => {
  test.skip(info.project.name === 'phone', 'desktop canvas');
  await context.addInitScript(STORAGE_SPY);
  const parentUrl = `${baseURL}/host-parent.html`;
  await page.route(parentUrl, (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><html><head><title>Parent</title><script>
        window.writes = [];
        window.orbitHost = {
          protocol: 1,
          async handshake() {
            return { protocol: 1, host: { name: 'Parent page' }, caps: {}, verses: [{ id: 'v', name: 'All', plain: 'tasks', legend: '', editable: false }] };
          },
          async verse(id, since) {
            if (since === '1') return { verse: 'v', rev: '1', unchanged: true };
            return {
              verse: 'v', rev: '1', families: {},
              galaxies: [{ id: 'g1', name: 'Allotment', chip: 'Plot · rented' }],
              systems: [{ id: 's1', galaxy: 'g1', name: 'Plot seven' }],
              planets: [{ id: 'p1', system: 's1', type: 'task', title: 'Water the beans', status: 'todo', priority: 2 }],
            };
          },
          open(t) { window.opened = t; },
          store: {
            kind: 'memory',
            async load() { return { projects: [], groups: [], tasks: [], checkpoints: [], sessions: [], captures: [], dayItems: [], placements: [], taskWork: [], prefs: {}, focus: null }; },
            async put(t) { window.writes.push(t); },
            async bulkPut(t) { window.writes.push(t); },
            async remove(t) { window.writes.push(t); },
            async setPrefs() { window.writes.push('prefs'); },
            async setFocus() { window.writes.push('focus'); },
            async replaceAll() { window.writes.push('replaceAll'); },
          },
        };
      </script></head><body style="margin:0"><iframe src="/#universe" style="border:0;width:100vw;height:100vh"></iframe></body></html>`,
    }),
  );
  await page.goto(parentUrl);
  const frame = page.frameLocator('iframe');
  await expect(frame.getByRole('button', { name: /^Allotment galaxy/ })).toBeVisible();
  await expect(frame.getByText('Plot · rented')).toBeVisible();
  await expect(frame.getByRole('heading', { level: 1 })).toHaveCount(0);
  const child = page.frames().find((f) => f !== page.mainFrame())!;
  expect(await child.evaluate(() => (window as unknown as HostWindow).__idbOpens)).toBe(0);
  expect(await child.evaluate(() => (window as unknown as HostWindow).__lsUses)).toBe(0);
  // nothing of the host's was written to its store
  expect(await page.evaluate(() => (window as unknown as { writes: string[] }).writes.filter((w) => w !== 'prefs' && w !== 'placements'))).toEqual([]);
});

test('a host speaking another protocol is refused with a reason, and ORBIT runs on its own', async ({ page, baseURL }, info) => {
  test.skip(info.project.name === 'phone', 'covered on desktop');
  await page.addInitScript(STORAGE_SPY);
  await page.addInitScript(() => {
    (window as unknown as { orbitHost: unknown }).orbitHost = { protocol: 2, handshake: async () => ({ protocol: 2 }) };
  });
  await page.goto(`${baseURL}/#universe`);
  await expect(page.getByText('This build of ORBIT speaks host protocol 1; the host offered 2.')).toBeVisible();
  await expect(page.getByPlaceholder('e.g. Thesis, Website, House move')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as HostWindow).__idbOpens)).toBe(0);
});

const hostDo = <T,>(page: Page, fn: (h: HostWindow['orbitHost']) => T | Promise<T>) =>
  page.evaluate(`(${fn.toString()})(window.orbitHost)`) as Promise<T>;
const planetOf = (page: Page, id: string) => page.evaluate((i) => (window as unknown as HostWindow).orbitHost.current().planets.find((p) => p.id === i), id);

async function openTask(page: Page, galaxy: RegExp, system: RegExp, task: RegExp) {
  await page.getByRole('button', { name: galaxy }).click();
  await page.getByRole('button', { name: system }).click();
  await page.getByRole('button', { name: task }).click();
  return page.getByRole('complementary', { name: 'Task details' });
}

test('editable demo host: edit a title, complete with Undo, a refusal undone, delete with a reason', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'desktop canvas');
  await page.addInitScript(STORAGE_SPY);
  await page.goto('/?orbit-host=demo#universe');
  const panel = await openTask(page, /^Garden galaxy/, /^Vegetable beds\./, /^Turn the compost/);
  const title = panel.getByLabel('Task title');
  await expect(title).not.toHaveAttribute('readonly', '');
  await expect(panel.getByText(/are kept with ORBIT by Demo host, not in your Demo host records/)).toBeVisible();

  // a title edit goes to the host as a patch of just that field
  await title.fill('Turn the compost heap');
  await title.press('Enter');
  await expect.poll(async () => (await planetOf(page, 't-compost'))?.title).toBe('Turn the compost heap');
  expect(await hostDo(page, (h) => h.log.filter((l) => l.op === 'update').map((l) => l.args))).toEqual([['t-compost', { title: 'Turn the compost heap' }]]);

  // the host refuses: the change is undone on screen and its reason is shown
  await hostDo(page, (h) => h.refuseNext('Titles are frozen this week.'));
  await title.fill('Something else');
  await title.press('Enter');
  await expect(page.getByText('Titles are frozen this week.')).toBeVisible();
  await expect(title).toHaveValue('Turn the compost heap');
  expect((await planetOf(page, 't-compost'))?.title).toBe('Turn the compost heap');

  // complete, then Undo from the toast
  await panel.getByRole('button', { name: 'Complete', exact: true }).click();
  await expect.poll(async () => (await planetOf(page, 't-compost'))?.status).toBe('done');
  await expect(panel.getByText('Done', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(async () => (await planetOf(page, 't-compost'))?.status).toBe('todo');
  await expect(panel.getByRole('button', { name: 'Complete', exact: true })).toBeVisible();

  // delete: the host asks for a reason, given in ORBIT's own confirm dialog
  await panel.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete task' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete this task?' });
  const confirm = dialog.getByRole('button', { name: 'Delete task' });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Reason').fill('Composted already');
  await confirm.click();
  await expect(page.getByRole('button', { name: /^Turn the compost heap/ })).toHaveCount(0);
  await expect.poll(async () => planetOf(page, 't-compost')).toBeUndefined();
  expect(await hostDo(page, (h) => h.log.find((l) => l.op === 'remove')?.args)).toEqual(['t-compost', 'Composted already']);

  // hosted: never IndexedDB, never localStorage
  expect(await page.evaluate(() => (window as unknown as HostWindow).__idbOpens)).toBe(0);
  expect(await page.evaluate(() => (window as unknown as HostWindow).__lsUses)).toBe(0);
});

test('editable demo host: park a host task, reload with the same host store, resume', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'desktop canvas');
  await page.addInitScript(STORAGE_SPY);
  await page.goto('/?orbit-host=demo#universe');
  const panel = await openTask(page, /^Garden galaxy/, /^Greenhouse\./, /^Sow tomato trays/);
  await panel.getByRole('button', { name: 'Park', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: /^Park/ });
  await sheet.getByLabel('My next action').fill('Water the trays');
  await sheet.getByRole('button', { name: 'Park', exact: true }).click();
  await expect(panel.getByText('Parked', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await (window as unknown as HostWindow).orbitHost.store.load()).taskWork.find((w) => w.id === 't-trays')?.parked)).toBe(true);
  // parking is ORBIT's: the host was not asked to change anything
  expect(await hostDo(page, (h) => h.log)).toEqual([]);

  await page.reload();
  await expect(page.locator('#main')).toBeVisible();
  const dock = page.getByRole('contentinfo', { name: 'Working memory dock' });
  await dock.getByRole('button', { name: /Sow tomato trays/ }).click();
  const welcome = page.getByRole('dialog', { name: 'Welcome back' });
  await expect(welcome.getByText('Water the trays')).toBeVisible();
  await welcome.getByRole('button', { name: /^Start focus/ }).click();
  await expect(dock.getByText('Parked tasks wait here with your place saved.')).toBeVisible();
  await expect
    .poll(() => page.evaluate(async () => {
      const s = await (window as unknown as HostWindow).orbitHost.store.load();
      return { parked: s.taskWork.find((w) => w.id === 't-trays')?.parked, focus: s.focus?.taskId };
    }))
    .toEqual({ parked: false, focus: 't-trays' });
  expect(await page.evaluate(() => (window as unknown as HostWindow).__idbOpens)).toBe(0);
  expect(await page.evaluate(() => (window as unknown as HostWindow).__lsUses)).toBe(0);
});

test('editable demo host: a locked host shows a banner; working state still works; it lifts on refresh', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'desktop canvas');
  await page.goto('/?orbit-host=demo&locked=Stocktaking until noon.#universe');
  const banner = page.getByRole('status', { name: 'Changes paused' });
  await expect(banner).toContainText('Stocktaking until noon.');
  const panel = await openTask(page, /^Garden galaxy/, /^Vegetable beds\./, /^Turn the compost/);
  await expect(panel.getByLabel('Task title')).toHaveAttribute('readonly', '');
  await expect(panel.getByRole('button', { name: 'Complete', exact: true })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'More actions' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: /^Start focus/ })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Park', exact: true })).toBeVisible();

  await page.evaluate(() => {
    (window as unknown as HostWindow).orbitHost.setLocked();
    window.dispatchEvent(new Event('focus'));
  });
  await expect(banner).toHaveCount(0);
  await expect(panel.getByLabel('Task title')).not.toHaveAttribute('readonly', '');
  await expect(panel.getByRole('button', { name: 'Complete', exact: true })).toBeVisible();
});

test('editable demo host with personal records: own galaxy beside the host’s, one Today, a backup without host records, Move to host', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'desktop canvas');
  await page.addInitScript(STORAGE_SPY);
  await page.goto('/?orbit-host=demo#universe');
  await expect(page.getByRole('button', { name: /^Garden galaxy/ })).toBeVisible();

  // a galaxy, a system and a task of ORBIT's own, made as in standalone ORBIT
  await page.getByRole('button', { name: 'New system or galaxy' }).click();
  await page.getByRole('menuitem', { name: 'New galaxy' }).click();
  await page.getByPlaceholder('e.g. Research, Teaching, Home').fill('Reading');
  await page.getByRole('button', { name: 'Create galaxy' }).click();
  await page.getByRole('button', { name: 'New system or galaxy' }).click();
  await page.getByRole('menuitem', { name: 'New system in Reading' }).click();
  await page.getByPlaceholder('e.g. Thesis chapter 3').fill('Novels');
  await page.getByRole('button', { name: 'Create project' }).click();
  const projectPanel = page.getByRole('complementary', { name: 'Project details' });
  await projectPanel.getByLabel('New task title').fill('Finish the long one');
  await projectPanel.getByLabel('New task title').press('Enter');
  await projectPanel.getByRole('button', { name: /Finish the long one/ }).click();
  const panel = page.getByRole('complementary', { name: 'Task details' });
  await panel.getByRole('button', { name: 'Plan today' }).click();
  await page.getByRole('menuitem', { name: 'Morning' }).click();
  await expect.poll(() => page.evaluate(async () => (await (window as unknown as HostWindow).orbitHost.store.load() as unknown as { groups: { name: string }[] }).groups.map((g) => g.name))).toEqual(['Reading']);

  // it sits beside the host's galaxies
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Whole universe (0)' }).click();
  await expect(page.getByRole('button', { name: /^Reading galaxy/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Garden galaxy/ })).toBeVisible();

  // a host task on the same Today
  const host = await openTask(page, /^Garden galaxy/, /^Greenhouse\./, /^Sow tomato trays/);
  await host.getByRole('button', { name: 'Plan today' }).click();
  await page.getByRole('menuitem', { name: 'Morning' }).click();
  await page.goto('/?orbit-host=demo#today');
  await expect(page.getByText('Finish the long one').first()).toBeVisible();
  await expect(page.getByText('Sow tomato trays').first()).toBeVisible();
  // the host's dates that are close, above the day; not cards
  const coming = page.getByRole('region', { name: 'Coming up' });
  await expect(coming.getByText('Seedlings out')).toBeVisible();
  await expect(coming.getByText('Frost check')).toBeVisible();
  await expect(coming.getByText('Spring planting')).toHaveCount(0);
  await coming.getByText('Seedlings out').click();
  await expect(page.getByRole('complementary', { name: 'Date details' })).toBeVisible();

  // a backup holds ORBIT's own records and working state, never the host's records
  await page.goto('/?orbit-host=demo#preferences');
  await expect(page.getByText(/Records kept by Demo host are not in this file/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Load example workspace/ })).toHaveCount(0);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()]);
  const file = JSON.parse(readFileSync((await download.path())!, 'utf8'));
  expect(file.schemaVersion).toBe(5);
  expect(file.groups.map((g: { name: string }) => g.name)).toEqual(['Reading']);
  expect(file.projects.map((p: { name: string }) => p.name)).toEqual(['Novels']);
  expect(file.tasks.map((t: { title: string }) => t.title)).toEqual(['Finish the long one']);
  expect(JSON.stringify([file.groups, file.projects, file.tasks])).not.toMatch(/"host"|g-garden|s-greenhouse|t-trays|Garden|Greenhouse/);
  expect(file.dayItems.map((d: { taskId: string }) => d.taskId)).toContain('t-trays');

  // Move to Demo host…: ORBIT's confirm first, then the host's own dialog (the demo takes all), then the task is the host's
  await page.goto('/?orbit-host=demo#today');
  await page.getByText('Finish the long one').first().click();
  await page.getByRole('complementary', { name: 'Task details' }).getByTitle('Open project').click();
  await projectPanel.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Move to Demo host…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Move “Novels” to Demo host?' });
  await expect(dialog).toContainText('title, notes, due date, priority and whether it is done');
  await expect(dialog.getByRole('button', { name: 'Download a backup first' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Continue in Demo host' }).click();
  await expect(page.getByText('“Novels” is now kept by Demo host (1 task).')).toBeVisible();
  const taken = await hostDo(page, (h) => h.current().planets.find((p) => p.title === 'Finish the long one'));
  expect(taken).toBeDefined();
  const saved = await page.evaluate(async () => (await (window as unknown as HostWindow).orbitHost.store.load()) as unknown as { tasks: unknown[]; projects: unknown[]; dayItems: { taskId: string }[]; taskWork: { id: string }[] });
  expect(saved.tasks).toEqual([]);
  expect(saved.projects).toEqual([]);
  expect(saved.dayItems.map((d) => d.taskId)).toContain(taken!.id);
  expect(saved.taskWork.map((w) => w.id)).toContain(taken!.id);
  // still on today's plan, now as the host's task
  await expect(page.getByText('Finish the long one').first()).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as HostWindow).__idbOpens)).toBe(0);
  expect(await page.evaluate(() => (window as unknown as HostWindow).__lsUses)).toBe(0);
});
