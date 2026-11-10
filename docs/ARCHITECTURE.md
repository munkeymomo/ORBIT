# ORBIT — Architecture and plan

Status: v0.1 (first build). This document is the source of truth for how ORBIT is put together, and is kept in step with the code.

There was no existing project to inspect, so ORBIT starts from a clean Vite + React + TypeScript scaffold.

---

## 1. Technical architecture and data model

### Stack

| Concern | Choice | Why |
|---|---|---|
| UI | React 19 + TypeScript (strict) | Spec requirement; typed domain model |
| Build | Vite 8 | Fast dev server, small output, PWA plugin |
| Styling | Tailwind CSS 4 with CSS-variable theme tokens | One set of semantic tokens drives dark and light themes |
| State | Zustand (one store, sliced by domain) | Small, synchronous, easy to test without React |
| Persistence | Dexie 4 over IndexedDB | Local-first, versioned schema migrations |
| Drag and drop | dnd-kit (Day Board, Inbox) | Pointer, touch and keyboard sensors; accessible |
| Spatial canvas | Custom transform layer (HTML nodes + SVG overlay) | Full control over pan, zoom and pinch; nodes stay real, focusable buttons |
| Icons | lucide-react | Consistent stroke icon set |
| PWA | vite-plugin-pwa (Workbox precache) | Installable, fully offline after first load |
| Tests | Vitest + fake-indexeddb, Playwright (Chrome) | Unit and migration tests in Node; end-to-end on desktop and mobile viewports |

No backend, no login, no paid APIs. Voice capture uses the browser's own Web Speech API, shown only where the browser provides it.

### Layers

```
UI components (views, panels, dock)
        │  read via selectors, call actions
        ▼
Zustand store  ── pure domain logic in src/lib (timer, scoring, backup, dates)
        │  write-through after every action
        ▼
StorageAdapter interface  (src/data/storage.ts)
        ├── JournalAdapter (write-ahead journal in localStorage, wrapping DexieAdapter)
        ├── DexieAdapter   (IndexedDB, default)
        └── MemoryAdapter  (tests, and fallback when IndexedDB is unavailable)
```

The store writes through one writer (`createRecordWriter` in `src/host/writer.ts`), which standalone passes everything straight to the adapter. The JournalAdapter records each write synchronously in localStorage and clears it once IndexedDB confirms, so a tab closed mid-write loses nothing; leftovers are replayed on the next start.

- **All writes go through the store's actions**, which update memory first (instant UI) and then persist through the adapter. A failed write raises a visible toast; nothing fails silently.
- **Domain logic is pure** (`src/lib/*`): the timer, the next-action rules and backup validation take plain data and a `now` value, so they are deterministic in tests.
- If IndexedDB cannot be opened (private browsing in some browsers, sandboxed frames), ORBIT switches to the memory adapter and shows a persistent banner saying changes will not be kept.

### Data model

Every stored record has `id` (random string), `createdAt` and `updatedAt` (epoch ms). Deletions are recorded in a `tombstones` table. Those three things — stable ids, update stamps and tombstones — are what a future sync engine needs to merge changes from two devices, so sync can be added as a new adapter without touching the UI.

| Table | Key fields | Notes |
|---|---|---|
| `projects` | name, color, icon, description, groupId, x, y, archived | x/y is the system's position **relative to its galaxy** (or to deep space when groupId is null) |
| `groups` | name, color, x, y | Galaxies; x/y is the galaxy centre in universe coordinates |
| `tasks` | projectId, title, notes, status (`todo` / `parked` / `done`), priority 1–4, due (YYYY-MM-DD), estimateMin, energy, progress, subtasks[], dependsOn[], links[], completedAt, parkedAt | "Active" is derived, never stored: a task is active when the focus runtime points at it |
| `checkpoints` | taskId, doing, stoppedAt, nextAction, notes, links[], timer snapshot, resumedAt | One per park; history kept |
| `sessions` | taskId (nullable), kind (focus / short-break / long-break), mode (countdown / flow), plannedMs, startedAt, endedAt, activeMs, notes, distractions, endReason | Actual effort per task is the sum of its focus sessions |
| `captures` | text, kind (thought / task), source (quick / focus / voice), status (inbox / sorted / dismissed), contextTaskId, sortedTaskId | The visual inbox |
| `dayItems` | date, taskId, slot (morning / afternoon / evening / later), order, start (HH:MM, optional) | Day Board placements |
| `placements` | x, y | Hosted only: where the person put a host galaxy (id `g\|<galaxy id>`) or system (id `<verse id>\|<system id>`) |
| `taskWork` | parked, parkedAt, energy, estimateMin, progress, subtasks, dependsOn, links | Hosted only: ORBIT's working state for a host's task (id = the host's task id) |
| `kv` | `prefs`, `focus` (runtime), `meta` | Single-row records |
| `tombstones` | table, deletedAt | Sync-ready deletion log |

**Focus runtime** (`kv.focus`) holds the only live session: `sessionId, taskId, kind, mode, plannedMs, baseMs, accumulatedMs, runningSince, finishedAt`. Because there is exactly one key, "only one active focus session" is enforced by the data shape rather than by convention.

**Timer maths** is timestamp-based and never counts ticks:

```
elapsed   = baseMs + accumulatedMs + (runningSince ? now − runningSince : 0)
remaining = plannedMs − elapsed      (countdown only; negative = overtime)
```

`baseMs` is time carried over from a checkpoint when a parked task resumes "where it left off"; it shows on the clock but is not double-counted in the new session's `activeMs`. Reloading the page, sleeping the laptop or backgrounding the tab cannot drift the clock.

### Migrations

Dexie versions are declared in `src/data/db.ts`. Version 1 is the original schema; version 2 adds the `tombstones` table and a compound `[date+slot]` index and normalises older task records (missing arrays, missing energy); version 3 turns the flat map into galaxies — groups get centres, project positions become relative to their galaxy (each group's arrangement is kept and spread out), and `prefs.deepSpace` records where ungrouped projects live; version 4 moves galaxies that were still on the old automatic grid onto the spiral (oldest at the centre), leaving any galaxy the user had dragged exactly where it was, and re-places deep space if it was auto-placed. Project positions are relative, so no system moves within its galaxy. Version 5 adds the empty `placements` and `taskWork` tables (backups at schema 5 gain both, empty). Each version's `upgrade()` runs once, in order. The v3 and v4 upgrades were each verified by running the v0.1 build with real-looking data in a persistent browser profile, then swapping in the new build on the same origin (service worker auto-update included). Backups carry `schemaVersion`, and `migrateBackup()` brings older backup files forward before validation. A test opens a real v1 database, writes v1 records, reopens at the current version and checks the upgrade.

### Backup and restore

- Export: one JSON file with every table plus `app`, `schemaVersion` and `exportedAt`. Where downloads are blocked (sandboxed previews), the same JSON is offered via Copy.
- Import: file picker or paste → `validateBackup()` checks shape, types and references, and reports counts before anything is written. Restore replaces all data in a single transaction, so a failed restore leaves existing data untouched.
- The UI states plainly that data lives in this browser on this device only.

---

## 2. Responsive component hierarchy

```
App
├── AppShell
│   ├── NavRail                (≥ md)  views + shortcuts hints
│   ├── TopBar                 search, capture, Next, offline / storage state
│   ├── <View>                 one of:
│   │   ├── UniverseView
│   │   │   ├── UniverseCanvas (≥ md)  semantic zoom: universe → galaxies → star systems → planets
│   │   │   │   ├── SpacePainter        canvas: parallax star field, spiral galaxies, orbits, planet dots, dependency arrows
│   │   │   │   ├── GalaxyLabel / StarNode / PlanetNode   interactive, screen-space HTML nodes per level of detail
│   │   │   │   └── Breadcrumbs, Minimap, Filters, Legend, zoom controls
│   │   │   └── UniverseCards  (< md)  card grid → project sheet with large rows
│   │   ├── DayBoard           four slots + unplanned tray (columns ≥ lg, stacked list < lg)
│   │   ├── FocusView          timer ring, presets, controls, distraction capture, notes, history
│   │   ├── InboxView          capture cards, sort to project / today, dismiss
│   │   ├── NextView           context controls (time, energy), ranked suggestions with reasons
│   │   ├── InsightsView       progress rings, completed work, focus trend, estimate vs actual, history
│   │   └── SettingsView       theme, motion, sound, notifications, focus defaults, backup/restore
│   ├── DetailPanel            right panel (≥ xl push, md–xl overlay, < md full-height sheet)
│   │   ├── TaskPanel          fields, subtasks, dependencies, links, checkpoints, sessions
│   │   ├── ProjectPanel       fields, galaxy, task list, quick add
│   │   └── GalaxyPanel        name, colour, systems, add a project, delete (projects drift to deep space)
│   ├── Dock                   (≥ md) bottom strip: active task, parked tasks, capture, next
│   ├── MobileDock + TabBar    (< md) mini-player strip (swipe through parked), bottom sheet, tab bar
│   └── Overlays               CaptureDialog, ParkSheet, ResumeCard, SearchPalette, ShortcutsHelp, Confirm, Toasts
```

Breakpoints: `< md` (phones) get purpose-built patterns — card Universe, mini-player dock with swipe, bottom sheets, a tab bar with a central capture button and 44 px+ targets. `md–lg` (tablets) keep the spatial canvas with pinch and pan, overlay panels and touch-sized controls. `≥ lg` adds the full desktop strip dock, side-by-side panels and keyboard shortcuts.

---

## 3. Navigation and interaction design

**Views** are routed by plain hash names (`#universe`, `#today`, `#focus`, `#inbox`, `#next`, `#insights`, `#settings`) so each view can be bookmarked and back/forward works.

**Core loop** (the vertical slice):

1. *Create project* — Universe "New project" (or empty-state form). It lands at a free spot near the centre of the view.
2. *Create task* — project panel quick-add (Enter adds and keeps focus for the next), Capture with `#project`, or the Universe node's "+".
3. *View in Universe* — the project node shows a progress ring and counts; open it and its tasks orbit it, sized by estimate, outlined by urgency, badged by priority.
4. *Start focus* — from the task panel, the task node, the Next list or the dock. Preset or custom length, or Flow (count-up).
5. *Park* — `P`, dock, focus view or task panel. The park sheet opens with the cursor in "Where I stopped"; Enter parks. "Next action" and "More detail" (what I was doing, notes, links) are optional. Timer state is captured automatically.
6. *Switch* — clicking a parked task in the dock resumes it in one interaction: the current task is parked automatically with its timer state, and a toast offers "Add a note" to the auto-checkpoint.
7. *Resume* — a resume card shows where you stopped, the next action (large), notes and links, with "Continue timer (12:34 left)", "Start fresh" or "Just open".
8. *Complete* — dock, focus view or task panel. Ends the session, records actual time and offers the next suggestion.

**Timer finishing** never stops work: the ring turns amber and counts overtime, with a chime and notification if enabled, and three choices — keep going, take a break, or stop.

**Universe navigation**: the level (universe, galaxy, system) follows what fills the view, not just the zoom. Clicking a galaxy or star flies there (log-space zoom interpolation, instant with reduced motion); clicking a star you are already in opens its details; Esc closes a panel first, then goes up one level; `[` / `]` step through siblings; the breadcrumb segments and their menus jump anywhere; the minimap flies to a galaxy. The camera stays locked on the target when panels open or the toolbar wraps, and the last view is restored on reload. The Universe is always drawn as night sky, in either theme.

**Galaxy layout and moving stars**: galaxy centres come from an Archimedean spiral (`spiralSlot` in `src/data/layout.ts`), spaced about one galaxy apart along the arm with a slight wobble so it never reads as rows; a new galaxy takes the first slot clear of every existing galaxy and of deep space, and "Tidy galaxies into a spiral" re-lays them all by age (undoable). Dragging a star works in world coordinates with a grab offset, so the star stays under the pointer while the view auto-pans near the edges. On release over another galaxy (the catch area reaches 30% past the disk, so a galaxy's name counts), the project changes galaxy and settles at the nearest free spot inside the disk; inside its own galaxy it is simply repositioned; anywhere else it snaps back with a hint. Window-level listeners own the drag, so it survives the view changing level mid-drag; Esc cancels. At universe zoom, invisible 24 px handles sit over each star so they can be clicked (fly in) or dragged without zooming in.

**Keyboard** (ignored while typing): `1–7` views, `C` capture, `/` search, `P` park active, `R` resume last parked, `Space` pause/resume focus, `X` complete active, `Esc` close, `?` help. Universe: arrows pan, `+` / `−` zoom, `0` fit.

**Progressive disclosure**: optional fields (time blocks, links, dependencies, park detail) stay collapsed until asked for; the Universe shows labels only at readable zoom.

---

## Host hook (running inside another application)

ORBIT can be embedded, in a same-origin frame, by a host application that owns some of the records it shows. The contract is `src/host/PROTOCOL.md` and `src/host/host-protocol-v1.schema.json`. Without a host nothing changes.

- **Finding a host** (`src/host/detect.ts`): `window.orbitHost`, else the parent frame's; the handshake must say protocol 1, otherwise ORBIT says why on screen and runs on its own, in memory. `?orbit-host=demo` installs the built-in demo host (`fakeHost.ts`), used by tests.
- **Records** (`adapt.ts`): host galaxies, systems and task planets become groups, projects and tasks carrying an in-memory `host` reference (`HostRef`); ids are the host's. Planets of type `item` become `ItemPlanet`s, kept by system in `extras.items` — never in `tasks`, so focus, parking, the day plan, Next, Insights, capture, dependencies, search and every task count cannot see them (and `startFocus`/`parkTask`/`planTask` ignore any id that is not a task). Attachments (moons), collections (belts), beacons, clusters, families and arrows live in the store's `host` slice. Positions come from `placements`, else deterministic auto-placement; a galaxy without a placement keeps the place it has on screen.
- **Several verses** (`verses.ts`, the store): the WORK verse (`workVerseOf`: first offered editable verse, else the start verse) is in `groups`/`projects`/`tasks` and the top level of the `host` slice (`verseId`, `rev`, extras) and is always loaded and refreshed. Another verse on screen is `host.sky` (`SkyVerse`: its groups, projects, items and extras, no tasks, no personal records); `host.shown` names the verse on screen. `showVerse(id, landing)` switches (payloads cached in memory per verse, then refreshed with `since`) and lands with `resolveLanding` (object → system → galaxy → whole verse); `followWormhole(also)` is the same with a toast when the target is missing; `select()` of a task (or any work-verse record) while another verse shows brings the work verse back. `verseSwitch` tells the canvas just before the sky changes (the crossfade copies the old sky's pixels and fades them out). Placements of another verse's systems (`<verse>|<id>`) and of shared galaxies (`g|<id>`) are written as before. Panels and the Universe read the verse on screen through `src/store/shown.ts`.
- **Storage**: hosted, ORBIT never opens IndexedDB or touches localStorage; it uses `host.store` (a StorageAdapter) for what is its own: positions and preferences always, working state when the host keeps it, and its own galaxies, projects and tasks with `caps.personal`. Every write goes through `createRecordWriter` (`writer.ts`), which never stores a host record: a host galaxy or system becomes a placement; a host task is split (`work.ts`) into the fields the host owns, sent to `host.tasks`, and ORBIT's working state for it, written to `taskWork`.
- **Changing host tasks** (`writer.ts`): field-level `update` patches (only what the change touched and the host does not already have), `setStatus` (todo/done/dropped, with an optional reason), `create` under a temporary id that is then repointed everywhere, `remove` with a reason, `detach`. Calls for one task are serialised; the host's returned task is authoritative; a rejection undoes exactly the refused fields on screen (unless a newer change to the field is waiting) and toasts the host's reason. Deleting cleans up checkpoints, day items and working state only after the host accepts. A refresh waits for pending calls, and keeps a task with a change still in flight as it is on screen.
- **What may change** (`caps.ts`): the host's capabilities, limited by what the build supports (`BUILD_SUPPORTS`: write, work, personal and adopt), then each record's `caps` through `may()`; `mayWork()` for focus, parking and the day plan. Store actions that are not allowed are no-ops with a toast naming the host (and a way to open the record there); controls are hidden. Host galaxies and systems only ever change position here.
- **Working state** (`work.ts`): ORBIT's `todo` and `parked` are both the host's `todo`; the parked flag in `taskWork` applies only while the host says todo, and is cleared when the host says done.
- **Personal records** (`caps.personal`): ORBIT's own galaxies, projects and tasks live beside the host's, stored in `host.store`'s `groups`, `projects` and `tasks`. A galaxy is one kind or the other; tasks and systems do not cross (refused with a hint). Host galaxies are auto-placed around ORBIT's own; deep space holds both kinds. A hosted backup (`snapshot()`) is ORBIT's part only; restore and erase go through `personalOnly()` and one `store.replaceAll()`, then a full verse. The example workspace is never offered while hosted.
- **Adopt** (`adoptProject` in the store, `host.adopt`): "Move to <host>…" on a personal system; the host's map of old → new ids drives `taskWork` rows under the new ids and the same `repoint()` used for temporary ids; the personal copies (and the system, once empty) are removed; nothing changes when the host cancels or throws.
- **Start** (`startVerse`, `host.at`): a hidden verse is never opened first; `host.at` selects a planet or flies into a system or galaxy once the first verse is on screen.
- **Refresh** (`refresh.ts`): `handshake()` then `verse(id, rev)` on focus, when the page becomes visible and every 30 s while visible; "unchanged" changes nothing. A `locked` handshake shows a banner and pauses changes to host records.
- **Demo hosts** (`fakeHost.ts`, `demoVerses.ts`, via `detect.ts`): four verses on the same galaxies — `main` "Everything" (tasks), `map` "Map" (each galaxy's plans as items, portals to the others), `things` "Things" (families as systems, sized and ringed items with moons, made-from arrows, a ghost, a system of 46+ items), `notes` "Notes" (notes with changed moons, dates, and a "New notebook…" action the demo answers) — with `also` both ways. `?orbit-host=demo` is editable (write, work, pick; refusals with `&refuse=`, a lock with `&locked=`; its records and store last for the tab in the demo host's own sessionStorage); `?orbit-host=demo-readonly` has every capability false.
- **Sky**: survey rings and chips on host galaxies, clusters outlined and named, beacons (collapsed to "n dates" when crowded), moons, belts (rocks in family colours, a worded summary that opens the system's list), and a ring of dots for host systems with more than 40 open tasks or items; three layer switches kept in `prefs.layers`. Item planets (`ItemNode`) are drawn after a system's tasks on the same orbits (slot `tasks.length + j`), in family colours, sized and ringed by the host. A verse's arrows (`arrows.ts`) are thin solid curves between planets drawn one by one in view, labelled when an end is selected or hovered. Portals (`PortalNode`) are violet swirls with a chip into the other verse. The verse switcher (`VerseBar`) shows only with several offered verses. Words in the sky are laid out per frame (`labels.ts`, `skyLabels.ts`, `galaxyLabels.ts`): planet names go outward, never cover each other, a planet or a system's name, and those that find no room show on hover; at the whole universe a galaxy's name and counts go under, above or beside it (or shorten to the name) so they never cover another's.
- **Panels**: `ItemPanel` (read-only: title, sub, family, state, note, facts, moons, wormholes, open in the host; a ghost shows only its way home), `Wormholes` sections on task, item, system and galaxy panels, the host's actions in a system's or galaxy's "…" menu, a portal's "go through" button, and a searchable list of a system's items.

---

## 4. Phased implementation plan

| Phase | Scope | Status |
|---|---|---|
| 0 | Architecture, data model, scaffold, theme tokens, PWA shell | Done in v0.1 |
| 1 | Vertical slice: projects, tasks, Universe, focus timer, park, resume, complete, dock | Done in v0.1 |
| 2 | Day Board, Quick Capture + Inbox (with voice where supported), Smart Next Action | Done in v0.1 |
| 3 | Insights, settings, backup/restore, light mode, reduced motion, mobile patterns | Done in v0.1 |
| 4 | Hardening from daily use: recurring tasks, project templates, richer dependency view, attachments as files (stored as blobs), Universe minimap | Next |
| 5 | Optional sync: an authenticated `SyncAdapter` that pushes/pulls changed records by `updatedAt` and tombstones; explicit "this device / synced" status in the UI | Later, only if wanted |

---

## 5. Testing strategy

| Layer | Tool | What is covered |
|---|---|---|
| Pure logic | Vitest | Timer maths (start, pause, resume, overtime, carry-over, clock skew), next-action rules and their explanations, date helpers, backup validation and migration |
| Persistence | Vitest + fake-indexeddb | Round-trip of every table, v1 → current, v2 → v3, v3 → v4 and v4 → v5 schema upgrades (hand-placed galaxies kept), v2/v3/v4 backup migration, restore is all-or-nothing |
| Several verses | Vitest + ajv | The four demo verses against the schema; items never reach tasks, Next, Insights, parking, focus, the day plan or counts; item adaptation (size, ring, state, ghost, moons); arrows (drawn list, skipped ends, never blocked); switching (cache, since, camera, selection, the work verse live behind another, no personal galaxy elsewhere, refresh of the shown verse only), `shown: false`, placements in another verse; wormhole landing and fallbacks; portals; actions; `at.verse`; galaxy names never colliding; errors from another realm |
| Host hook | Vitest + ajv | The demo hosts against the JSON Schema; verse adaptation, detection and refusal, every read-only guard, host records never stored, refresh and its schedule, the sky's host layers and clutter rules; editing host tasks path by path (field split, only changed fields, create and repointing, every refusal undone, queued changes, multi-record actions, parked overlay, lock and re-handshake, working state in the host's store, capture sorting, moves, detach and pick) |
| Store transitions | Vitest | Create → focus → park → resume → complete; one active session only; switching auto-parks; deleting a project cascades; capture sorting |
| End to end | Playwright (Chrome) | The full vertical slice at desktop and phone sizes, reload persistence mid-session, Day Board drag, backup export/import, universe navigation, dragging a star to another galaxy (Esc cancel, undo, persists on reload), tidy into a spiral; hosted (read-only demo host, a host on the parent frame, a refused host; editable demo host: edit, complete with Undo, a refusal undone, delete with a reason, park → reload → resume, the lock banner); several verses (switch and stay in the galaxy, an item panel and a wormhole there and back, a portal chip, the focus timer across a switch, a verse action, no switcher standalone) |
| Visual | Playwright screenshots | Every view in dark and light, desktop and phone, reviewed by eye before release |

Run `npm test` for unit tests and `npm run e2e` for end-to-end tests (needs a local Chrome).
