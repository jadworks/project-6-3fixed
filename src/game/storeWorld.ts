import * as THREE from 'three'
import { createSignTexture } from './textures'
import { STORES_CATALOG, type StoreSpec } from './storesCatalog'
import type { ConductTier } from './gta6Systems'
import type { WorldCollider } from './viceWorld'

export type StoreStatus = 'open' | 'holdup_active' | 'alarm_locked' | 'robbed_cooldown'

export type StoreRuntimeState = {
  spec: StoreSpec
  root: THREE.Group
  worldCenter: THREE.Vector3
  registerWorldPos: THREE.Vector3
  safeWorldPos: THREE.Vector3
  cctvWorldPos: THREE.Vector3
  cctvMesh: THREE.Mesh
  cctvLedMesh: THREE.Mesh
  cctvActive: boolean
  displayCaseMeshes: THREE.Mesh[]
  casesBroken: number
  clerkGroup: THREE.Group
  clerkLeftArm: THREE.Object3D
  clerkRightArm: THREE.Object3D
  guardGroup: THREE.Group | null
  guardDown: boolean
  guardFireCooldown: number
  ringMesh: THREE.Mesh
  ringMat: THREE.MeshBasicMaterial
  holdupActive: boolean
  intimidation: number
  registerProgress: number
  registerRobbed: boolean
  safeProgress: number
  safeCracked: boolean
  alarmTriggered: boolean
  silentAlarmTimer: number
  robbedCooldown: number
}

export type StoreProximity = {
  store: StoreRuntimeState
  isInside: boolean
  nearCounter: boolean
  nearSafe: boolean
  distance: number
}

export type StoreStepEvent = {
  alarmTriggered?: StoreSpec
  registerCleared?: { spec: StoreSpec; cash: number }
  safeCracked?: { spec: StoreSpec; loot: number }
  guardDamagePlayer: number
  callout?: string
  holdupEnded?: boolean
}

const SHARED_CUBE = new THREE.BoxGeometry(1, 1, 1)
const SHARED_CYL = new THREE.CylinderGeometry(0.18, 0.2, 0.55, 10)
const SHARED_SPHERE = new THREE.SphereGeometry(0.2, 10, 8)
const SHARED_RING = new THREE.RingGeometry(1.15, 1.48, 28)

export function getStoreStatus(store: Pick<StoreRuntimeState, 'holdupActive' | 'alarmTriggered' | 'robbedCooldown'>): StoreStatus {
  if (store.holdupActive) return 'holdup_active'
  if (store.robbedCooldown > 0) return 'robbed_cooldown'
  if (store.alarmTriggered) return 'alarm_locked'
  return 'open'
}

export function getCooldownRemaining(store: Pick<StoreRuntimeState, 'robbedCooldown'>): number {
  return Math.max(0, Math.ceil(store.robbedCooldown))
}

/**
 * Renders and simulates all 20 walk-in, enterable, interactive, and robbable 3D stores
 * across Vice Bay Nights with shootable CCTV cameras, smashable display cases, clerk & guard AI,
 * holdup intimidation physics, and back-room safes.
 */
export class StoreWorld {
  readonly states: StoreRuntimeState[] = []
  readonly colliders: WorldCollider[] = []
  private readonly signMaterials = new Map<string, THREE.MeshBasicMaterial>()
  private readonly glassMat = new THREE.MeshStandardMaterial({
    color: '#9ee6f5',
    transparent: true,
    opacity: 0.45,
    roughness: 0.15,
    metalness: 0.25,
  })
  private readonly brokenGlassMat = new THREE.MeshStandardMaterial({
    color: '#3f565d',
    transparent: true,
    opacity: 0.18,
    roughness: 0.8,
  })
  private readonly darkMetalMat = new THREE.MeshStandardMaterial({ color: '#242b33', roughness: 0.5, metalness: 0.55 })
  private readonly safeMat = new THREE.MeshStandardMaterial({ color: '#394652', roughness: 0.4, metalness: 0.72 })
  private readonly registerMat = new THREE.MeshStandardMaterial({
    color: '#1b262d',
    emissive: '#3fe0b0',
    emissiveIntensity: 0.55,
    roughness: 0.35,
  })
  private readonly counterMat = new THREE.MeshStandardMaterial({ color: '#d7cdb8', roughness: 0.72 })
  private readonly floorMat = new THREE.MeshStandardMaterial({ color: '#cec6b6', roughness: 0.85 })
  private readonly roofMat = new THREE.MeshStandardMaterial({ color: '#e8e0cf', roughness: 0.82 })
  private readonly skinMat = new THREE.MeshStandardMaterial({ color: '#dca47e', roughness: 0.72 })
  private readonly guardMat = new THREE.MeshStandardMaterial({ color: '#263954', roughness: 0.75 })
  private time = 0

  constructor(private readonly scene: THREE.Scene) {
    for (const spec of STORES_CATALOG) {
      this.states.push(this.buildStore(spec))
    }
  }

  private buildStore(spec: StoreSpec): StoreRuntimeState {
    const root = new THREE.Group()
    root.name = `store:${spec.id}`
    root.position.set(spec.x, 0, spec.z)
    root.rotation.y = spec.facing

    const W = 10
    const D = 8
    const H = 4.4
    const thick = 0.42
    const wallMat = new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.78 })
    const accentMat = new THREE.MeshStandardMaterial({
      color: spec.accent,
      emissive: spec.accent,
      emissiveIntensity: 0.55,
      roughness: 0.35,
    })

    const addLocalBox = (
      mat: THREE.Material,
      lx: number,
      ly: number,
      lz: number,
      sx: number,
      sy: number,
      sz: number,
      cast = true,
    ): THREE.Mesh => {
      const m = new THREE.Mesh(SHARED_CUBE, mat)
      m.position.set(lx, ly, lz)
      m.scale.set(sx, sy, sz)
      m.castShadow = cast
      m.receiveShadow = true
      root.add(m)
      return m
    }

    // Interior tiled floor & flat slab roof
    addLocalBox(this.floorMat, 0, 0.04, 0, W - 0.1, 0.08, D - 0.1, false)
    addLocalBox(this.roofMat, 0, H + 0.18, 0, W + 0.6, 0.36, D + 0.6, true)

    // Walk-in open-doorway outer shell (3.2m front opening at local +Z)
    addLocalBox(wallMat, 0, H / 2, -D / 2 + thick / 2, W, H, thick) // Back
    addLocalBox(wallMat, -W / 2 + thick / 2, H / 2, 0, thick, H, D) // Left
    addLocalBox(wallMat, W / 2 - thick / 2, H / 2, 0, thick, H, D) // Right
    addLocalBox(wallMat, -3.3, H / 2, D / 2 - thick / 2, 3.4, H, thick) // Front-L
    addLocalBox(wallMat, 3.3, H / 2, D / 2 - thick / 2, 3.4, H, thick) // Front-R
    addLocalBox(wallMat, 0, H - 0.55, D / 2 - thick / 2, 3.2, 1.1, thick) // Door lintel

    // Neon trim & exterior store marquee sign above entrance (+Z face)
    addLocalBox(accentMat, 0, H - 0.1, D / 2 + 0.16, W * 0.92, 0.16, 0.12, false)
    let signMat = this.signMaterials.get(spec.id)
    if (!signMat) {
      signMat = new THREE.MeshBasicMaterial({
        map: createSignTexture(spec.name.toUpperCase().slice(0, 22), '#1b2c3b', '#fff4d8'),
        side: THREE.DoubleSide,
      })
      this.signMaterials.set(spec.id, signMat)
    }
    const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 1.65), signMat)
    signMesh.position.set(0, H + 0.55, D / 2 + 0.25)
    root.add(signMesh)

    // Register colliders in world coordinates matching rotationY = spec.facing
    const pushCollider = (lx: number, ly: number, lz: number, hw: number, hh: number, hd: number) => {
      const worldPt = new THREE.Vector3(lx, ly, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), spec.facing).add(root.position)
      this.colliders.push({
        center: worldPt,
        halfExtents: new THREE.Vector3(hw, hh, hd),
        rotationY: spec.facing,
        kind: 'building',
      })
    }
    pushCollider(0, H / 2, -D / 2 + thick / 2, W / 2, H / 2, thick / 2)
    pushCollider(-W / 2 + thick / 2, H / 2, 0, thick / 2, H / 2, D / 2)
    pushCollider(W / 2 - thick / 2, H / 2, 0, thick / 2, H / 2, D / 2)
    pushCollider(-3.3, H / 2, D / 2 - thick / 2, 1.7, H / 2, thick / 2)
    pushCollider(3.3, H / 2, D / 2 - thick / 2, 1.7, H / 2, thick / 2)

    // Interior service counter & cash register
    addLocalBox(this.counterMat, -1.3, 0.52, -1.6, 4.4, 1.04, 0.95)
    addLocalBox(this.registerMat, -0.4, 1.24, -1.55, 0.62, 0.36, 0.48)

    // Back-room steel safe (right-rear corner)
    addLocalBox(this.safeMat, 3.1, 0.72, -2.85, 1.1, 1.44, 0.95)
    addLocalBox(accentMat, 3.1, 0.86, -2.35, 0.28, 0.14, 0.06, false)

    // Shootable CCTV Camera + Red LED in upper front-left corner
    const cctvMesh = addLocalBox(this.darkMetalMat, -3.9, 3.55, 2.8, 0.38, 0.24, 0.55, false)
    const ledMat = new THREE.MeshBasicMaterial({ color: '#ff3248' })
    const cctvLedMesh = new THREE.Mesh(SHARED_CUBE, ledMat)
    cctvLedMesh.position.set(-3.9, 3.58, 2.48)
    cctvLedMesh.scale.set(0.14, 0.14, 0.14)
    root.add(cctvLedMesh)

    // Optional smashable glass display cases (weapons, jewelry, pawn, luxury)
    const displayCaseMeshes: THREE.Mesh[] = []
    if (spec.hasDisplayCases) {
      for (const cz of [0.3, 1.65]) {
        addLocalBox(this.counterMat, 2.35, 0.45, cz, 1.6, 0.9, 0.72)
        const glass = addLocalBox(this.glassMat, 2.35, 1.15, cz, 1.56, 0.52, 0.68, false)
        displayCaseMeshes.push(glass)
      }
    }

    // Store Clerk NPC behind counter
    const clerkGroup = new THREE.Group()
    clerkGroup.position.set(-1.3, 0, -2.65)
    const clerkTorso = new THREE.Mesh(SHARED_CUBE, wallMat)
    clerkTorso.position.y = 1.18
    clerkTorso.scale.set(0.48, 0.7, 0.28)
    const clerkHead = new THREE.Mesh(SHARED_SPHERE, this.skinMat)
    clerkHead.position.y = 1.74
    const clerkLeftArm = new THREE.Group()
    clerkLeftArm.position.set(-0.32, 1.44, 0)
    const lArmM = new THREE.Mesh(SHARED_CYL, this.skinMat)
    lArmM.position.y = -0.26
    clerkLeftArm.add(lArmM)
    const clerkRightArm = new THREE.Group()
    clerkRightArm.position.set(0.32, 1.44, 0)
    const rArmM = new THREE.Mesh(SHARED_CYL, this.skinMat)
    rArmM.position.y = -0.26
    clerkRightArm.add(rArmM)
    clerkGroup.add(clerkTorso, clerkHead, clerkLeftArm, clerkRightArm)
    root.add(clerkGroup)

    // Optional Armed Security Guard
    let guardGroup: THREE.Group | null = null
    if (spec.hasGuard) {
      guardGroup = new THREE.Group()
      guardGroup.position.set(2.4, 0, -0.45)
      const gTorso = new THREE.Mesh(SHARED_CUBE, this.guardMat)
      gTorso.position.y = 1.18
      gTorso.scale.set(0.54, 0.76, 0.32)
      const gHead = new THREE.Mesh(SHARED_SPHERE, this.skinMat)
      gHead.position.y = 1.78
      const gCap = new THREE.Mesh(SHARED_CUBE, this.darkMetalMat)
      gCap.position.set(0, 1.96, 0.04)
      gCap.scale.set(0.36, 0.14, 0.4)
      guardGroup.add(gTorso, gHead, gCap)
      root.add(guardGroup)
    }

    // Sidewalk doorway beacon ring
    const ringMat = new THREE.MeshBasicMaterial({
      color: '#74f3d8',
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.72,
    })
    const ringMesh = new THREE.Mesh(SHARED_RING, ringMat)
    ringMesh.rotation.x = -Math.PI / 2
    ringMesh.position.set(0, 0.14, D / 2 + 1.15)
    root.add(ringMesh)

    this.scene.add(root)
    root.updateMatrixWorld(true)

    const toWorld = (lx: number, ly: number, lz: number) =>
      new THREE.Vector3(lx, ly, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), spec.facing).add(root.position)

    return {
      spec,
      root,
      worldCenter: root.position.clone(),
      registerWorldPos: toWorld(-0.4, 1.1, -1.55),
      safeWorldPos: toWorld(3.1, 0.9, -2.5),
      cctvWorldPos: toWorld(-3.9, 3.55, 2.8),
      cctvMesh,
      cctvLedMesh,
      cctvActive: true,
      displayCaseMeshes,
      casesBroken: 0,
      clerkGroup,
      clerkLeftArm,
      clerkRightArm,
      guardGroup,
      guardDown: !spec.hasGuard,
      guardFireCooldown: 0.9,
      ringMesh,
      ringMat,
      holdupActive: false,
      intimidation: 0,
      registerProgress: 0,
      registerRobbed: false,
      safeProgress: 0,
      safeCracked: false,
      alarmTriggered: false,
      silentAlarmTimer: 0,
      robbedCooldown: 0,
    }
  }

  findNearestInteractable(pos: THREE.Vector3, maxDist = 5.4): StoreProximity | null {
    let best: StoreProximity | null = null
    let bestDist = Infinity
    for (const s of this.states) {
      // Transform player position into store local space to accurately check interior footprint
      const dx = pos.x - s.worldCenter.x
      const dz = pos.z - s.worldCenter.z
      const distCenter = Math.hypot(dx, dz)
      if (distCenter > 10.5) continue
      const c = Math.cos(-s.spec.facing)
      const sAng = Math.sin(-s.spec.facing)
      const lx = dx * c - dz * sAng
      const lz = dx * sAng + dz * c
      const isInside = Math.abs(lx) < 4.7 && Math.abs(lz) < 3.7
      const nearDoor = Math.abs(lx) < 2.8 && lz >= 2.2 && lz <= 6.2
      if (!isInside && !nearDoor && distCenter > maxDist) continue
      const nearCounter = Math.hypot(pos.x - s.registerWorldPos.x, pos.z - s.registerWorldPos.z) < 4.2
      const nearSafe = Math.hypot(pos.x - s.safeWorldPos.x, pos.z - s.safeWorldPos.z) < 3.0
      if (distCenter < bestDist) {
        bestDist = distCenter
        best = { store: s, isInside, nearCounter, nearSafe, distance: distCenter }
      }
    }
    return best
  }

  /** Ray-checks active CCTV cameras & smashable glass display cases for gunplay interactivity. */
  shootTarget(origin: THREE.Vector3, direction: THREE.Vector3, maxRange = 40): {
    hitCctv: StoreRuntimeState | null
    smashedCaseStore: StoreRuntimeState | null
    lootGained: number
  } {
    const tmp = new THREE.Vector3()
    for (const s of this.states) {
      if (origin.distanceToSquared(s.worldCenter) > 48 * 48) continue
      if (s.cctvActive) {
        tmp.copy(s.cctvWorldPos).sub(origin)
        const proj = tmp.dot(direction)
        if (proj > 0 && proj < maxRange) {
          const perpSq = tmp.lengthSq() - proj * proj
          if (perpSq <= 0.42 * 0.42) {
            s.cctvActive = false
            s.cctvLedMesh.visible = false
            s.cctvMesh.rotation.z = 0.65
            return { hitCctv: s, smashedCaseStore: null, lootGained: 0 }
          }
        }
      }
      if (s.casesBroken < s.displayCaseMeshes.length) {
        const caseMesh = s.displayCaseMeshes[s.casesBroken]
        const worldPos = new THREE.Vector3()
        caseMesh.getWorldPosition(worldPos)
        tmp.copy(worldPos).sub(origin)
        const proj = tmp.dot(direction)
        if (proj > 0 && proj < maxRange) {
          const perpSq = tmp.lengthSq() - proj * proj
          if (perpSq <= 0.82 * 0.82) {
            caseMesh.material = this.brokenGlassMat
            caseMesh.scale.y = 0.14
            caseMesh.position.y = 0.96
            s.casesBroken += 1
            return { hitCctv: null, smashedCaseStore: s, lootGained: 380 }
          }
        }
      }
    }
    return { hitCctv: null, smashedCaseStore: null, lootGained: 0 }
  }

  startHoldup(store: StoreRuntimeState): boolean {
    if (store.robbedCooldown > 0) return false
    store.holdupActive = true
    store.intimidation = Math.max(store.intimidation, 48)
    store.silentAlarmTimer = store.spec.hasSilentAlarm && store.cctvActive ? 8.5 : 0
    return true
  }

  triggerSafeCrackStep(store: StoreRuntimeState, dt: number, boost = 1): { crackedNow: boolean; loot: number } {
    if (store.safeCracked) return { crackedNow: false, loot: 0 }
    store.safeProgress = Math.min(1, store.safeProgress + dt * 0.28 * boost)
    if (store.safeProgress >= 1) {
      store.safeCracked = true
      store.robbedCooldown = Math.max(store.robbedCooldown, 95)
      return { crackedNow: true, loot: store.spec.safeLoot }
    }
    return { crackedNow: false, loot: 0 }
  }

  getActiveHoldup(): StoreRuntimeState | null {
    return this.states.find(s => s.holdupActive) ?? null
  }

  getStatus(store: StoreRuntimeState): StoreStatus {
    return getStoreStatus(store)
  }

  getRemainingCooldown(store: StoreRuntimeState): number {
    return getCooldownRemaining(store)
  }

  update(
    dt: number,
    playerPos: THREE.Vector3,
    opts: {
      aiming: boolean
      weaponHot: boolean
      partnerCovering: boolean
      bondBoost: number
      tattooCount: number
      conductTier: ConductTier
    },
  ): StoreStepEvent {
    this.time += dt
    const out: StoreStepEvent = { guardDamagePlayer: 0 }

    for (const s of this.states) {
      if (s.robbedCooldown > 0) {
        s.robbedCooldown = Math.max(0, s.robbedCooldown - dt)
        if (s.robbedCooldown === 0) {
          s.registerRobbed = false
          s.registerProgress = 0
          s.safeCracked = false
          s.safeProgress = 0
          s.alarmTriggered = false
          s.casesBroken = 0
          s.displayCaseMeshes.forEach(m => {
            m.material = this.glassMat
            m.scale.y = 0.52
            m.position.y = 1.15
          })
          s.cctvActive = true
          s.cctvMesh.rotation.z = 0
          if (s.guardGroup) {
            s.guardDown = false
            s.guardGroup.rotation.x = 0
          }
        }
      }

      // CCTV red LED blink
      if (s.cctvActive) {
        s.cctvLedMesh.visible = Math.floor(this.time * 2.2) % 2 === 0
      }

      const dist = Math.hypot(playerPos.x - s.worldCenter.x, playerPos.z - s.worldCenter.z)
      const inRange = dist < 9.5

      if (s.holdupActive) {
        if (!inRange) {
          s.holdupActive = false
          out.holdupEnded = true
          continue
        }
        // Intimidation rises when aiming/hot weapon/partner covering/tattoos/conduct
        const tattooBonus = Math.min(14, opts.tattooCount * 4.5)
        const conductBonus = opts.conductTier === 'Violent' || opts.conductTier === 'Psycho' || opts.conductTier === 'Irredeemable' ? 12 : 4
        const rate = (opts.aiming ? 26 : opts.weaponHot ? 14 : -11) + (opts.partnerCovering ? 18 : 0) + (tattooBonus + conductBonus) * 0.35
        s.intimidation = THREE.MathUtils.clamp(s.intimidation + rate * dt, 0, 100)

        // Clerk arms raise & crouches behind counter under extreme intimidation or alarm
        const targetArmX = s.alarmTriggered || s.intimidation > 78 ? -2.2 : -2.75
        const targetClerkY = s.alarmTriggered || s.intimidation > 78 ? -0.34 : 0
        s.clerkLeftArm.rotation.x = THREE.MathUtils.damp(s.clerkLeftArm.rotation.x, targetArmX, 8, dt)
        s.clerkRightArm.rotation.x = THREE.MathUtils.damp(s.clerkRightArm.rotation.x, targetArmX, 8, dt)
        s.clerkGroup.position.y = THREE.MathUtils.damp(s.clerkGroup.position.y, targetClerkY, 6, dt)

        // Silent alarm logic (prevented if CCTV is shot or player maintains high intimidation & partner covers)
        if (s.spec.hasSilentAlarm && s.cctvActive && !s.alarmTriggered) {
          s.silentAlarmTimer -= dt * (s.intimidation > 75 ? 0.35 : 1.1)
          if (s.silentAlarmTimer <= 0) {
            s.alarmTriggered = true
            out.alarmTriggered = s.spec
            out.callout = `${s.spec.name}: SILENT ALARM TRIPPED!`
          }
        }

        // Register siphon progress while inside counter zone or high intimidation
        if (!s.registerRobbed && s.intimidation >= 28) {
          const speed = (0.18 + (s.intimidation / 100) * 0.25) * (1 + opts.bondBoost) * (opts.partnerCovering ? 1.35 : 1)
          s.registerProgress = Math.min(1, s.registerProgress + dt * speed)
          if (s.registerProgress >= 1) {
            s.registerRobbed = true
            s.robbedCooldown = Math.max(s.robbedCooldown, 95)
            out.registerCleared = { spec: s.spec, cash: s.spec.registerReward }
          }
        }

        // Guard alert turn & counter-fire if active, not neutralized, and intimidation drops or alarm triggered
        if (s.guardGroup && !s.guardDown) {
          const guardWorld = new THREE.Vector3()
          s.guardGroup.getWorldPosition(guardWorld)
          const lookAngle = Math.atan2(playerPos.x - guardWorld.x, playerPos.z - guardWorld.z) - s.spec.facing
          s.guardGroup.rotation.y = THREE.MathUtils.damp(s.guardGroup.rotation.y, lookAngle, 6, dt)
          if (s.alarmTriggered || s.intimidation < 40) {
            s.guardFireCooldown -= dt
            if (s.guardFireCooldown <= 0) {
              s.guardFireCooldown = 1.05
              out.guardDamagePlayer += 9
            }
          }
        }

        s.ringMat.color.set('#ff5c72')
      } else {
        const cowerY = s.alarmTriggered && s.robbedCooldown > 0 ? -0.25 : 0
        s.clerkLeftArm.rotation.x = THREE.MathUtils.damp(s.clerkLeftArm.rotation.x, 0, 6, dt)
        s.clerkRightArm.rotation.x = THREE.MathUtils.damp(s.clerkRightArm.rotation.x, 0, 6, dt)
        s.clerkGroup.position.y = THREE.MathUtils.damp(s.clerkGroup.position.y, cowerY, 5, dt)
        if (s.guardGroup && !s.guardDown) {
          s.guardGroup.position.z = -0.45 + Math.sin(this.time * 0.9 + s.spec.x * 0.1) * 0.85
        }
        s.ringMat.color.set(s.robbedCooldown > 0 ? '#6e7b86' : s.alarmTriggered ? '#ffb84d' : '#74f3d8')
      }
    }

    return out
  }

  neutralizeNearestGuard(pos: THREE.Vector3, maxDist = 11): boolean {
    for (const s of this.states) {
      if (!s.guardGroup || s.guardDown) continue
      const worldG = new THREE.Vector3()
      s.guardGroup.getWorldPosition(worldG)
      if (worldG.distanceTo(pos) <= maxDist) {
        s.guardDown = true
        s.guardGroup.rotation.x = -Math.PI / 2
        return true
      }
    }
    return false
  }
}
