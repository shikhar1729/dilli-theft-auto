// Production server: serves the built game from dist/, multiplayer rooms on /ws,
// and the leaderboard API. Run `npm run build` first, then `npm start`.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { createGameServer } from './game-server.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT) || 3000;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.md': 'text/markdown; charset=utf-8', '.ico': 'image/x-icon',
};

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('dist/ not found. Run `npm run build` first.');
  process.exit(1);
}

const game = createGameServer({ dataDir: ROOT });
const server = http.createServer(async (req, res) => {
  try {
    if (await game.handleApi(req, res)) return;
    const url = new URL(req.url, 'http://x');
    let file = path.normalize(path.join(DIST, decodeURIComponent(url.pathname)));
    if (!file.startsWith(DIST)) { res.statusCode = 403; res.end(); return; }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
    const ext = path.extname(file);
    res.setHeader('Content-Type', TYPES[ext] || 'application/octet-stream');
    if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    else if (file.includes(`${path.sep}data${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=3600');
    // Map data and scripts compress very well (about 4x for the tile JSON).
    if (['.json', '.js', '.css', '.html', '.svg'].includes(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Vary', 'Accept-Encoding');
      fs.createReadStream(file).pipe(zlib.createGzip({ level: 6 })).pipe(res);
    } else fs.createReadStream(file).pipe(res);
  } catch (e) {
    res.statusCode = 500;
    res.end('Server error');
  }
});
server.on('upgrade', (req, socket, head) => { if (!game.handleUpgrade(req, socket, head)) socket.destroy(); });
server.listen(PORT, () => console.log(`Dilli Theft Auto running at http://localhost:${PORT}`));
