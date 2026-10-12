// Assembles the world: global ground, landmarks and sky, plus streamed city tiles.
import * as THREE from 'three';
import { MapData, RoadNetwork, WallIndex, AreaIndex } from '../map';
import { Surfaces } from './surfaces';
import { buildLandmarks, Landmarks } from './landmarks';
import { buildSky, Sky } from './sky';
import { buildGround } from './ground';
import { TileManager } from './tiles';
import { materials } from './materials';

export interface World {
  scene: THREE.Scene;
  map: MapData;
  roads: RoadNetwork;
  walls: WallIndex;
  surfaces: Surfaces;
  areas: AreaIndex;
  tiles: TileManager;
  landmarks: Landmarks;
  sky: Sky;
  update(t: number): void;
}

const frame = () => new Promise((r) => { requestAnimationFrame(() => r(null)); setTimeout(() => r(null), 50); });

export async function buildWorld(map: MapData, step: (label: string) => void): Promise<World> {
  const scene = new THREE.Scene();
  step('Laying the roads of Lutyens’ Delhi');
  await frame();
  const roads = new RoadNetwork(map.roads);
  const walls = new WallIndex();
  const surfaces = new Surfaces(roads);
  const areas = new AreaIndex(map.areas);
  const sky = buildSky(scene);
  scene.add(sky.group);
  const tiles = new TileManager(map, roads, walls);
  scene.add(tiles.group);

  step('Filling the Yamuna');
  await frame();
  scene.add(buildGround(map, tiles.globalAreas));

  step('Carving India Gate and Akshardham');
  await frame();
  const landmarks = buildLandmarks(map, walls, surfaces);
  scene.add(landmarks.group);

  const M = materials();
  return {
    scene, map, roads, walls, surfaces, areas, tiles, landmarks, sky,
    update(t) {
      M.waterNormal.offset.set(t * 0.02, t * 0.013);
      landmarks.update(t);
    },
  };
}
