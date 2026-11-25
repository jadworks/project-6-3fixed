import * as THREE from 'three'
import { Renderer } from '../engine/renderer'
import { Input } from '../engine/input'
import { ViceAudio } from '../engine/viceAudio'
import { GameHud } from '../components/GameHud'
import { ViceWorld, type ViceWeather } from './viceWorld'
import { VicePlayer } from './vicePlayer'
import { VehicleSystem } from './vehicles'
import { CityLife } from './cityLife'
import { MissionDirector } from './missionLogic'
import { WorldProps } from './worldProps'
import { loadCitySave, saveCityProgress } from './saveSystem'
import { CutsceneDirector, type CutsceneId, playMissionCard } from './cutscene'
import { HeatSystem } from './heatSystem'
import { OnlineLeaderboard } from './onlineLeaderboard'
import { signInWithGoogle, signOutPlayer, subscribeAuth } from '../firebase/client'
import { loadCloudPlayerSave, mergeCitySaves, persistPlayerState } from '../firebase/cloudStore'
import type { User } from 'firebase/auth'
import { resolvePlayerCollision, supportHeightAt, worldRayDistance } from './worldCollision'
import { CONFIG } from './config'
import { tuning } from './tuning'
import { type AttachmentId, WeaponArsenal, type WeaponSpec } from './weapons'
import { SanAndreasRpg } from './sanAndreasRpg'
import { GangTurfSystem, type TurfZoneState } from './gangTurf'
import { PoliceKnowledgeSystem } from './policeKnowledge'
import type { PhoneRingtone } from '../components/SmartphoneHud'
import { TouchControls } from '../components/TouchControls'
import { WEAPON_CATALOG } from './weapons'

type Mode = 'title' | 'playing' | 'pause' | 'map' | 'cutscene'
type Tracer = { mesh: THREE.Line; life: number }
type ThrownProjectile = {
  mesh: THREE.Mesh
  velocity: THREE.Vector3
  life: number
  kind: 'frag' | 'flashbang' | 'grenade_launcher'
  damage: number
  radius: number
  impactDetonate: boolean
}
const WEATHERS = ['day', 'sunset', 'overcast', 'rain', 'night'] as const

export class ViceGame {
  readonly world = new ViceWorld()
  readonly player = new VicePlayer(this.world.spawn)
  readonly vehicles = new VehicleSystem(this.world.scene)
  readonly life = new CityLife(this.world.scene)
  readonly missions = new MissionDirector(this.world.scene)
  readonly props = new WorldProps(this.world.scene)
  readonly heat = new HeatSystem()
  readonly rpg = new SanAndreasRpg()
  readonly arsenal = new WeaponArsenal()
  readonly turf = new GangTurfSystem(this.world.scene)
  readonly knowledge = new PoliceKnowledgeSystem()
  readonly cutscenes: CutsceneDirector
  readonly save = loadCitySave()
  readonly camera = new THREE.PerspectiveCamera(60, 1, .1, 980)
  readonly ui: GameHud
  readonly touchControls: TouchControls
  mode: Mode = 'title'
  private yaw = 0
  private pitch = .2
  private elapsed = 0
  private readonly robbedStores: Set<string>
  private shotCooldown = 0
  private hitCooldown = 0
  private rampCooldown = 0
  private lockLostAt = 0
  private saveTimer = 0
  private weaponHotTimer = 0
  private aimingRightMouse = false
  private wheelOpen = false
  private wheelPinned = false
  private statsOpen = false
  private phoneOpen = false
  private holstered = false
  private prevPadLabel = ''
  private playerArmor = 0
  private grittyFilter = true
  private ringtone: PhoneRingtone = 'classic'
  private latestPhoto: string | null = null
  private photoCount = 0
  private capturePhotoNextRender = false
  private crankSoundCooldown = 0
  private prevEngineStalled = false
  private currentTimeLabel = '16:13'
  private taxiRide: { dest: 'objective' | 'safehouse' | 'respray'; target: THREE.Vector3; label: string; cabPos: THREE.Vector3; cabHeading: number } | null = null
  private lastHailedCabPos: THREE.Vector3 | null = null
  private lastSavedPos = new THREE.Vector3()
  private lastSavedWanted = 0
  private lastSavedWeapon = 'pistol'
  private lastSavedAmmo = 15
  private cutsceneSkipGuard = 0
  private cutsceneWeather?: ViceWeather
  private pendingMissionTitle = ''
  private tracers: Tracer[] = []
  private projectiles: ThrownProjectile[] = []
  private flashTime = 0
  private readonly muzzleFlash = new THREE.Mesh(new THREE.SphereGeometry(.3, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffdc75 }))
  private readonly projGeo = new THREE.SphereGeometry(0.14, 10, 8)
  private objectiveBeacon: THREE.Group
  private readonly board = new OnlineLeaderboard(message => this.ui.toast(message))
  private currentUser: User | null = null

  constructor(private readonly renderer: Renderer, private readonly input: Input, private readonly audio: ViceAudio, root: HTMLElement) {
    this.renderer.attachEnvironment(this.world.scene)
    this.vehicles.setWorldGeometry(this.world.colliders, this.world.ramps)
    this.life.setWorldColliders(this.world.colliders)
    this.turf.setWorldColliders(this.world.colliders)
    this.cutscenes = new CutsceneDirector(this.world.scene, this.audio)

    this.world.scene.add(this.player.root)
    this.muzzleFlash.visible = false; this.world.scene.add(this.muzzleFlash)
    this.applySavedPlayerState()
    this.robbedStores = new Set(this.save.robbedStores)
    this.audio.muted = this.save.muted
    this.camera.position.set(this.player.root.position.x, this.player.root.position.y + 7, this.player.root.position.z + 12)
    this.objectiveBeacon = new THREE.Group()
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2, .13, 8, 32), new THREE.MeshBasicMaterial({ color: 0xffdc47 }))
    ring.rotation.x = Math.PI / 2; ring.position.y = .15
    const light = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.1, 3.5, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xffdf4d, transparent: true, opacity: .2, depthWrite: false, side: THREE.DoubleSide }))
    light.position.y = 1.75; this.objectiveBeacon.add(ring, light); this.objectiveBeacon.position.set(-8, 0, 0); this.world.scene.add(this.objectiveBeacon)

    this.ui = new GameHud(root, {
      start: () => this.start(),
      resume: () => this.resume(),
      map: () => this.openMap(),
      audio: () => { this.save.muted = this.audio.toggle(); this.persist(); this.ui.toast(this.save.muted ? 'Audio muted' : 'Audio on') },
      weather: () => this.cycleWeather(),
      mission: id => this.startMission(id),
      quit: () => this.quit(),
      leaderboard: () => this.board.list(),
      retryLeaderboard: () => this.board.retry(),
      skipCutscene: () => this.skipCutscene(),
      replayIntro: () => this.playOpeningCutscene(),
      auth: () => void this.toggleAuth(),
      togglePhone: () => this.togglePhone(),
      toggleTouch: () => {
        const pref = this.touchControls.cyclePreference()
        this.ui.setTouchModeLabel(pref)
        this.ui.toast(`Touch Controls: ${pref.toUpperCase()}`)
      },
      combat: {
        selectSector: (idx, cycle) => {
          const w = this.arsenal.selectSector(idx, cycle)
          this.holstered = false
          this.player.setHolstered(false)
          this.syncWeaponVisual()
          if (this.wheelPinned && !cycle) {
            this.wheelPinned = false
            this.wheelOpen = false
          }
          this.ui.toast(`EQUIPPED: ${w.name.toUpperCase()}`)
        },
        selectWeapon: id => {
          const w = this.arsenal.selectWeapon(id)
          this.holstered = false
          this.player.setHolstered(false)
          this.syncWeaponVisual()
          if (this.wheelPinned) {
            this.wheelPinned = false
            this.wheelOpen = false
          }
          this.ui.toast(`EQUIPPED: ${w.name.toUpperCase()}`)
        },
        toggleAttachment: att => this.toggleWeaponAttachment(att),
        closeWheel: () => {
          this.wheelOpen = false
          this.wheelPinned = false
          if (this.mode === 'playing' && !this.phoneOpen) this.input.lockPointer()
        },
        closeStats: () => {
          this.statsOpen = false
        },
      },
      phone: {
        onKeyBeep: () => this.audio.phoneTone('beep'),
        onCall911: service => this.handlePhone911(service),
        onCallCab: () => this.handlePhoneCallCab(),
        onRideCab: dest => this.handlePhoneRideCab(dest),
        onSkipRide: dest => this.handlePhoneSkipRide(dest),
        onCallJacob: order => this.handlePhoneJacob(order),
        onTakePhoto: () => {
          this.capturePhotoNextRender = true
          this.audio.phoneTone('shutter')
          this.ui.toast('SNAPMATIC CAPTURED')
        },
        onToggleFilter: () => {
          this.grittyFilter = !this.grittyFilter
          this.ui.toast(`Liberty City Filter: ${this.grittyFilter ? 'ON' : 'OFF'}`)
        },
        onCycleWeather: () => this.cycleWeather(),
        onCycleRingtone: () => {
          const order: PhoneRingtone[] = ['classic', 'chime', 'silent']
          this.ringtone = order[(order.indexOf(this.ringtone) + 1) % order.length]
          if (this.ringtone !== 'silent') this.audio.phoneTone('ring')
          return this.ringtone
        },
        onClose: () => this.setPhoneOpen(false),
      },
    })

    this.touchControls = new TouchControls(this.ui.gamePanel, this.input, {
      onToggleWheel: () => {
        if (this.mode !== 'playing') return
        this.wheelPinned = !this.wheelPinned
        if (this.wheelPinned) this.phoneOpen = false
      },
      onInteractOrVehicle: () => {
        if (this.mode !== 'playing') return
        if (!this.interact()) this.toggleVehicle()
      },
      onEnterExitVehicle: () => {
        if (this.mode !== 'playing') return
        this.toggleVehicle()
      },
      onTogglePhone: () => this.togglePhone(),
      onToggleCover: () => {
        if (this.mode !== 'playing' || this.vehicles.active) return
        const carCoords = this.vehicles.vehicles.map(v => ({
          x: v.root.position.x,
          z: v.root.position.z,
          heading: v.heading,
          halfWidth: 1.05,
        }))
        const inCover = this.player.toggleCover(this.world.colliders, carCoords)
        if (inCover) {
          this.ui.toast(this.player.cover.coverBehindCar ? 'COVER BEHIND CAR' : 'IN COVER')
        }
      },
      onToggleMask: () => {
        if (this.mode !== 'playing') return
        const masked = this.knowledge.toggleMask()
        this.player.setMasked(masked)
        this.ui.toast(masked ? 'BANDANA MASK ON' : 'BANDANA MASK OFF')
      },
      onToggleStats: () => {
        if (this.mode === 'playing') this.statsOpen = !this.statsOpen
      },
      onRecruit: () => {
        if (this.mode !== 'playing') return
        const res = this.turf.recruitNearby(this.player.root.position, this.rpg.maxHomies)
        if (res.recruitedNow > 0) {
          this.audio.recruitWhistle()
          this.ui.toast(`RECRUITED ${res.recruitedNow} HOMIE${res.recruitedNow > 1 ? 'S' : ''}`)
        } else {
          this.ui.toast(res.atCap ? 'SQUAD AT MAX CAPACITY' : 'NO ALLIED CREW NEARBY')
        }
      },
      onSkipTaxi: () => {
        if (this.taxiRide) this.handlePhoneSkipRide(this.taxiRide.dest, true)
      },
    })
    this.ui.setTouchModeLabel(this.touchControls.preference)

    this.ui.showTitle()
    subscribeAuth(user => void this.handleAuthChange(user))

    document.addEventListener('pointerlockchange', () => {
      if (
        !document.pointerLockElement
        && this.mode === 'playing'
        && this.input.method === 'keyboard'
        && !this.input.isTouchDevice
        && !this.wheelOpen
        && !this.phoneOpen
      ) {
        this.lockLostAt = performance.now()
        this.pause()
      }
    })
    window.addEventListener('keydown', e => {
      if (this.mode !== 'playing') return
      if (this.phoneOpen) {
        if (e.code === 'ArrowUp') { e.preventDefault(); this.ui.phone.moveSelection(-1); return }
        if (e.code === 'ArrowDown') { e.preventDefault(); this.ui.phone.moveSelection(1); return }
        if (e.code === 'Enter') { e.preventDefault(); this.ui.phone.activateSelected(); return }
        if (e.code === 'Backspace') { e.preventDefault(); this.ui.phone.goBack(); return }
      } else if (e.code === 'ArrowUp' && !this.vehicles.active && !this.wheelOpen && !this.taxiRide) {
        e.preventDefault()
        this.togglePhone()
        return
      }
      if (this.taxiRide && (e.code === 'Enter' || e.code === 'Space')) {
        e.preventDefault()
        this.handlePhoneSkipRide(this.taxiRide.dest, true)
        return
      }
      if (e.code >= 'Digit1' && e.code <= 'Digit8') {
        const idx = Number(e.code.slice(5)) - 1
        const w = this.arsenal.selectSector(idx, this.arsenal.current.sectorIndex === idx)
        this.holstered = false
        this.player.setHolstered(false)
        this.syncWeaponVisual()
        this.ui.toast(`${w.shortName}`)
      }
    })
    window.addEventListener('mousedown', e => { if (e.button === 2 && this.mode === 'playing') this.aimingRightMouse = true })
    window.addEventListener('mouseup', e => { if (e.button === 2) this.aimingRightMouse = false })
    window.addEventListener('contextmenu', e => { if (this.mode === 'playing') e.preventDefault() })
    window.addEventListener('blur', () => {
      this.aimingRightMouse = false
      this.wheelOpen = false
      this.wheelPinned = false
      this.phoneOpen = false
      this.touchControls.releaseAll()
      if (this.mode === 'playing') this.pause()
    })
  }

  private setPhoneOpen(open: boolean): void {
    if (this.mode !== 'playing' && open) return
    this.phoneOpen = open
    if (open) {
      this.wheelOpen = false
      this.input.unlockPointer()
    } else if (this.mode === 'playing') {
      this.input.lockPointer()
    }
  }

  private togglePhone(): void {
    this.setPhoneOpen(!this.phoneOpen)
    if (this.phoneOpen && this.ringtone !== 'silent') this.audio.phoneTone('beep')
  }

  private handlePhone911(service: 'ambulance' | 'fire' | 'police'): void {
    const pos = this.player.root.position
    if (service === 'ambulance') {
      this.life.summonServiceVehicle('ambulance', pos)
      this.save.health = Math.min(100, this.save.health + 45)
      this.ui.phone.addSms('EMS 911', 'Paramedics arrived on block (+45 HP treated).', this.currentTimeLabel)
      this.ui.toast('911 AMBULANCE DISPATCHED (+45 HP)')
      this.persist()
    } else if (service === 'fire') {
      this.life.summonServiceVehicle('fire', pos)
      this.ui.phone.addSms('FDLC 911', 'Fire Engine rolling up to your street.', this.currentTimeLabel)
      this.ui.toast('911 FIRE DEPARTMENT EN ROUTE')
    } else {
      this.reportCrime(pos, 1, { immediate: true })
      this.ui.toast('911 POLICE UNITS ALERTED')
    }
  }

  private handlePhoneCallCab(): void {
    this.life.summonServiceVehicle('taxi', this.player.root.position)
    this.ui.phone.addSms('ROMAN CAB', 'Cab is pulling up to the nearest curb! Walk near & press E.', this.currentTimeLabel)
    this.ui.toast("ROMAN CAB DISPATCHED — PRESS [E] NEAR CAB OR USE 'SKIP RIDE'")
  }

  private resolveCabDestination(dest: 'objective' | 'safehouse' | 'respray'): { target: THREE.Vector3; label: string } {
    if (dest === 'safehouse') {
      const home = this.world.safehouses[0]
      return { target: new THREE.Vector3(home.position.x + 2, 0.2, home.position.z + 2), label: 'SAFEHOUSE' }
    }
    if (dest === 'respray') {
      const bay = this.world.resprayBays[0]
      return { target: new THREE.Vector3(bay.position.x, 0.2, bay.position.z + 2.5), label: "PAY 'N' SPRAY" }
    }
    if (this.missions.target) {
      return { target: new THREE.Vector3(this.missions.target.x, 0.2, this.missions.target.z + 4), label: 'CONTRACT WAYPOINT' }
    }
    return { target: new THREE.Vector3(-8, 0.2, 2), label: 'DOWNTOWN STRIP' }
  }

  private handlePhoneRideCab(dest: 'objective' | 'safehouse' | 'respray'): void {
    if (this.save.money < 20) {
      this.ui.toast('Cab backseat fare costs $20')
      return
    }
    if (this.vehicles.active) {
      this.vehicles.exit()
    }
    this.save.money -= 20
    const { target, label } = this.resolveCabDestination(dest)
    const startFrom = this.lastHailedCabPos ?? this.player.root.position.clone().add(new THREE.Vector3(2.4, 0, 1.5))
    const drive = this.life.driveCabTo(target, startFrom)
    this.taxiRide = {
      dest,
      target,
      label,
      cabPos: drive.position.clone(),
      cabHeading: drive.heading,
    }
    this.lastHailedCabPos = null
    this.player.root.visible = false
    this.setPhoneOpen(false)
    this.ui.toast(`CAB EN ROUTE TO ${label} (-$20) — [ENTER/SPACE] SKIP (+$10) · [F] EXIT`)
    this.persist()
  }

  private handlePhoneSkipRide(dest: 'objective' | 'safehouse' | 'respray', upgradeFromRide = false): void {
    const cost = upgradeFromRide ? 10 : 30
    if (this.save.money < cost) {
      this.ui.toast(`Roman Cab Skip Ride costs $${cost}`)
      return
    }
    this.save.money -= cost
    this.taxiRide = null
    this.lastHailedCabPos = null
    this.life.consumeServiceUnit('taxi')
    const p = this.player.root.position
    if (this.vehicles.active) {
      this.vehicles.exit()
    }
    const { target, label } = this.resolveCabDestination(dest)
    p.copy(target)
    this.player.root.visible = true
    resolvePlayerCollision(p, this.world.spawn, this.world.colliders)
    this.player.velocity.set(0, 0, 0)
    this.setPhoneOpen(false)
    this.ui.toast(`ROMAN CAB: ARRIVED AT ${label} (-$${cost})`)
    this.persist()
  }

  private handlePhoneJacob(order: 'van' | 'armor' | 'ammo'): void {
    if (order === 'van') {
      this.life.summonServiceVehicle('arms_van', this.player.root.position)
      this.ui.phone.addSms('LITTLE JACOB', 'Van parked right down the block, bredrin.', this.currentTimeLabel)
      this.ui.toast('LITTLE JACOB VAN PULLED UP NEARBY')
      return
    }
    if (order === 'armor') {
      if (this.save.money < 200) {
        this.ui.toast('Kevlar Vest costs $200')
        return
      }
      this.save.money -= 200
      this.playerArmor = 100
      this.audio.reload()
      this.ui.toast('KEVLAR BODY ARMOR EQUIPPED (+100 AP · -$200)')
      this.persist()
      return
    }
    if (this.save.money < 120) {
      this.ui.toast('Jacob Ammo Delivery costs $120')
      return
    }
    this.save.money -= 120
    this.arsenal.addAmmo('handgun', 60)
    this.arsenal.addAmmo('smg', 120)
    this.arsenal.addAmmo('shotgun', 24)
    this.arsenal.addAmmo('rifle', 90)
    this.arsenal.addAmmo('precision', 20)
    this.arsenal.addAmmo('heavy', 4)
    this.arsenal.addAmmo('throwable', 4)
    this.audio.reload()
    this.ui.toast('LITTLE JACOB: ALL AMMO RESTOCKED (-$120)')
    this.persist()
  }

  private applySavedPlayerState(): void {
    this.player.upgrade = this.save.upgrade
    if (this.save.rpgStats) {
      this.rpg.restoreFromSave(this.save.rpgStats)
    }
    if (this.save.weaponArsenal) {
      this.arsenal.restoreFromSave(this.save.weaponArsenal)
    } else if (this.save.inventory) {
      this.arsenal.selectWeapon(this.save.inventory.weapon)
      this.arsenal.magAmmo.set(this.arsenal.equippedId, this.save.inventory.ammo)
    }
    if (this.save.inventory) {
      this.player.upgrade = this.save.inventory.sprintTier
      this.save.upgrade = this.save.inventory.sprintTier
      this.playerArmor = this.save.inventory.armor ?? 0
    }
    if (this.save.capturedTurfs) {
      this.turf.reset(this.save.capturedTurfs)
    }
    if (this.save.position) {
      this.player.root.position.set(this.save.position.x, this.save.position.y, this.save.position.z)
      resolvePlayerCollision(this.player.root.position, this.world.spawn, this.world.colliders)
    }
    if (this.save.heat) {
      this.heat.restoreFromSave(this.save.heat)
    }
    this.player.setPhysique(this.rpg.muscle, this.rpg.fat)
    this.syncWeaponVisual()
    this.lastSavedPos.copy(this.player.root.position)
    this.lastSavedWanted = this.heat.wanted
    this.lastSavedWeapon = this.arsenal.equippedId
    this.lastSavedAmmo = this.arsenal.getAmmoDisplay().total
  }

  private syncWeaponVisual(): void {
    const spec = this.arsenal.current
    this.player.setWeaponVisual(
      spec.category,
      spec.id,
      this.arsenal.hasAttachment(spec.id, 'suppressor'),
      this.arsenal.lastLongGunId,
    )
  }

  private toggleWeaponAttachment(att: AttachmentId): void {
    const spec = this.arsenal.current
    if (!spec.supportsAttachments.includes(att)) {
      this.ui.toast(`${spec.shortName} has no ${att} slot`)
      return
    }
    const enabled = this.arsenal.toggleAttachment(att)
    this.syncWeaponVisual()
    this.ui.toast(`${spec.shortName}: ${att.toUpperCase()} ${enabled ? 'EQUIPPED' : 'REMOVED'}`)
    this.persist(false)
  }

  get wanted(): number {
    return this.heat.wanted
  }

  private async toggleAuth(): Promise<void> {
    try {
      if (this.currentUser) {
        await signOutPlayer()
        this.ui.toast('Signed out of Firebase Cloud')
      } else {
        await signInWithGoogle()
      }
    } catch (error) {
      this.ui.toast(`Sign-in error: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async handleAuthChange(user: User | null): Promise<void> {
    this.currentUser = user
    if (!user) {
      this.ui.setAuthStatus(null)
      return
    }
    const label = user.displayName || user.email || 'VICE PLAYER'
    this.ui.setAuthStatus(label)
    try {
      const remote = await loadCloudPlayerSave(user.uid)
      if (remote) {
        const merged = mergeCitySaves(this.save, remote)
        Object.assign(this.save, merged)
        this.applySavedPlayerState()
        for (const s of this.save.robbedStores) this.robbedStores.add(s)
        saveCityProgress(this.save)
        this.ui.toast(`Cloud save synced for ${label}`)
      } else {
        this.persist()
        this.ui.toast(`Cloud save created for ${label}`)
      }
    } catch (error) {
      console.error(error)
    }
  }

  private capturePlayerState() {
    const p = this.player.root.position
    const ammoInfo = this.arsenal.getAmmoDisplay()
    return {
      position: {
        x: Math.round(p.x * 100) / 100,
        y: Math.round(p.y * 100) / 100,
        z: Math.round(p.z * 100) / 100,
      },
      inventory: {
        ammo: Math.max(0, Math.floor(ammoInfo.total)),
        armor: Math.round(this.playerArmor),
        weapon: this.arsenal.equippedId,
        sprintTier: this.player.upgrade,
      },
      heat: this.heat.toSaveState(),
      rpgStats: this.rpg.toSaveState(),
      weaponArsenal: this.arsenal.toSaveState(),
      capturedTurfs: this.turf.capturedIds,
    }
  }

  private persist(syncCloud = true): void {
    const state = this.capturePlayerState()
    this.save.position = state.position
    this.save.inventory = state.inventory
    this.save.heat = state.heat
    this.save.rpgStats = state.rpgStats
    this.save.weaponArsenal = state.weaponArsenal
    this.save.capturedTurfs = state.capturedTurfs
    this.lastSavedPos.copy(this.player.root.position)
    this.lastSavedWanted = this.heat.wanted
    this.lastSavedWeapon = this.arsenal.equippedId
    this.lastSavedAmmo = state.inventory.ammo
    this.saveTimer = 0
    if (syncCloud) {
      void persistPlayerState(this.currentUser, state, this.save)
    } else {
      saveCityProgress(this.save)
    }
  }

  enterDirectlyIntoGame(): void {
    tuning.activate('run')
    this.save.seenIntro = true
    this.wheelOpen = false
    this.wheelPinned = false
    this.phoneOpen = false
    this.mode = 'playing'
    this.ui.showGame()
    if (this.input.isTouchDevice) {
      this.ui.toast('VICE BAY READY — LEFT STICK MOVE · DRAG RIGHT TO LOOK')
    } else if (this.input.padConnected) {
      this.ui.toast('CONTROLLER READY — L-STICK MOVE · RT FIRE · LT AIM · Y CAR/USE · RB WHEEL')
    } else {
      this.ui.toast('VICE BAY READY — CLICK VIEW TO AIM · TAB WHEEL · P / ↑ PHONE')
    }
  }

  start(): void {
    tuning.activate('run')
    this.audio.unlock()
    if (!this.save.seenIntro) {
      this.save.seenIntro = true
      this.persist()
      this.playOpeningCutscene()
      return
    }
    this.mode = 'playing'; this.ui.showGame(); this.input.lockPointer()
    this.ui.toast('Vice Bay is yours. Hold TAB / RB for Weapon Wheel or press J for Stats.')
  }

  playOpeningCutscene(): void {
    tuning.activate('run')
    this.startCutscene('opening', undefined, 'Vice Bay is yours. Hold TAB for Weapon Wheel or press J for Stats.')
  }

  private startCutscene(id: CutsceneId, focus?: THREE.Vector3, endToast?: string, missionTitle = ''): void {
    this.mode = 'cutscene'
    this.wheelOpen = false
    this.wheelPinned = false
    this.cutsceneSkipGuard = 0.35
    this.cutsceneWeather = undefined
    this.pendingMissionTitle = missionTitle
    this.player.root.visible = false
    this.input.unlockPointer()
    this.ui.showCutscene()
    this.cutscenes.start(id, focus, () => this.finishCutscene(endToast))
  }

  skipCutscene(): void {
    if (this.mode !== 'cutscene') return
    this.cutscenes.skip()
  }

  private finishCutscene(endToast?: string): void {
    this.cutsceneWeather = undefined
    this.player.root.visible = !this.vehicles.active
    this.mode = 'playing'
    this.ui.showGame()
    this.input.lockPointer()
    if (this.pendingMissionTitle) {
      playMissionCard(this.pendingMissionTitle)
      this.pendingMissionTitle = ''
    }
    if (endToast) this.ui.toast(endToast)
  }

  private resume(): void {
    this.audio.unlock(); this.wheelOpen = false; this.wheelPinned = false; this.phoneOpen = false; this.mode = 'playing'; this.ui.showGame(); this.input.lockPointer()
  }

  private pause(): void {
    if (this.mode !== 'playing') return
    this.wheelOpen = false; this.wheelPinned = false; this.phoneOpen = false
    this.touchControls.releaseAll()
    this.mode = 'pause'; this.ui.showPause(); this.input.unlockPointer(); this.persist()
  }

  private openMap(): void { this.wheelOpen = false; this.wheelPinned = false; this.phoneOpen = false; this.mode = 'map'; this.ui.showMap(); this.input.unlockPointer() }

  private quit(): void {
    this.cutscenes.stop()
    this.cutsceneWeather = undefined
    this.wheelOpen = false
    this.wheelPinned = false
    this.statsOpen = false
    this.phoneOpen = false
    this.taxiRide = null
    this.lastHailedCabPos = null
    this.touchControls.releaseAll()
    this.player.root.visible = !this.vehicles.active
    this.mode = 'title'; this.ui.showTitle(); this.input.unlockPointer(); this.persist()
  }

  private cycleWeather(): void {
    const index = WEATHERS.indexOf(this.save.weather)
    this.save.weather = WEATHERS[(index + 1) % WEATHERS.length]; this.persist()
    this.ui.toast(`Atmosphere: ${this.save.weather.toUpperCase()}`)
  }

  private startMission(id: string): void {
    const title = this.missions.start(id)
    if (!title) return
    this.board.begin(!tuning.unranked)
    this.objectiveBeacon.visible = false
    if (id === 'intro' || id === 'race' || id === 'delivery' || id === 'stunt') {
      this.startCutscene(id, undefined, this.missions.objective, title)
      return
    }
    if (this.mode !== 'playing') this.resume()
    playMissionCard(title); this.ui.toast(this.missions.objective)
  }

  private currentSightingObservation() {
    const active = this.vehicles.active
    return {
      masked: this.knowledge.masked,
      outfit: this.knowledge.currentOutfit,
      brandishedWeaponClass: this.holstered ? null : this.arsenal.current.category,
      vehicle: active
        ? {
            model: active.name,
            color: active.colorName,
            plateNumber: active.plateNumber,
            damageState: active.health > 82 ? 'Intact' : active.health > 45 ? 'Dented' : 'Wrecked',
          }
        : null,
    }
  }

  private currentWitnessObservation() {
    const active = this.vehicles.active
    return {
      sawFace: !this.knowledge.masked,
      outfitId: this.knowledge.currentOutfit.id,
      weaponClass: this.holstered ? null : this.arsenal.current.category,
      vehicleModel: active ? active.name : null,
      vehicleColor: active ? active.colorName : null,
      vehiclePlate: active ? active.plateNumber : null,
    }
  }

  private reportCrime(origin: THREE.Vector3, severity: number, options: { immediate?: boolean; escalateIfEqual?: boolean; toast?: string } = {}): void {
    const policeSee = this.life.hasPoliceLineOfSight(this.player.root.position, this.heat.wanted)
    if (policeSee || options.immediate || this.heat.wanted > 0) {
      const prev = this.heat.wanted
      if (policeSee) this.knowledge.recordSighting(this.currentSightingObservation())
      const res = this.heat.reportCrime(origin, severity, {
        immediate: options.immediate || policeSee,
        policeSeePlayer: policeSee,
        escalateIfEqual: options.escalateIfEqual,
      })
      if (res.escalated || this.heat.wanted > prev) {
        this.audio.dispatchRadio(this.heat.wanted)
        this.persist()
      }
      return
    }
    const witnessStarted = this.life.notifyCrimeToWitnesses(origin, severity, this.currentWitnessObservation())
    if (witnessStarted) {
      this.audio.dispatchAlert()
      this.ui.toast(options.toast ?? 'WITNESS CALLING 911 (3.5s) — INTIMIDATE OR FLEE OUT OF SIGHT!')
    }
  }

  private handleTurfZoneEvents(warStarted: TurfZoneState | null, capturedZone: TurfZoneState | null): void {
    if (warStarted) {
      this.ui.toast(`TURF WAR IGNITED: ${warStarted.name.toUpperCase()} (3 WAVES)`)
    }
    if (capturedZone) {
      this.save.money += capturedZone.reward
      this.rpg.recordTurfCapture()
      this.audio.turfCaptured()
      this.ui.toast(`TURF CAPTURED: ${capturedZone.name.toUpperCase()} +$${capturedZone.reward.toLocaleString()} & RESPECT+`)
      this.persist()
    }
  }

  private spawnProjectile(spec: WeaponSpec, origin: THREE.Vector3, dir: THREE.Vector3): void {
    const color = spec.id === 'flashbang' ? 0xc8e4f4 : spec.id === 'grenade_launcher' ? 0xf5b841 : 0x4d6b47
    const mesh = new THREE.Mesh(this.projGeo, new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.5 }))
    mesh.castShadow = true
    mesh.position.copy(origin).addScaledVector(dir, 0.8)
    this.world.scene.add(mesh)
    const speed = spec.fireMode === 'projectile' ? 28 : 16
    const lift = spec.fireMode === 'projectile' ? 2.4 : 5.6
    this.projectiles.push({
      mesh,
      velocity: new THREE.Vector3(dir.x * speed, dir.y * speed + lift, dir.z * speed),
      life: spec.fireMode === 'projectile' ? 2.4 : 1.35,
      kind: spec.id === 'flashbang' ? 'flashbang' : spec.id === 'grenade_launcher' ? 'grenade_launcher' : 'frag',
      damage: spec.damage,
      radius: spec.explosionRadius ?? spec.flashRadius ?? 8.5,
      impactDetonate: spec.fireMode === 'projectile',
    })
  }

  private detonateProjectile(proj: ThrownProjectile): void {
    const pos = proj.mesh.position
    this.audio.explosion()
    if (proj.kind === 'flashbang') {
      this.life.explode(pos, proj.radius, 14)
      if (this.life.intimidateWitnesses(pos, new THREE.Vector3(0, 0, -1), true)) {
        this.ui.toast('FLASHBANG STUNNED WITNESSES')
      }
      this.reportCrime(pos, 1)
      return
    }
    const lifeExp = this.life.explode(pos, proj.radius, proj.damage)
    const turfExp = this.turf.explode(pos, proj.radius, proj.damage)
    this.props.impact(pos, 18)
    this.input.padRumble(0.95, 220)
    this.handleTurfZoneEvents(turfExp.warStarted, turfExp.capturedZone)
    if (lifeExp.copsDown > 0 || lifeExp.peopleHit > 0 || turfExp.kills > 0) {
      this.ui.triggerHitmarker('critical')
      this.audio.hitmarker('critical')
    }
    this.reportCrime(pos, lifeExp.copsDown > 0 ? 3 : 2, {
      immediate: lifeExp.copsDown > 0 || this.life.hasPoliceLineOfSight(this.player.root.position, this.heat.wanted),
      escalateIfEqual: true,
    })
  }

  private fire(): void {
    if (this.shotCooldown > 0 || this.vehicles.active || this.wheelOpen || this.phoneOpen) return
    const spec = this.arsenal.current
    const isBrawl = spec.fireMode === 'melee' || this.holstered
    if (!isBrawl && !this.arsenal.canFire()) {
      if (this.arsenal.reloadTimer <= 0) {
        this.audio.dryFire()
        if (this.arsenal.startReload(this.rpg.weaponSkill)) {
          this.audio.reload()
          this.ui.toast(`Reloading ${spec.shortName}…`)
        } else {
          this.ui.toast('Out of ammo — visit a Safehouse or call Little Jacob [P]')
        }
      }
      return
    }

    if (!isBrawl) this.arsenal.consumeRound(this.rpg.weaponSkill)
    this.shotCooldown = isBrawl ? 0.34 : spec.fireInterval
    this.weaponHotTimer = isBrawl ? 1.1 : 2.6

    const start = this.player.root.position.clone().add(new THREE.Vector3(0, 1.62, 0))
    const aimPitch = THREE.MathUtils.clamp(-this.pitch * 0.45, -0.35, 0.35)
    const baseDir = new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(aimPitch),
      Math.sin(aimPitch),
      -Math.cos(this.yaw) * Math.cos(aimPitch),
    ).normalize()

    if (isBrawl) {
      const wasBlocking = this.aimingRightMouse || this.input.held('aim')
      const brawl = this.player.triggerBrawlCombo(wasBlocking)
      const dmg = (this.holstered ? 18 : spec.damage) * this.rpg.meleeDamageMultiplier * brawl.damageMult
      this.audio.meleeSwing()
      const disarmStrike = wasBlocking || brawl.comboIndex === 3
      const lifeBrawl = this.life.applyBrawlHit(start, baseDir, dmg, disarmStrike)
      const turfHit = this.turf.shootBallistic(start, baseDir, spec.range, dmg, spec.armorPenetration)
      const propHit = this.props.shoot(start, baseDir, spec.range)
      if (lifeBrawl.hit || turfHit.hit) {
        this.rpg.recordMeleeHit(lifeBrawl.killed || turfHit.killed)
        this.player.setPhysique(this.rpg.muscle, this.rpg.fat)
        this.ui.triggerHitmarker(lifeBrawl.disarmed || turfHit.critical ? 'critical' : 'normal')
        this.audio.hitmarker(lifeBrawl.disarmed || turfHit.critical ? 'critical' : 'normal')
        if (lifeBrawl.disarmed) this.ui.toast('COUNTER-DISARM! OFFICER WEAPON KNOCKED LOOSE')
        this.handleTurfZoneEvents(turfHit.warStarted, turfHit.capturedZone)
        this.reportCrime(this.player.root.position, lifeBrawl.hitCop ? 2 : 1)
      } else if (propHit) {
        this.audio.impact()
      }
      this.persist(false)
      return
    }

    if (spec.fireMode === 'projectile' || spec.fireMode === 'thrown') {
      if (spec.fireMode === 'thrown') {
        this.player.triggerSwing()
        this.audio.meleeSwing()
      } else {
        this.audio.shootWeapon(spec.category, false)
        this.muzzleFlash.position.copy(start).addScaledVector(baseDir, .75)
        this.muzzleFlash.visible = true
        this.flashTime = .08
      }
      this.spawnProjectile(spec, start, baseDir)
      this.persist(false)
      return
    }

    // Hitscan Firearms (Semi / Auto / Shotgun / Precision)
    const suppressed = this.arsenal.hasAttachment(spec.id, 'suppressor')
    this.audio.shootWeapon(spec.category, suppressed)
    this.input.padRumble(spec.category === 'shotgun' || spec.category === 'precision' ? 0.65 : 0.35, 75)
    if (!suppressed) {
      this.muzzleFlash.position.copy(start).addScaledVector(baseDir, .72)
      this.muzzleFlash.visible = true
      this.flashTime = .075
    }

    const aiming = this.aimingRightMouse || this.input.held('aim')
    const blindFiring = this.player.cover.active && !aiming
    if (blindFiring) this.player.triggerBlindFire()
    const crouching = this.input.held('crouch')
    const sprinting = this.input.held('sprint') && !this.rpg.exhausted
    const spread = this.arsenal.effectiveSpread(spec, {
      aiming,
      crouching,
      sprinting,
      weaponSkill: this.rpg.weaponSkill,
    }) * (blindFiring ? 2.45 : 1)
    const noiseRadius = this.arsenal.effectiveNoiseRadius(spec)

    let anyPersonHit = false
    let hitCop = false
    let hitCritical = false
    let hitArmor = false
    let anyKilled = false
    let warStarted: TurfZoneState | null = null
    let capturedZone: TurfZoneState | null = null

    for (let i = 0; i < spec.pellets; i += 1) {
      const dir = baseDir.clone()
      dir.x += (Math.random() - 0.5) * spread * 2
      dir.y += (Math.random() - 0.5) * spread * 1.4
      dir.z += (Math.random() - 0.5) * spread * 2
      dir.normalize()

      const range = worldRayDistance(start, dir, this.world.colliders, spec.range)
      const lifeHit = this.life.shootBallistic(start, dir, range, spec.damage, spec.armorPenetration, i === 0 ? noiseRadius : 0)
      const turfHit = this.turf.shootBallistic(start, dir, range, spec.damage, spec.armorPenetration)
      const propHit = this.props.shoot(start, dir, range)

      const hit = lifeHit.hit || turfHit.hit || propHit
      if (lifeHit.hit) {
        anyPersonHit = true
        if (lifeHit.hitType === 'cop') hitCop = true
        if (lifeHit.critical) hitCritical = true
        if (lifeHit.armorBroken) hitArmor = true
        if (lifeHit.killed) anyKilled = true
      }
      if (turfHit.hit) {
        anyPersonHit = true
        if (turfHit.critical) hitCritical = true
        if (turfHit.killed) anyKilled = true
        if (turfHit.warStarted) warStarted = turfHit.warStarted
        if (turfHit.capturedZone) capturedZone = turfHit.capturedZone
      }

      const end = start.clone().addScaledVector(dir, Math.min(range, hit ? 30 : Math.min(60, spec.range)))
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([start, end]),
        new THREE.LineBasicMaterial({ color: suppressed ? 0x9fe4ff : 0xffe4a4, transparent: true, opacity: suppressed ? .45 : .88 }),
      )
      this.world.scene.add(line)
      this.tracers.push({ mesh: line, life: .11 })
    }

    if (anyPersonHit) {
      const hmKind = hitCritical ? 'critical' : hitArmor ? 'armor' : 'normal'
      this.ui.triggerHitmarker(hmKind)
      this.audio.hitmarker(hmKind)
      const promo = this.rpg.recordWeaponHit(hitCritical, anyKilled)
      if (promo.tierPromoted) {
        this.ui.toast(`WEAPON SKILL PROMOTED: ${promo.tierPromoted}!`)
      }
      this.handleTurfZoneEvents(warStarted, capturedZone)
    }

    if (!suppressed) {
      this.life.startle(start, noiseRadius)
      if (this.life.intimidateWitnesses(this.player.root.position, baseDir, true)) {
        this.ui.toast('WITNESS INTIMIDATED — 911 CALL CANCELLED')
      }
    }

    const policeSee = this.life.hasPoliceLineOfSight(this.player.root.position, this.heat.wanted)
    if (!suppressed || anyPersonHit || policeSee) {
      this.reportCrime(this.player.root.position, hitCop ? 3 : anyPersonHit ? 2 : 1, {
        immediate: hitCop || (anyPersonHit && policeSee),
        escalateIfEqual: anyPersonHit,
      })
    }

    const recoil = this.arsenal.effectiveRecoil(spec, this.rpg.weaponSkill)
    this.yaw += (Math.random() - .5) * recoil.yaw * 2
    this.pitch = Math.min(.62, this.pitch + recoil.pitch)
    this.persist(false)
  }

  private toggleVehicle(): void {
    if (this.taxiRide) {
      this.player.root.position.set(this.taxiRide.cabPos.x + 2.1, 0.2, this.taxiRide.cabPos.z)
      resolvePlayerCollision(this.player.root.position, this.world.spawn, this.world.colliders)
      this.player.root.visible = true
      this.taxiRide = null
      this.life.consumeServiceUnit('taxi')
      this.ui.toast('Exited Yellow Cab')
      this.persist()
      return
    }
    const v = this.vehicles.active
    if (v) {
      if (Math.abs(v.speed) > 12 && v.type !== 'helicopter' && v.type !== 'boat') {
        const bail = this.vehicles.bailout()
        if (bail) {
          this.player.root.position.copy(bail.exitPos)
          resolvePlayerCollision(this.player.root.position, bail.exitPos, this.world.colliders)
          this.player.root.visible = true
          this.player.launchRagdollTumble(bail.velocity)
          this.save.health = Math.max(0, this.save.health - 8)
          this.audio.crashSynth(11, false)
          this.input.padRumble(0.75, 180)
          this.heat.onVehicleChanged(null)
          this.prevEngineStalled = false
          this.ui.toast('HIGH-SPEED BAILOUT! (-8 HP)')
          this.persist()
        }
      } else {
        const exit = this.vehicles.exit()
        if (exit) {
          this.player.root.position.copy(exit)
          resolvePlayerCollision(this.player.root.position, exit, this.world.colliders)
        }
        this.heat.onVehicleChanged(null)
        this.prevEngineStalled = false
        this.player.root.visible = true
        this.ui.toast('Exited vehicle')
        this.persist()
      }
      return
    }
    const nearest = this.vehicles.nearest(this.player.root.position, 6)
    if (nearest) {
      this.vehicles.enter(nearest)
      this.prevEngineStalled = false
      this.player.root.visible = false
      const swapped = this.heat.onVehicleChanged(nearest)
      if (swapped) {
        const policeSee = this.life.hasPoliceLineOfSight(this.player.root.position, this.heat.wanted)
        this.knowledge.onVehicleUpdated({
          model: nearest.name,
          color: nearest.colorName,
          plateNumber: nearest.plateNumber,
          damageState: nearest.health > 82 ? 'Intact' : nearest.health > 45 ? 'Dented' : 'Wrecked',
        }, policeSee)
        this.ui.toast(`Driving ${nearest.name} [${nearest.plateNumber}] — CLEAN PLATES`)
      } else {
        this.ui.toast(`Driving ${nearest.name} — WAIT 1.5s FOR SEATBELT`)
        this.reportCrime(this.player.root.position, 1, { toast: 'WITNESS SPOTTED VEHICLE THEFT — STOP THE 911 CALL!' })
      }
      this.persist()
    } else {
      this.ui.toast('No vehicle nearby')
    }
  }

  private interact(): boolean {
    const p = this.player.root.position
    const active = this.vehicles.active

    // Pay 'n' Spray Garage ($150 repair, respray & plate swap)
    const bay = this.world.resprayBays.find(item => p.distanceTo(item.position) < item.radius)
    if (bay) {
      if (!active) {
        this.ui.toast(`${bay.name}: Drive a vehicle inside ($${bay.price})`)
        return true
      }
      if (this.save.money < bay.price) {
        this.ui.toast(`${bay.name}: Need $${bay.price}`)
        return true
      }
      this.save.money -= bay.price
      const resprayInfo = this.vehicles.respray(active)
      const policeSee = this.life.hasPoliceLineOfSight(p, this.heat.wanted)
      this.knowledge.onVehicleUpdated({
        model: active.name,
        color: resprayInfo.colorName,
        plateNumber: resprayInfo.plateNumber,
        damageState: 'Intact',
      }, policeSee)
      this.heat.onVehicleChanged(active)
      this.audio.phoneTone('respray')
      this.ui.toast(`PAY 'N' SPRAY: REPAIRED & NEW PLATE [${resprayInfo.plateNumber}] (-$${bay.price})`)
      this.persist()
      return true
    }

    // Dispatched 911 / Cab / Little Jacob street units
    const nearAmb = this.life.getServiceUnitState('ambulance', p, 6)
    if (nearAmb) {
      this.life.consumeServiceUnit('ambulance')
      this.save.health = 100
      this.ui.toast('AMBULANCE PARAMEDIC: HEALTH RESTORED TO 100')
      this.persist()
      return true
    }
    const hailedCab = this.life.hailNearestCab(p, 7.5)
    if (hailedCab) {
      this.lastHailedCabPos = hailedCab.position.clone()
      this.setPhoneOpen(true)
      this.ui.phone.setApp('cab')
      this.ui.toast('YELLOW CAB HAILED — PICK BACKSEAT RIDE ($20) OR SKIP ($30)')
      return true
    }
    const nearJacob = this.life.getServiceUnitState('arms_van', p, 6.5)
    if (nearJacob) {
      this.setPhoneOpen(true)
      this.ui.phone.setApp('jacob')
      this.ui.toast('LITTLE JACOB ARMS VAN — SELECT KEVLAR OR AMMO')
      return true
    }

    const store = this.world.stores.find(item => !this.robbedStores.has(item.id) && p.distanceTo(item.position) < item.radius)
    if (store) {
      this.robbedStores.add(store.id)
      this.save.robbedStores = [...this.robbedStores]
      this.save.money += store.reward
      this.knowledge.recordSighting(this.currentSightingObservation())
      this.heat.reportCrime(p, 2, { immediate: true, policeSeePlayer: true, escalateIfEqual: true })
      this.audio.robbery()
      this.audio.dispatchRadio(this.heat.wanted)
      this.ui.toast(`${store.name} HIT  +$${store.reward.toLocaleString()}  — BREAK SIGHT & MOVE`)
      this.persist()
      return true
    }

    const gym = this.world.gyms.find(item => p.distanceTo(item.position) < item.radius)
    if (gym) {
      const gain = this.rpg.recordGymRep(gym.kind)
      this.player.setPhysique(this.rpg.muscle, this.rpg.fat)
      this.audio.gymRep()
      this.ui.toast(`${gym.name.toUpperCase()}: +${gain.muscleGain} MUSCLE · +${gain.staminaGain} STAMINA`)
      this.persist()
      return true
    }

    const stand = this.world.foodStands.find(item => p.distanceTo(item.position) < item.radius)
    if (stand) {
      if (this.save.money < stand.price) {
        this.ui.toast(`${stand.name}: Need $${stand.price}`)
        return true
      }
      this.save.money -= stand.price
      const meal = this.rpg.eatMeal(stand.mealSize)
      this.save.health = Math.min(100, this.save.health + meal.healthGain)
      this.player.setPhysique(this.rpg.muscle, this.rpg.fat)
      this.audio.phoneTone('hotdog')
      this.ui.toast(`${stand.name}: ATE MEAL (-$${stand.price}) · HEALTH + HUNGER RESTORED`)
      this.persist()
      return true
    }

    if (!this.missions.current && Math.hypot(p.x + 8, p.z) < 7) {
      this.startMission('intro')
      return true
    }
    if (this.world.safehouses.some(home => p.distanceTo(home.position) < home.radius + 4)) {
      const policeSee = this.life.hasPoliceLineOfSight(p, this.heat.wanted)
      const { outfit } = this.knowledge.cycleOutfit(policeSee)
      this.player.setOutfit(outfit)
      const cooled = this.heat.clearAtSafehouse()
      if (cooled) this.knowledge.reset()
      this.arsenal.addAmmo('handgun', 45)
      this.arsenal.addAmmo('smg', 90)
      this.arsenal.addAmmo('shotgun', 16)
      this.arsenal.addAmmo('rifle', 60)
      this.arsenal.addAmmo('precision', 15)
      this.arsenal.addAmmo('heavy', 4)
      this.arsenal.addAmmo('throwable', 3)
      if (this.save.health < 100 || cooled) {
        this.save.health = 100
        this.ui.toast(cooled ? `Safehouse (${outfit.label}): heat cleared, wardrobe swapped & ammo restocked` : `Safehouse (${outfit.label}): health & ammo restocked`)
      } else if (this.save.upgrade < 3 && this.save.money >= 500) {
        this.save.money -= 500; this.save.upgrade++; this.player.upgrade = this.save.upgrade
        this.ui.toast(`Sprint upgrade ${this.save.upgrade}/3 (${outfit.label}) purchased for $500`)
      } else {
        this.ui.toast(`Safehouse wardrobe: ${outfit.label} · Ammo restocked`)
      }
      this.persist()
      return true
    }
    return false
  }

  step(dt: number): void {
    this.elapsed += dt
    this.hitCooldown = Math.max(0, this.hitCooldown - dt)
    this.rampCooldown = Math.max(0, this.rampCooldown - dt)

    if (this.input.padConnected && this.input.padLabel !== this.prevPadLabel) {
      this.prevPadLabel = this.input.padLabel
      this.ui.toast('CONTROLLER CONNECTED — ALL STICKS & TRIGGERS ACTIVE')
    } else if (!this.input.padConnected && this.prevPadLabel) {
      this.prevPadLabel = ''
    }

    if (this.mode === 'cutscene') {
      this.cutsceneSkipGuard = Math.max(0, this.cutsceneSkipGuard - dt)
      this.input.takeLook()
      const skipRequested = this.input.consume('jump') || this.input.consume('confirm') || this.input.consume('pause')
      this.input.consume('vehicle'); this.input.consume('interact'); this.input.consume('reload'); this.input.consume('shoot'); this.input.consume('map'); this.input.consume('weather')
      if (skipRequested && this.cutsceneSkipGuard <= 0) {
        this.skipCutscene()
        return
      }
      this.world.update(dt, this.camera.position, this.cutsceneWeather ?? this.save.weather)
      this.life.update(dt, this.camera.position, 0)
      this.props.update(dt)
      this.audio.update(0, false, 0, false)
      return
    }

    if (this.input.consume('pause') && performance.now() - this.lockLostAt > 300) {
      if (this.mode === 'playing') this.pause()
      else if (this.mode === 'pause' || this.mode === 'map') this.resume()
    }
    if (this.mode !== 'playing') {
      if (this.input.menuNav.y !== 0) this.ui.navigateMenu(this.input.menuNav.y)
      if (this.input.consume('confirm')) this.ui.activateFocusedMenu()
      if (this.input.consume('back')) this.ui.backMenu()
    }
    if (this.input.consume('map') && this.mode === 'playing') this.openMap()
    if (this.input.consume('weather') && this.mode === 'playing') this.cycleWeather()
    const look = this.input.takeLook()

    // 25% Tactical Slow-Mo Weapon Wheel toggle while holding TAB / RB or pinned on touch
    const wantWheel = this.mode === 'playing' && (this.wheelPinned || this.input.held('wheel'))
    if (wantWheel !== this.wheelOpen) {
      this.wheelOpen = wantWheel
      if (this.wheelOpen) {
        this.input.unlockPointer()
      } else if (this.mode === 'playing') {
        this.input.lockPointer()
      }
    }
    if (this.wheelOpen && this.input.method === 'gamepad') {
      const sx = Math.abs(this.input.sticks.rx) > 0.45 ? this.input.sticks.rx : this.input.sticks.lx
      const sy = Math.abs(this.input.sticks.rx) > 0.45 ? this.input.sticks.ry : this.input.sticks.ly
      if (this.ui.combat.selectSectorByStick(sx, sy)) {
        this.input.padRumble(0.25, 35)
      }
      if (this.input.menuNav.x !== 0) {
        const list = WEAPON_CATALOG.filter(w => w.sectorIndex === this.arsenal.current.sectorIndex)
        if (list.length > 1) {
          const curIdx = list.findIndex(w => w.id === this.arsenal.equippedId)
          const next = list[(curIdx + this.input.menuNav.x + list.length) % list.length]
          this.arsenal.selectWeapon(next.id)
          this.holstered = false
          this.player.setHolstered(false)
          this.syncWeaponVisual()
          this.ui.toast(`EQUIPPED: ${next.name.toUpperCase()}`)
        }
      }
    }

    const simDt = this.wheelOpen ? dt * 0.25 : dt
    this.shotCooldown = Math.max(0, this.shotCooldown - simDt)
    this.weaponHotTimer = Math.max(0, this.weaponHotTimer - simDt)

    this.crankSoundCooldown = Math.max(0, this.crankSoundCooldown - simDt)

    if (this.mode === 'playing') {
      if (this.input.consume('phone')) {
        this.togglePhone()
      }
      if (this.phoneOpen) {
        if (this.input.menuNav.y !== 0) this.ui.phone.moveSelection(this.input.menuNav.y)
        if (this.input.consume('confirm')) this.ui.phone.activateSelected()
        if (this.input.consume('back')) this.ui.phone.goBack()
      } else if (this.wheelOpen) {
        if (this.input.consume('confirm') || this.input.consume('back')) {
          this.wheelPinned = false
          this.wheelOpen = false
          this.input.lockPointer()
        }
      } else if (this.taxiRide && this.input.consume('confirm')) {
        this.handlePhoneSkipRide(this.taxiRide.dest, true)
      }

      if (this.input.consume('mask')) {
        const masked = this.knowledge.toggleMask()
        this.player.setMasked(masked)
        this.ui.toast(masked ? 'BANDANA MASK ON — FACE CONCEALED (+EVASION)' : 'BANDANA MASK OFF')
      }
      if (this.input.consume('holster')) {
        this.holstered = !this.holstered
        this.player.setHolstered(this.holstered)
        this.ui.toast(this.holstered ? 'WEAPON CONCEALED — UNARMED PROFILE' : `DREW ${this.arsenal.current.shortName}`)
      }
      if (!this.wheelOpen && !this.phoneOpen) {
        this.yaw -= look.x
        this.pitch = THREE.MathUtils.clamp(this.pitch + look.y, -.15, .65)
      }

      if (this.input.consume('stats')) {
        this.statsOpen = !this.statsOpen
      }
      if (this.input.consume('cover') && !this.vehicles.active && !this.wheelOpen && !this.phoneOpen) {
        const carCoords = this.vehicles.vehicles.map(v => ({
          x: v.root.position.x,
          z: v.root.position.z,
          heading: v.heading,
          halfWidth: 1.05,
        }))
        const inCover = this.player.toggleCover(this.world.colliders, carCoords)
        if (inCover) {
          this.ui.toast(this.player.cover.coverBehindCar
            ? 'COVER BEHIND CAR — LMB BLIND-FIRE / RMB AIM PEEK'
            : 'IN COVER — LMB BLIND-FIRE / RMB AIM PEEK')
        }
      }
      if (this.input.consume('attach')) {
        const spec = this.arsenal.current
        const avail = spec.supportsAttachments
        if (avail.length > 0) {
          const nextAtt = avail.find(a => !this.arsenal.hasAttachment(spec.id, a)) ?? avail[0]
          this.toggleWeaponAttachment(nextAtt)
        }
      }
      if (this.input.consume('recruit')) {
        const res = this.turf.recruitNearby(this.player.root.position, this.rpg.maxHomies)
        if (res.recruitedNow > 0) {
          this.audio.recruitWhistle()
          this.ui.toast(`RECRUITED ${res.recruitedNow} HOMIE${res.recruitedNow > 1 ? 'S' : ''} (SQUAD ${res.totalSquad}/${this.rpg.maxHomies})`)
        } else if (res.atCap) {
          this.ui.toast(`SQUAD AT MAX CAPACITY (${res.totalSquad}/${this.rpg.maxHomies}) — RAISE RESPECT!`)
        } else {
          this.ui.toast('NO ALLIED VICE CREW HOMIES NEARBY')
        }
      }

      if (this.input.consume('interact')) {
        const didInteract = this.interact()
        if (!didInteract && this.input.method === 'gamepad') {
          this.input.consume('vehicle')
          this.toggleVehicle()
        }
      }
      if (this.input.consume('vehicle')) {
        this.toggleVehicle()
      }

      if (this.input.consume('reload')) {
        if (this.arsenal.startReload(this.rpg.weaponSkill)) {
          this.audio.reload()
          this.ui.toast(`Reloading ${this.arsenal.current.shortName}…`)
        }
      }

      const spec = this.arsenal.current
      if (this.wheelOpen || this.phoneOpen) {
        this.input.consume('shoot')
      } else {
        const shouldFire = spec.fireMode === 'auto' && !this.holstered ? this.input.held('shoot') : this.input.consume('shoot')
        if (shouldFire) this.fire()
      }

      const arsenalEvent = this.arsenal.update(simDt)
      if (arsenalEvent.reloadCompleted) {
        this.ui.toast(`${this.arsenal.current.shortName} reloaded`)
        this.persist(false)
      }

      const active = this.vehicles.active
      const aiming = !active && !this.taxiRide && !this.wheelOpen && !this.phoneOpen && (this.aimingRightMouse || this.input.held('aim'))
      const unarmedActive = !active && (spec.fireMode === 'melee' || this.holstered)
      this.player.setAiming(!unarmedActive && aiming)
      this.player.setBlocking(unarmedActive && aiming)
      let swimming = false
      let crashedThisStep = false

      if (this.taxiRide) {
        this.input.consume('jump')
        const cabState = this.life.driveCabTo(this.taxiRide.target)
        this.taxiRide.cabPos.copy(cabState.position)
        this.taxiRide.cabHeading = cabState.heading
        this.player.root.position.set(cabState.position.x, 0.2, cabState.position.z)
        this.player.root.visible = false
        this.vehicles.update(simDt, { throttle: 0, steer: 0, handbrake: false }, (x, z) => this.world.surfaceAt(x, z))
        if (cabState.arrived) {
          this.player.root.position.set(this.taxiRide.target.x + 2, 0.2, this.taxiRide.target.z)
          resolvePlayerCollision(this.player.root.position, this.world.spawn, this.world.colliders)
          this.player.root.visible = true
          this.ui.toast(`CAB ARRIVED AT ${this.taxiRide.label}`)
          this.taxiRide = null
          this.life.consumeServiceUnit('taxi')
          this.persist()
        }
      } else if (active) {
        // Space is a handbrake in vehicles, not a buffered on-foot jump.
        this.input.consume('jump')
        const previousSpeed = active.speed
        if (this.rampCooldown === 0 && active.type !== 'boat' && active.type !== 'helicopter' && Math.abs(active.speed) > 8) {
          const ramp = this.world.ramps.find(item => Math.hypot(active.root.position.x - item.position.x, active.root.position.z - item.position.z) < 5.5)
          if (ramp) { active.root.position.y = Math.max(active.root.position.y, .24); active.velocity.y = Math.min(9.5, 4.2 + Math.abs(active.speed) * .13); this.rampCooldown = 2; this.ui.toast('STUNT JUMP') }
        }
        const trigThrottle = this.input.triggers.right - this.input.triggers.left
        const driveThrottle = Math.abs(this.input.move.y) > 0.08 ? this.input.move.y : trigThrottle
        this.vehicles.update(
          simDt,
          { throttle: driveThrottle, steer: this.input.move.x, handbrake: this.input.held('jump') },
          (x, z) => this.world.surfaceAt(x, z),
          this.rpg.drivingHandlingBonus,
        )
        const rx = this.vehicles.consumeCollisionReaction()
        if (rx.crashedHard || rx.ejectThroughWindshield || rx.glassShattered || rx.suspensionBottomed) {
          if (rx.crashedHard || rx.glassShattered) {
            crashedThisStep = true
            this.audio.crashSynth(Math.max(12, Math.abs(previousSpeed)), rx.glassShattered)
            this.input.padRumble(0.8, 150)
          }
          if (rx.suspensionBottomed) {
            this.audio.suspensionCreak(0.85)
          }
          if (rx.ejectThroughWindshield) {
            const ejectFrom = active.root.position.clone().add(new THREE.Vector3(-Math.sin(active.heading) * 2.1, 0.7, -Math.cos(active.heading) * 2.1))
            this.vehicles.exit()
            this.player.root.position.copy(ejectFrom)
            resolvePlayerCollision(this.player.root.position, active.root.position, this.world.colliders)
            this.player.root.visible = true
            this.player.launchRagdollTumble(rx.ejectionVelocity)
            this.save.health = Math.max(0, this.save.health - 28)
            this.heat.onVehicleChanged(null)
            this.prevEngineStalled = false
            this.ui.toast('LAUNCHED THROUGH WINDSHIELD! (-28 HP)')
            this.persist()
          }
        }
        const tele = this.vehicles.getActiveTelemetry()
        if (tele?.engineStalled && !this.prevEngineStalled) {
          this.ui.toast('ENGINE STALLED — HOLD [W] TO CRANK STARTER')
        }
        this.prevEngineStalled = Boolean(tele?.engineStalled)
        if (tele?.cranking && this.crankSoundCooldown <= 0) {
          this.audio.starterCrank(false)
          this.crankSoundCooldown = 0.35
        }
        if (this.vehicles.active && this.life.checkSpikeStripHit(active.root.position, this.heat.wanted)) {
          this.vehicles.puncture(active)
          this.audio.impact()
          this.ui.toast('SPIKE STRIP HIT — TIRES PUNCTURED!')
        }
        if (this.vehicles.active) {
          const dynHit = this.life.resolveDynamicCollisions(active.root.position, active.velocity, true, active.type === 'motorbike' ? 0.9 : 1.35)
          if (dynHit.impactSpeed > 4) {
            crashedThisStep = true
            this.vehicles.damage(active, dynHit.impactSpeed * 0.85)
            this.audio.crashSynth(dynHit.impactSpeed, dynHit.impactSpeed > 18)
            if (dynHit.hitRoadblock) {
              this.heat.reportCrime(active.root.position, 3, { immediate: true, policeSeePlayer: true, escalateIfEqual: true })
              this.audio.dispatchRadio(this.heat.wanted)
              this.ui.toast('SMASHED POLICE ROADBLOCK')
              this.persist()
            } else if (dynHit.hitTraffic && dynHit.impactSpeed > 8) {
              this.reportCrime(active.root.position, 1)
            }
          }
          const boundedX = THREE.MathUtils.clamp(active.root.position.x, -378, 368)
          const boundedZ = THREE.MathUtils.clamp(active.root.position.z, -378, 378)
          if (boundedX !== active.root.position.x) active.velocity.x = 0
          if (boundedZ !== active.root.position.z) active.velocity.z = 0
          active.root.position.x = boundedX; active.root.position.z = boundedZ
          const turn = Math.atan2(Math.sin(active.heading - this.yaw), Math.cos(active.heading - this.yaw))
          this.yaw += turn * Math.min(1, simDt * 1.8)
          this.player.root.position.copy(active.root.position)
          if (this.props.impact(active.root.position, previousSpeed)) {
            crashedThisStep = true
            this.vehicles.damage(active, Math.abs(previousSpeed) * 1.2)
            this.audio.crashSynth(Math.abs(previousSpeed), false)
            if (Math.abs(previousSpeed) > 8) this.reportCrime(active.root.position, 1)
          }
          const hit = this.life.impact(active.root.position, 1.6, Math.abs(previousSpeed))
          if (hit && Math.abs(active.speed) > 4) {
            this.reportCrime(active.root.position, 2, { immediate: true, escalateIfEqual: true })
            this.audio.impact()
          }
        }
      } else {
        swimming = this.world.surfaceAt(this.player.root.position.x, this.player.root.position.z) === 'water'
        const previous = this.player.root.position.clone()
        const supportY = swimming ? 0 : supportHeightAt(previous.x, previous.z, previous.y, this.world.colliders, this.world.ramps, 0)
        const canSprint = this.input.held('sprint') && !this.rpg.exhausted
        let jumpPressed = this.input.consume('jump')
        if (jumpPressed && unarmedActive && (Math.abs(this.input.move.x) > 0.25 || this.player.isBlocking)) {
          this.player.triggerDodge(this.yaw, this.input.move.x)
          jumpPressed = false
        }
        this.player.update(simDt, this.input.move.x, this.input.move.y, this.yaw, canSprint, this.input.held('crouch'), jumpPressed, swimming, supportY)
        if (resolvePlayerCollision(this.player.root.position, previous, this.world.colliders)) this.player.velocity.multiplyScalar(.45)
        if (this.vehicles.resolvePlayerCollision(this.player.root.position)) this.player.velocity.multiplyScalar(.4)
        this.life.resolveDynamicCollisions(this.player.root.position, this.player.velocity, false, 0.44)
        const trafficHit = this.hitCooldown <= 0 ? this.life.hitPlayer(this.player.root.position) : null
        if (trafficHit) { this.player.stagger(trafficHit.direction, trafficHit.force * .65); this.save.health = Math.max(0, this.save.health - trafficHit.force * 1.2); this.hitCooldown = 1; this.audio.impact() }
        this.vehicles.update(simDt, { throttle: 0, steer: 0, handbrake: false }, (x, z) => this.world.surfaceAt(x, z))
        if ((aiming && !unarmedActive) || this.weaponHotTimer > 0 || canSprint) {
          const aimDir = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize()
          if (this.life.intimidateWitnesses(this.player.root.position, aimDir, (aiming && !unarmedActive) || this.weaponHotTimer > 0)) {
            this.ui.toast('WITNESS INTIMIDATED — 911 CALL CANCELLED')
          }
        }
      }

      // San Andreas RPG progression step (stamina, hunger, muscle/fat physique, driving skill)
      const moving = Math.hypot(this.input.move.x, this.input.move.y) > 0.1
      const rpgEvent = this.rpg.update(simDt, {
        sprinting: this.input.held('sprint') && !this.rpg.exhausted,
        moving,
        swimming,
        inVehicle: !!active,
        vehicleSpeed: active?.speed ?? 0,
        crashed: crashedThisStep,
      })
      if (rpgEvent.leveledStat) {
        this.ui.toast(`${rpgEvent.leveledStat}`)
      }
      if (this.rpg.hungerHealthDrainPerSec > 0) {
        this.save.health = Math.max(0, this.save.health - this.rpg.hungerHealthDrainPerSec * simDt)
      }
      this.player.setPhysique(this.rpg.muscle, this.rpg.fat)

      // Update thrown/launched projectiles
      for (let i = this.projectiles.length - 1; i >= 0; i -= 1) {
        const proj = this.projectiles[i]
        proj.life -= simDt
        proj.velocity.y -= 15 * simDt
        proj.mesh.position.addScaledVector(proj.velocity, simDt)
        let detonate = proj.life <= 0
        if (proj.mesh.position.y <= 0.15) {
          proj.mesh.position.y = 0.15
          if (proj.impactDetonate) detonate = true
          else {
            proj.velocity.y = Math.abs(proj.velocity.y) * 0.35
            proj.velocity.x *= 0.72
            proj.velocity.z *= 0.72
          }
        }
        if (detonate) {
          this.detonateProjectile(proj)
          this.world.scene.remove(proj.mesh)
          ;(proj.mesh.material as THREE.Material).dispose()
          this.projectiles.splice(i, 1)
        }
      }

      const stuntJump = !!active && active.type !== 'boat' && active.type !== 'helicopter' && active.root.position.y > .1 && active.velocity.y > 0
      const result = this.missions.update(simDt, this.player.root.position, !!active, active?.speed ?? 0, stuntJump)
      if (result) {
        this.save.money += result.reward
        this.rpg.recordMissionComplete()
        if (!this.save.completed.includes(result.id)) this.save.completed.push(result.id)
        void this.board.complete(result.seconds, !tuning.unranked, result.id)
        this.persist()
        this.startCutscene('complete', this.player.root.position, `${result.title} COMPLETE  +$${result.reward.toLocaleString()}`)
      }

      const witnessEvents = this.life.consumeWitnessEvents()
      if (witnessEvents.cancelledReason === 'down') {
        this.ui.toast('WITNESS KNOCKED OUT — 911 REPORT PREVENTED')
      } else if (witnessEvents.cancelledReason === 'escaped') {
        this.ui.toast('OUT OF WITNESS SIGHT — 911 CALL ABORTED')
      }
      if (witnessEvents.completedReport?.observation) {
        this.knowledge.recordWitnessDispatch(witnessEvents.completedReport.observation, this.knowledge.currentOutfit)
      }
      const witnessSync = this.heat.syncWitnesses(witnessEvents.blips, witnessEvents.completedReport)
      if (witnessSync.dispatchConfirmed) {
        this.audio.dispatchRadio(this.heat.wanted)
        this.persist()
      }

      const policeSee = this.life.hasPoliceLineOfSight(this.player.root.position, this.heat.wanted)
      if (policeSee && this.heat.wanted > 0) {
        this.knowledge.recordSighting(this.currentSightingObservation())
      }
      const inStealth = this.world.districtAt(this.player.root.position.x, this.player.root.position.z) === 'The Wetlands'
        || this.world.safehouses.some(home => this.player.root.position.distanceTo(home.position) < home.radius + 8)
      const evasionBonus = this.knowledge.evasionDrainMultiplier(this.vehicles.active?.plateNumber ?? null)
      const heatStep = this.heat.update(simDt, this.player.root.position, policeSee, inStealth, evasionBonus)
      if (this.heat.wanted === 0) {
        this.knowledge.reset()
      }
      if (heatStep.dispatchConfirmed || heatStep.reinforcementEscalated) {
        this.audio.dispatchRadio(this.heat.wanted)
        this.persist()
      } else if (heatStep.starDropped) {
        this.ui.toast(this.heat.wanted === 0 ? 'HEAT CLEARED — COAST IS CLEAR' : 'HEAT COOLED DOWN')
        this.persist()
      }

      const turfStep = this.turf.update(simDt, this.player.root.position, this.yaw, !!this.vehicles.active, this.heat.wanted, this.life.getPoliceBlips())
      if (turfStep.homieEliminatedRival) {
        this.handleTurfZoneEvents(null, turfStep.homieEliminatedRival)
      }

      const copDamage = this.life.getDamage(this.player.root.position, simDt, this.heat.wanted)
      let harm = copDamage + turfStep.playerDamage
      if (harm > 0 && this.hitCooldown <= 0) {
        if (!this.vehicles.active && this.player.cover.active && this.player.cover.coverBehindCar) {
          this.player.damageCoverCar(harm)
          harm *= 0.28
        }
        if (!this.vehicles.active && this.player.isBlocking) {
          harm *= 0.4
        }
        if (this.playerArmor > 0) {
          const absorbed = Math.min(this.playerArmor, harm * 0.65)
          this.playerArmor = Math.max(0, this.playerArmor - absorbed)
          harm -= absorbed
        }
        this.save.health = Math.max(0, this.save.health - harm); this.hitCooldown = .35
        if (!this.vehicles.active && !this.player.cover.active) {
          this.player.stagger(new THREE.Vector3(Math.random() - .5, 0, Math.random() - .5).normalize(), 2)
        }
      }
      if (this.save.health <= 0) {
        this.vehicles.exit(); this.taxiRide = null; this.heat.reset(); this.knowledge.reset(); this.turf.dismissSquad(); this.player.root.visible = true; this.save.health = 100
        this.rpg.stamina = 100; this.rpg.exhausted = false; this.playerArmor = 0
        this.save.money = Math.max(0, this.save.money - 250); this.player.root.position.copy(this.world.spawn)
        this.ui.toast('WASTED — $250 hospital fee'); this.persist()
      }

      // Persist position, inventory, heat, RPG stats, and turf whenever game state changes
      this.saveTimer += dt
      const ammoTotal = this.arsenal.getAmmoDisplay().total
      const movedDist = this.player.root.position.distanceTo(this.lastSavedPos)
      const stateChanged =
        this.heat.wanted !== this.lastSavedWanted
        || this.arsenal.equippedId !== this.lastSavedWeapon
        || ammoTotal !== this.lastSavedAmmo
      if (stateChanged || (movedDist >= 8 && this.saveTimer >= 3.0) || this.saveTimer >= 12) {
        this.persist(stateChanged || this.saveTimer >= 6.0)
      }
    } else {
      this.input.consume('vehicle'); this.input.consume('interact'); this.input.consume('reload'); this.input.consume('shoot')
      this.input.consume('jump'); this.input.consume('confirm'); this.input.consume('stats'); this.input.consume('recruit'); this.input.consume('attach')
      this.input.consume('cover'); this.input.consume('phone'); this.input.consume('mask'); this.input.consume('holster')
    }

    const focus = this.player.root.position
    this.world.update(simDt, focus, this.save.weather)
    if (this.mode === 'playing' || this.mode === 'title') {
      const searchTarget = this.heat.getSearchTarget(focus)
      this.life.update(simDt, focus, this.mode === 'playing' ? this.heat.wanted : 0, searchTarget)
    }
    this.props.update(simDt)
    this.flashTime = Math.max(0, this.flashTime - simDt); this.muzzleFlash.visible = this.flashTime > 0
    this.objectiveBeacon.visible = !this.missions.current
    this.objectiveBeacon.rotation.y += simDt * .6
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const trace = this.tracers[i]; trace.life -= simDt
      if (trace.life <= 0) { this.world.scene.remove(trace.mesh); trace.mesh.geometry.dispose(); (trace.mesh.material as THREE.Material).dispose(); this.tracers.splice(i, 1) }
    }
    const pursuerKin = this.life.getNearestPursuerKinematics(focus, this.heat.wanted, Math.max(0.016, simDt))
    const vTele = this.vehicles.getActiveTelemetry()
    this.audio.update(
      this.vehicles.active?.speed ?? 0,
      !!this.vehicles.active,
      this.heat.wanted,
      this.mode === 'playing',
      this.heat.inSight,
      {
        approachSpeed: pursuerKin.approachSpeed,
        pursuerDist: pursuerKin.distance,
        engineStalled: vTele?.engineStalled ?? false,
        cranking: (vTele?.crankProgress ?? 0) > 0,
        turbo: this.vehicles.active?.type === 'sport',
      },
    )
  }

  render(dt: number): void {
    if (this.mode === 'cutscene') {
      const cut = this.cutscenes.update(dt, this.camera)
      if (cut.weather) this.cutsceneWeather = cut.weather
      if (!cut.finished) this.ui.updateCutscene(cut.state)
      this.renderer.render(this.world.scene, this.camera)
      return
    }

    const focus = this.player.root.position
    const targetYaw = this.mode === 'title' ? Math.sin(this.elapsed * .08) * .16 : this.yaw
    const speed = Math.abs(this.vehicles.active?.speed ?? 0)
    const aiming = this.mode === 'playing' && !this.vehicles.active && !this.taxiRide && !this.wheelOpen && (this.aimingRightMouse || this.input.held('aim'))
    const spec = this.arsenal.current
    if (this.taxiRide) {
      const h = this.taxiRide.cabHeading
      const rightX = Math.cos(h)
      const rightZ = -Math.sin(h)
      const fwdX = Math.sin(h)
      const fwdZ = Math.cos(h)
      this.camera.position.set(
        this.taxiRide.cabPos.x + rightX * 0.42 - fwdX * 0.35,
        this.taxiRide.cabPos.y + 1.32,
        this.taxiRide.cabPos.z + rightZ * 0.42 - fwdZ * 0.35,
      )
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, 64, 1 - Math.exp(-10 * dt))
      this.camera.updateProjectionMatrix()
      const lookYaw = h + Math.sin(this.yaw - h) * 0.65
      this.camera.lookAt(
        this.camera.position.x + Math.sin(lookYaw) * 14,
        this.camera.position.y - this.pitch * 4 + 0.15,
        this.camera.position.z + Math.cos(lookYaw) * 14,
      )
    } else {
      const distance = this.vehicles.active ? 11.5 + Math.min(2.5, speed * .035) : aiming ? CONFIG.camera.distance - 0.6 : CONFIG.camera.distance + 1.4
      const desired = new THREE.Vector3(focus.x + Math.sin(targetYaw) * distance, focus.y + (aiming ? 3.8 : 4.8) + this.pitch * 5, focus.z + Math.cos(targetYaw) * distance)
      this.camera.position.lerp(desired, 1 - Math.exp(-Math.max(2, CONFIG.camera.follow) * dt))
      const targetFov = this.vehicles.active ? 59 + Math.min(4, speed * .08) : aiming ? spec.adsFov : CONFIG.camera.fov
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 1 - Math.exp(-12 * dt))
      this.camera.updateProjectionMatrix()
      this.camera.lookAt(focus.x, focus.y + 1.45, focus.z)
    }
    this.renderer.render(this.world.scene, this.camera)
    if (this.capturePhotoNextRender) {
      this.capturePhotoNextRender = false
      try {
        this.latestPhoto = this.renderer.gl.domElement.toDataURL('image/jpeg', 0.78)
        this.photoCount += 1
      } catch {
        // Headless fallback
      }
    }

    const near = this.vehicles.nearest(focus, 6)
    let prompt = this.taxiRide
      ? `CAB TO ${this.taxiRide.label}  ·  ENTER/SPACE SKIP (+$10)  ·  F EXIT`
      : this.vehicles.active
        ? (Math.abs(this.vehicles.active.speed) > 12 ? 'F  HIGH-SPEED BAILOUT' : 'F  EXIT VEHICLE')
        : near ? `F  ENTER ${near.name.toUpperCase()}` : ''
    const nearbyBay = this.world.resprayBays.find(item => focus.distanceTo(item.position) < item.radius)
    const nearbyStore = this.world.stores.find(item => focus.distanceTo(item.position) < item.radius && !this.robbedStores.has(item.id))
    const nearbyGym = this.world.gyms.find(item => focus.distanceTo(item.position) < item.radius)
    const nearbyStand = this.world.foodStands.find(item => focus.distanceTo(item.position) < item.radius)
    const nearbyAmb = this.life.getServiceUnitState('ambulance', focus, 6)
    const nearbyCab = !this.taxiRide && this.life.isCabNearby(focus, 7.5)
    const nearbyJacob = this.life.getServiceUnitState('arms_van', focus, 6.5)
    if (!this.taxiRide) {
      if (nearbyBay) prompt = `E  PAY 'N' SPRAY ($${nearbyBay.price})`
      else if (nearbyAmb) prompt = 'E  AMBULANCE HEAL (+100 HP)'
      else if (nearbyCab) prompt = 'E  HAIL YELLOW CAB'
      else if (nearbyJacob) prompt = 'E  LITTLE JACOB ARMS VAN'
      else if (nearbyStore) prompt = `E  ROB ${nearbyStore.name}`
      else if (nearbyGym) prompt = `E  WORK OUT (${nearbyGym.name.toUpperCase()})`
      else if (nearbyStand) prompt = `E  EAT AT ${nearbyStand.name.toUpperCase()} ($${nearbyStand.price})`
      else if (!this.missions.current && Math.hypot(focus.x + 8, focus.z) < 7) prompt = 'E  START FIRST CONTRACT'
      if (this.world.safehouses.some(home => focus.distanceTo(home.position) < home.radius + 4)) prompt = 'E  SAFEHOUSE / WARDROBE / RESTOCK'
    }

    const minutes = 16 * 60 + 13 + Math.floor(this.elapsed / 6)
    const time = `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
    this.currentTimeLabel = time
    const target = this.missions.target
    const ammoInfo = this.arsenal.getAmmoDisplay(spec)
    const activeWar = this.turf.activeWar
    const apbIntel = this.knowledge.getApbHudIntel(this.vehicles.active?.plateNumber ?? null, this.heat.wanted)
    const apbExpanded = this.input.held('inspect') || this.wheelOpen
    const rawTele = this.vehicles.getActiveTelemetry()

    this.ui.update({
      money: this.save.money,
      health: this.save.health,
      ammo: ammoInfo.mag,
      weaponName: this.holstered ? `${spec.shortName} [HOLSTERED]` : spec.shortName,
      weaponAmmoText: this.holstered ? 'CONCEALED' : spec.fireMode === 'melee' ? 'MELEE' : `${ammoInfo.mag} / ${ammoInfo.reserve}`,
      stamina: this.rpg.stamina,
      homies: this.turf.recruitedCount,
      maxHomies: this.rpg.maxHomies,
      turfWar: activeWar ? { zoneName: activeWar.name, wave: activeWar.wave, totalWaves: activeWar.totalWaves, remaining: activeWar.remainingEnemies } : null,
      gangZones: this.turf.getMapZones(),
      homieBlips: this.turf.getHomiePositions(),
      rivalBlips: this.turf.getRivalPositions(),
      wanted: this.heat.wanted,
      speed: Math.abs(this.vehicles.active?.speed ?? 0),
      district: this.world.districtAt(focus.x, focus.z),
      objective: this.missions.objective,
      time,
      inVehicle: !!this.vehicles.active,
      x: focus.x,
      z: focus.z,
      heading: this.yaw,
      prompt,
      weather: this.save.weather,
      target: target ? { x: target.x, z: target.z } : null,
      safehouses: this.world.safehouses.map(home => ({ x: home.position.x, z: home.position.z })),
      heat: this.heat.getHudState(),
      police: this.life.getPoliceBlips(),
      policeRadars: this.life.getPoliceRadars(focus, this.heat.wanted),
      nearestPursuerDist: this.life.nearestPursuerDistance(focus, this.heat.wanted),
      armor: this.playerArmor,
      apb: apbIntel,
      apbTickerExpanded: apbExpanded,
      grittyFilter: this.grittyFilter,
      vehicleTelemetry: rawTele
        ? {
            seatbeltLatched: rawTele.seatbeltBuckled,
            engineStalled: rawTele.engineStalled,
            crankProgress: rawTele.crankProgress,
            plateNumber: rawTele.plateNumber,
            windshieldCracked: rawTele.windshieldCracked,
            damagedTire: rawTele.wheelSlip > 0.4,
          }
        : null,
    })

    const district = this.world.districtAt(focus.x, focus.z)
    this.ui.updatePhone(dt, {
      open: this.phoneOpen && this.mode === 'playing',
      time,
      money: this.save.money,
      district,
      grittyFilter: this.grittyFilter,
      ringtone: this.ringtone,
      weather: this.save.weather,
      cabActive: Boolean(nearbyCab),
      jacobActive: Boolean(nearbyJacob),
      latestPhoto: this.latestPhoto,
      photoCount: this.photoCount,
    })

    const spreadRad = this.arsenal.effectiveSpread(spec, {
      aiming,
      crouching: this.input.held('crouch'),
      sprinting: this.input.held('sprint') && !this.rpg.exhausted,
      weaponSkill: this.rpg.weaponSkill,
    })
    const reloadProgress = this.arsenal.reloadTotal > 0 ? 1 - this.arsenal.reloadTimer / this.arsenal.reloadTotal : 0
    this.ui.updateCombat(dt, {
      wheelOpen: this.wheelOpen,
      statsOpen: this.statsOpen,
      aiming,
      reloading: this.arsenal.reloadTimer > 0,
      reloadProgress,
      spreadPx: Math.max(5, Math.min(28, 6 + spreadRad * 260)),
      weapon: spec,
      mag: ammoInfo.mag,
      reserve: ammoInfo.reserve,
      attachments: [...(this.arsenal.attachments.get(spec.id) ?? [])],
      rpg: this.rpg.getHudState(),
      homieCount: this.turf.recruitedCount,
      turfWar: activeWar ? { zoneName: activeWar.name, wave: activeWar.wave, totalWaves: activeWar.totalWaves, remaining: activeWar.remainingEnemies } : null,
    })

    const interactShort = nearbyBay
      ? `SPRAY $${nearbyBay.price}`
      : nearbyAmb
        ? 'HEAL +100'
        : nearbyCab
          ? 'HAIL CAB'
          : nearbyJacob
            ? 'JACOB VAN'
            : nearbyStore
              ? `ROB STORE`
              : nearbyGym
                ? 'WORK OUT'
                : nearbyStand
                  ? `EAT $${nearbyStand.price}`
                  : (!this.missions.current && Math.hypot(focus.x + 8, focus.z) < 7)
                    ? 'CONTRACT'
                    : this.world.safehouses.some(home => focus.distanceTo(home.position) < home.radius + 4)
                      ? 'SAFEHOUSE'
                      : ''
    this.touchControls.update({
      visible: this.mode === 'playing',
      inVehicle: Boolean(this.vehicles.active),
      inTaxi: Boolean(this.taxiRide),
      nearVehicleLabel: near ? `ENTER ${near.name.split(' ')[0].toUpperCase()}` : '',
      interactLabel: interactShort,
      holstered: this.holstered,
      masked: this.knowledge.masked,
      inCover: this.player.cover.active,
      aiming,
      wheelOpen: this.wheelOpen,
      phoneOpen: this.phoneOpen,
    })
  }
}
