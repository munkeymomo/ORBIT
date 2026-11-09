import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { orbitStore, setEffects } from './store/store';
import { openStorage } from './data/storage';
import { playChime, registerServiceWorker, showNotification } from './lib/platform';

setEffects({
  chime: (kind) => void playChime(kind),
  notify: (title, body) => showNotification(title, body),
});

openStorage().then(({ adapter, error }) => orbitStore.getState().init(adapter, error));
void registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
