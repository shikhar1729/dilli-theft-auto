# Map data

`delhi.json` and the files in `tiles/` are derived from:

- **OpenStreetMap** — roads, named buildings and their 3D parts, parks, water,
  rail, walls and trees. © OpenStreetMap contributors, available under the Open
  Database License (ODbL) 1.0: https://www.openstreetmap.org/copyright
- **Overture Maps Foundation** building footprints (release 2026-09-23.1), which add
  buildings that OSM has not mapped yet from:
  - Google Open Buildings — CC BY 4.0 / ODbL
  - Microsoft ML Building Footprints — ODbL
  See https://docs.overturemaps.org/attribution/

The data was extracted with `tools/delhi.overpassql` and `tools/fetch-buildings.py`,
and converted by `tools/build-map.mjs` (projection to metres, simplification,
building heights and styles, trees, and race routes computed on the road graph).
This derived database is likewise available under the ODbL 1.0.
