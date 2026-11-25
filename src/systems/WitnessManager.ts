import * as THREE from 'three'
import type { WorldCollider } from '../game/viceWorld'
import { hasLineOfSight } from '../game/worldCollision'

export type WitnessAiState = 'calm' | 'shocked' | 'fleeing' | 'reporting' | 'intimidated' | 'down'
export type WitnessCancelReason = 'intimidated' | 'down' | 'escaped'

export type WitnessObservation = {
  sawFace: boolean
  outfitId: string | null
  weaponClass: string | null
  vehicleModel: string | null
  vehicleColor: string | null
  vehiclePlate: string | null
}

export type WitnessActor = {
  id: string
  position: THREE.Vector3
  active: boolean
  down: number
  state: WitnessAiState
  shockTimer: number
  reportTimer: number
  reportSeverity: number
  lostLosTimer: number
  observation: WitnessObservation
}

export type WitnessStartedEvent = {
  witnessId: string
  x: number
  z: number
  severity: number
}

export type WitnessDispatchEvent = {
  witnessId: string
  x: number
  z: number
  severity: number
  code: string
  message: string
  observation: WitnessObservation
}

export type WitnessCancelEvent = {
  witnessId: string
  reason: WitnessCancelReason
}

type WitnessEventPayloads = {
  started: WitnessStartedEvent
  dispatch: WitnessDispatchEvent
  cancelled: WitnessCancelEvent
}

export type WitnessEventName = keyof WitnessEventPayloads
export type WitnessListener<K extends WitnessEventName> = (payload: WitnessEventPayloads[K]) => void

export const WITNESS_RADIUS = 45
export const WITNESS_CALL_SECONDS = 3.5

const DEFAULT_OBSERVATION: WitnessObservation = {
  sawFace: false,
  outfitId: null,
  weaponClass: null,
  vehicleModel: null,
  vehicleColor: null,
  vehiclePlate: null,
}

/**
 * Manages civilian crime observation within a 45-meter line-of-sight radius,
 * the 3.5-second 'calling 911' state machine, suspect sighting metadata,
 * tactical counterplay cancellations, and typed event emitters for dispatch alerts.
 */
export class WitnessManager {
  readonly radius: number
  readonly callDuration: number
  private readonly actors = new Map<string, WitnessActor>()
  private readonly listeners: { [K in WitnessEventName]: Set<WitnessListener<K>> } = {
    started: new Set(),
    dispatch: new Set(),
    cancelled: new Set(),
  }
  private colliders: WorldCollider[] = []
  private readonly tmpFrom = new THREE.Vector3()
  private readonly tmpTo = new THREE.Vector3()

  constructor(radius = WITNESS_RADIUS, callDuration = WITNESS_CALL_SECONDS) {
    this.radius = radius
    this.callDuration = callDuration
  }

  setWorldColliders(colliders: WorldCollider[]): void {
    this.colliders = colliders
  }

  on<K extends WitnessEventName>(event: K, listener: WitnessListener<K>): () => void {
    this.listeners[event].add(listener)
    return () => this.off(event, listener)
  }

  off<K extends WitnessEventName>(event: K, listener: WitnessListener<K>): void {
    this.listeners[event].delete(listener)
  }

  private emit<K extends WitnessEventName>(event: K, payload: WitnessEventPayloads[K]): void {
    for (const listener of this.listeners[event]) {
      listener(payload)
    }
  }

  registerNpc(id: string, position: THREE.Vector3, active = true): WitnessActor {
    let actor = this.actors.get(id)
    if (!actor) {
      actor = {
        id,
        position: position.clone(),
        active,
        down: 0,
        state: 'calm',
        shockTimer: 0,
        reportTimer: 0,
        reportSeverity: 1,
        lostLosTimer: 0,
        observation: { ...DEFAULT_OBSERVATION },
      }
      this.actors.set(id, actor)
    } else {
      actor.position.copy(position)
      actor.active = active
    }
    return actor
  }

  syncActorPose(id: string, position: THREE.Vector3, active: boolean, down: number): void {
    const actor = this.actors.get(id)
    if (!actor) return
    actor.position.copy(position)
    actor.active = active
    actor.down = down
  }

  getActor(id: string): WitnessActor | undefined {
    return this.actors.get(id)
  }

  getAllActors(): WitnessActor[] {
    return [...this.actors.values()]
  }

  /** True if at least one upright civilian within radius (45m) has unobstructed LOS to crimeOrigin. */
  hasWitnessInSight(crimeOrigin: THREE.Vector3, radius = this.radius): boolean {
    const rSq = radius * radius
    this.tmpTo.set(crimeOrigin.x, crimeOrigin.y + 1.25, crimeOrigin.z)
    for (const actor of this.actors.values()) {
      if (!actor.active || actor.down > 0) continue
      const dx = actor.position.x - crimeOrigin.x
      const dz = actor.position.z - crimeOrigin.z
      if (dx * dx + dz * dz > rSq) continue
      if (this.colliders.length === 0) return true
      this.tmpFrom.set(actor.position.x, actor.position.y + 1.55, actor.position.z)
      if (hasLineOfSight(this.tmpFrom, this.tmpTo, this.colliders)) return true
    }
    return false
  }

  /**
   * Evaluate a crime at `crimeOrigin` against registered NPCs inside a 45m LOS radius.
   * Closest valid witness enters `shocked` -> `reporting` (3.5s 911 call); others flee.
   */
  notifyCrime(
    crimeOrigin: THREE.Vector3,
    severity = 1,
    radius = this.radius,
    observation: Partial<WitnessObservation> = {},
  ): { started: boolean; fleeingIds: string[]; witnessId: string | null } {
    const rSq = radius * radius
    this.tmpTo.set(crimeOrigin.x, crimeOrigin.y + 1.2, crimeOrigin.z)
    const candidates: { actor: WitnessActor; distSq: number }[] = []

    for (const actor of this.actors.values()) {
      if (!actor.active || actor.down > 0 || actor.state === 'intimidated') continue
      const dx = actor.position.x - crimeOrigin.x
      const dz = actor.position.z - crimeOrigin.z
      const distSq = dx * dx + dz * dz
      if (distSq > rSq) continue
      if (this.colliders.length > 0) {
        this.tmpFrom.set(actor.position.x, actor.position.y + 1.55, actor.position.z)
        if (!hasLineOfSight(this.tmpFrom, this.tmpTo, this.colliders)) continue
      }
      candidates.push({ actor, distSq })
    }

    if (candidates.length === 0) return { started: false, fleeingIds: [], witnessId: null }
    candidates.sort((a, b) => a.distSq - b.distSq)

    let activeReporters = 0
    for (const actor of this.actors.values()) {
      if (actor.state === 'shocked' || actor.state === 'reporting') activeReporters += 1
    }

    let started = false
    let witnessId: string | null = null
    const fleeingIds: string[] = []
    const clampedSeverity = Math.max(1, Math.min(6, Math.floor(severity)))

    for (const { actor, distSq } of candidates) {
      if (activeReporters < 1 && actor.state !== 'reporting') {
        actor.state = 'shocked'
        actor.shockTimer = 0.45
        actor.reportTimer = this.callDuration
        actor.reportSeverity = clampedSeverity
        actor.lostLosTimer = 0
        actor.observation = {
          sawFace: Boolean(observation.sawFace) && distSq <= 24 * 24,
          outfitId: observation.outfitId ?? null,
          weaponClass: observation.weaponClass ?? null,
          vehicleModel: observation.vehicleModel ?? null,
          vehicleColor: observation.vehicleColor ?? null,
          vehiclePlate: distSq <= 28 * 28 ? (observation.vehiclePlate ?? null) : null,
        }
        activeReporters += 1
        started = true
        witnessId = actor.id
        this.emit('started', {
          witnessId: actor.id,
          x: actor.position.x,
          z: actor.position.z,
          severity: clampedSeverity,
        })
      } else if (actor.state !== 'reporting') {
        actor.state = 'fleeing'
        fleeingIds.push(actor.id)
      }
    }

    return { started, fleeingIds, witnessId }
  }

  /** Advance witness 3.5-second 911 timers, checking 45m radius and building LOS. */
  update(dt: number, suspectPos: THREE.Vector3): { completed: WitnessDispatchEvent | null; cancelled: WitnessCancelEvent | null } {
    let completed: WitnessDispatchEvent | null = null
    let cancelled: WitnessCancelEvent | null = null

    for (const actor of this.actors.values()) {
      if (!actor.active) continue
      if (actor.down > 0) {
        if (actor.state === 'shocked' || actor.state === 'reporting') {
          actor.state = 'down'
          actor.shockTimer = 0
          actor.reportTimer = 0
          cancelled = { witnessId: actor.id, reason: 'down' }
          this.emit('cancelled', cancelled)
        }
        continue
      }

      if (actor.state === 'shocked') {
        actor.shockTimer -= dt
        if (actor.shockTimer <= 0) {
          actor.state = 'reporting'
          actor.reportTimer = this.callDuration
        }
      } else if (actor.state === 'reporting') {
        const dist = Math.hypot(suspectPos.x - actor.position.x, suspectPos.z - actor.position.z)
        this.tmpFrom.set(actor.position.x, actor.position.y + 1.55, actor.position.z)
        this.tmpTo.set(suspectPos.x, suspectPos.y + 1.25, suspectPos.z)
        const seesSuspect = dist <= this.radius && (this.colliders.length === 0 || hasLineOfSight(this.tmpFrom, this.tmpTo, this.colliders))
        if (!seesSuspect) actor.lostLosTimer += dt
        else actor.lostLosTimer = 0

        if (dist > this.radius || actor.lostLosTimer > 1.4) {
          actor.state = 'fleeing'
          actor.reportTimer = 0
          cancelled = { witnessId: actor.id, reason: 'escaped' }
          this.emit('cancelled', cancelled)
        } else {
          actor.reportTimer -= dt
          if (actor.reportTimer <= 0) {
            const event: WitnessDispatchEvent = {
              witnessId: actor.id,
              x: suspectPos.x,
              z: suspectPos.z,
              severity: actor.reportSeverity,
              code: actor.reportSeverity >= 2 ? '10-78' : '10-31',
              message: `911 DISPATCH: CIVILIAN REPORTED CRIME (${actor.reportSeverity}★ RESPONSE)`,
              observation: { ...actor.observation },
            }
            actor.state = 'fleeing'
            actor.reportTimer = 0
            completed = event
            this.emit('dispatch', event)
          }
        }
      }
    }

    return { completed, cancelled }
  }

  /** Intimidate shocked/reporting witnesses by aiming, firing nearby, or closing to <5.5m. */
  intimidate(playerPos: THREE.Vector3, aimDir: THREE.Vector3, weaponThreat: boolean): string[] {
    const dirLen = aimDir.length()
    const normX = dirLen > 1e-4 ? aimDir.x / dirLen : 0
    const normZ = dirLen > 1e-4 ? aimDir.z / dirLen : -1
    const intimidatedIds: string[] = []

    for (const actor of this.actors.values()) {
      if (!actor.active || actor.down > 0) continue
      if (actor.state !== 'reporting' && actor.state !== 'shocked') continue

      const dx = actor.position.x - playerPos.x
      const dz = actor.position.z - playerPos.z
      const dist = Math.hypot(dx, dz)
      const closeRush = dist <= 5.5
      const nearShot = weaponThreat && dist <= 26
      let aimedAt = false

      if (dist <= 22 && dist > 0.1) {
        const dot = (dx * normX + dz * normZ) / dist
        if (dot >= 0.85) {
          this.tmpFrom.set(playerPos.x, playerPos.y + 1.4, playerPos.z)
          this.tmpTo.set(actor.position.x, actor.position.y + 1.4, actor.position.z)
          aimedAt = this.colliders.length === 0 || hasLineOfSight(this.tmpFrom, this.tmpTo, this.colliders)
        }
      }

      if (closeRush || nearShot || aimedAt) {
        actor.state = 'intimidated'
        actor.shockTimer = 0
        actor.reportTimer = 0
        intimidatedIds.push(actor.id)
        this.emit('cancelled', { witnessId: actor.id, reason: 'intimidated' })
      }
    }
    return intimidatedIds
  }

  knockDown(witnessId: string): boolean {
    const actor = this.actors.get(witnessId)
    if (!actor) return false
    const wasReporting = actor.state === 'reporting' || actor.state === 'shocked'
    actor.state = 'down'
    actor.shockTimer = 0
    actor.reportTimer = 0
    if (wasReporting) {
      this.emit('cancelled', { witnessId, reason: 'down' })
    }
    return wasReporting
  }

  getActiveBlips(): { id: string; x: number; z: number; state: 'shocked' | 'reporting'; progress: number }[] {
    const out: { id: string; x: number; z: number; state: 'shocked' | 'reporting'; progress: number }[] = []
    for (const actor of this.actors.values()) {
      if (!actor.active || actor.down > 0) continue
      if (actor.state === 'shocked' || actor.state === 'reporting') {
        const progress = actor.state === 'reporting'
          ? THREE.MathUtils.clamp(1 - actor.reportTimer / Math.max(0.01, this.callDuration), 0, 1)
          : 0
        out.push({ id: actor.id, x: actor.position.x, z: actor.position.z, state: actor.state, progress })
      }
    }
    return out
  }
}
