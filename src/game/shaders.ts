import * as THREE from 'three'

export type FloatUniform = { value: number }
export type FacadeControls = { time: FloatUniform; night: FloatUniform; rain: FloatUniform }

/** Standard lighting and shadows are retained; windows are drawn in world-sized facade cells with PBR glass gloss. */
export function createFacadeMaterial(): { material: THREE.MeshStandardMaterial; controls: FacadeControls } {
  const controls: FacadeControls = { time: { value: 0 }, night: { value: 0 }, rain: { value: 0 } }
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0.04 })
  material.onBeforeCompile = shader => {
    shader.uniforms.uViceTime = controls.time
    shader.uniforms.uViceNight = controls.night
    shader.uniforms.uViceRain = controls.rain
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vVicePosition;\nvarying vec3 vViceNormal;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 vicePosition = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          vicePosition = instanceMatrix * vicePosition;
        #endif
        vVicePosition = vicePosition.xyz;
        vViceNormal = normal;`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vVicePosition;
        varying vec3 vViceNormal;
        uniform float uViceTime;
        uniform float uViceNight;
        uniform float uViceRain;
        float viceHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float viceSide = 1.0 - step(0.5, abs(vViceNormal.y));
        float viceAlong = abs(vViceNormal.x) > 0.5 ? vVicePosition.z : vVicePosition.x;
        vec2 viceGrid = vec2(viceAlong / 2.4, vVicePosition.y / 2.8);
        vec2 viceCell = fract(viceGrid);
        float viceWindow = viceSide * step(0.18, viceCell.x) * step(viceCell.x, 0.80)
          * step(0.22, viceCell.y) * step(viceCell.y, 0.79) * step(3.0, vVicePosition.y);
        float viceMullion = viceWindow * step(0.46, viceCell.x) * step(viceCell.x, 0.52);
        float viceLit = step(0.32, viceHash(floor(viceGrid) + floor(vVicePosition.xz * 0.07)));
        float viceWarm = step(0.55, viceHash(floor(viceGrid) * 1.7 + 3.1));
        vec3 viceGlass = mix(vec3(0.09, 0.22, 0.28), vec3(0.24, 0.46, 0.54), viceCell.y);
        vec3 viceInterior = mix(vec3(0.92, 0.62, 0.34), vec3(0.58, 0.84, 0.96), viceWarm * 0.35);
        viceGlass = mix(viceGlass, viceInterior, uViceNight * viceLit * 0.78);
        float vicePane = max(0.0, viceWindow - viceMullion * 0.65);
        diffuseColor.rgb = mix(diffuseColor.rgb, viceGlass, vicePane * 0.85);
        float viceAo = smoothstep(0.0, 2.2, vVicePosition.y);
        diffuseColor.rgb *= (0.82 + 0.18 * viceAo) * (1.0 - uViceRain * 0.14);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        float viceGlossMask = (1.0 - step(0.5, abs(vViceNormal.y))) * step(3.0, vVicePosition.y);
        vec2 viceRCell = fract(vec2((abs(vViceNormal.x) > 0.5 ? vVicePosition.z : vVicePosition.x) / 2.4, vVicePosition.y / 2.8));
        float viceWinR = viceGlossMask * step(0.18, viceRCell.x) * step(viceRCell.x, 0.80) * step(0.22, viceRCell.y) * step(viceRCell.y, 0.79);
        roughnessFactor = mix(roughnessFactor * (1.0 - uViceRain * 0.28), 0.14, viceWinR);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float viceFlicker = 0.94 + 0.06 * sin(uViceTime * 0.7 + viceHash(floor(viceGrid)) * 6.28318);
        vec3 viceEmit = mix(vec3(1.0, 0.62, 0.28), vec3(0.45, 0.85, 1.0), viceWarm * 0.25);
        totalEmissiveRadiance += viceEmit * vicePane * viceLit * uViceNight * 0.75 * viceFlicker;`)
  }
  material.customProgramCacheKey = () => 'vice-facades-v3'
  return { material, controls }
}

/** Horizontal, gently animated coastal water with Fresnel sky reflection, sun glint, and shoreline foam. */
export function createWaterMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uNight: { value: 0 }, uRain: { value: 0 },
      uDeep: { value: new THREE.Color('#0c6e7f') }, uLight: { value: new THREE.Color('#5ad3c6') },
      uSky: { value: new THREE.Color('#f7c9ae') },
    }]),
    fog: true,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vWater;
      varying float vWave;
      varying vec3 vWorldPos;
      #include <fog_pars_vertex>
      void main() {
        vec3 p = position;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        float wave = sin(wp.x * 0.11 + uTime * 0.72) * 0.10
          + sin(wp.z * 0.15 - uTime * 0.48 + wp.x * 0.035) * 0.075
          + cos((wp.x - wp.z) * 0.22 + uTime * 1.1) * 0.03;
        p.y += wave;
        wp = modelMatrix * vec4(p, 1.0);
        vWave = wave;
        vWater = wp.xz;
        vWorldPos = wp.xyz;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform float uNight; uniform float uRain;
      uniform vec3 uDeep; uniform vec3 uLight; uniform vec3 uSky;
      varying vec2 vWater; varying float vWave; varying vec3 vWorldPos;
      #include <fog_pars_fragment>
      void main() {
        float wave = sin(vWater.x * 0.21 + uTime * 0.8) * sin(vWater.y * 0.17 - uTime * 0.55);
        float ripple = sin(vWater.x * 0.72 + vWater.y * 0.41 + uTime * 1.6);
        vec3 n = normalize(vec3(cos(vWater.x * 0.21 + uTime * 0.8) * 0.18, 1.0, sin(vWater.y * 0.19 - uTime * 0.6) * 0.18));
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        float fresnel = pow(1.0 - max(dot(viewDir, n), 0.0), 3.2);
        float glint = smoothstep(0.76, 0.96, wave + ripple * 0.25) * (0.24 + 0.10 * (1.0 - uRain));
        float blend = clamp(0.45 + wave * 0.14 + vWave * 0.55 + ripple * uRain * 0.05, 0.0, 1.0);
        vec3 waterCol = mix(uDeep, uLight, blend);
        waterCol = mix(waterCol, waterCol * vec3(0.28, 0.46, 0.65), uNight * 0.68);
        vec3 skyRefl = mix(uSky, vec3(0.25, 0.35, 0.58), uNight * 0.82);
        vec3 color = mix(waterCol, skyRefl, fresnel * 0.55) + vec3(0.42, 0.46, 0.40) * glint;
        float shoreDist = abs(vWater.x - 85.5);
        float foamBand = smoothstep(3.2, 0.2, shoreDist + sin(vWater.y * 0.24 + uTime * 1.5) * 0.8);
        color = mix(color, vec3(0.86, 0.95, 0.96), foamBand * (0.55 - uNight * 0.25));
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  })
}

export function createSkyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new THREE.Color('#70c8e1') },
      uHorizon: { value: new THREE.Color('#ffd1b4') },
      uSun: { value: new THREE.Color('#fff0bd') },
      uSunDirection: { value: new THREE.Vector3(-0.45, 0.68, -0.45).normalize() },
      uSunStrength: { value: 0.8 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDirection;
      void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        // Put the skydome at the far depth regardless of the camera's far clipping distance.
        gl_Position.z = gl_Position.w * 0.9999;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vDirection;
      uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSun; uniform vec3 uSunDirection;
      uniform float uSunStrength;
      void main() {
        vec3 direction = normalize(vDirection);
        float height = clamp(direction.y, 0.0, 1.0);
        vec3 color = mix(uHorizon, uTop, pow(height, 0.65));
        float sun = max(dot(direction, normalize(uSunDirection)), 0.0);
        color += uSun * uSunStrength * (pow(sun, 256.0) * 0.65 + pow(sun, 10.0) * 0.16);
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }`,
  })
}

export function createRainMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    vertexShader: /* glsl */ `
      uniform float uTime; attribute float aTip;
      void main() {
        vec3 p = position;
        p.y = mod(p.y - uTime * 24.0, 42.0) + 2.0 - aTip * 1.5;
        p.x += aTip * 0.20;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      void main() {
        gl_FragColor = vec4(0.75, 0.88, 1.0, 0.42);
        #include <colorspace_fragment>
      }`,
  })
}
