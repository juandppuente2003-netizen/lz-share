// Reproductor de la PC (mpv): igual que en la tele, recibe la lista de versiones y las prueba en orden.
// mpv abre MKV, HEVC, AC3/Dolby y DTS directo (sin convertir), así el audio siempre va parejo.
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');

module.exports = function setupMpv({ ipcMain, app, getWin, LOG }) {
  const exe = [path.join(process.resourcesPath || '', 'mpv', 'mpv.exe'), path.join(__dirname, 'mpv', 'mpv.exe')].find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });
  ipcMain.on('mpv-ok', (e) => { e.returnValue = !!exe; });
  LOG('mpv', exe || 'no incluido');
  if (!exe) return;

  // Teclas: Esc / Retroceso salen (como "Regresar" en la tele); O = elegir otra versión
  const conf = path.join(app.getPath('userData'), 'mpv-teclas.conf');
  try {
    fs.writeFileSync(conf, [
      'ESC quit', 'BS quit', 'MBTN_BACK quit',
      'o script-message lzpick', 'O script-message lzpick',
      'LEFT seek -10', 'RIGHT seek 30', 'UP add volume 5', 'DOWN add volume -5',
      'SPACE cycle pause', 'ENTER cycle pause', 'MBTN_LEFT_DBL cycle fullscreen', 'f cycle fullscreen',
      'a cycle audio', 's cycle sub', 'j cycle sub',
    ].join('\n'));
  } catch (e) {}

  let cur = null;   // reproducción en curso
  const send = (code) => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.executeJavaScript(code).catch(() => {}); };
  const stopCur = () => { if (cur) { cur.stopped = true; try { cur.p.kill(); } catch (e) {} cur = null; } };

  function attempt(job, idx) {
    const o = job.opts[idx];
    if (!o) { LOG('mpv: ninguna opción abrió'); const w = getWin(); if (w) w.focus(); return send('window.lzFailed && lzFailed()'); }
    const pipe = '\\\\.\\pipe\\lz-mpv-' + process.pid + '-' + Date.now();
    const es = /^(es|spa)/i.test(job.audioLang || '');
    const args = [
      '--fs', '--ontop', '--force-window=immediate', '--keep-open=no', '--idle=no',
      '--input-ipc-server=' + pipe, '--input-conf=' + conf,
      '--title=' + job.title + (job.opts.length > 1 ? '  (opción ' + (idx + 1) + ')' : ''),
      '--osd-playing-msg=' + job.title, '--osd-duration=2500',
      '--cache=yes', '--demuxer-max-bytes=150MiB', '--demuxer-readahead-secs=30',
      '--network-timeout=25', '--hwdec=auto-safe', '--volume=100', '--volume-max=150',
      '--alang=' + (es ? 'es,spa,lat,es-419,es-MX,mx,spanish,' : '') + 'en,eng',
      '--slang=es,spa,lat,es-419,spanish', '--subs-with-matching-audio=no',
      '--sub-font-size=46', '--sub-border-size=3',
    ];
    if (o.ua) args.push('--user-agent=' + o.ua);
    if (o.ref) args.push('--http-header-fields=Referer: ' + o.ref.replace(/,/g, '\\,'));
    if (job.start > 5) args.push('--start=' + job.start);
    if (job.sub) { args.push('--sub-file=' + job.sub); if (o.es) args.push('--sid=no'); }   // audio en español: subtítulos apagados
    args.push('--', o.url);
    const p = spawn(exe, args, { stdio: 'ignore', windowsHide: false });
    const st = cur = { p, job, idx, pos: job.start || 0, dur: 0, started: false, ended: false, pick: false, t0: Date.now() };
    LOG('mpv: abriendo opción', idx + 1, 'de', job.opts.length);
    let sock = null, buf = '';
    const connect = (n) => {
      if (st.stopped) return;
      sock = net.connect(pipe);
      sock.on('connect', () => {
        sock.write(JSON.stringify({ command: ['observe_property', 1, 'time-pos'] }) + '\n');
        sock.write(JSON.stringify({ command: ['observe_property', 2, 'duration'] }) + '\n');
      });
      sock.on('data', (d) => {
        buf += d; let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          let m; try { m = JSON.parse(line); } catch (e) { continue; }
          if (m.event === 'property-change' && m.name === 'time-pos' && typeof m.data === 'number') { st.pos = m.data; if (m.data > 0 && !st.started) { st.started = true; LOG('mpv: arrancó en', ((Date.now() - st.t0) / 1000).toFixed(1), 's'); } }
          else if (m.event === 'property-change' && m.name === 'duration' && typeof m.data === 'number') st.dur = m.data;
          else if (m.event === 'end-file' && m.reason === 'eof') st.ended = true;
          else if (m.event === 'client-message' && m.args && m.args[0] === 'lzpick') { st.pick = true; try { p.kill(); } catch (e) {} }
        }
      });
      sock.on('error', () => { if (n < 40 && !st.stopped && p.exitCode == null) setTimeout(() => connect(n + 1), 150); });
    };
    setTimeout(() => connect(0), 250);
    // Si en 30 s no arranca, se pasa a la siguiente versión
    const wd = setTimeout(() => { if (!st.started && !st.stopped && cur === st) { LOG('mpv: la opción', idx + 1, 'no arrancó'); st.next = true; try { p.kill(); } catch (e) {} } }, 30000);
    p.on('exit', (code) => {
      clearTimeout(wd); try { sock && sock.destroy(); } catch (e) {}
      if (st.stopped) return;
      if (cur === st) cur = null;
      if (!st.started && !st.pick && (st.next || code)) return attempt(job, idx + 1);   // no abrió: siguiente versión
      const w = getWin(); if (w && !w.isDestroyed()) { w.show(); w.focus(); }
      const pos = Math.floor(st.pos || 0), dur = Math.floor(st.dur || 0);
      send('window.lzProgress && lzProgress(' + pos + ',' + dur + ',' + (st.ended ? 'true' : 'false') + ',' + idx + ',' + (Date.now() - st.t0) + ')');
      if (st.pick) send('window.lzPick && lzPick(' + pos + ')');
    });
    p.on('error', (e) => { LOG('mpv: error', e && e.message); });
  }

  ipcMain.on('mpv-play', (e, json) => {
    let job; try { job = JSON.parse(json); } catch (err) { return; }
    if (!job.opts || !job.opts.length) return;
    stopCur();
    job.start = Math.max(0, Math.floor(job.start || 0));
    attempt(job, 0);
  });
  ipcMain.on('mpv-stop', () => stopCur());
  app.on('before-quit', stopCur);
};
