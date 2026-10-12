[out:json][timeout:300][bbox:28.578,77.158,28.670,77.322];
(
  relation["route"~"^(subway|light_rail)$"];
  node["railway"="station"];
  node["public_transport"="station"];
  node["railway"="subway_entrance"];
  node["amenity"~"^(marketplace|fast_food|food_court)$"];
  way["amenity"="marketplace"];
);
out geom;
