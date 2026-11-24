import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { MissionDirector } from '../src/game/missionLogic'
import { loadCitySave, saveCityProgress } from '../src/game/saveSystem'
import { HeatSystem } from '../src/game/heatSystem'
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
  it('persists progress and safely rejects corrupt saves', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) })
    const save = loadCitySave(); save.money = 4800; save.completed.push('race'); save.upgrade = 2; saveCityProgress(save)
    expect(loadCitySave()).toMatchObject({ money: 4800, completed: ['race'], upgrade: 2 })
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
  it('models GTA 6 witness reporting, pursuit LKP evasion, vehicle swap cooldown, and safehouse clear', () => {
    const heat = new HeatSystem()
    const crimePos = new THREE.Vector3(10, 0, 20)
    const report = heat.reportCrime(crimePos, 1, { immediate: false, policeSeePlayer: false, witnessPresent: true })
    expect(report.dispatchStarted).toBe(true)
    expect(heat.phase).toBe('witness')
    expect(heat.wanted).toBe(0)

    const step1 = heat.update(3.0, crimePos, false, false)
    expect(step1.dispatchConfirmed).toBe(true)
    expect(heat.wanted).toBe(1)
    expect(heat.phase).toBe('evading')
    expect(heat.getSearchTarget(new THREE.Vector3(99, 0, 99))).toEqual(crimePos)

    expect(heat.onVehicleChanged({ id: 'new-car' })).toBe(true)
    heat.update(7.0, new THREE.Vector3(50, 0, 50), false, false)
    expect(heat.wanted).toBe(0)
    expect(heat.phase).toBe('clear')

    heat.reportCrime(new THREE.Vector3(0, 0, 0), 3, { immediate: true, policeSeePlayer: true })
    expect(heat.wanted).toBe(3)
    expect(heat.phase).toBe('pursuit')
    expect(heat.clearAtSafehouse()).toBe(true)
    expect(heat.wanted).toBe(0)
  })
})
