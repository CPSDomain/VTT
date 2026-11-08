// Headless server: `node server.js` (for running on a spare PC or VPS without the DM app).
// Settings via environment: PORT (default 3000), DM_KEY (random if unset), DATA_DIR (default ./data)
const path = require('path');
const os = require('os');
const { startServer } = require('./src/server');

startServer({
  port: Number(process.env.PORT) || 3000,
  dmKey: process.env.DM_KEY,
  dataDir: process.env.DATA_DIR || path.join(__dirname, 'data')
}).then((s) => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log(`Tabletop ${s.version} running on port ${s.port}`);
  console.log(`DM link:   http://localhost:${s.port}/?dm=${s.dmKey}`);
  console.log(`Players:   ${ips.map((ip) => `${ip}:${s.port}`).join('  ') || `localhost:${s.port}`}`);
  const stop = () => s.close().then(() => process.exit(0));
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}).catch((e) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${process.env.PORT || 3000} is already in use. Set PORT to another number.` : e.message);
  process.exit(1);
});
