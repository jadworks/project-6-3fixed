import { describe, expect, it } from 'vitest'
import {
  STORES_CATALOG,
  STORE_CATEGORY_LABELS,
  applyWastedEconomyPenalty,
  depositCashToBank,
  fenceUncleanedLoot,
  getStoreById,
  type StoreCategory,
} from '../src/game/storesCatalog'
import {
  HotZoneTracker,
  LOADOUT_LIMITS,
  bondBonusMultipliers,
  getConductTier,
  isHandgunWeapon,
  isLongGunWeapon,
  resolveNpcDialogue,
} from '../src/game/gta6Systems'
import { ViceWorld, type ViceWeather } from '../src/game/viceWorld'

describe('GTA 6 Open-World Mechanics & 20 Enterable Stores', () => {
  it('registers all 20 unique enterable stores spanning all 8 categories inside city bounds', () => {
    expect(STORES_CATALOG).toHaveLength(20)

    const ids = new Set(STORES_CATALOG.map(s => s.id))
    expect(ids.size).toBe(20)

    const categories = new Set(STORES_CATALOG.map(s => s.category))
    const expectedCategories = Object.keys(STORE_CATEGORY_LABELS) as StoreCategory[]
    expect(categories.size).toBe(expectedCategories.length)
    for (const cat of expectedCategories) {
      expect(categories.has(cat)).toBe(true)
    }

    for (const store of STORES_CATALOG) {
      expect(Math.abs(store.x)).toBeLessThan(380)
      expect(Math.abs(store.z)).toBeLessThan(380)
      expect(store.items.length).toBeGreaterThan(0)
      expect(getStoreById(store.id)).toBe(store)
    }
  })

  it('enforces the Three-Tier Economy: Bank deposit, Wasted penalty protection, and 85% Fencing', () => {
    const state = { money: 1200, bankBalance: 2000, uncleanedLoot: 1000 }

    const moved = depositCashToBank(state, 500)
    expect(moved).toBe(500)
    expect(state.money).toBe(700)
    expect(state.bankBalance).toBe(2500)

    const fenced = fenceUncleanedLoot(state, 0.85)
    expect(fenced).toEqual({ fencedGross: 1000, cleanPayout: 850 })
    expect(state.uncleanedLoot).toBe(0)
    expect(state.money).toBe(1550)

    // Give fresh uncleaned loot then simulate Wasted / Busted penalty
    state.uncleanedLoot = 640
    const penalty = applyWastedEconomyPenalty(state)
    expect(penalty).toEqual({ lostCash: 1550, lostLoot: 640, bankProtected: 2500 })
    expect(state.money).toBe(0)
    expect(state.uncleanedLoot).toBe(0)
    expect(state.bankBalance).toBe(2500)
  })

  it('computes all 5 Conduct Tiers, Partner Bond scaling, Loadout Sling limits, and NPC 4-tone dialogue', () => {
    expect(getConductTier(45)).toBe('Professional')
    expect(getConductTier(30)).toBe('Professional')
    expect(getConductTier(10)).toBe('Aggressive')
    expect(getConductTier(0)).toBe('Aggressive')
    expect(getConductTier(-15)).toBe('Violent')
    expect(getConductTier(-50)).toBe('Psycho')
    expect(getConductTier(-90)).toBe('Irredeemable')

    const lowBond = bondBonusMultipliers(0)
    const maxBond = bondBonusMultipliers(100)
    expect(lowBond.reloadBoost).toBe(0)
    expect(maxBond.reloadBoost).toBeCloseTo(0.25, 4)
    expect(maxBond.robberySpeedBoost).toBeCloseTo(0.4, 4)
    expect(maxBond.damageBoost).toBeCloseTo(0.2, 4)

    expect(LOADOUT_LIMITS.maxHandguns).toBe(2)
    expect(LOADOUT_LIMITS.maxLongGuns).toBe(2)
    expect(isHandgunWeapon('handgun')).toBe(true)
    expect(isHandgunWeapon('rifle')).toBe(false)
    expect(isLongGunWeapon('rifle')).toBe(true)
    expect(isLongGunWeapon('shotgun')).toBe(true)
    expect(isLongGunWeapon('handgun')).toBe(false)

    const greet = resolveNpcDialogue('greet', { masked: false, armed: false, conductScore: 0, witnessActive: false })
    expect(greet.conductDelta).toBeGreaterThan(0)
    expect(greet.cashGained).toBe(0)

    const defuse = resolveNpcDialogue('defuse', { masked: false, armed: false, conductScore: 0, witnessActive: true })
    expect(defuse.cancelledWitness).toBe(true)
    expect(defuse.conductDelta).toBeGreaterThan(0)

    const antagonize = resolveNpcDialogue('antagonize', { masked: false, armed: true, conductScore: 0, witnessActive: false })
    expect(antagonize.conductDelta).toBeLessThan(0)

    const threaten = resolveNpcDialogue('threaten', { masked: true, armed: true, conductScore: -20, witnessActive: true })
    expect(threaten.cashGained).toBeGreaterThanOrEqual(45)
    expect(threaten.cancelledWitness).toBe(true)
    expect(threaten.conductDelta).toBeLessThan(0)
  })

  it('tracks Hot Crime Zones and re-triggers APB only on matching unmasked outfit or plate', () => {
    const tracker = new HotZoneTracker()
    const now = 1_000_000
    tracker.addZone({
      id: 'mart-ocean',
      label: '24/7 Ocean Drive Market',
      x: 26,
      z: -44,
      radius: 46,
      durationSec: 75,
      loggedOutfitId: 'street-teal',
      loggedPlate: 'VICE-101',
    })

    // Masked & clean plate enters hot zone -> stays undetected (no APB trigger)
    const stealthCheck = tracker.checkReentry({ x: 26, z: -44 }, 'street-teal', 'CLEAN-99', true, now + 1000)
    expect(stealthCheck.inHotZone).toBe(true)
    expect(stealthCheck.triggeredApb).toBe(false)

    // Unmasked matching outfit inside hot zone -> triggers APB once
    const apbCheck = tracker.checkReentry({ x: 30, z: -40 }, 'street-teal', 'CLEAN-99', false, now + 2000)
    expect(apbCheck.inHotZone).toBe(true)
    expect(apbCheck.triggeredApb).toBe(true)
    expect(apbCheck.zoneLabel).toBe('24/7 Ocean Drive Market')

    // Subsequent check in same zone does not retrigger repeatedly
    const secondCheck = tracker.checkReentry({ x: 30, z: -40 }, 'street-teal', 'CLEAN-99', false, now + 3000)
    expect(secondCheck.triggeredApb).toBe(false)
  })

  it('supports extended weather presets (haze, fog, storm) and populates all 20 stores in ViceWorld', () => {
    const world = new ViceWorld()
    expect(world.stores).toHaveLength(20)

    const weathers: ViceWeather[] = ['day', 'sunset', 'overcast', 'haze', 'fog', 'rain', 'storm', 'night']
    for (const weather of weathers) {
      expect(() => world.update(0.1, world.spawn, weather)).not.toThrow()
    }
    expect(world.surfaceAt(150, 0)).toBe('water')
    expect(world.surfaceAt(0, 0)).toBe('asphalt')
  })
})
