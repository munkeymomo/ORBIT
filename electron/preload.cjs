// Runs before the page, sandboxed: tells ORBIT it is the desktop app and where its data lives.
const { contextBridge, ipcRenderer } = require('electron');

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : '';
};

contextBridge.exposeInMainWorld('orbitDesktop', {
  platform: process.platform,
  dataPath: arg('orbit-data'),
  openDataFolder: () => ipcRenderer.invoke('orbit:open-data-folder'),
});
