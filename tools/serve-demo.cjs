// Local audit server: serves only the six immutable exports. This is not a SaaS backend.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../standalone');
const aliases = {
  '/': 'Nuqta - Demo Launcher.html',
  '/DemoLauncher.dc.html': 'Nuqta - Demo Launcher.html',
  '/SuperAdmin.dc.html': 'Nuqta - Super Admin.html',
  '/MerchantDashboard.dc.html': 'Nuqta - Merchant Dashboard.html',
  '/CashierPortal.dc.html': 'Nuqta - Cashier Portal.html',
  '/CustomerPortal.dc.html': 'Nuqta - Customer Portal.html',
  '/DesignSystem.dc.html': 'Nuqta - Design System.html',
};
const originals = new Set(fs.readdirSync(root).filter(f => f.endsWith('.html')));
const port = Number(process.env.DEMO_PORT || 4173);
const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400).end(); return; }
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
  if (pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
  const file = aliases[pathname] || (originals.has(pathname.slice(1)) ? pathname.slice(1) : null);
  if (!file) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Demo asset not found'); return; }
  const bytes = fs.readFileSync(path.join(root, file));
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': bytes.length, 'Cache-Control': 'no-store' });
  res.end(req.method === 'HEAD' ? undefined : bytes);
});
server.on('error', err => { console.error(err.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Nuqta demo: http://127.0.0.1:${port} (Ctrl+C to stop)`));
module.exports = server;
