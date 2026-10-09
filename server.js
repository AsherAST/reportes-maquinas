const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// --- HTTPS para que Android permita el micrófono ---
let ioHttps = null;
let httpsServer = null;
try {
  const keyPath = path.join(__dirname, 'key.pem');
  const certPath = path.join(__dirname, 'cert.pem');
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    httpsServer = https.createServer({
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath)
    }, app);
    ioHttps = new Server(httpsServer, { cors: { origin: '*' } });
  }
} catch(e) { console.log('Sin HTTPS:', e.message); }

function setupSockets(ioInst) {
  ioInst.on('connection', (socket) => {
    socket.on('unirse', (codigo) => {
      codigo = (codigo || '').toUpperCase().trim();
      if (!codigo) return;
      socket.join(codigo);
      socket.to(codigo).emit('equipo-conectado', { id: socket.id });
    });
  });
}
function emitirReporte(reporte) {
  io.to(reporte.codigo).emit('nuevo-reporte', reporte);
  if (ioHttps) ioHttps.to(reporte.codigo).emit('nuevo-reporte', reporte);
}

const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const DB_FILE = path.join(__dirname, 'reportes.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- storage simple en JSON ---
function leerDB() {
  try {
    if (!fs.existsSync(DB_FILE)) return [];
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch { return []; }
}
function guardarDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// Rutas páginas
app.get('/', (req, res) => res.redirect('/pc.html'));
app.get('/movil', (req, res) => res.sendFile(path.join(__dirname, 'public', 'movil.html')));
app.get('/pc', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pc.html')));

// API: listar reportes por código de apareamiento
app.get('/api/reportes/:codigo', (req, res) => {
  const codigo = (req.params.codigo || '').toUpperCase().trim();
  const todos = leerDB();
  res.json(todos.filter(r => r.codigo === codigo).sort((a,b) => b.timestamp - a.timestamp));
});

// API: crear reporte (también lo emite por socket)
app.post('/api/reportes', (req, res) => {
  const { codigo, maquina, operario, texto } = req.body;
  if (!codigo || !texto) return res.status(400).json({ error: 'Falta código o texto' });

  const fecha = new Date();
  const reporte = {
    id: Date.now().toString(),
    codigo: codigo.toUpperCase().trim(),
    maquina: (maquina || 'Sin especificar').trim(),
    operario: (operario || 'Sin nombre').trim(),
    texto: texto.trim(),
    fechaHora: fecha.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }),
    iso: fecha.toISOString(),
    timestamp: fecha.getTime()
  };
  const db = leerDB();
  db.push(reporte);
  guardarDB(db);

  emitirReporte(reporte);
  res.json({ ok: true, reporte });
});

// Sockets: apareamiento por código (room)
setupSockets(io);
if (ioHttps) setupSockets(ioHttps);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ HTTP listo en http://localhost:${PORT}`);
  console.log(`📱 Móvil HTTP: http://localhost:${PORT}/movil.html`);
  console.log(`🖥️  PC HTTP:    http://localhost:${PORT}/pc.html`);
});
if (httpsServer) {
  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`🔒 HTTPS listo en https://localhost:${HTTPS_PORT}`);
    console.log(`📱 Móvil HTTPS (para micro en Android): https://192.168.1.2:${HTTPS_PORT}/movil.html`);
    console.log(`🖥️  PC HTTPS: https://192.168.1.2:${HTTPS_PORT}/pc.html`);
  });
}
