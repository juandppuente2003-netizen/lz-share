// LZ-SHARE para Windows: abre la app en su propia ventana y trae adentro
// el intermediario y FFmpeg (ya no hace falta abrir INICIAR-LZ-SHARE.bat).
const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const net = require('net');
const http = require('http');
// Registro para diagnosticar (en %APPDATA%\LZ-SHARE\lz-log.txt)
let LOGF = null;
function LOG(...a) { try { if (!LOGF) LOGF = path.join(app.getPath('userData'), 'lz-log.txt'); fs.appendFileSync(LOGF, new Date().toISOString() + '  ' + a.join(' ') + '\n'); } catch (e) {} }
process.on('uncaughtException', (e) => { LOG('ERROR', e && e.stack || e); });

// Actualización: la app pide abrir "lz-update:<link del instalador>"; se descarga y se ejecuta
function download(u, file, onPct, n = 0) {
  return new Promise((res, rej) => {
    https.get(u, { headers: { 'User-Agent': 'LZ-SHARE' } }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && n < 8) { r.resume(); return download(r.headers.location, file, onPct, n + 1).then(res, rej); }
      if (r.statusCode !== 200) { r.resume(); return rej(new Error('HTTP ' + r.statusCode)); }
      const total = +r.headers['content-length'] || 0; let done = 0, last = -1;
      const out = fs.createWriteStream(file);
      r.on('data', (d) => { done += d.length; const p = total ? Math.floor(done * 100 / total) : -1; if (p !== last && p % 5 === 0) { last = p; onPct(p); } });
      r.pipe(out); out.on('finish', () => out.close(() => res(file))); r.on('error', rej); out.on('error', rej);
    }).on('error', rej);
  });
}
async function selfUpdate(u) {
  const say = (p) => { try { win.webContents.executeJavaScript('window.lzUpdProgress && lzUpdProgress(' + p + ')'); } catch (e) {} };
  try {
    const file = path.join(os.tmpdir(), 'LZ-SHARE-actualizacion.exe');
    await download(u, file, say);
    say(101);
    shell.openPath(file);
    setTimeout(() => app.quit(), 1500);
  } catch (e) { say(-2); }
}

// Puerto: 8090 si está libre (o si lo tiene el LZ-SHARE de la computadora, que se cierra solo);
// si lo ocupa otro programa o Windows lo tiene reservado, se usa otro libre
const canListen = (port) => new Promise((res) => { const t = net.createServer(); t.once('error', () => res(false)); t.once('listening', () => t.close(() => res(true))); t.listen(port, '0.0.0.0'); });
const isLz = (port) => new Promise((res) => { const r = http.get({host: '127.0.0.1', port, path: '/lz-proxy/ping', timeout: 1500}, (x) => { let b = ''; x.on('data', (d) => b += d); x.on('end', () => { try { res(!!JSON.parse(b).lzproxy); } catch (e) { res(false); } }); }); r.on('error', () => res(false)); r.on('timeout', () => { r.destroy(); res(false); }); });
async function pickPort() {
  if (await canListen(8090) || await isLz(8090)) return 8090;
  for (let p = 18090; p < 18140; p++) if (await canListen(p)) return p;
  return 0;
}
process.env.LZ_EMBEDDED = '1';
// Reproductor mpv (abre MKV/HEVC/Dolby directo, con el audio siempre parejo)
try { require('./mpv-player.js')({ ipcMain, app, getWin: () => win, LOG }); } catch (e) { LOG('ERROR mpv', e && e.stack); ipcMain.on('mpv-ok', (ev) => { ev.returnValue = false; }); }
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Solo una ventana de LZ-SHARE a la vez
if (!app.requestSingleInstanceLock()) { app.quit(); }
let win, url = '';
const page = (title, body) => 'data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><meta charset="utf-8"><title>LZ-SHARE</title><body style="margin:0;height:100vh;display:grid;place-items:center;background:radial-gradient(ellipse at 50% 30%,#2a0f4d,#07060E 68%);color:#F5F3FB;font:18px system-ui,sans-serif;text-align:center"><div style="max-width:640px;padding:24px"><h1 style="font-size:34px;margin:0 0 12px">' + title + '</h1>' + body + '</div>');
function showError(msg) {
  if (!win || win.isDestroyed()) return;
  win.loadURL(page('No se pudo abrir LZ-SHARE', '<p>' + msg + '</p><p style="opacity:.7;font-size:15px">Cierra otros programas o reinicia la computadora y vuelve a intentar. Registro: ' + (LOGF || '') + '</p><p><a href="lzretry:" style="display:inline-block;margin-top:12px;padding:12px 26px;border-radius:30px;background:linear-gradient(135deg,#8A2BF2,#D61FF0);color:#fff;text-decoration:none;font-weight:700">Reintentar</a></p>'));
}
async function createWindow() {
  // La ventana sale de inmediato (nunca queda escondida)
  win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 960, minHeight: 540,
    backgroundColor: '#07060E', title: 'LZ-SHARE', icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true, show: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.maximize();
  Menu.setApplicationMenu(null);
  win.loadURL(page('LZ-SHARE', '<p style="opacity:.8">Abriendo…</p>'));
  LOG('inicio', 'electron', process.versions.electron);
  const port = await pickPort();
  if (!port) { LOG('sin puerto libre'); return showError('No se encontró un puerto libre en esta computadora.'); }
  process.env.PORT = String(port);
  LOG('puerto', port);
  try { require('./lz-servidor.js'); } catch (e) { LOG('ERROR servidor', e && e.stack); return showError('No se pudo iniciar el servidor interno: ' + (e && e.message)); }
  url = 'http://localhost:' + port + '/';
  const load = (n) => win.loadURL(url).then(() => LOG('cargó', url)).catch((e) => { if (n < 60) setTimeout(() => load(n + 1), 250); else { LOG('no cargó', url, e && e.message); showError('La ventana no pudo abrir la app (' + (e && e.message) + ').'); } });
  load(0);
  win.webContents.on('render-process-gone', (e, d) => { LOG('la página se cerró', JSON.stringify(d)); showError('La app se cerró inesperadamente.'); });
  // F11: pantalla completa
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
  // Links externos (VLC, páginas) se abren fuera de la app
  win.webContents.setWindowOpenHandler(({ url: u }) => { if (u.startsWith('lz-update:')) selfUpdate(u.slice(10)); else shell.openExternal(u); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, u) => { if (u.startsWith('lzretry:')) { e.preventDefault(); app.relaunch(); app.exit(0); return; } if (u.startsWith('data:') || (url && u.startsWith(url))) return; e.preventDefault(); shell.openExternal(u); });
}

app.on('second-instance', () => { if (win && !win.isDestroyed()) { if (!win.isVisible()) win.show(); if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
