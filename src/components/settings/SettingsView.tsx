import { useRef, useState, useSyncExternalStore } from 'react';
import { Bell, Coffee, Copy, Download, FolderOpen, HardDrive, Info, Keyboard, MonitorSmartphone, Palette, Sparkles, Timer, Trash2, Upload, Volume2 } from 'lucide-react';
import { APP_VERSION, SUPPORT_URL, desktop, isFileCopy } from '../../lib/desktop';
import { useOrbit } from '../../store/store';
import type { Prefs } from '../../types';
import { createBackup, parseBackupText, type ValidationResult } from '../../lib/backup';
import {
  canInstall,
  copyText,
  downloadText,
  isStandalone,
  notificationPermission,
  onInstallChange,
  playChime,
  promptInstall,
  requestNotifications,
} from '../../lib/platform';
import { Button, Field, Select, Segmented, Textarea, Toggle, cx } from '../ui/primitives';
import { plural } from '../../lib/util';

export function SettingsView() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-5 px-4 py-5 md:px-8 md:py-8">
        <Appearance />
        <FocusPrefs />
        <Alerts />
        <DataSection />
        <InstallSection />
        <About />
      </div>
    </div>
  );
}

function Section({ icon, title, children, desc }: { icon: React.ReactNode; title: string; desc?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-ink">{icon}</span>
        <div>
          <h2 className="font-display text-[17px] font-semibold">{title}</h2>
          {desc && <p className="mt-0.5 text-sm text-muted">{desc}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function usePrefs() {
  const prefs = useOrbit((s) => s.prefs);
  const setPrefs = useOrbit((s) => s.setPrefs);
  return [prefs, setPrefs] as const;
}

function Appearance() {
  const [prefs, set] = usePrefs();
  return (
    <Section icon={<Palette size={18} />} title="Appearance">
      <div className="flex flex-wrap gap-6">
        <Field group label="Theme">
          <Segmented<Prefs['theme']>
            label="Theme"
            value={prefs.theme}
            onChange={(theme) => set({ theme })}
            options={[
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
              { value: 'system', label: 'System' },
            ]}
          />
        </Field>
        <Field group label="Motion">
          <Segmented<Prefs['motion']>
            label="Motion"
            value={prefs.motion}
            onChange={(motion) => set({ motion })}
            options={[
              { value: 'system', label: 'Follow system' },
              { value: 'reduce', label: 'Reduced' },
              { value: 'full', label: 'Full' },
            ]}
          />
        </Field>
      </div>
    </Section>
  );
}

function MinutesSelect({ value, onChange, options, label }: { value: number; onChange: (v: number) => void; options: number[]; label: string }) {
  return (
    <Field label={label}>
      <Select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {options.map((m) => (
          <option key={m} value={m}>
            {m} min
          </option>
        ))}
      </Select>
    </Field>
  );
}

function FocusPrefs() {
  const [prefs, set] = usePrefs();
  return (
    <Section icon={<Timer size={18} />} title="Focus" desc="Defaults for new sessions. You can always pick a different length when starting.">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MinutesSelect label="Focus length" value={prefs.focusMin} onChange={(focusMin) => set({ focusMin })} options={[10, 15, 20, 25, 30, 45, 50, 60, 90]} />
        <MinutesSelect label="Short break" value={prefs.shortBreakMin} onChange={(shortBreakMin) => set({ shortBreakMin })} options={[3, 5, 10, 15]} />
        <MinutesSelect label="Long break" value={prefs.longBreakMin} onChange={(longBreakMin) => set({ longBreakMin })} options={[10, 15, 20, 30]} />
        <Field label="Long break every">
          <Select value={prefs.longBreakEvery} onChange={(e) => set({ longBreakEvery: Number(e.target.value) })}>
            {[2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n} sessions
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Section>
  );
}

function Alerts() {
  const [prefs, set] = usePrefs();
  const [perm, setPerm] = useState(() => notificationPermission());
  const [soundMsg, setSoundMsg] = useState<string | null>(null);
  const enableNotifications = async (on: boolean) => {
    if (!on) return set({ notifications: false });
    const p = await requestNotifications();
    setPerm(p);
    set({ notifications: p === 'granted' });
  };
  return (
    <Section icon={<Bell size={18} />} title="Sound and notifications" desc="Used only when a timer finishes. Off by default for notifications.">
      <Toggle label="Chime when a timer finishes" description="A soft two-note chime, generated on this device." checked={prefs.sound} onChange={(sound) => set({ sound })} />
      <div className="mb-2 flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          icon={<Volume2 size={14} />}
          onClick={() => {
            const ok = playChime('test');
            setSoundMsg(ok ? null : 'Sound is not available in this browser context.');
          }}
        >
          Test sound
        </Button>
        {soundMsg && <span className="text-xs text-danger">{soundMsg}</span>}
      </div>
      <div className="border-t border-line pt-2">
        <Toggle
          label="System notification when a timer finishes"
          checked={prefs.notifications && perm === 'granted'}
          onChange={(v) => void enableNotifications(v)}
          description={
            perm === 'unsupported'
              ? 'This browser does not support notifications here.'
              : perm === 'denied'
                ? 'Notifications are blocked for this site. Allow them in your browser’s site settings, then switch this on.'
                : 'Your browser will ask for permission the first time.'
          }
        />
      </div>
    </Section>
  );
}

function DataSection() {
  const p = useOrbit((s) => s.projects.length);
  const t = useOrbit((s) => s.tasks.length);
  const nCheckpoints = useOrbit((s) => s.checkpoints.length);
  const nSessions = useOrbit((s) => s.sessions.length);
  const hasExample = useOrbit((s) => s.projects.some((x) => x.example) || s.tasks.some((x) => x.example) || s.captures.some((x) => x.example));
  const storageKind = useOrbit((s) => s.storageKind);
  const { snapshot, restore, toast, confirm, loadExample, removeExample, resetAll } = useOrbit.getActions();
  const [manualJson, setManualJson] = useState<string | null>(null);
  const [paste, setPaste] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const json = () => JSON.stringify(createBackup(snapshot()), null, 2);
  const filename = () => `orbit-backup-${new Date().toISOString().slice(0, 10)}.json`;

  const doExport = () => {
    const text = json();
    if (!downloadText(filename(), text)) setManualJson(text);
    else toast({ tone: 'success', text: 'Backup downloaded. Keep it somewhere safe.' });
  };
  const doCopy = async () => {
    const text = json();
    if (await copyText(text)) toast({ tone: 'success', text: 'Backup copied. Paste it into a file to keep it.' });
    else setManualJson(text);
  };
  const readFile = async (f: File | undefined) => {
    if (!f) return;
    setResult(parseBackupText(await f.text()));
    if (fileRef.current) fileRef.current.value = '';
  };
  const applyRestore = () => {
    if (!result?.ok || !result.data) return;
    const d = result.data;
    confirm({
      title: 'Replace all data with this backup?',
      body: `Everything currently in ORBIT on this device (${p} projects, ${t} tasks) will be replaced by the backup (${result.counts?.projects} projects, ${result.counts?.tasks} tasks). If anything goes wrong, your current data is left untouched.`,
      confirmLabel: 'Replace and restore',
      danger: true,
      onConfirm: async () => {
        setBusy(true);
        try {
          await restore(d);
          setResult(null);
          setPaste('');
          setPasteOpen(false);
          toast({ tone: 'success', text: 'Backup restored.' });
        } catch (e) {
          toast({ tone: 'danger', text: `Restore failed, nothing was changed. ${e instanceof Error ? e.message : ''}` });
        } finally {
          setBusy(false);
        }
      },
    });
  };

  return (
    <Section
      icon={<HardDrive size={18} />}
      title="Your data"
      desc={
        <>
          Stored {storageKind === 'indexeddb' ? 'in this browser' : <strong className="text-amber">only in this tab (browser storage is unavailable)</strong>} on this device. Nothing is uploaded, and other devices or browsers will not see it. Back up regularly.
        </>
      }
    >
      <p className="tabular mb-4 text-sm text-muted">
        {plural(p, 'project')} · {plural(t, 'task')} · {plural(nCheckpoints, 'checkpoint')} · {plural(nSessions, 'focus session')}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" icon={<Download size={15} />} onClick={doExport}>
          Download backup
        </Button>
        <Button variant="secondary" icon={<Copy size={15} />} onClick={() => void doCopy()}>
          Copy backup
        </Button>
        <Button variant="secondary" icon={<Upload size={15} />} onClick={() => fileRef.current?.click()}>
          Restore from file
        </Button>
        <Button variant="ghost" onClick={() => setPasteOpen((x) => !x)} aria-expanded={pasteOpen}>
          Paste a backup
        </Button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void readFile(e.target.files?.[0])} aria-label="Choose a backup file" />
      </div>

      {manualJson && (
        <div className="mt-4 rounded-xl border border-amber/40 bg-amber-soft p-3">
          <p className="mb-2 text-sm">This browser context blocked the download. Select all of the text below and copy it into a file named <code className="text-xs">{filename()}</code>.</p>
          <Textarea readOnly value={manualJson} rows={6} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" aria-label="Backup JSON" />
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => setManualJson(null)}>
            Close
          </Button>
        </div>
      )}

      {pasteOpen && (
        <div className="mt-4 space-y-2">
          <Textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={5} placeholder='Paste the contents of an ORBIT backup ({"app":"orbit", …})' className="font-mono text-xs" aria-label="Backup text" />
          <Button size="sm" variant="secondary" disabled={!paste.trim()} onClick={() => setResult(parseBackupText(paste))}>
            Check backup
          </Button>
        </div>
      )}

      {result && (
        <div className={cx('mt-4 rounded-xl border p-3 text-sm', result.ok ? 'border-teal/40 bg-teal-soft' : 'border-danger/40 bg-danger-soft')} role="status">
          {result.ok ? (
            <>
              <p className="font-medium">Backup looks good.</p>
              <p className="tabular mt-1 text-muted">
                {result.counts?.projects} projects · {result.counts?.tasks} tasks · {result.counts?.checkpoints} checkpoints · {result.counts?.sessions} sessions · {result.counts?.captures} captures
              </p>
              {result.warnings.map((w) => (
                <p key={w} className="mt-1 text-amber">
                  {w}
                </p>
              ))}
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="danger" onClick={applyRestore} disabled={busy}>
                  Replace all data with this backup
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setResult(null)}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="font-medium text-danger">This backup cannot be restored.</p>
              {result.errors.map((e) => (
                <p key={e} className="mt-1">
                  {e}
                </p>
              ))}
            </>
          )}
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
        {hasExample ? (
          <Button variant="secondary" icon={<Sparkles size={15} />} onClick={() => void removeExample()}>
            Remove example data
          </Button>
        ) : (
          <Button variant="ghost" icon={<Sparkles size={15} />} onClick={() => void loadExample()}>
            Load example workspace
          </Button>
        )}
        <Button
          variant="danger"
          icon={<Trash2 size={15} />}
          onClick={() =>
            confirm({
              title: 'Erase everything?',
              body: 'All projects, tasks, checkpoints, sessions, captures and plans on this device will be deleted. Download a backup first if you might want them back.',
              confirmLabel: 'Erase all data',
              danger: true,
              onConfirm: () => void resetAll(),
            })
          }
        >
          Erase all data
        </Button>
      </div>
    </Section>
  );
}

function InstallSection() {
  const installable = useSyncExternalStore(onInstallChange, canInstall, () => false);
  const standalone = isStandalone();
  if (desktop) {
    return (
      <Section icon={<MonitorSmartphone size={18} />} title="Desktop app" desc="You are using the ORBIT desktop app. Everything stays on this computer and works offline.">
        <p className="text-sm text-muted">
          Your data is kept in <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-text">{desktop.dataPath}</code>. The installed and portable versions share it, so you can switch between them. To move ORBIT to another computer, use Back up above and Restore there.
        </p>
        <Button className="mt-3" size="sm" variant="secondary" onClick={() => void desktop!.openDataFolder()}>
          <FolderOpen size={15} /> Open data folder
        </Button>
      </Section>
    );
  }
  if (isFileCopy) {
    return (
      <Section icon={<MonitorSmartphone size={18} />} title="Single-file edition" desc="This copy of ORBIT runs straight from a file and works offline.">
        <p className="text-sm text-muted">
          Your data is kept by this browser, not in the file itself: open the file in the same browser each time, and use Back up above to keep a copy or move to another computer. Chrome and Edge work best.
        </p>
      </Section>
    );
  }
  return (
    <Section icon={<MonitorSmartphone size={18} />} title="Install ORBIT" desc="Installed, ORBIT opens in its own window and works fully offline.">
      {standalone ? (
        <p className="text-sm text-teal">ORBIT is running as an installed app.</p>
      ) : installable ? (
        <Button variant="primary" onClick={() => void promptInstall()}>
          Install ORBIT
        </Button>
      ) : (
        <p className="text-sm text-muted">
          Use your browser’s <strong className="font-medium text-text">Install app</strong> option (desktop Chrome or Edge: the icon in the address bar) or <strong className="font-medium text-text">Add to Home Screen</strong> (iOS Safari: Share menu). Installation needs ORBIT to be served from its own web address, not inside a preview frame.
        </p>
      )}
    </Section>
  );
}

function About() {
  const setHelpOpen = useOrbit((s) => s.setHelpOpen);
  return (
    <Section icon={<Info size={18} />} title="About">
      <p className="text-sm text-text">
        ORBIT {APP_VERSION} · created by Dr Mark Isaacs
      </p>
      <p className="mt-1 text-sm text-muted">Free and MIT licensed. Local-first: no account, no tracking, no AI service.</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <a
          href={SUPPORT_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-amber-soft px-3 text-[13px] font-medium text-amber outline-none transition-[background,color] hover:bg-amber hover:text-[#2a1a00] focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Coffee size={15} /> Buy me a coffee
        </a>
        <Button size="sm" variant="secondary" onClick={() => setHelpOpen(true)}>
          <Keyboard size={15} /> Keyboard shortcuts
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted">If ORBIT helps you start your day, a coffee keeps it going.</p>
    </Section>
  );
}
