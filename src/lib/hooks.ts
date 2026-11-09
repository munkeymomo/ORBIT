import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { isTypingTarget } from './util';

/** Re-renders every `ms` with the current time. Pass null to stop ticking. */
export function useNow(ms: number | null = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (ms == null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** < 768px: phone layouts */
export const useIsPhone = () => useMediaQuery('(max-width: 767px)');
/** ≥ 1024px: desktop layouts */
export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)');
export const useCoarsePointer = () => useMediaQuery('(pointer: coarse)');

export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb);
      window.addEventListener('offline', cb);
      return () => {
        window.removeEventListener('online', cb);
        window.removeEventListener('offline', cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

/** Global key handler that ignores keys typed into fields. */
export function useHotkeys(handler: (e: KeyboardEvent) => void, enabled = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const fn = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTypingTarget(e.target)) return;
      ref.current(e);
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [enabled]);
}

/** Debounced value. */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}
