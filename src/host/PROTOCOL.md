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
  /** Where ORBIT keeps what is its own (positions, preferences, later working state and personal records).
      Same shape as ORBIT's StorageAdapter. */
  store: StorageAdapter;
  /** Changes to host-owned tasks. A refusal rejects with an Error whose message is the reason shown. */
  tasks?: {
    create(fields: TaskFields & { system: string }): Promise<Planet>;
    update(id: string, patch: Partial<TaskFields> & { system?: string }): Promise<Planet>;
    setStatus(id: string, status: 'todo' | 'done' | 'dropped'): Promise<Planet>;
    remove(id: string, reason: string): Promise<void>;
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
- **Refresh.** ORBIT asks `verse(id, rev)` when its page gains focus or becomes visible, and every 30 seconds
  while visible.
- **Positions.** Where a host galaxy or system sits is ORBIT's to remember: table `placements` in `store`,
  keyed `g|<galaxy id>` for a galaxy (shared by every verse) and `<verse id>|<system id>` for a system.
- **Kinds and families** are the host's strings. A family has a label and a colour; ORBIT knows nothing else
  about them.
- **Tasks and items.** A planet of type `task` behaves like any ORBIT task. A planet of type `item` is a record
  shown as a planet: it never enters focus, parking, Today, Next, Insights or task search, and is never counted
  as a task.
