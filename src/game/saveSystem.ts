import type { SanAndreasStatsSave } from './sanAndreasRpg'
import type { AttachmentId, WeaponCategoryId, WeaponSaveState } from './weapons'

export type PlayerPosition = { x: number; y: number; z: number }
export type PlayerInventory = { ammo: number; armor: number; weapon: string; sprintTier: number }
export type PlayerHeatSave = {
  wanted: number
  phase: 'clear' | 'witness' | 'pursuit' | 'evading'
  lastKnownPos: { x: number; z: number } | null
}
export type WeatherSave = 'day' | 'sunset' | 'rain' | 'night' | 'overcast' | 'haze' | 'fog' | 'storm'

export type CitySave = {
  version: 1
  money: number
  bankBalance?: number
  uncleanedLoot?: number
  health: number
  completed: string[]
  upgrade: number
  muted: boolean
  weather: WeatherSave
  robbedStores: string[]
  seenIntro?: boolean
  protagonist?: 'jason' | 'lucia'
  partnerBond?: number
  conductScore?: number
  fuelEnabled?: boolean
  trunkWeapons?: string[]
  tattoos?: string[]
  hairstyle?: string
  position?: PlayerPosition
  inventory?: PlayerInventory
  heat?: PlayerHeatSave
  rpgStats?: SanAndreasStatsSave
  weaponArsenal?: WeaponSaveState
  capturedTurfs?: string[]
}

const KEY = 'vicebay-nights.progress.v1'
const defaults = (): CitySave => ({
  version: 1,
  money: 1500,
  bankBalance: 2500,
  uncleanedLoot: 0,
  health: 100,
  completed: [],
  upgrade: 0,
  muted: false,
  weather: 'sunset',
  robbedStores: [],
  seenIntro: false,
  protagonist: 'jason',
  partnerBond: 32,
  conductScore: 0,
  fuelEnabled: true,
  trunkWeapons: ['carbine', 'pump_shotgun'],
})

function clampNum(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

export function sanitizePosition(raw: unknown): PlayerPosition | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const pos = raw as Record<string, unknown>
  if (typeof pos.x !== 'number' || typeof pos.z !== 'number') return undefined
  return {
    x: Math.round(clampNum(pos.x, -400, 400, 0) * 100) / 100,
    y: Math.round(clampNum(pos.y, -20, 80, 0) * 100) / 100,
    z: Math.round(clampNum(pos.z, -400, 400, 16) * 100) / 100,
  }
}

export function sanitizeInventory(raw: unknown, fallbackTier = 0): PlayerInventory | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const inv = raw as Record<string, unknown>
  const weapon = typeof inv.weapon === 'string' && /^[a-zA-Z0-9_-]{1,24}$/.test(inv.weapon) ? inv.weapon : 'pistol'
  return {
    ammo: Math.floor(clampNum(inv.ammo, 0, 999, 15)),
    armor: Math.floor(clampNum(inv.armor, 0, 100, 0)),
    weapon,
    sprintTier: Math.floor(clampNum(inv.sprintTier, 0, 3, fallbackTier)),
  }
}

export function sanitizeHeatSave(raw: unknown): PlayerHeatSave | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const h = raw as Record<string, unknown>
  const phase = h.phase === 'witness' || h.phase === 'pursuit' || h.phase === 'evading' || h.phase === 'clear' ? h.phase : 'clear'
  let lastKnownPos: { x: number; z: number } | null = null
  if (h.lastKnownPos && typeof h.lastKnownPos === 'object') {
    const lkp = h.lastKnownPos as Record<string, unknown>
    if (typeof lkp.x === 'number' && typeof lkp.z === 'number') {
      lastKnownPos = {
        x: Math.round(clampNum(lkp.x, -400, 400, 0) * 100) / 100,
        z: Math.round(clampNum(lkp.z, -400, 400, 0) * 100) / 100,
      }
    }
  }
  return {
    wanted: Math.floor(clampNum(h.wanted, 0, 6, 0)),
    phase,
    lastKnownPos,
  }
}

export function sanitizeRpgStats(raw: unknown): SanAndreasStatsSave | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const s = raw as Record<string, unknown>
  const round1 = (v: unknown, fb: number) => Math.round(clampNum(v, 0, 100, fb) * 10) / 10
  return {
    respect: round1(s.respect, 18),
    staminaSkill: round1(s.staminaSkill, 28),
    muscle: round1(s.muscle, 26),
    fat: round1(s.fat, 14),
    hunger: round1(s.hunger, 88),
    weaponSkill: round1(s.weaponSkill, 20),
    drivingSkill: round1(s.drivingSkill, 25),
  }
}

const VALID_CATEGORIES = new Set<WeaponCategoryId>(['melee', 'handgun', 'smg', 'shotgun', 'rifle', 'precision', 'heavy', 'throwable'])
const VALID_ATTACHMENTS = new Set<AttachmentId>(['suppressor', 'extMag', 'reflex'])

export function sanitizeWeaponArsenal(raw: unknown): WeaponSaveState | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const w = raw as Record<string, unknown>
  const equippedId = typeof w.equippedId === 'string' && /^[a-zA-Z0-9_-]{1,24}$/.test(w.equippedId) ? w.equippedId : 'pistol'
  const attachments: Record<string, AttachmentId[]> = {}
  if (w.attachments && typeof w.attachments === 'object') {
    for (const [key, val] of Object.entries(w.attachments as Record<string, unknown>).slice(0, 24)) {
      if (!/^[a-zA-Z0-9_-]{1,24}$/.test(key) || !Array.isArray(val)) continue
      const list = val.filter((a): a is AttachmentId => typeof a === 'string' && VALID_ATTACHMENTS.has(a as AttachmentId))
      if (list.length > 0) attachments[key] = list.slice(0, 3)
    }
  }
  const reserveByCategory: Partial<Record<WeaponCategoryId, number>> = {}
  if (w.reserveByCategory && typeof w.reserveByCategory === 'object') {
    for (const [cat, amt] of Object.entries(w.reserveByCategory as Record<string, unknown>)) {
      if (VALID_CATEGORIES.has(cat as WeaponCategoryId)) {
        reserveByCategory[cat as WeaponCategoryId] = Math.floor(clampNum(amt, 0, 999, 0))
      }
    }
  }
  return { equippedId, attachments, reserveByCategory }
}

export function sanitizeCapturedTurfs(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: string[] = []
  for (const item of raw) {
    if (typeof item === 'string' && /^[a-zA-Z0-9_-]{1,24}$/.test(item) && !out.includes(item)) {
      out.push(item)
      if (out.length >= 10) break
    }
  }
  return out
}

const VALID_WEATHERS = new Set<WeatherSave>(['day', 'sunset', 'rain', 'night', 'overcast', 'haze', 'fog', 'storm'])

export function loadCitySave(): CitySave {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaults()
    const value = JSON.parse(raw) as Partial<CitySave>
    if (value.version !== 1) return defaults()
    const upgrade = Number.isFinite(value.upgrade) ? Math.min(3, Math.max(0, Math.floor(value.upgrade!))) : 0
    const weather = typeof value.weather === 'string' && VALID_WEATHERS.has(value.weather as WeatherSave)
      ? (value.weather as WeatherSave)
      : 'sunset'
    const result: CitySave = {
      version: 1,
      money: Number.isFinite(value.money) ? Math.max(0, Math.floor(value.money!)) : 1500,
      bankBalance: Number.isFinite(value.bankBalance) ? Math.max(0, Math.floor(value.bankBalance!)) : 2500,
      uncleanedLoot: Number.isFinite(value.uncleanedLoot) ? Math.max(0, Math.floor(value.uncleanedLoot!)) : 0,
      health: Number.isFinite(value.health) ? Math.min(100, Math.max(0, value.health!)) : 100,
      completed: Array.isArray(value.completed) ? value.completed.filter((v): v is string => typeof v === 'string').slice(0, 100) : [],
      upgrade,
      muted: value.muted === true,
      weather,
      robbedStores: Array.isArray(value.robbedStores) ? value.robbedStores.filter((v): v is string => typeof v === 'string').slice(0, 24) : [],
      seenIntro: value.seenIntro === true,
      protagonist: value.protagonist === 'lucia' ? 'lucia' : 'jason',
      partnerBond: Number.isFinite(value.partnerBond) ? clampNum(value.partnerBond, 0, 100, 32) : 32,
      conductScore: Number.isFinite(value.conductScore) ? clampNum(value.conductScore, -100, 100, 0) : 0,
      fuelEnabled: value.fuelEnabled !== false,
      trunkWeapons: Array.isArray(value.trunkWeapons)
        ? value.trunkWeapons.filter((v): v is string => typeof v === 'string').slice(0, 16)
        : ['carbine', 'pump_shotgun'],
      tattoos: Array.isArray(value.tattoos) ? value.tattoos.filter((v): v is string => typeof v === 'string').slice(0, 10) : [],
      hairstyle: typeof value.hairstyle === 'string' ? value.hairstyle.slice(0, 24) : 'Default Cut',
    }
    const position = sanitizePosition(value.position)
    const inventory = sanitizeInventory(value.inventory, upgrade)
    const heat = sanitizeHeatSave(value.heat)
    const rpgStats = sanitizeRpgStats(value.rpgStats)
    const weaponArsenal = sanitizeWeaponArsenal(value.weaponArsenal)
    const capturedTurfs = sanitizeCapturedTurfs(value.capturedTurfs)
    if (position) result.position = position
    if (inventory) result.inventory = inventory
    if (heat) result.heat = heat
    if (rpgStats) result.rpgStats = rpgStats
    if (weaponArsenal) result.weaponArsenal = weaponArsenal
    if (capturedTurfs) result.capturedTurfs = capturedTurfs
    return result
  } catch { return defaults() }
}

const PENDING_SYNC_KEY = 'vicebay-nights.pending-cloud-sync.v1'

export function saveCityProgress(save: CitySave): void {
  try { localStorage.setItem(KEY, JSON.stringify(save)) } catch { /* Play remains available when storage is unavailable. */ }
}

export function markPendingCloudSync(): void {
  try { localStorage.setItem(PENDING_SYNC_KEY, String(Date.now())) } catch { /* Storage optional */ }
}

export function clearPendingCloudSync(): void {
  try { localStorage.removeItem(PENDING_SYNC_KEY) } catch { /* Storage optional */ }
}

export function hasPendingCloudSync(): boolean {
  try { return localStorage.getItem(PENDING_SYNC_KEY) !== null } catch { return false }
}
