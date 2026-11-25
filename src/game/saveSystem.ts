export type PlayerPosition = { x: number; y: number; z: number }
export type PlayerInventory = { ammo: number; armor: number; weapon: string; sprintTier: number }
export type PlayerHeatSave = {
  wanted: number
  phase: 'clear' | 'witness' | 'pursuit' | 'evading'
  lastKnownPos: { x: number; z: number } | null
}

export type CitySave = {
  version: 1
  money: number
  health: number
  completed: string[]
  upgrade: number
  muted: boolean
  weather: 'day' | 'sunset' | 'rain' | 'night'
  robbedStores: string[]
  seenIntro?: boolean
  position?: PlayerPosition
  inventory?: PlayerInventory
  heat?: PlayerHeatSave
}

const KEY = 'vicebay-nights.progress.v1'
const defaults = (): CitySave => ({ version: 1, money: 1500, health: 100, completed: [], upgrade: 0, muted: false, weather: 'sunset', robbedStores: [], seenIntro: false })

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

export function loadCitySave(): CitySave {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaults()
    const value = JSON.parse(raw) as Partial<CitySave>
    if (value.version !== 1) return defaults()
    const upgrade = Number.isFinite(value.upgrade) ? Math.min(3, Math.max(0, Math.floor(value.upgrade!))) : 0
    const result: CitySave = {
      version: 1,
      money: Number.isFinite(value.money) ? Math.max(0, Math.floor(value.money!)) : 1500,
      health: Number.isFinite(value.health) ? Math.min(100, Math.max(0, value.health!)) : 100,
      completed: Array.isArray(value.completed) ? value.completed.filter((v): v is string => typeof v === 'string').slice(0, 100) : [],
      upgrade,
      muted: value.muted === true,
      weather: value.weather === 'day' || value.weather === 'sunset' || value.weather === 'rain' || value.weather === 'night' ? value.weather : 'sunset',
      robbedStores: Array.isArray(value.robbedStores) ? value.robbedStores.filter((v): v is string => typeof v === 'string').slice(0, 5) : [],
      seenIntro: value.seenIntro === true,
    }
    const position = sanitizePosition(value.position)
    const inventory = sanitizeInventory(value.inventory, upgrade)
    const heat = sanitizeHeatSave(value.heat)
    if (position) result.position = position
    if (inventory) result.inventory = inventory
    if (heat) result.heat = heat
    return result
  } catch { return defaults() }
}

export function saveCityProgress(save: CitySave): void {
  try { localStorage.setItem(KEY, JSON.stringify(save)) } catch { /* Play remains available when storage is unavailable. */ }
}
