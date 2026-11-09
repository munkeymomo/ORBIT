import { useMemo } from 'react';
import { useOrbit } from '../../store/store';
import { latestCheckpoints } from '../../store/selectors';
import { rankNext } from '../../lib/scoring';
import { toDateKey } from '../../lib/util';

export function useSuggestions(override?: { minutes?: number; energy?: 'low' | 'medium' | 'high' }) {
  const tasks = useOrbit((s) => s.tasks);
  const checkpoints = useOrbit((s) => s.checkpoints);
  const dayItems = useOrbit((s) => s.dayItems);
  const activeTaskId = useOrbit((s) => s.focus?.taskId ?? null);
  const nextEnergy = useOrbit((s) => s.prefs.nextEnergy);
  const nextMinutes = useOrbit((s) => s.prefs.nextMinutes);
  const energy = override?.energy ?? nextEnergy;
  const minutes = override?.minutes ?? nextMinutes;
  return useMemo(() => {
    const todayKey = toDateKey(Date.now());
    const planned = new Map(dayItems.filter((d) => d.date === todayKey).map((d) => [d.taskId, d]));
    return rankNext(tasks, { todayKey, availableMin: minutes, energy, checkpoints: latestCheckpoints(checkpoints), planned, activeTaskId });
  }, [tasks, checkpoints, dayItems, activeTaskId, energy, minutes]);
}
