# Dilli Theft Auto

Arcade racing on the real streets of Delhi, in the browser.

Race from Rashtrapati Bhavan to India Gate, around Connaught Place, past the
Chanakyapuri embassies, or over the Yamuna to Laxmi Nagar and Akshardham. The
city is built from OpenStreetMap and Overture data: 23,000 roads, 166,000
buildings, Metro trains on their real lines and 2,500 street-food stalls.

- 7 races, Explore mode (find 12 cups of chai) and Watch a Run
- Multiplayer rooms for 2–8 players and a leaderboard (needs the Node server)
- Keyboard, gamepad and touch

## Run

```sh
npm install
npm run dev                  # http://localhost:5173
npm run build && npm start   # production on http://localhost:3000
```

Static hosts (such as GitHub Pages) run single player only.

## Controls

W A S D or arrows to drive · Shift boost · Space drift · H horn · C camera ·
Q back to the road · R restart · Esc pause

## Rebuild the map

```sh
npm run fetch-map                          # OSM → data-raw/
.venv/bin/python tools/fetch-buildings.py  # Overture buildings (pip install duckdb)
npm run map                                # → public/data/
```

Races are defined in `tools/courses.json`.

## Credits

- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, [ODbL](https://opendatacommons.org/licenses/odbl/1-0/).
- Buildings from [Overture Maps](https://overturemaps.org), including Google Open Buildings (CC BY 4.0) and Microsoft Building Footprints (ODbL). See `public/data/ATTRIBUTION.md`.
- Inspired by [San Theft Auto](https://santheftauto.com). No code or assets from it are used.

Code: [MIT](LICENSE). The map data in `public/data/` stays under its own licences.
