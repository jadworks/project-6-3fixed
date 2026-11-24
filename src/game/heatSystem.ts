import * as THREE from 'three'

export type HeatPhase = 'clear' | 'witness' | 'pursuit' | 'evading'

export type HeatHudState = {
  wanted: number
  phase: HeatPhase
  inSight: boolean
  cooldownProgress: number // 0..1 (1 = fully cooled down to drop a star)
  witnessProgress: number  // 0..1 (progress of witness reporting crime)
  statusText: string
  lkp: { x: number; z: number } | null
  searchRadius: number
}

const STAR_COOLDOWN_SECONDS = [0, 14, 18, 24, 30, 38] as const

/**
 * GTA 6-inspired Heat & Pursuit system:
 * - Witness reporting window before dispatch locks your heat if no cop sees you directly.
 * - Line-of-sight pursuit lock: cops track live position while in sight (red/blue alert).
 * - Evading / Searching phase: breaking sight switches cops to Last Known Position (LKP),
 *   stars pulse white/cyan and drain faster when disguised (vehicle swap) or hidden in cover/safehouse.
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
  private witnessDuration = 2.6
  private pendingWitnessStars = 0
  private witnessOrigin = new THREE.Vector3()
  private vehicleSwapBonusTimer = 0
  private lastVehicleId: unknown = null

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
  }

  /** Trigger crime heat: direct police sight or severe crimes lock immediately; minor crimes near witnesses start a dispatch call. */
  reportCrime(
    position: THREE.Vector3,
    severity: number,
    options: { immediate?: boolean; policeSeePlayer?: boolean; witnessPresent?: boolean } = {},
  ): { escalated: boolean; dispatchStarted: boolean } {
    const { immediate = false, policeSeePlayer = false, witnessPresent = false } = options
    if (immediate || policeSeePlayer || this.wanted > 0) {
      const prev = this.wanted
      this.wanted = Math.min(5, Math.max(this.wanted, severity))
      if (this.wanted === prev && severity >= 1 && this.wanted < 5 && immediate) {
        this.wanted = Math.min(5, this.wanted + 1)
      }
      this.witnessTimer = 0
      this.pendingWitnessStars = 0
      this.inSight = true
      this.phase = 'pursuit'
      this.lastKnownPos.copy(position)
      this.hasLkp = true
      this.evadeDuration = STAR_COOLDOWN_SECONDS[this.wanted] ?? 20
      this.evadeTimer = 0
      return { escalated: this.wanted > prev, dispatchStarted: false }
    }

    if (witnessPresent && this.witnessTimer <= 0) {
      this.pendingWitnessStars = Math.max(1, Math.min(5, severity))
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
  ): { starDropped: boolean; dispatchConfirmed: boolean } {
    let starDropped = false
    let dispatchConfirmed = false
    this.vehicleSwapBonusTimer = Math.max(0, this.vehicleSwapBonusTimer - dt)

    if (this.wanted === 0 && this.witnessTimer > 0) {
      if (policeSeePlayer) {
        this.wanted = Math.max(1, this.pendingWitnessStars)
        this.witnessTimer = 0
        this.pendingWitnessStars = 0
        this.inSight = true
        this.phase = 'pursuit'
        this.lastKnownPos.copy(playerPos)
        this.hasLkp = true
        this.evadeDuration = STAR_COOLDOWN_SECONDS[this.wanted]
        this.evadeTimer = 0
        dispatchConfirmed = true
      } else if (playerPos.distanceTo(this.witnessOrigin) > 36) {
        // Outran the witness before they reached dispatch!
        this.witnessTimer = 0
        this.pendingWitnessStars = 0
        this.phase = 'clear'
      } else {
        this.witnessTimer -= dt
        this.phase = 'witness'
        if (this.witnessTimer <= 0) {
          this.wanted = Math.max(1, this.pendingWitnessStars)
          this.pendingWitnessStars = 0
          this.inSight = false
          this.phase = 'evading'
          this.lastKnownPos.copy(this.witnessOrigin)
          this.hasLkp = true
          this.evadeDuration = STAR_COOLDOWN_SECONDS[this.wanted]
          this.evadeTimer = 0
          dispatchConfirmed = true
        }
      }
      return { starDropped, dispatchConfirmed }
    }

    if (this.wanted <= 0) {
      this.phase = 'clear'
      this.inSight = false
      this.hasLkp = false
      return { starDropped, dispatchConfirmed }
    }

    this.inSight = policeSeePlayer
    if (policeSeePlayer) {
      this.phase = 'pursuit'
      this.lastKnownPos.copy(playerPos)
      this.hasLkp = true
      this.evadeTimer = Math.max(0, this.evadeTimer - dt * 1.8)
    } else {
      this.phase = 'evading'
      let drainRate = 1.0
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
        } else {
          this.evadeDuration = STAR_COOLDOWN_SECONDS[this.wanted]
        }
      }
    }

    return { starDropped, dispatchConfirmed }
  }

  /** Where AI police units should navigate: live player when seen, or LKP when evading. */
  getSearchTarget(playerPos: THREE.Vector3): THREE.Vector3 {
    if (this.inSight || !this.hasLkp) return playerPos
    return this.lastKnownPos
  }

  getHudState(): HeatHudState {
    const witnessProgress = this.witnessTimer > 0 ? 1 - this.witnessTimer / this.witnessDuration : 0
    const cooldownProgress = this.wanted > 0 ? THREE.MathUtils.clamp(this.evadeTimer / Math.max(1, this.evadeDuration), 0, 1) : 0
    let statusText = ''
    if (this.phase === 'witness') statusText = 'WITNESS CALLING PD'
    else if (this.phase === 'pursuit') statusText = 'IN SIGHT — PURSUIT'
    else if (this.phase === 'evading') {
      statusText = this.vehicleSwapBonusTimer > 0 ? 'VEHICLE SWAPPED — EVADING FAST' : 'EVADING — SEARCHING LKP'
    }
    return {
      wanted: this.wanted,
      phase: this.phase,
      inSight: this.inSight,
      cooldownProgress,
      witnessProgress,
      statusText,
      lkp: this.hasLkp && this.wanted > 0 ? { x: this.lastKnownPos.x, z: this.lastKnownPos.z } : null,
      searchRadius: 24 + this.wanted * 10,
    }
  }
}
