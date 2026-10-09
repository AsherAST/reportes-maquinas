const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let serverProc = null;

function startServer() {
  serverProc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, { PORT: '3000' })
  });
  serverProc.stdout.on('data', (d) => console.log('[server]', d.toString().trim()));
  serverProc.stderr.on('data', (d) => console.log('[server-err]', d.toString().trim()));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    autoHideMenuBar: true,
    title: 'Reportes Máquinas - PC'
  });
  win.loadURL('http://127.0.0.1:3000/pc.html');
}

app.whenReady().then(() => {
  startServer();
  setTimeout(createWindow, 2000);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (serverProc) serverProc.kill();
  if (process.platform !== 'darwin') app.quit();
});
