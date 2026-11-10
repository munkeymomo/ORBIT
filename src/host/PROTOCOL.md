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
  /** Where ORBIT keeps what is its own (positions, preferences, working state, later personal records).
      Same shape as ORBIT's StorageAdapter. */
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
  /** Anything else the host does in a dialog of its own. */
  action?(id: string, ctx: Record<string, string>): Promise<boolean>;
}
```

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
- **Positions.** Where a host galaxy or system sits is ORBIT's to remember: table `placements` in `store`,
  keyed `g|<galaxy id>` for a galaxy (shared by every verse) and `<verse id>|<system id>` for a system.
- **Kinds and families** are the host's strings. A family has a label and a colour; ORBIT knows nothing else
  about them.
- **Tasks and items.** A planet of type `task` behaves like any ORBIT task. A planet of type `item` is a record
  shown as a planet: it never enters focus, parking, Today, Next, Insights or task search, and is never counted
  as a task.

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
