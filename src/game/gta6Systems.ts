import * as THREE from 'three'
import type { WorldCollider } from './viceWorld'

export type ProtagonistId = 'jason' | 'lucia'

export type ConductTier = 'Professional' | 'Aggressive' | 'Violent' | 'Psycho' | 'Irredeemable'

export type NpcDialogueTone = 'greet' | 'antagonize' | 'threaten' | 'defuse'

export type NpcDialogueResult = {
  tone: NpcDialogueTone
  npcLine: string
  conductDelta: number
  cashGained: number
  cancelledWitness: boolean
  startedWitness: boolean
  callout: string
}

export type HotCrimeZone = {
  id: string
  label: string
  x: number
  z: number
  radius: number
  expiresAt: number
  loggedOutfitId: string
  loggedPlate: string | null
  retriggered: boolean
}

export const LOADOUT_LIMITS = {
  maxHandguns: 2,
  maxLongGuns: 2,
}

export const DEFAULT_LOADOUT_SLOTS = {
  handguns: ['pistol', 'revolver'],
  longGuns: ['carbine', 'pump_shotgun'],
}

export function getConductTier(score: number): ConductTier {
  if (score >= 30) return 'Professional'
  if (score >= 0) return 'Aggressive'
  if (score >= -35) return 'Violent'
  if (score >= -70) return 'Psycho'
  return 'Irredeemable'
}

export function bondBonusMultipliers(bond: number): {
  reloadBoost: number
  robberySpeedBoost: number
  damageBoost: number
} {
  const norm = Math.max(0, Math.min(1, bond / 100))
  return {
    reloadBoost: norm * 0.25,
    robberySpeedBoost: norm * 0.4,
    damageBoost: norm * 0.2,
  }
}

export function resolveNpcDialogue(
  tone: NpcDialogueTone,
  opts: { masked: boolean; armed: boolean; conductScore: number; witnessActive: boolean },
): NpcDialogueResult {
  if (tone === 'greet') {
    return {
      tone,
      npcLine: opts.masked
        ? '"Uh... nice bandana, I guess. Keep walking."'
        : '"Hey! Good evening out on Ocean Drive."',
      conductDelta: 1,
      cashGained: 0,
      cancelledWitness: false,
      startedWitness: false,
      callout: 'Friendly greeting (+Professional)',
    }
  }
  if (tone === 'defuse') {
    const calmed = opts.witnessActive || Math.random() < 0.78
    return {
      tone,
      npcLine: calmed
        ? '"Alright, alright! No trouble — I’m putting the phone away."'
        : '"Back off! You’re still making me nervous!"',
      conductDelta: 3,
      cashGained: 0,
      cancelledWitness: calmed && opts.witnessActive,
      startedWitness: false,
      callout: calmed ? 'Situation defused (+Professional)' : 'Defuse failed',
    }
  }
  if (tone === 'antagonize') {
    const startles = !opts.armed && Math.random() < 0.35
    return {
      tone,
      npcLine: '"Who the hell do you think you’re talking to?!"',
      conductDelta: -4,
      cashGained: 0,
      cancelledWitness: false,
      startedWitness: startles,
      callout: startles ? 'NPC provoked & calling 911!' : 'NPC antagonized (-Conduct)',
    }
  }
  // 'threaten' (Holdup / Mug)
  const dropCash = opts.armed ? 45 + Math.floor(Math.random() * 75) : 15 + Math.floor(Math.random() * 25)
  return {
    tone,
    npcLine: opts.armed
      ? `"Don't shoot! Take my $${dropCash} and leave!"`
      : `"Hey! Take $${dropCash}, just keep moving!"`,
    conductDelta: -6,
    cashGained: dropCash,
    cancelledWitness: opts.witnessActive,
    startedWitness: !opts.armed,
    callout: `MUGGED NPC +$${dropCash}`,
  }
}

export function isHandgunWeapon(category: string): boolean {
  return category === 'handgun'
}

export function isLongGunWeapon(category: string): boolean {
  return category === 'smg' || category === 'shotgun' || category === 'rifle' || category === 'precision' || category === 'heavy'
}

/**
 * Dual Protagonist & Partner Wingman AI Rig + Tactical Focus Gauge + Hot Crime Zones.
 */
export class PartnerWingman {
  readonly root = new THREE.Group()
  private readonly torsoMesh: THREE.Mesh
  private readonly headMesh: THREE.Mesh
  private readonly hairMesh: THREE.Mesh
  private readonly leftArm: THREE.Group
  private readonly rightArm: THREE.Group
  private readonly leftLeg: THREE.Group
  private readonly rightLeg: THREE.Group
  private readonly weaponProp: THREE.Mesh
  private readonly labelRing: THREE.Mesh
  private readonly shirtMat = new THREE.MeshStandardMaterial({ color: '#e6638f', roughness: 0.75 })
  private readonly pantsMat = new THREE.MeshStandardMaterial({ color: '#27384f', roughness: 0.82 })
  private readonly skinMat = new THREE.MeshStandardMaterial({ color: '#d99a74', roughness: 0.72 })
  private readonly hairMat = new THREE.MeshStandardMaterial({ color: '#2b1f1c', roughness: 0.8 })

  active = false
  ridingShotgun = false
  phase = 0
  fireCooldown = 0
  calloutTimer = 0
  readonly velocity = new THREE.Vector3()

  constructor(scene: THREE.Scene) {
    this.root.name = 'partner-wingman'
    this.root.visible = false

    this.torsoMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.72, 0.28), this.shirtMat)
    this.torsoMesh.position.y = 1.18
    this.torsoMesh.castShadow = true

    this.headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.21, 10, 8), this.skinMat)
    this.headMesh.position.y = 1.78
    this.headMesh.castShadow = true

    this.hairMesh = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.2, 0.4), this.hairMat)
    this.hairMesh.position.set(0, 1.94, -0.02)

    const makeLimb = (x: number, y: number, w: number, len: number, mat: THREE.Material) => {
      const joint = new THREE.Group()
      joint.position.set(x, y, 0)
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, len, w), mat)
      mesh.position.y = -len / 2
      mesh.castShadow = true
      joint.add(mesh)
      return joint
    }
    this.leftLeg = makeLimb(-0.14, 0.82, 0.19, 0.78, this.pantsMat)
    this.rightLeg = makeLimb(0.14, 0.82, 0.19, 0.78, this.pantsMat)
    this.leftArm = makeLimb(-0.34, 1.44, 0.16, 0.62, this.shirtMat)
    this.rightArm = makeLimb(0.34, 1.44, 0.16, 0.62, this.shirtMat)

    this.weaponProp = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.12, 0.56),
      new THREE.MeshStandardMaterial({ color: '#1b2028', metalness: 0.6, roughness: 0.35 }),
    )
    this.weaponProp.position.set(0, -0.58, 0.26)
    this.rightArm.add(this.weaponProp)

    this.labelRing = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.52, 20),
      new THREE.MeshBasicMaterial({ color: '#ff6ba8', side: THREE.DoubleSide, transparent: true, opacity: 0.72 }),
    )
    this.labelRing.rotation.x = -Math.PI / 2
    this.labelRing.position.y = 0.04

    this.root.add(
      this.torsoMesh,
      this.headMesh,
      this.hairMesh,
      this.leftLeg,
      this.rightLeg,
      this.leftArm,
      this.rightArm,
      this.labelRing,
    )
    scene.add(this.root)
  }

  /** Sync partner look to whichever protagonist is currently NOT controlled by player. */
  syncIdentity(activeLead: ProtagonistId): void {
    const partnerIsLucia = activeLead === 'jason'
    if (partnerIsLucia) {
      this.shirtMat.color.set('#e65c8e')
      this.pantsMat.color.set('#283c54')
      this.skinMat.color.set('#d59772')
      this.hairMat.color.set('#231817')
      this.hairMesh.scale.set(1.06, 1.3, 1.12)
      this.torsoMesh.scale.set(0.88, 0.98, 0.92)
    } else {
      this.shirtMat.color.set('#4eb4bf')
      this.pantsMat.color.set('#313e4b')
      this.skinMat.color.set('#e5b08b')
      this.hairMat.color.set('#3f2c22')
      this.hairMesh.scale.set(0.98, 0.82, 0.96)
      this.torsoMesh.scale.set(1.04, 1.02, 1.02)
    }
  }

  toggle(playerPos: THREE.Vector3, activeLead: ProtagonistId): boolean {
    this.active = !this.active
    this.syncIdentity(activeLead)
    if (this.active) {
      this.root.position.set(playerPos.x + 1.8, playerPos.y, playerPos.z + 1.4)
      this.root.visible = true
      this.ridingShotgun = false
      this.calloutTimer = 2.0
    } else {
      this.root.visible = false
      this.ridingShotgun = false
    }
    return this.active
  }

  dismiss(): void {
    this.active = false
    this.ridingShotgun = false
    this.root.visible = false
  }

  update(
    dt: number,
    playerPos: THREE.Vector3,
    playerYaw: number,
    inVehicle: boolean,
    vehicleHeading: number,
    inHoldup: boolean,
    nearestThreatPos: THREE.Vector3 | null,
    colliders: WorldCollider[],
  ): { firedAtThreat: boolean } {
    if (!this.active) return { firedAtThreat: false }
    this.fireCooldown = Math.max(0, this.fireCooldown - dt)
    this.calloutTimer = Math.max(0, this.calloutTimer - dt)
    let firedAtThreat = false

    if (inVehicle) {
      // Ride shotgun leaning out window if chasing/threatened
      this.ridingShotgun = true
      this.root.visible = true
      const rightX = Math.cos(vehicleHeading)
      const rightZ = -Math.sin(vehicleHeading)
      const fwdX = -Math.sin(vehicleHeading)
      const fwdZ = -Math.cos(vehicleHeading)
      this.root.position.set(
        playerPos.x + rightX * 0.62 - fwdX * 0.15,
        playerPos.y + 0.52,
        playerPos.z + rightZ * 0.62 - fwdZ * 0.15,
      )
      this.root.rotation.y = vehicleHeading
      this.leftLeg.rotation.x = -1.1
      this.rightLeg.rotation.x = -1.1
      if (nearestThreatPos) {
        this.rightArm.rotation.x = -1.45
        if (this.fireCooldown <= 0) {
          this.fireCooldown = 0.68
          firedAtThreat = true
        }
      } else {
        this.rightArm.rotation.x = 0.1
      }
      return { firedAtThreat }
    }

    this.ridingShotgun = false
    this.root.visible = true
    const followX = playerPos.x + Math.cos(playerYaw) * 1.9 + Math.sin(playerYaw) * 1.2
    const followZ = playerPos.z - Math.sin(playerYaw) * 1.9 + Math.cos(playerYaw) * 1.2
    const dx = followX - this.root.position.x
    const dz = followZ - this.root.position.z
    const dist = Math.hypot(dx, dz)

    if (dist > 28) {
      this.root.position.set(followX, playerPos.y, followZ)
    } else if (dist > 1.3) {
      const spd = dist > 7 ? 7.2 : 4.2
      const step = Math.min(dist, spd * dt)
      this.root.position.x += (dx / dist) * step
      this.root.position.z += (dz / dist) * step
      this.root.position.y = playerPos.y
      this.phase += dt * spd * 2.4
      const swing = Math.sin(this.phase) * 0.6
      this.leftLeg.rotation.x = swing
      this.rightLeg.rotation.x = -swing
      this.leftArm.rotation.x = -swing * 0.6
    } else {
      this.leftLeg.rotation.x = 0
      this.rightLeg.rotation.x = 0
    }

    // Simple obstacle slide
    for (const col of colliders) {
      if (Math.abs(col.center.x - this.root.position.x) > col.halfExtents.x + 0.6) continue
      if (Math.abs(col.center.z - this.root.position.z) > col.halfExtents.z + 0.6) continue
      const ox = this.root.position.x - col.center.x
      const oz = this.root.position.z - col.center.z
      if (Math.abs(ox) < col.halfExtents.x + 0.42 && Math.abs(oz) < col.halfExtents.z + 0.42) {
        const px = col.halfExtents.x + 0.42 - Math.abs(ox)
        const pz = col.halfExtents.z + 0.42 - Math.abs(oz)
        if (px < pz) this.root.position.x += Math.sign(ox || 1) * px
        else this.root.position.z += Math.sign(oz || 1) * pz
      }
    }

    if (nearestThreatPos) {
      const aimAngle = Math.atan2(nearestThreatPos.x - this.root.position.x, nearestThreatPos.z - this.root.position.z)
      this.root.rotation.y = aimAngle
      this.rightArm.rotation.x = -1.52
      if (this.fireCooldown <= 0) {
        this.fireCooldown = 0.58
        firedAtThreat = true
      }
    } else if (inHoldup) {
      this.root.rotation.y = playerYaw + Math.PI
      this.rightArm.rotation.x = -1.48
      this.leftArm.rotation.x = -0.7
    } else if (dist > 1.3) {
      this.root.rotation.y = Math.atan2(dx, dz)
      this.rightArm.rotation.x = Math.sin(this.phase) * 0.45
    } else {
      this.rightArm.rotation.x = 0
    }

    return { firedAtThreat }
  }
}

/**
 * Tracks temporary Hot Crime Zones after major crimes + APB outfit/plate re-identification.
 */
export class HotZoneTracker {
  readonly zones: HotCrimeZone[] = []

  addZone(opts: {
    id: string
    label: string
    x: number
    z: number
    radius?: number
    durationSec?: number
    loggedOutfitId: string
    loggedPlate: string | null
  }): HotCrimeZone {
    const existing = this.zones.find(z => Math.hypot(z.x - opts.x, z.z - opts.z) < 28)
    const zone: HotCrimeZone = {
      id: opts.id,
      label: opts.label,
      x: opts.x,
      z: opts.z,
      radius: opts.radius ?? 46,
      expiresAt: Date.now() + (opts.durationSec ?? 75) * 1000,
      loggedOutfitId: opts.loggedOutfitId,
      loggedPlate: opts.loggedPlate,
      retriggered: false,
    }
    if (existing) {
      Object.assign(existing, zone)
      return existing
    }
    this.zones.push(zone)
    if (this.zones.length > 6) this.zones.shift()
    return zone
  }

  prune(now = Date.now()): void {
    for (let i = this.zones.length - 1; i >= 0; i -= 1) {
      if (this.zones[i].expiresAt <= now) this.zones.splice(i, 1)
    }
  }

  checkReentry(
    pos: { x: number; z: number },
    currentOutfitId: string,
    currentPlate: string | null,
    masked: boolean,
    now = Date.now(),
  ): { inHotZone: boolean; triggeredApb: boolean; zoneLabel: string | null } {
    this.prune(now)
    for (const z of this.zones) {
      const dist = Math.hypot(pos.x - z.x, pos.z - z.z)
      if (dist <= z.radius) {
        const sameOutfit = !masked && currentOutfitId === z.loggedOutfitId
        const samePlate = currentPlate !== null && z.loggedPlate !== null && currentPlate === z.loggedPlate
        if ((sameOutfit || samePlate) && !z.retriggered) {
          z.retriggered = true
          return { inHotZone: true, triggeredApb: true, zoneLabel: z.label }
        }
        return { inHotZone: true, triggeredApb: false, zoneLabel: z.label }
      }
    }
    return { inHotZone: false, triggeredApb: false, zoneLabel: null }
  }
}
