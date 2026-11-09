// ORBIT desktop: the same app as the web version, in its own window, with data kept on this computer.
const { app, BrowserWindow, Menu, ipcMain, protocol, screen, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SCHEME = 'orbit';
const HOST = 'app';
const ORIGIN = `${SCHEME}://${HOST}`;
const ROOT = path.join(__dirname, '..', 'dist');

// A fixed, secure origin, so IndexedDB and localStorage persist between launches and versions.
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

app.setAppUserModelId('io.github.munkeymomo.orbit'); // Windows: notifications and taskbar grouping
// Tests point ORBIT at a throwaway data folder.
if (process.env.ORBIT_USER_DATA) app.setPath('userData', process.env.ORBIT_USER_DATA);

if (!app.requestSingleInstanceLock()) {
  // One ORBIT at a time: two windows writing the same data would fight.
  app.quit();
} else {
  let win = null;

  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
    '.ico': 'image/x-icon',
  };

  function serve(request) {
    const url = new URL(request.url);
    if (url.host !== HOST) return new Response('Not found', { status: 404 });
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT + path.sep)) return new Response('Forbidden', { status: 403 });
    try {
      const body = fs.readFileSync(file); // asar-aware
      return new Response(body, { headers: { 'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream' } });
    } catch {
      // unknown paths fall back to the app (it routes by #hash)
      return new Response(fs.readFileSync(path.join(ROOT, 'index.html')), { headers: { 'content-type': TYPES['.html'] } });
    }
  }

  /* ---------- window size and position, remembered ---------- */

  const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
  function loadBounds() {
    try {
      const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
      const area = screen.getDisplayMatching(s).workArea;
      const visible = s.x < area.x + area.width - 80 && s.x + s.width > area.x + 80 && s.y >= area.y - 20 && s.y < area.y + area.height - 80;
      return visible ? s : { width: s.width, height: s.height, maximized: s.maximized };
    } catch {
      return { width: 1440, height: 900, maximized: false };
    }
  }
  function saveBounds() {
    if (!win) return;
    try {
      const b = win.getNormalBounds();
      fs.writeFileSync(stateFile(), JSON.stringify({ ...b, maximized: win.isMaximized() }));
    } catch {
      /* not worth failing over */
    }
  }

  function isExternal(url) {
    return /^(https?:|mailto:)/i.test(url);
  }

  function createWindow() {
    const b = loadBounds();
    win = new BrowserWindow({
      x: b.x,
      y: b.y,
      width: b.width ?? 1440,
      height: b.height ?? 900,
      minWidth: 900,
      minHeight: 600,
      show: false,
      title: 'ORBIT',
      backgroundColor: '#0A0C12',
      autoHideMenuBar: true,
      icon: path.join(ROOT, 'pwa-512.png'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: true,
        additionalArguments: [`--orbit-data=${app.getPath('userData')}`],
      },
    });
    if (b.maximized) win.maximize();
    win.once('ready-to-show', () => win.show());

    // Links (task links, the coffee link) open in the default browser, never inside ORBIT.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (isExternal(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
      if (url.startsWith(`${ORIGIN}/`)) return;
      e.preventDefault();
      if (isExternal(url)) void shell.openExternal(url);
    });

    // Developer tools stay reachable for bug reports: Ctrl+Shift+I.
    win.webContents.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'i') {
        win.webContents.toggleDevTools();
        e.preventDefault();
      }
    });

    win.on('close', saveBounds);
    win.on('closed', () => (win = null));
    void win.loadURL(`${ORIGIN}/index.html`);
  }

  app.whenReady().then(() => {
    protocol.handle(SCHEME, serve);

    // ORBIT asks for notifications (focus timer) and the clipboard (copy backup); nothing else.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(['notifications', 'clipboard-sanitized-write', 'fullscreen'].includes(permission));
    });

    ipcMain.handle('orbit:open-data-folder', () => shell.openPath(app.getPath('userData')));

    if (process.platform === 'darwin') {
      Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
    } else {
      Menu.setApplicationMenu(null);
    }

    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

