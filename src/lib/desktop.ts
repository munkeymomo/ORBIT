/** What the ORBIT desktop app (Electron) exposes to the page. Absent in a browser. */
interface OrbitDesktop {
  platform: string;
  dataPath: string;
  openDataFolder: () => Promise<void>;
}

export const desktop: OrbitDesktop | undefined =
  typeof window !== 'undefined' ? (window as unknown as { orbitDesktop?: OrbitDesktop }).orbitDesktop : undefined;

export const isDesktop = !!desktop;

/** Opened from a file on disk (the single-file browser edition). */
export const isFileCopy = typeof location !== 'undefined' && location.protocol === 'file:';

export const APP_VERSION = __APP_VERSION__;

/** Where the Windows builds and new versions are published. */
export const DOWNLOAD_URL = 'https://sourceforge.net/projects/orbit-productivity/';

/** Mark's “buy me a coffee” page. */
export const SUPPORT_URL = 'https://ko-fi.com/markisaacschem';
