// Shared materials and colour palettes for the streamed city tiles.
import * as THREE from 'three';
import { asphaltTexture, groundTexture, grassTexture, pavingTexture, facadeTextures, waterNormalTexture, toTexture } from '../textures';
import { AREA } from '../map';

/** Overlay material that sits on the ground without z-fighting. */
export function overlay<T extends THREE.Material>(mat: T, layer: number): T {
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -1 - layer * 0.5;
  mat.polygonOffsetUnits = -4 * (layer + 1);
  return mat;
}

function stripeTexture(a: string, b: string) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 8;
  const g = c.getContext('2d')!;
  g.fillStyle = a; g.fillRect(0, 0, 32, 8);
  g.fillStyle = b; g.fillRect(32, 0, 32, 8);
  return toTexture(c);
}
function dashTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 4;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f4f1e8'; g.fillRect(0, 0, 26, 4);
  return toTexture(c);
}

function facadeMaterial(tex: THREE.Texture) {
  const m = new THREE.MeshLambertMaterial({ map: tex, vertexColors: true });
  // Ground floor and upper floors use different halves of the texture.
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
        vec2 fuv = vMapUv;
        float fl = floor(fuv.y + 0.002);
        vec2 tuv = vec2(fract(fuv.x), fract(fuv.y) * 0.5 + (fl < 0.5 ? 0.0 : 0.5));
        vec2 gx = dFdx(fuv) * vec2(1.0, 0.5), gy = dFdy(fuv) * vec2(1.0, 0.5);
        vec4 sampledDiffuseColor = textureGrad(map, tuv, gx, gy);
        diffuseColor *= sampledDiffuseColor;
      #endif`,
    );
  };
  return m;
}

export const KIND_COLORS: string[][] = [
  ['#f1e6d2', '#f4d9c6', '#efe3b5', '#dfe8e3', '#f2d1cf', '#e9dcc9', '#d9e2ec', '#f5e1a4', '#e8d5f0', '#d4ecd0'], // 0 plaster: Delhi pastels
  ['#ffffff', '#f7f1e3', '#f3ecdc', '#fff8ea'], // 1 bungalow
  ['#ffffff', '#efe9df', '#e3ddd3', '#f2eadb'], // 2 commercial
  ['#ffffff'], // 3 sandstone
  ['#ffffff'], // 4 white
  ['#ffffff', '#fbfbf8'], // 5 CP
  ['#f6e7d0', '#f5d5c0', '#e9e6c8', '#d8e4ea', '#f0d8e0', '#e8efd8', '#f2c9a8', '#e6d3b3'], // 6 apartments (DDA buffs and society pastels)
  ['#ffffff', '#e6eef4', '#dfe7ea'], // 7 towers
  ['#ffffff'], // 8 jantar
  ['#ffffff', '#e8e4dc'], // 9 sheds
  ['#ffffff', '#efe6da'], // 10 stone
  ['#ffffff', '#f1efe9', '#eae6dd'], // 11 embassy / modern
];
export const ROOF_COLORS = ['#cfc6b6', '#e6e1d6', '#bdb8b0', '#c46a50', '#f2efe9', '#f3f1ec', '#cbc4b8', '#9aa6ad', '#d9876f', '#a9a49b', '#9d8a72', '#d6d3cc'];

export interface Materials {
  ground: THREE.MeshLambertMaterial;
  areas: Record<number, THREE.Material>;
  water: THREE.MeshPhongMaterial;
  waterNormal: THREE.Texture;
  roads: THREE.Material[];
  foot: THREE.Material;
  kerb: THREE.Material;
  dash: THREE.Material;
  edge: THREE.Material;
  deck: THREE.Material;
  concrete: THREE.MeshLambertMaterial;
  pillar: THREE.MeshLambertMaterial;
  ballast: THREE.Material;
  steel: THREE.Material;
  facades: THREE.MeshLambertMaterial[];
  roof: THREE.MeshLambertMaterial;
  vertexColor: THREE.MeshLambertMaterial;
  flatColor: THREE.MeshLambertMaterial;
  tank: THREE.MeshLambertMaterial;
  domeWhite: THREE.MeshPhongMaterial;
  domeStone: THREE.MeshLambertMaterial;
}

let cached: Materials | null = null;
export function materials(): Materials {
  if (cached) return cached;
  const asphalt = asphaltTexture();
  const grass = grassTexture();
  const waterNormal = waterNormalTexture();
  cached = {
    ground: new THREE.MeshLambertMaterial({ map: groundTexture(), color: 0xd8cfb4, vertexColors: true }),
    areas: {
      [AREA.grass]: overlay(new THREE.MeshLambertMaterial({ map: grass }), 0),
      [AREA.wood]: overlay(new THREE.MeshLambertMaterial({ map: grass, color: 0x7f9a66 }), 0),
      [AREA.pitch]: overlay(new THREE.MeshLambertMaterial({ map: grass, color: 0xb9e08e }), 1),
      [AREA.stadium]: overlay(new THREE.MeshLambertMaterial({ map: pavingTexture([170, 160, 150], 'rgba(0,0,0,0.15)') }), 1),
      [AREA.plaza]: overlay(new THREE.MeshLambertMaterial({ map: pavingTexture() }), 2),
    },
    water: overlay(new THREE.MeshPhongMaterial({ color: 0x3f7f8f, specular: 0xbfd9e0, shininess: 90, normalMap: waterNormal, normalScale: new THREE.Vector2(0.35, 0.35) }), 3),
    waterNormal,
    roads: [
      overlay(new THREE.MeshLambertMaterial({ map: asphalt, color: 0xb4b4b8 }), 9),
      overlay(new THREE.MeshLambertMaterial({ map: asphalt, color: 0xbdbdc0 }), 8),
      overlay(new THREE.MeshLambertMaterial({ map: asphalt, color: 0xc9c6c0 }), 7),
      overlay(new THREE.MeshLambertMaterial({ map: asphalt, color: 0xd4cfc4 }), 6),
      overlay(new THREE.MeshLambertMaterial({ map: pavingTexture(), color: 0xe8d8c8 }), 5),
    ],
    foot: overlay(new THREE.MeshLambertMaterial({ map: pavingTexture([196, 186, 168], 'rgba(0,0,0,0.12)') }), 4),
    kerb: overlay(new THREE.MeshLambertMaterial({ map: stripeTexture('#1d1d1d', '#f0c419') }), 10),
    dash: overlay(new THREE.MeshLambertMaterial({ map: dashTexture(), transparent: true, alphaTest: 0.5 }), 11),
    edge: overlay(new THREE.MeshLambertMaterial({ color: 0xf2efe6 }), 11),
    deck: new THREE.MeshLambertMaterial({ map: asphalt, color: 0xb4b4b8, side: THREE.DoubleSide }),
    concrete: new THREE.MeshLambertMaterial({ vertexColors: true }),
    pillar: new THREE.MeshLambertMaterial({ color: 0xbcb6aa }),
    ballast: overlay(new THREE.MeshLambertMaterial({ map: pavingTexture([120, 106, 96], 'rgba(60,40,30,0.5)') }), 5),
    steel: overlay(new THREE.MeshLambertMaterial({ color: 0x4a4a4e }), 12),
    facades: facadeTextures().map(facadeMaterial),
    roof: new THREE.MeshLambertMaterial({ vertexColors: true }),
    vertexColor: new THREE.MeshLambertMaterial({ vertexColors: true }),
    flatColor: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    tank: new THREE.MeshLambertMaterial({ color: 0x1f1f22 }),
    domeWhite: new THREE.MeshPhongMaterial({ color: 0xf6f3ec, shininess: 30, specular: 0x333333 }),
    domeStone: new THREE.MeshLambertMaterial({ color: 0xc98a68 }),
  };
  return cached;
}
