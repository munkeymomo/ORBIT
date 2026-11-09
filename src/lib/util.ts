import type { DaySlot } from '../types';

/** Random id that works in insecure contexts too (crypto.randomUUID needs HTTPS). */
export function uid(): string {
  const bytes = new Uint8Array(12);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* ---------- Dates (local time, YYYY-MM-DD) ---------- */

export function toDateKey(d: Date | number): string {
  const x = typeof d === 'number' ? new Date(d) : d;
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(key: string, n: number): string {
  const d = fromDateKey(key);
  d.setDate(d.getDate() + n);
  return toDateKey(d);
}

/** Whole calendar days from `fromKey` to `toKey` (positive when toKey is later). */
export function daysBetween(fromKey: string, toKey: string): number {
  const a = fromDateKey(fromKey).getTime();
  const b = fromDateKey(toKey).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function isValidDateKey(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(fromDateKey(s).getTime());
}

export function describeDue(due: string, todayKey: string): { label: string; tone: 'overdue' | 'today' | 'soon' | 'later' } {
  const d = daysBetween(todayKey, due);
  if (d < 0) return { label: d === -1 ? 'Overdue by 1 day' : `Overdue by ${-d} days`, tone: 'overdue' };
  if (d === 0) return { label: 'Due today', tone: 'today' };
  if (d === 1) return { label: 'Due tomorrow', tone: 'soon' };
  if (d <= 7) return { label: `Due in ${d} days`, tone: 'soon' };
  return { label: `Due ${fromDateKey(due).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`, tone: 'later' };
}

export function friendlyDay(key: string, todayKey: string): string {
  const d = daysBetween(todayKey, key);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  return fromDateKey(key).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
}

/* ---------- Durations ---------- */

/** 1h 05m / 25m / 40s */
export function fmtMinutes(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min)) return '—';
  const m = Math.round(min);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${String(r).padStart(2, '0')}m` : `${h}h`;
}

/** Clock format for timers: 24:59, 1:02:03; negative values shown with a leading + for overtime. */
export function fmtClock(ms: number): string {
  const neg = ms < 0;
  const total = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const body = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  return neg ? `+${body}` : body;
}

export function fmtTimeOfDay(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function relativeTime(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/** "09:30" + 45 → "10:15" */
export function addMinutesToHHMM(hhmm: string, min: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = (h * 60 + m + Math.round(min)) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export const SLOTS: { id: DaySlot; label: string; hint: string }[] = [
  { id: 'morning', label: 'Morning', hint: 'Fresh focus' },
  { id: 'afternoon', label: 'Afternoon', hint: 'Steady work' },
  { id: 'evening', label: 'Evening', hint: 'Wind down' },
  { id: 'later', label: 'Later', hint: 'If there is time' },
];

export function currentSlot(now: number): DaySlot {
  const h = new Date(now).getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

export function normaliseUrl(raw: string): string {
  const s = raw.trim();
  if (!s) return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
  return `https://${s}`;
}

export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
