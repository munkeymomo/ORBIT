import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Lightbulb, ListTodo, Mic, MicOff } from 'lucide-react';
import { useOrbit } from '../../store/store';
import type { DaySlot } from '../../types';
import { startVoice, voiceSupported } from '../../lib/platform';
import { SLOTS, toDateKey } from '../../lib/util';
import { Button, IconButton, Kbd, Modal, Segmented, cx } from '../ui/primitives';
import { ProjectChip } from '../ui/visuals';
import { useTakesTasks } from '../../host/useAbilities';

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Fast entry from anywhere. "#name" files a task straight into a project; otherwise it lands in the Inbox. */
export function CaptureDialog() {
  const open = useOrbit((s) => s.captureOpen);
  const setOpen = useOrbit((s) => s.setCaptureOpen);
  return open ? <Capture onClose={() => setOpen(false)} /> : null;
}

function Capture({ onClose }: { onClose: () => void }) {
  const takes = useTakesTasks();
  const allProjects = useOrbit((s) => s.projects);
  const projects = useMemo(() => allProjects.filter(takes), [allProjects, takes]);
  const { addCapture, createTask, planTask, toast } = useOrbit.getActions();
  const [text, setText] = useState('');
  const [kind, setKind] = useState<'task' | 'thought'>('task');
  const [slot, setSlot] = useState<DaySlot | null>(null);
  const [recent, setRecent] = useState<{ text: string; where: string }[]>([]);
  const [listening, setListening] = useState(false);
  const [voiceErr, setVoiceErr] = useState<string | null>(null);
  const stopVoice = useRef<(() => void) | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const canVoice = useMemo(() => voiceSupported(), []);

  useEffect(() => () => stopVoice.current?.(), []);

  // "#tag" anywhere in the text picks a project by name prefix.
  const tag = text.match(/(?:^|\s)#([^\s#]*)$/)?.[1] ?? text.match(/(?:^|\s)#([^\s#]+)/)?.[1] ?? null;
  const typingTag = /(?:^|\s)#([^\s#]*)$/.test(text);
  const tagMatches = tag != null ? projects.filter((p) => norm(p.name).startsWith(norm(tag))) : [];
  const project = tag && tagMatches.length ? tagMatches[0] : null;
  const clean = (s: string) => s.replace(/(?:^|\s)#[^\s#]*/g, ' ').replace(/\s+/g, ' ').trim();

  const submit = () => {
    const body = clean(text);
    if (!body) return;
    if (kind === 'task' && project) {
      const t = createTask({ projectId: project.id, title: body });
      if (slot) planTask(t.id, toDateKey(Date.now()), slot);
      setRecent((r) => [{ text: body, where: `${project.name}${slot ? ` · today, ${slot}` : ''}` }, ...r].slice(0, 5));
    } else {
      addCapture({ text: body, kind, source: listening ? 'voice' : 'quick' });
      setRecent((r) => [{ text: body, where: 'Inbox' }, ...r].slice(0, 5));
    }
    setText('');
    setSlot(null);
    input.current?.focus();
  };

  const finish = () => {
    if (clean(text)) submit();
    if (recent.length || clean(text)) toast({ tone: 'success', text: `Captured ${recent.length + (clean(text) ? 1 : 0)} item${recent.length + (clean(text) ? 1 : 0) === 1 ? '' : 's'}.` });
    onClose();
  };

  const toggleVoice = () => {
    if (listening) {
      stopVoice.current?.();
      return;
    }
    setVoiceErr(null);
    const before = text ? `${text.trim()} ` : '';
    stopVoice.current = startVoice({
      onText: (t) => setText(before + t),
      onError: (m) => setVoiceErr(m),
      onEnd: () => {
        setListening(false);
        stopVoice.current = null;
      },
    });
    setListening(!!stopVoice.current);
  };

  const pickProject = (name: string) => {
    const word = name.split(/\s+/)[0];
    setText((t) => t.replace(/(?:^|\s)#[^\s#]*$/, ` #${word} `).replace(/^\s+/, ''));
    input.current?.focus();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Capture"
      initialFocus={input}
      footer={
        <>
          <span className="mr-auto hidden items-center gap-1.5 text-xs text-faint sm:flex">
            <Kbd>Enter</Kbd> save & keep going · <Kbd>Esc</Kbd> close
          </span>
          <Button variant={recent.length ? 'secondary' : 'ghost'} onClick={finish}>
            Done
          </Button>
          <Button variant="primary" onClick={submit} disabled={!clean(text)}>
            {kind === 'task' && project ? `Add to ${project.name.length > 16 ? `${project.name.slice(0, 15)}…` : project.name}` : 'Save to Inbox'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Segmented
            label="Capture type"
            size="sm"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'task', label: <><ListTodo size={14} /> Task</> },
              { value: 'thought', label: <><Lightbulb size={14} /> Thought</> },
            ]}
          />
          {canVoice && (
            <IconButton label={listening ? 'Stop voice capture' : 'Capture by voice'} variant={listening ? 'danger' : 'secondary'} size="sm" onClick={toggleVoice}>
              {listening ? <MicOff size={16} /> : <Mic size={16} />}
            </IconButton>
          )}
        </div>
        <textarea
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          placeholder={kind === 'task' ? 'What needs doing? Add #project to file it directly' : 'What is on your mind?'}
          aria-label="Capture text"
          className="field-sizing-content max-h-48 min-h-[64px] w-full resize-none rounded-2xl border border-line bg-surface-2 px-4 py-3 text-[16px] leading-relaxed outline-none placeholder:text-faint focus:border-accent"
        />
        {listening && <p className="anim-pulse text-xs text-danger">Listening… speak now</p>}
        {voiceErr && <p className="text-xs text-danger">{voiceErr}</p>}

        {typingTag && (
          <div className="flex flex-wrap gap-1.5" aria-label="Matching projects">
            {(tag ? tagMatches : projects).slice(0, 6).map((p) => (
              <button key={p.id} onClick={() => pickProject(p.name)} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface-2 pr-3 pl-1 text-[13px] hover:border-line-strong">
                <ProjectChip color={p.color} icon={p.icon} size={22} />
                {p.name}
              </button>
            ))}
            {tag && !tagMatches.length && <span className="text-xs text-muted">No project starts with “{tag}” — it will go to the Inbox.</span>}
          </div>
        )}

        {kind === 'task' && project && !typingTag && (
          <div className="anim-fade flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
            <ProjectChip color={project.color} icon={project.icon} size={22} />
            <span>
              Goes straight into <strong className="font-semibold">{project.name}</strong>
            </span>
            <span className="flex-1" />
            <Segmented<DaySlot | 'none'>
              label="Plan for today"
              size="sm"
              value={slot ?? 'none'}
              onChange={(v) => setSlot(v === 'none' ? null : v)}
              options={[{ value: 'none', label: 'Not today' }, ...SLOTS.slice(0, 3).map((s) => ({ value: s.id, label: s.label, title: `Today, ${s.label}` }))]}
            />
          </div>
        )}
        {kind === 'thought' && <p className="text-xs text-muted">Thoughts go to the Inbox for later. Nothing is lost; nothing needs deciding now.</p>}

        {recent.length > 0 && (
          <ul className="space-y-1 border-t border-line pt-3" aria-live="polite">
            {recent.map((r, i) => (
              <li key={i} className={cx('flex items-center gap-2 text-sm', i === 0 && 'anim-fade')}>
                <Check size={14} className="shrink-0 text-teal" />
                <span className="min-w-0 flex-1 truncate">{r.text}</span>
                <span className="shrink-0 text-xs text-muted">{r.where}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

