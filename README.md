# Reportes de Máquinas por Voz - MVP

App móvil (Android) -> PC apareado, con transcripción por voz + fecha/hora + envío automático.

## Cómo funciona
1. PC abre `pc.html`, elige código ej: `PLANTA-123`
2. Celular Android (Chrome) abre `http://TU-IP-PC:3000/movil.html`, escribe el MISMO código
3. En el celular: escribe máquina + operario, presiona 🎙️, habla, presiona detener, presiona ✅ FINALIZAR Y ENVIAR
4. El reporte llega SOLO al PC en tiempo real, con fecha y hora. En el PC puedes exportar CSV.

Transcripción gratis: usa el reconocimiento de voz de Android/Chrome (es-ES), sin pagar APIs.

## Probar en tu red
```bash
cd reportes-maquinas-mvp
npm install
npm start
```
- PC: http://localhost:3000/pc.html
- Para el celular: averigua la IP del PC (`ipconfig` en Windows) ej: 192.168.1.10
  Celular (mismo WiFi): http://192.168.1.10:3000/movil.html

En el celular usa Chrome, acepta permiso de micrófono.

## Para internet (fuera del WiFi local)
Sube esta carpeta a Render / Railway / VPS y ambos entran a la misma URL pública:
- `https://tu-app.onrender.com/pc.html`
- `https://tu-app.onrender.com/movil.html`

## Siguiente paso a APK nativa
Si quieres icono instalable como app:
1. Lo envolvemos con Capacitor o TWA (te genero el APK)
2. O migramos a Expo para botón nativo + grabación offline

Dime y lo hacemos.
