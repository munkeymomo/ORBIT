import { Coffee } from 'lucide-react';
import { APP_VERSION, SUPPORT_URL } from '../../lib/desktop';
import { useOrbit } from '../../store/store';
import { Kbd, Modal } from '../ui/primitives';

const GROUPS: { title: string; rows: [string[], string][] }[] = [
  {
    title: 'Anywhere',
    rows: [
      [['C'], 'Capture a task or thought'],
      [['/'], 'Search'],
      [['⌘', 'K'], 'Search'],
      [['1', '–', '7'], 'Switch view'],
      [['?'], 'This help'],
      [['Esc'], 'Close panel or dialog'],
    ],
  },
  {
    title: 'Focus and switching',
    rows: [
      [['Space'], 'Pause or resume the timer'],
      [['P'], 'Park the active task'],
      [['R'], 'Resume the most recently parked task'],
      [['X'], 'Complete the active task'],
      [['F'], 'Open Focus'],
      [['⌘', 'Enter'], 'Park immediately (in the park sheet)'],
    ],
  },
  {
    title: 'Universe',
    rows: [
      [['Esc'], 'Up a level (closes a panel first)'],
      [['[', ']'], 'Previous / next galaxy or system'],
      [['0'], 'Whole universe'],
      [['←', '↑', '→', '↓'], 'Pan'],
      [['+', '−'], 'Zoom'],
      [['Enter'], 'Open the focused project or task'],
    ],
  },
];

export function ShortcutsHelp() {
  const open = useOrbit((s) => s.helpOpen);
  const setOpen = useOrbit((s) => s.setHelpOpen);
  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Keyboard shortcuts" width="max-w-xl">
      <div className="grid gap-6 sm:grid-cols-2">
        {GROUPS.map((g) => (
          <section key={g.title} className={g.title === 'Universe' ? 'sm:col-span-2' : ''}>
            <h3 className="mb-2 text-xs font-semibold tracking-[0.08em] text-muted uppercase">{g.title}</h3>
            <ul className="space-y-1.5">
              {g.rows.map(([keys, label]) => (
                <li key={label + keys.join()} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-text">{label}</span>
                  <span className="flex gap-1">
                    {keys.map((k, i) => (k === '–' ? <span key={i} className="text-faint">–</span> : <Kbd key={i}>{k}</Kbd>))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className="mt-5 text-xs text-faint">Single-key shortcuts are ignored while you are typing in a field.</p>
      <p className="mt-3 flex flex-wrap items-center gap-x-2 border-t border-line pt-3 text-xs text-muted">
        <span>ORBIT {APP_VERSION} · created by Dr Mark Isaacs ·</span>
        <a href={SUPPORT_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-amber hover:underline">
          <Coffee size={13} /> Buy me a coffee
        </a>
      </p>
    </Modal>
  );
}
