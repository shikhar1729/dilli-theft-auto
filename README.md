# Dilli Theft Auto

A browser racing game on the real streets of Delhi. Race solo or with friends
down Raisina Hill and Kartavya Path to India Gate, through the Chanakyapuri
embassy district, or across the Yamuna to Laxmi Nagar, Patparganj and Akshardham.

The map covers about 16 × 10 km: Lutyens' Delhi, Chanakyapuri, Connaught Place,
Paharganj, Nizamuddin and Pragati Maidan on the west bank, and Laxmi Nagar,
Shakarpur, Patparganj and IP Extension, Madhu Vihar, Preet Vihar, Mayur Vihar
and the Yamuna Sports Complex on the east bank. Roads, parks, water and rail come
from OpenStreetMap. The buildings combine OpenStreetMap (about 44,000, with names,
heights and 3D parts) with Google and Microsoft footprints from Overture Maps
(about 123,000 more), so almost every building in the area is present.

**Play online:** https://shikhar1729.github.io/dilli-theft-auto/ (single player,
Explore Delhi and Watch a Run). Multiplayer rooms and the global leaderboard need
the game server, so run it yourself to race friends (see below).

## Run it

Use Node 20 or later.

```sh
npm install
npm run dev        # http://localhost:5173 — includes multiplayer rooms and the leaderboard
```

Production:

```sh
npm run build
npm start          # http://localhost:3000 — serves dist/, rooms on /ws, leaderboard API
```

`PORT=8080 npm start` changes the port. The leaderboard is stored in
`.leaderboard.json` in the project folder.

### GitHub Pages

`.github/workflows/pages.yml` builds the game and publishes `dist/` to GitHub Pages
on every push to `main` (Settings → Pages → Source: GitHub Actions). Pages is
static hosting, so the game detects that there is no server and offers single
player only. For multiplayer, run `npm start` on any Node host (for example a
small VPS, Render or Fly.io) and open that address instead.

## Modes

| Mode | What you do |
| --- | --- |
| Single player | Pick a driver, car, paint and decal, then race for your best time. |
| Multiplayer | Create a private room for 2–8 players, share the link or code, and race together. The host starts when everyone is ready, and can call a rematch. |
| Explore Delhi | Drive anywhere on the map and find twelve cups of chai, from India Gate to Akshardham. A pointer on the minimap leads to the nearest one. |
| Watch a Run | The autopilot races the course. Jump to scenic views of the landmarks and drag to look around. |

**Delhi Metro:** Blue, Yellow, Violet, Pink, Green, Red and Airport Express trains, and
the RapidX (Namo Bharat), run on their real routes from OpenStreetMap, in their line
colours. They stop at stations, ride the elevated viaducts over Vikas Marg, NH24
and Mayur Vihar, and disappear into tunnels where the line goes underground.

**Street food:** about 2,500 thelas and stalls (chhole kulche, shikanji, golgappe,
chai, momos, bhutta, kulfi) stand on footpaths near markets, Metro exits, eateries
and landmarks. Stop next to one for a pit stop: your boost is refilled.

## Races

| Race | Route | Length |
| --- | --- | --- |
| Raisina Run | Rashtrapati Bhavan → Kartavya Path → India Gate (C-Hexagon) → KG Marg → Connaught Place | 5.1 km |
| Janpath Dash | Connaught Place → Janpath → Windsor Place → Kartavya Path → India Gate | 2.8 km |
| CP Circuit | Two laps of the Connaught Place Outer Circle | 4.0 km |
| Yamuna Paar | ITO → Vikas Marg bridge over the Yamuna → Laxmi Nagar → Nirman Vihar → Preet Vihar | 5.6 km |
| Akshardham Express | Nizamuddin → NH24 bridge over the Yamuna → Akshardham | 3.3 km |
| Madhu Vihar Mile | Madhu Vihar → Swami Dayanand Marg → Karkari Mor → Yamuna Sports Complex | 5.7 km |
| Shanti Path Sprint | Teen Murti → Shanti Path past the embassies → Chanakyapuri | 3.4 km |

Each route is computed on the OpenStreetMap road graph by `tools/build-map.mjs`.
Checkpoint garlands are spaced about every 450 m. The next-turn card shows real
street names.

**Kite jumps:** yellow-and-black barricade ramps sit on long straights. Hit one, or
the crest of Raisina Hill, above 87 km/h (54 mph) and kites open. Glide, hold
Shift to climb, press S to dive, and fly through marigold rings to refill boost.

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Accelerate | W / ↑ | RT or A |
| Steer | A D / ← → | Left stick |
| Brake, reverse, dive | S / ↓ | LT |
| Boost, lift in flight | Shift | X or RB |
| Drift | Space | B |
| Horn | H | D-pad up |
| Camera | C | LB |
| Recover to the road | Q | Y |
| Restart / pause / mute | R / Esc / M | Back / Start |

Touch controls appear on phones and tablets. **How to play** has settings for
auto-accelerate, graphics quality, km/h or mph, fullscreen and best-time reset.

## What is in the city

- **Map:** 23,000 roads with flyovers and the Yamuna bridges, 166,000 buildings,
  parks, the Kartavya Path canals, the Yamuna, the railway near New Delhi station
  and the elevated Metro viaducts over Vikas Marg and NH24. India drives on the
  left, so traffic keeps left. Drive into the Yamuna and you are put back on the road.
- **Streaming:** the city loads in 1 km tiles around you, so the start is quick and
  the frame rate holds across the whole area.
- **Building heights:** taken from OSM where mapped. Elsewhere they follow each
  district: one- and two-storey bungalows in Lutyens' Delhi and Chanakyapuri, three-
  and four-storey houses in Laxmi Nagar and Madhu Vihar, taller blocks in the
  Patparganj and IP Extension societies.
- **Landmarks (hand-built models at their mapped positions):** India Gate with a
  drivable main arch and side arches, the Canopy and statue, the National War
  Memorial obelisk, the Rashtrapati Bhavan dome and Jaipur Column, the North and
  South Block domes, the Samrat Yantra at Jantar Mantar, Gurudwara Bangla Sahib's
  golden domes and Nishan Sahib, the giant tricolour in Central Park, CP,
  Akshardham on its elephant plinth, and Humayun's Tomb. Tombs and mosques in the
  map data get domes automatically.
- **Lutyens' Delhi and Chanakyapuri:** white bungalows in green compounds behind
  compound walls (from OSM), embassy buildings in a modern style, and avenue and
  compound trees.
- **Styles:** Connaught Place's white colonnades, red and buff sandstone on
  Raisina Hill, Lutyens bungalows, pastel apartments, glass towers on KG Marg and
  Barakhamba Road, and black water tanks on rooftops.
- **Street life:** avenue trees (neem, jamun, Ashoka, gulmohar and amaltas), street
  lamps, black-and-yellow kerbs, auto-rickshaws, buses, cars, taxis and a few cows.
- **Sound:** synthesised engine, tyres, wind, boost and two-tone horns, with
  distant honking. No audio files.

Raisina Hill rises about 13 m. Its east slope is a little steeper than the real one
so the crest can launch a car. Everything else is at real scale.

## Drivers and cars

All seven drivers are original, fictional characters (Bunty, Pinky Aunty,
Harpreet, Raju, Meera, Dadi and Vicky). The four cars are original, unbranded
designs: the Kaali Peeli taxi, the Tuk-Tuk auto-rickshaw, the Gulmohar roadster
and the Ridge Runner jeep. All cars and drivers perform the same.

## Project layout

| Area | Files |
| --- | --- |
| Map pipeline | `tools/delhi.overpassql`, `tools/fetch-osm.mjs`, `tools/fetch-buildings.py`, `tools/build-map.mjs`, `tools/courses.json` → `public/data/delhi.json` and `public/data/tiles/` |
| World | `src/world/` (tile streaming and building, landmarks, ground, sky), `src/terrain.ts`, `src/map.ts` |
| Driving | `src/physics.ts` (fixed 120 Hz arcade simulation), `src/input.ts`, `src/camera.ts` |
| Racing | `src/race.ts` (courses, checkpoints, turn cues, ramps, rings), `src/autopilot.ts` |
| Vehicles and drivers | `src/vehicles/` |
| Traffic | `src/traffic.ts` |
| UI | `src/ui.ts`, `src/showroom.ts`, `src/minimap.ts`, `src/style.css` |
| Multiplayer | `src/multiplayer.ts` (client), `server/game-server.mjs` (rooms and leaderboard), `server/index.mjs` |

### Rebuild the map

```sh
npm run fetch-map                       # OSM extract → data-raw/slices/ (Overpass API)
python3 -m venv .venv && .venv/bin/pip install duckdb
.venv/bin/python tools/fetch-buildings.py # Overture footprints → data-raw/overture-buildings.ndjson
npm run map                             # → public/data/delhi.json and public/data/tiles/
```

The area is set in `tools/fetch-osm.mjs`, `tools/fetch-buildings.py` and
`tools/build-map.mjs`. Races are defined in `tools/courses.json`: each leg names
the streets it should follow, and the build routes along them.

## Credits

- Map data © OpenStreetMap contributors, under the
  [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
- Building footprints from [Overture Maps](https://overturemaps.org), including
  Google Open Buildings (CC BY 4.0) and Microsoft ML Building Footprints (ODbL).
  See `public/data/ATTRIBUTION.md`.
- Built with [three.js](https://threejs.org), [Vite](https://vitejs.dev) and
  [ws](https://github.com/websockets/ws).
- Inspired by [San Theft Auto](https://santheftauto.com), Nader Khalil's San Francisco
  racing game. This is a separate implementation. No code, models, art,
  characters or audio from that project are used.
