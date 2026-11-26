export type OutfitSpec = {
  id: string
  label: string
  shirtHex: number
  jacketHex: number
  pantsHex: number
}

export const OUTFIT_CATALOG: OutfitSpec[] = [
  { id: 'teal-windbreaker', label: 'Teal Track Jacket', shirtHex: 0x49b9be, jacketHex: 0x17263d, pantsHex: 0x222944 },
  { id: 'liberty-overcoat', label: 'Olive Parka', shirtHex: 0x5c6352, jacketHex: 0x2f382b, pantsHex: 0x1f2630 },
  { id: 'crimson-bomber', label: 'Crimson Bomber', shirtHex: 0x993545, jacketHex: 0x1c1e24, pantsHex: 0x252830 },
  { id: 'black-hoodie', label: 'Charcoal Hoodie', shirtHex: 0x262b33, jacketHex: 0x171a20, pantsHex: 0x181c24 },
]

export type KnownVehicleIntel = {
  model: string
  color: string
  plateNumber: string
  damageState: string
}

export type PoliceDispatchKnowledge = {
  faceIdentified: boolean
  knownOutfit: { id: string; label: string } | null
  knownWeapons: string[]
  knownVehicle: KnownVehicleIntel | null
}

export type ApbHudIntel = {
  faceIdentified: boolean
  masked: boolean
  outfitLogged: boolean
  outfitCleared: boolean
  outfitLabel: string
  armedClass: string | null
  vehicleApb: boolean
  cleanVehicle: boolean
  plateNumber: string | null
  tickerLine: string
}

export type LiveSuspectObservation = {
  masked: boolean
  outfit: OutfitSpec
  brandishedWeaponClass: string | null
  vehicle: KnownVehicleIntel | null
}

/**
 * GTA 6 Suspect Description, Police Recognition, Mask/Identity & Plate Tracking:
 * - Dispatch knowledge ONLY updates inside active police vision cones or upon completed 911 calls.
 * - Putting on a mask hides the player's face from new sightings.
 * - Swapping outfits or respraying/switching cars out of sight clears APB flags and speeds heat decay.
 */
export class PoliceKnowledgeSystem {
  masked = false
  outfitIndex = 0
  holstered = false
  knowledge: PoliceDispatchKnowledge = {
    faceIdentified: false,
    knownOutfit: null,
    knownWeapons: [],
    knownVehicle: null,
  }
  private outfitWasLogged = false

  get currentOutfit(): OutfitSpec {
    return OUTFIT_CATALOG[this.outfitIndex % OUTFIT_CATALOG.length]
  }

  reset(): void {
    this.knowledge = {
      faceIdentified: false,
      knownOutfit: null,
      knownWeapons: [],
      knownVehicle: null,
    }
    this.outfitWasLogged = false
  }

  toggleMask(): boolean {
    this.masked = !this.masked
    return this.masked
  }

  cycleOutfit(inPoliceSight: boolean): { outfit: OutfitSpec; clearedApb: boolean } {
    this.outfitIndex = (this.outfitIndex + 1) % OUTFIT_CATALOG.length
    const outfit = this.currentOutfit
    let clearedApb = false
    if (!inPoliceSight && this.knowledge.knownOutfit && this.knowledge.knownOutfit.id !== outfit.id) {
      this.knowledge.knownOutfit = null
      clearedApb = true
    } else if (inPoliceSight) {
      this.knowledge.knownOutfit = { id: outfit.id, label: outfit.label }
      this.outfitWasLogged = true
    }
    return { outfit, clearedApb }
  }

  toggleHolster(): boolean {
    this.holstered = !this.holstered
    return this.holstered
  }

  /** Record live visual observation ONLY when seen in police cone or confirmed witness report. */
  recordSighting(obs: LiveSuspectObservation): void {
    if (!obs.masked) {
      this.knowledge.faceIdentified = true
    }
    if (!obs.vehicle) {
      this.knowledge.knownOutfit = { id: obs.outfit.id, label: obs.outfit.label }
      this.outfitWasLogged = true
    } else {
      this.knowledge.knownVehicle = { ...obs.vehicle }
    }
    if (obs.brandishedWeaponClass && !this.knowledge.knownWeapons.includes(obs.brandishedWeaponClass)) {
      this.knowledge.knownWeapons.push(obs.brandishedWeaponClass)
    }
  }

  /** Apply a confirmed 911 civilian witness report. */
  recordWitnessDispatch(report: {
    sawFace?: boolean
    outfitId?: string | null
    weaponClass?: string | null
    vehicleModel?: string | null
    vehicleColor?: string | null
    vehiclePlate?: string | null
  }, currentOutfit: OutfitSpec): void {
    if (report.sawFace && !this.masked) {
      this.knowledge.faceIdentified = true
    }
    if (report.outfitId) {
      const found = OUTFIT_CATALOG.find(o => o.id === report.outfitId) ?? currentOutfit
      this.knowledge.knownOutfit = { id: found.id, label: found.label }
      this.outfitWasLogged = true
    }
    if (report.weaponClass && !this.knowledge.knownWeapons.includes(report.weaponClass)) {
      this.knowledge.knownWeapons.push(report.weaponClass)
    }
    if (report.vehicleModel && report.vehiclePlate) {
      this.knowledge.knownVehicle = {
        model: report.vehicleModel,
        color: report.vehicleColor ?? 'Unknown',
        plateNumber: report.vehiclePlate,
        damageState: 'Intact',
      }
    }
  }

  /** Notify when the suspect switches cars or resprays at Pay 'n' Spray. */
  onVehicleUpdated(vehicle: KnownVehicleIntel | null, inPoliceSight: boolean): { cleanVehicle: boolean } {
    if (!vehicle) {
      return { cleanVehicle: false }
    }
    if (inPoliceSight) {
      this.knowledge.knownVehicle = { ...vehicle }
      return { cleanVehicle: false }
    }
    const cleanVehicle = this.knowledge.knownVehicle !== null
      && this.knowledge.knownVehicle.plateNumber !== vehicle.plateNumber
    return { cleanVehicle }
  }

  /** Evasion speed multiplier granted when player conceals identity, outfit, or drives a clean car. */
  evasionDrainMultiplier(currentVehiclePlate: string | null): number {
    let mult = 1.0
    if (!this.knowledge.faceIdentified && this.masked) mult *= 1.25
    if (this.outfitWasLogged && !this.knowledge.knownOutfit) mult *= 1.35
    if (currentVehiclePlate && this.knowledge.knownVehicle && this.knowledge.knownVehicle.plateNumber !== currentVehiclePlate) {
      mult *= 1.45
    }
    return mult
  }

  /**
   * Recognition cone modifiers based on memorized clues vs. player disguise/vehicle swap:
   * - Masked while face is unknown narrows vision cone & shortens recognition distance.
   * - Swapped outfit after previous sighting shrinks recognition range.
   * - Clean plate car when police only know a prior car's plate significantly reduces recognition distance.
   */
  recognitionModifiers(currentVehiclePlate: string | null): { rangeMult: number; fovMult: number } {
    let rangeMult = 1.0
    let fovMult = 1.0
    if (!this.knowledge.faceIdentified && this.masked) {
      rangeMult *= 0.78
      fovMult *= 0.85
    }
    if (this.outfitWasLogged && !this.knowledge.knownOutfit) {
      rangeMult *= 0.82
    }
    if (currentVehiclePlate && this.knowledge.knownVehicle && this.knowledge.knownVehicle.plateNumber !== currentVehiclePlate) {
      rangeMult *= 0.68
      fovMult *= 0.88
    }
    return { rangeMult, fovMult }
  }

  /** Build HUD APB tags and 1-line police dispatch ticker text. */
  getApbHudIntel(currentVehiclePlate: string | null, wanted: number): ApbHudIntel {
    const faceIdentified = this.knowledge.faceIdentified
    const outfitLogged = Boolean(this.knowledge.knownOutfit && this.knowledge.knownOutfit.id === this.currentOutfit.id)
    const outfitCleared = this.outfitWasLogged && !outfitLogged
    const armedClass = this.knowledge.knownWeapons.length > 0
      ? this.knowledge.knownWeapons[this.knowledge.knownWeapons.length - 1]
      : null
    const vehicleApb = Boolean(
      this.knowledge.knownVehicle
      && currentVehiclePlate
      && this.knowledge.knownVehicle.plateNumber === currentVehiclePlate,
    )
    const cleanVehicle = Boolean(
      currentVehiclePlate
      && this.knowledge.knownVehicle
      && this.knowledge.knownVehicle.plateNumber !== currentVehiclePlate,
    )

    let tickerLine = 'SCANNER: NO ACTIVE APB BROADCAST ON FILE'
    if (wanted > 0 || faceIdentified || outfitLogged || vehicleApb || armedClass) {
      const subject = faceIdentified
        ? 'Identified suspect'
        : this.masked
          ? 'Masked unknown suspect'
          : 'Unidentified suspect'
      const attire = this.knowledge.knownOutfit ? `wearing ${this.knowledge.knownOutfit.label}` : 'changing clothes'
      const armed = armedClass ? `, armed w/ ${armedClass}` : ''
      const carPart = this.knowledge.knownVehicle
        ? `, last seen in ${this.knowledge.knownVehicle.damageState.toLowerCase()} ${this.knowledge.knownVehicle.color} ${this.knowledge.knownVehicle.model} [${this.knowledge.knownVehicle.plateNumber}]`
        : ' on foot'
      tickerLine = `APB: ${subject} ${attire}${armed}${carPart}.`
    }

    return {
      faceIdentified,
      masked: this.masked,
      outfitLogged,
      outfitCleared,
      outfitLabel: this.currentOutfit.label,
      armedClass,
      vehicleApb,
      cleanVehicle,
      plateNumber: currentVehiclePlate,
      tickerLine,
    }
  }
}
