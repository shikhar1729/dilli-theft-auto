// Downloads the OpenStreetMap extract used by the game, in longitude slices so
// each Overpass request stays small. Usage: npm run fetch-map (then npm run map).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BBOX = { south: 28.578, west: 77.158, north: 28.670, east: 77.322 };
// [south, west, north, east] rectangles small enough for public Overpass servers.
const RECTS = [
  ...[77.158, 77.200, 77.240, 77.272, 77.297].map((w, i, a) => [28.578, w, 28.662, a[i + 1] ?? 77.322]),
  [28.662, 77.158, 28.670, 77.240],
  [28.662, 77.240, 28.670, 77.322],
];
const template = fs.readFileSync(path.join(ROOT, 'tools/delhi.overpassql'), 'utf8');
const outDir = path.join(ROOT, 'data-raw/slices');
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
fs.mkdirSync(outDir, { recursive: true });

for (let i = 0; i < RECTS.length; i++) {
  const file = path.join(outDir, `slice-${i}.json`);
  if (fs.existsSync(file) && fs.statSync(file).size > 1000 && !process.argv.includes('--force')) { console.log(`slice ${i}: cached`); continue; }
  const bbox = RECTS[i].join(',');
  const query = template.replace(/\[bbox:[^\]]+\]/, `[bbox:${bbox}]`);
  let ok = false;
  for (let attempt = 0; attempt < 10 && !ok; attempt++) {
    const endpoint = ENDPOINTS[attempt % ENDPOINTS.length];
    console.log(`slice ${i} (${bbox}) via ${new URL(endpoint).host}…`);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': 'DilliTheftAuto-mapbuild/0.2' },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(660000),
      });
      const body = Buffer.from(await res.arrayBuffer());
      if (res.ok && body[0] === 0x7b && body.includes('"elements"')) {
        fs.writeFileSync(file, body);
        console.log(`  saved ${(body.length / 1e6).toFixed(1)} MB`);
        ok = true;
      } else console.log(`  failed (${res.status})`);
    } catch (e) {
      console.log(`  error: ${e.cause?.code || e.message}`);
    }
    if (!ok) await new Promise((r) => setTimeout(r, 15000));
  }
  if (!ok) { console.error(`slice ${i} could not be downloaded`); process.exit(1); }
}
console.log('Done. Now run: npm run map');
