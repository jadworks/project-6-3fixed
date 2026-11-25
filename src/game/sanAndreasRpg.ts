export type SkillTier = 'POOR' | 'GANGSTER' | 'HITMAN'

export type SanAndreasStatsSave = {
  respect: number
  staminaSkill: number
  muscle: number
  fat: number
  hunger: number
  weaponSkill: number
  drivingSkill: number
}

export type RpgHudState = SanAndreasStatsSave & {
  stamina: number
  weaponTier: SkillTier
  maxHomies: number
  starving: boolean
}

function clamp100(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0
}

/**
 * GTA: San Andreas RPG Character Stats, Physique, Hunger, and Skill Progression:
 * - Respect (0..100): unlocks 1..6 street homies via G/H recruitment.
 * - Stamina / StaminaSkill: governs sprint duration & exhaustion recovery.
 * - Muscle & Fat: dynamically scales 3D player physique and melee damage multiplier.
 * - Hunger (0..100): decays slowly over time; eating restores health/stamina/hunger; 0% drains stamina regen.
 * - WeaponSkill (Poor -> Gangster -> Hitman): tightens weapon spread, recoil, and reload speed.
 * - DrivingSkill: enhances vehicle cornering grip & high-speed stability.
 */
export class SanAndreasRpg {
  respect = 18
  stamina = 100
  staminaSkill = 28
  muscle = 26
  fat = 14
  hunger = 88
  weaponSkill = 20
  drivingSkill = 25
  exhausted = false

  private sprintAccum = 0
  private driveAccum = 0

  get maxHomies(): number {
    return Math.min(6, 1 + Math.floor(this.respect / 18))
  }

  get weaponTier(): SkillTier {
    if (this.weaponSkill >= 75) return 'HITMAN'
    if (this.weaponSkill >= 35) return 'GANGSTER'
    return 'POOR'
  }

  get meleeDamageMultiplier(): number {
    return 1 + (this.muscle / 100) * 1.1
  }

  get drivingHandlingBonus(): number {
    return (this.drivingSkill / 100) * 0.35
  }

  get hungerHealthDrainPerSec(): number {
    return this.hunger <= 0 ? 1.2 : 0
  }

  update(
    dt: number,
    input: { sprinting: boolean; moving: boolean; swimming: boolean; inVehicle: boolean; vehicleSpeed: number; crashed: boolean },
  ): { leveledStat: string | null } {
    let leveledStat: string | null = null
    // Hunger slowly ticks down during active movement or combat
    const hungerDecay = input.sprinting ? 0.28 : input.moving ? 0.14 : 0.06
    this.hunger = clamp100(this.hunger - hungerDecay * dt)

    // Stamina drain vs recovery
    if (!input.inVehicle && (input.sprinting || input.swimming) && input.moving) {
      const efficiency = 1 - (this.staminaSkill / 100) * 0.45
      const fatPenalty = 1 + (this.fat / 100) * 0.35
      this.stamina = clamp100(this.stamina - 16 * efficiency * fatPenalty * dt)
      if (this.stamina <= 0) this.exhausted = true

      this.sprintAccum += dt
      if (this.sprintAccum >= 6) {
        this.sprintAccum = 0
        const before = Math.floor(this.staminaSkill)
        this.staminaSkill = clamp100(this.staminaSkill + 1.2)
        this.fat = clamp100(this.fat - 0.8)
        if (Math.floor(this.staminaSkill) > before) leveledStat = 'STAMINA +'
      }
    } else {
      const regenBase = this.hunger <= 5 ? 9 : 21 + (this.staminaSkill / 100) * 12
      this.stamina = clamp100(this.stamina + regenBase * dt)
      if (this.exhausted && this.stamina >= 32) this.exhausted = false
    }

    // Driving skill increases during smooth high-speed driving
    if (input.inVehicle && Math.abs(input.vehicleSpeed) >= 12 && !input.crashed) {
      this.driveAccum += dt
      if (this.driveAccum >= 5) {
        this.driveAccum = 0
        const before = Math.floor(this.drivingSkill)
        this.drivingSkill = clamp100(this.drivingSkill + 1.4)
        if (Math.floor(this.drivingSkill) > before) leveledStat = 'DRIVING SKILL +'
      }
    }

    return { leveledStat }
  }

  recordGymRep(kind: 'bench' | 'bag'): { muscleGain: number; staminaGain: number } {
    const prevMuscle = this.muscle
    const prevStam = this.staminaSkill
    if (kind === 'bench') {
      this.muscle = clamp100(this.muscle + 6.5)
      this.staminaSkill = clamp100(this.staminaSkill + 2.0)
      this.fat = clamp100(this.fat - 3.5)
    } else {
      this.muscle = clamp100(this.muscle + 4.0)
      this.staminaSkill = clamp100(this.staminaSkill + 5.0)
      this.fat = clamp100(this.fat - 4.0)
    }
    this.hunger = clamp100(this.hunger - 6)
    this.stamina = Math.max(25, this.stamina - 18)
    this.respect = clamp100(this.respect + 1.5)
    return {
      muscleGain: Math.round((this.muscle - prevMuscle) * 10) / 10,
      staminaGain: Math.round((this.staminaSkill - prevStam) * 10) / 10,
    }
  }

  eatMeal(mealSize = 48): { healthGain: number; staminaGain: number } {
    const excess = Math.max(0, this.hunger + mealSize - 100)
    this.hunger = clamp100(this.hunger + mealSize)
    if (excess > 8) this.fat = clamp100(this.fat + excess * 0.25)
    this.stamina = 100
    this.exhausted = false
    return { healthGain: 40, staminaGain: 100 }
  }

  recordMeleeHit(knockedOut: boolean): void {
    this.muscle = clamp100(this.muscle + (knockedOut ? 1.4 : 0.45))
    this.fat = clamp100(this.fat - 0.35)
    if (knockedOut) this.respect = clamp100(this.respect + 0.8)
  }

  recordWeaponHit(critical: boolean, killed: boolean): { tierPromoted: SkillTier | null } {
    const prevTier = this.weaponTier
    const gain = (critical ? 1.8 : 0.85) + (killed ? 1.3 : 0)
    this.weaponSkill = clamp100(this.weaponSkill + gain)
    if (killed) this.respect = clamp100(this.respect + 0.7)
    const nextTier = this.weaponTier
    return { tierPromoted: nextTier !== prevTier ? nextTier : null }
  }

  recordTurfCapture(): void {
    this.respect = clamp100(this.respect + 16)
  }

  recordMissionComplete(): void {
    this.respect = clamp100(this.respect + 10)
  }

  getHudState(): RpgHudState {
    return {
      respect: Math.round(this.respect),
      stamina: Math.round(this.stamina),
      staminaSkill: Math.round(this.staminaSkill),
      muscle: Math.round(this.muscle),
      fat: Math.round(this.fat),
      hunger: Math.round(this.hunger),
      weaponSkill: Math.round(this.weaponSkill),
      drivingSkill: Math.round(this.drivingSkill),
      weaponTier: this.weaponTier,
      maxHomies: this.maxHomies,
      starving: this.hunger <= 0,
    }
  }

  toSaveState(): SanAndreasStatsSave {
    return {
      respect: Math.round(this.respect * 10) / 10,
      staminaSkill: Math.round(this.staminaSkill * 10) / 10,
      muscle: Math.round(this.muscle * 10) / 10,
      fat: Math.round(this.fat * 10) / 10,
      hunger: Math.round(this.hunger * 10) / 10,
      weaponSkill: Math.round(this.weaponSkill * 10) / 10,
      drivingSkill: Math.round(this.drivingSkill * 10) / 10,
    }
  }

  restoreFromSave(saved?: Partial<SanAndreasStatsSave>): void {
    if (!saved) return
    if (typeof saved.respect === 'number') this.respect = clamp100(saved.respect)
    if (typeof saved.staminaSkill === 'number') this.staminaSkill = clamp100(saved.staminaSkill)
    if (typeof saved.muscle === 'number') this.muscle = clamp100(saved.muscle)
    if (typeof saved.fat === 'number') this.fat = clamp100(saved.fat)
    if (typeof saved.hunger === 'number') this.hunger = clamp100(saved.hunger)
    if (typeof saved.weaponSkill === 'number') this.weaponSkill = clamp100(saved.weaponSkill)
    if (typeof saved.drivingSkill === 'number') this.drivingSkill = clamp100(saved.drivingSkill)
  }
}
