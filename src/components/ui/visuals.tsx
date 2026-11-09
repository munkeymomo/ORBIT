import {
  Atom,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  BookOpen,
  Brain,
  Briefcase,
  Camera,
  ChartColumn,
  Code,
  Compass,
  Dumbbell,
  FileText,
  FlaskConical,
  Globe,
  GraduationCap,
  Hammer,
  Heart,
  House,
  Languages,
  Leaf,
  Lightbulb,
  Mail,
  Microscope,
  Music,
  Orbit,
  Palette,
  PenTool,
  Plane,
  Rocket,
  Sparkles,
  Target,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { Energy, Priority } from '../../types';
import { colorHex } from '../../lib/colors';
import { describeDue } from '../../lib/util';
import { cx } from './primitives';

export const PROJECT_ICONS: Record<string, LucideIcon> = {
  orbit: Orbit,
  rocket: Rocket,
  'book-open': BookOpen,
  'flask-conical': FlaskConical,
  microscope: Microscope,
  atom: Atom,
  globe: Globe,
  'file-text': FileText,
  'chart-column': ChartColumn,
  code: Code,
  'pen-tool': PenTool,
  palette: Palette,
  briefcase: Briefcase,
  house: House,
  languages: Languages,
  'graduation-cap': GraduationCap,
  lightbulb: Lightbulb,
  brain: Brain,
  target: Target,
  compass: Compass,
  users: Users,
  mail: Mail,
  heart: Heart,
  music: Music,
  camera: Camera,
  dumbbell: Dumbbell,
  plane: Plane,
  leaf: Leaf,
  wrench: Wrench,
  hammer: Hammer,
  sparkles: Sparkles,
};

export function ProjectGlyph({ icon, size = 18, className }: { icon: string; size?: number; className?: string }) {
  const Icon = PROJECT_ICONS[icon] ?? Orbit;
  return <Icon size={size} className={className} aria-hidden />;
}

/** A small coloured dot + icon tile for a project. */
export function ProjectChip({ color, icon, size = 28, className }: { color: string; icon: string; size?: number; className?: string }) {
  const hex = colorHex(color);
  return (
    <span
      className={cx('inline-flex shrink-0 items-center justify-center rounded-lg', className)}
      style={{ width: size, height: size, background: `${hex}26`, color: hex, boxShadow: `inset 0 0 0 1px ${hex}40` }}
      aria-hidden
    >
      <ProjectGlyph icon={icon} size={Math.round(size * 0.56)} />
    </span>
  );
}

export function ProgressRing({
  value,
  size = 40,
  stroke = 4,
  color = 'var(--accent)',
  track = 'var(--line-strong)',
  children,
  className,
  label,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  children?: React.ReactNode;
  className?: string;
  label?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <span className={cx('relative inline-flex shrink-0 items-center justify-center', className)} style={{ width: size, height: size }} role={label ? 'img' : undefined} aria-label={label}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
      </svg>
      {children && <span className="absolute inset-0 flex items-center justify-center">{children}</span>}
    </span>
  );
}

export const PRIORITY_META: Record<Priority, { label: string; short: string; cls: string; bars: number }> = {
  1: { label: 'Low', short: 'Low', cls: 'text-faint', bars: 1 },
  2: { label: 'Normal', short: 'Norm', cls: 'text-muted', bars: 2 },
  3: { label: 'High', short: 'High', cls: 'text-amber', bars: 3 },
  4: { label: 'Critical', short: 'Crit', cls: 'text-danger', bars: 4 },
};

/** Four ascending bars; filled count = priority. */
export function PriorityBars({ priority, className }: { priority: Priority; className?: string }) {
  const m = PRIORITY_META[priority];
  return (
    <span className={cx('inline-flex items-end gap-[2px]', m.cls, className)} role="img" aria-label={`${m.label} priority`} title={`${m.label} priority`}>
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className="w-[3px] rounded-sm" style={{ height: 3 + i * 2.2, background: 'currentColor', opacity: i <= m.bars ? 1 : 0.2 }} />
      ))}
    </span>
  );
}

export const ENERGY_META: Record<Energy, { label: string; Icon: LucideIcon; cls: string }> = {
  low: { label: 'Low energy', Icon: BatteryLow, cls: 'text-teal' },
  medium: { label: 'Medium energy', Icon: BatteryMedium, cls: 'text-accent-ink' },
  high: { label: 'High energy', Icon: BatteryFull, cls: 'text-amber' },
};

export function EnergyIcon({ energy, size = 15, className }: { energy: Energy; size?: number; className?: string }) {
  const m = ENERGY_META[energy];
  return (
    <span className={cx('inline-flex', m.cls, className)} title={m.label} role="img" aria-label={m.label}>
      <m.Icon size={size} aria-hidden />
    </span>
  );
}

export function DueBadge({ due, today, className }: { due: string; today: string; className?: string }) {
  const d = describeDue(due, today);
  const tone =
    d.tone === 'overdue' ? 'bg-danger-soft text-danger' : d.tone === 'today' ? 'bg-amber-soft text-amber' : d.tone === 'soon' ? 'bg-surface-3 text-text' : 'bg-surface-2 text-muted';
  return <span className={cx('inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-medium whitespace-nowrap', tone, className)}>{d.label}</span>;
}
