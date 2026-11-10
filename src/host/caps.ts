/**
 * What ORBIT may do while a host is attached: the host's capabilities, limited to what this build supports.
 * Components use this to hide controls; the store uses the same answers to refuse changes.
 */
import type { HostRef } from '../types';
import type { Caps, Handshake } from './types';

/**
 * What this build can do with the host's capabilities. This is the read-only stage: whatever a host offers,
 * host-owned records are not changed, ORBIT keeps no records of its own with the host and no working state
 * for host tasks. Later stages turn these on as the store learns to route each change to the host.
 */
export const BUILD_SUPPORTS = { write: false, personal: false, work: false } as const;

export interface HostAbilities {
  hosted: boolean;
  /** The host's name ("ORBIT" when standalone). */
  name: string;
  /** Host-owned tasks may be changed (subject to each record's caps). */
  write: boolean;
  /** ORBIT may have galaxies, systems and tasks of its own. */
  personal: boolean;
  /** Focus, parking and day plans are available for host tasks. */
  work: boolean;
  /** Set while the host refuses changes; the text says why. */
  locked?: string;
  /** "Open in <host>" */
  openLabel: string;
  /** Where host records are kept, e.g. "Kept by <host>". */
  storedLabel: string;
}

export const STANDALONE: HostAbilities = { hosted: false, name: 'ORBIT', write: true, personal: true, work: true, openLabel: '', storedLabel: '' };

export function abilities(info: Handshake | null | undefined): HostAbilities {
  if (!info) return STANDALONE;
  const name = info.host?.name?.trim() || 'the host';
  return {
    hosted: true,
    name,
    write: !!info.caps?.write && BUILD_SUPPORTS.write,
    personal: !!info.caps?.personal && BUILD_SUPPORTS.personal,
    work: !!info.caps?.work && BUILD_SUPPORTS.work,
    locked: info.locked,
    openLabel: info.labels?.open?.trim() || `Open in ${name}`,
    storedLabel: info.labels?.stored?.trim() || `Kept by ${name}`,
  };
}

type Cap = Exclude<keyof Caps, 'reason'>;

/** May this change be made to this record? Records that are ORBIT's own: always. */
export function may(a: HostAbilities, ref: HostRef | undefined, cap: Cap): boolean {
  if (!ref) return true;
  return a.write && !a.locked && !!ref.caps[cap];
}

/** May focus, parking and the day plan be used with this task? */
export function mayWork(a: HostAbilities, ref: HostRef | undefined): boolean {
  return !ref || a.work;
}

/** The toasts shown when a change is refused. */
export const refusal = {
  kept: (a: HostAbilities) => a.locked || `This is kept by ${a.name}; open it there to change it.`,
  personal: (a: HostAbilities) => `Nothing new can be added here: ${a.name} keeps only its own records.`,
  work: (a: HostAbilities) => `Focus, parking and day plans are not available for tasks kept by ${a.name}.`,
  move: (a: HostAbilities) => `This system is kept by ${a.name}; move it to another galaxy there. You can still drag it to a new place in its own galaxy.`,
  data: (a: HostAbilities) => `Backups, examples and erasing are not available while ${a.name} keeps the records.`,
};
