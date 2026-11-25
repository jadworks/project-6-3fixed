import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { MissionDirector } from '../src/game/missionLogic'
import { loadCitySave, saveCityProgress } from '../src/game/saveSystem'
import { HeatSystem } from '../src/game/heatSystem'
import { CityLife } from '../src/game/cityLife'
import { persistPlayerState } from '../src/firebase/cloudStore'
import { hasLineOfSight, resolvePlayerCollision, resolveVehicleWorldCollision, supportHeightAt, worldRayDistance } from '../src/game/worldCollision'

afterEach(() => vi.unstubAllGlobals())
describe('Vice Bay contracts', () => {
  it('completes the introduction only after both checkpoints and grants the configured reward', () => {
    const director = new MissionDirector(new THREE.Scene())
    expect(director.start('intro')).toBe('WELCOME TO VICE BAY')
    expect(director.update(2, new THREE.Vector3(0, 0, -65), false, 0)).toBeNull()
    const result = director.update(3, new THREE.Vector3(-55, 0, -125), false, 0)
    expect(result).toMatchObject({ id: 'intro', reward: 2500, seconds: 5 })
    expect(director.current).toBeNull()
  })
  it('requires an actual vehicle and speed for the stunt', () => {
    const director = new MissionDirector(new THREE.Scene())
    director.start('stunt')
    const point = new THREE.Vector3(28, 0, 100)
    expect(director.update(1, point, false, 20)).toBeNull()
    expect(director.update(1, point, true, 2)).toBeNull()
    expect(director.update(1, point, true, 12)).toBeNull()
    expect(director.update(1, point, true, 12, true)?.reward).toBe(1500)
  })
  it('persists progress, player position/inventory/heat offline, and safely rejects corrupt saves', async () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) })
    const save = loadCitySave(); save.money = 4800; save.completed.push('race'); save.upgrade = 2; saveCityProgress(save)
    expect(loadCitySave()).toMatchObject({ money: 4800, completed: ['race'], upgrade: 2 })

    const result = await persistPlayerState(
      null,
      {
        position: { x: 14.5, y: 0.2, z: -42.25 },
        inventory: { ammo: 32, armor: 50, weapon: 'pistol', sprintTier: 2 },
        heat: { wanted: 3, phase: 'evading', lastKnownPos: { x: 10, z: -30 } },
      },
      save,
    )
    expect(result.syncedToCloud).toBe(false)
    const reloaded = loadCitySave()
    expect(reloaded.position).toEqual({ x: 14.5, y: 0.2, z: -42.25 })
    expect(reloaded.inventory).toEqual({ ammo: 32, armor: 50, weapon: 'pistol', sprintTier: 2 })
    expect(reloaded.heat).toEqual({ wanted: 3, phase: 'evading', lastKnownPos: { x: 10, z: -30 } })

    store.set('vicebay-nights.progress.v1', '{broken')
    expect(loadCitySave().money).toBe(1500)
  })
  it('stops shots at solid world geometry and checks line-of-sight cover', () => {
    const colliders = [{ center: new THREE.Vector3(0, 2, -10), halfExtents: new THREE.Vector3(3, 2, 2), rotationY: 0, kind: 'building' as const }]
    const start = new THREE.Vector3(0, 1, 0)
    expect(worldRayDistance(start, new THREE.Vector3(0, 0, -1), colliders, 60)).toBeCloseTo(8)
    expect(worldRayDistance(start, new THREE.Vector3(1, 0, 0), colliders, 60)).toBe(60)
    expect(hasLineOfSight(start, new THREE.Vector3(0, 1, -20), colliders)).toBe(false)
    expect(hasLineOfSight(start, new THREE.Vector3(10, 1, -20), colliders)).toBe(true)
  })
  it('slides actors cleanly along OBB walls and computes ramp support heights', () => {
    const colliders = [{ center: new THREE.Vector3(0, 3, -5), halfExtents: new THREE.Vector3(4, 3, 2), rotationY: 0, kind: 'building' as const }]
    const p = new THREE.Vector3(1.2, 0, -3.1)
    expect(resolvePlayerCollision(p, new THREE.Vector3(1.2, 0, -2.0), colliders, 0.44)).toBe(true)
    expect(p.z).toBeCloseTo(-2.56, 2)
    expect(p.x).toBeCloseTo(1.2, 2)

    const vehPos = new THREE.Vector3(0, 0, -2.5)
    const vel = new THREE.Vector3(5, 0, -10)
    const hit = resolveVehicleWorldCollision(vehPos, 0, 1.0, 2.0, colliders, vel, false)
    expect(hit.hit).toBe(true)
    expect(vel.x).toBeGreaterThan(3)

    const ramps = [{ position: new THREE.Vector3(28, 0, 100), width: 6, length: 12, rise: 3, rotationY: 0 }]
    expect(supportHeightAt(28, 100, 1.5, [], ramps, 0)).toBeCloseTo(1.5, 2)
  })
  it('models GTA 6 3.5s witness reporting, >45m escape cancel, 6-star escalation, vehicle swap cooldown, and safehouse clear', () => {
    const heat = new HeatSystem()
    const crimePos = new THREE.Vector3(10, 0, 20)
    const report = heat.reportCrime(crimePos, 1, { immediate: false, policeSeePlayer: false, witnessPresent: true })
    expect(report.dispatchStarted).toBe(true)
    expect(heat.phase).toBe('witness')
    expect(heat.wanted).toBe(0)

    // Still in 3.5s witness call at 3.0s
    const midStep = heat.update(3.0, crimePos, false, false)
    expect(midStep.dispatchConfirmed).toBe(false)
    expect(heat.phase).toBe('witness')

    // Confirms at >=3.5s
    const step1 = heat.update(0.6, crimePos, false, false)
    expect(step1.dispatchConfirmed).toBe(true)
    expect(heat.wanted).toBe(1)
    expect(heat.phase).toBe('evading')
    expect(heat.getHudState().dispatchBanner?.code).toBe('10-31')
    expect(heat.getSearchTarget(new THREE.Vector3(99, 0, 99))).toEqual(crimePos)

    expect(heat.onVehicleChanged({ id: 'new-car' })).toBe(true)
    heat.update(7.0, new THREE.Vector3(50, 0, 50), false, false)
    expect(heat.wanted).toBe(0)
    expect(heat.phase).toBe('clear')

    // Escaping beyond 45m cancels witness report before 3.5s
    heat.reportCrime(crimePos, 1, { immediate: false, policeSeePlayer: false, witnessPresent: true })
    expect(heat.phase).toBe('witness')
    heat.update(0.5, new THREE.Vector3(60, 0, 20), false, false)
    expect(heat.phase).toBe('clear')
    expect(heat.wanted).toBe(0)

    // 5-star to 6-star Military Lockdown escalation during sustained pursuit
    heat.reportCrime(new THREE.Vector3(0, 0, 0), 5, { immediate: true, policeSeePlayer: true })
    expect(heat.wanted).toBe(5)
    expect(heat.phase).toBe('pursuit')
    for (let i = 0; i < 160; i += 1) heat.update(0.1, new THREE.Vector3(0, 0, 0), true, false)
    expect(heat.wanted).toBe(6)
    expect(heat.getHudState().dispatchBanner?.code).toBe('CODE RED')

    expect(heat.clearAtSafehouse()).toBe(true)
    expect(heat.wanted).toBe(0)
  })
  it('simulates CityLife civilian 3.5s witness 911 calls, intimidation/KO cancellations, directional police radar cones, and roadblock spike strips', () => {
    const scene = new THREE.Scene()
    const life = new CityLife(scene)
    const crimeOrigin = new THREE.Vector3(11.5, 0.14, 0)

    // Start witness call near sidewalk pedestrians
    expect(life.notifyCrimeToWitnesses(crimeOrigin, 1)).toBe(true)
    life.update(0.1, crimeOrigin, 0)
    const activeEvent = life.consumeWitnessEvents()
    expect(activeEvent.blips.length).toBeGreaterThan(0)
    expect(activeEvent.completedReport).toBeNull()

    // Intimidation cancels active 911 report before 3.5s finishes
    expect(life.intimidateWitnesses(crimeOrigin, new THREE.Vector3(0, 0, 1), true)).toBe(true)
    expect(life.consumeWitnessEvents().cancelledReason).toBe('intimidated')

    // Complete a full 3.5s call (0.45s shock + 3.5s dial) with witness kept in sight
    expect(life.notifyCrimeToWitnesses(crimeOrigin, 2)).toBe(true)
    const witnessSpot = life.consumeWitnessEvents().blips[0]
    const closeSuspect = new THREE.Vector3(witnessSpot.x, 0.14, witnessSpot.z + 4)
    let completed = null as { x: number; z: number; severity: number } | null
    for (let i = 0; i < 45; i += 1) {
      life.update(0.1, closeSuspect, 0)
      const ev = life.consumeWitnessEvents()
      if (ev.completedReport) {
        completed = ev.completedReport
        break
      }
    }
    expect(completed).not.toBeNull()
    expect(completed?.severity).toBe(2)

    // Knocking down a witness with impact cancels 911 report
    expect(life.notifyCrimeToWitnesses(crimeOrigin, 1)).toBe(true)
    const nextWitness = life.consumeWitnessEvents().blips[0]
    life.impact(new THREE.Vector3(nextWitness.x, 0.2, nextWitness.z), 3, 8)
    expect(life.consumeWitnessEvents().cancelledReason).toBe('down')

    // 3+ star police radars include SWAT/patrol units and spike strips puncture tires near barricades
    life.update(0.1, new THREE.Vector3(0, 0, 0), 3, new THREE.Vector3(0, 0, 0))
    const radars3 = life.getPoliceRadars(new THREE.Vector3(0, 0, 0), 3)
    expect(radars3.some(r => r.kind === 'swat')).toBe(true)
    expect(radars3.every(r => r.fovDeg > 0 && r.range > 0)).toBe(true)

    // 6-star activates military APC radar unit
    life.update(0.1, new THREE.Vector3(0, 0, 0), 6, new THREE.Vector3(0, 0, 0))
    const radars6 = life.getPoliceRadars(new THREE.Vector3(0, 0, 0), 6)
    expect(radars6.some(r => r.kind === 'military')).toBe(true)

    // Roadblocks sit 32m ahead/behind search target along z; test spike strip hit at roadblock 0
    expect(life.checkSpikeStripHit(new THREE.Vector3(0, 0.4, 32), 3)).toBe(true)
  })
})
