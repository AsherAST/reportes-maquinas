const express = require('express');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// --- HTTPS local (en nube la plataforma ya da HTTPS) ---
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

const PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const DB_FILE = path.join(__dirname, 'reportes.json');
const USERS_FILE = path.join(__dirname, 'usuarios.json');
const PAIRS_FILE = path.join(__dirname, 'pares.json');
const SOLIC_FILE = path.join(__dirname, 'solicitudes.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- storage ----------
function leerJSON(file, def) {
  try {
    if (!fs.existsSync(file)) return def;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { return def; }
}
function guardarJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
const leerDB = () => leerJSON(DB_FILE, []);
const guardarDB = (d) => guardarJSON(DB_FILE, d);
const leerUsers = () => leerJSON(USERS_FILE, []);
const guardarUsers = (d) => guardarJSON(USERS_FILE, d);
const leerPares = () => leerJSON(PAIRS_FILE, {});
const guardarPares = (d) => guardarJSON(PAIRS_FILE, d);
const leerSolic = () => leerJSON(SOLIC_FILE, []);
const guardarSolic = (d) => guardarJSON(SOLIC_FILE, d);

// migración una sola vez: pares viejos (auto-apareados) -> solicitudes aceptadas
(function migrarPares() {
  try {
    if (fs.existsSync(SOLIC_FILE)) return;
    const pares = leerPares();
    const keys = Object.keys(pares);
    if (!keys.length) return;
    const ahora = new Date();
    guardarSolic(keys.map((movil, i) => ({
      id: (Date.now() + i).toString(),
      movil, pc: pares[movil], estado: 'aceptada',
      fechaHora: ahora.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }),
      iso: ahora.toISOString(), timestamp: ahora.getTime()
    })));
  } catch {}
})();

// última solicitud entre un móvil y un pc (o del móvil en general)
function ultimaSolic(movil, pc) {
  const todas = leerSolic().filter(s => s.movil === movil && (!pc || s.pc === pc));
  return todas.sort((a, b) => b.timestamp - a.timestamp)[0] || null;
}
// pc con el que el móvil está efectivamente apareado (solicitud aceptada vigente)
function parejaActiva(movil) {
  const u = ultimaSolic(movil);
  return (u && u.estado === 'aceptada') ? u.pc : null;
}

// sesiones en memoria: token -> username
const sesiones = new Map();
function crearSesion(username) {
  const token = crypto.randomBytes(32).toString('hex');
  sesiones.set(token, { username, creado: Date.now() });
  return token;
}
function usuarioDeToken(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : (req.query.token || req.body.token || '');
  if (!token || !sesiones.has(token)) return null;
  const { username } = sesiones.get(token);
  const user = leerUsers().find(u => u.username === username);
  return user || null;
}
function normUser(s) { return (s || '').toLowerCase().trim(); }
function userValido(s) { return /^[a-z0-9._-]{3,20}$/.test(s || ''); }

// ---------- auth ----------
app.post('/api/auth/register', async (req, res) => {
  const username = normUser(req.body.username);
  const { password, role } = req.body;
  if (!userValido(username)) return res.status(400).json({ error: 'Usuario inválido (3-20: letras, números, . _ -)' });
  if (!password || password.length < 4) return res.status(400).json({ error: 'Clave mínima 4 caracteres' });
  if (!['pc', 'movil'].includes(role)) return res.status(400).json({ error: 'Rol debe ser pc o movil' });
  const users = leerUsers();
  if (users.some(u => u.username === username)) return res.status(409).json({ error: 'Ese usuario ya existe' });
  const passHash = await bcrypt.hash(password, 10);
  users.push({ username, passHash, role, creado: new Date().toISOString() });
  guardarUsers(users);
  const token = crearSesion(username);
  res.json({ ok: true, token, username, role });
});

app.post('/api/auth/login', async (req, res) => {
  const username = normUser(req.body.username);
  const { password } = req.body;
  const user = leerUsers().find(u => u.username === username);
  if (!user) return res.status(401).json({ error: 'Usuario o clave incorrectos' });
  const ok = await bcrypt.compare(password || '', user.passHash);
  if (!ok) return res.status(401).json({ error: 'Usuario o clave incorrectos' });
  const token = crearSesion(username);
  res.json({ ok: true, token, username: user.username, role: user.role, pairedPc: user.role === 'movil' ? parejaActiva(user.username) : null });
});

app.get('/api/auth/me', (req, res) => {
  const user = usuarioDeToken(req);
  if (!user) return res.status(401).json({ error: 'No autenticado' });
  const out = { username: user.username, role: user.role, pairedPc: null, pendingPc: null };
  if (user.role === 'movil') {
    out.pairedPc = parejaActiva(user.username);
    const u = ultimaSolic(user.username);
    if (u && u.estado === 'pendiente') out.pendingPc = u.pc;
  }
  res.json(out);
});

// ---------- solicitudes de apareamiento (el PC debe aceptar) ----------
// El móvil ENVÍA solicitud; nadie queda apareado hasta que el PC acepte.
app.post('/api/pair', (req, res) => {
  const user = usuarioDeToken(req);
  if (!user) return res.status(401).json({ error: 'No autenticado' });
  if (user.role !== 'movil') return res.status(403).json({ error: 'Solo cuentas de celular pueden solicitar' });
  const pcUsername = normUser(req.body.pcUsername);
  const users = leerUsers();
  const pc = users.find(u => u.username === pcUsername && u.role === 'pc');
  if (!pc) return res.status(404).json({ error: 'No existe cuenta PC con ese nombre' });
  const actual = parejaActiva(user.username);
  if (actual === pcUsername) return res.json({ ok: true, pairedPc: pcUsername, estado: 'aceptada' });
  if (actual) return res.status(400).json({ error: 'Ya estás apareado con ' + actual + '. Desaparéate primero.' });
  const previa = ultimaSolic(user.username, pcUsername);
  if (previa && previa.estado === 'pendiente') return res.json({ ok: true, estado: 'pendiente', pc: pcUsername });
  const fecha = new Date();
  const sol = {
    id: Date.now().toString(),
    movil: user.username, pc: pcUsername, estado: 'pendiente',
    fechaHora: fecha.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }),
    iso: fecha.toISOString(), timestamp: fecha.getTime()
  };
  const todas = leerSolic(); todas.push(sol); guardarSolic(todas);
  emitirA(roomPc(pcUsername), 'nueva-solicitud', sol);
  res.json({ ok: true, estado: 'pendiente', pc: pcUsername });
});

// ver solicitudes (pc: las dirigidas a él; movil: las propias)
app.get('/api/solicitudes', (req, res) => {
  const user = usuarioDeToken(req);
  if (!user) return res.status(401).json({ error: 'No autenticado' });
  const todas = leerSolic().sort((a, b) => b.timestamp - a.timestamp);
  if (user.role === 'pc') return res.json(todas.filter(s => s.pc === user.username));
  return res.json(todas.filter(s => s.movil === user.username));
});

// aceptar / rechazar (solo la cuenta PC dueña)
app.post('/api/solicitudes/:id/aceptar', (req, res) => {
  const user = usuarioDeToken(req);
  if (!user || user.role !== 'pc') return res.status(403).json({ error: 'Solo cuentas PC' });
  const todas = leerSolic();
  const sol = todas.find(s => s.id === req.params.id && s.pc === user.username);
  if (!sol) return res.status(404).json({ error: 'Solicitud no encontrada' });
  if (sol.estado !== 'pendiente') return res.status(400).json({ error: 'Ya fue ' + sol.estado });
  sol.estado = 'aceptada';
  guardarSolic(todas);
  emitirA(roomPc(user.username), 'solicitud-resuelta', sol);
  emitirA(roomMovil(sol.movil), 'solicitud-resuelta', sol);
  res.json({ ok: true, solicitud: sol });
});

app.post('/api/solicitudes/:id/rechazar', (req, res) => {
  const user = usuarioDeToken(req);
  if (!user || user.role !== 'pc') return res.status(403).json({ error: 'Solo cuentas PC' });
  const todas = leerSolic();
  const sol = todas.find(s => s.id === req.params.id && s.pc === user.username);
  if (!sol) return res.status(404).json({ error: 'Solicitud no encontrada' });
  if (sol.estado !== 'pendiente') return res.status(400).json({ error: 'Ya fue ' + sol.estado });
  sol.estado = 'rechazada';
  guardarSolic(todas);
  emitirA(roomMovil(sol.movil), 'solicitud-resuelta', sol);
  res.json({ ok: true, solicitud: sol });
});

// desaparecer: el móvil cancela/desaparece; el PC puede expulsar un móvil
app.delete('/api/pair', (req, res) => {
  const user = usuarioDeToken(req);
  if (!user) return res.status(401).json({ error: 'No autenticado' });
  const todas = leerSolic();
  // OJO: buscar dentro de `todas` (no con ultimaSolic, que lee copia nueva)
  const pick = (movil, pc) => todas
    .filter(s => s.movil === movil && (!pc || s.pc === pc))
    .sort((a, b) => b.timestamp - a.timestamp)[0] || null;
  if (user.role === 'movil') {
    const u = pick(user.username);
    if (!u || (u.estado !== 'pendiente' && u.estado !== 'aceptada'))
      return res.status(400).json({ error: 'No tienes apareamiento activo' });
    u.estado = u.estado === 'pendiente' ? 'cancelada' : 'revocada';
    guardarSolic(todas);
    emitirA(roomPc(u.pc), 'solicitud-resuelta', u);
    return res.json({ ok: true });
  }
  const movil = normUser((req.body && req.body.movil) || req.query.movil);
  const u = pick(movil, user.username);
  if (!u || u.estado !== 'aceptada') return res.status(400).json({ error: 'Ese móvil no está apareado contigo' });
  u.estado = 'revocada';
  guardarSolic(todas);
  emitirA(roomMovil(movil), 'solicitud-resuelta', u);
  return res.json({ ok: true });
});

// ---------- reportes con cuentas ----------
app.get('/api/reportes', (req, res) => {
  const user = usuarioDeToken(req);
  if (!user) return res.status(401).json({ error: 'No autenticado' });
  const todos = leerDB();
  let lista;
  if (user.role === 'pc') lista = todos.filter(r => r.para === user.username);
  else lista = todos.filter(r => r.de === user.username);
  res.json(lista.sort((a, b) => b.timestamp - a.timestamp));
});

app.post('/api/reportes', (req, res) => {
  const user = usuarioDeToken(req);
  // modo legacy (sin token, app vieja con código): se mantiene
  if (!user) {
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
    const db = leerDB(); db.push(reporte); guardarDB(db);
    emitirReporte(reporte);
    return res.json({ ok: true, reporte });
  }
  // modo cuentas
  if (user.role !== 'movil') return res.status(403).json({ error: 'Solo cuentas de celular envían reportes' });
  const para = parejaActiva(user.username);
  if (!para) {
    const u = ultimaSolic(user.username);
    if (u && u.estado === 'pendiente') return res.status(400).json({ error: 'Tu solicitud a ' + u.pc + ' aún no fue aceptada' });
    return res.status(400).json({ error: 'Sin apareamiento aprobado. Envía solicitud a una cuenta PC.' });
  }
  const { maquina, texto } = req.body;
  if (!texto || !texto.trim()) return res.status(400).json({ error: 'Falta texto' });
  const fecha = new Date();
  const reporte = {
    id: Date.now().toString(),
    para,
    de: user.username,
    maquina: (maquina || 'Sin especificar').trim(),
    operario: user.username,
    texto: texto.trim(),
    fechaHora: fecha.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }),
    iso: fecha.toISOString(),
    timestamp: fecha.getTime()
  };
  const db = leerDB(); db.push(reporte); guardarDB(db);
  emitirReporte(reporte);
  res.json({ ok: true, reporte });
});

// legacy: listar por código (app vieja)
app.get('/api/reportes/:codigo', (req, res) => {
  const codigo = (req.params.codigo || '').toUpperCase().trim();
  const todos = leerDB();
  res.json(todos.filter(r => r.codigo === codigo).sort((a, b) => b.timestamp - a.timestamp));
});

// ---------- sockets ----------
function roomPc(username) { return 'pc:' + username; }
function roomMovil(username) { return 'movil:' + username; }
function setupSockets(ioInst) {
  ioInst.on('connection', (socket) => {
    // legacy por código
    socket.on('unirse', (codigo) => {
      codigo = (codigo || '').toUpperCase().trim();
      if (!codigo) return;
      socket.join(codigo);
    });
    // por cuenta: el cliente envía su token y entra a su sala
    socket.on('auth', (token) => {
      token = (token || '').trim();
      if (!token || !sesiones.has(token)) return;
      const { username } = sesiones.get(token);
      const user = leerUsers().find(u => u.username === username);
      if (!user) return;
      if (user.role === 'pc') socket.join(roomPc(user.username));
      else socket.join(roomMovil(user.username));
    });
  });
}
function emitirA(room, evento, dato) {
  for (const inst of [io, ioHttps].filter(Boolean)) inst.to(room).emit(evento, dato);
}
function emitirReporte(reporte) {
  const rooms = [];
  if (reporte.codigo) rooms.push(reporte.codigo);
  if (reporte.para) rooms.push(roomPc(reporte.para));
  for (const inst of [io, ioHttps].filter(Boolean)) {
    for (const r of rooms) inst.to(r).emit('nuevo-reporte', reporte);
  }
}

// IP local de este PC para que el celular se conecte
app.get('/api/mi-ip', (req, res) => {
  const ips = [];
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const n of nets || []) {
      if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
    }
  }
  res.json({ ips, http: ips.map(ip => `http://${ip}:${PORT}/movil.html`) });
});

// Rutas páginas
app.get('/', (req, res) => res.redirect('/pc.html'));
app.get('/movil', (req, res) => res.sendFile(path.join(__dirname, 'public', 'movil.html')));
app.get('/pc', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pc.html')));

setupSockets(io);
if (ioHttps) setupSockets(ioHttps);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ HTTP listo en http://localhost:${PORT}`);
});
if (httpsServer) {
  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`🔒 HTTPS listo en https://localhost:${HTTPS_PORT}`);
  });
}
