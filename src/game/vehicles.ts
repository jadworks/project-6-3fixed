import * as THREE from 'three'
import type { WorldCollider, WorldRamp } from './viceWorld'
import { resolveVehicleWorldCollision, supportHeightAt } from './worldCollision'

/**
 * The root position is the authoritative world position, at ground/water level.
 * Heading zero points down -Z; positive steering turns right. Health is 0–100.
 * Velocity is in world units per second and is exposed for camera/audio/gameplay.
 */
export type Vehicle = {
  root: THREE.Group
  type: string
  name: string
  speed: number
  health: number
  heading: number
  velocity: THREE.Vector3
  plateNumber: string
  colorName: string
  vehicleClass: 'compact' | 'sedan' | 'muscle' | 'sport' | 'suv' | 'truck' | 'motorbike' | 'boat' | 'helicopter' | 'taxi'
  securityTier: 1 | 2 | 3
  hotwired: boolean
  alarmActive: boolean
  alarmTimer: number
  trackerActive: boolean
  trackerPingTimer: number
  isPersonal: boolean
  isElectric: boolean
  fuel: number
  trunkWeapons: string[]
}

export type VehicleSurface = 'asphalt' | 'wet' | 'sand' | 'dirt' | 'water'
export type VehicleInput = { throttle: number; steer: number; handbrake: boolean }

export type VehicleTelemetry = {
  speedKmh: number
  rpm: number
  gear: number
  engineStalled: boolean
  cranking: boolean
  crankProgress: number
  seatbeltBuckled: boolean
  hoodObstructing: boolean
  leftHeadlightOk: boolean
  rightHeadlightOk: boolean
  wheelSlip: number
  suspensionCreak: boolean
  plateNumber: string
  colorName: string
  damageState: string
  windshieldCracked: boolean
  securityTier: 1 | 2 | 3
  fuel: number
  isElectric: boolean
  trackerActive: boolean
  isPersonal: boolean
  alarmActive: boolean
  hotwiringProgress: number
}

export type VehicleCollisionReaction = {
  ejectThroughWindshield: boolean
  ejectionVelocity: THREE.Vector3
  crashedHard: boolean
  glassShattered: boolean
  suspensionBottomed: boolean
}

type Wheel = {
  pivot: THREE.Group
  spin: THREE.Group
  steering: THREE.Group | null
  radius: number
  restY: number
  compression: number
  vel: number
  sideSign: number
  front: boolean
  bentYaw: number
  bentCamber: number
}

type Handling = {
  massKg: number
  acceleration: number
  brake: number
  maxSpeed: number
  reverse: number
  turn: number
  grip: number
  width: number
  length: number
  radius: number
  springStiffness: number
  damper: number
  rollStiffness: number
  hasAbs: boolean
}

type DeformableBody = {
  mesh: THREE.Mesh
  basePositions: Float32Array
  halfW: number
  halfH: number
  halfD: number
}

type VehicleParts = {
  model: THREE.Group
  wheels: Wheel[]
  rotor: THREE.Group | null
  tailRotor: THREE.Group | null
  panels: THREE.Object3D[]
  deformableBody?: DeformableBody
  hoodPivot?: THREE.Group
  hoodState: 'closed' | 'popped' | 'detached'
  frontBumper?: THREE.Mesh
  rearBumper?: THREE.Mesh
  windshieldMesh?: THREE.Mesh
  windshieldMaterial?: THREE.MeshStandardMaterial
  windshieldCracked: boolean
  leftHeadlight?: THREE.Mesh
  rightHeadlight?: THREE.Mesh
  leftTaillight?: THREE.Mesh
  rightTaillight?: THREE.Mesh
  leftHeadlightBroken: boolean
  rightHeadlightBroken: boolean
  leftTaillightBroken: boolean
  rightTaillightBroken: boolean
  paint: THREE.MeshStandardMaterial
  paintColor: THREE.Color
  brakeLight: THREE.MeshStandardMaterial
  handling: Handling
  wheelAngle: number
  steerAngle: number
  previousSpeed: number
  previousYaw: number
  heaveY: number
  heaveVel: number
  pitchAngle: number
  rollAngle: number
  wheelSpinSlip: number
  axleBias: number
  engineStalled: boolean
  crankTimer: number
  seatbeltTimer: number
  smokeTimer: number
  fireTimer: number
  impactCooldown: number
  punctureTimer: number
  damageStage: number
  phase: number
  lastDeformHash: number
  hotwireDuration: number
  hotwireProgress: number
}

type Particle = {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  age: number
  life: number
  baseSize: number
  gravity: number
  spin: THREE.Vector3
  disposableMaterial: boolean
}

const clamp = THREE.MathUtils.clamp
const damp = THREE.MathUtils.damp
const UP = new THREE.Vector3(0, 1, 0)
const PARTICLE_LIMIT = 100
const SKIDMARK_LIMIT = 140
const NO_INPUT: VehicleInput = { throttle: 0, steer: 0, handbrake: false }
const GROUND_Y = 0
const HELICOPTER_CEILING = 32

const COMPACT: Handling = { massKg: 1300, acceleration: 13.2, brake: 21, maxSpeed: 30, reverse: 9, turn: 1.62, grip: 7.4, width: 0.96, length: 1.9, radius: 1.25, springStiffness: 34, damper: 6.2, rollStiffness: 1.0, hasAbs: false }
const CAR: Handling = { massKg: 1850, acceleration: 12.2, brake: 22, maxSpeed: 31, reverse: 9, turn: 1.52, grip: 7.2, width: 1.02, length: 2.1, radius: 1.35, springStiffness: 30, damper: 5.5, rollStiffness: 0.85, hasAbs: true }
const SPORT: Handling = { massKg: 1520, acceleration: 17.5, brake: 26, maxSpeed: 38.5, reverse: 10, turn: 1.75, grip: 8.2, width: 1.06, length: 2.12, radius: 1.4, springStiffness: 42, damper: 7.2, rollStiffness: 1.35, hasAbs: true }
const MUSCLE: Handling = { massKg: 1850, acceleration: 15.8, brake: 19.5, maxSpeed: 34.5, reverse: 9, turn: 1.38, grip: 5.2, width: 1.09, length: 2.2, radius: 1.45, springStiffness: 28, damper: 4.8, rollStiffness: 0.72, hasAbs: false }
const SUV: Handling = { massKg: 3400, acceleration: 10.6, brake: 18.5, maxSpeed: 28, reverse: 8, turn: 1.26, grip: 6.1, width: 1.14, length: 2.38, radius: 1.58, springStiffness: 24, damper: 4.4, rollStiffness: 0.52, hasAbs: true }
const TRUCK: Handling = { massKg: 9000, acceleration: 8.5, brake: 17.5, maxSpeed: 25, reverse: 7, turn: 1.05, grip: 5.8, width: 1.2, length: 2.8, radius: 1.8, springStiffness: 22, damper: 4.2, rollStiffness: 0.48, hasAbs: false }
const BIKE: Handling = { massKg: 260, acceleration: 16, brake: 20, maxSpeed: 35, reverse: 6, turn: 2.0, grip: 8.5, width: 0.45, length: 1.4, radius: 0.8, springStiffness: 36, damper: 6.5, rollStiffness: 1.2, hasAbs: false }
const BOAT: Handling = { massKg: 2200, acceleration: 10, brake: 8, maxSpeed: 27, reverse: 7, turn: 1.15, grip: 2.4, width: 1.05, length: 2.35, radius: 1.4, springStiffness: 18, damper: 3.5, rollStiffness: 0.65, hasAbs: true }
const HELI: Handling = { massKg: 3100, acceleration: 9, brake: 10, maxSpeed: 25, reverse: 7, turn: 1.2, grip: 2.0, width: 1.25, length: 2.35, radius: 1.7, springStiffness: 20, damper: 4.0, rollStiffness: 1.0, hasAbs: true }

const RESPRAY_PALETTE: Array<[string, string]> = [
  ['Midnight Silver', '#8b96a3'],
  ['Liberty Cobalt', '#2e598c'],
  ['Crimson Metallic', '#9c2c3c'],
  ['Emerald Slate', '#2b6b5e'],
  ['Obsidian Black', '#1e242c'],
  ['Champagne Gold', '#b89a64'],
]

function randomPlate(index: number): string {
  const letters = 'ABCDEFGHJKLMNPRSTUVWXYZ'
  const a = letters[(index * 7 + 3) % letters.length]
  const b = letters[(index * 11 + 5) % letters.length]
  const c = letters[(index * 13 + 9) % letters.length]
  const num = String((1041 + index * 739) % 9000 + 1000)
  return `${a}${b}${c}-${num}`
}

function colorLabelFromHex(hex: string): string {
  switch (hex.toLowerCase()) {
    case '#f5c84c':
    case '#f2c138':
      return 'Taxi Yellow'
    case '#ee518d':
      return 'Magenta'
    case '#45d5e4':
    case '#4bbad3':
      return 'Cyan'
    case '#e59243':
      return 'Amber'
    case '#b76bea':
      return 'Violet'
    case '#61d8c2':
      return 'Seafoam'
    case '#f16c52':
      return 'Coral Red'
    case '#46525c':
      return 'Gunmetal'
    default:
      return 'Slate'
  }
}

/**
 * GTA IV-inspired 4-Wheel Spring-Damper Suspension, Mass Transfer, Soft-Body Vertex Deformation,
 * Mechanical Failure, ABS Lockup & Pooled Skidmarks Vehicle Simulation.
 */
export class VehicleSystem {
  readonly vehicles: Vehicle[] = []
  active: Vehicle | null = null
  private readonly parts = new Map<Vehicle, VehicleParts>()
  private readonly particles: Particle[] = []
  private readonly particleGeometry = new THREE.IcosahedronGeometry(1, 0)
  private readonly skidMesh: THREE.InstancedMesh
  private readonly skidDummy = new THREE.Object3D()
  private skidCursor = 0
  private skidTimer = 0
  private readonly raycaster = new THREE.Raycaster()
  private readonly scratchForward = new THREE.Vector3()
  private readonly scratchRight = new THREE.Vector3()
  private readonly scratchDirection = new THREE.Vector3()
  private readonly scratchOrigin = new THREE.Vector3()
  private readonly scratchLocalImpact = new THREE.Vector3()
  private obstacles: THREE.Object3D[] = []
  private worldColliders: WorldCollider[] = []
  private worldRamps: WorldRamp[] = []
  private obstacleRefresh = 0
  private placedBoat = false
  private boatSpawn: THREE.Vector3 | null = null
  private time = 0
  private readonly headlightLeft = new THREE.SpotLight('#fff2ce', 0, 52, Math.PI / 5.4, 0.55, 1.35)
  private readonly headlightRight = new THREE.SpotLight('#fff2ce', 0, 52, Math.PI / 5.4, 0.55, 1.35)
  private readonly headlightTargetLeft = new THREE.Object3D()
  private readonly headlightTargetRight = new THREE.Object3D()
  private readonly contactShadowTexture = makeContactShadowTexture()
  private readonly crackedGlassTexture = makeCrackedGlassTexture()
  private pendingReaction: VehicleCollisionReaction = {
    ejectThroughWindshield: false,
    ejectionVelocity: new THREE.Vector3(),
    crashedHard: false,
    glassShattered: false,
    suspensionBottomed: false,
  }
  private plateCounter = 1

  constructor(private readonly scene: THREE.Scene) {
    this.headlightLeft.castShadow = false
    this.headlightRight.castShadow = false
    this.headlightLeft.userData.noVehicleCollision = true
    this.headlightRight.userData.noVehicleCollision = true
    this.headlightTargetLeft.userData.noVehicleCollision = true
    this.headlightTargetRight.userData.noVehicleCollision = true
    this.scene.add(this.headlightLeft, this.headlightRight, this.headlightTargetLeft, this.headlightTargetRight)
    this.headlightLeft.target = this.headlightTargetLeft
    this.headlightRight.target = this.headlightTargetRight

    // Pooled asphalt tire skidmarks (zero per-frame allocations)
    const skidGeo = new THREE.PlaneGeometry(0.32, 0.9)
    skidGeo.rotateX(-Math.PI / 2)
    const skidMat = new THREE.MeshBasicMaterial({ color: '#14161a', transparent: true, opacity: 0.55, depthWrite: false })
    this.skidMesh = new THREE.InstancedMesh(skidGeo, skidMat, SKIDMARK_LIMIT)
    this.skidMesh.frustumCulled = false
    this.skidMesh.userData.noVehicleCollision = true
    this.skidMesh.userData.vehicleEffect = true
    this.skidMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    for (let i = 0; i < SKIDMARK_LIMIT; i += 1) {
      this.skidDummy.scale.setScalar(0)
      this.skidDummy.updateMatrix()
      this.skidMesh.setMatrixAt(i, this.skidDummy.matrix)
    }
    this.skidMesh.instanceMatrix.needsUpdate = true
    this.scene.add(this.skidMesh)

    this.addVehicle('car', 'Roman Liberty Cab', '#f2c138', 4.6, 16.5, -0.1, CAR, 'taxi')
    this.addVehicle('sport', 'Neon Sport', '#ee518d', -4.8, 17.5, 0.15, SPORT, 'sport')
    this.addVehicle('motorbike', 'Street Bike', '#45d5e4', 0.0, 23.5, 0, BIKE, 'motorbike')
    this.addVehicle('truck', 'Utility Truck', '#e59243', 10.5, 20.0, 0, TRUCK, 'truck')
    this.addVehicle('suv', 'Patriot SUV', '#46525c', -8.8, -6.5, Math.PI, SUV, 'suv')
    this.addVehicle('muscle', 'Night Cruiser', '#b76bea', -70, -15, 0, MUSCLE, 'muscle')
    this.addVehicle('car', 'Blista Compact', '#61d8c2', 32, -24, -Math.PI / 2, COMPACT, 'compact')
    this.addVehicle('sport', 'Sunset Sport', '#f16c52', 44, 18, Math.PI, SPORT, 'sport')
    this.addVehicle('motorbike', 'Dock Bike', '#f4c545', -34, 34, Math.PI / 2, BIKE, 'motorbike')
    this.addVehicle('boat', 'Bay Runner', '#4bbad3', 95, 0, Math.PI, BOAT, 'boat')
    this.addVehicle('helicopter', 'Bay Helicopter', '#d9e3df', 16, 29, 0, HELI, 'helicopter')
    if (this.vehicles[0]) {
      this.vehicles[0].isPersonal = true
      this.vehicles[0].hotwired = true
      this.vehicles[0].trackerActive = false
    }
  }

  /** Configure authoritative world OBB colliders and ramps for crisp vehicle physics. */
  setWorldGeometry(colliders: WorldCollider[], ramps: WorldRamp[] = []): void {
    this.worldColliders = colliders
    this.worldRamps = ramps
  }

  /** Push an on-foot player out of parked or moving vehicles. */
  resolvePlayerCollision(position: THREE.Vector3, playerRadius = 0.44): boolean {
    let hit = false
    for (const vehicle of this.vehicles) {
      if (vehicle === this.active) continue
      const data = this.parts.get(vehicle)
      if (!data) continue
      if (position.y > vehicle.root.position.y + 1.8) continue
      const dx = position.x - vehicle.root.position.x
      const dz = position.z - vehicle.root.position.z
      const limit = data.handling.length + playerRadius + 0.5
      if (Math.abs(dx) > limit || Math.abs(dz) > limit) continue
      const c = Math.cos(vehicle.heading)
      const s = Math.sin(vehicle.heading)
      const lx = dx * c - dz * s
      const lz = dx * s + dz * c
      const hx = data.handling.width
      const hz = data.handling.length
      const cx = clamp(lx, -hx, hx)
      const cz = clamp(lz, -hz, hz)
      const px = lx - cx
      const pz = lz - cz
      const distSq = px * px + pz * pz
      if (distSq >= playerRadius * playerRadius) continue
      hit = true
      let pushLx = 0
      let pushLz = 0
      if (distSq > 1e-6) {
        const dist = Math.sqrt(distSq)
        pushLx = (px / dist) * (playerRadius - dist)
        pushLz = (pz / dist) * (playerRadius - dist)
      } else {
        pushLx = (lx >= 0 ? 1 : -1) * (hx - Math.abs(lx) + playerRadius)
      }
      position.x += pushLx * c + pushLz * s
      position.z += -pushLx * s + pushLz * c
    }
    return hit
  }

  /** Only usable vehicles are offered for entry; an occupied wreck can still be exited. */
  nearest(position: THREE.Vector3, maxDistance = 6): Vehicle | null {
    if (Number.isNaN(maxDistance) || maxDistance < 0) return null
    let best: Vehicle | null = null
    let bestDistance = maxDistance * maxDistance
    for (const vehicle of this.vehicles) {
      if (vehicle.health <= 0) continue
      const distance = vehicle.root.position.distanceToSquared(position)
      if (distance <= bestDistance) {
        bestDistance = distance
        best = vehicle
      }
    }
    return best
  }

  /** Wrecks cannot be entered. Handles Security Tiers 1–3, alarms, hotwire timers & trackers. */
  enter(vehicle: Vehicle): void {
    if (this.parts.has(vehicle) && vehicle.health > 0) {
      this.active = vehicle
      const data = this.parts.get(vehicle)
      if (data) {
        data.seatbeltTimer = 0
        if (vehicle.isPersonal || vehicle.hotwired) {
          data.hotwireProgress = 1
        } else if (vehicle.securityTier === 1) {
          vehicle.hotwired = true
          data.hotwireProgress = 1
        } else if (vehicle.securityTier === 2) {
          vehicle.alarmActive = true
          vehicle.alarmTimer = 9.0
          data.hotwireProgress = 0.25
        } else {
          vehicle.alarmActive = true
          vehicle.alarmTimer = 11.0
          vehicle.trackerActive = true
          data.hotwireProgress = 0.1
        }
      }
    }
  }

  /** Step vehicle security hotwire, alarms, GPS tracker pings, and fuel/EV battery consumption. */
  stepSecurityAndFuel(
    dt: number,
    fuelEnabled: boolean,
    speedNorm: number,
  ): { trackerPing: boolean; alarmSounding: boolean; outOfFuel: boolean } {
    const v = this.active
    if (!v) return { trackerPing: false, alarmSounding: false, outOfFuel: false }
    const data = this.parts.get(v)
    let trackerPing = false
    if (data && !v.hotwired && !v.isPersonal) {
      data.hotwireProgress = clamp(data.hotwireProgress + dt / Math.max(0.4, data.hotwireDuration), 0, 1)
      if (data.hotwireProgress >= 1) {
        v.hotwired = true
        v.alarmActive = false
      }
    }
    if (v.alarmActive) {
      v.alarmTimer = Math.max(0, v.alarmTimer - dt)
      if (v.alarmTimer <= 0) v.alarmActive = false
    }
    if (v.trackerActive && !v.isPersonal) {
      v.trackerPingTimer -= dt
      if (v.trackerPingTimer <= 0) {
        v.trackerPingTimer = 7.5
        trackerPing = true
      }
    }
    if (fuelEnabled && v.hotwired && v.type !== 'boat' && v.type !== 'helicopter') {
      const burn = (0.14 + speedNorm * 0.42) * (v.isElectric ? 0.85 : 1)
      v.fuel = clamp(v.fuel - burn * dt, 0, 100)
    }
    return {
      trackerPing,
      alarmSounding: v.alarmActive,
      outOfFuel: fuelEnabled && v.fuel <= 0.1,
    }
  }

  refuel(vehicle: Vehicle, amount = 100): void {
    vehicle.fuel = clamp(vehicle.fuel + amount, 0, 100)
  }

  stripTracker(vehicle: Vehicle): void {
    vehicle.trackerActive = false
    vehicle.alarmActive = false
    vehicle.hotwired = true
  }

  setPersonalVehicle(vehicle: Vehicle): void {
    for (const other of this.vehicles) other.isPersonal = false
    vehicle.isPersonal = true
    vehicle.hotwired = true
    vehicle.alarmActive = false
    vehicle.trackerActive = false
  }

  getPersonalVehicle(): Vehicle | null {
    return this.vehicles.find(v => v.isPersonal && v.health > 0) ?? this.vehicles[0] ?? null
  }

  getTrunkPosition(vehicle: Vehicle): THREE.Vector3 {
    const data = this.parts.get(vehicle)
    const dist = (data?.handling.length ?? 2.1) + 0.9
    return new THREE.Vector3(
      vehicle.root.position.x + Math.sin(vehicle.heading) * dist,
      vehicle.root.position.y,
      vehicle.root.position.z + Math.cos(vehicle.heading) * dist,
    )
  }

  /** Exit on the right-hand side. The caller owns player visibility and teleportation. */
  exit(): THREE.Vector3 | null {
    const vehicle = this.active
    if (!vehicle) return null
    const data = this.parts.get(vehicle)!
    this.active = null
    const right = new THREE.Vector3(Math.cos(vehicle.heading), 0, -Math.sin(vehicle.heading))
    return vehicle.root.position.clone().addScaledVector(right, data.handling.width + 1.0)
  }

  /** High-speed bailout (F at speed): driver jumps out tumbling while car coasts and swerves driverless. */
  bailout(): { exitPos: THREE.Vector3; velocity: THREE.Vector3; speed: number } | null {
    const vehicle = this.active
    if (!vehicle) return null
    const data = this.parts.get(vehicle)!
    const speed = Math.abs(vehicle.speed)
    const right = new THREE.Vector3(Math.cos(vehicle.heading), 0, -Math.sin(vehicle.heading))
    const exitPos = vehicle.root.position.clone().addScaledVector(right, data.handling.width + 1.05)
    const vel = vehicle.velocity.clone().multiplyScalar(0.82).addScaledVector(right, 3.2)
    // Driverless car swerves slightly as it coasts
    data.steerAngle += (Math.random() < 0.5 ? -1 : 1) * 0.14
    this.active = null
    return { exitPos, velocity: vel, speed }
  }

  /** Pay 'n' Spray repair & respray: restores deformation, body health, lights, and changes plate/color! */
  respray(vehicle: Vehicle): { colorName: string; plateNumber: string } {
    const data = this.parts.get(vehicle)
    if (!data) return { colorName: vehicle.colorName, plateNumber: vehicle.plateNumber }
    const [nextColorName, nextHex] = RESPRAY_PALETTE[Math.floor(Math.random() * RESPRAY_PALETTE.length)]
    vehicle.health = 100
    vehicle.colorName = nextColorName
    vehicle.plateNumber = randomPlate(this.plateCounter++)
    data.paintColor.set(nextHex)
    data.paint.color.copy(data.paintColor)
    data.engineStalled = false
    data.crankTimer = 0
    data.axleBias = 0
    data.punctureTimer = 0
    data.damageStage = 0
    data.hoodState = 'closed'
    data.windshieldCracked = false
    if (data.windshieldMaterial) {
      data.windshieldMaterial.map = null
      data.windshieldMaterial.opacity = 1
      data.windshieldMaterial.needsUpdate = true
    }
    if (data.hoodPivot) {
      data.hoodPivot.visible = true
      data.hoodPivot.rotation.x = 0
    }
    if (data.frontBumper) data.frontBumper.visible = true
    if (data.rearBumper) data.rearBumper.visible = true
    data.leftHeadlightBroken = false
    data.rightHeadlightBroken = false
    data.leftTaillightBroken = false
    data.rightTaillightBroken = false
    if (data.leftHeadlight) data.leftHeadlight.visible = true
    if (data.rightHeadlight) data.rightHeadlight.visible = true
    if (data.leftTaillight) data.leftTaillight.visible = true
    if (data.rightTaillight) data.rightTaillight.visible = true
    for (const p of data.panels) p.visible = true
    for (const w of data.wheels) {
      w.bentCamber = 0
      w.bentYaw = 0
    }
    if (data.deformableBody) {
      const posAttr = data.deformableBody.mesh.geometry.getAttribute('position') as THREE.BufferAttribute
      posAttr.array.set(data.deformableBody.basePositions)
      posAttr.needsUpdate = true
      data.deformableBody.mesh.geometry.computeVertexNormals()
    }
    return { colorName: vehicle.colorName, plateNumber: vehicle.plateNumber }
  }

  /** Consume per-step collision reaction events (e.g. >85 km/h windshield ejection, glass shatter). */
  consumeCollisionReaction(): VehicleCollisionReaction {
    const out: VehicleCollisionReaction = {
      ejectThroughWindshield: this.pendingReaction.ejectThroughWindshield,
      ejectionVelocity: this.pendingReaction.ejectionVelocity.clone(),
      crashedHard: this.pendingReaction.crashedHard,
      glassShattered: this.pendingReaction.glassShattered,
      suspensionBottomed: this.pendingReaction.suspensionBottomed,
    }
    this.pendingReaction.ejectThroughWindshield = false
    this.pendingReaction.ejectionVelocity.set(0, 0, 0)
    this.pendingReaction.crashedHard = false
    this.pendingReaction.glassShattered = false
    this.pendingReaction.suspensionBottomed = false
    return out
  }

  getActiveTelemetry(): VehicleTelemetry | null {
    const v = this.active
    if (!v) return null
    const d = this.parts.get(v)
    if (!d) return null
    const absSpeed = Math.abs(v.speed)
    const speedKmh = absSpeed * 3.6
    const gear = absSpeed < 1 ? 1 : Math.min(5, 1 + Math.floor(absSpeed / 7.5))
    const gearMin = (gear - 1) * 7.5
    const rpmRatio = clamp((absSpeed - gearMin) / 8.5, 0.12, 1.0)
    const rpm = Math.round(900 + rpmRatio * 5800)
    const damageState = v.health > 82 ? 'Intact' : v.health > 45 ? 'Dented' : 'Wrecked'
    return {
      speedKmh,
      rpm,
      gear,
      engineStalled: d.engineStalled,
      cranking: d.engineStalled && d.crankTimer > 0,
      crankProgress: d.engineStalled ? clamp(d.crankTimer / 1.1, 0, 1) : 1,
      seatbeltBuckled: d.seatbeltTimer >= 1.5 || v.type === 'motorbike' || v.type === 'boat' || v.type === 'helicopter',
      hoodObstructing: d.hoodState === 'popped',
      leftHeadlightOk: !d.leftHeadlightBroken,
      rightHeadlightOk: !d.rightHeadlightBroken,
      wheelSlip: d.wheelSpinSlip,
      suspensionCreak: Math.abs(d.heaveVel) > 0.85 || Math.abs(d.rollAngle) > 0.08,
      plateNumber: v.plateNumber,
      colorName: v.colorName,
      damageState,
      windshieldCracked: d.windshieldCracked,
      securityTier: v.securityTier,
      fuel: v.fuel,
      isElectric: v.isElectric,
      trackerActive: v.trackerActive,
      isPersonal: v.isPersonal,
      alarmActive: v.alarmActive,
      hotwiringProgress: v.hotwired || v.isPersonal ? 1 : d.hotwireProgress,
    }
  }

  update(dt: number, input: VehicleInput, surfaceAt: (x: number, z: number) => VehicleSurface, handlingBonus = 0): void {
    if (!Number.isFinite(dt) || dt <= 0) return
    let remaining = Math.min(dt, 0.25)
    if (!this.placedBoat) {
      this.placeBoat(surfaceAt)
      this.placedBoat = true
    }
    this.obstacleRefresh -= remaining
    if (this.obstacleRefresh <= 0 && this.worldColliders.length === 0) {
      this.refreshObstacles()
      this.obstacleRefresh = 1
    }
    this.scene.updateMatrixWorld(true)
    const control: VehicleInput = {
      throttle: clamp(Number.isFinite(input.throttle) ? input.throttle : 0, -1, 1),
      steer: clamp(Number.isFinite(input.steer) ? input.steer : 0, -1, 1),
      handbrake: Boolean(input.handbrake),
    }
    while (remaining > 1e-7) {
      const step = Math.min(remaining, 1 / 30)
      this.time += step
      this.skidTimer = Math.max(0, this.skidTimer - step)
      for (const vehicle of this.vehicles) {
        const data = this.parts.get(vehicle)
        if (!data) continue
        data.impactCooldown = Math.max(0, data.impactCooldown - step)
        const surface = surfaceAt(vehicle.root.position.x, vehicle.root.position.z)
        const vInput = vehicle === this.active ? control : NO_INPUT
        this.stepVehicle(vehicle, data, step, vInput, surface, vehicle === this.active ? handlingBonus : 0)
        this.animateVehicle(vehicle, data, step, surface, vInput)
        this.emitDamage(vehicle, data, step)
      }
      this.stepParticles(step)
      remaining -= step
    }

    if (this.active && this.active.health > 0) {
      const d = this.parts.get(this.active)!
      const fwdX = -Math.sin(this.active.heading)
      const fwdZ = -Math.cos(this.active.heading)
      const rightX = Math.cos(this.active.heading)
      const rightZ = -Math.sin(this.active.heading)
      const pos = this.active.root.position
      this.headlightLeft.intensity = d.leftHeadlightBroken ? 0 : 15
      this.headlightRight.intensity = d.rightHeadlightBroken ? 0 : 15
      this.headlightLeft.position.set(pos.x + fwdX * 1.65 - rightX * 0.68, pos.y + 1.0, pos.z + fwdZ * 1.65 - rightZ * 0.68)
      this.headlightTargetLeft.position.set(pos.x + fwdX * 18 - rightX * 1.1, Math.max(0, pos.y - 0.4), pos.z + fwdZ * 18 - rightZ * 1.1)
      this.headlightTargetLeft.updateMatrixWorld()
      this.headlightRight.position.set(pos.x + fwdX * 1.65 + rightX * 0.68, pos.y + 1.0, pos.z + fwdZ * 1.65 + rightZ * 0.68)
      this.headlightTargetRight.position.set(pos.x + fwdX * 18 + rightX * 1.1, Math.max(0, pos.y - 0.4), pos.z + fwdZ * 18 + rightZ * 1.1)
      this.headlightTargetRight.updateMatrixWorld()
    } else {
      this.headlightLeft.intensity = 0
      this.headlightRight.intensity = 0
    }
  }

  /** Apply soft-body vertex deformation + mechanical/component damage from local or world contact. */
  deformAt(vehicle: Vehicle, worldContact: THREE.Vector3, impactSpeed: number): void {
    const data = this.parts.get(vehicle)
    if (!data) return
    const h = data.handling
    const c = Math.cos(vehicle.heading)
    const s = Math.sin(vehicle.heading)
    const dx = worldContact.x - vehicle.root.position.x
    const dz = worldContact.z - vehicle.root.position.z
    const lx = dx * c - dz * s
    const lz = dx * s + dz * c
    const frontHit = lz < -h.length * 0.35
    const rearHit = lz > h.length * 0.35
    const leftHit = lx < -0.2
    const rightHit = lx > 0.2

    // Soft-body mesh vertex crumpling around local impact zone
    if (data.deformableBody && impactSpeed > 3.5) {
      const { mesh, basePositions, halfW, halfD } = data.deformableBody
      const posAttr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute
      const arr = posAttr.array as Float32Array
      const localImpactY = clamp(worldContact.y - vehicle.root.position.y, 0.25, 1.35)
      this.scratchLocalImpact.set(clamp(lx, -halfW, halfW), localImpactY - 0.72, clamp(lz, -halfD, halfD))
      const dentRadius = clamp(0.85 + impactSpeed * 0.055, 0.9, 1.75)
      const dentDepth = clamp((impactSpeed - 3) * 0.028, 0.06, 0.42)
      let modified = false

      for (let i = 0; i < arr.length; i += 3) {
        const vx = arr[i]
        const vy = arr[i + 1]
        const vz = arr[i + 2]
        const dist = Math.hypot(vx - this.scratchLocalImpact.x, vy - this.scratchLocalImpact.y, vz - this.scratchLocalImpact.z)
        if (dist >= dentRadius) continue
        const falloff = 1 - dist / dentRadius
        const push = falloff * falloff * dentDepth
        const bx = basePositions[i]
        const bz = basePositions[i + 2]
        // Dent inward toward chassis core without warping below axle height
        const nx = -Math.sign(vx || lx || 0) * 0.55
        const nz = -Math.sign(vz || lz || 0) * 0.85
        const nextX = vx + nx * push
        const nextZ = vz + nz * push
        arr[i] = clamp(nextX, bx - 0.44, bx + 0.44)
        arr[i + 2] = clamp(nextZ, bz - 0.48, bz + 0.48)
        if (vy > 0.05) arr[i + 1] += falloff * dentDepth * 0.22
        modified = true
      }
      if (modified) {
        posAttr.needsUpdate = true
        mesh.geometry.computeVertexNormals()
      }
    }

    // Individual headlight / taillight shatter, bumper detach, hood latch pop, bent axle & engine stall
    if (frontHit && impactSpeed > 5.5) {
      if (leftHit && !data.leftHeadlightBroken && data.leftHeadlight) {
        data.leftHeadlightBroken = true
        data.leftHeadlight.visible = false
        this.pendingReaction.glassShattered = true
      }
      if (rightHit && !data.rightHeadlightBroken && data.rightHeadlight) {
        data.rightHeadlightBroken = true
        data.rightHeadlight.visible = false
        this.pendingReaction.glassShattered = true
      }
      if (!leftHit && !rightHit && data.leftHeadlight && !data.leftHeadlightBroken) {
        data.leftHeadlightBroken = true
        data.leftHeadlight.visible = false
        this.pendingReaction.glassShattered = true
      }
      if (impactSpeed > 9 && data.frontBumper?.visible) {
        this.breakOff(vehicle, data.frontBumper)
      }
      if (impactSpeed > 11 && data.hoodState === 'closed' && data.hoodPivot) {
        data.hoodState = 'popped'
      } else if (impactSpeed > 18 && data.hoodState === 'popped' && data.hoodPivot) {
        data.hoodState = 'detached'
        this.breakOff(vehicle, data.hoodPivot)
      }
      if (impactSpeed > 12) {
        data.axleBias = clamp(data.axleBias + (leftHit ? -1 : 1) * 0.07, -0.18, 0.18)
        const wheel = data.wheels.find(w => w.front && (leftHit ? w.sideSign < 0 : w.sideSign > 0))
        if (wheel) wheel.bentCamber = (leftHit ? -1 : 1) * 0.16
      }
      if (impactSpeed > 14 && vehicle.health < 55) {
        data.engineStalled = true
        data.crankTimer = 0
      }
      if (impactSpeed > 14 && !data.windshieldCracked && data.windshieldMaterial) {
        data.windshieldCracked = true
        data.windshieldMaterial.map = this.crackedGlassTexture
        data.windshieldMaterial.needsUpdate = true
        this.pendingReaction.glassShattered = true
      }
    } else if (rearHit && impactSpeed > 6) {
      if (leftHit && !data.leftTaillightBroken && data.leftTaillight) {
        data.leftTaillightBroken = true
        data.leftTaillight.visible = false
        this.pendingReaction.glassShattered = true
      }
      if (rightHit && !data.rightTaillightBroken && data.rightTaillight) {
        data.rightTaillightBroken = true
        data.rightTaillight.visible = false
        this.pendingReaction.glassShattered = true
      }
      if (impactSpeed > 9 && data.rearBumper?.visible) {
        this.breakOff(vehicle, data.rearBumper)
      }
    }

    // High-speed (>85 km/h = 23.6 m/s) head-on crash BEFORE seatbelt buckled (1.5s) ejects player!
    if (
      vehicle === this.active
      && frontHit
      && impactSpeed >= 23.6
      && data.seatbeltTimer < 1.5
      && vehicle.type !== 'motorbike'
      && vehicle.type !== 'boat'
      && vehicle.type !== 'helicopter'
    ) {
      this.pendingReaction.ejectThroughWindshield = true
      this.pendingReaction.ejectionVelocity.set(
        -Math.sin(vehicle.heading) * Math.max(14, impactSpeed * 0.72),
        5.8,
        -Math.cos(vehicle.heading) * Math.max(14, impactSpeed * 0.72),
      )
      if (!data.windshieldCracked && data.windshieldMaterial) {
        data.windshieldCracked = true
        data.windshieldMaterial.map = this.crackedGlassTexture
        data.windshieldMaterial.needsUpdate = true
      }
      this.pendingReaction.glassShattered = true
    }
    if (impactSpeed > 8) this.pendingReaction.crashedHard = true
  }

  damage(vehicle: Vehicle, amount: number): void {
    const data = this.parts.get(vehicle)
    if (!data || !Number.isFinite(amount) || amount <= 0) return
    vehicle.health = clamp(vehicle.health - amount, 0, 100)
    data.paint.color.copy(data.paintColor).multiplyScalar(0.46 + 0.54 * vehicle.health / 100)
    if (vehicle.health < 36 && amount > 6 && !data.engineStalled && vehicle.type !== 'boat' && vehicle.type !== 'helicopter') {
      data.engineStalled = true
      data.crankTimer = 0
    }
    const stage = vehicle.health <= 25 ? 2 : vehicle.health <= 55 ? 1 : 0
    while (data.damageStage < stage) {
      const panel = data.panels[data.damageStage]
      if (panel) this.breakOff(vehicle, panel)
      data.damageStage += 1
    }
  }

  /** Puncture tires when driving over a 3+ star police spike strip. */
  puncture(vehicle: Vehicle, seconds = 5.5): void {
    const data = this.parts.get(vehicle)
    if (!data || vehicle.type === 'helicopter' || vehicle.type === 'boat') return
    data.punctureTimer = Math.max(data.punctureTimer, seconds)
    this.damage(vehicle, 12)
  }

  private addVehicle(
    type: string,
    name: string,
    color: string,
    x: number,
    z: number,
    heading: number,
    handling: Handling,
    vehicleClass: Vehicle['vehicleClass'],
  ): void {
    const root = new THREE.Group()
    root.name = `vehicle:${name}`
    root.userData.vehicleRoot = true
    root.position.set(x, GROUND_Y, z)
    root.rotation.y = heading
    const model = new THREE.Group()
    model.rotation.order = 'YXZ'
    root.add(model)
    const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.45, roughness: 0.36 })
    const brakeLight = new THREE.MeshStandardMaterial({ color: '#ef273b', emissive: '#ef273b', emissiveIntensity: 1.4, roughness: 0.25 })
    const securityTier: 1 | 2 | 3 =
      vehicleClass === 'sport' || vehicleClass === 'boat' || vehicleClass === 'helicopter'
        ? 3
        : vehicleClass === 'compact' || vehicleClass === 'taxi' || vehicleClass === 'motorbike'
          ? 1
          : 2
    const hotwireDuration = securityTier === 1 ? 0.2 : securityTier === 2 ? 1.8 : 3.2
    const parts: VehicleParts = {
      model, paint, paintColor: paint.color.clone(), brakeLight, handling,
      wheels: [], rotor: null, tailRotor: null, panels: [],
      hoodState: 'closed', windshieldCracked: false,
      leftHeadlightBroken: false, rightHeadlightBroken: false,
      leftTaillightBroken: false, rightTaillightBroken: false,
      wheelAngle: 0, steerAngle: 0, previousSpeed: 0, previousYaw: heading,
      heaveY: 0, heaveVel: 0, pitchAngle: 0, rollAngle: 0, wheelSpinSlip: 0,
      axleBias: 0, engineStalled: false, crankTimer: 0, seatbeltTimer: 0,
      smokeTimer: 0, fireTimer: 0, impactCooldown: 0, punctureTimer: 0, damageStage: 0,
      phase: Math.random() * Math.PI * 2, lastDeformHash: 0,
      hotwireDuration, hotwireProgress: securityTier === 1 ? 1 : 0,
    }
    const vehicle: Vehicle = {
      root, type, name, speed: 0, health: 100, heading, velocity: new THREE.Vector3(),
      plateNumber: randomPlate(this.plateCounter++),
      colorName: colorLabelFromHex(color),
      vehicleClass,
      securityTier,
      hotwired: securityTier === 1,
      alarmActive: false,
      alarmTimer: 0,
      trackerActive: false,
      trackerPingTimer: 4.0,
      isPersonal: false,
      isElectric: vehicleClass === 'sport' && name === 'Neon Sport',
      fuel: 72 + Math.round(Math.random() * 26),
      trunkWeapons: ['carbine', 'pump_shotgun'],
    }
    if (type === 'motorbike') this.buildBike(parts)
    else if (type === 'truck') this.buildTruck(parts)
    else if (type === 'suv') this.buildSuv(parts)
    else if (type === 'boat') this.buildBoat(parts)
    else if (type === 'helicopter') this.buildHelicopter(parts)
    else this.buildCar(parts, vehicleClass)

    root.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true
        object.receiveShadow = true
      }
    })
    if (type !== 'helicopter' && type !== 'boat') {
      const shadowPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(handling.width * 2.55, handling.length * 2.3),
        new THREE.MeshBasicMaterial({ map: this.contactShadowTexture, transparent: true, opacity: 0.55, depthWrite: false }),
      )
      shadowPlane.rotation.x = -Math.PI / 2
      shadowPlane.position.y = 0.032
      shadowPlane.userData.noVehicleCollision = true
      root.add(shadowPlane)
    }
    this.vehicles.push(vehicle)
    this.parts.set(vehicle, parts)
    this.scene.add(root)
    if (type === 'boat') this.boatSpawn = root.position.clone()
  }

  private stepVehicle(v: Vehicle, data: VehicleParts, dt: number, input: VehicleInput, surface: VehicleSurface, handlingBonus = 0): void {
    const h = data.handling
    const helicopter = v.type === 'helicopter'
    const boat = v.type === 'boat'
    const inWater = surface === 'water'

    if (v === this.active) {
      data.seatbeltTimer += dt
      // Starter crank recovery when engine is stalled
      if (data.engineStalled) {
        if (input.throttle > 0.15 && v.health > 0) {
          data.crankTimer += dt
          if (data.crankTimer >= 1.1) {
            data.engineStalled = false
            data.crankTimer = 0
          }
        } else {
          data.crankTimer = Math.max(0, data.crankTimer - dt * 0.5)
        }
      }
    }

    const skillMult = 1 + Math.max(0, Math.min(0.45, handlingBonus))
    let power = skillMult
    let speedLimit = h.maxSpeed * (1 + Math.max(0, Math.min(0.18, handlingBonus * 0.4)))
    let grip = h.grip * skillMult
    if (boat) {
      if (!inWater) { power = 0.18; speedLimit = 3; grip = 4 }
    } else if (!helicopter) {
      // Wet weather reduces road friction by 30%
      if (surface === 'wet') grip *= 0.70
      else if (surface === 'sand') { grip *= 0.57; power *= 0.66; speedLimit *= 0.65 }
      else if (surface === 'dirt') { grip *= 0.70; power *= 0.82; speedLimit *= 0.82 }
      else if (inWater) { grip *= 0.28; power *= 0.2; speedLimit = 4 }
    }
    if (data.punctureTimer > 0) {
      data.punctureTimer = Math.max(0, data.punctureTimer - dt)
      grip *= 0.45
      speedLimit *= 0.56
      power *= 0.72
    }

    // Heavier mass reduces instantaneous wheelspin twitchiness, adds weight momentum
    const massFactor = clamp(1850 / h.massKg, 0.45, 1.35)
    this.scratchForward.set(-Math.sin(v.heading), 0, -Math.cos(v.heading))
    let longitudinal = v.velocity.dot(this.scratchForward)
    const forwardSign = longitudinal < -0.15 ? -1 : 1
    const absLong = Math.abs(longitudinal)

    const brakingHard = (input.throttle < -0.55 && longitudinal > 2.5) || input.handbrake
    const absLockup = !helicopter && !boat && brakingHard && (!h.hasAbs || input.handbrake)
    if (absLockup) grip *= input.handbrake ? 0.22 : 0.45
    else if (h.hasAbs && brakingHard && !input.handbrake && !helicopter && !boat) {
      // ABS rapid cadence modulation keeps lateral steering bite under hard braking
      grip *= 0.86 + 0.12 * Math.sin(this.time * 38)
    } else if (input.handbrake && !helicopter) grip *= 0.22

    if (v.health <= 0 || data.engineStalled || !v.hotwired || v.fuel <= 0.1) power = 0
    else if (v.health < 25) power *= 0.55

    // Non-ABS wheel lockup cuts steering authority under full footbrake
    const lockSteerMult = absLockup && !input.handbrake && input.throttle < -0.5 ? 0.52 : 1.0
    const turnSpeed = helicopter
      ? h.turn * (0.65 + 0.35 * Math.min(1, absLong / 10))
      : h.turn * Math.min(1, Math.max(0.28, absLong / 4.2)) / (1 + absLong * 0.036) * lockSteerMult
    const driftTurn = input.handbrake && !helicopter ? 1.28 : 1
    const steerWithAxle = clamp(input.steer + (absLong > 2 ? data.axleBias : 0), -1, 1)
    v.heading -= steerWithAxle * turnSpeed * (helicopter ? 1 : forwardSign) * driftTurn * dt
    v.heading = Math.atan2(Math.sin(v.heading), Math.cos(v.heading))
    v.root.rotation.y = v.heading
    this.scratchForward.set(-Math.sin(v.heading), 0, -Math.cos(v.heading))
    this.scratchRight.set(Math.cos(v.heading), 0, -Math.sin(v.heading))
    longitudinal = v.velocity.dot(this.scratchForward)
    let lateral = v.velocity.dot(this.scratchRight)

    const throttle = v.health > 0 && !data.engineStalled && v.hotwired && v.fuel > 0.1 ? input.throttle : 0
    const braking = (throttle > 0.02 && longitudinal < -0.4) || (throttle < -0.02 && longitudinal > 0.25)
    const absBrakePulse = h.hasAbs && braking && !input.handbrake && !helicopter && !boat
      ? 0.94 + 0.08 * Math.sin(this.time * 38)
      : 1.0
    const acceleration = braking
      ? h.brake * absBrakePulse * (surface === 'wet' ? 0.72 : 1)
      : h.acceleration * power * (0.85 + 0.15 * massFactor)
    // Wheel spin burnout from standstill before tires hook up
    const launchSlip = !helicopter && !boat && throttle > 0.75 && absLong < 6.5 ? 0.82 : 1.0
    longitudinal += throttle * acceleration * launchSlip * dt

    const drag = boat && !inWater ? 1.5 : !boat && !helicopter && inWater ? 1.05 : helicopter ? 0.18 : boat ? 0.2 : 0.13
    longitudinal *= Math.exp(-drag * dt)
    if (Math.abs(throttle) < 0.01 && !helicopter) {
      const resistance = (boat ? 0.8 : 1.25) * dt
      longitudinal = Math.sign(longitudinal) * Math.max(0, Math.abs(longitudinal) - resistance)
    }
    if (input.handbrake && !helicopter) longitudinal *= Math.exp(-1.45 * dt)
    longitudinal = clamp(longitudinal, -Math.min(h.reverse, speedLimit), speedLimit)
    lateral *= Math.exp(-grip * dt)
    v.velocity.x = this.scratchForward.x * longitudinal + this.scratchRight.x * lateral
    v.velocity.z = this.scratchForward.z * longitudinal + this.scratchRight.z * lateral

    // Track wheel slip for smoke & pooled asphalt skidmarks
    const lateralSlip = Math.abs(lateral) / Math.max(2, absLong + 2)
    const throttleSlip = !helicopter && !boat && throttle > 0.72 && absLong < 7.5 && !data.engineStalled ? 0.85 : 0
    data.wheelSpinSlip = clamp(Math.max(lateralSlip * 1.4, throttleSlip, absLockup && absLong > 4 ? 0.9 : 0), 0, 1)

    const floorY = this.worldColliders.length > 0 && !helicopter && !boat
      ? supportHeightAt(v.root.position.x, v.root.position.z, v.root.position.y, this.worldColliders, this.worldRamps, GROUND_Y)
      : GROUND_Y
    if (helicopter) {
      const desiredLift = v === this.active && v.health > 0 ? throttle * 6 : -3
      v.velocity.y = damp(v.velocity.y, desiredLift, 3, dt)
      v.root.position.y = clamp(v.root.position.y + v.velocity.y * dt, floorY, HELICOPTER_CEILING)
      if ((v.root.position.y <= floorY && v.velocity.y < 0) || (v.root.position.y >= HELICOPTER_CEILING && v.velocity.y > 0)) v.velocity.y = 0
    } else if (v.root.position.y > floorY || v.velocity.y > 0) {
      v.velocity.y -= 16 * dt
      const prevVy = v.velocity.y
      v.root.position.y = Math.max(floorY, v.root.position.y + v.velocity.y * dt)
      if (v.root.position.y <= floorY && prevVy < 0) {
        data.heaveVel += prevVy * 0.55
        if (prevVy < -4.2 && v === this.active) this.pendingReaction.suspensionBottomed = true
        v.velocity.y = 0
      }
    } else {
      v.root.position.y = floorY
      v.velocity.y = 0
    }

    const dx = v.velocity.x * dt
    const dz = v.velocity.z * dt
    const distance = Math.hypot(dx, dz)
    if (distance > 1e-5) {
      if (this.worldColliders.length > 0) {
        v.root.position.x += dx
        v.root.position.z += dz
        const collision = resolveVehicleWorldCollision(
          v.root.position,
          v.heading,
          h.width,
          h.length,
          this.worldColliders,
          v.velocity,
          helicopter,
        )
        if (collision.hit && collision.impactSpeed > 3.5 && data.impactCooldown <= 0) {
          this.damage(v, (collision.impactSpeed - 3.5) * 1.55)
          this.deformAt(v, collision.contact, collision.impactSpeed)
          this.emitSparks(collision.contact, 4)
          data.impactCooldown = 0.45
        }
      } else {
        this.scratchDirection.set(dx / distance, 0, dz / distance)
        const allowed = this.sweepWorld(v, h, this.scratchDirection, distance)
        v.root.position.x += this.scratchDirection.x * allowed
        v.root.position.z += this.scratchDirection.z * allowed
        if (allowed < distance - 1e-4) {
          const impact = Math.hypot(v.velocity.x, v.velocity.z)
          v.velocity.x *= -0.12
          v.velocity.z *= -0.12
          if (impact > 3 && data.impactCooldown <= 0) {
            this.damage(v, (impact - 3) * 1.8)
            const noseContact = v.root.position.clone().addScaledVector(this.scratchForward, h.length)
            this.deformAt(v, noseContact, impact)
            data.impactCooldown = 0.5
          }
        }
      }
      this.collideVehicles(v, data)
    }
    v.speed = v.velocity.x * this.scratchForward.x + v.velocity.z * this.scratchForward.z
  }

  private emitSparks(origin: THREE.Vector3, count: number): void {
    for (let i = 0; i < count && this.particles.length < PARTICLE_LIMIT; i += 1) {
      const material = new THREE.MeshBasicMaterial({ color: i % 2 === 0 ? '#ffe57f' : '#ff9642', transparent: true, opacity: 0.95, depthWrite: false })
      const mesh = new THREE.Mesh(this.particleGeometry, material)
      mesh.userData.vehicleEffect = true
      mesh.position.copy(origin)
      mesh.scale.setScalar(0.08)
      this.scene.add(mesh)
      this.particles.push({
        mesh,
        velocity: new THREE.Vector3((Math.random() - 0.5) * 8, 2 + Math.random() * 4, (Math.random() - 0.5) * 8),
        age: 0,
        life: 0.25 + Math.random() * 0.2,
        baseSize: 0.08,
        gravity: -12,
        spin: new THREE.Vector3(),
        disposableMaterial: true,
      })
    }
  }

  private emitTireSmoke(v: Vehicle, data: VehicleParts): void {
    if (this.particles.length >= PARTICLE_LIMIT) return
    const mat = new THREE.MeshBasicMaterial({ color: '#e6eaed', transparent: true, opacity: 0.42, depthWrite: false })
    const mesh = new THREE.Mesh(this.particleGeometry, mat)
    mesh.userData.vehicleEffect = true
    const side = Math.random() < 0.5 ? -data.handling.width * 0.85 : data.handling.width * 0.85
    const rightX = Math.cos(v.heading)
    const rightZ = -Math.sin(v.heading)
    const fwdX = -Math.sin(v.heading)
    const fwdZ = -Math.cos(v.heading)
    mesh.position.set(
      v.root.position.x + rightX * side - fwdX * (data.handling.length * 0.6),
      v.root.position.y + 0.22,
      v.root.position.z + rightZ * side - fwdZ * (data.handling.length * 0.6),
    )
    const size = 0.24
    mesh.scale.setScalar(size)
    this.scene.add(mesh)
    this.particles.push({
      mesh,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 0.7, 0.8 + Math.random() * 0.6, (Math.random() - 0.5) * 0.7),
      age: 0,
      life: 0.9,
      baseSize: size,
      gravity: 0.15,
      spin: new THREE.Vector3(),
      disposableMaterial: true,
    })
  }

  private stampSkidmarks(v: Vehicle, data: VehicleParts): void {
    const rightX = Math.cos(v.heading)
    const rightZ = -Math.sin(v.heading)
    const fwdX = -Math.sin(v.heading)
    const fwdZ = -Math.cos(v.heading)
    for (const wheel of data.wheels) {
      if (wheel.front || wheel.compression < -0.14) continue
      const idx = this.skidCursor++ % SKIDMARK_LIMIT
      this.skidDummy.position.set(
        v.root.position.x + rightX * (wheel.sideSign * data.handling.width * 0.88) - fwdX * 1.25,
        v.root.position.y + 0.036,
        v.root.position.z + rightZ * (wheel.sideSign * data.handling.width * 0.88) - fwdZ * 1.25,
      )
      this.skidDummy.rotation.set(0, v.heading, 0)
      this.skidDummy.scale.set(1, 1, 1)
      this.skidDummy.updateMatrix()
      this.skidMesh.setMatrixAt(idx, this.skidDummy.matrix)
    }
    this.skidMesh.instanceMatrix.needsUpdate = true
  }

  private sweepWorld(v: Vehicle, h: Handling, direction: THREE.Vector3, distance: number): number {
    if (!this.obstacles.length) return distance
    const forward = this.scratchForward
    const right = this.scratchRight
    const nose = Math.abs(direction.dot(forward)) * h.length + Math.abs(direction.dot(right)) * h.width
    const sideX = -direction.z
    const sideZ = direction.x
    const sideExtent = (Math.abs(sideX * forward.x + sideZ * forward.z) * h.length + Math.abs(sideX * right.x + sideZ * right.z) * h.width) * 0.72
    let allowed = distance
    this.raycaster.near = 0
    this.raycaster.far = distance + nose + 0.08
    for (const side of [-1, 0, 1]) {
      this.scratchOrigin.set(v.root.position.x + sideX * sideExtent * side, v.root.position.y + (v.type === 'helicopter' ? 1.2 : 0.65), v.root.position.z + sideZ * sideExtent * side)
      this.raycaster.set(this.scratchOrigin, direction)
      const hits = this.raycaster.intersectObjects(this.obstacles, false)
      const hit = hits.find(intersection => this.isObstacle(intersection.object))
      if (hit) allowed = Math.min(allowed, Math.max(0, hit.distance - nose - 0.05))
    }
    return allowed
  }

  private collideVehicles(v: Vehicle, data: VehicleParts): void {
    for (const other of this.vehicles) {
      if (other === v || Math.abs(v.root.position.y - other.root.position.y) > 2.5) continue
      const otherData = this.parts.get(other)
      if (!otherData) continue
      let dx = v.root.position.x - other.root.position.x
      let dz = v.root.position.z - other.root.position.z
      let distance = Math.hypot(dx, dz)
      const min = data.handling.radius + otherData.handling.radius
      if (distance >= min) continue
      if (distance < 0.0001) { dx = 1; dz = 0; distance = 1 }
      const nx = dx / distance
      const nz = dz / distance
      const closing = (other.velocity.x - v.velocity.x) * nx + (other.velocity.z - v.velocity.z) * nz
      const penetration = Math.max(0, min - distance)
      const totalMass = data.handling.massKg + otherData.handling.massKg
      const vShare = otherData.handling.massKg / totalMass
      const oShare = data.handling.massKg / totalMass
      v.root.position.x += nx * penetration * vShare
      v.root.position.z += nz * penetration * vShare
      other.root.position.x -= nx * penetration * oShare
      other.root.position.z -= nz * penetration * oShare
      if (closing > 0) {
        const impulse = closing * 0.92
        v.velocity.x += nx * impulse * vShare
        v.velocity.z += nz * impulse * vShare
        other.velocity.x -= nx * impulse * oShare
        other.velocity.z -= nz * impulse * oShare
        if (closing > 3 && data.impactCooldown <= 0 && otherData.impactCooldown <= 0) {
          const contact = v.root.position.clone().lerp(other.root.position, 0.5)
          contact.y += 0.65
          this.damage(v, (closing - 3) * 1.45 * vShare * 2)
          this.damage(other, (closing - 3) * 1.25 * oShare * 2)
          this.deformAt(v, contact, closing)
          this.deformAt(other, contact, closing)
          data.impactCooldown = otherData.impactCooldown = 0.55
        }
      }
    }
  }

  private animateVehicle(v: Vehicle, data: VehicleParts, dt: number, surface: VehicleSurface, input: VehicleInput): void {
    const h = data.handling
    const speedRatio = clamp(Math.abs(v.speed) / h.maxSpeed, 0, 1)
    const accel = clamp((v.speed - data.previousSpeed) / Math.max(dt, 0.001), -28, 28)
    data.previousSpeed = v.speed
    const yawRate = Math.atan2(Math.sin(v.heading - data.previousYaw), Math.cos(v.heading - data.previousYaw)) / Math.max(dt, 0.001)
    data.previousYaw = v.heading

    data.steerAngle = damp(data.steerAngle, input.steer * 0.48, 7.5, dt)

    // 4-wheel spring-damper pitch, roll & heave solver
    const lateralG = clamp((v.speed * yawRate) / 14, -1.6, 1.6)
    const targetPitch = clamp(accel * 0.0095 / Math.sqrt(h.rollStiffness), -0.14, 0.14)
    const targetRoll = v.type === 'motorbike'
      ? -input.steer * speedRatio * 0.42
      : clamp(-lateralG * 0.115 / h.rollStiffness, -0.19, 0.19)

    data.pitchAngle = damp(data.pitchAngle, targetPitch, 6.8, dt)
    data.rollAngle = damp(data.rollAngle, targetRoll, 5.6, dt)
    // Heave spring-damper bounce + engine crank shudder
    const springForce = -h.springStiffness * data.heaveY - h.damper * data.heaveVel
    data.heaveVel += springForce * dt
    data.heaveY = clamp(data.heaveY + data.heaveVel * dt, -0.18, 0.18)

    data.model.rotation.z = data.rollAngle
    data.model.rotation.x = data.pitchAngle + (v.type === 'helicopter' ? -speedRatio * 0.14 : 0)
    const rough = surface === 'dirt' || surface === 'sand' ? 0.035 : 0.011
    const crankVibration = data.engineStalled && data.crankTimer > 0 ? Math.sin(this.time * 42) * 0.018 : 0
    const bob = v.type === 'boat' && surface === 'water'
      ? Math.sin(this.time * 2 + data.phase) * 0.08
      : Math.sin(this.time * 12 + data.phase) * rough * speedRatio + data.heaveY + crankVibration
    data.model.position.y = bob

    // Independent 4-wheel suspension compression + inner-wheel lift on top-heavy SUVs/vans
    for (const wheel of data.wheels) {
      const pitchComp = wheel.front ? -data.pitchAngle * 0.55 : data.pitchAngle * 0.55
      const rollComp = wheel.sideSign * data.rollAngle * 1.15
      wheel.compression = clamp(pitchComp + rollComp + data.heaveY * 0.6, -0.22, 0.16)
      wheel.pivot.position.y = wheel.restY - wheel.compression * 0.55
      wheel.pivot.rotation.z = wheel.bentCamber
      const spinMult = data.wheelSpinSlip > 0.65 && !wheel.front ? 1.75 : 1.0
      wheel.spin.rotation.x -= (v.speed * spinMult * dt) / wheel.radius
      if (wheel.steering) wheel.steering.rotation.y = -data.steerAngle + wheel.bentYaw
    }

    // Popped hood flutters dramatically in wind at speed
    if (data.hoodPivot && data.hoodState === 'popped') {
      const targetHoodLift = 0.38 + speedRatio * 0.35 + Math.sin(this.time * 16) * (0.04 + speedRatio * 0.08)
      data.hoodPivot.rotation.x = damp(data.hoodPivot.rotation.x, targetHoodLift, 11, dt)
    }

    // Pooled skidmarks & tire smoke when sliding/burning out
    if (data.wheelSpinSlip > 0.52 && v === this.active && surface !== 'water') {
      if (this.skidTimer <= 0) {
        this.skidTimer = 0.045
        this.stampSkidmarks(v, data)
      }
      if (Math.random() < 0.45) this.emitTireSmoke(v, data)
    }

    if (data.rotor) data.rotor.rotation.y += dt * (v === this.active ? 26 : v.root.position.y > 0.1 ? 16 : 3)
    if (data.tailRotor) data.tailRotor.rotation.x += dt * (v === this.active ? 38 : 5)
    const braking = input.handbrake || (input.throttle < -0.05 && v.speed > 0.5) || (input.throttle > 0.05 && v.speed < -0.5)
    data.brakeLight.emissiveIntensity = braking ? 3.6 : 1.35
  }

  private refreshObstacles(): void {
    const objects: THREE.Object3D[] = []
    this.scene.traverse(object => {
      if (object instanceof THREE.Mesh && this.isObstacle(object)) objects.push(object)
    })
    this.obstacles = objects
  }

  private isObstacle(object: THREE.Object3D): boolean {
    let node: THREE.Object3D | null = object
    while (node && node !== this.scene) {
      if (!node.visible || node.userData.vehicleRoot || node.userData.noVehicleCollision || node.userData.vehicleEffect) return false
      node = node.parent
    }
    if (!(object instanceof THREE.Mesh)) return false
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    return materials.some(material => material.visible && (!material.transparent || material.opacity > 0.35))
  }

  private placeBoat(surfaceAt: (x: number, z: number) => VehicleSurface): void {
    const boat = this.vehicles.find(v => v.type === 'boat')
    if (boat && this.boatSpawn && boat.root.position.distanceToSquared(this.boatSpawn) > 0.0001) return
    if (!boat || surfaceAt(boat.root.position.x, boat.root.position.z) === 'water') return
    const x = boat.root.position.x
    const z = boat.root.position.z
    for (let radius = 8; radius <= 160; radius += 8) {
      for (let i = 0; i < 24; i += 1) {
        const angle = i * Math.PI / 12
        const px = x + Math.cos(angle) * radius
        const pz = z + Math.sin(angle) * radius
        if (surfaceAt(px, pz) === 'water') {
          boat.root.position.set(px, GROUND_Y, pz)
          return
        }
      }
    }
  }

  private emitDamage(v: Vehicle, data: VehicleParts, dt: number): void {
    if (v.health < 65 || data.engineStalled) {
      data.smokeTimer += dt * (v.health < 25 || data.engineStalled ? 7.5 : 3.8)
      while (data.smokeTimer >= 1) { data.smokeTimer -= 1; this.emitParticle(v, false) }
    }
    if (v.health < 25) {
      data.fireTimer += dt * 9
      while (data.fireTimer >= 1) { data.fireTimer -= 1; this.emitParticle(v, true) }
    }
  }

  private emitParticle(v: Vehicle, fire: boolean): void {
    if (this.particles.length >= PARTICLE_LIMIT) return
    const material = new THREE.MeshBasicMaterial({ color: fire ? (Math.random() < 0.5 ? '#ffbb33' : '#ff5422') : '#2e333a', transparent: true, opacity: fire ? 0.88 : 0.62, depthWrite: false })
    const mesh = new THREE.Mesh(this.particleGeometry, material)
    mesh.userData.vehicleEffect = true
    const forward = new THREE.Vector3(-Math.sin(v.heading), 0, -Math.cos(v.heading))
    const offset = v.type === 'boat' ? 0.2 : 1.15
    mesh.position.copy(v.root.position).addScaledVector(forward, offset)
    mesh.position.y += v.type === 'helicopter' ? 1.7 : 1.05
    mesh.position.x += (Math.random() - 0.5) * 0.45
    mesh.position.z += (Math.random() - 0.5) * 0.45
    const size = fire ? 0.22 : 0.28
    mesh.scale.setScalar(size)
    this.scene.add(mesh)
    this.particles.push({ mesh, velocity: new THREE.Vector3(v.velocity.x * 0.15 + (Math.random() - 0.5) * 0.5, fire ? 1.5 : 1.0, v.velocity.z * 0.15 + (Math.random() - 0.5) * 0.5), age: 0, life: fire ? 0.55 : 1.8, baseSize: size, gravity: fire ? 0.5 : 0.2, spin: new THREE.Vector3(), disposableMaterial: true })
  }

  private breakOff(v: Vehicle, panel: THREE.Object3D): void {
    if (!panel.visible) return
    v.root.updateWorldMatrix(true, true)
    const debris = panel.clone() as THREE.Mesh
    panel.getWorldPosition(debris.position)
    panel.getWorldQuaternion(debris.quaternion)
    panel.getWorldScale(debris.scale)
    panel.visible = false
    debris.userData.vehicleEffect = true
    this.scene.add(debris)
    if (this.particles.length >= PARTICLE_LIMIT) { this.scene.remove(debris); return }
    const side = Math.random() < 0.5 ? -1 : 1
    this.particles.push({ mesh: debris, velocity: new THREE.Vector3(v.velocity.x * 0.5 + side * 2, 3 + Math.random() * 2, v.velocity.z * 0.5 + (Math.random() - 0.5) * 3), age: 0, life: 3.5, baseSize: 1, gravity: -9.8, spin: new THREE.Vector3(2 + Math.random() * 3, 3, side * 3), disposableMaterial: false })
  }

  private stepParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const p = this.particles[i]
      p.age += dt
      if (p.age >= p.life) {
        this.scene.remove(p.mesh)
        if (p.disposableMaterial) (p.mesh.material as THREE.Material).dispose()
        this.particles.splice(i, 1)
        continue
      }
      p.velocity.y += p.gravity * dt
      p.mesh.position.addScaledVector(p.velocity, dt)
      p.mesh.rotation.x += p.spin.x * dt
      p.mesh.rotation.y += p.spin.y * dt
      p.mesh.rotation.z += p.spin.z * dt
      if (p.disposableMaterial) {
        const t = p.age / p.life
        p.mesh.scale.setScalar(p.baseSize * (1 + t * 2.4))
        ;(p.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.65
      } else {
        if (p.mesh.position.y < 0.12) {
          p.mesh.position.y = 0.12
          p.velocity.y = Math.abs(p.velocity.y) * 0.28
          p.velocity.x *= 0.88
          p.velocity.z *= 0.88
        }
        if (p.age > p.life - 0.5) p.mesh.scale.multiplyScalar(Math.max(0, 1 - dt * 2))
      }
    }
  }

  private buildCar(data: VehicleParts, variant: string): void {
    const body = data.model
    const dark = standard('#202636', 0.55, 0.35)
    const glassMat = standard('#4d899c', 0.25, 0.35)
    const chrome = standard('#c9d7da', 0.28, 0.8)
    const low = variant === 'sport'
    const wide = variant === 'muscle'
    const compact = variant === 'compact'
    const length = wide ? 4.35 : compact ? 3.7 : 4.15
    const width = wide ? 2.08 : compact ? 1.88 : 2.0
    const bodyH = low ? 0.52 : 0.65

    // Segmented deformable main chassis shell
    const chassisGeo = new THREE.BoxGeometry(width, bodyH, length, 5, 4, 6)
    const chassisMesh = new THREE.Mesh(chassisGeo, data.paint)
    chassisMesh.position.set(0, low ? 0.66 : 0.73, 0)
    body.add(chassisMesh)
    data.deformableBody = {
      mesh: chassisMesh,
      basePositions: new Float32Array(chassisGeo.getAttribute('position').array as Float32Array),
      halfW: width * 0.5,
      halfH: bodyH * 0.5,
      halfD: length * 0.5,
    }

    box(body, width * 0.92, 0.18, length * 0.97, 0, 0.42, 0, dark)

    // Hinged hood that can pop open and flap before detaching
    const hoodPivot = new THREE.Group()
    hoodPivot.position.set(0, low ? 0.99 : 1.11, -0.82)
    const hoodMesh = box(hoodPivot, width * 0.92, 0.12, 1.12, 0, 0, -0.56, data.paint)
    body.add(hoodPivot)
    data.hoodPivot = hoodPivot
    data.panels.push(hoodMesh)

    const roofY = low ? 1.30 : 1.48
    const windshield = box(body, width * 0.78, low ? 0.48 : 0.62, 1.93, 0, roofY, 0.17, glassMat)
    data.windshieldMesh = windshield
    data.windshieldMaterial = glassMat
    box(body, width * 0.81, 0.12, 1.75, 0, roofY + (low ? 0.26 : 0.33), 0.2, data.paint)
    box(body, 0.08, low ? 0.5 : 0.62, 1.92, -width * 0.34, roofY, 0.17, dark)
    box(body, 0.08, low ? 0.5 : 0.62, 1.92, width * 0.34, roofY, 0.17, dark)
    const panel = box(body, 0.06, 0.38, 1.35, width / 2 + 0.01, 0.77, 0.25, data.paint)
    data.panels.push(panel)

    const frontBumper = box(body, width, 0.16, 0.14, 0, 0.48, -length / 2 - 0.02, chrome)
    const rearBumper = box(body, width, 0.16, 0.14, 0, 0.48, length / 2 + 0.02, chrome)
    data.frontBumper = frontBumper
    data.rearBumper = rearBumper
    data.panels.push(frontBumper, rearBumper)

    if (variant === 'taxi') {
      box(body, 0.58, 0.2, 0.28, 0, roofY + 0.44, 0.2, lamp('#ffe26a'))
    }
    this.lights(data, body, width, length / 2, 0.83, data.brakeLight)
    for (const x of [-width / 2, width / 2]) for (const z of [-1.27, 1.3]) this.addWheel(data, x, 0.42, z, 0.42, z < 0)
    if (low) {
      box(body, width * 0.95, 0.09, 0.33, 0, 1.32, 1.84, dark)
      box(body, 0.12, 0.34, 0.18, -0.72, 1.15, 1.84, dark)
      box(body, 0.12, 0.34, 0.18, 0.72, 1.15, 1.84, dark)
    }
    if (wide) {
      box(body, 0.18, 0.025, 1.22, -0.3, 1.19, -1.35, chrome)
      box(body, 0.18, 0.025, 1.22, 0.3, 1.19, -1.35, chrome)
    }
  }

  private buildSuv(data: VehicleParts): void {
    const body = data.model
    const dark = standard('#1c2026', 0.6, 0.25)
    const glassMat = standard('#4b7a8a', 0.25, 0.32)
    const chrome = standard('#b8c6cc', 0.3, 0.78)
    const width = 2.24
    const length = 4.65
    const chassisGeo = new THREE.BoxGeometry(width, 0.88, length, 5, 4, 6)
    const chassisMesh = new THREE.Mesh(chassisGeo, data.paint)
    chassisMesh.position.set(0, 0.92, 0)
    body.add(chassisMesh)
    data.deformableBody = {
      mesh: chassisMesh,
      basePositions: new Float32Array(chassisGeo.getAttribute('position').array as Float32Array),
      halfW: width * 0.5,
      halfH: 0.44,
      halfD: length * 0.5,
    }
    box(body, width * 0.92, 0.22, length * 0.96, 0, 0.48, 0, dark)
    const hoodPivot = new THREE.Group()
    hoodPivot.position.set(0, 1.36, -1.1)
    const hoodMesh = box(hoodPivot, width * 0.9, 0.12, 1.1, 0, 0, -0.55, data.paint)
    body.add(hoodPivot)
    data.hoodPivot = hoodPivot
    data.panels.push(hoodMesh)

    const windshield = box(body, width * 0.88, 0.74, 2.7, 0, 1.72, 0.42, glassMat)
    data.windshieldMesh = windshield
    data.windshieldMaterial = glassMat
    box(body, width * 0.9, 0.14, 2.65, 0, 2.12, 0.44, data.paint)
    const frontBumper = box(body, width + 0.06, 0.2, 0.16, 0, 0.54, -length / 2 - 0.02, chrome)
    const rearBumper = box(body, width + 0.06, 0.2, 0.16, 0, 0.54, length / 2 + 0.02, chrome)
    data.frontBumper = frontBumper
    data.rearBumper = rearBumper
    data.panels.push(frontBumper, rearBumper)
    this.lights(data, body, width, length / 2, 1.0, data.brakeLight)
    for (const x of [-width / 2, width / 2]) for (const z of [-1.48, 1.48]) this.addWheel(data, x, 0.49, z, 0.49, z < 0)
  }

  private buildTruck(data: VehicleParts): void {
    const body = data.model
    const dark = standard('#262a31', 0.7, 0.2)
    const glassMat = standard('#56889a', 0.25, 0.3)
    const chrome = standard('#b6c3c8', 0.35, 0.7)
    box(body, 2.28, 0.5, 5.4, 0, 0.67, 0, dark)
    const cabGeo = new THREE.BoxGeometry(2.22, 1.0, 2.16, 4, 3, 4)
    const cabMesh = new THREE.Mesh(cabGeo, data.paint)
    cabMesh.position.set(0, 1.05, -1.53)
    body.add(cabMesh)
    data.deformableBody = {
      mesh: cabMesh,
      basePositions: new Float32Array(cabGeo.getAttribute('position').array as Float32Array),
      halfW: 1.11,
      halfH: 0.5,
      halfD: 1.08,
    }
    const windshield = box(body, 2.04, 0.85, 1.28, 0, 1.82, -1.47, glassMat)
    data.windshieldMesh = windshield
    data.windshieldMaterial = glassMat
    box(body, 2.16, 0.14, 1.5, 0, 2.27, -1.47, data.paint)
    box(body, 2.2, 0.22, 2.7, 0, 0.91, 1.20, data.paint)
    const left = box(body, 0.18, 0.9, 2.7, -1.02, 1.42, 1.2, data.paint)
    const right = box(body, 0.18, 0.9, 2.7, 1.02, 1.42, 1.2, data.paint)
    box(body, 2.04, 0.8, 0.16, 0, 1.37, 2.5, data.paint)
    data.panels.push(right, left)
    const frontBumper = box(body, 2.34, 0.2, 0.13, 0, 0.55, -2.75, chrome)
    data.frontBumper = frontBumper
    data.panels.push(frontBumper)
    box(body, 1.05, 0.35, 0.09, 0, 1.02, -2.65, dark)
    this.lights(data, body, 2.16, 2.7, 1.16, data.brakeLight)
    for (const x of [-1.12, 1.12]) for (const z of [-1.75, 1.65]) this.addWheel(data, x, 0.51, z, 0.51, z < 0)
  }

  private buildBike(data: VehicleParts): void {
    const body = data.model
    const dark = standard('#242732', 0.65, 0.2)
    const metal = standard('#becbd0', 0.3, 0.75)
    for (const z of [-1.05, 1.05]) this.addWheel(data, 0, 0.43, z, 0.43, z < 0)
    bar(body, new THREE.Vector3(0, 0.55, 1.05), new THREE.Vector3(0, 1.05, 0), 0.07, metal)
    bar(body, new THREE.Vector3(0, 1.05, 0), new THREE.Vector3(0, 0.58, -1.05), 0.07, metal)
    bar(body, new THREE.Vector3(0, 0.55, 1.05), new THREE.Vector3(0, 0.58, -1.05), 0.07, metal)
    box(body, 0.5, 0.4, 0.6, 0, 0.76, 0.05, metal)
    const tank = box(body, 0.56, 0.38, 0.8, 0, 1.18, -0.27, data.paint)
    data.panels.push(tank)
    const seat = box(body, 0.45, 0.16, 0.75, 0, 1.19, 0.58, dark)
    data.panels.push(seat)
    bar(body, new THREE.Vector3(0, 0.5, -1.05), new THREE.Vector3(0, 1.42, -0.75), 0.065, metal)
    box(body, 1.05, 0.07, 0.07, 0, 1.43, -0.75, metal)
    data.leftHeadlight = box(body, 0.43, 0.24, 0.12, 0, 1.12, -1.11, lamp('#fff2b2'))
    data.leftTaillight = box(body, 0.34, 0.12, 0.1, 0, 1.03, 1.14, data.brakeLight)
  }

  private buildBoat(data: VehicleParts): void {
    const body = data.model
    const dark = standard('#253746', 0.55, 0.3)
    const white = standard('#f1ece0', 0.55, 0.05)
    const glass = standard('#77c3d6', 0.2, 0.25)
    const outline = [[-1, 1.75], [1, 1.75], [1, -0.85], [0.7, -1.65], [0, -2.35], [-0.7, -1.65], [-1, -0.85]]
    const vertices: number[] = []
    for (const [x, z] of outline) vertices.push(x, 0.72, z)
    for (const [x, z] of outline) vertices.push(x * 0.68, 0.13, z * 0.83)
    const indices: number[] = []
    for (let i = 1; i < outline.length - 1; i += 1) indices.push(0, i, i + 1, outline.length, outline.length + i + 1, outline.length + i)
    for (let i = 0; i < outline.length; i += 1) {
      const j = (i + 1) % outline.length
      indices.push(i, outline.length + j, j, i, outline.length + i, outline.length + j)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()
    const hull = new THREE.Mesh(geometry, data.paint)
    body.add(hull)
    box(body, 1.65, 0.12, 2.75, 0, 0.75, 0.18, white)
    box(body, 1.32, 0.38, 0.15, 0, 1.05, -0.55, glass)
    box(body, 1.3, 0.35, 0.65, 0, 1.02, 0.55, dark)
    const seat = box(body, 1.35, 0.22, 0.45, 0, 1.25, 0.85, white)
    data.panels.push(seat)
    const motor = box(body, 0.55, 0.7, 0.48, 0, 0.65, 1.95, dark)
    data.panels.push(motor)
    box(body, 0.18, 0.12, 0.13, -0.85, 0.82, -1.3, lamp('#ff3b58'))
    box(body, 0.18, 0.12, 0.13, 0.85, 0.82, -1.3, lamp('#7dffb8'))
    box(body, 0.4, 0.12, 0.1, 0, 0.95, 1.76, data.brakeLight)
  }

  private buildHelicopter(data: VehicleParts): void {
    const body = data.model
    const dark = standard('#253743', 0.45, 0.35)
    const glass = standard('#4b9fb6', 0.19, 0.4)
    const metal = standard('#bdc9c8', 0.35, 0.75)
    const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), data.paint)
    shell.scale.set(1.12, 0.95, 1.76)
    shell.position.set(0, 1.65, 0)
    body.add(shell)
    const windshield = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), glass)
    windshield.scale.set(0.94, 0.65, 0.82)
    windshield.position.set(0, 1.83, -1.07)
    body.add(windshield)
    const door = box(body, 0.06, 1.0, 1.05, 1.09, 1.6, 0.22, glass)
    data.panels.push(door)
    const tail = bar(body, new THREE.Vector3(0, 1.75, 1.15), new THREE.Vector3(0, 2.1, 4.45), 0.18, data.paint)
    data.panels.push(tail)
    box(body, 0.14, 0.9, 0.6, 0, 2.34, 4.2, data.paint)
    for (const x of [-0.95, 0.95]) {
      bar(body, new THREE.Vector3(x, 0.18, -1.48), new THREE.Vector3(x, 0.18, 1.55), 0.07, metal)
      bar(body, new THREE.Vector3(x, 0.18, -0.65), new THREE.Vector3(x * 0.7, 0.92, -0.5), 0.055, metal)
      bar(body, new THREE.Vector3(x, 0.18, 0.9), new THREE.Vector3(x * 0.7, 0.92, 0.7), 0.055, metal)
    }
    bar(body, new THREE.Vector3(0, 2.45, 0), new THREE.Vector3(0, 2.95, 0), 0.09, metal)
    const rotor = new THREE.Group()
    rotor.position.set(0, 2.97, 0)
    box(rotor, 6.5, 0.055, 0.22, 0, 0, 0, dark)
    box(rotor, 0.22, 0.055, 6.5, 0, 0.025, 0, dark)
    body.add(rotor)
    data.rotor = rotor
    const tailRotor = new THREE.Group()
    tailRotor.position.set(0.22, 2.2, 4.2)
    box(tailRotor, 0.06, 1.5, 0.14, 0, 0, 0, dark)
    box(tailRotor, 0.06, 0.14, 1.5, 0, 0, 0, dark)
    body.add(tailRotor)
    data.tailRotor = tailRotor
    box(body, 0.24, 0.17, 0.1, 0, 1.25, -1.73, lamp('#fff2be'))
    box(body, 0.3, 0.12, 0.1, 0, 2.4, 4.45, data.brakeLight)
  }

  private addWheel(data: VehicleParts, x: number, y: number, z: number, radius: number, front: boolean): void {
    const pivot = new THREE.Group()
    pivot.position.set(x, y, z)
    const spin = new THREE.Group()
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.30, 14), standard('#171b22', 0.92, 0.05))
    tire.rotation.z = Math.PI / 2
    spin.add(tire)
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.53, radius * 0.53, 0.32, 10), standard('#bbc7cd', 0.32, 0.75))
    hub.rotation.z = Math.PI / 2
    spin.add(hub)
    const spoke = box(spin, 0.34, radius * 0.12, radius * 0.75, 0, 0, 0, standard('#323b43', 0.5, 0.6))
    spoke.position.x = 0.17
    pivot.add(spin)
    data.model.add(pivot)
    data.wheels.push({
      pivot,
      spin,
      steering: front ? pivot : null,
      radius,
      restY: y,
      compression: 0,
      vel: 0,
      sideSign: x < 0 ? -1 : x > 0 ? 1 : 0,
      front,
      bentYaw: 0,
      bentCamber: 0,
    })
  }

  private lights(data: VehicleParts, body: THREE.Group, width: number, halfLength: number, y: number, brake: THREE.MeshStandardMaterial): void {
    const head = lamp('#fff1bc')
    data.leftHeadlight = box(body, width * 0.22, 0.16, 0.08, -width * 0.33, y, -halfLength - 0.045, head)
    data.rightHeadlight = box(body, width * 0.22, 0.16, 0.08, width * 0.33, y, -halfLength - 0.045, head)
    data.leftTaillight = box(body, width * 0.22, 0.14, 0.08, -width * 0.33, y, halfLength + 0.045, brake)
    data.rightTaillight = box(body, width * 0.22, 0.14, 0.08, width * 0.33, y, halfLength + 0.045, brake)
  }
}

function standard(color: string, roughness: number, metalness: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness })
}

function lamp(color: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2, roughness: 0.25 })
}

function box(parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
  mesh.position.set(x, y, z)
  parent.add(mesh)
  return mesh
}

function bar(parent: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, radius: number, material: THREE.Material): THREE.Mesh {
  const delta = to.clone().sub(from)
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, delta.length(), 8), material)
  mesh.position.copy(from).add(to).multiplyScalar(0.5)
  mesh.quaternion.setFromUnitVectors(UP, delta.normalize())
  parent.add(mesh)
  return mesh
}

function makeContactShadowTexture(): THREE.Texture {
  if (typeof document === 'undefined') {
    const data = new Uint8Array([0, 0, 0, 140])
    const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat)
    tex.needsUpdate = true
    return tex
  }
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const grad = ctx.createRadialGradient(32, 32, 6, 32, 32, 31)
    grad.addColorStop(0, 'rgba(6, 8, 14, 0.85)')
    grad.addColorStop(0.55, 'rgba(6, 8, 14, 0.45)')
    grad.addColorStop(1, 'rgba(6, 8, 14, 0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 64, 64)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function makeCrackedGlassTexture(): THREE.Texture {
  if (typeof document === 'undefined') {
    const data = new Uint8Array([200, 225, 240, 200])
    const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat)
    tex.needsUpdate = true
    return tex
  }
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#5f8b9c'
    ctx.fillRect(0, 0, 128, 64)
    ctx.strokeStyle = 'rgba(242, 248, 255, 0.85)'
    ctx.lineWidth = 1.4
    const cx = 64
    const cy = 32
    for (let i = 0; i < 14; i += 1) {
      const a = (i / 14) * Math.PI * 2
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(a) * 58, cy + Math.sin(a) * 30)
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.arc(cx, cy, 12, 0, Math.PI * 2)
    ctx.arc(cx, cy, 24, 0, Math.PI * 2)
    ctx.stroke()
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
