import * as THREE from 'three'
import { createFacadeMaterial, createRainMaterial, createSkyMaterial, createWaterMaterial, type FacadeControls } from './shaders'
import { createSignTexture, createSurfaceTexture } from './textures'
import { STORES_CATALOG } from './storesCatalog'

export type ViceWeather = 'day' | 'sunset' | 'overcast' | 'haze' | 'fog' | 'rain' | 'storm' | 'night'
export type ViceSurface = 'asphalt' | 'wet' | 'sand' | 'dirt' | 'water'

/** Optional metadata for a game to create its own physics and interactions. */
export type WorldCollider = {
  center: THREE.Vector3
  halfExtents: THREE.Vector3
  rotationY: number
  kind: 'building' | 'container' | 'tree' | 'port' | 'barrier'
}
export type Safehouse = { name: string; position: THREE.Vector3; radius: number }
export type Store = { id: string; name: string; position: THREE.Vector3; radius: number; reward: number }
export type GymStation = { id: string; name: string; kind: 'bench' | 'bag'; position: THREE.Vector3; radius: number }
export type FoodStand = { id: string; name: string; position: THREE.Vector3; radius: number; price: number; mealSize: number }
export type ResprayBay = { id: string; name: string; position: THREE.Vector3; radius: number; price: number }
export type WorldRamp = { position: THREE.Vector3; width: number; length: number; rise: number; rotationY: number }

type BatchItem = { matrix: THREE.Matrix4; color: THREE.Color }
type DistanceChunk = { mesh: THREE.InstancedMesh; x: number; z: number; distance: number }
type Atmosphere = {
  top: string; horizon: string; sun: string; ground: string
  ambient: number; sunlight: number; fogNear: number; fogFar: number; night: number; rain: number; sunGlow: number
}

const BOUNDS = 380
const CROSS_STREETS = [-320, -240, -160, -80, 0, 80, 160, 240, 320]
const LONG_STREETS = [{ x: 0, width: 20 }, { x: -70, width: 14 }, { x: -130, width: 12 }, { x: -205, width: 12 }, { x: -280, width: 10 }, { x: 45, width: 10 }]
const ATMOSPHERES: Record<ViceWeather, Atmosphere> = {
  day: { top: '#5ab6d9', horizon: '#f9d3b9', sun: '#fff1d2', ground: '#786c65', ambient: 1.35, sunlight: 2.35, fogNear: 145, fogFar: 560, night: 0, rain: 0, sunGlow: 0.85 },
  sunset: { top: '#6d5ea5', horizon: '#ff9d7b', sun: '#ffaa6c', ground: '#6f506b', ambient: 1.0, sunlight: 1.95, fogNear: 120, fogFar: 520, night: 0.42, rain: 0, sunGlow: 1.25 },
  overcast: { top: '#68737d', horizon: '#9aa4ac', sun: '#cad0d4', ground: '#4a5155', ambient: 0.94, sunlight: 1.02, fogNear: 72, fogFar: 300, night: 0.34, rain: 0.32, sunGlow: 0.08 },
  haze: { top: '#8bb8c8', horizon: '#f3caa6', sun: '#ffe3b5', ground: '#776758', ambient: 1.16, sunlight: 1.68, fogNear: 58, fogFar: 240, night: 0.14, rain: 0, sunGlow: 0.55 },
  fog: { top: '#94a2ab', horizon: '#bec8ce', sun: '#dce3e8', ground: '#636c71', ambient: 0.98, sunlight: 0.85, fogNear: 28, fogFar: 135, night: 0.24, rain: 0.15, sunGlow: 0.05 },
  rain: { top: '#5a6f7c', horizon: '#8b9ba0', sun: '#cbd6df', ground: '#435053', ambient: 0.86, sunlight: 0.95, fogNear: 74, fogFar: 320, night: 0.32, rain: 1, sunGlow: 0.14 },
  storm: { top: '#253145', horizon: '#455466', sun: '#b5ccf0', ground: '#27303b', ambient: 0.62, sunlight: 0.65, fogNear: 46, fogFar: 195, night: 0.68, rain: 1.35, sunGlow: 0.06 },
  night: { top: '#0e1639', horizon: '#2b3962', sun: '#8eb0ff', ground: '#1e223c', ambient: 0.52, sunlight: 0.78, fogNear: 110, fogFar: 480, night: 1, rain: 0, sunGlow: 0.18 },
}

function makeRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

/** Each category is split into spatial chunks, avoiding thousands of independent draw calls. */
class InstanceBatch {
  private readonly cells = new Map<string, { x: number; z: number; items: BatchItem[] }>()
  private readonly matrix = new THREE.Matrix4()
  private readonly quaternion = new THREE.Quaternion()
  private readonly euler = new THREE.Euler()
  private readonly position = new THREE.Vector3()
  private readonly scale = new THREE.Vector3()

  constructor(
    private readonly geometry: THREE.BufferGeometry,
    private readonly material: THREE.Material,
    private readonly distance: number,
    private readonly castShadow = true,
    private readonly receiveShadow = true,
  ) {}

  add(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: THREE.ColorRepresentation, ry = 0, rz = 0, rx = 0): void {
    const cx = Math.floor(x / 64)
    const cz = Math.floor(z / 64)
    const key = `${cx},${cz}`
    let cell = this.cells.get(key)
    if (!cell) {
      cell = { x: cx * 64 + 32, z: cz * 64 + 32, items: [] }
      this.cells.set(key, cell)
    }
    this.position.set(x, y, z)
    this.scale.set(sx, sy, sz)
    this.quaternion.setFromEuler(this.euler.set(rx, ry, rz))
    this.matrix.compose(this.position, this.quaternion, this.scale)
    cell.items.push({ matrix: this.matrix.clone(), color: new THREE.Color(color) })
  }

  finish(scene: THREE.Scene, chunks: DistanceChunk[]): void {
    for (const cell of this.cells.values()) {
      const mesh = new THREE.InstancedMesh(this.geometry, this.material, cell.items.length)
      cell.items.forEach((item, index) => {
        mesh.setMatrixAt(index, item.matrix)
        mesh.setColorAt(index, item.color)
      })
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.computeBoundingSphere()
      mesh.castShadow = this.castShadow
      mesh.receiveShadow = this.receiveShadow
      scene.add(mesh)
      chunks.push({ mesh, x: cell.x, z: cell.z, distance: this.distance })
    }
  }
}

function createPalmFrond(): THREE.BufferGeometry {
  // A tapered, gently arched palm blade, laid out along local +X.
  const positions = new Float32Array([
    0, 0, 0, 1.1, 0.45, -0.56, 1.1, 0.45, 0.56,
    2.45, 0.32, -0.42, 2.45, 0.32, 0.42, 4.1, -0.43, 0,
  ])
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setIndex([0, 2, 1, 1, 2, 3, 2, 4, 3, 3, 4, 5])
  geometry.computeVertexNormals()
  return geometry
}

/**
 * Standalone visual world. Ground is y=0; the caller owns player control, physics and rendering.
 * Bounds are a recommended playable rectangle; the scene itself is intentionally not walled in.
 */
export class ViceWorld {
  public readonly scene = new THREE.Scene()
  public readonly spawn = new THREE.Vector3(0, 0, 16)
  public readonly bounds = { minX: -BOUNDS, maxX: BOUNDS, minZ: -BOUNDS, maxZ: BOUNDS }
  public readonly colliders: WorldCollider[] = []
  public readonly safehouses: Safehouse[] = []
  public readonly stores: Store[] = []
  public readonly gyms: GymStation[] = []
  public readonly foodStands: FoodStand[] = []
  public readonly resprayBays: ResprayBay[] = []
  public readonly ramps: WorldRamp[] = []

  private readonly sun = new THREE.DirectionalLight('#fff0d0', 2.15)
  private readonly ambient = new THREE.HemisphereLight('#d8f4ff', '#776c67', 1.45)
  private readonly fog = new THREE.Fog('#f9d3b9', 145, 560)
  private readonly skyMaterial = createSkyMaterial()
  private readonly waterMaterial = createWaterMaterial()
  private readonly rainMaterial = createRainMaterial()
  private readonly facadeMaterial: THREE.MeshStandardMaterial
  private readonly facadeControls: FacadeControls
  private readonly asphaltTexture = createSurfaceTexture('asphalt')
  private readonly sandTexture = createSurfaceTexture('sand')
  private readonly woodTexture = createSurfaceTexture('wood')
  private readonly solidMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86, flatShading: true })
  private readonly leavesMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, side: THREE.DoubleSide, flatShading: true })
  private readonly neonPink = new THREE.MeshStandardMaterial({ color: '#ff73b8', emissive: '#ff268a', emissiveIntensity: 0.35, roughness: 0.45 })
  private readonly neonCyan = new THREE.MeshStandardMaterial({ color: '#98faff', emissive: '#25dcff', emissiveIntensity: 0.35, roughness: 0.45 })
  private readonly chunks: DistanceChunk[] = []
  private readonly random = makeRandom(92671)
  private readonly signs = new Map<string, THREE.Material>()
  private readonly sky: THREE.Mesh
  private readonly rain: THREE.LineSegments
  private readonly smallBoxes: InstanceBatch
  private readonly buildings: InstanceBatch
  private readonly trims: InstanceBatch
  private readonly pinkLights: InstanceBatch
  private readonly cyanLights: InstanceBatch
  private readonly trunks: InstanceBatch
  private readonly fronds: InstanceBatch
  private readonly foliage: InstanceBatch
  private readonly asphaltMaterials: THREE.MeshStandardMaterial[] = []
  private readonly sodiumLights: THREE.PointLight[] = []
  private readonly ponds: { x: number; z: number; rx: number; rz: number }[] = []
  private weather: ViceWeather = 'day'
  private time = 0
  private cullTimer = 1
  private readonly targetColor = new THREE.Color()

  constructor() {
    const facade = createFacadeMaterial()
    this.facadeMaterial = facade.material
    this.facadeControls = facade.controls
    const cube = new THREE.BoxGeometry(1, 1, 1)
    this.smallBoxes = new InstanceBatch(cube, this.solidMaterial, 230)
    this.buildings = new InstanceBatch(cube, this.facadeMaterial, 440)
    this.trims = new InstanceBatch(cube, this.solidMaterial, 340)
    this.pinkLights = new InstanceBatch(cube, this.neonPink, 310, false)
    this.cyanLights = new InstanceBatch(cube, this.neonCyan, 310, false)
    this.trunks = new InstanceBatch(new THREE.CylinderGeometry(0.2, 0.34, 1, 7), this.solidMaterial, 270)
    this.fronds = new InstanceBatch(createPalmFrond(), this.leavesMaterial, 260)
    this.foliage = new InstanceBatch(new THREE.IcosahedronGeometry(1, 0), this.solidMaterial, 245)

    this.scene.background = new THREE.Color(ATMOSPHERES.day.horizon)
    this.scene.fog = this.fog
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(700, 32, 16), this.skyMaterial)
    this.sky.renderOrder = -10
    this.sky.frustumCulled = false
    this.scene.add(this.sky, this.ambient, this.sun, this.sun.target)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    const shadow = this.sun.shadow.camera
    shadow.left = shadow.bottom = -58
    shadow.right = shadow.top = 58
    shadow.near = 1
    shadow.far = 320
    this.sun.shadow.bias = -0.00028
    this.sun.shadow.normalBias = 0.028
    this.sun.shadow.radius = 2.4

    this.makeGround()
    this.makeRoads()
    this.makeHotels()
    this.makeStores()
    this.makeDowntown()
    this.makeNeighbourhoods()
    this.makeOuterDistricts()
    this.makeBeach()
    this.makePort()
    this.makeWetlands()
    this.makeStreetFurniture()
    this.makeRampsAndSafehouses()
    this.makeLifestyleStations()
    for (const batch of [this.smallBoxes, this.buildings, this.trims, this.pinkLights, this.cyanLights, this.trunks, this.fronds, this.foliage]) {
      batch.finish(this.scene, this.chunks)
    }
    this.rain = this.makeRain()
    this.scene.add(this.rain)
    for (let i = 0; i < 4; i += 1) {
      const lamp = new THREE.PointLight('#ff9a38', 0, 28, 1.8)
      lamp.castShadow = false
      this.scene.add(lamp)
      this.sodiumLights.push(lamp)
    }
    this.update(0, this.spawn, 'day')
  }

  /** Animate atmosphere and water; expensive distance visibility checks are throttled. */
  public update(dt: number, player: THREE.Vector3, weather: ViceWeather): void {
    const step = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0
    this.time = (this.time + step) % 4096
    this.weather = weather
    const target = ATMOSPHERES[weather]
    const blend = step === 0 ? 1 : 1 - Math.exp(-step * 1.7)
    const colorTo = (color: THREE.Color, value: string): void => { color.lerp(this.targetColor.set(value), blend) }
    colorTo(this.scene.background as THREE.Color, target.horizon)
    colorTo(this.fog.color, target.horizon)
    colorTo(this.skyMaterial.uniforms.uTop.value as THREE.Color, target.top)
    colorTo(this.skyMaterial.uniforms.uHorizon.value as THREE.Color, target.horizon)
    colorTo(this.skyMaterial.uniforms.uSun.value as THREE.Color, target.sun)
    colorTo(this.sun.color, target.sun)
    colorTo(this.ambient.groundColor, target.ground)
    this.ambient.intensity = THREE.MathUtils.lerp(this.ambient.intensity, target.ambient, blend)
    this.sun.intensity = THREE.MathUtils.lerp(this.sun.intensity, target.sunlight, blend)
    this.fog.near = THREE.MathUtils.lerp(this.fog.near, target.fogNear, blend)
    this.fog.far = THREE.MathUtils.lerp(this.fog.far, target.fogFar, blend)
    this.facadeControls.time.value = this.time
    this.facadeControls.night.value = THREE.MathUtils.lerp(this.facadeControls.night.value, target.night, blend)
    this.facadeControls.rain.value = THREE.MathUtils.lerp(this.facadeControls.rain.value, target.rain, blend)
    this.waterMaterial.uniforms.uTime.value = this.time
    this.waterMaterial.uniforms.uNight.value = this.facadeControls.night.value
    this.waterMaterial.uniforms.uRain.value = this.facadeControls.rain.value
    if (this.waterMaterial.uniforms.uSky) colorTo(this.waterMaterial.uniforms.uSky.value as THREE.Color, target.horizon)
    this.skyMaterial.uniforms.uSunStrength.value = THREE.MathUtils.lerp(this.skyMaterial.uniforms.uSunStrength.value as number, target.sunGlow, blend)
    this.rainMaterial.uniforms.uTime.value = this.time
    const stormPulse = weather === 'storm' && Math.sin(this.time * 1.9) > 0.985 && Math.cos(this.time * 17) > 0.3 ? 1.8 : 0
    if (stormPulse > 0) {
      this.sun.intensity += stormPulse
      this.ambient.intensity += stormPulse * 0.45
    }
    this.rain.visible = (weather === 'rain' || weather === 'storm') && this.facadeControls.rain.value > 0.08
    this.rain.position.set(player.x, player.y, player.z)
    this.sky.position.copy(player)
    // Snap directional shadow target to texel grid to eliminate shadow swimming during camera movement.
    const texel = 116 / (this.sun.shadow.mapSize.x || 2048)
    const snapX = Math.round(player.x / texel) * texel
    const snapZ = Math.round(player.z / texel) * texel
    const sunHeight = weather === 'sunset' ? 54 : weather === 'night' ? 76 : 88
    this.sun.position.set(snapX - 52, player.y + sunHeight, snapZ + 48)
    this.sun.target.position.set(snapX, 0, snapZ)
    this.sun.target.updateMatrixWorld()
    const neon = 0.22 + this.facadeControls.night.value * (1.3 + 0.08 * Math.sin(this.time * 2))
    this.neonPink.emissiveIntensity = neon
    this.neonCyan.emissiveIntensity = neon * 0.9
    for (const material of this.asphaltMaterials) {
      material.roughness = 0.94 - 0.56 * this.facadeControls.rain.value
      material.metalness = 0.06 + 0.2 * this.facadeControls.rain.value
    }
    // Sodium-vapor orange avenue pools glow dynamically near the player at night / overcast / rain
    const sodiumIntensity = Math.max(this.facadeControls.night.value * 11, this.facadeControls.rain.value * 4.5)
    const baseZ = Math.round(player.z / 29) * 29
    for (let i = 0; i < this.sodiumLights.length; i += 1) {
      const lamp = this.sodiumLights[i]
      const side = i % 2 === 0 ? -1 : 1
      const zOff = (Math.floor(i / 2) - 0.5) * 29
      lamp.position.set(side * 15.5, 5.8, THREE.MathUtils.clamp(baseZ + zOff, -360, 360))
      lamp.intensity = sodiumIntensity
    }
    this.cullTimer += step
    if (this.cullTimer >= 0.4) {
      this.cullTimer = 0
      for (const chunk of this.chunks) {
        const dx = chunk.x - player.x
        const dz = chunk.z - player.z
        // The extra half-diagonal keeps objects at the edge of a cell visible.
        chunk.mesh.visible = dx * dx + dz * dz < (chunk.distance + 46) ** 2
      }
    }
  }

  public surfaceAt(x: number, z: number): ViceSurface {
    const road = LONG_STREETS.some(street => Math.abs(x - street.x) <= street.width / 2)
      || (x >= -BOUNDS && x <= 50 && CROSS_STREETS.some(street => Math.abs(z - street) <= 7))
    if (road || (z > 110 && x >= 55 && x <= 85)) return (this.weather === 'rain' || this.weather === 'storm' || this.weather === 'overcast') ? 'wet' : 'asphalt'
    if ((x >= 60 && x <= 66 && z <= 110) || (x >= 63 && x <= 142 && Math.abs(z + 8) <= 4)) return 'dirt'
    if (x > 85) return 'water'
    if (x >= 55) return 'sand'
    if (x < -145) {
      if (this.ponds.some(pond => ((x - pond.x) / pond.rx) ** 2 + ((z - pond.z) / pond.rz) ** 2 < 1)) return 'water'
      return 'wet'
    }
    return 'dirt'
  }

  public districtAt(x: number, z: number): string {
    if (x < -145) return 'The Wetlands'
    if (z > 110) return 'Port Vice'
    if (z < -90) return 'Downtown'
    if (x >= 55) return 'Vice Beach'
    if (x >= 15) return 'Ocean Drive'
    if (x > -15) return 'Vice Boulevard'
    return 'Little Palms'
  }

  private plane(width: number, depth: number, x: number, y: number, z: number, material: THREE.Material): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(width, depth)
    geometry.rotateX(-Math.PI / 2)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(x, y, z)
    mesh.receiveShadow = true
    this.scene.add(mesh)
    return mesh
  }

  private tiledMaterial(texture: THREE.Texture, color: THREE.ColorRepresentation, width: number, depth: number, tile = 8): THREE.MeshStandardMaterial {
    const map = texture.clone()
    map.repeat.set(width / tile, depth / tile)
    map.needsUpdate = true
    return new THREE.MeshStandardMaterial({ color, map, roughness: 0.95 })
  }

  private makeGround(): void {
    const base = new THREE.MeshStandardMaterial({ color: '#c6bd9a', roughness: 1, flatShading: true })
    this.plane(525, 760, -117.5, 0, 0, base)
    this.plane(115, 760, -320, 0.004, 0, new THREE.MeshStandardMaterial({ color: '#6d8d6a', roughness: 1 }))
    this.plane(30, 760, 70, 0.006, 0, this.tiledMaterial(this.sandTexture, '#f2d5a0', 30, 760, 7))
    this.plane(30, 150, 70, 0.012, 185, new THREE.MeshStandardMaterial({ color: '#aaa89b', roughness: 0.95 }))
    const geometry = new THREE.PlaneGeometry(395, 920, 64, 110)
    geometry.rotateX(-Math.PI / 2)
    const water = new THREE.Mesh(geometry, this.waterMaterial)
    water.position.set(282.5, -0.13, 0)
    water.receiveShadow = false
    this.scene.add(water)
    // Shoreline catches the light even from a distance.
    this.plane(0.65, 760, 84.7, 0.025, -5, new THREE.MeshBasicMaterial({ color: '#e7f7e7' }))
  }

  private makeRoads(): void {
    for (const road of LONG_STREETS) {
      const material = this.tiledMaterial(this.asphaltTexture, '#555a5d', road.width, 760, 9)
      this.asphaltMaterials.push(material)
      this.plane(road.width, 760, road.x, 0.015, 0, material)
      for (let z = -375; z <= 375; z += 11) {
        if (CROSS_STREETS.some(cross => Math.abs(z - cross) < 11)) continue
        if (road.x === 0) {
          this.smallBoxes.add(-0.38, 0.035, z, 0.13, 0.018, 6.0, '#e8bf70')
          this.smallBoxes.add(0.38, 0.035, z, 0.13, 0.018, 6.0, '#e8bf70')
          this.smallBoxes.add(-5, 0.035, z, 0.12, 0.018, 4.8, '#e6e6dc')
          this.smallBoxes.add(5, 0.035, z, 0.12, 0.018, 4.8, '#e6e6dc')
        } else {
          this.smallBoxes.add(road.x, 0.035, z, 0.14, 0.018, 5.5, '#e8dfb8')
        }
      }
      for (const side of [-1, 1]) {
        this.smallBoxes.add(road.x + side * (road.width / 2 - 0.5), 0.036, 0, 0.11, 0.02, 760, '#deded1')
      }
    }
    for (const z of CROSS_STREETS) {
      const material = this.tiledMaterial(this.asphaltTexture, '#555a5d', 540, 14, 9)
      this.asphaltMaterials.push(material)
      this.plane(540, 14, -165, 0.02, z, material)
      for (let x = -425; x < 100; x += 11) {
        if (LONG_STREETS.some(road => Math.abs(x - road.x) < road.width / 2 + 4)) continue
        this.smallBoxes.add(x, 0.04, z, 5.3, 0.018, 0.14, '#e8dfb8')
      }
      // Zebra crossings make the central junctions legible from above and street level.
      for (const side of [-1, 1]) {
        for (let stripe = -4; stripe <= 4; stripe += 1) {
          this.smallBoxes.add(stripe * 1.85, 0.045, z + side * 8.7, 0.8, 0.02, 2.0, '#e8e9dd')
        }
      }
    }
    // Raised paving is split at every intersection so cross streets stay open.
    const gaps = [-BOUNDS, ...CROSS_STREETS.flatMap(z => [z - 8, z + 8]), BOUNDS]
    for (let i = 0; i < gaps.length - 1; i += 2) {
      const start = gaps[i]
      const end = gaps[i + 1]
      if (end <= start) continue
      for (const x of [-13, 13]) {
        this.trims.add(x, 0.065, (start + end) / 2, 6, 0.13, end - start, '#d3c7b7')
        this.trims.add(x > 0 ? 10.1 : -10.1, 0.12, (start + end) / 2, 0.18, 0.18, end - start, '#eee2cf')
      }
    }
  }

  private addBuilding(x: number, z: number, width: number, depth: number, height: number, color: string, roof = true): void {
    this.buildings.add(x, height / 2, z, width, height, depth, color)
    this.colliders.push({ center: new THREE.Vector3(x, height / 2, z), halfExtents: new THREE.Vector3(width / 2, height / 2, depth / 2), rotationY: 0, kind: 'building' })
    if (roof) {
      this.trims.add(x, height + 0.28, z, width + 0.6, 0.56, depth + 0.6, '#ede1cf')
      this.trims.add(x, height + 0.8, z, width * 0.68, 0.52, depth * 0.68, color)
    }
  }

  private sign(text: string, x: number, y: number, z: number, width: number, rotationY: number, pink = false): void {
    const key = `${text}:${pink}`
    let material = this.signs.get(key)
    if (!material) {
      material = new THREE.MeshBasicMaterial({ map: createSignTexture(text, pink ? '#9d3a74' : '#236c72', '#fff3d7'), side: THREE.DoubleSide })
      this.signs.set(key, material)
    }
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4), material)
    sign.position.set(x, y, z)
    sign.rotation.y = rotationY
    this.scene.add(sign)
  }

  private makeStores(): void {
    // All 20 enterable walk-in 3D stores are built by StoreWorld from STORES_CATALOG;
    // keep ViceWorld.stores synced with exact world coordinates & rewards.
    for (const spec of STORES_CATALOG) {
      this.stores.push({
        id: spec.id,
        name: spec.name,
        position: new THREE.Vector3(spec.x, 0, spec.z),
        radius: 5.5,
        reward: spec.registerReward,
      })
    }
  }
  private makeHotels(): void {
    const colors = ['#f4b5a5', '#b5ded4', '#f1d8af', '#deb9d0', '#f4c5b3', '#c5dfd6']
    const names = ['THE SAVOY', 'PINK PALM', 'OCEAN CLUB', 'THE TIDES', 'CASA VICE', 'HOTEL']
    const positions = [-78, -12, 60]
    for (let side = 0; side < 2; side += 1) {
      for (let i = 0; i < positions.length; i += 1) {
        const z = positions[i]
        const x = side === 0 ? 28 : -30
        const h = 12 + ((i + side) % 3) * 2.5
        const width = side === 0 ? 18 : 20
        const depth = 22
        const color = colors[(i + side * 2) % colors.length]
        this.addBuilding(x, z, width, depth, h, color)
        const front = x + (side === 0 ? -1 : 1) * (width / 2 + 0.08)
        const direction = side === 0 ? -1 : 1
        // Bands, a stepped crown, and vertical ribs are the recognizable art-deco silhouette.
        this.trims.add(x, h + 1.25, z, width * 0.58, 0.9, depth * 0.58, color)
        this.trims.add(x, h + 1.85, z, width * 0.32, 0.5, depth * 0.36, '#f4e4ce')
        for (const yy of [2.7, 5.4, h - 0.5]) {
          this.trims.add(front, yy, z, 0.17, 0.22, depth + 0.2, '#f8e8d5')
        }
        for (const dz of [-8.8, 8.8]) {
          this.trims.add(front, h * 0.52, z + dz, 0.24, h * 0.75, 0.35, '#fff0de')
        }
        const lights = (i + side) % 2 ? this.cyanLights : this.pinkLights
        lights.add(front + direction * 0.12, h - 1.1, z, 0.13, 0.12, depth - 1, '#ffffff')
        lights.add(front + direction * 0.12, 4.1, z, 0.13, 0.12, depth - 1, '#ffffff')
        this.sign(names[i + side * 3], front + direction * 0.2, 6.9, z, 8, direction * Math.PI / 2, side === 1)
        // Ground-floor awning and a recessed dark entrance facing the boulevard.
        this.trims.add(front + direction * 0.8, 3.1, z, 1.7, 0.2, 9, '#f7eee0')
        lights.add(front + direction * 1.65, 3.0, z, 0.12, 0.15, 9, '#ffffff')
        this.trims.add(front + direction * 0.05, 1.25, z, 0.12, 2.5, 3.0, '#304b50')
      }
    }
  }

  private makeDowntown(): void {
    const colors = ['#adcac7', '#b9c4ce', '#e1c7bd', '#9ab6c1', '#c6d6d0', '#d3c7b4']
    for (const x of [-35, -54, -94, -114]) {
      for (let z = -345; z <= -100; z += 22) {
        if (CROSS_STREETS.some(cross => Math.abs(z - cross) < 17)) continue
        if (x === -35 && Math.abs(z + 145) < 25) continue // Reserve the landmark bank parcel.
        const h = 20 + this.random() * 24 + (x === -94 ? 22 : 0)
        const w = 15 + this.random() * 3
        const d = 15 + this.random() * 3
        const color = colors[Math.floor(this.random() * colors.length)]
        this.addBuilding(x, z, w, d, h, color)
        if (h > 38) {
          this.buildings.add(x, h + 4, z, w * 0.62, 8, d * 0.62, color)
          this.trims.add(x, h + 8.2, z, w * 0.65, 0.4, d * 0.65, '#e7dfd1')
          this.trims.add(x, h + 11, z, 0.3, 5.5, 0.3, '#c6cbd0')
        }
      }
    }
    // Landmark bank, positioned just off the boulevard and clearly signed.
    this.addBuilding(-31, -145, 21, 25, 21, '#e8dfc5')
    const front = -20.4
    for (const z of [-154, -149, -144, -139, -135]) this.trims.add(front, 4.7, z, 1, 8.7, 1, '#f3eddd')
    this.trims.add(front, 9.2, -145, 1.4, 0.8, 24, '#f7ecd4')
    this.sign('VICE BANK', front + 0.8, 11.5, -145, 10, Math.PI / 2)
    this.cyanLights.add(front + 0.9, 10.0, -145, 0.15, 0.15, 16, '#ffffff')
  }

  private makeNeighbourhoods(): void {
    const colors = ['#f5c8aa', '#b8d7c9', '#f0d7a8', '#d8bfc4', '#c2d6db']
    for (const x of [-52, -95, -115]) {
      for (const z of [-76, -5, 61, 85]) {
        if (x === -115 && z === 85) continue
        const h = 6 + this.random() * 8
        this.addBuilding(x, z, 14 + this.random() * 3, 14, h, colors[Math.floor(this.random() * colors.length)])
        this.trims.add(x, h + 0.5, z, 8, 1, 7, '#ede4ce')
      }
    }
  }

  private makeOuterDistricts(): void {
    const homes = ['#b7c9c1', '#c9b59e', '#aebfd0', '#d3b9a7', '#b8c7a9']
    for (const z of [-330, -270, 270, 330]) {
      for (const x of [-42, -92, -145, -215]) {
        if (Math.abs(x + 70) < 20 && Math.abs(z) > 290) continue
        const h = 5.5 + this.random() * 3.8
        this.addBuilding(x, z + (this.random() - .5) * 10, 13 + this.random() * 5, 15, h, homes[Math.floor(this.random() * homes.length)])
        this.trims.add(x, h + .35, z, 9, .55, 8, '#e4d9c7')
      }
    }
    for (const z of [278, 338]) {
      for (const x of [-20, -70, -120]) {
        const h = 17 + this.random() * 12
        this.addBuilding(x, z, 18, 22, h, '#8ea8b0')
        this.trims.add(x, h + .65, z, 12, .55, 15, '#d8d0c2')
        this.cyanLights.add(x + 9.2, h * .55, z, .12, .14, 15, '#ffffff')
      }
    }
  }
  private addPalm(x: number, z: number, scale = 1): void {
    const height = (6.8 + this.random() * 2.8) * scale
    this.trunks.add(x, height / 2, z, scale, height, scale, '#a87958')
    this.colliders.push({ center: new THREE.Vector3(x, height / 2, z), halfExtents: new THREE.Vector3(0.35 * scale, height / 2, 0.35 * scale), rotationY: 0, kind: 'tree' })
    const offset = this.random() * Math.PI * 2
    for (let i = 0; i < 7; i += 1) {
      const angle = offset + i * Math.PI * 2 / 7
      this.fronds.add(x, height, z, scale, scale, scale, i % 2 ? '#448a62' : '#62a66b', angle)
    }
    this.foliage.add(x, height + 0.15 * scale, z, 0.52 * scale, 0.35 * scale, 0.52 * scale, '#638b49')
  }

  private makeBeach(): void {
    // Wooden boardwalk and pier: both are above the shoreline and extend over real water.
    this.trims.add(63, 0.1, -75, 6.2, 0.2, 370, '#b68760')
    this.plane(6, 370, 63, 0.205, -75, this.tiledMaterial(this.woodTexture, '#bd936c', 6, 370, 4))
    this.trims.add(102.5, 0.2, -8, 79, 0.24, 8.2, '#ad7e59')
    this.plane(79, 8, 102.5, 0.325, -8, this.tiledMaterial(this.woodTexture, '#c39a72', 79, 8, 4))
    for (let x = 72; x <= 140; x += 8) {
      for (const z of [-12, -4]) {
        this.trims.add(x, 0.36, z, 0.32, 1.5, 0.32, '#a57b59')
        this.trims.add(x, 1.12, z, 8, 0.12, 0.12, '#d9b58d')
      }
    }
    for (let z = -222; z < 105; z += 26) {
      const x = 74 + this.random() * 5
      const color = this.random() > 0.5 ? '#f78e9c' : '#81d7d2'
      this.trunks.add(x, 1.4, z, 0.35, 2.8, 0.35, '#eee2c6')
      const umbrella = new THREE.Mesh(new THREE.ConeGeometry(2.1, 0.8, 8, 1), new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9 }))
      umbrella.position.set(x, 3.0, z)
      umbrella.castShadow = true
      umbrella.receiveShadow = true
      this.scene.add(umbrella)
      this.smallBoxes.add(x + 2.8, 0.32, z, 1.8, 0.2, 3.1, '#eee3c8', 0.25)
    }
    for (let z = -355; z < 105; z += 31) this.addPalm(53 + this.random() * 2, z, 0.86)
    this.sign('VICE BEACH', 63, 3.3, -8, 8, 0)
  }

  private makePort(): void {
    for (const z of [140, 214, 288, 362]) {
      this.addBuilding(27, z, 20, 31, 10, '#96afab')
      this.trims.add(27, 10.2, z, 21, 0.6, 32, '#d6d3c3')
      this.addBuilding(-100, z, 23, 30, 11, '#b9b3a2')
      this.trims.add(-100, 11.2, z, 24, 0.6, 31, '#d6d3c3')
      this.sign('VICE CARGO', 16.8, 6, z, 10, -Math.PI / 2)
    }
    const containerColors = ['#d45d55', '#4e9c9a', '#dda452', '#5a7292', '#b9837a']
    for (const z of [130, 146, 161, 208, 224, 239]) {
      for (const x of [61, 72, 81]) {
        const levels = 1 + (this.random() > 0.55 ? 1 : 0)
        for (let level = 0; level < levels; level += 1) {
          this.trims.add(x, 1.3 + level * 2.6, z, 7, 2.5, 11, containerColors[Math.floor(this.random() * containerColors.length)])
          for (let stripe = -2; stripe <= 2; stripe += 1) this.smallBoxes.add(x + stripe * 1.2, 1.3 + level * 2.6, z + 5.55, 0.1, 2.3, 0.08, '#d1cbc0')
        }
        this.colliders.push({ center: new THREE.Vector3(x, levels * 1.3, z), halfExtents: new THREE.Vector3(3.5, levels * 1.3, 5.5), rotationY: 0, kind: 'container' })
      }
    }
    for (const z of [180, 250]) {
      // Yellow gantry cranes straddle the quay, with jibs reaching out over the bay.
      for (const x of [78, 89]) {
        this.trims.add(x, 11.5, z, 1.4, 23, 1.4, '#e7b655')
        this.trims.add(x, 19, z - 4, 1, 1, 9, '#e7b655')
        this.colliders.push({ center: new THREE.Vector3(x, 11.5, z), halfExtents: new THREE.Vector3(0.7, 11.5, 0.7), rotationY: 0, kind: 'port' })
      }
      this.trims.add(91, 23, z, 28, 1.2, 1.5, '#e7b655')
      this.trims.add(103, 17, z, 0.14, 12, 0.14, '#424b4a')
      this.trims.add(103, 11, z, 1.8, 0.5, 0.5, '#d4ad5b')
      this.cyanLights.add(78, 23.7, z, 1, 0.3, 1, '#ffffff')
    }
  }

  private makeWetlands(): void {
    const colors = ['#52765d', '#668b62', '#799a69', '#476d61']
    for (let i = 0; i < 12; i += 1) {
      const x = -159 - this.random() * 90
      const z = -358 + this.random() * 716
      if (CROSS_STREETS.some(cross => Math.abs(z - cross) < 19)) continue
      if (Math.abs(x + 170) < 28 && Math.abs(z - 65) < 28) continue
      const rx = 8 + this.random() * 9
      const rz = 8 + this.random() * 12
      this.ponds.push({ x, z, rx, rz })
      const pond = new THREE.Mesh(new THREE.CircleGeometry(1, 20), new THREE.MeshStandardMaterial({ color: '#628e80', roughness: 0.3, metalness: 0.08 }))
      pond.rotation.x = -Math.PI / 2
      pond.scale.set(rx, rz, 1)
      pond.position.set(x, 0.014, z)
      this.scene.add(pond)
    }
    for (let i = 0; i < 215; i += 1) {
      const x = -151 - this.random() * 103
      const z = -374 + this.random() * 748
      if (CROSS_STREETS.some(cross => Math.abs(z - cross) < 13)) continue
      if (Math.abs(x + 170) < 14 && Math.abs(z - 65) < 13) continue
      const h = 3.8 + this.random() * 5
      const color = colors[Math.floor(this.random() * colors.length)]
      this.trunks.add(x, h / 2, z, 1.3, h, 1.3, '#766b52')
      this.foliage.add(x, h, z, 2.8, 1.8, 2.8, color)
      this.foliage.add(x + 1.2, h + 1, z, 2, 1.3, 2, color)
      if (i % 4 === 0) this.colliders.push({ center: new THREE.Vector3(x, h / 2, z), halfExtents: new THREE.Vector3(0.45, h / 2, 0.45), rotationY: 0, kind: 'tree' })
      for (let reed = 0; reed < 3; reed += 1) {
        const dx = (this.random() - 0.5) * 7
        const dz = (this.random() - 0.5) * 7
        this.smallBoxes.add(x + dx, 0.9, z + dz, 0.1, 1.8, 0.1, '#afad72', 0, (this.random() - 0.5) * 0.3)
      }
    }
  }

  private makeStreetFurniture(): void {
    for (let z = -365; z <= 365; z += 20) {
      if (CROSS_STREETS.some(cross => Math.abs(z - cross) < 13)) continue
      for (const x of [-14.5, 14.5]) this.addPalm(x, z, 0.9 + this.random() * 0.18)
    }
    for (let z = -370; z <= 370; z += 29) {
      if (CROSS_STREETS.some(cross => Math.abs(z - cross) < 10)) continue
      for (const side of [-1, 1]) {
        const x = side * 17
        this.trims.add(x, 3.2, z, 0.18, 6.4, 0.18, '#737b76')
        this.trims.add(x - side * 0.65, 6.3, z, 1.3, 0.15, 0.15, '#737b76')
        this.cyanLights.add(x - side * 1.25, 6.18, z, 0.4, 0.14, 0.4, '#ffffff')
      }
    }
    // Benches, bins, and planting beds give the first block a lived-in human scale.
    for (const z of [-4, 35, 68, -67]) {
      for (const x of [-17.5, 17.5]) {
        this.trims.add(x, 0.58, z, 1, 0.16, 2.8, '#b98768')
        this.trims.add(x, 0.95, z + 1.2, 1, 0.7, 0.14, '#b98768')
        this.trims.add(x, 0.28, z - 0.9, 0.75, 0.5, 0.16, '#71807b')
        this.trims.add(x, 0.28, z + 0.9, 0.75, 0.5, 0.16, '#71807b')
      }
    }
  }

  private addRamp(x: number, z: number, width: number, length: number, rise: number, rotationY: number): void {
    const angle = Math.atan2(rise, length)
    const actualLength = Math.hypot(length, rise)
    this.smallBoxes.add(x, rise / 2, z, width, 0.35, actualLength, '#9b9d97', rotationY, 0, -angle)
    this.ramps.push({ position: new THREE.Vector3(x, 0, z), width, length, rise, rotationY })
    this.cyanLights.add(x, 0.13, z - length / 2, width, 0.12, 0.16, '#ffffff', rotationY)
  }

  private makeRampsAndSafehouses(): void {
    this.addRamp(28, 100, 5, 11, 2.7, 0)
    this.addRamp(-54, 150, 6, 13, 3.3, 0)
    this.addRamp(-140, -215, 5, 10, 2.4, 0)
    this.addBuilding(-115, 85, 15, 17, 8, '#e7c3a8')
    this.trims.add(-115, 8.3, 85, 16, 0.6, 18, '#f1e5d3')
    this.sign('SAFEHOUSE', -107.3, 5.4, 85, 8, Math.PI / 2)
    this.cyanLights.add(-107.2, 3.5, 85, 0.15, 0.16, 8, '#ffffff')
    this.addBuilding(-170, 65, 14, 16, 7, '#a8c8af')
    this.trims.add(-170, 7.3, 65, 15, 0.6, 17, '#e4d9c1')
    this.sign('HIDEOUT', -162.8, 4.8, 65, 7, Math.PI / 2)
    this.cyanLights.add(-162.7, 3.4, 65, 0.15, 0.16, 7, '#ffffff')
    const homes: Safehouse[] = [
      { name: 'Palm House', position: new THREE.Vector3(-105, 0, 85), radius: 3 },
      { name: 'Ocean Club', position: new THREE.Vector3(18, 0, -12), radius: 3 },
      { name: 'Wetlands Hideout', position: new THREE.Vector3(-160, 0, 65), radius: 3 },
    ]
    this.safehouses.push(...homes)
    for (const home of homes) {
      const marker = new THREE.Mesh(new THREE.RingGeometry(1.3, 1.65, 28), new THREE.MeshBasicMaterial({ color: '#74f3d8', side: THREE.DoubleSide, transparent: true, opacity: 0.72 }))
      marker.rotation.x = -Math.PI / 2
      marker.position.copy(home.position).setY(0.15)
      this.scene.add(marker)
    }
  }

  private makeLifestyleStations(): void {
    // 2 Outdoor San Andreas Gym Stations (Beach Muscle Pit & Downtown Heavy Bag)
    const gymSpecs: GymStation[] = [
      { id: 'beach-gym', name: 'Muscle Beach Bench Rack', kind: 'bench', position: new THREE.Vector3(24, 0, 34), radius: 3.4 },
      { id: 'downtown-gym', name: 'Downtown Boxing Bag', kind: 'bag', position: new THREE.Vector3(-42, 0, -72), radius: 3.4 },
    ]
    for (const gym of gymSpecs) {
      this.gyms.push(gym)
      const { x, z } = gym.position
      // Rubber mat base + equipment silhouette (3-6 distinct parts)
      this.smallBoxes.add(x, 0.06, z, 4.4, 0.12, 3.6, '#232830')
      if (gym.kind === 'bench') {
        this.trims.add(x, 0.42, z, 0.7, 0.22, 1.85, '#b83c48')
        this.trims.add(x - 0.65, 0.85, z - 0.55, 0.14, 1.4, 0.14, '#7d8a92')
        this.trims.add(x + 0.65, 0.85, z - 0.55, 0.14, 1.4, 0.14, '#7d8a92')
        this.trims.add(x, 1.4, z - 0.55, 2.3, 0.09, 0.09, '#d6dee4')
        this.smallBoxes.add(x - 1.05, 1.4, z - 0.55, 0.18, 0.6, 0.6, '#1f2328')
        this.smallBoxes.add(x + 1.05, 1.4, z - 0.55, 0.18, 0.6, 0.6, '#1f2328')
      } else {
        this.trims.add(x - 0.9, 1.5, z, 0.16, 3.0, 0.16, '#69747d')
        this.trims.add(x - 0.45, 2.9, z, 1.1, 0.16, 0.16, '#69747d')
        this.smallBoxes.add(x, 1.75, z, 0.56, 1.35, 0.56, '#c83f3f')
      }
      this.cyanLights.add(x, 0.15, z + 1.7, 3.4, 0.1, 0.12, '#77e6e7')
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.3, 1.65, 28), new THREE.MeshBasicMaterial({ color: '#f6d66d', side: THREE.DoubleSide, transparent: true, opacity: 0.72 }))
      ring.rotation.x = -Math.PI / 2
      ring.position.set(x, 0.15, z)
      this.scene.add(ring)
    }

    // Street Food Vendors ($12-$15 Burger/Taco + iconic $5 Sidewalk Hotdog Carts)
    const foodSpecs: FoodStand[] = [
      { id: 'burger-bay', name: 'Burger Bay', position: new THREE.Vector3(16, 0, -24), radius: 3.8, price: 15, mealSize: 55 },
      { id: 'taco-tropics', name: 'Taco Tropics', position: new THREE.Vector3(-76, 0, 26), radius: 3.8, price: 12, mealSize: 45 },
      { id: 'hotdog-boulevard', name: 'Liberty Hotdog Cart', position: new THREE.Vector3(-12.5, 0, 10), radius: 3.2, price: 5, mealSize: 32 },
      { id: 'hotdog-downtown', name: 'Plaza Hotdog Cart', position: new THREE.Vector3(12.5, 0, -102), radius: 3.2, price: 5, mealSize: 32 },
    ]
    for (const stand of foodSpecs) {
      this.foodStands.push(stand)
      const { x, z } = stand.position
      if (stand.price === 5) {
        // Sidewalk pushcart with yellow/red umbrella
        this.smallBoxes.add(x, 0.72, z, 1.5, 0.95, 1.0, '#d8dfe6')
        this.trims.add(x, 1.25, z, 1.58, 0.12, 1.08, '#e33b44')
        this.trims.add(x, 1.9, z, 0.08, 1.4, 0.08, '#c5ccd4')
        this.trims.add(x, 2.55, z, 1.9, 0.16, 1.9, '#f2c144')
        const ring = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.25, 24), new THREE.MeshBasicMaterial({ color: '#f6d66d', side: THREE.DoubleSide, transparent: true, opacity: 0.7 }))
        ring.rotation.x = -Math.PI / 2
        ring.position.set(x, 0.16, z)
        this.scene.add(ring)
      } else {
        this.smallBoxes.add(x, 1.4, z, 3.8, 2.8, 2.6, '#f2e4cc')
        this.trims.add(x, 2.9, z, 4.2, 0.35, 3.0, '#ff4b98')
        this.trims.add(x, 0.65, z + 1.45, 3.6, 0.95, 0.35, '#3b4a56')
        this.pinkLights.add(x, 2.55, z + 1.42, 3.4, 0.18, 0.14, '#ff73b8')
        this.sign(stand.name.toUpperCase(), x, 3.45, z + 1.36, 3.4, 0)
        const ring = new THREE.Mesh(new THREE.RingGeometry(1.3, 1.65, 28), new THREE.MeshBasicMaterial({ color: '#77e6e7', side: THREE.DoubleSide, transparent: true, opacity: 0.72 }))
        ring.rotation.x = -Math.PI / 2
        ring.position.set(x, 0.15, z + 2.2)
        this.scene.add(ring)
      }
    }

    // Pay 'n' Spray Garages ($150 repair, respray & new plate to shed vehicle heat)
    const bays: ResprayBay[] = [
      { id: 'spray-downtown', name: "Pay 'n' Spray Downtown", position: new THREE.Vector3(-42, 0, -28), radius: 5.5, price: 150 },
      { id: 'spray-port', name: "Pay 'n' Spray Portside", position: new THREE.Vector3(38, 0, 118), radius: 5.5, price: 150 },
    ]
    for (const bay of bays) {
      this.resprayBays.push(bay)
      const { x, z } = bay.position
      this.addBuilding(x, z - 4.8, 10, 7, 5.2, '#4a555e', false)
      this.trims.add(x, 5.3, z - 4.8, 10.6, 0.5, 7.6, '#f0b848')
      this.sign("PAY 'N' SPRAY", x, 4.1, z - 1.15, 7.8, 0, true)
      this.cyanLights.add(x, 3.2, z - 1.18, 7.5, 0.16, 0.16, '#ffffff')
      const ring = new THREE.Mesh(new THREE.RingGeometry(2.1, 2.55, 30), new THREE.MeshBasicMaterial({ color: '#ffbd59', side: THREE.DoubleSide, transparent: true, opacity: 0.78 }))
      ring.rotation.x = -Math.PI / 2
      ring.position.set(x, 0.14, z + 1.2)
      this.scene.add(ring)
    }
  }

  private makeRain(): THREE.LineSegments {
    const count = 520
    const positions = new Float32Array(count * 6)
    const tips = new Float32Array(count * 2)
    for (let i = 0; i < count; i += 1) {
      const x = (this.random() - 0.5) * 84
      const y = this.random() * 42
      const z = (this.random() - 0.5) * 84
      positions.set([x, y, z, x, y, z], i * 6)
      tips[i * 2 + 1] = 1
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('aTip', new THREE.BufferAttribute(tips, 1))
    const rain = new THREE.LineSegments(geometry, this.rainMaterial)
    rain.frustumCulled = false
    rain.visible = false
    return rain
  }
}
