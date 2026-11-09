# ORBIT

A visual, local-first productivity workspace for people juggling several projects at once.

Created by Dr Mark Isaacs · MIT licensed · ☕ [Buy me a coffee](https://ko-fi.com/markisaacschem)

- **Universe** – a zoomable map of your work: groups are **galaxies**, projects are **star systems**, tasks are **planets** sized by effort, coloured by priority, glowing when overdue or due soon. Click a galaxy or star to fly in; Esc flies back out; `[` / `]` jump to the previous / next; breadcrumbs and a minimap jump anywhere. Projects without a galaxy drift in deep space. New galaxies wind outwards along a spiral from the centre (oldest in the middle); **New → Tidy galaxies into a spiral** puts them back in that order after you have moved them around (undoable). Drag a star to rearrange it, or drop it onto another galaxy (or deep space) to move the project there, tasks and all; the target lights up, the view pans when you drag near the edge, and Esc cancels. Stars can be dragged straight from the whole-universe view. Drag a galaxy's name to move the galaxy. Phones get a card view with large touch targets (desktop is the focus for now).
- **Context Parking** – park a task with where you stopped, your next action, notes and links; the timer state is saved automatically. Switching tasks parks the current one for you.
- **Working Memory Dock** – what is in focus and what is parked, always one tap away. On phones it is a swipeable "now playing" strip with a bottom sheet.
- **Focus** – 15/25/45/60 min presets, custom lengths, flow (count-up), breaks, overtime instead of a forced stop, distraction capture to the Inbox, session notes and history. The timer is timestamp-based, so reloads and sleep do not drift it.
- **Today** – Morning / Afternoon / Evening / Later, drag-and-drop, planned effort and progress, optional time blocks.
- **Capture + Inbox** – `C` from anywhere; `#project` files a task directly, everything else lands in a visual Inbox to sort later (drag onto a project, or Sort). Voice capture appears where the browser provides speech recognition.
- **What next?** – transparent, rule-based suggestions with the points behind every reason. No AI service.
- **Insights** – focus time and completions per day, project progress, estimated vs actual, completion history. No streaks, no scores.

Everything is stored **on this device only**. There is no account and no server. Use **Settings → Your data** to download or copy a JSON backup and to restore one; a backup moves between every edition below.

## Get it

| Edition | How it runs | Where your data lives |
| --- | --- | --- |
| `ORBIT-Setup-<version>.exe` | Windows installer, per user, no admin rights | `%APPDATA%\ORBIT` |
| `ORBIT-<version>-Portable.exe` | One Windows exe, nothing installed (starts a few seconds slower: it unpacks itself) | `%APPDATA%\ORBIT` (shared with the installed app) |
| `ORBIT-<version>.html` | Single file, opens in any modern browser (Chrome or Edge recommended) | That browser |
| `dist/` on a web host | Installable web app (PWA), works offline | That browser |

The Windows builds are not code-signed yet, so SmartScreen may warn on first run: **More info → Run anyway**.

## Build a release

On Windows (the desktop builds need Windows for the icon and installer):

```bash
npm install
npm run release    # → release/sourceforge/<version>/: installer, portable exe, single-file HTML, README, SHA256SUMS
```

That runs `dist:win` (web build + electron-builder: NSIS installer and portable exe), `build:single` (one self-contained HTML file via vite-plugin-singlefile) and `scripts/make-release.mjs`, which gathers the files and writes checksums. Upload the whole `release/sourceforge/<version>` folder. `npm run desktop` runs the desktop app from the current build without packaging it.

The desktop app (`electron/`) serves the same `dist/` build from a fixed `orbit://app` origin, so its IndexedDB data survives updates; it skips the service worker, opens links in the default browser, remembers its window, allows one instance at a time, and only grants the notification, clipboard and fullscreen permissions. Ctrl+Shift+I opens developer tools.

## Run it from source

**Windows, quickest:** double-click `ORBIT.cmd`. It installs and builds on first run, then opens ORBIT at http://localhost:4173. Always use that same address — browser storage is per address, so a different port would look like an empty ORBIT.


```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
npm run preview    # serve the build at http://localhost:4173
npm run rebuild    # build again after changing the source (then reopen ORBIT.cmd)
```

## Install as an app (PWA)

Serve `dist/` from any static host over HTTPS (GitHub Pages, Netlify, Cloudflare Pages, or your own server). The build uses relative paths, so a sub-folder works. Then use the browser's **Install app** (desktop Chrome/Edge) or **Add to Home Screen** (iOS Safari). After the first load it works fully offline.

## Test

```bash
npm test           # unit tests (Vitest): timer, scoring, store transitions, IndexedDB, migrations, backup, write-ahead journal
npm run e2e        # end-to-end (Playwright, needs Chrome): vertical slice on desktop and phone, timer overtime, capture, backup, day board drag, universe navigation, moving a star between galaxies
npm run build && npm run build:single && npm run e2e:release
                   # release checks: the real desktop app (data kept between launches, fixed origin, links open outside)
                   # and the single-file edition opened from disk (on Linux, run under xvfb-run)
```

## Keyboard

`C` capture · `/` or `⌘K` search · `1–7` views · `Space` pause/resume · `P` park · `R` resume last parked · `X` complete · `F` focus · `?` help. Universe: click to fly in, `Esc` up a level, `[` `]` previous / next galaxy or system, `0` whole universe, arrows pan, `+`/`−` zoom, double-click to zoom in.

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the data model, component hierarchy, interaction design, phased plan and test strategy. In short: React + TypeScript + Vite + Tailwind; one Zustand store; all persistence behind a `StorageAdapter` (Dexie/IndexedDB, wrapped in a localStorage write-ahead journal so a tab closed mid-write loses nothing); every record carries `id`, `updatedAt` and deletions are tombstoned, so a sync adapter can be added later without touching the UI.

## Support and licence

ORBIT is free. If it helps you start your day, you can [buy me a coffee](https://ko-fi.com/markisaacschem).

MIT licence, © 2026 Dr Mark Isaacs. See [`LICENSE`](LICENSE).
