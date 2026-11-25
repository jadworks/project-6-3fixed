import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { WorldCollider } from './viceWorld'
import { hasLineOfSight, worldRayDistance } from './worldCollision'
import { WITNESS_CALL_SECONDS, WITNESS_RADIUS, WitnessManager, type WitnessObservation } from './witnessManager'
import { applyRagdollImpulse, createRagdollRig, stepRagdoll, type RagdollHitZone, type RagdollRig } from './ragdoll'

/**
 * Lightweight city-life simulation for a flat, y=0 city. Integration:
 *   const life = new CityLife(scene)
 *   life.update(fixedDt, playerWorldPosition, wantedLevel) // wanted is 0..5
 *   life.startle(noisePosition)                           // gunshots, crashes, etc.
 *   const hitPerson = life.shoot(muzzle, aimDirection, range)
 *   const peopleHit = life.impact(crashPosition, radius, force)
 *   health -= life.getDamage(playerWorldPosition, fixedDt, wantedLevel)
 * Call update and getDamage once per simulation step; each clamps dt to 0.1 seconds.
 * getDamage returns health points (tuned for roughly 100 maximum HP), not a boolean.
 * shoot also startles bystanders.
 * Impact counts people, not vehicles; vehicles in the blast still brake and smoke.
 *
 * This is deliberately a bounded, visual/kinematic system: it creates no Rapier
 * bodies, performs no building/terrain/line-of-sight tests, and does not itself
 * change wanted level, HP, ammunition, player velocity, or play audio. The host must
 * call impact for player/vehicle collisions and feed hit results into its own rules.
 * Streets are assumed to run along Z around x=0 and x=-70, with a cross street
 * at z=24; the player spawns nearby at z=16. Pavement is approximately y=0.
 * The caller owns pausing by not advancing the simulation.
 */

type WitnessState = 'calm' | 'shocked' | 'fleeing' | 'reporting' | 'intimidated' | 'down'
type PoliceVehicleRole = 'civilian' | 'patrol' | 'swat' | 'military'

export type PoliceRadarUnit = {
  x: number
  z: number
  heading: number
  range: number
  fovDeg: number
  kind: 'cop' | 'patrol' | 'swat' | 'heli' | 'military'
  inSight: boolean
}

export type WitnessEventState = {
  blips: { x: number; z: number; state: 'shocked' | 'reporting'; progress: number }[]
  completedReport: { x: number; z: number; severity: number; observation?: WitnessObservation } | null
  cancelledReason: 'intimidated' | 'down' | 'escaped' | null
}

export type HitZone = 'head' | 'torso' | 'limb'

export type BallisticHitResult = {
  hit: boolean
  hitType: 'none' | 'person' | 'cop'
  zone: HitZone
  distance: number
  point: THREE.Vector3
  critical: boolean
  armorBroken: boolean
  killed: boolean
}

type Pedestrian = {
  id: string
  root: THREE.Group
  model: THREE.Group
  leftLeg: THREE.Group
  rightLeg: THREE.Group
  leftArm: THREE.Group
  rightArm: THREE.Group
  witnessMarker?: THREE.Group
  witnessPhone?: THREE.Mesh
  police: boolean
  active: boolean
  side: number
  streetX: number
  direction: number
  speed: number
  phase: number
  flee: number
  danger: THREE.Vector3
  impulse: THREE.Vector3
  stagger: number
  down: number
  hitLock: number
  fire: number
  hp: number
  maxHp: number
  armor: number
  witnessState: WitnessState
  shockTimer: number
  reportTimer: number
  reportSeverity: number
  reportOrigin: THREE.Vector3
  lostLosTimer: number
  ragdoll: RagdollRig
  droppedWeapon?: THREE.Mesh
  disarmedTimer: number
}

type Vehicle = {
  root: THREE.Group
  body: THREE.Group
  turret?: THREE.Group
  wheels: THREE.Mesh[]
  red?: THREE.Mesh
  blue?: THREE.Mesh
  axis: 'x' | 'z'
  direction: number
  lane: number
  cruise: number
  speed: number
  patrol: boolean
  role: PoliceVehicleRole
  crash: number
  smoke: number
  fire: number
}

type Bird = { root: THREE.Group; left: THREE.Group; right: THREE.Group; phase: number; scared: number }
type Particle = { position: THREE.Vector3; velocity: THREE.Vector3; life: number; total: number; size: number; smoke: boolean }
type Trace = { mesh: THREE.Mesh; life: number }
type Part = [shape: 'box' | 'ball', color: string, x: number, y: number, z: number, sx: number, sy: number, sz: number]

const UP = new THREE.Vector3(0, 1, 0)
const MAX_PEDESTRIANS = 36
const MAX_OFFICERS = 6
const PARTICLE_COUNT = 48
const TRACE_COUNT = 10
const TAU = Math.PI * 2

function safeStep(dt: number): number {
  return Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, 0.1) : 0
}

function levelOf(wanted: number): number {
  return Number.isFinite(wanted) ? Math.floor(THREE.MathUtils.clamp(wanted, 0, 6)) : 0
}

function angleDamp(from: number, to: number, speed: number, dt: number): number {
  const difference = Math.atan2(Math.sin(to - from), Math.cos(to - from))
  return from + difference * (1 - Math.exp(-speed * dt))
}

function insideVisionCone(
  observerPos: THREE.Vector3,
  observerHeadingY: number,
  targetPos: THREE.Vector3,
  maxRange: number,
  cosHalfFov: number,
  closeSenseRange: number,
): boolean {
  const dx = targetPos.x - observerPos.x
  const dz = targetPos.z - observerPos.z
  const distSq = dx * dx + dz * dz
  if (distSq > maxRange * maxRange) return false
  if (distSq <= closeSenseRange * closeSenseRange) return true
  const dist = Math.sqrt(distSq) || 1
  const fx = Math.sin(observerHeadingY)
  const fz = Math.cos(observerHeadingY)
  const dot = (dx * fx + dz * fz) / dist
  return dot >= cosHalfFov
}

/** Street population, witness AI, vision cones, and 1-6 star tactical response. */
export class CityLife {
  private readonly group = new THREE.Group()
  private readonly people: Pedestrian[] = []
  private readonly officers: Pedestrian[] = []
  private readonly vehicles: Vehicle[] = []
  private readonly birds: Bird[] = []
  private readonly barriers: THREE.Group[] = []
  private readonly barrierLights: THREE.Mesh[] = []
  private readonly particles: Particle[] = []
  private readonly particleMesh: THREE.InstancedMesh
  private readonly traces: Trace[] = []
  private readonly boxGeometry = new THREE.BoxGeometry(1, 1, 1)
  private readonly sphereGeometry = new THREE.SphereGeometry(1, 10, 7)
  private readonly wheelGeometry = new THREE.CylinderGeometry(0.43, 0.43, 0.25, 10)
  private readonly traceGeometry = new THREE.CylinderGeometry(0.025, 0.025, 1, 5)
  private readonly coneGeometry = new THREE.ConeGeometry(1, 1, 7)
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>()
  private readonly compoundGeometries = new Map<string, THREE.BufferGeometry>()
  private readonly compoundMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true })
  private readonly compoundLightMaterial = new THREE.MeshBasicMaterial({ vertexColors: true })
  private readonly tracePlayer = new THREE.MeshBasicMaterial({ color: '#fff0a8' })
  private readonly tracePolice = new THREE.MeshBasicMaterial({ color: '#ffb26e' })
  private readonly particleDummy = new THREE.Object3D()
  private readonly helicopter = new THREE.Group()
  private readonly rotor = new THREE.Group()
  private readonly tailRotor = new THREE.Group()
  private readonly heliLight: THREE.Mesh
  private readonly heliSpot = new THREE.SpotLight('#fff6cf', 0, 58, Math.PI / 6.2, 0.52, 1.3)
  private readonly heliSpotTarget = new THREE.Object3D()
  private worldColliders: WorldCollider[] = []
  private readonly barrierCooldowns = [0, 0]
  private readonly spikeCooldowns = [0, 0]
  private particleCursor = 0
  private traceCursor = 0
  private time = 0
  private lastWanted = 0
  private heliFire = 1.8
  private randomState = 0x765ba9
  private readonly color = new THREE.Color()
  readonly witnessManager = new WitnessManager(WITNESS_RADIUS, WITNESS_CALL_SECONDS)
  private pendingCompletedReport: { x: number; z: number; severity: number; observation?: WitnessObservation } | null = null
  private pendingCancelReason: 'intimidated' | 'down' | 'escaped' | null = null
  private readonly serviceUnits: Array<{
    kind: 'ambulance' | 'fire' | 'taxi' | 'arms_van'
    root: THREE.Group
    red?: THREE.Mesh
    blue?: THREE.Mesh
    active: boolean
    timer: number
    target: THREE.Vector3
    arrived: boolean
    rideSpeed?: number
  }> = []
  private prevPursuerDist = Infinity

  constructor(scene: THREE.Scene) {
    this.group.name = 'City life'
    scene.add(this.group)
    this.heliSpot.castShadow = false
    this.heliSpotTarget.userData.noVehicleCollision = true
    this.group.add(this.heliSpotTarget)
    this.heliSpot.target = this.heliSpotTarget
    for (let i = 0; i < MAX_PEDESTRIANS; i += 1) {
      const ped = this.makePerson(false, i)
      this.people.push(ped)
      this.witnessManager.registerNpc(ped.id, ped.root.position, ped.active)
    }
    for (let i = 0; i < MAX_OFFICERS; i += 1) this.officers.push(this.makePerson(true, i))
    this.witnessManager.on('dispatch', ev => {
      this.pendingCompletedReport = { x: ev.x, z: ev.z, severity: ev.severity, observation: ev.observation }
    })
    this.witnessManager.on('cancelled', ev => {
      this.pendingCancelReason = ev.reason
    })
    this.makeTraffic()
    this.makeRoadblocks()
    this.heliLight = this.makeHelicopter()
    this.makeBirds()

    this.particleMesh = new THREE.InstancedMesh(
      this.sphereGeometry,
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.76, depthWrite: false }),
      PARTICLE_COUNT,
    )
    this.particleMesh.name = 'Pooled city impact particles'
    this.particleMesh.frustumCulled = false
    this.particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    for (let i = 0; i < PARTICLE_COUNT; i += 1) {
      this.particles.push({ position: new THREE.Vector3(), velocity: new THREE.Vector3(), life: 0, total: 1, size: 0, smoke: false })
      this.particleDummy.scale.setScalar(0)
      this.particleDummy.updateMatrix()
      this.particleMesh.setMatrixAt(i, this.particleDummy.matrix)
      this.particleMesh.setColorAt(i, this.color.set('#ffffff'))
    }
    this.particleMesh.instanceMatrix.needsUpdate = true
    this.group.add(this.particleMesh)
    for (let i = 0; i < TRACE_COUNT; i += 1) {
      const mesh = new THREE.Mesh(this.traceGeometry, this.tracePlayer)
      mesh.visible = false
      mesh.frustumCulled = false
      this.group.add(mesh)
      this.traces.push({ mesh, life: 0 })
    }
  }

  /** Supply world building/container colliders for realistic cover and police sightlines. */
  setWorldColliders(colliders: WorldCollider[]): void {
    this.worldColliders = colliders
    this.witnessManager.setWorldColliders(colliders)
  }

  /** True if any upright civilian is close enough (default 45m) with LOS to witness a crime. */
  hasWitnessNearby(origin: THREE.Vector3, radius = WITNESS_RADIUS): boolean {
    for (const person of this.people) {
      this.witnessManager.syncActorPose(person.id, person.root.position, person.active, person.down)
    }
    return this.witnessManager.hasWitnessInSight(origin, radius)
  }

  /**
   * Alert civilians within 45m LOS of a crime: closest candidate enters SHOCKED -> REPORTING (3.5s 911 call),
   * while bystanders flee. Returns true if at least one witness began reporting.
   */
  notifyCrimeToWitnesses(crimeOrigin: THREE.Vector3, severity = 1, observation?: Partial<WitnessObservation>): boolean {
    for (const person of this.people) {
      this.witnessManager.syncActorPose(person.id, person.root.position, person.active, person.down)
    }
    const result = this.witnessManager.notifyCrime(crimeOrigin, severity, WITNESS_RADIUS, observation)
    if (!result.started) return false
    for (const person of this.people) {
      const actor = this.witnessManager.getActor(person.id)
      if (!actor) continue
      if (actor.id === result.witnessId) {
        person.witnessState = actor.state
        person.shockTimer = actor.shockTimer
        person.reportTimer = actor.reportTimer
        person.reportSeverity = actor.reportSeverity
        person.reportOrigin.copy(crimeOrigin)
        person.danger.copy(crimeOrigin)
      } else if (result.fleeingIds.includes(actor.id)) {
        person.witnessState = 'fleeing'
        person.danger.copy(crimeOrigin)
        person.flee = Math.max(person.flee, 6 + this.random() * 2)
      }
    }
    return true
  }

  /**
   * Intimidate active or shocked witnesses by aiming at them, firing nearby, or rushing within 5.5m.
   * Cancels their 911 report before the 3.5s timer completes!
   */
  intimidateWitnesses(playerPos: THREE.Vector3, aimDir: THREE.Vector3, fired: boolean): boolean {
    for (const person of this.people) {
      this.witnessManager.syncActorPose(person.id, person.root.position, person.active, person.down)
    }
    const intimidatedIds = this.witnessManager.intimidate(playerPos, aimDir, fired)
    if (intimidatedIds.length === 0) return false
    for (const id of intimidatedIds) {
      const person = this.people.find(p => p.id === id)
      if (!person) continue
      person.witnessState = 'intimidated'
      person.shockTimer = 0
      person.reportTimer = 0
      person.danger.copy(playerPos)
      person.flee = 8
      person.stagger = 1.2
    }
    return true
  }

  /** Retrieve live witness blips and consume any completed 3.5s report or tactical cancellation event. */
  consumeWitnessEvents(): WitnessEventState {
    const blips = this.witnessManager.getActiveBlips().map(({ x, z, state, progress }) => ({ x, z, state, progress }))
    const completedReport = this.pendingCompletedReport
    const cancelledReason = this.pendingCancelReason
    this.pendingCompletedReport = null
    this.pendingCancelReason = null
    return { blips, completedReport, cancelledReason }
  }

  /** True if any active police unit has the player inside its directional vision cone AND unobstructed LOS. */
  hasPoliceLineOfSight(playerPos: THREE.Vector3, wanted = 1): boolean {
    const level = levelOf(wanted)
    const eyeTarget = new THREE.Vector3(playerPos.x, playerPos.y + 1.25, playerPos.z)
    const eyeFrom = new THREE.Vector3()
    const cosCop = Math.cos((55 * Math.PI) / 180)
    const cosCar = Math.cos((50 * Math.PI) / 180)

    for (const officer of this.officers) {
      if (!officer.active || officer.down > 0) continue
      if (!insideVisionCone(officer.root.position, officer.root.rotation.y, playerPos, 34, cosCop, 6.5)) continue
      eyeFrom.set(officer.root.position.x, officer.root.position.y + 1.55, officer.root.position.z)
      if (this.worldColliders.length === 0 || hasLineOfSight(eyeFrom, eyeTarget, this.worldColliders)) return true
    }

    for (const car of this.vehicles) {
      if (!this.isVehicleActiveForWanted(car, level) || car.crash > 0) continue
      const range = car.role === 'military' ? 50 : car.role === 'swat' ? 46 : 42
      if (!insideVisionCone(car.root.position, car.root.rotation.y, playerPos, range, cosCar, 7.5)) continue
      eyeFrom.set(car.root.position.x, car.root.position.y + 1.5, car.root.position.z)
      if (this.worldColliders.length === 0 || hasLineOfSight(eyeFrom, eyeTarget, this.worldColliders)) return true
    }

    if (this.helicopter.visible) {
      const dx = this.helicopter.position.x - playerPos.x
      const dz = this.helicopter.position.z - playerPos.z
      if (dx * dx + dz * dz <= 32 * 32) {
        if (this.worldColliders.length === 0 || hasLineOfSight(this.helicopter.position, eyeTarget, this.worldColliders)) return true
      }
    }
    return false
  }

  /** Active police unit coordinates & vision cone headings for minimap/radar rendering. */
  getPoliceRadars(playerPos: THREE.Vector3, wanted: number): PoliceRadarUnit[] {
    const level = levelOf(wanted)
    const units: PoliceRadarUnit[] = []
    const eyeTarget = new THREE.Vector3(playerPos.x, playerPos.y + 1.25, playerPos.z)
    const eyeFrom = new THREE.Vector3()
    const cosCop = Math.cos((55 * Math.PI) / 180)
    const cosCar = Math.cos((50 * Math.PI) / 180)

    for (const officer of this.officers) {
      if (!officer.active || officer.down > 0) continue
      eyeFrom.set(officer.root.position.x, officer.root.position.y + 1.55, officer.root.position.z)
      const inSight = insideVisionCone(officer.root.position, officer.root.rotation.y, playerPos, 34, cosCop, 6.5)
        && (this.worldColliders.length === 0 || hasLineOfSight(eyeFrom, eyeTarget, this.worldColliders))
      units.push({
        x: officer.root.position.x,
        z: officer.root.position.z,
        heading: officer.root.rotation.y,
        range: 34,
        fovDeg: 110,
        kind: 'cop',
        inSight,
      })
    }

    for (const car of this.vehicles) {
      if (!this.isVehicleActiveForWanted(car, level)) continue
      const range = car.role === 'military' ? 50 : car.role === 'swat' ? 46 : 42
      eyeFrom.set(car.root.position.x, car.root.position.y + 1.5, car.root.position.z)
      const inSight = car.crash <= 0
        && insideVisionCone(car.root.position, car.root.rotation.y, playerPos, range, cosCar, 7.5)
        && (this.worldColliders.length === 0 || hasLineOfSight(eyeFrom, eyeTarget, this.worldColliders))
      units.push({
        x: car.root.position.x,
        z: car.root.position.z,
        heading: car.root.rotation.y,
        range,
        fovDeg: 100,
        kind: car.role === 'military' ? 'military' : car.role === 'swat' ? 'swat' : 'patrol',
        inSight,
      })
    }

    if (this.helicopter.visible) {
      const dx = this.helicopter.position.x - playerPos.x
      const dz = this.helicopter.position.z - playerPos.z
      const inSight = dx * dx + dz * dz <= 32 * 32
        && (this.worldColliders.length === 0 || hasLineOfSight(this.helicopter.position, eyeTarget, this.worldColliders))
      units.push({
        x: this.helicopter.position.x,
        z: this.helicopter.position.z,
        heading: this.helicopter.rotation.y,
        range: 32,
        fovDeg: 360,
        kind: 'heli',
        inSight,
      })
    }
    return units
  }

  /** Backward-compatible coordinate list for the minimap radar. */
  getPoliceBlips(): { x: number; z: number; kind: 'cop' | 'heli' }[] {
    const blips: { x: number; z: number; kind: 'cop' | 'heli' }[] = []
    for (const officer of this.officers) {
      if (officer.active && officer.down <= 0) blips.push({ x: officer.root.position.x, z: officer.root.position.z, kind: 'cop' })
    }
    for (const car of this.vehicles) {
      if (car.patrol && car.root.visible) blips.push({ x: car.root.position.x, z: car.root.position.z, kind: 'cop' })
    }
    if (this.helicopter.visible) blips.push({ x: this.helicopter.position.x, z: this.helicopter.position.z, kind: 'heli' })
    return blips
  }

  /** Distance in meters to closest active police unit (used for 60m siren minimap border pulse). */
  nearestPursuerDistance(playerPos: THREE.Vector3, wanted: number): number {
    const level = levelOf(wanted)
    if (level <= 0) return Infinity
    let minSq = Infinity
    for (const officer of this.officers) {
      if (!officer.active || officer.down > 0) continue
      const dx = officer.root.position.x - playerPos.x
      const dz = officer.root.position.z - playerPos.z
      minSq = Math.min(minSq, dx * dx + dz * dz)
    }
    for (const car of this.vehicles) {
      if (!this.isVehicleActiveForWanted(car, level)) continue
      const dx = car.root.position.x - playerPos.x
      const dz = car.root.position.z - playerPos.z
      minSq = Math.min(minSq, dx * dx + dz * dz)
    }
    if (this.helicopter.visible) {
      const dx = this.helicopter.position.x - playerPos.x
      const dz = this.helicopter.position.z - playerPos.z
      minSq = Math.min(minSq, dx * dx + dz * dz)
    }
    return Number.isFinite(minSq) ? Math.sqrt(minSq) : Infinity
  }

  /** Nearest active police pursuer distance and closing rate (m/s) for Doppler siren shifting. */
  getNearestPursuerKinematics(playerPos: THREE.Vector3, wanted: number, dt = 1 / 60): { distance: number; approachSpeed: number } {
    const distance = this.nearestPursuerDistance(playerPos, wanted)
    if (!Number.isFinite(distance) || distance === Infinity) {
      this.prevPursuerDist = Infinity
      return { distance: Infinity, approachSpeed: 0 }
    }
    const prev = this.prevPursuerDist
    this.prevPursuerDist = distance
    const approachSpeed = Number.isFinite(prev) ? THREE.MathUtils.clamp((prev - distance) / Math.max(0.01, dt), -35, 35) : 0
    return { distance, approachSpeed }
  }

  /** Dispatch 911 Ambulance / Firetruck / Roman Cab / Little Jacob arms van near player position. */
  summonServiceVehicle(kind: 'ambulance' | 'fire' | 'taxi' | 'arms_van', targetPos: THREE.Vector3): { x: number; z: number } {
    let unit = this.serviceUnits.find(u => u.kind === kind)
    if (!unit) {
      const root = new THREE.Group()
      root.name = `Dispatched ${kind}`
      let red: THREE.Mesh | undefined
      let blue: THREE.Mesh | undefined
      if (kind === 'ambulance') {
        this.box(root, '#f4f7f8', 0, 1.05, 0, 2.25, 1.45, 4.7)
        this.box(root, '#e5394d', 0, 1.0, 0, 2.28, 0.25, 4.72)
        red = this.box(root, '#ff3f58', -0.5, 1.9, 1.3, 0.35, 0.2, 0.25, true)
        blue = this.box(root, '#ffffff', 0.5, 1.9, 1.3, 0.35, 0.2, 0.25, true)
      } else if (kind === 'fire') {
        this.box(root, '#c82934', 0, 1.25, 0, 2.45, 1.75, 5.8)
        this.box(root, '#d8e0e6', 0, 2.22, -0.3, 0.9, 0.22, 3.8)
        red = this.box(root, '#ff3f58', -0.6, 2.25, 2.1, 0.4, 0.22, 0.25, true)
        blue = this.box(root, '#ffb84d', 0.6, 2.25, 2.1, 0.4, 0.22, 0.25, true)
      } else if (kind === 'taxi') {
        this.box(root, '#f2b824', 0, 0.68, 0, 2.02, 0.68, 4.15)
        this.box(root, '#f2b824', 0, 1.2, -0.15, 1.66, 0.54, 2.0)
        red = this.box(root, '#fff29c', 0, 1.56, 0.05, 0.55, 0.18, 0.26, true)
      } else {
        this.box(root, '#2f353b', 0, 0.96, 0, 2.2, 1.25, 4.55)
        this.box(root, '#1d2226', 0, 0.85, -2.3, 1.85, 0.9, 0.14)
        blue = this.box(root, '#77e6e7', 0, 1.68, -1.8, 0.5, 0.14, 0.22, true)
      }
      for (const x of [-1.06, 1.06]) for (const z of [-1.45, 1.45]) {
        this.box(root, '#1b1e23', x, 0.4, z, 0.24, 0.78, 0.78)
      }
      this.group.add(root)
      unit = { kind, root, red, blue, active: true, timer: 42, target: new THREE.Vector3(), arrived: false }
      this.serviceUnits.push(unit)
    }
    const streetX = Math.abs(targetPos.x) < 35 ? (targetPos.x >= 0 ? 7.2 : -7.2) : THREE.MathUtils.clamp(targetPos.x, -280, 45)
    const destZ = THREE.MathUtils.clamp(targetPos.z + 6, -340, 340)
    const startZ = THREE.MathUtils.clamp(destZ - 38, -360, 360)
    unit.active = true
    unit.arrived = false
    unit.timer = 45
    unit.target.set(streetX, 0.04, destZ)
    unit.root.visible = true
    unit.root.position.set(streetX, 0.04, startZ)
    unit.root.rotation.y = destZ >= startZ ? 0 : Math.PI
    return { x: streetX, z: destZ }
  }

  /** Nearest active dispatched service vehicle or yellow traffic cab within range. */
  getServiceUnitState(kind: 'ambulance' | 'fire' | 'taxi' | 'arms_van', playerPos: THREE.Vector3, maxDist = 7.5): { position: THREE.Vector3; arrived: boolean; distance: number } | null {
    const unit = this.serviceUnits.find(u => u.kind === kind && u.active)
    if (!unit) return null
    const distance = Math.hypot(unit.root.position.x - playerPos.x, unit.root.position.z - playerPos.z)
    if (distance > maxDist && !unit.arrived) return null
    return { position: unit.root.position, arrived: unit.arrived, distance }
  }

  consumeServiceUnit(kind: 'ambulance' | 'fire' | 'taxi' | 'arms_van'): void {
    const unit = this.serviceUnits.find(u => u.kind === kind)
    if (!unit) return
    unit.active = false
    unit.root.visible = false
  }

  /** Non-mutating check whether a Yellow Cab or dispatched Roman taxi is within hailing range. */
  isCabNearby(playerPos: THREE.Vector3, maxDist = 7.5): boolean {
    const dispatched = this.serviceUnits.find(u => u.kind === 'taxi' && u.active)
    if (dispatched && Math.hypot(dispatched.root.position.x - playerPos.x, dispatched.root.position.z - playerPos.z) <= maxDist) {
      return true
    }
    return this.vehicles.some(
      car => !car.patrol && car.root.visible && car.root.name === 'Yellow Cab'
        && Math.hypot(car.root.position.x - playerPos.x, car.root.position.z - playerPos.z) <= maxDist,
    )
  }

  /** Hail nearest passing yellow cab or Roman Cab unit within range; returns cab world pose. */
  hailNearestCab(playerPos: THREE.Vector3, maxDist = 7.5): { position: THREE.Vector3; heading: number } | null {
    const dispatched = this.serviceUnits.find(u => u.kind === 'taxi' && u.active)
    if (dispatched) {
      const dist = Math.hypot(dispatched.root.position.x - playerPos.x, dispatched.root.position.z - playerPos.z)
      if (dist <= maxDist) {
        return { position: dispatched.root.position, heading: dispatched.root.rotation.y }
      }
    }
    for (const car of this.vehicles) {
      if (car.patrol || !car.root.visible) continue
      if (car.root.name !== 'Yellow Cab') continue
      const dist = Math.hypot(car.root.position.x - playerPos.x, car.root.position.z - playerPos.z)
      if (dist <= maxDist) {
        car.speed = 0
        return { position: car.root.position, heading: car.root.rotation.y }
      }
    }
    return null
  }

  /** Drive the dispatched taxi toward a destination for GTA IV backseat cab ride. */
  driveCabTo(targetPos: THREE.Vector3, startPos?: THREE.Vector3): { position: THREE.Vector3; heading: number; arrived: boolean } {
    let unit = this.serviceUnits.find(u => u.kind === 'taxi')
    if (!unit) {
      this.summonServiceVehicle('taxi', startPos ?? targetPos)
      unit = this.serviceUnits.find(u => u.kind === 'taxi')!
    }
    if (startPos && !unit.active) {
      unit.root.position.set(startPos.x, 0.04, startPos.z)
    }
    unit.active = true
    unit.root.visible = true
    unit.timer = 90
    unit.target.copy(targetPos)
    unit.rideSpeed = 16.5
    unit.arrived = Math.hypot(unit.target.x - unit.root.position.x, unit.target.z - unit.root.position.z) < 2.2
    return { position: unit.root.position, heading: unit.root.rotation.y, arrived: unit.arrived }
  }

  /** Check whether a driven vehicle runs over an active roadblock spike strip (3+ stars). */
  checkSpikeStripHit(vehiclePos: THREE.Vector3, wanted: number): boolean {
    if (levelOf(wanted) < 3 || vehiclePos.y > 1.5) return false
    for (let i = 0; i < this.barriers.length; i += 1) {
      const block = this.barriers[i]
      if (!block.visible || this.barrierCooldowns[i] > 0 || this.spikeCooldowns[i] > 0) continue
      const dx = Math.abs(vehiclePos.x - block.position.x)
      const dz = Math.abs(vehiclePos.z - block.position.z)
      if (dx < 8.6 && dz < 1.8) {
        this.spikeCooldowns[i] = 5
        this.emit(vehiclePos.clone().add(new THREE.Vector3(0, 0.35, 0)), '#ffe49e', 6, false)
        return true
      }
    }
    return false
  }

  /** Resolve player or driven-vehicle collisions against traffic cars and active police roadblocks. */
  resolveDynamicCollisions(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    isVehicle: boolean,
    actorRadius: number,
  ): { hitTraffic: boolean; hitRoadblock: boolean; impactSpeed: number } {
    let hitTraffic = false
    let hitRoadblock = false
    let maxImpact = 0
    if (position.y > 2.4) return { hitTraffic, hitRoadblock, impactSpeed: 0 }

    for (const car of this.vehicles) {
      if (!car.root.visible) continue
      const dx = position.x - car.root.position.x
      const dz = position.z - car.root.position.z
      const carRadius = car.role === 'military' ? 2.15 : car.role === 'swat' ? 1.75 : 1.45
      const min = actorRadius + carRadius
      const distSq = dx * dx + dz * dz
      if (distSq >= min * min) continue
      const dist = Math.sqrt(distSq) || 0.01
      const nx = dx / dist
      const nz = dz / dist
      const pen = min - dist
      position.x += nx * pen
      position.z += nz * pen
      if (isVehicle) {
        const rel = Math.hypot(velocity.x, velocity.z)
        if (rel > 2.5) {
          maxImpact = Math.max(maxImpact, rel)
          velocity.x *= 0.62
          velocity.z *= 0.62
          velocity.x += nx * rel * 0.28
          velocity.z += nz * rel * 0.28
          car.crash = Math.max(car.crash, car.role === 'military' ? 0.9 : 2.8)
          car.speed *= 0.25
          this.emit(car.root.position.clone().add(new THREE.Vector3(0, 1.1, 0)), '#ffb25f', 4, false)
          hitTraffic = true
        }
      } else {
        hitTraffic = true
      }
    }

    for (let i = 0; i < this.barriers.length; i += 1) {
      const block = this.barriers[i]
      if (!block.visible || this.barrierCooldowns[i] > 0) continue
      const dx = position.x - block.position.x
      const dz = position.z - block.position.z
      const halfW = 9.0 + actorRadius
      const halfD = 0.65 + actorRadius
      if (Math.abs(dx) < halfW && Math.abs(dz) < halfD) {
        const speed = Math.hypot(velocity.x, velocity.z)
        if (isVehicle && speed >= 13) {
          block.visible = false
          this.barrierCooldowns[i] = 6
          velocity.multiplyScalar(0.72)
          this.emit(block.position.clone().add(new THREE.Vector3(0, 1, 0)), '#ffaa55', 8, true)
          hitRoadblock = true
          maxImpact = Math.max(maxImpact, speed * 0.7)
        } else {
          const signZ = dz >= 0 ? 1 : -1
          position.z = block.position.z + signZ * halfD
          if (isVehicle) {
            maxImpact = Math.max(maxImpact, speed)
            velocity.z *= -0.25
            velocity.x *= 0.7
          }
          hitRoadblock = true
        }
      }
    }

    return { hitTraffic, hitRoadblock, impactSpeed: maxImpact }
  }

  /** Advance movements, witness 911 timers, tactical units, and visible effects. */
  update(dt: number, player: THREE.Vector3, wanted: number, searchTarget?: THREE.Vector3): void {
    dt = safeStep(dt)
    if (dt === 0) return
    const level = levelOf(wanted)
    const navTarget = searchTarget ?? player
    this.time += dt
    for (let i = 0; i < this.barrierCooldowns.length; i += 1) {
      this.barrierCooldowns[i] = Math.max(0, this.barrierCooldowns[i] - dt)
      this.spikeCooldowns[i] = Math.max(0, this.spikeCooldowns[i] - dt)
    }

    const activeOfficers = level === 0 ? 1 : Math.min(MAX_OFFICERS, level + 1)
    for (let i = 0; i < this.officers.length; i += 1) {
      const officer = this.officers[i]
      const active = i < activeOfficers
      if (active && (!officer.active || (this.lastWanted === 0 && level > 0 && officer.root.position.distanceToSquared(player) > 45 * 45))) {
        const angle = i * 1.45 + 0.7
        officer.root.position.set(
          THREE.MathUtils.clamp(player.x + Math.cos(angle) * (18 + i * 2.5), -375, 365),
          0.04,
          THREE.MathUtils.clamp(player.z + Math.sin(angle) * (18 + i * 2.5), -375, 375),
        )
        officer.down = 0
        officer.hp = officer.maxHp
        officer.armor = level >= 3 ? 45 : 15
        officer.impulse.set(0, 0, 0)
        officer.fire = 0.7 + i * 0.3
      }
      officer.active = active
      officer.root.visible = active
    }

    for (const person of this.people) {
      this.witnessManager.syncActorPose(person.id, person.root.position, person.active, person.down)
    }
    this.witnessManager.update(dt, player)

    for (const person of this.people) this.updatePerson(person, dt, player, navTarget, level)
    for (const officer of this.officers) if (officer.active) this.updatePerson(officer, dt, player, navTarget, level)
    for (const vehicle of this.vehicles) this.updateVehicle(vehicle, dt, navTarget, level)
    this.updateServiceUnits(dt)
    this.updateRoadblocks(navTarget, level)
    this.updateHelicopter(dt, navTarget, level)
    this.updateBirds(dt, player)
    this.updateEffects(dt)
    this.lastWanted = level
  }

  /** Nearest person struck by a ray, clipped against solid world colliders. */
  shoot(origin: THREE.Vector3, direction: THREE.Vector3, range: number, startleRadius = 23): boolean {
    return this.shootBallistic(origin, direction, range, 40, 0.25, startleRadius).hit
  }

  /** Ballistic shot with localized head/torso/limb hitboxes, armor absorption, and stagger/knockdowns. */
  shootBallistic(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    range: number,
    baseDamage = 34,
    armorPenetration = 0.25,
    startleRadius = 23,
  ): BallisticHitResult {
    if (startleRadius > 0) this.startle(origin, startleRadius)
    const length = direction.length()
    if (!Number.isFinite(range) || range <= 0 || !Number.isFinite(length) || length < 1e-6) {
      return { hit: false, hitType: 'none', zone: 'torso', distance: 0, point: origin.clone(), critical: false, armorBroken: false, killed: false }
    }
    const dir = direction.clone().multiplyScalar(1 / length)
    let nearest = this.worldColliders.length > 0 ? worldRayDistance(origin, dir, this.worldColliders, range) : range
    let target: Pedestrian | undefined
    let hitZone: HitZone = 'torso'
    const zones: Array<[number, number, HitZone]> = [[0.45, 0.32, 'limb'], [1.08, 0.48, 'torso'], [1.75, 0.31, 'head']]

    for (const person of [...this.people, ...this.officers]) {
      if (!person.active || person.down > 0) continue
      for (const [height, radius, zone] of zones) {
        const x = person.root.position.x - origin.x
        const y = person.root.position.y + height - origin.y
        const z = person.root.position.z - origin.z
        const projected = x * dir.x + y * dir.y + z * dir.z
        const perpendicularSq = x * x + y * y + z * z - projected * projected
        if (perpendicularSq > radius * radius) continue
        const halfChord = Math.sqrt(Math.max(0, radius * radius - perpendicularSq))
        const entry = Math.max(0, projected - halfChord)
        if (projected + halfChord >= 0 && entry <= nearest) {
          nearest = entry
          target = person
          hitZone = zone
        }
      }
    }

    const end = origin.clone().addScaledVector(dir, nearest)
    this.addTrace(origin, end, false)
    if (!target) {
      return { hit: false, hitType: 'none', zone: 'torso', distance: nearest, point: end, critical: false, armorBroken: false, killed: false }
    }

    const mult = hitZone === 'head' ? 2.4 : hitZone === 'limb' ? 0.7 : 1.0
    const falloff = nearest > 35 ? Math.max(0.55, 1 - (nearest - 35) / 80) : 1
    let dmg = baseDamage * mult * falloff
    let armorBroken = false

    if (hitZone === 'torso' && target.armor > 0) {
      const absorbed = Math.min(target.armor, dmg * (1 - armorPenetration))
      target.armor = Math.max(0, target.armor - absorbed)
      dmg -= absorbed * 0.7
      armorBroken = target.armor <= 0
      this.emit(end, '#6cdbff', 6, false)
    } else {
      this.emit(end, hitZone === 'head' ? '#ff5f6d' : '#ffd37b', hitZone === 'head' ? 8 : 5, false)
    }

    target.hp = Math.max(0, target.hp - dmg)
    const killed = target.hp <= 0
    const ragdollZone: RagdollHitZone = hitZone === 'head'
      ? 'head'
      : hitZone === 'limb'
        ? (end.y < target.root.position.y + 0.85 ? 'leg' : 'arm')
        : 'torso'
    const impulseStrength = hitZone === 'head' ? 8.2 : hitZone === 'limb' ? 6.8 : Math.max(4.5, Math.min(11, baseDamage * 0.14))
    this.hitPerson(target, origin, impulseStrength, ragdollZone, killed)
    if (killed) {
      target.down = Math.max(target.down, target.police ? 12 : 9)
      target.hp = target.maxHp
    }
    if (startleRadius > 0) this.startle(end, startleRadius)
    return {
      hit: true,
      hitType: target.police ? 'cop' : 'person',
      zone: hitZone,
      distance: nearest,
      point: end,
      critical: hitZone === 'head',
      armorBroken,
      killed,
    }
  }

  /** Close-quarters street-brawl strike with optional weapon disarm and localized Euphoria stumble. */
  applyBrawlHit(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    damage: number,
    disarm = false,
  ): { hit: boolean; hitCop: boolean; killed: boolean; disarmed: boolean } {
    const dir = direction.clone().setY(0).normalize()
    let best: Pedestrian | undefined
    let bestDist = 2.65
    for (const person of [...this.people, ...this.officers]) {
      if (!person.active || person.down > 0) continue
      const dx = person.root.position.x - origin.x
      const dz = person.root.position.z - origin.z
      const dist = Math.hypot(dx, dz)
      if (dist > bestDist) continue
      const dot = dist < 0.2 ? 1 : (dx * dir.x + dz * dir.z) / dist
      if (dot < 0.2) continue
      bestDist = dist
      best = person
    }
    if (!best) return { hit: false, hitCop: false, killed: false, disarmed: false }
    let disarmed = false
    if (disarm && best.police && best.disarmedTimer <= 0) {
      best.disarmedTimer = 7
      best.fire = Math.max(best.fire, 7)
      this.dropWeaponProp(best)
      disarmed = true
    }
    best.hp = Math.max(0, best.hp - damage)
    const killed = best.hp <= 0
    this.hitPerson(best, origin, killed || disarm ? 7.5 : 4.2, disarm ? 'arm' : 'torso', killed)
    if (killed) {
      best.down = Math.max(best.down, best.police ? 12 : 9)
      best.hp = best.maxHp
    }
    return { hit: true, hitCop: best.police, killed, disarmed }
  }

  /** Radial explosive blast (grenades / launcher) damaging nearby people, police, and vehicles. */
  explode(origin: THREE.Vector3, radius = 8, damage = 95): { peopleHit: number; copsDown: number } {
    this.startle(origin, Math.max(28, radius * 4))
    this.emit(origin, '#ff9848', 16, true)
    this.emit(origin, '#fff2aa', 12, false)
    let peopleHit = 0
    let copsDown = 0
    for (const person of [...this.people, ...this.officers]) {
      if (!person.active) continue
      const dx = person.root.position.x - origin.x
      const dz = person.root.position.z - origin.z
      const dist = Math.hypot(dx, dz)
      if (dist > radius) continue
      const ratio = 1 - dist / Math.max(1, radius)
      person.hp = Math.max(0, person.hp - damage * ratio)
      this.hitPerson(person, origin, 10 * Math.max(0.4, ratio))
      person.down = Math.max(person.down, 4 + ratio * 6)
      peopleHit += 1
      if (person.police) copsDown += 1
    }
    for (const car of this.vehicles) {
      if (!car.root.visible) continue
      const dx = car.root.position.x - origin.x
      const dz = car.root.position.z - origin.z
      if (dx * dx + dz * dz <= (radius + 2.5) ** 2) {
        car.crash = Math.max(car.crash, 4.5)
        car.speed *= 0.15
        this.emit(car.root.position.clone().add(new THREE.Vector3(0, 1.3, 0)), '#ff7e47', 6, true)
      }
    }
    return { peopleHit, copsDown }
  }

  /** Frighten nearby bystanders and birds without changing game rules. */
  startle(position: THREE.Vector3, radius = 23): void {
    const rSq = radius * radius
    for (const person of this.people) {
      const dx = person.root.position.x - position.x
      const dz = person.root.position.z - position.z
      if (dx * dx + dz * dz < rSq && Math.abs(position.y - 1) < 12) {
        person.danger.copy(position)
        if (person.witnessState === 'calm') person.witnessState = 'fleeing'
        person.flee = Math.max(person.flee, 5 + this.random() * 2)
      }
    }
    for (const bird of this.birds) {
      const dx = bird.root.position.x - position.x
      const dz = bird.root.position.z - position.z
      if (dx * dx + dz * dz < rSq) bird.scared = 3
    }
  }

  /** Knock down nearby people and damage/brake nearby visual traffic. Returns people hit. */
  impact(position: THREE.Vector3, radius: number, force: number): number {
    if (!Number.isFinite(radius) || radius <= 0 || !Number.isFinite(force) || force <= 0) return 0
    this.startle(position)
    let hit = 0
    const strength = THREE.MathUtils.clamp(force, 1, 16)
    for (const person of [...this.people, ...this.officers]) {
      if (!person.active || person.hitLock > 0 || person.down > 0) continue
      const dx = person.root.position.x - position.x
      const dy = person.root.position.y + 1 - position.y
      const dz = person.root.position.z - position.z
      if (dx * dx + dy * dy + dz * dz <= (radius + 0.45) ** 2) {
        this.hitPerson(person, position, strength, strength > 7 ? 'torso' : 'leg', strength >= 9)
        hit += 1
      }
    }
    for (const car of this.vehicles) {
      if (!car.root.visible) continue
      const dx = car.root.position.x - position.x
      const dz = car.root.position.z - position.z
      if (Math.abs(position.y - car.root.position.y) < radius + 2 && dx * dx + dz * dz < (radius + 2) ** 2) {
        if (car.crash <= 0) this.emit(car.root.position.clone().add(new THREE.Vector3(0, 1.1, 0)), '#ffb25f', 4, false)
        car.crash = Math.max(car.crash, 2.5 + strength * 0.16)
        car.speed *= 0.35
      }
    }
    if (hit > 0) this.emit(position, '#eadac2', 5, true)
    return hit
  }

  /** A moving traffic vehicle can knock a pedestrian player down. */
  hitPlayer(player: THREE.Vector3): { direction: THREE.Vector3; force: number } | null {
    if (player.y > 2) return null
    for (const car of this.vehicles) {
      if (!car.root.visible || car.crash > 0 || Math.abs(car.speed) < 4) continue
      const dx = player.x - car.root.position.x, dz = player.z - car.root.position.z
      if (dx * dx + dz * dz > 4.8) continue
      const force = Math.abs(car.speed)
      const direction = new THREE.Vector3(dx || .1, 0, dz || .1).normalize()
      car.crash = 1.5; car.speed *= .3; this.startle(player)
      return { direction, force }
    }
    return null
  }

  /** Incoming police/SWAT/helicopter/military HP damage this step; walls block shots when colliders are set. */
  getDamage(player: THREE.Vector3, dt: number, wanted: number): number {
    dt = safeStep(dt)
    const level = levelOf(wanted)
    if (dt === 0 || level === 0) return 0
    let damage = 0
    const target = new THREE.Vector3(player.x, player.y + 1.2, player.z)

    for (const officer of this.officers) {
      if (!officer.active || officer.down > 0 || officer.disarmedTimer > 0) continue
      officer.fire -= dt
      const dx = officer.root.position.x - player.x
      const dz = officer.root.position.z - player.z
      if (officer.fire <= 0 && dx * dx + dz * dz < (19 + level * 2) ** 2 && Math.abs(player.y) < 9) {
        const muzzle = officer.root.position.clone().add(new THREE.Vector3(0, 1.38, 0))
        const blocked = this.worldColliders.length > 0 && !hasLineOfSight(muzzle, target, this.worldColliders)
        officer.fire = Math.max(0.7, 1.35 - level * 0.08) + this.random() * 0.55
        if (blocked) continue
        this.addTrace(muzzle, target, true)
        this.emit(muzzle, '#ffd17a', 2, false)
        damage += 3 + level * 0.4
      }
    }

    for (const car of this.vehicles) {
      if (!this.isVehicleActiveForWanted(car, level) || car.crash > 0) continue
      car.fire -= dt
      const dx = car.root.position.x - player.x
      const dz = car.root.position.z - player.z
      const maxRange = car.role === 'military' ? 28 : car.role === 'swat' ? 22 : 17
      if (car.fire <= 0 && dx * dx + dz * dz < maxRange * maxRange && Math.abs(player.y) < 8) {
        const muzzle = car.root.position.clone().add(new THREE.Vector3(0, car.role === 'military' ? 2.1 : 1.45, 0))
        const blocked = this.worldColliders.length > 0 && !hasLineOfSight(muzzle, target, this.worldColliders)
        car.fire = car.role === 'military' ? 1.55 : car.role === 'swat' ? 1.85 : 2.1 + this.random()
        if (blocked) continue
        this.addTrace(muzzle, target, true)
        if (car.role === 'military') {
          this.emit(muzzle, '#ff9852', 5, true)
          damage += 7.5
        } else {
          damage += (car.role === 'swat' ? 3.8 : 2.5) + level * 0.25
        }
      }
    }

    if (level >= 4 && this.helicopter.visible) {
      this.heliFire -= dt
      const dx = this.helicopter.position.x - player.x
      const dz = this.helicopter.position.z - player.z
      if (this.heliFire <= 0 && dx * dx + dz * dz < 32 * 32) {
        const muzzle = this.helicopter.position.clone().add(new THREE.Vector3(0, -0.5, 0))
        const blocked = this.worldColliders.length > 0 && !hasLineOfSight(muzzle, target, this.worldColliders)
        this.heliFire = level >= 5 ? 1.8 : 2.3
        if (!blocked) {
          this.addTrace(muzzle, target, true)
          damage += 4 + (level - 4) * 0.9
        }
      }
    }
    return damage
  }

  private isVehicleActiveForWanted(car: Vehicle, level: number): boolean {
    if (!car.patrol || level <= 0) return false
    if (car.role === 'swat') return level >= 3
    if (car.role === 'military') return level >= 6
    return true
  }

  private random(): number {
    this.randomState = (Math.imul(this.randomState, 1664525) + 1013904223) >>> 0
    return this.randomState / 4294967296
  }

  private material(color: string, emissive = false): THREE.MeshStandardMaterial {
    const key = `${color}:${emissive}`
    let result = this.materials.get(key)
    if (!result) {
      result = new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true, emissive: emissive ? color : '#000000', emissiveIntensity: emissive ? 1.5 : 0 })
      this.materials.set(key, result)
    }
    return result
  }

  private box(parent: THREE.Object3D, color: string, x: number, y: number, z: number, width: number, height: number, depth: number, emissive = false): THREE.Mesh {
    const mesh = new THREE.Mesh(this.boxGeometry, this.material(color, emissive))
    mesh.position.set(x, y, z)
    mesh.scale.set(width, height, depth)
    mesh.castShadow = !emissive
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }

  private ball(parent: THREE.Object3D, color: string, x: number, y: number, z: number, sx: number, sy: number, sz: number): THREE.Mesh {
    const mesh = new THREE.Mesh(this.sphereGeometry, this.material(color))
    mesh.position.set(x, y, z)
    mesh.scale.set(sx, sy, sz)
    mesh.castShadow = true
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }

  private compound(parent: THREE.Object3D, parts: Part[], light = false): THREE.Mesh {
    const key = JSON.stringify(parts)
    let geometry = this.compoundGeometries.get(key)
    if (!geometry) {
      const components = parts.map(([shape, color, x, y, z, sx, sy, sz]) => {
        const component = (shape === 'box' ? this.boxGeometry : this.sphereGeometry).clone()
        const transform = new THREE.Matrix4().makeScale(sx, sy, sz)
        transform.setPosition(x, y, z)
        component.applyMatrix4(transform)
        const col = new THREE.Color(color)
        const colors = new Float32Array(component.getAttribute('position').count * 3)
        for (let i = 0; i < colors.length; i += 3) {
          colors[i] = col.r
          colors[i + 1] = col.g
          colors[i + 2] = col.b
        }
        component.setAttribute('color', new THREE.BufferAttribute(colors, 3))
        return component
      })
      geometry = mergeGeometries(components)
      for (const component of components) component.dispose()
      this.compoundGeometries.set(key, geometry)
    }
    const mesh = new THREE.Mesh(geometry, light ? this.compoundLightMaterial : this.compoundMaterial)
    mesh.castShadow = !light
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }

  private makePerson(police: boolean, index: number): Pedestrian {
    const root = new THREE.Group()
    const model = new THREE.Group()
    root.name = police ? 'Police officer' : 'Pedestrian'
    root.add(model)
    const shirts = ['#ed785e', '#47b6bd', '#f3c66d', '#ba7db4', '#e8d9c4', '#7aa0c7', '#e75f87', '#83bd98']
    const skins = ['#e9b28d', '#9c664b', '#c6855b', '#f1c7a8', '#704936']
    const swatStyle = police && index >= 3
    const shirt = police ? (swatStyle ? '#161b22' : '#203c60') : shirts[index % shirts.length]
    const pants = police ? (swatStyle ? '#10141a' : '#18283d') : ['#263a50', '#e3d2ae', '#405464', '#6c4b54'][index % 4]
    const skin = skins[index % skins.length]
    const bodyParts: Part[] = [
      ['box', shirt, 0, 1.16, 0, swatStyle ? 0.6 : 0.54, 0.7, swatStyle ? 0.34 : 0.28],
      ['ball', skin, 0, 1.76, 0, 0.23, 0.26, 0.23],
    ]
    if (police) {
      bodyParts.push(['box', swatStyle ? '#0f1419' : '#142538', 0, 1.99, 0, 0.51, swatStyle ? 0.19 : 0.12, 0.43])
      bodyParts.push(['box', swatStyle ? '#4d92ff' : '#d5b956', -0.14, 1.27, 0.175, 0.11, 0.12, 0.025])
    } else {
      bodyParts.push(['box', ['#3f302d', '#322b31', '#916249', '#24242b'][index % 4], 0, 1.97, -0.015, 0.42, 0.12, 0.38])
    }
    this.compound(model, bodyParts)
    const limb = (x: number, y: number, color: string, length: number, width: number, leg: boolean): THREE.Group => {
      const joint = new THREE.Group()
      joint.position.set(x, y, 0)
      const parts: Part[] = [['box', color, 0, -length / 2, 0, width, length, width]]
      if (leg) parts.push(['box', '#232936', 0, -0.76, 0.07, 0.23, 0.14, 0.33])
      else parts.push(['ball', skin, 0, -0.67, 0, 0.1, 0.12, 0.1])
      this.compound(joint, parts)
      model.add(joint)
      return joint
    }
    const leftLeg = limb(-0.15, 0.83, pants, 0.78, 0.2, true)
    const rightLeg = limb(0.15, 0.83, pants, 0.78, 0.2, true)
    const leftArm = limb(-0.36, 1.44, shirt, 0.65, 0.18, false)
    const rightArm = limb(0.36, 1.44, shirt, 0.65, 0.18, false)

    let witnessMarker: THREE.Group | undefined
    let witnessPhone: THREE.Mesh | undefined
    if (!police) {
      witnessMarker = new THREE.Group()
      witnessMarker.position.set(0, 2.45, 0)
      this.box(witnessMarker, '#ffd646', 0, 0.16, 0, 0.12, 0.32, 0.12, true)
      this.box(witnessMarker, '#ffd646', 0, -0.1, 0, 0.12, 0.12, 0.12, true)
      witnessMarker.visible = false
      root.add(witnessMarker)

      witnessPhone = this.box(rightArm, '#6ef7ff', 0, -0.58, 0.14, 0.1, 0.18, 0.04, true)
      witnessPhone.visible = false
    }

    const side = index % 2 === 0 ? -1 : 1
    const streetX = !police && index >= 30 ? -205 : !police && index >= 18 ? -70 : 0
    const z = police ? -18 + index * 11 : -88 + index * 8 + this.random() * 4
    const sidewalk = streetX === 0 ? 11.5 + (index % 3) * 0.8 : 8.5 + (index % 3) * 0.6
    root.position.set(streetX + side * sidewalk, streetX === 0 ? 0.14 : 0.04, z)
    const active = !police || index === 0
    root.visible = active
    this.group.add(root)
    const id = `${police ? 'cop' : 'ped'}-${index}`
    const maxHp = police ? (swatStyle ? 120 : 85) : 55
    return {
      id,
      root, model, leftLeg, rightLeg, leftArm, rightArm, witnessMarker, witnessPhone,
      police, active, side, streetX,
      direction: index % 4 < 2 ? 1 : -1,
      speed: 0.95 + this.random() * 0.42,
      phase: this.random() * TAU,
      flee: 0,
      danger: new THREE.Vector3(),
      impulse: new THREE.Vector3(),
      stagger: 0,
      down: 0,
      hitLock: 0,
      fire: 0.8 + index * 0.3,
      hp: maxHp,
      maxHp,
      armor: police && swatStyle ? 45 : police ? 15 : 0,
      witnessState: 'calm',
      shockTimer: 0,
      reportTimer: 0,
      reportSeverity: 1,
      reportOrigin: new THREE.Vector3(),
      lostLosTimer: 0,
      ragdoll: createRagdollRig(),
      disarmedTimer: 0,
    }
  }

  private dropWeaponProp(person: Pedestrian): void {
    if (!person.droppedWeapon) {
      const gun = new THREE.Mesh(this.boxGeometry, this.material('#1a1f26'))
      gun.scale.set(0.1, 0.14, 0.38)
      gun.castShadow = true
      this.group.add(gun)
      person.droppedWeapon = gun
    }
    person.droppedWeapon.visible = true
    person.droppedWeapon.position.set(
      person.root.position.x + (person.side * 0.45),
      0.08,
      person.root.position.z + 0.3,
    )
    person.droppedWeapon.rotation.set(0, person.root.rotation.y + 0.6, Math.PI * 0.48)
  }

  private updateServiceUnits(dt: number): void {
    for (const u of this.serviceUnits) {
      if (!u.active) continue
      u.timer -= dt
      if (u.timer <= 0) {
        u.active = false
        u.root.visible = false
        continue
      }
      const dx = u.target.x - u.root.position.x
      const dz = u.target.z - u.root.position.z
      const dist = Math.hypot(dx, dz)
      if (dist > 1.2) {
        const spd = u.rideSpeed ?? (u.kind === 'taxi' ? 12.5 : 14)
        const move = Math.min(dist, spd * dt)
        u.root.position.x += (dx / dist) * move
        u.root.position.z += (dz / dist) * move
        u.root.rotation.y = angleDamp(u.root.rotation.y, Math.atan2(dx, dz), 5, dt)
        u.arrived = false
      } else {
        u.arrived = true
      }
      const flash = Math.floor(this.time * 6) % 2 === 0
      if (u.red) u.red.visible = flash
      if (u.blue) u.blue.visible = u.kind === 'arms_van' ? true : !flash
    }
  }

  private updatePerson(person: Pedestrian, dt: number, realPlayer: THREE.Vector3, navTarget: THREE.Vector3, wanted: number): void {
    person.flee = Math.max(0, person.flee - dt)
    person.stagger = Math.max(0, person.stagger - dt)
    person.down = Math.max(0, person.down - dt)
    person.hitLock = Math.max(0, person.hitLock - dt)
    person.disarmedTimer = Math.max(0, person.disarmedTimer - dt)
    const pos = person.root.position
    pos.addScaledVector(person.impulse, dt)
    person.impulse.multiplyScalar(Math.exp(-4.5 * dt))

    // Sync witness state from WitnessManager for upright civilians
    if (!person.police) {
      const actor = this.witnessManager.getActor(person.id)
      if (actor) {
        person.witnessState = actor.state
        person.shockTimer = actor.shockTimer
        person.reportTimer = actor.reportTimer
        if (person.down <= 0 && (actor.state === 'shocked' || actor.state === 'reporting')) {
          person.root.rotation.y = angleDamp(person.root.rotation.y, Math.atan2(realPlayer.x - pos.x, realPlayer.z - pos.z), 8, dt)
        } else if (actor.state === 'down' || actor.state === 'intimidated' || actor.state === 'fleeing') {
          if (person.flee <= 0 && person.down <= 0) {
            actor.state = 'calm'
            person.witnessState = 'calm'
          }
        }
      }

      if (person.witnessMarker) {
        const showAlert = person.down <= 0 && (person.witnessState === 'shocked' || person.witnessState === 'reporting')
        person.witnessMarker.visible = showAlert
        if (showAlert) {
          person.witnessMarker.rotation.y += dt * 3.5
          person.witnessMarker.position.y = 2.45 + Math.sin(this.time * 8) * 0.08
        }
      }
      if (person.witnessPhone) {
        person.witnessPhone.visible = person.down <= 0 && person.witnessState === 'reporting'
      }
    }

    let dx = 0
    let dz = 0
    let speed = person.speed
    if (person.down <= 0) {
      if (person.police && wanted > 0) {
        dx = navTarget.x - pos.x
        dz = navTarget.z - pos.z
        const distance = Math.hypot(dx, dz)
        if (distance > 6) {
          dx /= distance
          dz /= distance
          speed = 2.45 + wanted * 0.2
        } else {
          dx = 0
          dz = 0
        }
      } else if (!person.police && (person.witnessState === 'shocked' || person.witnessState === 'reporting')) {
        // Witness freezes or steps back slightly while dialing 911
        dx = 0
        dz = 0
      } else if (!person.police && person.flee > 0) {
        dx = pos.x - person.danger.x
        dz = pos.z - person.danger.z
        if (Math.abs(dz) < 1.5) dz = person.direction * 3
        const distance = Math.hypot(dx, dz) || 1
        dx /= distance
        dz /= distance
        speed = person.witnessState === 'intimidated' ? 4.4 : 3.8
      } else {
        dz = person.direction
      }
      pos.x += dx * speed * dt
      pos.z += dz * speed * dt
      if (dx !== 0 || dz !== 0) person.root.rotation.y = angleDamp(person.root.rotation.y, Math.atan2(dx, dz), 8, dt)
    }

    if (!person.police || wanted === 0) {
      const inner = person.streetX === 0 ? 10.6 : 7.8
      const outer = person.streetX === 0 ? 14.7 : 10.8
      pos.x = person.streetX + person.side * THREE.MathUtils.clamp(Math.abs(pos.x - person.streetX), inner, outer)
      pos.y = person.streetX === 0 ? 0.14 : 0.04
      if (pos.z - realPlayer.z > 115) pos.z = THREE.MathUtils.clamp(realPlayer.z - 105, -370, 370)
      else if (pos.z - realPlayer.z < -115) pos.z = THREE.MathUtils.clamp(realPlayer.z + 105, -370, 370)
      pos.z = THREE.MathUtils.clamp(pos.z, -375, 375)
    } else if (Math.hypot(pos.x - realPlayer.x, pos.z - realPlayer.z) > 110) {
      const angle = person.phase + this.time * 0.2
      pos.set(THREE.MathUtils.clamp(realPlayer.x + Math.cos(angle) * 28, -375, 365), 0.04, THREE.MathUtils.clamp(realPlayer.z + Math.sin(angle) * 28, -375, 375))
    }

    if (person.droppedWeapon && person.down <= 0 && person.disarmedTimer <= 0) {
      person.droppedWeapon.visible = false
    }

    stepRagdoll(
      person.ragdoll,
      {
        root: person.root,
        model: person.model,
        leftArm: person.leftArm,
        rightArm: person.rightArm,
        leftLeg: person.leftLeg,
        rightLeg: person.rightLeg,
      },
      dt,
      person.streetX === 0 ? 0.14 : 0.04,
    )
    const ragState = person.ragdoll.state
    if (ragState !== 'upright') {
      person.stagger = Math.max(person.stagger, ragState === 'stumble' || ragState === 'recovering' ? 0.2 : 0)
      if (ragState === 'falling' || ragState === 'down_writhing' || ragState === 'sleeping') {
        person.down = Math.max(person.down, 0.25)
      }
      return
    }

    const moving = person.down <= 0 && (dx !== 0 || dz !== 0)
    person.phase += dt * (moving ? speed * 3.3 : 1)
    const swing = moving ? Math.sin(person.phase) * (person.flee > 0 ? 0.9 : 0.55) : 0
    person.leftLeg.rotation.x = swing
    person.rightLeg.rotation.x = -swing
    if (!person.police && person.witnessState === 'reporting' && person.down <= 0) {
      // Hold phone up near ear!
      person.rightArm.rotation.x = -1.75
      person.leftArm.rotation.x = 0.2
    } else if (!person.police && (person.witnessState === 'intimidated' || person.witnessState === 'shocked') && person.down <= 0) {
      // Hands raised in fear/intimidation!
      person.leftArm.rotation.x = -2.4
      person.rightArm.rotation.x = -2.4
    } else {
      person.leftArm.rotation.x = -swing * 0.7
      person.rightArm.rotation.x = swing * 0.7
    }
    const fallen = person.down > 0 ? 1.3 : person.stagger > 0 ? 0.35 : 0
    person.model.rotation.z = THREE.MathUtils.damp(person.model.rotation.z, fallen * person.side, 9, dt)
    person.model.position.y = moving ? Math.abs(Math.sin(person.phase)) * 0.035 : 0
  }

  private hitPerson(
    person: Pedestrian,
    from: THREE.Vector3,
    force: number,
    zone: RagdollHitZone = 'torso',
    lethal = false,
  ): void {
    let dx = person.root.position.x - from.x
    let dz = person.root.position.z - from.z
    const distance = Math.hypot(dx, dz)
    if (distance < 0.01) {
      dx = person.side
      dz = person.direction * 0.5
    } else {
      dx /= distance
      dz /= distance
    }
    if (!person.police) {
      this.witnessManager.knockDown(person.id)
      person.witnessState = 'down'
      person.reportTimer = 0
      person.shockTimer = 0
      if (person.witnessPhone) person.witnessPhone.visible = false
    } else if (force >= 5 || lethal) {
      this.dropWeaponProp(person)
    }
    applyRagdollImpulse(person.ragdoll, person.root.position, from, force, zone, lethal, person.flee > 0)
    person.impulse.set(dx * Math.min(10, force), 0, dz * Math.min(10, force))
    person.down = Math.max(person.down, lethal ? 6.5 : 1.6 + Math.min(2.4, force * 0.18))
    person.stagger = 1
    person.hitLock = 0.6
    person.danger.copy(from)
    person.flee = person.police ? 0 : 7
    this.emit(person.root.position.clone().add(new THREE.Vector3(0, 1.2, 0)), '#ffddaa', 5, false)
  }

  private makeTraffic(): void {
    const colors = ['#f2a45e', '#69c9c6', '#e56b85', '#cfc5aa', '#6093ba', '#ebd369', '#e9e0d0', '#b682aa']
    const lanes = [-7.5, -2.5, 2.5, 7.5]
    for (let i = 0; i < 8; i += 1) {
      const lane = lanes[i % 4]
      const direction = lane < 0 ? -1 : 1
      this.makeVehicle('z', lane, direction, -63 + Math.floor(i / 4) * 68 + (i % 4) * 11, colors[i], 'civilian')
    }
    this.makeVehicle('x', 21.5, 1, -38, '#e8c16a', 'civilian')
    this.makeVehicle('x', 26.5, -1, 40, '#61b8b7', 'civilian')
    this.makeVehicle('z', -73.5, -1, 20, '#cbb9db', 'civilian')
    this.makeVehicle('z', -66.5, 1, -30, '#d39e73', 'civilian')
    this.makeVehicle('z', -133.5, 1, 82, '#8cb7c2', 'civilian')
    this.makeVehicle('z', -126.5, -1, -118, '#d7aa7c', 'civilian')
    this.makeVehicle('z', -208.5, 1, 48, '#b8c0c8', 'civilian')
    this.makeVehicle('z', -203.5, -1, -176, '#d8bc82', 'civilian')
    this.makeVehicle('z', -2.5, -1, 36, '#dce4e3', 'patrol')
    this.makeVehicle('z', 2.5, 1, -45, '#dce4e3', 'patrol')
    this.makeVehicle('z', -2.5, 1, -90, '#1e2838', 'swat')
    this.makeVehicle('z', 2.5, -1, 110, '#4f5d42', 'military')
    this.makeVehicle('x', -160, 1, -110, '#e2e5d9', 'civilian')
    this.makeVehicle('x', 240, -1, 155, '#c5d4d6', 'civilian')
  }

  private makeVehicle(axis: 'x' | 'z', lane: number, direction: number, along: number, color: string, role: PoliceVehicleRole): void {
    const patrol = role !== 'civilian'
    const root = new THREE.Group()
    const body = new THREE.Group()
    const isCab = role === 'civilian' && (color === '#ebd369' || color === '#e8c16a')
    root.name = role === 'military' ? 'Military APC' : role === 'swat' ? 'SWAT tactical van' : patrol ? 'Police patrol car' : isCab ? 'Yellow Cab' : 'Traffic car'
    root.add(body)

    let turret: THREE.Group | undefined
    const wheels: THREE.Mesh[] = []
    let red: THREE.Mesh | undefined
    let blue: THREE.Mesh | undefined

    if (role === 'military') {
      const parts: Part[] = [
        ['box', '#4f5c41', 0, 0.85, 0, 2.7, 0.95, 5.1],
        ['box', '#3c4731', 0, 1.48, -0.15, 2.1, 0.55, 3.2],
        ['box', '#272c26', -1.42, 0.55, 0, 0.34, 0.75, 4.9],
        ['box', '#272c26', 1.42, 0.55, 0, 0.34, 0.75, 4.9],
      ]
      this.compound(body, parts)
      turret = new THREE.Group()
      turret.position.set(0, 1.85, -0.1)
      this.box(turret, '#414d36', 0, 0.16, 0, 1.45, 0.5, 1.7)
      this.box(turret, '#293025', 0, 0.2, 1.55, 0.24, 0.22, 2.2)
      body.add(turret)
      red = this.box(body, '#ff3f58', -0.5, 2.18, -0.3, 0.28, 0.16, 0.28, true)
      blue = this.box(body, '#ff9838', 0.5, 2.18, -0.3, 0.28, 0.16, 0.28, true)
    } else if (role === 'swat') {
      const parts: Part[] = [
        ['box', '#1c2430', 0, 0.86, 0, 2.28, 0.9, 4.8],
        ['box', '#141a24', 0, 1.62, -0.25, 2.16, 0.92, 3.65],
        ['box', '#415b75', 0, 1.58, 1.6, 1.75, 0.45, 0.05],
        ['box', '#2f3d52', 0, 0.46, 2.42, 2.28, 0.25, 0.22],
        ['box', '#2f3d52', 0, 0.46, -2.42, 2.28, 0.25, 0.22],
      ]
      this.compound(body, parts)
      this.box(body, '#202b3d', 0, 2.14, 0.6, 1.15, 0.14, 0.36)
      red = this.box(body, '#ff3f58', -0.34, 2.25, 0.6, 0.44, 0.2, 0.3, true)
      blue = this.box(body, '#3e9fff', 0.34, 2.25, 0.6, 0.44, 0.2, 0.3, true)
      for (const x of [-1.14, 1.14]) for (const z of [-1.55, 1.55]) {
        const wheel = new THREE.Mesh(this.wheelGeometry, this.material('#1a1f24'))
        wheel.rotation.z = Math.PI / 2
        wheel.position.set(x, 0.48, z)
        body.add(wheel)
        wheels.push(wheel)
      }
    } else {
      const parts: Part[] = [
        ['box', patrol ? '#ebede5' : color, 0, 0.68, 0, 2.05, 0.72, 4.1],
        ['box', patrol ? '#24354a' : color, 0, 1.22, -0.2, 1.7, 0.62, 2.05],
        ['box', '#8cb7c2', 0, 1.23, 0.84, 1.42, 0.42, 0.035],
        ['box', '#8cb7c2', 0, 1.23, -1.25, 1.42, 0.42, 0.035],
        ['box', '#8cb7c2', -0.86, 1.23, -0.18, 0.035, 0.42, 1.65],
        ['box', '#8cb7c2', 0.86, 1.23, -0.18, 0.035, 0.42, 1.65],
        ['box', '#353a42', 0, 0.42, 2.07, 1.8, 0.17, 0.16],
        ['box', '#353a42', 0, 0.42, -2.07, 1.8, 0.17, 0.16],
      ]
      if (patrol) {
        parts.push(['box', '#172c45', -1.03, 0.73, 0, 0.04, 0.31, 2.8])
        parts.push(['box', '#172c45', 1.03, 0.73, 0, 0.04, 0.31, 2.8])
      }
      this.compound(body, parts)
      const lights: Part[] = []
      for (const x of [-0.7, 0.7]) {
        lights.push(['box', '#fff0bf', x, 0.77, 2.07, 0.42, 0.19, 0.04])
        lights.push(['box', '#fa4851', x, 0.73, -2.07, 0.38, 0.17, 0.04])
      }
      this.compound(body, lights, true)
      if (patrol) {
        this.box(body, '#202b3d', 0, 1.59, -0.2, 1.0, 0.12, 0.36)
        red = this.box(body, '#ff3f58', -0.28, 1.7, -0.2, 0.42, 0.2, 0.3, true)
        blue = this.box(body, '#3e9fff', 0.28, 1.7, -0.2, 0.42, 0.2, 0.3, true)
      } else if (isCab) {
        this.box(body, '#fff29c', 0, 1.58, 0.05, 0.55, 0.16, 0.24, true)
      }
      for (const x of [-1.02, 1.02]) for (const z of [-1.35, 1.35]) {
        const wheel = new THREE.Mesh(this.wheelGeometry, this.material('#20252c'))
        wheel.rotation.z = Math.PI / 2
        wheel.position.set(x, 0.44, z)
        body.add(wheel)
        wheels.push(wheel)
      }
    }

    if (axis === 'z') root.position.set(lane, 0.04, along)
    else root.position.set(along, 0.04, lane)
    root.rotation.y = axis === 'z' ? (direction > 0 ? 0 : Math.PI) : direction > 0 ? Math.PI / 2 : -Math.PI / 2
    if (role === 'swat' || role === 'military') root.visible = false
    this.group.add(root)
    const cruise = role === 'military' ? 5.2 : role === 'swat' ? 6.5 : patrol ? 6.0 : 6.6 + this.random() * 2.4
    this.vehicles.push({ root, body, turret, wheels, red, blue, axis, lane, direction, cruise, speed: cruise, patrol, role, crash: 0, smoke: 0, fire: 1 + this.random() * 2 })
  }

  private updateVehicle(car: Vehicle, dt: number, player: THREE.Vector3, level: number): void {
    if (car.role === 'swat' || car.role === 'military') {
      const shouldBeActive = this.isVehicleActiveForWanted(car, level)
      if (shouldBeActive && !car.root.visible) {
        const offset = car.role === 'military' ? 46 : 36
        car.root.position.set(THREE.MathUtils.clamp(player.x + 8 * car.direction, -360, 360), 0.04, THREE.MathUtils.clamp(player.z - offset * car.direction, -360, 360))
        car.crash = 0
        car.speed = car.cruise
      }
      car.root.visible = shouldBeActive
      if (!shouldBeActive) return
    }

    const pos = car.root.position
    car.crash = Math.max(0, car.crash - dt)
    car.smoke -= dt
    const pursuing = car.patrol && level > 0
    let targetSpeed = car.cruise
    let moveX = car.axis === 'x' ? car.direction : 0
    let moveZ = car.axis === 'z' ? car.direction : 0
    if (pursuing) {
      const dx = player.x - pos.x
      const dz = player.z - pos.z
      const distance = Math.hypot(dx, dz)
      const stopDist = car.role === 'military' ? 11 : 7
      if (distance > stopDist) {
        moveX = dx / distance
        moveZ = dz / distance
        const maxChase = car.role === 'military' ? 10.5 : car.role === 'swat' ? 11.2 : 9.8 + Math.min(2.5, level * 0.45)
        targetSpeed = Math.min(maxChase, distance * 0.5)
      } else {
        targetSpeed = 0
      }
      if (distance > 115) {
        pos.set(player.x + (car.direction > 0 ? -24 : 24), 0.04, player.z - 26 * car.direction)
      }
      if (car.turret) {
        const aimAngle = Math.atan2(dx, dz) - car.root.rotation.y
        car.turret.rotation.y = angleDamp(car.turret.rotation.y, aimAngle, 3.2, dt)
      }
    } else {
      if (car.axis === 'z') moveX = THREE.MathUtils.clamp((car.lane - pos.x) * 0.2, -0.65, 0.65)
      else moveZ = THREE.MathUtils.clamp((car.lane - pos.z) * 0.2, -0.65, 0.65)
      const moveLength = Math.hypot(moveX, moveZ) || 1
      moveX /= moveLength
      moveZ /= moveLength
      const ahead = car.axis === 'z' ? (player.z - pos.z) * car.direction : (player.x - pos.x) * car.direction
      const lateral = car.axis === 'z' ? Math.abs(player.x - pos.x) : Math.abs(player.z - pos.z)
      if (Math.abs(player.y) < 4 && ahead > -1 && ahead < 14 && lateral < 2.3) targetSpeed = Math.min(targetSpeed, Math.max(0, (ahead - 3.5) * 0.7))
      for (const other of this.vehicles) {
        if (other === car || !other.root.visible) continue
        const forward = car.axis === 'z' ? (other.root.position.z - pos.z) * car.direction : (other.root.position.x - pos.x) * car.direction
        const across = car.axis === 'z' ? Math.abs(other.root.position.x - pos.x) : Math.abs(other.root.position.z - pos.z)
        if (forward > 0 && forward < 10 && across < 2.3) targetSpeed = Math.min(targetSpeed, Math.max(0, (forward - 4.8) * 1.2))
      }
      const playerAlong = car.axis === 'z' ? player.z : player.x
      const along = car.axis === 'z' ? pos.z : pos.x
      if ((along - playerAlong) * car.direction > 115 || (along - playerAlong) * car.direction < -125) {
        const replacement = THREE.MathUtils.clamp(playerAlong - car.direction * (105 + this.random() * 12), -250, car.axis === 'z' ? 250 : 45)
        if (car.axis === 'z') pos.set(car.lane, 0.04, replacement)
        else pos.set(replacement, 0.04, car.lane)
      }
    }
    if (car.crash > 0) {
      targetSpeed = 0
      if (car.smoke <= 0) {
        this.emit(pos.clone().add(new THREE.Vector3(0, 1.3, 0)), '#a69d91', 2, true)
        car.smoke = 0.24
      }
    }
    car.speed = THREE.MathUtils.damp(car.speed, targetSpeed, targetSpeed < car.speed ? 5.2 : 1.05, dt)
    pos.x += moveX * car.speed * dt
    pos.z += moveZ * car.speed * dt
    if (car.speed > 0.1) car.root.rotation.y = angleDamp(car.root.rotation.y, Math.atan2(moveX, moveZ), pursuing ? 2.5 : 6, dt)
    car.body.rotation.z = THREE.MathUtils.damp(car.body.rotation.z, car.crash > 0 ? Math.sin(this.time * 14) * 0.04 : 0, 6, dt)
    for (const wheel of car.wheels) wheel.rotation.y += car.speed * dt / 0.43
    if (car.red && car.blue) {
      const flash = Math.floor(this.time * 7) % 2 === 0
      car.red.visible = !pursuing || flash
      car.blue.visible = !pursuing || !flash
    }
  }

  private makeRoadblocks(): void {
    for (let i = 0; i < 2; i += 1) {
      const block = new THREE.Group()
      block.name = 'Police roadblock'
      for (const x of [-4.5, 4.5]) {
        this.box(block, '#e5e8e0', x, 1, 0, 8.7, 0.62, 0.32)
        for (let j = -3; j <= 3; j += 1) {
          const stripe = this.box(block, '#ef8752', x + j * 1.15, 1, 0.18, 0.3, 0.72, 0.035)
          stripe.rotation.z = -0.4
        }
        for (const footX of [-3.7, 3.7]) this.box(block, '#53616a', x + footX, 0.45, 0, 0.15, 0.9, 0.9)
      }
      // Deployable spike strip just ahead of roadblock line
      this.box(block, '#272c33', 0, 0.06, 1.35, 16.4, 0.08, 0.45)
      for (let s = -7.5; s <= 7.5; s += 1.25) {
        this.box(block, '#d8e3ea', s, 0.14, 1.35, 0.08, 0.14, 0.12, true)
      }
      const light = this.box(block, '#ffba52', 0, 1.55, 0, 0.4, 0.22, 0.4, true)
      this.barrierLights.push(light)
      block.position.set(0, 0.04, i === 0 ? 45 : -45)
      block.visible = false
      this.group.add(block)
      this.barriers.push(block)
    }
  }

  private updateRoadblocks(player: THREE.Vector3, wanted: number): void {
    for (let i = 0; i < this.barriers.length; i += 1) {
      const block = this.barriers[i]
      const active = wanted >= (i === 0 ? 3 : 4) && this.barrierCooldowns[i] <= 0
      if (active && (!block.visible || Math.abs(block.position.z - player.z) > 90)) {
        block.position.z = THREE.MathUtils.clamp(player.z + (i === 0 ? 32 : -32), -245, 245)
      }
      block.visible = active
      this.barrierLights[i].visible = Math.floor(this.time * 4 + i) % 2 === 0
    }
  }

  private makeHelicopter(): THREE.Mesh {
    this.helicopter.name = 'Police helicopter'
    this.ball(this.helicopter, '#dbe6df', 0, 0, 0, 1.25, 0.82, 2.1)
    this.ball(this.helicopter, '#6495a5', 0, 0.1, 1.32, 0.95, 0.58, 0.83)
    this.box(this.helicopter, '#283e55', 0, 0.06, -2.65, 0.43, 0.4, 2.6)
    this.box(this.helicopter, '#dbe6df', 0, 0.7, -3.75, 0.13, 1.25, 0.85)
    for (const x of [-0.85, 0.85]) {
      this.box(this.helicopter, '#344657', x, -1.03, 0, 0.11, 0.1, 3.6)
      this.box(this.helicopter, '#344657', x, -0.68, -1, 0.1, 0.7, 0.1)
      this.box(this.helicopter, '#344657', x, -0.68, 0.9, 0.1, 0.7, 0.1)
    }
    this.rotor.position.y = 0.98
    this.box(this.rotor, '#293b48', 0, 0, 0, 7.2, 0.08, 0.19)
    this.box(this.rotor, '#293b48', 0, 0, 0, 0.19, 0.08, 7.2)
    this.helicopter.add(this.rotor)
    this.tailRotor.position.set(0.3, 0.35, -3.8)
    this.box(this.tailRotor, '#293b48', 0, 0, 0, 0.1, 1.5, 0.13)
    this.box(this.tailRotor, '#293b48', 0, 0, 0, 0.1, 0.13, 1.5)
    this.helicopter.add(this.tailRotor)
    this.box(this.helicopter, '#ff4055', -0.9, 0.35, -1, 0.18, 0.18, 0.18, true)
    this.box(this.helicopter, '#47aaff', 0.9, 0.35, -1, 0.18, 0.18, 0.18, true)
    const light = new THREE.Mesh(this.coneGeometry, new THREE.MeshBasicMaterial({ color: '#fff6c9', transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }))
    light.position.set(0, -7.7, 0)
    light.scale.set(4.5, 14, 4.5)
    this.helicopter.add(light)
    this.heliSpot.position.set(0, -0.5, 0.8)
    this.helicopter.add(this.heliSpot)
    this.helicopter.position.set(20, 15, -20)
    this.helicopter.visible = false
    this.group.add(this.helicopter)
    return light
  }

  private updateHelicopter(dt: number, player: THREE.Vector3, wanted: number): void {
    const active = wanted >= 4
    if (active && !this.helicopter.visible) {
      this.helicopter.position.set(player.x + 24, Math.max(15, player.y + 14), player.z - 24)
      this.heliFire = 2
    }
    this.helicopter.visible = active
    this.heliSpot.intensity = active ? 42 : 0
    if (!active) return
    const angle = this.time * 0.32
    const tx = player.x + Math.cos(angle) * 11
    const tz = player.z + Math.sin(angle) * 11
    const pos = this.helicopter.position
    const dx = tx - pos.x
    const dz = tz - pos.z
    const distance = Math.hypot(dx, dz)
    if (distance > 0.01) {
      const travel = Math.min(distance, 11 * dt)
      pos.x += dx / distance * travel
      pos.z += dz / distance * travel
      this.helicopter.rotation.y = angleDamp(this.helicopter.rotation.y, Math.atan2(player.x - pos.x, player.z - pos.z), 2, dt)
    }
    pos.y = THREE.MathUtils.damp(pos.y, Math.max(15, player.y + 14) + Math.sin(this.time * 2) * 0.4, 2, dt)
    this.heliSpotTarget.position.set(player.x + Math.sin(this.time * 1.1) * 2.5, 0, player.z + Math.cos(this.time * 0.9) * 2.5)
    this.heliSpotTarget.updateMatrixWorld()
    this.rotor.rotation.y += dt * 28
    this.tailRotor.rotation.x += dt * 35
    this.heliLight.rotation.z = Math.sin(this.time) * 0.06
  }

  private makeBirds(): void {
    for (let i = 0; i < 5; i += 1) {
      const root = new THREE.Group()
      root.name = 'Gull'
      this.ball(root, '#ece9db', 0, 0, 0, 0.22, 0.13, 0.35)
      const left = new THREE.Group()
      const right = new THREE.Group()
      left.position.x = -0.16
      right.position.x = 0.16
      this.box(left, '#e6e9e8', -0.32, 0, 0, 0.7, 0.07, 0.22)
      this.box(right, '#e6e9e8', 0.32, 0, 0, 0.7, 0.07, 0.22)
      root.add(left, right)
      root.position.set(12 + i * 3.8, 5 + i * 0.65, -36 + i * 22)
      this.group.add(root)
      this.birds.push({ root, left, right, phase: i * 1.8, scared: 0 })
    }
  }

  private updateBirds(dt: number, player: THREE.Vector3): void {
    for (const bird of this.birds) {
      bird.scared = Math.max(0, bird.scared - dt)
      bird.phase += dt * (bird.scared > 0 ? 8 : 4)
      bird.left.rotation.z = Math.sin(bird.phase) * 0.5
      bird.right.rotation.z = -bird.left.rotation.z
      bird.root.position.z += dt * (bird.scared > 0 ? 5 : 2)
      bird.root.position.y = THREE.MathUtils.damp(bird.root.position.y, (bird.scared > 0 ? 10 : 6) + Math.sin(bird.phase * 0.3) * 0.8, 1, dt)
      if (bird.root.position.z - player.z > 100) bird.root.position.z = THREE.MathUtils.clamp(player.z - 95, -370, 370)
      if (bird.root.position.z - player.z < -110) bird.root.position.z = THREE.MathUtils.clamp(player.z + 90, -370, 370)
    }
  }

  private emit(position: THREE.Vector3, color: string, count: number, smoke: boolean): void {
    for (let i = 0; i < count; i += 1) {
      const index = this.particleCursor++ % PARTICLE_COUNT
      const particle = this.particles[index]
      particle.position.copy(position)
      particle.velocity.set((this.random() - 0.5) * (smoke ? 1.2 : 5), (smoke ? 1 : 2) + this.random() * (smoke ? 1.3 : 3), (this.random() - 0.5) * (smoke ? 1.2 : 5))
      particle.total = smoke ? 0.8 + this.random() * 0.5 : 0.24 + this.random() * 0.24
      particle.life = particle.total
      particle.size = smoke ? 0.18 + this.random() * 0.2 : 0.08 + this.random() * 0.1
      particle.smoke = smoke
      this.particleMesh.setColorAt(index, this.color.set(color))
    }
    if (this.particleMesh.instanceColor) this.particleMesh.instanceColor.needsUpdate = true
  }

  private addTrace(start: THREE.Vector3, end: THREE.Vector3, police: boolean): void {
    const trace = this.traces[this.traceCursor++ % TRACE_COUNT]
    const delta = end.clone().sub(start)
    const length = delta.length()
    if (length < 0.01) return
    trace.mesh.position.copy(start).addScaledVector(delta, 0.5)
    trace.mesh.quaternion.setFromUnitVectors(UP, delta.multiplyScalar(1 / length))
    trace.mesh.scale.set(1, length, 1)
    trace.mesh.material = police ? this.tracePolice : this.tracePlayer
    trace.mesh.visible = true
    trace.life = 0.09
  }

  private updateEffects(dt: number): void {
    for (let i = 0; i < this.particles.length; i += 1) {
      const particle = this.particles[i]
      if (particle.life > 0) {
        particle.life = Math.max(0, particle.life - dt)
        particle.position.addScaledVector(particle.velocity, dt)
        particle.velocity.y += (particle.smoke ? 0.3 : -7) * dt
        const progress = 1 - particle.life / particle.total
        const size = particle.size * (particle.smoke ? 1 + progress * 1.4 : 1 - progress)
        this.particleDummy.position.copy(particle.position)
        this.particleDummy.scale.setScalar(particle.life > 0 ? size : 0)
      } else this.particleDummy.scale.setScalar(0)
      this.particleDummy.updateMatrix()
      this.particleMesh.setMatrixAt(i, this.particleDummy.matrix)
    }
    this.particleMesh.instanceMatrix.needsUpdate = true
    for (const trace of this.traces) {
      trace.life -= dt
      if (trace.life <= 0) trace.mesh.visible = false
    }
  }
}
