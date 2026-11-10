import { useEffect, useRef, useState } from 'react';
import { CalendarPlus, ChevronDown, Infinity as InfinityIcon, Play } from 'lucide-react';
import { useOrbit } from '../../store/store';
import { useAbilities } from '../../host/useAbilities';
import { mayWork } from '../../host/caps';
import type { DaySlot } from '../../types';
import { Button, Menu, cx } from '../ui/primitives';
import { SLOTS, currentSlot, toDateKey } from '../../lib/util';

/** Split button: start the default focus length, or pick a preset / flow. */
export function StartFocusButton({ taskId, size = 'md', className, label = 'Start focus', onStarted }: { taskId: string; size?: 'sm' | 'md' | 'lg'; className?: string; label?: string; onStarted?: () => void }) {
  const startFocus = useOrbit((s) => s.startFocus);
  const focusMin = useOrbit((s) => s.prefs.focusMin);
  const setView = useOrbit((s) => s.setView);
  const can = useAbilities();
  const host = useOrbit((s) => s.tasks.find((t) => t.id === taskId)?.host);
  const go = (minutes?: number, flow?: boolean) => {
    startFocus({ taskId, minutes: minutes ?? focusMin, mode: flow ? 'flow' : 'countdown' });
    onStarted?.();
  };
  // Focus on a host's task needs the host to keep working state.
  if (!mayWork(can, host)) return null;
  return (
    <div className={cx('inline-flex', className)}>
      <Button variant="teal" size={size} className="!rounded-r-none" icon={<Play size={size === 'sm' ? 14 : 16} fill="currentColor" />} onClick={() => go()}>
        {label}
        <span className="opacity-70">· {focusMin}m</span>
      </Button>
      <Menu
        label="Focus length"
        trigger={(p) => (
          <Button {...p} variant="teal" size={size} className="!rounded-l-none border-l border-black/15 !px-2" aria-label="Choose focus length">
            <ChevronDown size={16} />
          </Button>
        )}
        items={[
          ...[15, 25, 45, 60].map((m) => ({ label: `${m} minutes`, onSelect: () => go(m) })),
          'sep' as const,
          { label: 'Flow (count up)', icon: <InfinityIcon size={15} />, onSelect: () => go(undefined, true) },
          { label: 'Custom length…', onSelect: () => setView('focus') },
        ]}
      />
    </div>
  );
}

export function PlanTodayButton({ taskId, size = 'md' }: { taskId: string; size?: 'sm' | 'md' }) {
  const planTask = useOrbit((s) => s.planTask);
  const unplan = useOrbit((s) => s.unplan);
  const today = toDateKey(Date.now());
  const item = useOrbit((s) => s.dayItems.find((d) => d.taskId === taskId && d.date === today));
  const slotLabel = item ? SLOTS.find((s) => s.id === item.slot)?.label : null;
  const can = useAbilities();
  const host = useOrbit((s) => s.tasks.find((t) => t.id === taskId)?.host);
  if (!mayWork(can, host)) return null;
  return (
    <Menu
      label="Plan for today"
      align="left"
      trigger={(p) => (
        <Button {...p} size={size} variant="secondary" icon={<CalendarPlus size={15} />}>
          {item ? `Today · ${slotLabel}` : 'Plan today'}
        </Button>
      )}
      items={[
        ...SLOTS.map((s) => ({
          label: `${s.label}${item?.slot === s.id ? ' ✓' : ''}`,
          onSelect: () => planTask(taskId, today, s.id as DaySlot),
        })),
        ...(item ? ['sep' as const, { label: 'Remove from today', danger: true, onSelect: () => unplan(item.id) }] : []),
      ]}
    />
  );
}

export function defaultSlot(): DaySlot {
  return currentSlot(Date.now());
}

/** Local draft that commits on blur and after a pause in typing. */
export function useDraft(value: string, commit: (v: string) => void, delay = 700) {
  const [draft, setDraft] = useState(value);
  const dirty = useRef(false);
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => {
    if (!dirty.current) setDraft(value);
  }, [value]);
  useEffect(() => {
    if (!dirty.current) return;
    const id = setTimeout(() => {
      commitRef.current(draft);
      dirty.current = false;
    }, delay);
    return () => clearTimeout(id);
  }, [draft, delay]);
  return {
    value: draft,
    onChange: (v: string) => {
      dirty.current = true;
      setDraft(v);
    },
    flush: () => {
      if (dirty.current) {
        commitRef.current(draft);
        dirty.current = false;
      }
    },
  };
}
