const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

// Una sola instancia: si ya está abierto, enfoca esa ventana y cierra la nueva
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  // eslint-disable-next-line no-undef
  return;
}

let serverProc = null;
let mainWin = null;

function startServer() {
  serverProc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, { PORT: '3000' })
  });
  serverProc.stdout.on('data', (d) => console.log('[server]', d.toString().trim()));
  serverProc.stderr.on('data', (d) => console.log('[server-err]', d.toString().trim()));
}

// Espera a que el servidor responda antes de mostrar la ventana
function serverReady(tries) {
  tries = tries || 0;
  return new Promise((resolve) => {
    const r = http.get('http://127.0.0.1:3000/api/auth/me', () => resolve(true));
    r.on('error', () => {
      if (tries >= 30) return resolve(false);
      setTimeout(() => resolve(serverReady(tries + 1)), 1000);
    });
    r.setTimeout(2000, () => r.destroy());
  });
}

async function createWindow() {
  if (mainWin) {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.focus();
    return;
  }
  mainWin = new BrowserWindow({
    width: 1024,
    height: 768,
    autoHideMenuBar: true,
    title: 'Reportes Máquinas - PC',
    show: false
  });
  mainWin.on('closed', () => { mainWin = null; });
  const ok = await serverReady();
  if (!ok) {
    mainWin.loadURL('data:text/html,<h2>No se pudo iniciar el servidor local</h2><p>Reabre la app.</p>');
  } else {
    mainWin.loadURL('http://127.0.0.1:3000/pc.html');
  }
  mainWin.once('ready-to-show', () => mainWin && mainWin.show());
}

app.on('second-instance', () => {
  if (mainWin) {
    if (mainWin.isMinimized()) mainWin.restore();
    mainWin.focus();
  }
});

app.whenReady().then(() => {
  startServer();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (serverProc) serverProc.kill();
  if (process.platform !== 'darwin') app.quit();
});
