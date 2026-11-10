import { useMemo } from 'react';
import { useOrbit } from '../store/store';
import { abilities, type HostAbilities } from './caps';

/** What may be done here: everything when standalone, the host's capabilities when embedded. */
export function useAbilities(): HostAbilities {
  const info = useOrbit((s) => s.host?.info);
  return useMemo(() => abilities(info), [info]);
}
