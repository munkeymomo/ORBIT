import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { orbitStore, setEffects } from './store/store';
import { MemoryAdapter, openStorage } from './data/storage';
import { playChime, registerServiceWorker, showNotification } from './lib/platform';
import { setLocalStorageAllowed } from './lib/local';
import { APP_VERSION } from './lib/desktop';
import { detectHost, hostExpected } from './host/detect';
import { startHostRefresh } from './host/refresh';

setEffects({
  chime: (kind) => void playChime(kind),
  notify: (title, body) => showNotification(title, body),
});

// Readable by a host in the same origin (e.g. to report which build it is running).
document.documentElement.dataset.orbitVersion = APP_VERSION;

// A host keeps everything for ORBIT: nothing goes to this browser's storage while one is (or may be) attached.
if (hostExpected()) setLocalStorageAllowed(false);

async function start() {
  const found = await detectHost();
  const init = orbitStore.getState().init;
  if (found.kind === 'host') {
    await init(new MemoryAdapter(), null, { host: { host: found.host, info: found.info } });
    startHostRefresh(() => orbitStore.getState().refreshHost());
  } else if (found.kind === 'refused') {
    // Refused hosts get nothing, and ORBIT runs on its own in memory, saying why.
    setLocalStorageAllowed(false);
    await init(new MemoryAdapter(), null, { hostRefusal: found.reason });
  } else {
    setLocalStorageAllowed(true);
    const { adapter, error } = await openStorage();
    await init(adapter, error);
    void registerServiceWorker();
  }
}
void start();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
