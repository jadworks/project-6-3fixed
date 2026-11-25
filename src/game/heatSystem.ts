import * as THREE from 'three'
import type { PlayerHeatSave } from './saveSystem'

export type HeatPhase = 'clear' | 'witness' | 'pursuit' | 'evading'

export type DispatchBanner = {
  code: string
  text: string
  level: number
  timer: number
}

export type WitnessBlip = {
  x: number
  z: number
  state: 'shocked' | 'reporting'
  progress: number
}

export type HeatHudState = {
  wanted: number
  phase: HeatPhase
  inSight: boolean
  cooldownProgress: number // 0..1 (1 = fully cooled down to drop a star)
  witnessProgress: number  // 0..1 (progress of witness reporting crime)
  reinforcementProgress: number // 0..1 (buildup toward next police reinforcement wave)
  statusText: string
  lkp: { x: number; z: number } | null
  searchRadius: number
  dispatchBanner: { code: string; text: string; level: number } | null
  witnesses: WitnessBlip[]
}

const STAR_COOLDOWN_SECONDS = [0, 14, 18, 24, 30, 38, 48] as const
const REINFORCEMENT_WAVE_SECONDS = [0, 22, 20, 18, 16, 15, 14] as const

const DISPATCH_CALLOUTS: Record<number, { code: string; text: string }> = {
  1: { code: '10-31', text: 'DISPATCH: 10-31 IN PROGRESS — SUSPECT DESCRIPTION LOGGED' },
  2: { code: '10-78', text: 'DISPATCH: 10-78 PURSUIT — PATROL INTERCEPTORS EN ROUTE' },
  3: { code: 'CODE 3', text: 'DISPATCH: CODE 3 — SWAT TACTICAL VAN & SPIKE ROADBLOCKS DEPLOYED' },
  4: { code: 'AIR-1', text: 'DISPATCH: AIR ONE LAUNCHED — THERMAL SEARCHLIGHT ACTIVE' },
  5: { code: 'TAC-5', text: 'DISPATCH: FULL SWAT SQUADRON — CONTAINMENT PERIMETER SET' },
  6: { code: 'CODE RED', text: 'DISPATCH: MILITARY LOCKDOWN — ARMORED UNITS AUTHORIZED' },
}

/**
 * GTA 6-inspired Heat, Witness, & Tactical Law Enforcement state machine:
 * - 3.5-second Civilian Witness 911 reporting window (cancellable via intimidation, KO, or >45m escape).
 * - Line-of-sight pursuit lock with reinforcement buildup up to 6-star Military Lockdown.
 * - Breaking sight shifts units to Last Known Position (LKP) with search cones & cooldown timer.
 */
export class HeatSystem {
  wanted = 0
  phase: HeatPhase = 'clear'
  inSight = false
  readonly lastKnownPos = new THREE.Vector3()
  private hasLkp = false
  private evadeTimer = 0
  private evadeDuration = 14
  private witnessTimer = 0
  private readonly witnessDuration = 3.5
  private pendingWitnessStars = 0
  private witnessOrigin = new THREE.Vector3()
  private vehicleSwapBonusTimer = 0
  private lastVehicleId: unknown = null
  private reinforcementTimer = 0
  private banner: DispatchBanner | null = null
  private activeWitnessBlips: WitnessBlip[] = []
  private externalWitnessDriven = false

  reset(): void {
    this.wanted = 0
    this.phase = 'clear'
    this.inSight = false
    this.hasLkp = false
    this.evadeTimer = 0
    this.witnessTimer = 0
    this.pendingWitnessStars = 0
    this.vehicleSwapBonusTimer = 0
    this.lastVehicleId = null
    this.reinforcementTimer = 0
    this.banner = null
    this.activeWitnessBlips = []
    this.externalWitnessDriven = false
  }

  restoreFromSave(saved?: PlayerHeatSave): void {
    if (!saved || saved.wanted <= 0) {
      this.reset()
      return
    }
    this.wanted = THREE.MathUtils.clamp(Math.floor(saved.wanted), 0, 6)
    this.phase = saved.phase === 'pursuit' ? 'evading' : saved.phase
    this.inSight = false
    this.evadeDuration = STAR_COOLDOWN_SECONDS[this.wanted] ?? 24
    this.evadeTimer = 0
    this.reinforcementTimer = 0
    if (saved.lastKnownPos) {
      this.lastKnownPos.set(saved.lastKnownPos.x, 0, saved.lastKnownPos.z)
      this.hasLkp = true
    } else {
      this.hasLkp = false
    }
  }

  toSaveState(): PlayerHeatSave {
    return {
      wanted: this.wanted,
      phase: this.phase,
      lastKnownPos: this.hasLkp && this.wanted > 0
        ? { x: Math.round(this.lastKnownPos.x * 100) / 100, z: Math.round(this.lastKnownPos.z * 100) / 100 }
        : null,
    }
  }

  triggerDispatchBanner(level: number, custom?: { code: string; text: string }): void {
    const clamped = THREE.MathUtils.clamp(Math.floor(level), 1, 6)
    const entry = custom ?? DISPATCH_CALLOUTS[clamped] ?? DISPATCH_CALLOUTS[1]
    this.banner = { code: entry.code, text: entry.text, level: clamped, timer: 4.8 }
  }

  /** Sync live civilian witness AI blips & active 3.5s report progress from CityLife. */
  syncWitnesses(blips: WitnessBlip[], completedReport: { x: number; z: number; severity: number } | null): { dispatchConfirmed: boolean; newLevel: number } {
    this.activeWitnessBlips = blips
    const reporting = blips.filter(b => b.state === 'reporting')
    this.externalWitnessDriven = reporting.length > 0

    if (completedReport && this.wanted < 6) {
      const targetLevel = Math.min(6, Math.max(this.wanted + 1, completedReport.severity))
      const prev = this.wanted
      this.wanted = Math.max(this.wanted, targetLevel)
      this.witnessTimer = 0
      this.pendingWitnessStars = 0
      this.inSight = false
      this.phase = 'evading'
      this.lastKnownPos.set(completedReport.x, 0, completedReport.z)
      this.hasLkp = true
      this.evadeDuration = STAR_COOLDOWN_SECONDS[this.wanted] ?? 20
      this.evadeTimer = 0
      this.reinforcementTimer = 0
      if (this.wanted > prev) {
        this.triggerDispatchBanner(this.wanted)
      } else {
        this.triggerDispatchBanner(this.wanted, { code: '911', text: 'DISPATCH: UPDATED SUSPECT SIGHTING LOGGED' })
      }
      return { dispatchConfirmed: true, newLevel: this.wanted }
    }

    if (this.wanted === 0 && reporting.length > 0) {
      this.phase = 'witness'
      const maxProg = Math.max(...reporting.map(r => r.progress))
      this.witnessTimer = Math.max(0.01, (1 - maxProg) * this.witnessDuration)
    } else if (this.wanted === 0 && this.phase === 'witness' && reporting.length === 0 && this.pendingWitnessStars === 0) {
      this.phase = 'clear'
      this.witnessTimer = 0
    }
    return { dispatchConfirmed: false, newLevel: this.wanted }
  }

  /** Trigger crime heat: direct police sight or severe crimes lock immediately; minor crimes near witnesses start a 3.5s dispatch call. */
  reportCrime(
    position: THREE.Vector3,
    severity: number,
    options: { immediate?: boolean; policeSeePlayer?: boolean; witnessPresent?: boolean; escalateIfEqual?: boolean } = {},
  ): { escalated: boolean; dispatchStarted: boolean } {
    const { immediate = false, policeSeePlayer = false, witnessPresent = false, escalateIfEqual = false } = options
    const cappedSeverity = THREE.MathUtils.clamp(Math.floor(severity), 1, 6)
    if (immediate || policeSeePlayer || this.wanted > 0) {
      const prev = this.wanted
      this.wanted = Math.min(6, Math.max(this.wanted, cappedSeverity))
      if (this.wanted === prev && (immediate || escalateIfEqual) && this.wanted < 6) {
        this.wanted = Math.min(6, this.wanted + 1)
      }
      this.witnessTimer = 0
      this.pendingWitnessStars = 0
      this.inSight = policeSeePlayer || immediate
      this.phase = this.inSight ? 'pursuit' : 'evading'
      this.lastKnownPos.copy(position)
      this.hasLkp = true
      this.evadeDuration = STAR_COOLDOWN_SECONDS[this.wanted] ?? 20
      this.evadeTimer = 0
      if (this.wanted > prev) {
        this.reinforcementTimer = 0
        this.triggerDispatchBanner(this.wanted)
      }
      return { escalated: this.wanted > prev, dispatchStarted: false }
    }

    if (witnessPresent && this.witnessTimer <= 0) {
      this.pendingWitnessStars = cappedSeverity
      this.witnessOrigin.copy(position)
      this.witnessTimer = this.witnessDuration
      this.phase = 'witness'
      return { escalated: false, dispatchStarted: true }
    }
    return { escalated: false, dispatchStarted: false }
  }

  /** Notify heat system when player swaps vehicles; if out of sight, grants faster plate cooldown. */
  onVehicleChanged(vehicle: unknown): boolean {
    if (vehicle === this.lastVehicleId) return false
    this.lastVehicleId = vehicle
    if (this.wanted > 0 && !this.inSight && vehicle !== null) {
      this.vehicleSwapBonusTimer = 8
      return true
    }
    return false
  }

  /** Clearing heat at a safehouse or losing witness if far away. */
  clearAtSafehouse(): boolean {
    if (this.wanted === 0 && this.witnessTimer <= 0) return false
    this.reset()
    return true
  }

  update(
    dt: number,
    playerPos: THREE.Vector3,
    policeSeePlayer: boolean,
    inStealthArea: boolean,
    identityEvasionMult = 1.0,
  ): { starDropped: boolean; dispatchConfirmed: boolean; reinforcementEscalated: boolean } {
    let starDropped = false
    let dispatchConfirmed = false
    let reinforcementEscalated = false
    this.vehicleSwapBonusTimer = Math.max(0, this.vehicleSwapBonusTimer - dt)
    if (this.banner) {
      this.banner.timer -= dt
      if (this.banner.timer <= 0) this.banner = null
    }

    // Internal standalone witness timer (supports unit tests and non-CityLife witness calls)
    if (this.wanted === 0 && this.witnessTimer > 0 && !this.externalWitnessDriven) {
      if (policeSeePlayer) {
        this.wanted = Math.max(1, this.pendingWitnessStars || 1)
        this.witnessTimer = 0
        this.pendingWitnessStars = 0
        this.inSight = true
        this.phase = 'pursuit'
        this.lastKnownPos.copy(playerPos)
        this.hasLkp = true
        this.evadeDuration = STAR_COOLDOWN_SECONDS[this.wanted]
        this.evadeTimer = 0
        this.reinforcementTimer = 0
        this.triggerDispatchBanner(this.wanted)
        dispatchConfirmed = true
      } else if (playerPos.distanceTo(this.witnessOrigin) > 45) {
        // Outran the 45m witness radius before 3.5s dispatch completed!
        this.witnessTimer = 0
        this.pendingWitnessStars = 0
        this.phase = 'clear'
      } else {
        this.witnessTimer -= dt
        this.phase = 'witness'
        if (this.witnessTimer <= 0) {
          this.wanted = Math.max(1, this.pendingWitnessStars || 1)
          this.pendingWitnessStars = 0
          this.inSight = false
          this.phase = 'evading'
          this.lastKnownPos.copy(this.witnessOrigin)
          this.hasLkp = true
          this.evadeDuration = STAR_COOLDOWN_SECONDS[this.wanted]
          this.evadeTimer = 0
          this.reinforcementTimer = 0
          this.triggerDispatchBanner(this.wanted)
          dispatchConfirmed = true
        }
      }
      return { starDropped, dispatchConfirmed, reinforcementEscalated }
    }

    if (this.wanted <= 0) {
      if (!this.externalWitnessDriven) {
        this.phase = 'clear'
        this.inSight = false
        this.hasLkp = false
      }
      return { starDropped, dispatchConfirmed, reinforcementEscalated }
    }

    this.inSight = policeSeePlayer
    if (policeSeePlayer) {
      this.phase = 'pursuit'
      this.lastKnownPos.copy(playerPos)
      this.hasLkp = true
      this.evadeTimer = Math.max(0, this.evadeTimer - dt * 1.8)
      const waveDuration = REINFORCEMENT_WAVE_SECONDS[this.wanted] ?? 18
      this.reinforcementTimer += dt
      if (this.reinforcementTimer >= waveDuration) {
        this.reinforcementTimer = 0
        if (this.wanted < 6) {
          this.wanted = Math.min(6, this.wanted + 1)
          this.evadeDuration = STAR_COOLDOWN_SECONDS[this.wanted] ?? 24
          this.triggerDispatchBanner(this.wanted)
          reinforcementEscalated = true
        } else {
          this.triggerDispatchBanner(6, { code: 'CODE RED', text: 'DISPATCH: ARMORED REINFORCEMENT WAVE DEPLOYED' })
        }
      }
    } else {
      this.phase = 'evading'
      this.reinforcementTimer = Math.max(0, this.reinforcementTimer - dt * 0.5)
      let drainRate = Math.max(0.75, identityEvasionMult)
      if (this.vehicleSwapBonusTimer > 0) drainRate *= 2.2
      if (inStealthArea) drainRate *= 1.65
      this.evadeTimer += dt * drainRate
      if (this.evadeTimer >= this.evadeDuration) {
        this.wanted = Math.max(0, this.wanted - 1)
        starDropped = true
        this.evadeTimer = 0
        if (this.wanted === 0) {
          this.phase = 'clear'
          this.hasLkp = false
          this.reinforcementTimer = 0
        } else {
          this.evadeDuration = STAR_COOLDOWN_SECONDS[this.wanted]
        }
      }
    }

    return { starDropped, dispatchConfirmed, reinforcementEscalated }
  }

  /** Where AI police units should navigate: live player when seen, or LKP when evading. */
  getSearchTarget(playerPos: THREE.Vector3): THREE.Vector3 {
    if (this.inSight || !this.hasLkp) return playerPos
    return this.lastKnownPos
  }

  getHudState(): HeatHudState {
    const witnessProgress = this.activeWitnessBlips.some(b => b.state === 'reporting')
      ? Math.max(...this.activeWitnessBlips.filter(b => b.state === 'reporting').map(b => b.progress))
      : (this.witnessTimer > 0 ? 1 - this.witnessTimer / this.witnessDuration : 0)
    const cooldownProgress = this.wanted > 0
      ? THREE.MathUtils.clamp(this.evadeTimer / Math.max(1, this.evadeDuration), 0, 1)
      : 0
    const waveDuration = REINFORCEMENT_WAVE_SECONDS[this.wanted] ?? 18
    const reinforcementProgress = this.wanted > 0
      ? THREE.MathUtils.clamp(this.reinforcementTimer / Math.max(1, waveDuration), 0, 1)
      : 0
    let statusText = ''
    if (this.phase === 'witness') statusText = 'WITNESS CALLING 911'
    else if (this.wanted === 6 && this.inSight) statusText = 'MILITARY LOCKDOWN — IN SIGHT'
    else if (this.wanted === 6) statusText = 'MILITARY LOCKDOWN — SEARCHING LKP'
    else if (this.phase === 'pursuit') statusText = 'IN SIGHT — ACTIVE PURSUIT'
    else if (this.phase === 'evading') {
      statusText = this.vehicleSwapBonusTimer > 0 ? 'VEHICLE SWAPPED — EVADING FAST' : 'OUT OF SIGHT — SEARCHING LKP'
    }
    return {
      wanted: this.wanted,
      phase: this.phase,
      inSight: this.inSight,
      cooldownProgress,
      witnessProgress,
      reinforcementProgress,
      statusText,
      lkp: this.hasLkp && this.wanted > 0 ? { x: this.lastKnownPos.x, z: this.lastKnownPos.z } : null,
      searchRadius: 24 + this.wanted * 10,
      dispatchBanner: this.banner ? { code: this.banner.code, text: this.banner.text, level: this.banner.level } : null,
      witnesses: this.activeWitnessBlips,
    }
  }
}
