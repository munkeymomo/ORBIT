import { isDesktop, isFileCopy } from './desktop';
/**
 * Browser capabilities, each feature-detected and failing soft.
 * Sandboxed previews block some of these; the UI reports that honestly.
 */

let audioCtx: AudioContext | null = null;

/** A gentle two-note chime generated with WebAudio (no audio files, works offline). */
export function playChime(kind: 'focus-end' | 'break-end' | 'test' = 'focus-end'): boolean {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return false;
    audioCtx ??= new Ctx();
    const ctx = audioCtx;
    if (ctx.state === 'suspended') void ctx.resume();
    const notes = kind === 'break-end' ? [523.25, 659.25, 783.99] : [659.25, 880];
    const t0 = ctx.currentTime + 0.02;
    notes.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      const start = t0 + i * 0.18;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.1);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 1.2);
    });
    return true;
  } catch {
    return false;
  }
}

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (!notificationsSupported()) return 'unsupported';
  try {
    return Notification.permission;
  } catch {
    return 'unsupported';
  }
}

export async function requestNotifications(): Promise<NotificationPermission | 'unsupported'> {
  if (!notificationsSupported()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}

export function showNotification(title: string, body: string) {
  try {
    if (notificationPermission() !== 'granted') return;
    // Prefer the service worker (required on Android), fall back to the page API.
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      void navigator.serviceWorker.ready.then((reg) => reg.showNotification(title, { body, icon: './pwa-192.png', tag: 'orbit-timer' }));
    } else {
      new Notification(title, { body, icon: './pwa-192.png', tag: 'orbit-timer' });
    }
  } catch {
    /* blocked in this context */
  }
}

/* ---------- Voice capture (Web Speech API; free, browser-provided) ---------- */

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

/** The modifier key as people know it on this computer: ⌘ on Apple devices, Ctrl elsewhere. */
export const MOD_KEY =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';

export function voiceSupported(): boolean {
  // Electron exposes the API but has no speech service behind it.
  if (typeof window === 'undefined' || isDesktop) return false;
  const w = window as unknown as Record<string, unknown>;
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function startVoice(handlers: { onText: (text: string, final: boolean) => void; onError: (msg: string) => void; onEnd: () => void }): (() => void) | null {
  try {
    const w = window as unknown as Record<string, new () => SpeechRecognitionLike>;
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return null;
    const rec = new Ctor();
    rec.lang = navigator.language || 'en-GB';
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      let text = '';
      let final = false;
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
        final = e.results[i].isFinal;
      }
      handlers.onText(text, final);
    };
    rec.onerror = (e) =>
      handlers.onError(
        e.error === 'not-allowed' || e.error === 'service-not-allowed'
          ? 'Microphone access is blocked here.'
          : e.error === 'network'
            ? 'Voice capture needs a connection in this browser.'
            : 'Voice capture stopped.',
      );
    rec.onend = handlers.onEnd;
    rec.start();
    return () => rec.stop();
  } catch {
    handlers.onError('Voice capture is not available here.');
    return null;
  }
}

/* ---------- Files ---------- */

/** Starts a download; returns false where downloads are blocked (sandboxed frames). */
export function downloadText(filename: string, text: string): boolean {
  try {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  } catch {
    return false;
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function isSandboxed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/* ---------- PWA ---------- */

export async function registerServiceWorker() {
  try {
    // The desktop app and the single-file copy have nothing to cache: they are already offline.
    if (!('serviceWorker' in navigator) || import.meta.env.DEV || isDesktop || isFileCopy) return;
    const { registerSW } = await import('virtual:pwa-register');
    registerSW({ immediate: true });
  } catch {
    /* service workers are refused in sandboxed previews; the app still works online */
  }
}

/* ---------- Install prompt ---------- */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let deferredInstall: InstallPromptEvent | null = null;
const installListeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e as InstallPromptEvent;
    installListeners.forEach((fn) => fn());
  });
  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    installListeners.forEach((fn) => fn());
  });
}
export function canInstall() {
  return !!deferredInstall;
}
export function onInstallChange(fn: () => void) {
  installListeners.add(fn);
  return () => installListeners.delete(fn);
}
export async function promptInstall(): Promise<boolean> {
  if (!deferredInstall) return false;
  await deferredInstall.prompt();
  const { outcome } = await deferredInstall.userChoice;
  deferredInstall = null;
  installListeners.forEach((fn) => fn());
  return outcome === 'accepted';
}
export function isStandalone(): boolean {
  try {
    return matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}
