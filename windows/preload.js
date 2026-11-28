// Puente entre la página y la app de Windows: reproductor mpv (como el reproductor nativo de la tele)
const { contextBridge, ipcRenderer } = require('electron');
let ok = false;
try { ok = ipcRenderer.sendSync('mpv-ok'); } catch (e) {}
if (ok) contextBridge.exposeInMainWorld('LZPC', {
  play: (json) => ipcRenderer.send('mpv-play', String(json)),
  stop: () => ipcRenderer.send('mpv-stop'),
});
