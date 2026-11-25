export type WeaponCategoryId =
  | 'melee'
  | 'handgun'
  | 'smg'
  | 'shotgun'
  | 'rifle'
  | 'precision'
  | 'heavy'
  | 'throwable'

export type AttachmentId = 'suppressor' | 'extMag' | 'reflex'

export type WeaponFireMode = 'melee' | 'semi' | 'auto' | 'burst' | 'projectile' | 'thrown'

export type WeaponSpec = {
  id: string
  name: string
  shortName: string
  category: WeaponCategoryId
  sectorIndex: number // 0..7
  fireMode: WeaponFireMode
  damage: number
  pellets: number
  range: number
  fireInterval: number
  magSize: number
  reloadSeconds: number
  baseSpread: number
  recoilPitch: number
  recoilYaw: number
  bloomPerShot: number
  armorPenetration: number
  noiseRadius: number
  adsFov: number
  supportsAttachments: AttachmentId[]
  explosionRadius?: number
  flashRadius?: number
}

export const WEAPON_SECTORS: Array<{ id: WeaponCategoryId; label: string; short: string }> = [
  { id: 'melee', label: 'UNARMED / MELEE', short: 'MELEE' },
  { id: 'handgun', label: 'HANDGUNS', short: 'PISTOL' },
  { id: 'smg', label: 'SUBMACHINE GUNS', short: 'SMG' },
  { id: 'shotgun', label: 'SHOTGUNS', short: 'SHOTGUN' },
  { id: 'rifle', label: 'ASSAULT RIFLES', short: 'RIFLE' },
  { id: 'precision', label: 'PRECISION RIFLES', short: 'SNIPER' },
  { id: 'heavy', label: 'HEAVY ORDNANCE', short: 'HEAVY' },
  { id: 'throwable', label: 'THROWABLES', short: 'THROWN' },
]

export const WEAPON_CATALOG: WeaponSpec[] = [
  // Sector 0: Unarmed / Melee
  { id: 'fists', name: 'Bare Fists', shortName: 'FISTS', category: 'melee', sectorIndex: 0, fireMode: 'melee', damage: 24, pellets: 1, range: 2.5, fireInterval: 0.36, magSize: 0, reloadSeconds: 0, baseSpread: 0, recoilPitch: 0.008, recoilYaw: 0.008, bloomPerShot: 0.15, armorPenetration: 0.05, noiseRadius: 6, adsFov: 58, supportsAttachments: [] },
  { id: 'knife', name: 'Combat Knife', shortName: 'KNIFE', category: 'melee', sectorIndex: 0, fireMode: 'melee', damage: 46, pellets: 1, range: 2.8, fireInterval: 0.3, magSize: 0, reloadSeconds: 0, baseSpread: 0, recoilPitch: 0.006, recoilYaw: 0.006, bloomPerShot: 0.12, armorPenetration: 0.25, noiseRadius: 4, adsFov: 58, supportsAttachments: [] },
  { id: 'bat', name: 'Baseball Bat', shortName: 'BAT', category: 'melee', sectorIndex: 0, fireMode: 'melee', damage: 54, pellets: 1, range: 3.1, fireInterval: 0.48, magSize: 0, reloadSeconds: 0, baseSpread: 0, recoilPitch: 0.015, recoilYaw: 0.014, bloomPerShot: 0.25, armorPenetration: 0.1, noiseRadius: 9, adsFov: 58, supportsAttachments: [] },
  { id: 'crowbar', name: 'Crowbar', shortName: 'CROWBAR', category: 'melee', sectorIndex: 0, fireMode: 'melee', damage: 60, pellets: 1, range: 3.0, fireInterval: 0.5, magSize: 0, reloadSeconds: 0, baseSpread: 0, recoilPitch: 0.016, recoilYaw: 0.014, bloomPerShot: 0.25, armorPenetration: 0.3, noiseRadius: 10, adsFov: 58, supportsAttachments: [] },

  // Sector 1: Handguns
  { id: 'pistol', name: '9mm Combat Pistol', shortName: '9MM PISTOL', category: 'handgun', sectorIndex: 1, fireMode: 'semi', damage: 34, pellets: 1, range: 62, fireInterval: 0.22, magSize: 15, reloadSeconds: 1.15, baseSpread: 0.014, recoilPitch: 0.018, recoilYaw: 0.01, bloomPerShot: 0.28, armorPenetration: 0.22, noiseRadius: 28, adsFov: 52, supportsAttachments: ['suppressor', 'extMag', 'reflex'] },
  { id: 'revolver', name: 'Heavy Revolver', shortName: 'REVOLVER', category: 'handgun', sectorIndex: 1, fireMode: 'semi', damage: 68, pellets: 1, range: 74, fireInterval: 0.44, magSize: 6, reloadSeconds: 1.55, baseSpread: 0.008, recoilPitch: 0.044, recoilYaw: 0.02, bloomPerShot: 0.52, armorPenetration: 0.45, noiseRadius: 42, adsFov: 49, supportsAttachments: ['reflex'] },
  { id: 'ap_pistol', name: 'AP Micro-Pistol', shortName: 'AP PISTOL', category: 'handgun', sectorIndex: 1, fireMode: 'auto', damage: 24, pellets: 1, range: 52, fireInterval: 0.095, magSize: 20, reloadSeconds: 1.25, baseSpread: 0.028, recoilPitch: 0.015, recoilYaw: 0.014, bloomPerShot: 0.2, armorPenetration: 0.42, noiseRadius: 30, adsFov: 53, supportsAttachments: ['suppressor', 'extMag', 'reflex'] },

  // Sector 2: Submachine Guns
  { id: 'micro_smg', name: 'Micro-SMG', shortName: 'MICRO-SMG', category: 'smg', sectorIndex: 2, fireMode: 'auto', damage: 22, pellets: 1, range: 50, fireInterval: 0.08, magSize: 32, reloadSeconds: 1.45, baseSpread: 0.032, recoilPitch: 0.014, recoilYaw: 0.016, bloomPerShot: 0.16, armorPenetration: 0.2, noiseRadius: 32, adsFov: 51, supportsAttachments: ['suppressor', 'extMag', 'reflex'] },
  { id: 'mpx', name: 'Tactical MPX', shortName: 'MPX-9', category: 'smg', sectorIndex: 2, fireMode: 'auto', damage: 27, pellets: 1, range: 64, fireInterval: 0.09, magSize: 30, reloadSeconds: 1.35, baseSpread: 0.018, recoilPitch: 0.012, recoilYaw: 0.01, bloomPerShot: 0.14, armorPenetration: 0.32, noiseRadius: 30, adsFov: 49, supportsAttachments: ['suppressor', 'extMag', 'reflex'] },

  // Sector 3: Shotguns
  { id: 'pump_shotgun', name: 'Pump-Action 12-Gauge', shortName: '12G PUMP', category: 'shotgun', sectorIndex: 3, fireMode: 'semi', damage: 17, pellets: 8, range: 30, fireInterval: 0.72, magSize: 8, reloadSeconds: 1.9, baseSpread: 0.075, recoilPitch: 0.052, recoilYaw: 0.024, bloomPerShot: 0.7, armorPenetration: 0.22, noiseRadius: 45, adsFov: 53, supportsAttachments: ['extMag', 'reflex'] },
  { id: 'combat_shotgun', name: 'Semi-Auto Combat Shotgun', shortName: 'COMBAT SG', category: 'shotgun', sectorIndex: 3, fireMode: 'semi', damage: 15, pellets: 7, range: 28, fireInterval: 0.34, magSize: 10, reloadSeconds: 1.8, baseSpread: 0.085, recoilPitch: 0.036, recoilYaw: 0.02, bloomPerShot: 0.5, armorPenetration: 0.28, noiseRadius: 42, adsFov: 53, supportsAttachments: ['suppressor', 'extMag', 'reflex'] },

  // Sector 4: Assault Rifles
  { id: 'carbine', name: 'Carbine Rifle', shortName: 'CARBINE', category: 'rifle', sectorIndex: 4, fireMode: 'auto', damage: 34, pellets: 1, range: 90, fireInterval: 0.11, magSize: 30, reloadSeconds: 1.6, baseSpread: 0.014, recoilPitch: 0.017, recoilYaw: 0.011, bloomPerShot: 0.16, armorPenetration: 0.48, noiseRadius: 42, adsFov: 46, supportsAttachments: ['suppressor', 'extMag', 'reflex'] },
  { id: 'ak_rifle', name: 'Heavy Tactical AK', shortName: 'TACTICAL AK', category: 'rifle', sectorIndex: 4, fireMode: 'auto', damage: 42, pellets: 1, range: 86, fireInterval: 0.128, magSize: 30, reloadSeconds: 1.75, baseSpread: 0.02, recoilPitch: 0.024, recoilYaw: 0.015, bloomPerShot: 0.22, armorPenetration: 0.55, noiseRadius: 45, adsFov: 47, supportsAttachments: ['extMag', 'reflex'] },

  // Sector 5: Precision Rifles
  { id: 'dmr', name: 'Marksman DMR', shortName: 'DMR', category: 'precision', sectorIndex: 5, fireMode: 'semi', damage: 64, pellets: 1, range: 130, fireInterval: 0.29, magSize: 14, reloadSeconds: 1.7, baseSpread: 0.005, recoilPitch: 0.028, recoilYaw: 0.009, bloomPerShot: 0.28, armorPenetration: 0.68, noiseRadius: 45, adsFov: 36, supportsAttachments: ['suppressor', 'extMag', 'reflex'] },
  { id: 'sniper', name: 'Bolt-Action Sniper', shortName: 'SNIPER', category: 'precision', sectorIndex: 5, fireMode: 'semi', damage: 115, pellets: 1, range: 170, fireInterval: 0.92, magSize: 5, reloadSeconds: 2.1, baseSpread: 0.0015, recoilPitch: 0.056, recoilYaw: 0.014, bloomPerShot: 0.75, armorPenetration: 0.9, noiseRadius: 50, adsFov: 26, supportsAttachments: ['suppressor', 'extMag'] },

  // Sector 6: Heavy Ordnance
  { id: 'grenade_launcher', name: 'Compact Grenade Launcher', shortName: 'M32 GL', category: 'heavy', sectorIndex: 6, fireMode: 'projectile', damage: 110, pellets: 1, range: 75, fireInterval: 0.95, magSize: 6, reloadSeconds: 2.3, baseSpread: 0.012, recoilPitch: 0.058, recoilYaw: 0.02, bloomPerShot: 0.65, armorPenetration: 1.0, noiseRadius: 55, adsFov: 52, supportsAttachments: ['reflex'], explosionRadius: 8.5 },

  // Sector 7: Throwables / Utility
  { id: 'frag', name: 'Frag Grenade', shortName: 'FRAG', category: 'throwable', sectorIndex: 7, fireMode: 'thrown', damage: 120, pellets: 1, range: 32, fireInterval: 0.85, magSize: 3, reloadSeconds: 0.6, baseSpread: 0.02, recoilPitch: 0.012, recoilYaw: 0.006, bloomPerShot: 0.2, armorPenetration: 1.0, noiseRadius: 55, adsFov: 56, supportsAttachments: [], explosionRadius: 9 },
  { id: 'flashbang', name: 'Tactical Flashbang', shortName: 'FLASHBANG', category: 'throwable', sectorIndex: 7, fireMode: 'thrown', damage: 15, pellets: 1, range: 30, fireInterval: 0.8, magSize: 4, reloadSeconds: 0.6, baseSpread: 0.02, recoilPitch: 0.01, recoilYaw: 0.005, bloomPerShot: 0.2, armorPenetration: 0, noiseRadius: 38, adsFov: 56, supportsAttachments: [], flashRadius: 12 },
]

export type WeaponSaveState = {
  equippedId: string
  attachments: Record<string, AttachmentId[]>
  reserveByCategory: Partial<Record<WeaponCategoryId, number>>
}

const DEFAULT_RESERVE: Record<WeaponCategoryId, number> = {
  melee: 0,
  handgun: 90,
  smg: 180,
  shotgun: 40,
  rifle: 150,
  precision: 40,
  heavy: 12,
  throwable: 6,
}

export class WeaponArsenal {
  equippedId = 'pistol'
  lastLongGunId: string | null = 'carbine'
  readonly attachments = new Map<string, Set<AttachmentId>>()
  readonly magAmmo = new Map<string, number>()
  readonly reserveAmmo = new Map<WeaponCategoryId, number>()
  recoilBloom = 0
  reloadTimer = 0
  reloadTotal = 0
  private reloadingWeaponId: string | null = null

  constructor() {
    this.reset()
  }

  reset(): void {
    this.equippedId = 'pistol'
    this.lastLongGunId = 'carbine'
    this.attachments.clear()
    this.magAmmo.clear()
    this.reserveAmmo.clear()
    for (const [cat, amount] of Object.entries(DEFAULT_RESERVE) as [WeaponCategoryId, number][]) {
      this.reserveAmmo.set(cat, amount)
    }
    for (const w of WEAPON_CATALOG) {
      this.magAmmo.set(w.id, w.magSize)
    }
    this.recoilBloom = 0
    this.reloadTimer = 0
    this.reloadTotal = 0
    this.reloadingWeaponId = null
  }

  get current(): WeaponSpec {
    return WEAPON_CATALOG.find(w => w.id === this.equippedId) ?? WEAPON_CATALOG[4]
  }

  weaponsInSector(sectorIndex: number): WeaponSpec[] {
    return WEAPON_CATALOG.filter(w => w.sectorIndex === sectorIndex)
  }

  hasAttachment(weaponId: string, att: AttachmentId): boolean {
    return this.attachments.get(weaponId)?.has(att) ?? false
  }

  toggleAttachment(att: AttachmentId, weaponId = this.equippedId): boolean {
    const spec = WEAPON_CATALOG.find(w => w.id === weaponId)
    if (!spec || !spec.supportsAttachments.includes(att)) return false
    let set = this.attachments.get(weaponId)
    if (!set) {
      set = new Set()
      this.attachments.set(weaponId, set)
    }
    const enabled = !set.has(att)
    if (enabled) set.add(att)
    else set.delete(att)
    if (att === 'extMag') {
      const maxCap = this.effectiveMagSize(spec)
      if (!enabled) {
        this.magAmmo.set(weaponId, Math.min(this.magAmmo.get(weaponId) ?? maxCap, maxCap))
      } else {
        this.magAmmo.set(weaponId, maxCap)
      }
    }
    return enabled
  }

  effectiveMagSize(spec = this.current): number {
    if (spec.magSize <= 0) return 0
    return this.hasAttachment(spec.id, 'extMag') ? Math.ceil(spec.magSize * 1.5) : spec.magSize
  }

  effectiveNoiseRadius(spec = this.current): number {
    if (this.hasAttachment(spec.id, 'suppressor')) return Math.min(12, Math.round(spec.noiseRadius * 0.35))
    return spec.noiseRadius
  }

  effectiveSpread(spec: WeaponSpec, opts: { aiming: boolean; crouching: boolean; sprinting: boolean; weaponSkill: number }): number {
    if (spec.fireMode === 'melee') return 0
    let spread = spec.baseSpread * (1 + this.recoilBloom * 1.85)
    if (this.hasAttachment(spec.id, 'reflex')) spread *= 0.7
    if (opts.aiming) spread *= 0.45
    if (opts.crouching) spread *= 0.68
    if (opts.sprinting) spread *= 1.8
    const skillMult = 1 - Math.min(0.42, (opts.weaponSkill / 100) * 0.42)
    return Math.max(0.001, spread * skillMult)
  }

  effectiveRecoil(spec: WeaponSpec, weaponSkill: number): { pitch: number; yaw: number } {
    const grip = this.hasAttachment(spec.id, 'reflex') ? 0.75 : 1
    const skill = 1 - Math.min(0.28, (weaponSkill / 100) * 0.28)
    return {
      pitch: spec.recoilPitch * grip * skill,
      yaw: spec.recoilYaw * grip * skill,
    }
  }

  getAmmoDisplay(spec = this.current): { mag: number; reserve: number; total: number } {
    if (spec.fireMode === 'melee') return { mag: 0, reserve: 0, total: 0 }
    const mag = this.magAmmo.get(spec.id) ?? 0
    const reserve = this.reserveAmmo.get(spec.category) ?? 0
    return { mag, reserve, total: mag + reserve }
  }

  selectWeapon(weaponId: string): WeaponSpec {
    const spec = WEAPON_CATALOG.find(w => w.id === weaponId)
    if (!spec) return this.current
    if (this.current.category === 'rifle' || this.current.category === 'shotgun' || this.current.category === 'precision' || this.current.category === 'heavy') {
      this.lastLongGunId = this.current.id
    }
    this.equippedId = spec.id
    this.reloadTimer = 0
    this.reloadingWeaponId = null
    return spec
  }

  selectSector(sectorIndex: number, cycleWithinSector = false): WeaponSpec {
    const list = this.weaponsInSector(sectorIndex)
    if (list.length === 0) return this.current
    const currentIdx = list.findIndex(w => w.id === this.equippedId)
    if (currentIdx >= 0 && cycleWithinSector) {
      return this.selectWeapon(list[(currentIdx + 1) % list.length].id)
    }
    if (currentIdx >= 0) return this.current
    return this.selectWeapon(list[0].id)
  }

  canFire(): boolean {
    if (this.reloadTimer > 0) return false
    const spec = this.current
    if (spec.fireMode === 'melee') return true
    return (this.magAmmo.get(spec.id) ?? 0) > 0
  }

  consumeRound(weaponSkill = 0): boolean {
    const spec = this.current
    if (spec.fireMode === 'melee') {
      this.recoilBloom = Math.min(1, this.recoilBloom + spec.bloomPerShot)
      return true
    }
    const cur = this.magAmmo.get(spec.id) ?? 0
    if (cur <= 0) return false
    this.magAmmo.set(spec.id, cur - 1)
    const bloomMod = this.hasAttachment(spec.id, 'reflex') ? 0.72 : 1
    this.recoilBloom = Math.min(1.2, this.recoilBloom + spec.bloomPerShot * bloomMod)
    if (cur - 1 <= 0 && (this.reserveAmmo.get(spec.category) ?? 0) > 0) {
      this.startReload(weaponSkill)
    }
    return true
  }

  startReload(weaponSkill = 0): boolean {
    const spec = this.current
    if (spec.fireMode === 'melee' || this.reloadTimer > 0) return false
    const maxCap = this.effectiveMagSize(spec)
    const cur = this.magAmmo.get(spec.id) ?? 0
    const reserve = this.reserveAmmo.get(spec.category) ?? 0
    if (cur >= maxCap || reserve <= 0) return false
    const skillFactor = 1 - Math.min(0.35, (weaponSkill / 100) * 0.35)
    this.reloadTotal = Math.max(0.35, spec.reloadSeconds * skillFactor)
    this.reloadTimer = this.reloadTotal
    this.reloadingWeaponId = spec.id
    return true
  }

  addAmmo(category: WeaponCategoryId, amount: number): void {
    const prev = this.reserveAmmo.get(category) ?? 0
    this.reserveAmmo.set(category, Math.min(999, prev + Math.max(0, Math.floor(amount))))
  }

  update(dt: number): { reloadCompleted: boolean } {
    this.recoilBloom = Math.max(0, this.recoilBloom - dt * 1.45)
    if (this.reloadTimer > 0) {
      this.reloadTimer = Math.max(0, this.reloadTimer - dt)
      if (this.reloadTimer === 0 && this.reloadingWeaponId) {
        const spec = WEAPON_CATALOG.find(w => w.id === this.reloadingWeaponId)
        this.reloadingWeaponId = null
        if (spec) {
          const maxCap = this.effectiveMagSize(spec)
          const cur = this.magAmmo.get(spec.id) ?? 0
          const needed = Math.max(0, maxCap - cur)
          const reserve = this.reserveAmmo.get(spec.category) ?? 0
          const loaded = Math.min(needed, reserve)
          this.magAmmo.set(spec.id, cur + loaded)
          this.reserveAmmo.set(spec.category, reserve - loaded)
          return { reloadCompleted: true }
        }
      }
    }
    return { reloadCompleted: false }
  }

  toSaveState(): WeaponSaveState {
    const attachments: Record<string, AttachmentId[]> = {}
    for (const [id, set] of this.attachments) {
      if (set.size > 0) attachments[id] = [...set]
    }
    const reserveByCategory: Partial<Record<WeaponCategoryId, number>> = {}
    for (const [cat, amt] of this.reserveAmmo) reserveByCategory[cat] = amt
    return { equippedId: this.equippedId, attachments, reserveByCategory }
  }

  restoreFromSave(saved?: WeaponSaveState): void {
    if (!saved) return
    this.selectWeapon(saved.equippedId)
    this.attachments.clear()
    if (saved.attachments) {
      for (const [id, list] of Object.entries(saved.attachments)) {
        const spec = WEAPON_CATALOG.find(w => w.id === id)
        if (!spec || !Array.isArray(list)) continue
        const valid = list.filter((a): a is AttachmentId => spec.supportsAttachments.includes(a))
        if (valid.length > 0) this.attachments.set(id, new Set(valid))
      }
    }
    if (saved.reserveByCategory) {
      for (const [cat, amt] of Object.entries(saved.reserveByCategory)) {
        if (typeof amt === 'number' && Number.isFinite(amt)) {
          this.reserveAmmo.set(cat as WeaponCategoryId, Math.max(0, Math.min(999, Math.floor(amt))))
        }
      }
    }
    for (const w of WEAPON_CATALOG) {
      this.magAmmo.set(w.id, this.effectiveMagSize(w))
    }
  }
}
