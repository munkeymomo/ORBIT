import { useCallback, useMemo } from 'react';
import { useOrbit } from '../store/store';
import type { Project } from '../types';
import { abilities, may, type HostAbilities } from './caps';

/** What may be done here: everything when standalone, the host's capabilities when embedded. */
export function useAbilities(): HostAbilities {
  const info = useOrbit((s) => s.host?.info);
  return useMemo(() => abilities(info), [info]);
}

/** Can a new task be filed in this project? ORBIT's own: when it may keep records; a host's: per its caps. */
export function useTakesTasks(): (p: Project) => boolean {
  const can = useAbilities();
  return useCallback((p: Project) => (p.host ? may(can, p.host, 'create') : can.personal), [can]);
}
