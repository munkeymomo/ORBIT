import type { Capture, Checkpoint, DayItem, Energy, FocusSession, Group, Priority, Project, Task } from '../types';
import { addDays, toDateKey, uid } from '../lib/util';
import { nextGalaxySpot, type Pt } from './layout';

/**
 * A small, clearly-labelled example workspace for trying ORBIT.
 * Every record carries `example: true` and can be removed in one action.
 */
export function buildExample(now: number, occupied: Pt[] = []) {
  const today = toDateKey(now);
  const base = { example: true as const };
  const mk = <T extends object>(o: T, t = now) => ({ id: uid(), createdAt: t, updatedAt: t, ...base, ...o });

  const workAt = nextGalaxySpot(occupied);
  const lifeAt = nextGalaxySpot([...occupied, workAt]);
  const work: Group = mk({ name: 'Work (example)', color: 'violet', x: workAt.x, y: workAt.y });
  const life: Group = mk({ name: 'Life (example)', color: 'teal', x: lifeAt.x, y: lifeAt.y });

  // Positions are relative to each galaxy's centre.
  const P = (name: string, color: string, icon: string, groupId: string, x: number, y: number, description = ''): Project =>
    mk({ name, color, icon, description, groupId, x, y, archived: false });

  const report = P('Quarterly report', 'amber', 'chart-column', work.id, -420, -110, 'Board report for Q4.');
  const site = P('Website refresh', 'teal', 'globe', work.id, 300, -360, 'New landing page and docs.');
  const grant = P('Grant proposal', 'violet', 'file-text', work.id, 110, 420, 'Two-stage funding bid.');
  const move = P('Home move', 'coral', 'house', life.id, 40, -300);
  const spanish = P('Learn Spanish', 'sky', 'languages', life.id, -40, 300);
  const projects = [report, site, grant, move, spanish];

  const tasks: Task[] = [];
  const T = (
    p: Project,
    title: string,
    o: Partial<{ priority: Priority; due: number | null; est: number; energy: Energy; progress: number; status: Task['status']; doneDaysAgo: number; subtasks: [string, boolean][]; notes: string }> = {},
  ): Task => {
    const done = o.status === 'done';
    const t: Task = mk({
      projectId: p.id,
      title,
      notes: o.notes ?? '',
      status: o.status ?? 'todo',
      priority: o.priority ?? 2,
      due: o.due == null ? null : addDays(today, o.due),
      estimateMin: o.est ?? null,
      energy: o.energy ?? 'medium',
      progress: done ? 100 : (o.progress ?? 0),
      subtasks: (o.subtasks ?? []).map(([title, d]) => ({ id: uid(), title, done: d })),
      dependsOn: [] as string[],
      links: [] as Task['links'],
      completedAt: done ? now - (o.doneDaysAgo ?? 1) * 86_400_000 - 3_600_000 * 3 : null,
      parkedAt: o.status === 'parked' ? now - 2 * 3_600_000 : null,
    });
    tasks.push(t);
    return t;
  };

  const rData = T(report, 'Pull Q4 figures', { status: 'done', est: 45, doneDaysAgo: 3, energy: 'low' });
  const rDraft = T(report, 'Draft executive summary', {
    priority: 3,
    due: 1,
    est: 60,
    energy: 'high',
    status: 'parked',
    subtasks: [
      ['Headline numbers', true],
      ['Risks paragraph', false],
      ['Outlook', false],
    ],
  });
  const rCharts = T(report, 'Make charts for slides 4–7', { priority: 2, due: 2, est: 40, energy: 'medium' });
  rCharts.dependsOn = [rData.id];
  const rReview = T(report, 'Send to Sam for review', { priority: 3, due: 3, est: 10, energy: 'low' });
  rReview.dependsOn = [rDraft.id];

  T(site, 'Write hero copy', { priority: 2, due: 5, est: 30, energy: 'medium', progress: 40 });
  T(site, 'Fix mobile nav overlap', { priority: 4, due: -1, est: 25, energy: 'medium' });
  T(site, 'Compress product images', { status: 'done', est: 20, doneDaysAgo: 1, energy: 'low' });
  T(site, 'Audit colour contrast', { priority: 1, est: 45, energy: 'low' });

  T(grant, 'Outline aims and objectives', { status: 'done', est: 90, doneDaysAgo: 6, energy: 'high' });
  T(grant, 'Budget justification', { priority: 3, due: 9, est: 120, energy: 'high' });
  T(grant, 'Ask for letters of support', { priority: 2, due: 4, est: 15, energy: 'low' });

  T(move, 'Book removal van', { priority: 3, due: 0, est: 15, energy: 'low' });
  T(move, 'Pack the bookshelves', { priority: 2, est: 90, energy: 'medium', subtasks: [['Get boxes', true], ['Label boxes', false]] });
  T(move, 'Update address with bank', { status: 'done', est: 10, doneDaysAgo: 2, energy: 'low' });

  T(spanish, 'Lesson 12: past tense', { priority: 1, est: 30, energy: 'medium' });
  T(spanish, 'Watch a film without subtitles', { priority: 1, est: 100, energy: 'low' });

  const checkpoints: Checkpoint[] = [
    mk({
      taskId: rDraft.id,
      doing: 'Writing the risks paragraph',
      stoppedAt: 'Halfway through the supply-chain risk; numbers are in the sheet tab “Risks”',
      nextAction: 'Finish the supply-chain sentence, then start Outlook',
      notes: 'Keep it under 250 words. Sam wants the cash position up front.',
      links: [{ id: uid(), url: 'https://example.com/q4-figures', label: 'Q4 figures sheet (example link)' }],
      timer: { kind: 'focus' as const, mode: 'countdown' as const, plannedMs: 25 * 60_000, elapsedMs: 14 * 60_000 + 20_000 },
      resumedAt: null,
      auto: false,
    }, now - 2 * 3_600_000),
  ];

  // A little focus history over the past days, so Insights has something to show.
  // Finished tasks get sessions near their estimate (some over, some under); open work gets partial time.
  const sessions: FocusSession[] = [];
  const session = (task: Task, daysAgo: number, hour: number, min: number, distractions = 0) => {
    const day = new Date(now - daysAgo * 86_400_000);
    day.setHours(hour, 10, 0, 0);
    sessions.push(
      mk({
        taskId: task.id,
        kind: 'focus' as const,
        mode: 'countdown' as const,
        plannedMs: 25 * 60_000,
        startedAt: day.getTime(),
        endedAt: day.getTime() + min * 60_000,
        activeMs: min * 60_000,
        notes: '',
        distractions,
        endReason: 'stopped' as const,
      }, day.getTime()),
    );
  };
  const byTitle = (t: string) => tasks.find((x) => x.title === t)!;
  const ratios = [1.3, 0.85, 1.15, 1.6];
  tasks
    .filter((t) => t.status === 'done')
    .forEach((t, i) => {
      const total = Math.round((t.estimateMin ?? 30) * ratios[i % ratios.length]);
      const daysAgo = Math.max(1, Math.round((now - (t.completedAt ?? now)) / 86_400_000));
      const first = Math.round(total * 0.6);
      session(t, daysAgo, 9 + (i % 3), first, i % 2);
      if (total - first > 0) session(t, daysAgo, 14, total - first);
    });
  session(byTitle('Write hero copy'), 4, 10, 25, 1);
  session(byTitle('Draft executive summary'), 2, 11, 35, 2);
  session(byTitle('Pack the bookshelves'), 5, 18, 40);
  session(byTitle('Lesson 12: past tense'), 8, 19, 20);
  session(byTitle('Budget justification'), 9, 9, 50, 1);
  session(byTitle('Write hero copy'), 11, 15, 30);

  const captures: Capture[] = [
    mk({ text: 'Idea: FAQ section for pricing page', kind: 'task' as const, source: 'quick' as const, status: 'inbox' as const, contextTaskId: null, sortedTaskId: null }),
    mk({ text: 'Call the letting agent about the deposit', kind: 'task' as const, source: 'quick' as const, status: 'inbox' as const, contextTaskId: null, sortedTaskId: null }),
    mk({ text: 'Check whether the grant allows equipment costs', kind: 'thought' as const, source: 'focus' as const, status: 'inbox' as const, contextTaskId: null, sortedTaskId: null }),
  ];

  const dayItems: DayItem[] = [];
  const plan = (task: Task, slot: DayItem['slot'], order: number, start: string | null = null) =>
    dayItems.push(mk({ date: today, taskId: task.id, slot, order, start }));
  const fixNav = tasks.find((t) => t.title === 'Fix mobile nav overlap')!;
  const van = tasks.find((t) => t.title === 'Book removal van')!;
  plan(fixNav, 'morning', 0, '09:30');
  plan(rDraft, 'morning', 1);
  plan(rCharts, 'afternoon', 0);
  plan(van, 'evening', 0);

  return { groups: [work, life], projects, tasks, checkpoints, sessions, captures, dayItems };
}
