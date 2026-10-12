// Late-afternoon Delhi sky: warm haze near the horizon, soft blue overhead,
// and a low western sun that throws long shadows down Kartavya Path.
import * as THREE from 'three';

export const SUN_DIR = new THREE.Vector3(-0.62, 0.52, 0.32).normalize();
export const HAZE = new THREE.Color(0xd8ccb2);

export interface Sky {
  group: THREE.Group;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  follow(target: THREE.Vector3): void;
  setShadows(enabled: boolean, size: number): void;
}

export function buildSky(scene: THREE.Scene): Sky {
  const group = new THREE.Group();
  group.name = 'sky';
  scene.fog = new THREE.FogExp2(HAZE.getHex(), 0.00052);
  scene.background = HAZE.clone();

  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      sunDir: { value: SUN_DIR },
      haze: { value: HAZE },
      zenith: { value: new THREE.Color(0x6e9fcc) },
      mid: { value: new THREE.Color(0xb7c9d3) },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: `
      uniform vec3 sunDir; uniform vec3 haze; uniform vec3 zenith; uniform vec3 mid;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, -0.2, 1.0);
        vec3 col = mix(haze, mid, smoothstep(0.0, 0.18, h));
        col = mix(col, zenith, smoothstep(0.16, 0.75, h));
        float sd = max(dot(normalize(vDir), sunDir), 0.0);
        col += vec3(1.0, 0.82, 0.55) * pow(sd, 12.0) * 0.35;
        col += vec3(1.0, 0.9, 0.7) * pow(sd, 600.0) * 2.5;
        col = mix(col, haze, smoothstep(0.02, -0.12, h));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(5000, 32, 16), skyMat);
  dome.renderOrder = -100;
  dome.frustumCulled = false;
  group.add(dome);

  const hemi = new THREE.HemisphereLight(0xcfe1f0, 0x8a7a5c, 1.35);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe2b8, 2.6);
  sun.position.copy(SUN_DIR).multiplyScalar(400);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const cam = sun.shadow.camera as THREE.OrthographicCamera;
  cam.left = -110; cam.right = 110; cam.top = 110; cam.bottom = -110;
  cam.near = 10; cam.far = 900;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  group.add(sun, sun.target);

  return {
    group, sun, hemi,
    follow(target) {
      // Snap to shadow texels to avoid shimmering while moving.
      const texel = (cam.right - cam.left) / sun.shadow.mapSize.x;
      const tx = Math.round(target.x / texel) * texel, tz = Math.round(target.z / texel) * texel;
      sun.target.position.set(tx, target.y, tz);
      sun.position.set(tx + SUN_DIR.x * 400, target.y + SUN_DIR.y * 400, tz + SUN_DIR.z * 400);
      dome.position.copy(target);
    },
    setShadows(enabled, size) {
      sun.castShadow = enabled;
      if (sun.shadow.mapSize.x !== size) {
        sun.shadow.mapSize.set(size, size);
        sun.shadow.map?.dispose();
        (sun.shadow as any).map = null;
      }
    },
  };
}
