import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { MissionDirector } from '../src/game/missionLogic'
import {
  clearPendingCloudSync,
  hasPendingCloudSync,
  loadCitySave,
  markPendingCloudSync,
  saveCityProgress,
} from '../src/game/saveSystem'
import { DEFAULT_CONFIG } from '../src/game/config'
import { HeatSystem } from '../src/game/heatSystem'
import { CityLife } from '../src/game/cityLife'
import { PoliceKnowledgeSystem } from '../src/game/policeKnowledge'
import { persistPlayerState } from '../src/firebase/cloudStore'
import { hasLineOfSight, resolvePlayerCollision, resolveVehicleWorldCollision, supportHeightAt, worldRayDistance } from '../src/game/worldCollision'
import { WitnessManager } from '../src/game/witnessManager'
import { WEAPON_SECTORS, WeaponArsenal } from '../src/game/weapons'
import { SanAndreasRpg } from '../src/game/sanAndreasRpg'
import { GangTurfSystem } from '../src/game/gangTurf'
import { getCooldownRemaining, getStoreStatus } from '../src/game/storeWorld'
import { applyFallImpactRagdoll, createRagdollRig, stepRagdoll } from '../src/game/ragdoll'
import { WantedHUD } from '../src/components/WantedHUD'

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

  it('stages newly dispatched cops far down the street with a response delay before closing in and firing', () => {
    const scene = new THREE.Scene()
    const life = new CityLife(scene)
    const origin = new THREE.Vector3(0, 0.2, 16)

    // Initial crime dispatch transitions wanted 0 -> 1: cops spawn far away and take time before firing
    life.update(0.1, origin, 1, origin)
    expect(life.getDispatchEta()).toBeGreaterThan(4.5)
    expect(life.nearestPursuerDistance(origin, 1)).toBeGreaterThan(55)
    expect(life.getDamage(origin, 0.1, 1)).toBe(0)

    // HeatSystem indicates dispatch en route until police arrive in line-of-sight
    const heat = new HeatSystem()
    heat.reportCrime(origin, 1, { immediate: true, policeSeePlayer: false })
    expect(heat.inSight).toBe(false)
    expect(heat.getHudState().statusText).toContain('DISPATCH EN ROUTE')
  })

  it('WitnessManager checks 45m LOS radius, runs 3.5s 911 state machine, and emits dispatch/cancelled events', () => {
    const wm = new WitnessManager()
    const wall = { center: new THREE.Vector3(0, 2, -10), halfExtents: new THREE.Vector3(4, 2, 1), rotationY: 0, kind: 'building' as const }
    wm.setWorldColliders([wall])
    wm.registerNpc('blocked', new THREE.Vector3(0, 0, -18), true)
    wm.registerNpc('far', new THREE.Vector3(50, 0, 0), true)
    wm.registerNpc('near', new THREE.Vector3(12, 0, 0), true)

    const startedEvents: string[] = []
    const dispatchEvents: string[] = []
    const cancelReasons: string[] = []
    wm.on('started', ev => startedEvents.push(ev.witnessId))
    wm.on('dispatch', ev => dispatchEvents.push(ev.code))
    wm.on('cancelled', ev => cancelReasons.push(ev.reason))

    // Blocked by building & >45m NPCs are ignored; only 'near' observes
    const res = wm.notifyCrime(new THREE.Vector3(0, 0, 0), 2)
    expect(res.started).toBe(true)
    expect(res.witnessId).toBe('near')
    expect(startedEvents).toEqual(['near'])

    // Advance through 0.45s shock + 3.5s calling 911
    for (let i = 0; i < 42; i += 1) wm.update(0.1, new THREE.Vector3(2, 0, 0))
    expect(dispatchEvents).toEqual(['10-78'])

    // Escaping >45m aborts an active 911 call
    wm.notifyCrime(new THREE.Vector3(0, 0, 0), 1)
    wm.update(0.6, new THREE.Vector3(2, 0, 0))
    wm.update(0.1, new THREE.Vector3(80, 0, 0))
    expect(cancelReasons).toContain('escaped')
  })

  it('WantedHUD renders 5-star and 6-star lockdown states with pursuit pulsing vs cooldown fading', () => {
    const createStubEl = () => {
      const classes = new Set<string>()
      const attrs = new Map<string, string>()
      const styleMap = new Map<string, string>()
      const el: Record<string, any> = {
        className: '',
        hidden: false,
        textContent: '',
        dataset: {} as Record<string, string>,
        children: [] as any[],
        classList: {
          add: (c: string) => classes.add(c),
          toggle: (c: string, force?: boolean) => {
            const next = force === undefined ? !classes.has(c) : force
            if (next) classes.add(c)
            else classes.delete(c)
          },
          contains: (c: string) => classes.has(c),
        },
        style: {
          width: '',
          strokeDasharray: '',
          strokeDashoffset: '',
          setProperty: (k: string, v: string) => styleMap.set(k, v),
          removeProperty: (k: string) => styleMap.delete(k),
          getPropertyValue: (k: string) => styleMap.get(k) ?? '',
        },
        setAttribute: (k: string, v: string) => attrs.set(k, v),
        getAttribute: (k: string) => attrs.get(k) ?? null,
        remove: () => {},
        querySelector: (sel: string) => el.querySelectorAll(sel)[0] ?? null,
        querySelectorAll: (sel: string) => {
          if (sel === '[data-wanted]') return [starsEl]
          if (sel === '[data-wanted-segment]') return starSegs
          if (sel === '[data-heat-wrap]') return [heatWrap]
          if (sel === '[data-value="heat-status"]') return [heatStatus]
          if (sel === '[data-heat-fill]') return [heatFill]
          if (sel === '[data-heat-ring]') return [heatRing]
          return []
        },
      }
      return el
    }
    const starsEl = createStubEl()
    const starSegs = Array.from({ length: 6 }, () => createStubEl())
    const heatWrap = createStubEl()
    const heatStatus = createStubEl()
    const heatFill = createStubEl()
    const heatRing = createStubEl()
    const rootEl = createStubEl()
    let calls = 0
    vi.stubGlobal('document', {
      createElement: () => {
        calls += 1
        return calls === 1 ? rootEl : createStubEl()
      },
    })

    const hud = new WantedHUD()
    hud.update(3, {
      wanted: 3,
      phase: 'pursuit',
      inSight: true,
      statusText: 'ACTIVE PURSUIT · SWAT ALERT',
      witnessProgress: 0,
      cooldownProgress: 0,
      reinforcementProgress: 0.4,
      searchRadius: 48,
      lkp: null,
      witnesses: [],
      dispatchBanner: null,
    })
    expect(starsEl.classList.contains('is-pursuit')).toBe(true)
    expect(starsEl.classList.contains('is-evading')).toBe(false)
    expect(starSegs.filter(s => s.classList.contains('is-lit')).length).toBe(3)
    expect(starSegs[5].hidden).toBe(true)

    hud.update(6, {
      wanted: 6,
      phase: 'evading',
      inSight: false,
      statusText: 'SEARCHING',
      witnessProgress: 0,
      cooldownProgress: 0.6,
      reinforcementProgress: 0,
      searchRadius: 56,
      lkp: { x: 0, z: 0 },
      witnesses: [],
      dispatchBanner: null,
    })
    expect(starsEl.classList.contains('is-evading')).toBe(true)
    expect(starsEl.classList.contains('is-lockdown')).toBe(true)
    expect(starSegs[5].hidden).toBe(false)
    expect(Number(starsEl.style.getPropertyValue('--evade-fade'))).toBeCloseTo(0.61, 2)
    expect(Number(heatRing.style.strokeDashoffset)).toBeGreaterThan(0)
  })

  it('WeaponArsenal supports 8 sectors, tactical attachments, spread/recoil modifiers, and skill-scaled reload', () => {
    expect(WEAPON_SECTORS.length).toBe(8)
    const arsenal = new WeaponArsenal()
    expect(arsenal.current.id).toBe('pistol')

    // Sector selection & attachments
    const carbine = arsenal.selectSector(4)
    expect(carbine.id).toBe('carbine')
    const baseSpread = arsenal.effectiveSpread(carbine, { aiming: false, crouching: false, sprinting: false, weaponSkill: 0 })
    const baseNoise = arsenal.effectiveNoiseRadius(carbine)
    const baseMag = arsenal.effectiveMagSize(carbine)

    expect(arsenal.toggleAttachment('suppressor')).toBe(true)
    expect(arsenal.toggleAttachment('extMag')).toBe(true)
    expect(arsenal.toggleAttachment('reflex')).toBe(true)

    expect(arsenal.effectiveNoiseRadius(carbine)).toBeLessThan(baseNoise)
    expect(arsenal.effectiveMagSize(carbine)).toBeGreaterThan(baseMag)
    expect(arsenal.effectiveSpread(carbine, { aiming: true, crouching: false, sprinting: false, weaponSkill: 80 })).toBeLessThan(baseSpread)

    // Consume and reload
    arsenal.consumeRound(80)
    expect(arsenal.getAmmoDisplay().mag).toBe(arsenal.effectiveMagSize(carbine) - 1)
    expect(arsenal.startReload(80)).toBe(true)
    for (let i = 0; i < 20; i += 1) arsenal.update(0.1)
    expect(arsenal.getAmmoDisplay().mag).toBe(arsenal.effectiveMagSize(carbine))
  })

  it('SanAndreasRpg tracks Respect homie cap, Gym/Food Muscle+Fat+Hunger, Weapon tiers, and Driving bonus', () => {
    const rpg = new SanAndreasRpg()
    expect(rpg.maxHomies).toBe(2)
    expect(rpg.weaponTier).toBe('POOR')

    const m0 = rpg.muscle
    rpg.recordGymRep('bench')
    expect(rpg.muscle).toBeGreaterThan(m0)

    rpg.hunger = 10
    rpg.eatMeal(60)
    expect(rpg.hunger).toBe(70)
    expect(rpg.stamina).toBe(100)

    for (let i = 0; i < 35; i += 1) rpg.recordWeaponHit(true, true)
    expect(rpg.weaponTier).toBe('HITMAN')
    expect(rpg.drivingHandlingBonus).toBeGreaterThan(0)

    rpg.recordTurfCapture()
    rpg.recordTurfCapture()
    rpg.recordTurfCapture()
    expect(rpg.maxHomies).toBeGreaterThanOrEqual(4)
  })

  it('GangTurfSystem manages 4 districts, recruits allied homies up to Respect cap, and resolves 3-wave Turf Wars', () => {
    const turf = new GangTurfSystem(new THREE.Scene())
    expect(turf.zones.length).toBe(4)

    // Strip starts allied with 4 homies near (0, 10)
    const rec = turf.recruitNearby(new THREE.Vector3(0, 0, 10), 3)
    expect(rec.recruitedNow).toBe(3)
    expect(turf.recruitedCount).toBe(3)

    // Provoke & clear a 3-wave Turf War in Downtown (-64, -108)
    const downtown = turf.zones.find(z => z.id === 'downtown')!
    expect(downtown.faction).toBe('syndicate')

    let captured = false
    for (let sweep = 0; sweep < 40 && !captured; sweep += 1) {
      const rivals = turf.getRivalPositions()
      for (const r of rivals) {
        if (Math.hypot(r.x - downtown.x, r.z - downtown.z) > 40) continue
        const origin = new THREE.Vector3(r.x, 1.75, r.z + 2)
        const res = turf.shootBallistic(origin, new THREE.Vector3(0, 0, -1), 10, 120, 1)
        if (res.capturedZone?.id === 'downtown') {
          captured = true
          break
        }
      }
    }
    expect(captured).toBe(true)
    expect(downtown.faction).toBe('allied')
    expect(turf.capturedIds).toContain('downtown')

    const benefits = turf.getAlliedBenefits()
    expect(benefits.capturedCount).toBeGreaterThanOrEqual(2)
    expect(benefits.passiveCashPerMin).toBeGreaterThan(0)
    expect(benefits.storeDiscountPct).toBeGreaterThan(0)
  })

  it('supports configurable 5-10s police dispatch latency, recognition clue shrinking, and LKP non-telepathic search', () => {
    expect(DEFAULT_CONFIG.police.dispatchLatencySeconds).toBeGreaterThanOrEqual(5)
    expect(DEFAULT_CONFIG.police.dispatchLatencySeconds).toBeLessThanOrEqual(10)

    const customHeat = new HeatSystem({ dispatchLatencySeconds: 8.5 })
    const crimePos = new THREE.Vector3(0, 0, 10)
    customHeat.reportCrime(crimePos, 1, { immediate: true, policeSeePlayer: false })
    expect(customHeat.getDispatchEta()).toBeCloseTo(8.5, 2)
    expect(customHeat.getHudState().dispatchEta).toBeCloseTo(8.5, 2)
    expect(customHeat.getHudState().statusText).toContain('8.5S')

    customHeat.update(4.0, new THREE.Vector3(35, 0, 10), false, false)
    expect(customHeat.getDispatchEta()).toBeCloseTo(4.5, 2)

    const knowledge = new PoliceKnowledgeSystem()
    knowledge.recordSighting({
      masked: false,
      outfit: knowledge.currentOutfit,
      brandishedWeaponClass: 'handgun',
      vehicle: { model: 'Comet', color: 'Red', plateNumber: 'HOT-101', damageState: 'Intact' },
    })
    knowledge.toggleMask()
    knowledge.cycleOutfit(false)
    const mods = knowledge.recognitionModifiers('CLEAN-999')
    expect(mods.rangeMult).toBeLessThan(0.75)
    expect(mods.fovMult).toBeLessThan(0.95)

    const life = new CityLife(new THREE.Scene())
    life.setDispatchLatency(8.0)
    const hiddenPlayer = new THREE.Vector3(240, 0.2, 240)
    const lkp = new THREE.Vector3(0, 0.2, 0)
    life.update(0.1, hiddenPlayer, 2, lkp, true)
    expect(life.getDispatchEta()).toBeCloseTo(7.9, 1)
    const policeBlips = life.getPoliceBlips()
    expect(policeBlips.length).toBeGreaterThan(0)
    expect(policeBlips.some(b => Math.hypot(b.x - hiddenPlayer.x, b.z - hiddenPlayer.z) < 35)).toBe(false)
    const shrunkRadars = life.getPoliceRadars(hiddenPlayer, 2, mods)
    const baseRadars = life.getPoliceRadars(hiddenPlayer, 2)
    if (shrunkRadars.length > 0 && baseRadars.length > 0) {
      expect(shrunkRadars[0].range).toBeLessThan(baseRadars[0].range)
    }
  })

  it('tracks store status/cooldowns, RPG robbery & heat-evasion progression, ragdoll limb recovery, and pending cloud sync flags', () => {
    expect(getStoreStatus({ holdupActive: true, alarmTriggered: false, robbedCooldown: 0 })).toBe('holdup_active')
    expect(getStoreStatus({ holdupActive: false, alarmTriggered: true, robbedCooldown: 0 })).toBe('alarm_locked')
    expect(getStoreStatus({ holdupActive: false, alarmTriggered: false, robbedCooldown: 18.2 })).toBe('robbed_cooldown')
    expect(getStoreStatus({ holdupActive: false, alarmTriggered: false, robbedCooldown: 0 })).toBe('open')
    expect(getCooldownRemaining({ robbedCooldown: 18.2 })).toBe(19)

    const rpg = new SanAndreasRpg()
    const baseRespect = rpg.respect
    rpg.recordRobbery(900, true)
    rpg.recordEvadeHeat(3)
    expect(rpg.respect).toBeGreaterThan(baseRespect)

    const rig = createRagdollRig()
    const pos = new THREE.Vector3(0, 0.04, 0)
    expect(applyFallImpactRagdoll(rig, pos, -8.5)).toBe(true)
    expect(rig.state).toBe('falling')

    rig.state = 'recovering'
    rig.stateTimer = 0.2
    const nodes = {
      root: new THREE.Group(),
      model: new THREE.Group(),
      leftArm: new THREE.Group(),
      rightArm: new THREE.Group(),
      leftLeg: new THREE.Group(),
      rightLeg: new THREE.Group(),
    }
    nodes.leftArm.rotation.x = -1.2
    nodes.rightLeg.rotation.x = 0.6
    stepRagdoll(rig, nodes, 0.1)
    expect(Math.abs(nodes.leftArm.rotation.x)).toBeLessThan(1.2)
    expect(Math.abs(nodes.rightLeg.rotation.x)).toBeLessThan(0.6)
    stepRagdoll(rig, nodes, 0.15)
    expect(rig.state).toBe('upright')
    expect(nodes.leftArm.rotation.x).toBe(0)
    expect(nodes.rightLeg.rotation.x).toBe(0)

    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    })
    expect(hasPendingCloudSync()).toBe(false)
    markPendingCloudSync()
    expect(hasPendingCloudSync()).toBe(true)
    clearPendingCloudSync()
    expect(hasPendingCloudSync()).toBe(false)
  })
})
