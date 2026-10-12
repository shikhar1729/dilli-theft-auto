"""Downloads Overture Maps building footprints for the game's map area.

Overture merges OpenStreetMap with Google Open Buildings and Microsoft ML Buildings,
which fill in the many Delhi buildings that OSM has not mapped yet.

Usage (needs Python 3.9+ and network access):
    python3 -m venv .venv && .venv/bin/pip install duckdb
    .venv/bin/python tools/fetch-buildings.py
Then run: npm run map
"""
import os
import time

import duckdb

RELEASE = os.environ.get("OVERTURE_RELEASE", "2026-09-23.1")
WEST, SOUTH, EAST, NORTH = 77.158, 28.578, 77.322, 28.670
OUT = os.path.join(os.path.dirname(__file__), "..", "data-raw", "overture-buildings.ndjson")

t = time.time()
con = duckdb.connect()
for stmt in ["INSTALL httpfs", "LOAD httpfs", "INSTALL spatial", "LOAD spatial", "SET s3_region='us-west-2'"]:
    con.execute(stmt)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
con.execute(f"""
COPY (
  SELECT id, height, num_floors, min_height, class, subtype, roof_shape, roof_color, facade_color,
         sources[1].dataset AS src, names.primary AS name, ST_AsGeoJSON(geometry) AS geom
  FROM read_parquet('s3://overturemaps-us-west-2/release/{RELEASE}/theme=buildings/type=building/*', hive_partitioning=1)
  WHERE bbox.xmin > {WEST} AND bbox.xmax < {EAST} AND bbox.ymin > {SOUTH} AND bbox.ymax < {NORTH}
) TO '{OUT}' (FORMAT JSON)
""")
print(f"saved {OUT} in {time.time() - t:.0f} s")
