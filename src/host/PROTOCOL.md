# Running ORBIT inside a host application (host protocol 1)

ORBIT can be embedded by another application (a "host") that owns some of the records ORBIT shows. Without a
host nothing changes: ORBIT is the standalone, local-first app it always was. This file is the contract;
`host-protocol-v1.schema.json` is the shape of the two documents a host returns, and `fakeHost.ts` is a host
used by ORBIT's own tests.

## Finding a host

At start-up ORBIT looks for `window.orbitHost`, then (inside a same-origin frame) `window.parent.orbitHost`.
If one is there, ORBIT calls `handshake()`. A host whose `protocol` is not `1` is refused: ORBIT says why on
screen and runs nothing against it.

## What a host is

```ts
interface OrbitHost {
  protocol: 1;
  handshake(): Promise<Handshake>;
  /** One verse. With `since` (a `rev` ORBIT already has) the host may answer `{verse, rev, unchanged: true}`. */
  verse(id: string, since?: string): Promise<Verse | Unchanged>;
  /** Show something on a page of the host's own. */
  open(target: { kind: string; id: string }): void;
  /** Where ORBIT keeps what is its own (positions, preferences, working state, personal records).
      Same shape as ORBIT's StorageAdapter; replaceAll must be atomic. */
  store: StorageAdapter;
  /** Changes to host-owned tasks. A refusal rejects with an Error whose message is the reason shown. */
  tasks?: {
    /** `priority` always; `notes` and `due` only when set. */
    create(fields: Partial<TaskFields> & { title: string; system: string }): Promise<Planet>;
    /** Only the fields that changed; `system` when the task moved to another system. */
    update(id: string, patch: Partial<TaskFields> & { system?: string }): Promise<Planet>;
    /** `reason` (optional, new in this revision): the person's words, sent when they gave some. */
    setStatus(id: string, status: 'todo' | 'done' | 'dropped', reason?: string): Promise<Planet>;
    /** `reason` is '' when the task's caps.reason does not include 'delete'. */
    remove(id: string, reason: string): Promise<void>;
    /** `link` is the attachment's `link`. */
    detach(id: string, link: string): Promise<void>;
  };
  /** The host shows a picker of its own and attaches what was chosen. Resolves when done (true = changed). */
  pick?(family: string, ctx: { planet?: string; system?: string; galaxy?: string }): Promise<boolean>;
  /** Anything else the host does in a dialog of its own (see "Actions"). True = something changed (ORBIT refreshes). */
  action?(id: string, ctx: Record<string, string>): Promise<boolean>;
  /** Where to go first (read once, after the first verse has loaded). Not part of the JSON documents. */
  at?: { verse?: string; galaxy?: string; system?: string; planet?: string };
  /** Take one of ORBIT's own systems and its tasks ("Move to <host>…"); see "Handing a system to the host". */
  adopt?(batch: {
    name: string;
    tasks: Array<{ id: string; title: string; notes: string; due: string | null; priority: 1 | 2 | 3 | 4; status: 'todo' | 'done' }>;
  }): Promise<{ map: Record<string, string> } | null>;
}
```

## Starting up

- **Which verse.** ORBIT opens the handshake's `start` verse. A verse whose `shown` is `false` is not offered:
  if `start` is hidden or missing, ORBIT opens the first verse that is shown (the first verse when none is).
  `at.verse` (new in this revision, optional) opens that verse instead, when it is offered; otherwise it is ignored.
  When the verse opened first is not the work verse (see "Several verses"), ORBIT loads the work verse first, then
  the one it shows.
- **Where.** When the host object has `at`, ORBIT reads it once, after the first verse has loaded, and goes
  there: `{ planet: 't-17' }` selects that planet and flies to its system; `{ system: 's-4' }` flies into the
  system; `{ galaxy: 'g-2' }` into the galaxy. When several are given the most precise one ORBIT has wins; ids
  ORBIT does not have are ignored (and ORBIT opens the whole sky, as it would without `at`). The ids are looked
  up in the verse opened first: `{ verse: 'things', planet: 'i-saw' }` selects the item `i-saw` there.

## Rules

- **The host owns its records.** ORBIT never stores a host galaxy, system, planet, attachment or beacon. They
  are rebuilt from `verse()` and marked with a `host` reference in memory.
- **Capabilities decide what can be changed.** A control for a change the record's `caps` does not allow is
  hidden or disabled. With every capability false the view is read-only.
- **ORBIT draws none of the host's dialogs.** Picking and anything else that changes the host's records beyond
  a task's own fields goes through `pick()` and `action()`.
- **A refused change is undone on screen**, with the host's reason in a toast.
- **Refresh.** ORBIT asks `handshake()` and then `verse(id, rev)` when its page gains focus or becomes visible,
  and every 30 seconds while visible (after any change still waiting for the host has been answered). So a
  `locked` handshake, or any other change to it, comes and goes without a reload.
- **Locked.** While the handshake has `locked`, ORBIT shows its text across the top and offers no change to
  host records; working state (focus, parking, the day plan) still works.
- **Store failures.** When a write to `store` rejects, ORBIT keeps the change on screen and says once that it
  could not be saved (not again for a few seconds, and not while the message is still showing). The same goes
  for a refusal from `tasks`: the same reason is not shown twice at once.
- **Positions.** Where a host galaxy or system sits is ORBIT's to remember: table `placements` in `store`,
  keyed `g|<galaxy id>` for a galaxy (shared by every verse) and `<verse id>|<system id>` for a system.
- **Kinds and families** are the host's strings. A family has a label and a colour; ORBIT knows nothing else
  about them.
- **Tasks and items.** A planet of type `task` behaves like any ORBIT task. A planet of type `item` is a record
  shown as a planet: it never enters focus, parking, Today, Next, Insights, capture sorting, dependencies or task
  search, and is never counted as a task (see "Items").

## Changing host tasks (`caps.write`)

What ORBIT may change is what each record's `caps` allow, and only while the handshake's `caps.write` is true
and it is not `locked`:

| Change | Needs | ORBIT calls |
|---|---|---|
| title, notes, due, priority | task `edit` | `tasks.update(id, patch)` with only the fields that changed |
| move to another system | task `move` and the target system's `create` | `tasks.update(id, { system })` |
| complete / reopen | task `status` | `tasks.setStatus(id, 'done' \| 'todo')` |
| drop | task `status`; a reason first if `reason` has `drop` | `tasks.setStatus(id, 'dropped', reason)` |
| delete | task `delete`; a reason first if `reason` has `delete` | `tasks.remove(id, reason)` (`''` without one) |
| new task | system `create` | `tasks.create({ system, title, priority, notes?, due? })` |
| take a linked item off | task `attach` and the attachment has `link` | `tasks.detach(id, link)`, then a refresh |
| link something | task `attach` and `handshake.caps.pick` lists the family | `pick(family, { planet })`, then a refresh |

- ORBIT's `todo` and `parked` are both the host's `todo`: parking is ORBIT's (working state, below) and is
  never sent. A task the host says is done is done, whatever ORBIT had.
- Calls for one task are made one at a time, in order. ORBIT shows a change at once; the task the host returns
  is then authoritative for the fields it owns. A rejection — a refusal or a failure — is undone on screen
  (exactly the refused fields go back to what the host last said) and the Error's message is shown.
- A new task is shown at once under a temporary id (`tmp-…`) and replaced by the host's planet when `create`
  answers; anything made meanwhile (a day plan, a checkpoint, a focus session) moves to the host's id.
- A deleted task leaves the screen at once; what ORBIT kept for it (checkpoints, day items, working state, other
  tasks' dependencies on it) is removed only after `remove` resolves. Refused, it comes back.
- ORBIT never deletes, renames or re-files a host galaxy or system, and never touches the tasks of one; it only
  remembers where they sit (placements).
- `action(id, ctx)` is for anything else the host does in a dialog of its own; when it resolves true ORBIT
  refreshes.

## Working state (`caps.work`)

With `caps.work`, focus, parking, the day plan, Next, Insights, capture and the inbox work on host tasks, and
ORBIT keeps their state in `store` (the same tables and keys as standalone ORBIT; they may hold host task ids):

- `taskWork` — one row per host task, keyed by the host's task id: `{ id, parked, parkedAt, energy,
  estimateMin, progress, subtasks, dependsOn, links, updatedAt }`. Never sent to `tasks`.
- `checkpoints`, `sessions`, `dayItems`, `captures` — as standalone.
- `setFocus(runtime | null)` — the one live focus session; `setPrefs(prefs)` — preferences (kept always).

Without `caps.work` none of this is offered for host tasks and nothing of it is written. Backups, the example
workspace and erasing stay unavailable while ORBIT keeps no personal records with the host (`caps.personal`).

## ORBIT's own records (`caps.personal`)

With `caps.personal`, ORBIT's own galaxies, systems and tasks live beside the host's, and everything that can be
made in standalone ORBIT can be made here (new galaxy, system and task, capture and the inbox, Today, focus,
parking). They are stored in `store`, in tables `groups`, `projects` and `tasks`, exactly as ORBIT writes them
standalone (ORBIT's ids, never with a `host` mark); `checkpoints`, `sessions`, `dayItems` and `captures` hold
working state for them as well as for host tasks. A host-owned record never goes to any of these tables.

- A galaxy is either the host's or ORBIT's own. ORBIT's systems go only into ORBIT's galaxies or deep space; the
  host's stay in the host's galaxies or deep space. Deep space can hold both kinds side by side. A task moves
  only between systems of the same kind; a whole system of ORBIT's goes to the host with `adopt` (below).
- ORBIT places the host's unplaced galaxies around its own, so the two never sit on top of each other.
- There is one Today, one What-next, one set of Insights and one search, across both kinds of task.
- The example workspace is never offered while a host is attached (it would put made-up records in the host's
  store).
- **Backups.** A backup made while hosted is ORBIT's own part only: its galaxies, systems and tasks, checkpoints,
  sessions, captures, day items, `taskWork`, `placements`, preferences and the focus runtime — never a host's
  record. It is a normal ORBIT backup file (schema 5) and restores into standalone ORBIT too.
- **Restore** replaces ORBIT's own part, as standalone ORBIT does: ORBIT checks the file, then calls
  `store.replaceAll(snapshot)` once with the personal records and working state only. `replaceAll` must be
  atomic on the host's side (all or nothing). Backups of schema 1–5 are accepted (a schema-4 file from
  standalone ORBIT 1.0.0 arrives as all-personal). Working state that points at a host task that exists now is
  kept; rows that point at nothing are dropped (with a warning before the person confirms). ORBIT then reads
  `verse(id)` in full.
- **Erase** is `store.replaceAll()` with an empty snapshot that keeps only the theme preference. Host records
  are never touched by either.

## Handing a system to the host (`caps.adopt`)

With `caps.adopt` (together with `caps.personal` and `caps.work`) and an `adopt` method, a system of ORBIT's own
offers "Move to <host>…". ORBIT first says, in a confirm of its own, how many tasks will be offered, which fields
go to the host (title, notes, due, priority, done) and which stay with ORBIT as working state (parked,
checkpoints, focus sessions, the day plan, energy, estimate, progress, subtasks, dependencies, web links), and
offers a backup. Then it calls:

```ts
adopt({ name: 'Novels', tasks: [
  { id: 'k3j9…', title: 'Finish the long one', notes: 'Chapter 12', due: '2026-11-10', priority: 3, status: 'todo' },
  { id: 'p0q2…', title: 'Pick the next one', notes: '', due: null, priority: 2, status: 'todo' },
] })
// → { map: { 'k3j9…': 'host-task-17', 'p0q2…': 'host-task-18' } }   (or null: the person cancelled)
```

- The host shows a dialog of its own (where to put them, a preview of what moves) and creates the tasks. It may
  take all, some or none: the `map` holds ORBIT's id → the host's new planet id for each task it took.
  `null` means the person cancelled; a rejection means nothing was taken (its message is shown).
- `status` is `todo` for ORBIT's todo and parked tasks, `done` for done ones. `notes` is `''` when empty.
- For each task in the map ORBIT writes a `taskWork` row under the host's new id, moves its checkpoints,
  sessions, day items, captures, the focus runtime and other tasks' dependencies to the new id, and removes
  its own copy. The system goes too once it is empty; tasks the host did not take stay in it. Then ORBIT
  refreshes, so the host's verse should already contain the new planets when `adopt` resolves.
- Nothing is removed on ORBIT's side for a task the host did not take, or when `adopt` rejects.

## Several verses

A verse is one arrangement of the host's records as galaxies, systems and planets. A host may offer several
(`handshake.verses`); ORBIT shows a switcher at the top of the sky when more than one is offered (`shown !== false`),
each entry with the verse's `name` and its `plain` word under it, and the `legend` of the verse on screen beside it
(and at the top of the "?" panel). Standalone, and with a single verse, there is no switcher.

- **The work verse.** The first offered verse with `editable: true` (else the verse opened first) holds the tasks
  ORBIT works on: the dock, focus, Today, Next, the inbox, Insights and task search always use ITS tasks, whichever
  verse is on screen, and it stays loaded and refreshed. Task planets in any other verse are not shown. ORBIT's own
  galaxies, systems and tasks (`caps.personal`) appear only while the work verse is on screen; in another verse
  nothing can be created and systems cannot be moved between galaxies (they can still be dragged to a new place).
  Selecting a task from search, the dock or Today while another verse shows brings the work verse back.
- **Switching** calls `verse(id)` the first time; the last payload of each verse is kept in memory, so switching
  back is instant and is then brought up to date with `verse(id, rev)`. The camera stays on the same galaxy (inside
  a system, it lands at that system's galaxy); from the whole sky it shows the whole verse. A plain ~200 ms crossfade
  (none with reduced motion). The selection stays only if the same id exists in the new verse.
- **Refresh** (focus, visibility, every 30 s) asks `handshake()`, then the work verse and the verse on screen (when
  it is another one), each with its `rev`. Other verses seen before are only refreshed when shown again. A verse
  that stops being offered while on screen gives way to the work verse.
- **Places.** A galaxy has the same id in every verse and ONE place (placement `g|<galaxy id>`, shared); a galaxy
  without a placement takes the place it has in the work verse, so it does not move when the verse changes. A
  system's place is per verse (`<verse id>|<system id>`).
- **Galaxies across verses** are matched by id only. Each verse's own `name`, `color`, `chip` and so on are shown
  in that verse; a galaxy that two verses name differently simply reads differently in each.

## Items

A planet of type `item` is a record shown as a planet, read-only. ORBIT keeps items apart from tasks (by system),
so nothing that works on tasks can see them. What ORBIT does with each field:

| Field | Use |
|---|---|
| `title` | its name (beside the planet, laid out like task names); `sub` follows it close up and under the title in its panel |
| `kind`, `family` | the colour is the family's (`families[family].color`); the panel shows the family's label (or `kind`) |
| `size` | the planet's diameter: √(size ÷ the largest `size` in the verse) across 26–60 (world units); missing → 32 |
| `ring` | 0..1: a white ring around the planet showing that share; missing → no ring |
| `state` | `live` filled; `archived` hollow; `gone` hollow and struck through; the panel shows a badge |
| `ghost` | faint, dashed, with a small "elsewhere" mark; its panel shows only where it lives (its `also`) |
| `note`, `notes`, `facts` | shown in its panel (`facts` as label/value rows) |
| `attachments`, `more` | its moons: five drawn, then "+n" (`more` included); a moon with `flag: 'changed'` is red; listed in its panel and beside it when selected |
| `open` | "Open in <host>" in its panel |
| `also` | its wormholes (below) |
| `system.count` | a system holding items says "n items": `count` when given, else the item planets sent |

Counts in the dock, the top bar and on galaxies and systems stay TASK counts; items are said as "n items". More
than 40 items in one system are drawn as a ring of dots (family colours) with a count; its panel lists them all
(scrollable; typing narrows the list).

## Arrows

`verse.arrows` (`{from, to, label?}` between planet ids of the same verse, tasks or items) are relations such as
"made from". ORBIT draws each as a thin solid curve with an open arrowhead, between two planets drawn one by one
(close up), in systems of the same galaxy; the `label` shows when either end is selected or hovered. An arrow
whose end is missing or not drawn is skipped. Arrows are never dependencies: they never use the padlock or the
dashed "blocked" lines, and never change what Next suggests or what counts as blocked.

## Wormholes (`also`)

`also` on a galaxy, system, planet or attachment is the same record (or galaxy) in another verse:
`{ verse, galaxy?, system?, object?, note? }`. Task, item, system and galaxy panels list them ("Wormholes": the
target verse's name and plain word, and the `note`, e.g. "3 tasks use it"); a moon of the selected planet shows a
small swirl that opens a menu of its wormholes (the moon itself still opens in the host). Following one switches
verse and lands on the most precise target that verse has: `object` (a task or item: selected, and ORBIT flies to
its system; an attachment id: the item holding it), else `system`, else `galaxy`, else the whole verse — and when
the most precise one given is not there, a toast says so. When the target verse is the one already on screen (a ghost's way home), the row reads "Go to where it lives" and following it only selects and flies, with no verse switch or crossfade. The galaxy switcher is itself the galaxy wormhole.

## Portals

A system with `portal: { verse, label? }` leads to another verse. It is drawn as a violet swirl (not a star) with a
chip "to <verse name>" (or `label`); the chip, or the button in its panel, switches to that verse in the same galaxy.

## Actions

New in this revision (additive): a verse, a galaxy or a system may list things the host does in a dialog of its own.

```jsonc
// handshake.verses[i]
{ "id": "notes", "name": "Notes", "plain": "Writing", "legend": "…", "editable": false,
  "actions": [{ "id": "new-notebook", "label": "New notebook…" }] }
// verse.galaxies[i] and verse.systems[i]
{ "id": "nt-gd-diary", "galaxy": "g-garden", "name": "Garden diary",
  "actions": [{ "id": "new-note", "label": "New note…" }] }
```

Shape (all three): `actions?: Array<{ id: string /* 1–200 chars */; label: string /* not empty */ }>`.

- A verse's actions are buttons beside the switcher while that verse is on screen; a galaxy's or system's are in
  the "…" menu of its panel.
- A click calls `host.action(id, ctx)` with `ctx = { verse, galaxy?, system? }`: `verse` is the verse on screen;
  for a verse's action `galaxy` is the galaxy the person is in (if any); for a galaxy's, its id; for a system's,
  its id and its galaxy's. Resolving `true` makes ORBIT refresh (the work verse and the verse on screen);
  `false` changes nothing; a rejection is shown in a toast with its message (read from `.message` even when the
  Error comes from another frame).
- `handshake.caps.actions` may still list the ids the host answers; ORBIT does not require it.

## What the host must do (several verses)

- Use the SAME galaxy id for the same galaxy in every verse (that is what keeps its place and the camera).
- Use the same id for the same record across verses, and different ids for different records: the selection
  survives a switch when the id exists in the new verse, and wormholes resolve by id.
- Within one verse every planet id is unique (a ghost needs its own id, e.g. `i-drill@garden`; its `also` points home).
- Put tasks only in the editable verse ORBIT works on; task planets in other verses are not shown.
- Answer `verse(id, since)` for every verse it offers, with a `rev` per verse.

