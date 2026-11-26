import * as THREE from 'three'
import type { WorldCollider } from './viceWorld'
import { hasLineOfSight } from './worldCollision'

export type GangFaction = 'allied' | 'syndicate' | 'cartel' | 'outlaws'

export type TurfZoneState = {
  id: string
  name: string
  faction: GangFaction
  originalFaction: GangFaction
  x: number
  z: number
  radius: number
  color: string
  reward: number
  warActive: boolean
  wave: number
  totalWaves: number
  remainingEnemies: number
  provokedKills: number
}

export type GangMapZone = {
  id: string
  name: string
  faction: GangFaction
  x: number
  z: number
  radius: number
  color: string
  warActive: boolean
}

export type AlliedTurfBenefits = {
  capturedCount: number
  totalDistricts: number
  passiveCashPerMin: number
  storeDiscountPct: number
  respectBonus: number
}

type GangNpc = {
  id: string
  zoneId: string
  faction: GangFaction
  recruited: boolean
  inVehicle: boolean
  root: THREE.Group
  leftLeg: THREE.Group
  rightLeg: THREE.Group
  leftArm: THREE.Group
  rightArm: THREE.Group
  hp: number
  maxHp: number
  down: number
  fireTimer: number
  phase: number
  anchorX: number
  anchorZ: number
  patrolAngle: number
  impulse: THREE.Vector3
}

const FACTION_COLORS: Record<GangFaction, { shirt: string; accent: string; map: string; label: string }> = {
  allied: { shirt: '#1d6b6d', accent: '#4af3e5', map: '#2ad6c9', label: 'VICE CREW (ALLIED)' },
  syndicate: { shirt: '#5b2b82', accent: '#c96eff', map: '#a94dff', label: 'NEON SYNDICATE' },
  cartel: { shirt: '#8b6318', accent: '#f7c548', map: '#f3b73f', label: 'PORT CARTEL' },
  outlaws: { shirt: '#7d2424', accent: '#ff5d55', map: '#e54747', label: 'WETLANDS OUTLAWS' },
}

const INITIAL_ZONES: Omit<TurfZoneState, 'warActive' | 'wave' | 'totalWaves' | 'remainingEnemies' | 'provokedKills'>[] = [
  { id: 'strip', name: 'Vice Bay Strip', faction: 'allied', originalFaction: 'allied', x: 0, z: 10, radius: 56, color: FACTION_COLORS.allied.map, reward: 0 },
  { id: 'downtown', name: 'Downtown Plaza', faction: 'syndicate', originalFaction: 'syndicate', x: -64, z: -108, radius: 60, color: FACTION_COLORS.syndicate.map, reward: 2200 },
  { id: 'port', name: 'Port Vice Docks', faction: 'cartel', originalFaction: 'cartel', x: -130, z: 112, radius: 64, color: FACTION_COLORS.cartel.map, reward: 2600 },
  { id: 'wetlands', name: 'Wetlands Outpost', faction: 'outlaws', originalFaction: 'outlaws', x: -208, z: -28, radius: 62, color: FACTION_COLORS.outlaws.map, reward: 3000 },
]

function angleDamp(from: number, to: number, speed: number, dt: number): number {
  const diff = Math.atan2(Math.sin(to - from), Math.cos(to - from))
  return from + diff * (1 - Math.exp(-speed * dt))
}

/**
 * Dynamic Neighborhood Gang Territory Warfare & Street Homie Squad System:
 * - 4 distinct districts with rival faction patrols and allied Vice Crew homies.
 * - Dropping 3 rival enforcers inside contested turf ignites a 3-wave Turf War.
 * - Clearing Wave 3 flips the district to Allied control, pays cash + Respect, and deploys allies.
 * - Pressing G/H recruits up to 1..6 loyal street homies (scaled by Respect) who follow, enter vehicles, and fight!
 */
export class GangTurfSystem {
  readonly group = new THREE.Group()
  readonly zones: TurfZoneState[] = []
  private readonly npcs: GangNpc[] = []
  private readonly boxGeo = new THREE.BoxGeometry(1, 1, 1)
  private readonly mats = new Map<string, THREE.MeshStandardMaterial>()
  private colliders: WorldCollider[] = []
  private idSeq = 0

  constructor(scene: THREE.Scene) {
    this.group.name = 'Gang turf actors'
    scene.add(this.group)
    this.reset()
  }

  reset(capturedZoneIds: string[] = []): void {
    for (const npc of this.npcs) this.group.remove(npc.root)
    this.npcs.length = 0
    this.zones.length = 0

    for (const base of INITIAL_ZONES) {
      const captured = base.id === 'strip' || capturedZoneIds.includes(base.id)
      const faction: GangFaction = captured ? 'allied' : base.originalFaction
      const zone: TurfZoneState = {
        ...base,
        faction,
        color: FACTION_COLORS[faction].map,
        warActive: false,
        wave: 0,
        totalWaves: 3,
        remainingEnemies: 0,
        provokedKills: 0,
      }
      this.zones.push(zone)
      this.populateZone(zone, faction === 'allied' ? 4 : 4)
    }
  }

  setWorldColliders(colliders: WorldCollider[]): void {
    this.colliders = colliders
  }

  get capturedIds(): string[] {
    return this.zones.filter(z => z.faction === 'allied' && z.originalFaction !== 'allied').map(z => z.id)
  }

  getAlliedBenefits(): AlliedTurfBenefits {
    const capturedCount = this.capturedIds.length
    const totalDistricts = Math.max(1, this.zones.filter(z => z.originalFaction !== 'allied').length)
    return {
      capturedCount,
      totalDistricts,
      passiveCashPerMin: capturedCount * 180,
      storeDiscountPct: capturedCount * 6,
      respectBonus: capturedCount * 4,
    }
  }

  getZoneAt(x: number, z: number): TurfZoneState | null {
    for (const zone of this.zones) {
      if (Math.hypot(x - zone.x, z - zone.z) <= zone.radius) return zone
    }
    return null
  }

  get activeWar(): TurfZoneState | null {
    return this.zones.find(z => z.warActive) ?? null
  }

  get recruitedCount(): number {
    return this.npcs.filter(n => n.recruited && n.down <= 0).length
  }

  getMapZones(): GangMapZone[] {
    return this.zones.map(z => ({
      id: z.id,
      name: z.name,
      faction: z.faction,
      x: z.x,
      z: z.z,
      radius: z.radius,
      color: FACTION_COLORS[z.faction].map,
      warActive: z.warActive,
    }))
  }

  getHomiePositions(): { x: number; z: number; recruited: boolean }[] {
    return this.npcs
      .filter(n => n.faction === 'allied' && n.down <= 0 && !n.inVehicle)
      .map(n => ({ x: n.root.position.x, z: n.root.position.z, recruited: n.recruited }))
  }

  getRivalPositions(): { x: number; z: number; color: string }[] {
    return this.npcs
      .filter(n => n.faction !== 'allied' && n.down <= 0)
      .map(n => ({ x: n.root.position.x, z: n.root.position.z, color: FACTION_COLORS[n.faction].map }))
  }

  /** Recruit nearby allied gang homies (G/H) up to maxHomies allowed by Respect. */
  recruitNearby(playerPos: THREE.Vector3, maxHomies: number): { recruitedNow: number; totalSquad: number; atCap: boolean } {
    const activeSquad = this.npcs.filter(n => n.recruited && n.down <= 0)
    if (activeSquad.length >= maxHomies) {
      return { recruitedNow: 0, totalSquad: activeSquad.length, atCap: true }
    }
    let recruitedNow = 0
    for (const npc of this.npcs) {
      if (npc.faction !== 'allied' || npc.recruited || npc.down > 0) continue
      const d = Math.hypot(npc.root.position.x - playerPos.x, npc.root.position.z - playerPos.z)
      if (d <= 20) {
        npc.recruited = true
        recruitedNow += 1
        if (activeSquad.length + recruitedNow >= maxHomies) break
      }
    }
    return { recruitedNow, totalSquad: activeSquad.length + recruitedNow, atCap: false }
  }

  dismissSquad(): void {
    for (const npc of this.npcs) {
      npc.recruited = false
      npc.inVehicle = false
      npc.root.visible = npc.down <= 0
    }
  }

  /** Ballistic hit detection against rival gangsters & non-allied enforcers. */
  shootBallistic(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    range: number,
    damage: number,
    armorPen: number,
  ): { hit: boolean; killed: boolean; critical: boolean; faction: GangFaction | null; point: THREE.Vector3; warStarted: TurfZoneState | null; capturedZone: TurfZoneState | null } {
    const len = direction.length()
    if (len < 1e-6 || range <= 0) {
      return { hit: false, killed: false, critical: false, faction: null, point: origin.clone(), warStarted: null, capturedZone: null }
    }
    const dir = direction.clone().multiplyScalar(1 / len)
    let nearest = range
    let hitNpc: GangNpc | null = null
    let zone: 'head' | 'torso' | 'limb' = 'torso'

    for (const npc of this.npcs) {
      if (npc.down > 0 || npc.faction === 'allied') continue
      for (const [h, r, z] of [[0.45, 0.34, 'limb'], [1.1, 0.5, 'torso'], [1.75, 0.32, 'head']] as const) {
        const x = npc.root.position.x - origin.x
        const y = npc.root.position.y + h - origin.y
        const zOff = npc.root.position.z - origin.z
        const proj = x * dir.x + y * dir.y + zOff * dir.z
        const perpSq = x * x + y * y + zOff * zOff - proj * proj
        if (perpSq > r * r) continue
        const halfChord = Math.sqrt(Math.max(0, r * r - perpSq))
        const entry = Math.max(0, proj - halfChord)
        if (proj + halfChord >= 0 && entry <= nearest) {
          nearest = entry
          hitNpc = npc
          zone = z
        }
      }
    }

    const point = origin.clone().addScaledVector(dir, nearest)
    if (!hitNpc) {
      return { hit: false, killed: false, critical: false, faction: null, point, warStarted: null, capturedZone: null }
    }

    const mult = zone === 'head' ? 2.4 : zone === 'limb' ? 0.72 : 1.0
    const dmg = damage * mult * (1 + armorPen * 0.15)
    hitNpc.hp = Math.max(0, hitNpc.hp - dmg)
    hitNpc.impulse.set(dir.x * 4.5, 0, dir.z * 4.5)
    const killed = hitNpc.hp <= 0
    let warStarted: TurfZoneState | null = null
    let capturedZone: TurfZoneState | null = null

    if (killed) {
      hitNpc.down = 18
      const outcome = this.handleEnemyKill(hitNpc)
      warStarted = outcome.warStarted
      capturedZone = outcome.capturedZone
    }
    return { hit: true, killed, critical: zone === 'head', faction: hitNpc.faction, point, warStarted, capturedZone }
  }

  /** Radial blast against rival gangsters (grenades / launcher). */
  explode(origin: THREE.Vector3, radius: number, damage: number): { kills: number; warStarted: TurfZoneState | null; capturedZone: TurfZoneState | null } {
    let kills = 0
    let warStarted: TurfZoneState | null = null
    let capturedZone: TurfZoneState | null = null
    for (const npc of this.npcs) {
      if (npc.down > 0 || npc.faction === 'allied') continue
      const d = Math.hypot(npc.root.position.x - origin.x, npc.root.position.z - origin.z)
      if (d > radius) continue
      const ratio = 1 - d / Math.max(1, radius)
      npc.hp = Math.max(0, npc.hp - damage * ratio)
      if (npc.hp <= 0) {
        npc.down = 18
        kills += 1
        const out = this.handleEnemyKill(npc)
        if (out.warStarted) warStarted = out.warStarted
        if (out.capturedZone) capturedZone = out.capturedZone
      }
    }
    return { kills, warStarted, capturedZone }
  }

  private handleEnemyKill(npc: GangNpc): { warStarted: TurfZoneState | null; capturedZone: TurfZoneState | null } {
    const zone = this.zones.find(z => z.id === npc.zoneId)
    if (!zone || zone.faction === 'allied') return { warStarted: null, capturedZone: null }

    if (!zone.warActive) {
      zone.provokedKills += 1
      if (zone.provokedKills >= 2) {
        zone.warActive = true
        zone.wave = 1
        zone.provokedKills = 0
        this.spawnWarWave(zone, 4)
        return { warStarted: zone, capturedZone: null }
      }
      return { warStarted: null, capturedZone: null }
    }

    zone.remainingEnemies = Math.max(0, this.aliveCountInZone(zone.id, zone.faction))
    if (zone.remainingEnemies === 0) {
      if (zone.wave < zone.totalWaves) {
        zone.wave += 1
        this.spawnWarWave(zone, 4 + zone.wave)
      } else {
        zone.warActive = false
        zone.wave = 0
        zone.faction = 'allied'
        zone.color = FACTION_COLORS.allied.map
        this.populateZone(zone, 4)
        return { warStarted: null, capturedZone: zone }
      }
    }
    return { warStarted: null, capturedZone: null }
  }

  private aliveCountInZone(zoneId: string, faction: GangFaction): number {
    return this.npcs.filter(n => n.zoneId === zoneId && n.faction === faction && n.down <= 0).length
  }

  private spawnWarWave(zone: TurfZoneState, count: number): void {
    const spawned = this.populateZone(zone, count)
    zone.remainingEnemies = this.aliveCountInZone(zone.id, zone.faction)
    if (spawned === 0) zone.remainingEnemies = this.aliveCountInZone(zone.id, zone.faction)
  }

  private populateZone(zone: TurfZoneState, count: number): number {
    let added = 0
    for (let i = 0; i < count; i += 1) {
      const angle = (i / Math.max(1, count)) * Math.PI * 2 + (zone.wave * 0.7)
      const dist = 12 + (i % 3) * 8
      const x = THREE.MathUtils.clamp(zone.x + Math.cos(angle) * dist, -365, 355)
      const z = THREE.MathUtils.clamp(zone.z + Math.sin(angle) * dist, -365, 355)
      this.npcs.push(this.makeNpc(zone.id, zone.faction, x, z, angle))
      added += 1
    }
    return added
  }

  private mat(color: string): THREE.MeshStandardMaterial {
    let m = this.mats.get(color)
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.82 })
      this.mats.set(color, m)
    }
    return m
  }

  private makeNpc(zoneId: string, faction: GangFaction, x: number, z: number, angle: number): GangNpc {
    const palette = FACTION_COLORS[faction]
    const root = new THREE.Group()
    root.position.set(x, 0.04, z)
    const addBox = (parent: THREE.Object3D, color: string, px: number, py: number, pz: number, sx: number, sy: number, sz: number) => {
      const m = new THREE.Mesh(this.boxGeo, this.mat(color))
      m.position.set(px, py, pz)
      m.scale.set(sx, sy, sz)
      m.castShadow = true
      m.receiveShadow = true
      parent.add(m)
      return m
    }
    addBox(root, palette.shirt, 0, 1.18, 0, 0.56, 0.72, 0.3)
    addBox(root, '#c88b64', 0, 1.76, 0, 0.38, 0.42, 0.36)
    // Gang bandana / headband
    addBox(root, palette.accent, 0, 1.88, 0, 0.4, 0.12, 0.39)

    const makeLimb = (lx: number, ly: number, color: string, len: number, w: number) => {
      const g = new THREE.Group()
      g.position.set(lx, ly, 0)
      addBox(g, color, 0, -len * 0.5, 0, w, len, w)
      root.add(g)
      return g
    }
    const leftLeg = makeLimb(-0.15, 0.82, '#1d222c', 0.78, 0.21)
    const rightLeg = makeLimb(0.15, 0.82, '#1d222c', 0.78, 0.21)
    const leftArm = makeLimb(-0.37, 1.44, palette.shirt, 0.62, 0.18)
    const rightArm = makeLimb(0.37, 1.44, palette.shirt, 0.62, 0.18)
    // Held firearm accent
    addBox(rightArm, '#1a1e24', 0, -0.58, 0.18, 0.09, 0.12, 0.38)

    this.group.add(root)
    const maxHp = faction === 'allied' ? 95 : 80
    return {
      id: `gang-${++this.idSeq}`,
      zoneId,
      faction,
      recruited: false,
      inVehicle: false,
      root,
      leftLeg,
      rightLeg,
      leftArm,
      rightArm,
      hp: maxHp,
      maxHp,
      down: 0,
      fireTimer: 0.9 + (this.idSeq % 4) * 0.35,
      phase: this.idSeq * 0.8,
      anchorX: x,
      anchorZ: z,
      patrolAngle: angle,
      impulse: new THREE.Vector3(),
    }
  }

  update(
    dt: number,
    playerPos: THREE.Vector3,
    playerHeading: number,
    inVehicle: boolean,
    wanted: number,
    policeBlips: { x: number; z: number }[],
  ): { playerDamage: number; homieEliminatedRival: TurfZoneState | null } {
    let playerDamage = 0
    let capturedZone: TurfZoneState | null = null
    let squadSlot = 0

    for (const npc of this.npcs) {
      npc.fireTimer = Math.max(0, npc.fireTimer - dt)
      if (npc.down > 0) {
        npc.down = Math.max(0, npc.down - dt)
        npc.root.rotation.x = THREE.MathUtils.damp(npc.root.rotation.x, Math.PI * 0.45, 8, dt)
        if (npc.down === 0) {
          const z = this.zones.find(item => item.id === npc.zoneId)
          if (z && z.warActive && npc.faction !== 'allied') {
            npc.root.visible = false
          } else {
            npc.hp = npc.maxHp
            npc.root.rotation.x = 0
            npc.root.visible = !npc.inVehicle
          }
        }
        continue
      }

      npc.root.rotation.x = 0
      npc.root.position.addScaledVector(npc.impulse, dt)
      npc.impulse.multiplyScalar(Math.exp(-5 * dt))

      if (npc.recruited) {
        if (inVehicle) {
          npc.inVehicle = true
          npc.root.visible = false
          npc.root.position.copy(playerPos)
          continue
        }
        if (npc.inVehicle && !inVehicle) {
          npc.inVehicle = false
          npc.root.visible = true
          const sideAngle = playerHeading + Math.PI * 0.5 + squadSlot * 0.8
          npc.root.position.set(playerPos.x + Math.sin(sideAngle) * 2.8, 0.04, playerPos.z + Math.cos(sideAngle) * 2.8)
        }

        // Follow player in squad formation
        const angle = playerHeading + Math.PI + (squadSlot - 1) * 0.65
        const desiredX = playerPos.x + Math.sin(angle) * (2.6 + Math.floor(squadSlot / 2) * 1.6)
        const desiredZ = playerPos.z + Math.cos(angle) * (2.6 + Math.floor(squadSlot / 2) * 1.6)
        squadSlot += 1
        const dx = desiredX - npc.root.position.x
        const dz = desiredZ - npc.root.position.z
        const dist = Math.hypot(dx, dz)
        if (dist > 28) {
          npc.root.position.set(desiredX, 0.04, desiredZ)
        } else if (dist > 1.3) {
          const speed = dist > 7 ? 6.4 : 4.1
          npc.root.position.x += (dx / dist) * speed * dt
          npc.root.position.z += (dz / dist) * speed * dt
          npc.root.rotation.y = angleDamp(npc.root.rotation.y, Math.atan2(dx, dz), 9, dt)
          npc.phase += dt * speed * 2.5
        }

        // Recruited homies fire on nearby rival gangsters or pursuing police
        let targetEnemy: GangNpc | null = null
        let bestDist = 26
        for (const other of this.npcs) {
          if (other.faction === 'allied' || other.down > 0) continue
          const d = Math.hypot(other.root.position.x - npc.root.position.x, other.root.position.z - npc.root.position.z)
          if (d < bestDist) {
            bestDist = d
            targetEnemy = other
          }
        }
        if (targetEnemy && npc.fireTimer <= 0) {
          npc.fireTimer = 1.15
          npc.root.rotation.y = Math.atan2(targetEnemy.root.position.x - npc.root.position.x, targetEnemy.root.position.z - npc.root.position.z)
          targetEnemy.hp = Math.max(0, targetEnemy.hp - 24)
          if (targetEnemy.hp <= 0) {
            targetEnemy.down = 18
            const out = this.handleEnemyKill(targetEnemy)
            if (out.capturedZone) capturedZone = out.capturedZone
          }
        } else if (wanted > 0 && npc.fireTimer <= 0 && policeBlips.length > 0) {
          const nearCop = policeBlips.find(c => Math.hypot(c.x - npc.root.position.x, c.z - npc.root.position.z) < 24)
          if (nearCop) {
            npc.fireTimer = 1.25
            npc.root.rotation.y = Math.atan2(nearCop.x - npc.root.position.x, nearCop.z - npc.root.position.z)
          }
        }
      } else if (npc.faction === 'allied') {
        // Patrol allied turf
        npc.patrolAngle += dt * 0.45
        const tx = npc.anchorX + Math.cos(npc.patrolAngle) * 3.5
        const tz = npc.anchorZ + Math.sin(npc.patrolAngle) * 3.5
        const dx = tx - npc.root.position.x
        const dz = tz - npc.root.position.z
        const dist = Math.hypot(dx, dz) || 1
        npc.root.position.x += (dx / dist) * 1.4 * dt
        npc.root.position.z += (dz / dist) * 1.4 * dt
        npc.root.rotation.y = angleDamp(npc.root.rotation.y, Math.atan2(dx, dz), 6, dt)
        npc.phase += dt * 3.5
      } else {
        // Rival gangsters: patrol until player enters war/combat range
        const zone = this.zones.find(z => z.id === npc.zoneId)
        const distToPlayer = Math.hypot(playerPos.x - npc.root.position.x, playerPos.z - npc.root.position.z)
        const hostile = Boolean(zone?.warActive) || distToPlayer < 14
        if (hostile && distToPlayer < 45) {
          const dx = playerPos.x - npc.root.position.x
          const dz = playerPos.z - npc.root.position.z
          npc.root.rotation.y = angleDamp(npc.root.rotation.y, Math.atan2(dx, dz), 7, dt)
          if (distToPlayer > 9) {
            npc.root.position.x += (dx / distToPlayer) * 3.1 * dt
            npc.root.position.z += (dz / distToPlayer) * 3.1 * dt
            npc.phase += dt * 7.5
          }
          if (npc.fireTimer <= 0 && distToPlayer < 25) {
            npc.fireTimer = 1.35 + (this.idSeq % 3) * 0.25
            const from = new THREE.Vector3(npc.root.position.x, 1.4, npc.root.position.z)
            const to = new THREE.Vector3(playerPos.x, playerPos.y + 1.2, playerPos.z)
            if (this.colliders.length === 0 || hasLineOfSight(from, to, this.colliders)) {
              playerDamage += 4.2
            }
          }
        } else {
          npc.patrolAngle += dt * 0.4
          const tx = npc.anchorX + Math.cos(npc.patrolAngle) * 4.5
          const tz = npc.anchorZ + Math.sin(npc.patrolAngle) * 4.5
          const dx = tx - npc.root.position.x
          const dz = tz - npc.root.position.z
          const dist = Math.hypot(dx, dz) || 1
          npc.root.position.x += (dx / dist) * 1.3 * dt
          npc.root.position.z += (dz / dist) * 1.3 * dt
          npc.root.rotation.y = angleDamp(npc.root.rotation.y, Math.atan2(dx, dz), 6, dt)
          npc.phase += dt * 3.2
        }
      }

      const swing = Math.sin(npc.phase) * 0.55
      npc.leftLeg.rotation.x = swing
      npc.rightLeg.rotation.x = -swing
      npc.leftArm.rotation.x = -swing * 0.6
      npc.rightArm.rotation.x = npc.fireTimer > 0.7 ? -1.45 : swing * 0.6
    }

    return { playerDamage, homieEliminatedRival: capturedZone }
  }
}
