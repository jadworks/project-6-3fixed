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
import { flushPendingCloudSync, loadCloudPlayerSave, mergeCitySaves, persistPlayerState } from '../firebase/cloudStore'
import type { User } from 'firebase/auth'
import { resolvePlayerCollision, supportHeightAt, worldRayDistance } from './worldCollision'
import { CONFIG } from './config'
import { tuning } from './tuning'
import { type AttachmentId, WeaponArsenal, type WeaponSpec } from './weapons'
import { SanAndreasRpg } from './sanAndreasRpg'
import { GangTurfSystem, type TurfZoneState } from './gangTurf'
import { PoliceKnowledgeSystem } from './policeKnowledge'
import type { PhoneRingtone } from '../components/SmartphoneHud'
import type { HudDrawerState } from '../components/GameHud'
import { TouchControls } from '../components/TouchControls'
import { WEAPON_CATALOG } from './weapons'
import { StoreWorld, getCooldownRemaining, getStoreStatus } from './storeWorld'
import {
  STORES_CATALOG,
  STORE_CATEGORY_LABELS,
  applyWastedEconomyPenalty,
  depositCashToBank,
  fenceUncleanedLoot,
  getStoreById,
  type StoreMenuItem,
} from './storesCatalog'
import {
  HotZoneTracker,
  LOADOUT_LIMITS,
  PartnerWingman,
  bondBonusMultipliers,
  getConductTier,
  isHandgunWeapon,
  isLongGunWeapon,
  resolveNpcDialogue,
  type NpcDialogueTone,
  type ProtagonistId,
} from './gta6Systems'

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
const WEATHERS = ['day', 'sunset', 'overcast', 'haze', 'fog', 'rain', 'storm', 'night'] as const

interface OverlayResetOptions {
  keepWheel?: boolean
  keepPhone?: boolean
  keepDrawer?: boolean
}

interface NearbyInteractables {
  nearVehicle: ReturnType<VehicleSystem['nearest']>
  bay: ViceWorld['resprayBays'][number] | undefined
  personalCar: ReturnType<VehicleSystem['getPersonalVehicle']>
  nearPersonalTrunk: boolean
  storeWorld: ReturnType<StoreWorld['findNearestInteractable']>
  amb: ReturnType<CityLife['getServiceUnitState']>
  cabNearby: boolean
  jacob: ReturnType<CityLife['getServiceUnitState']>
  gym: ViceWorld['gyms'][number] | undefined
  stand: ViceWorld['foodStands'][number] | undefined
  atIntroBeacon: boolean
  atSafehouse: boolean
}

abstract class ViceSessionBase {
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
  readonly storeWorld = new StoreWorld(this.world.scene)
  readonly partner = new PartnerWingman(this.world.scene)
  readonly hotZones = new HotZoneTracker()
  readonly cutscenes: CutsceneDirector
  readonly save = loadCitySave()
  readonly camera = new THREE.PerspectiveCamera(60, 1, .1, 980)
  protected readonly robbedStores: Set<string>

  mode: Mode = 'title'
  protected yaw = 0
  protected pitch = .2
  protected elapsed = 0
  protected wheelOpen = false
  protected wheelPinned = false
  protected statsOpen = false
  protected phoneOpen = false
  protected holstered = false
  protected playerArmor = 0
  protected ringtone: PhoneRingtone = 'classic'
  protected prevEngineStalled = false
  protected currentTimeLabel = '16:13'
  protected drawer: HudDrawerState | null = null
  protected activeStoreId: string | null = null
  protected activeDialogueNpcId: string | null = null
  protected activeDialogueWitness = false
  protected taxiRide: { dest: 'objective' | 'safehouse' | 'respray'; target: THREE.Vector3; label: string; cabPos: THREE.Vector3; cabHeading: number } | null = null
  protected lastHailedCabPos: THREE.Vector3 | null = null
  abstract readonly ui: GameHud
  abstract readonly touchControls: TouchControls

  constructor(
    protected readonly renderer: Renderer,
    protected readonly input: Input,
    protected readonly audio: ViceAudio,
  ) {
    this.renderer.attachEnvironment(this.world.scene)
    this.world.colliders.push(...this.storeWorld.colliders)
    this.vehicles.setWorldGeometry(this.world.colliders, this.world.ramps)
    this.life.setWorldColliders(this.world.colliders)
    this.turf.setWorldColliders(this.world.colliders)
    this.cutscenes = new CutsceneDirector(this.world.scene, this.audio)
    this.robbedStores = new Set(this.save.robbedStores)
  }

  abstract persist(syncCloud?: boolean): void

  protected closeOverlays(opts: OverlayResetOptions = {}): void {
    if (!opts.keepWheel) {
      this.wheelOpen = false
      this.wheelPinned = false
    }
    if (!opts.keepPhone) {
      this.phoneOpen = false
    }
    if (!opts.keepDrawer) {
      this.drawer = null
      this.activeStoreId = null
      this.activeDialogueNpcId = null
    }
  }

  protected syncPointerLock(): void {
    if (this.mode === 'playing' && !this.wheelOpen && !this.phoneOpen && !this.drawer) {
      this.input.lockPointer()
    } else {
      this.input.unlockPointer()
    }
  }

  protected setPhoneOpen(open: boolean): void {
    if (this.mode !== 'playing' && open) return
    this.phoneOpen = open
    if (open) {
      this.closeOverlays({ keepPhone: true, keepDrawer: true })
    }
    this.syncPointerLock()
  }

  protected togglePhone(): void {
    this.setPhoneOpen(!this.phoneOpen)
    if (this.phoneOpen && this.ringtone !== 'silent') this.audio.phoneTone('beep')
  }

  protected closeDrawer(): void {
    this.closeOverlays({ keepWheel: true, keepPhone: true })
    this.syncPointerLock()
  }

  protected syncWeaponVisual(): void {
    const spec = this.arsenal.current
    this.player.setWeaponVisual(
      spec.category,
      spec.id,
      this.arsenal.hasAttachment(spec.id, 'suppressor'),
      this.arsenal.lastLongGunId,
    )
  }

  protected equipWeaponSpec(spec: WeaponSpec, toastMessage?: string, unpinWheel = false): void {
    this.holstered = false
    this.player.setHolstered(false)
    this.syncWeaponVisual()
    if (unpinWheel) {
      this.wheelPinned = false
      this.wheelOpen = false
    }
    this.ui.toast(toastMessage ?? `EQUIPPED: ${spec.name.toUpperCase()}`)
  }

  protected toggleWeaponAttachment(att: AttachmentId): void {
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

  protected currentRecognitionModifiers() {
    return this.knowledge.recognitionModifiers(this.vehicles.active?.plateNumber ?? null)
  }

  protected swapDisguiseOutfit() {
    const policeSee = this.life.hasPoliceLineOfSight(this.player.root.position, this.heat.wanted, this.currentRecognitionModifiers())
    const { outfit } = this.knowledge.cycleOutfit(policeSee)
    this.player.setOutfit(outfit)
    return { outfit, policeSee }
  }

  protected restockAllAmmo(pack: 'full' | 'safehouse'): void {
    const amounts = pack === 'full'
      ? { handgun: 60, smg: 120, shotgun: 24, rifle: 90, precision: 20, heavy: 4, throwable: 4 }
      : { handgun: 45, smg: 90, shotgun: 16, rifle: 60, precision: 15, heavy: 4, throwable: 3 }
    this.arsenal.addAmmo('handgun', amounts.handgun)
    this.arsenal.addAmmo('smg', amounts.smg)
    this.arsenal.addAmmo('shotgun', amounts.shotgun)
    this.arsenal.addAmmo('rifle', amounts.rifle)
    this.arsenal.addAmmo('precision', amounts.precision)
    this.arsenal.addAmmo('heavy', amounts.heavy)
    this.arsenal.addAmmo('throwable', amounts.throwable)
  }

  protected togglePlayerCover(verbose = false): void {
    if (this.mode !== 'playing' || this.vehicles.active || this.wheelOpen || this.phoneOpen) return
    const carCoords = this.vehicles.vehicles.map(v => ({
      x: v.root.position.x,
      z: v.root.position.z,
      heading: v.heading,
      halfWidth: 1.05,
    }))
    const inCover = this.player.toggleCover(this.world.colliders, carCoords)
    if (!inCover) return
    if (verbose) {
      this.ui.toast(this.player.cover.coverBehindCar
        ? 'COVER BEHIND CAR — LMB BLIND-FIRE / RMB AIM PEEK'
        : 'IN COVER — LMB BLIND-FIRE / RMB AIM PEEK')
    } else {
      this.ui.toast(this.player.cover.coverBehindCar ? 'COVER BEHIND CAR' : 'IN COVER')
    }
  }

  protected toggleBandanaMask(verbose = false): void {
    if (this.mode !== 'playing') return
    const masked = this.knowledge.toggleMask()
    this.player.setMasked(masked)
    if (verbose) {
      this.ui.toast(masked ? 'BANDANA MASK ON — FACE CONCEALED (+EVASION)' : 'BANDANA MASK OFF')
    } else {
      this.ui.toast(masked ? 'BANDANA MASK ON' : 'BANDANA MASK OFF')
    }
  }

  protected recruitCrewOrPartner(allowPartnerFallback: boolean): void {
    if (this.mode !== 'playing') return
    const res = this.turf.recruitNearby(this.player.root.position, this.rpg.maxHomies)
    if (res.recruitedNow > 0) {
      this.audio.recruitWhistle()
      this.ui.toast(allowPartnerFallback
        ? `RECRUITED ${res.recruitedNow} HOMIE${res.recruitedNow > 1 ? 'S' : ''} (SQUAD ${res.totalSquad}/${this.rpg.maxHomies})`
        : `RECRUITED ${res.recruitedNow} HOMIE${res.recruitedNow > 1 ? 'S' : ''}`)
      return
    }
    if (!allowPartnerFallback) {
      this.ui.toast(res.atCap ? 'SQUAD AT MAX CAPACITY' : 'NO ALLIED CREW NEARBY')
      return
    }
    const lead: ProtagonistId = this.save.protagonist === 'lucia' ? 'lucia' : 'jason'
    const activeNow = this.partner.toggle(this.player.root.position, lead)
    const partnerName = lead === 'jason' ? 'LUCIA' : 'JASON'
    this.audio.recruitWhistle()
    this.ui.toast(activeNow ? `${partnerName} JOINED AS ACTIVE PARTNER WINGMAN!` : `${partnerName} STANDING DOWN`)
  }

  protected clearActiveRide(placeAt?: THREE.Vector3, safeAnchor?: THREE.Vector3): void {
    if (this.vehicles.active) this.vehicles.exit()
    if (placeAt) {
      this.player.root.position.copy(placeAt)
      resolvePlayerCollision(this.player.root.position, safeAnchor ?? this.world.spawn, this.world.colliders)
    }
    this.player.root.visible = true
    this.heat.onVehicleChanged(null)
    this.prevEngineStalled = false
  }

  protected currentSightingObservation() {
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

  protected currentWitnessObservation() {
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

  protected resolveCabDestination(dest: 'objective' | 'safehouse' | 'respray'): { target: THREE.Vector3; label: string } {
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

  protected scanNearbyInteractables(pos: THREE.Vector3): NearbyInteractables {
    const personalCar = this.vehicles.getPersonalVehicle()
    return {
      nearVehicle: this.vehicles.nearest(pos, 6),
      bay: this.world.resprayBays.find(item => pos.distanceTo(item.position) < item.radius),
      personalCar,
      nearPersonalTrunk: !this.vehicles.active && Boolean(personalCar) && pos.distanceTo(this.vehicles.getTrunkPosition(personalCar!)) < 3.2,
      storeWorld: this.storeWorld.findNearestInteractable(pos, 5.2),
      amb: this.life.getServiceUnitState('ambulance', pos, 6),
      cabNearby: !this.taxiRide && this.life.isCabNearby(pos, 7.5),
      jacob: this.life.getServiceUnitState('arms_van', pos, 6.5),
      gym: this.world.gyms.find(item => pos.distanceTo(item.position) < item.radius),
      stand: this.world.foodStands.find(item => pos.distanceTo(item.position) < item.radius),
      atIntroBeacon: !this.missions.current && Math.hypot(pos.x + 8, pos.z) < 7,
      atSafehouse: this.world.safehouses.some(home => pos.distanceTo(home.position) < home.radius + 4),
    }
  }

  protected buildInteractionPrompt(near: NearbyInteractables): { prompt: string; shortPrompt: string } {
    if (this.taxiRide) {
      return {
        prompt: `CAB TO ${this.taxiRide.label}  ·  ENTER/SPACE SKIP (+$10)  ·  F EXIT`,
        shortPrompt: '',
      }
    }
    if (near.atSafehouse) return { prompt: 'E  SAFEHOUSE / WARDROBE / RESTOCK', shortPrompt: 'SAFEHOUSE' }
    if (near.bay) return { prompt: `E  PAY 'N' SPRAY ($${near.bay.price})`, shortPrompt: `SPRAY $${near.bay.price}` }
    if (near.nearPersonalTrunk && near.personalCar) {
      return { prompt: `E  OPEN ${near.personalCar.name.toUpperCase()} TRUNK ARMORY`, shortPrompt: 'TRUNK ARMORY' }
    }
    if (near.storeWorld) {
      return { prompt: `E  ENTER / SHOP / ROB ${near.storeWorld.store.spec.name.toUpperCase()}`, shortPrompt: 'ENTER STORE' }
    }
    if (near.amb) return { prompt: 'E  AMBULANCE HEAL (+100 HP)', shortPrompt: 'HEAL +100' }
    if (near.cabNearby) return { prompt: 'E  HAIL YELLOW CAB', shortPrompt: 'HAIL CAB' }
    if (near.jacob) return { prompt: 'E  LITTLE JACOB ARMS VAN', shortPrompt: 'JACOB VAN' }
    if (near.gym) return { prompt: `E  WORK OUT (${near.gym.name.toUpperCase()})`, shortPrompt: 'WORK OUT' }
    if (near.stand) return { prompt: `E  EAT AT ${near.stand.name.toUpperCase()} ($${near.stand.price})`, shortPrompt: `EAT $${near.stand.price}` }
    if (near.atIntroBeacon) return { prompt: 'E  START FIRST CONTRACT', shortPrompt: 'CONTRACT' }

    const active = this.vehicles.active
    const prompt = active
      ? (Math.abs(active.speed) > 12 ? 'F  HIGH-SPEED BAILOUT' : 'F  EXIT VEHICLE')
      : near.nearVehicle ? `F  ENTER ${near.nearVehicle.name.toUpperCase()}` : ''
    return { prompt, shortPrompt: '' }
  }
}

export class ViceGame extends ViceSessionBase {
  readonly ui: GameHud
  readonly touchControls: TouchControls
  private shotCooldown = 0
  private hitCooldown = 0
  private rampCooldown = 0
  private lockLostAt = 0
  private saveTimer = 0
  private weaponHotTimer = 0
  private aimingRightMouse = false
  private prevPadLabel = ''
  private grittyFilter = true
  private latestPhoto: string | null = null
  private photoCount = 0
  private capturePhotoNextRender = false
  private softwareGlRenderAccum = 1
  private crankSoundCooldown = 0
  private fuelNoticeCooldown = 0
  private focusGauge = 100
  private focusActive = false
  private activeStoreCategory = 'all'
  private customWaypoint: THREE.Vector3 | null = null
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
  private peakWanted = 0
  private turfIncomeAccum = 0
  private readonly onOnline = () => {
    if (this.currentUser) {
      void flushPendingCloudSync(this.currentUser, this.save).then(res => {
        if (res.flushed) this.ui.toast('OFFLINE SAVE SYNCED TO CLOUD')
      })
    }
  }

  constructor(renderer: Renderer, input: Input, audio: ViceAudio, root: HTMLElement) {
    super(renderer, input, audio)
    this.world.scene.add(this.player.root)
    this.muzzleFlash.visible = false; this.world.scene.add(this.muzzleFlash)
    this.applySavedPlayerState()
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
      onDrawerAction: actionId => this.handleDrawerAction(actionId),
      onCloseDrawer: () => this.closeDrawer(),
      onSelectMapFilter: cat => { this.activeStoreCategory = cat },
      switchProtagonist: () => this.switchProtagonist(),
      combat: {
        selectSector: (idx, cycle) => {
          const w = this.arsenal.selectSector(idx, cycle)
          this.equipWeaponSpec(w, `EQUIPPED: ${w.name.toUpperCase()}`, !cycle && this.wheelPinned)
        },
        selectWeapon: id => {
          const w = this.arsenal.selectWeapon(id)
          this.equipWeaponSpec(w, `EQUIPPED: ${w.name.toUpperCase()}`, this.wheelPinned)
        },
        toggleAttachment: att => this.toggleWeaponAttachment(att),
        closeWheel: () => {
          this.closeOverlays({ keepPhone: true, keepDrawer: true })
          this.syncPointerLock()
        },
        closeStats: () => {
          this.statsOpen = false
        },
        switchProtagonist: () => this.switchProtagonist(),
      },
      phone: {
        onKeyBeep: () => this.audio.phoneTone('beep'),
        onCall911: service => this.handlePhone911(service),
        onCallCab: () => this.handlePhoneCallCab(),
        onRideCab: dest => this.handlePhoneRideCab(dest),
        onSkipRide: dest => this.handlePhoneSkipRide(dest),
        onCallJacob: order => this.handlePhoneJacob(order),
        onSocialEvent: evId => this.handleSocialEvent(evId),
        onDepositBank: () => this.handlePhoneDepositBank(),
        onWithdrawBank: () => this.handlePhoneWithdrawBank(),
        onRequestPersonalCar: () => this.deliverPersonalVehicle(),
        onSwitchProtagonist: () => this.switchProtagonist(),
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
      onToggleCover: () => this.togglePlayerCover(false),
      onToggleMask: () => this.toggleBandanaMask(false),
      onToggleStats: () => {
        if (this.mode === 'playing') this.statsOpen = !this.statsOpen
      },
      onRecruit: () => this.recruitCrewOrPartner(false),
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
        && !this.drawer
      ) {
        this.lockLostAt = performance.now()
        this.pause()
      }
    })
    window.addEventListener('keydown', e => {
      if (this.mode !== 'playing') return
      if (this.drawer) {
        if (e.code === 'Escape') { e.preventDefault(); this.closeDrawer(); return }
        if (e.code >= 'Digit1' && e.code <= 'Digit6') {
          const idx = Number(e.code.slice(5)) - 1
          const act = this.drawer.actions[idx]
          if (act && !act.disabled) { e.preventDefault(); this.handleDrawerAction(act.id) }
          return
        }
      }
      if (e.code === 'KeyK') {
        e.preventDefault()
        this.switchProtagonist()
        return
      }
      if (e.code === 'KeyN' && !this.phoneOpen && !this.wheelOpen) {
        e.preventDefault()
        this.openNpcDialogueDrawer()
        return
      }
      if (e.code === 'KeyU' && !this.phoneOpen && !this.wheelOpen) {
        e.preventDefault()
        this.focusActive = !this.focusActive && this.focusGauge > 5
        this.ui.toast(this.focusActive ? 'TACTICAL FOCUS SLOW-MO ENGAGED' : 'FOCUS NORMAL')
        return
      }
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
        this.equipWeaponSpec(w, w.shortName)
      }
    })
    window.addEventListener('mousedown', e => { if (e.button === 2 && this.mode === 'playing') this.aimingRightMouse = true })
    window.addEventListener('mouseup', e => { if (e.button === 2) this.aimingRightMouse = false })
    window.addEventListener('contextmenu', e => { if (this.mode === 'playing') e.preventDefault() })
    window.addEventListener('blur', () => {
      this.aimingRightMouse = false
      this.closeOverlays({ keepDrawer: true })
      this.touchControls.releaseAll()
      if (this.mode === 'playing') this.pause()
    })
    window.addEventListener('online', this.onOnline)
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
    const { target, label } = this.resolveCabDestination(dest)
    this.clearActiveRide(target, this.world.spawn)
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
    this.restockAllAmmo('full')
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
    const lead: ProtagonistId = this.save.protagonist === 'lucia' ? 'lucia' : 'jason'
    this.save.protagonist = lead
    this.save.bankBalance = this.save.bankBalance ?? 2500
    this.save.uncleanedLoot = this.save.uncleanedLoot ?? 0
    this.save.partnerBond = this.save.partnerBond ?? 32
    this.save.conductScore = this.save.conductScore ?? 0
    this.save.fuelEnabled = this.save.fuelEnabled !== false
    this.player.setProtagonistAppearance(lead, this.save.hairstyle)
    this.partner.syncIdentity(lead)
    this.syncWeaponVisual()
    this.lastSavedPos.copy(this.player.root.position)
    this.lastSavedWanted = this.heat.wanted
    this.lastSavedWeapon = this.arsenal.equippedId
    this.lastSavedAmmo = this.arsenal.getAmmoDisplay().total
  }

  private switchProtagonist(): void {
    const next: ProtagonistId = this.save.protagonist === 'jason' ? 'lucia' : 'jason'
    this.save.protagonist = next
    this.player.setProtagonistAppearance(next, this.save.hairstyle)
    this.partner.syncIdentity(next)
    this.audio.phoneTone('beep')
    this.ui.toast(`SWITCHED LEAD TO ${next.toUpperCase()} · BOND ${Math.round(this.save.partnerBond ?? 32)}%`)
    this.persist(false)
  }

  private handleSocialEvent(evId: string): void {
    const map: Record<string, { x: number; z: number; label: string }> = {
      race: { x: 45, z: -120, label: 'Midnight Beach Sprint' },
      truck: { x: -70, z: -116, label: 'Fleeca Armored Van' },
      cargo: { x: 61, z: 161, label: 'Port Quay Cargo Drop' },
    }
    const target = map[evId]
    if (!target) return
    this.customWaypoint = new THREE.Vector3(target.x, 0, target.z)
    this.setPhoneOpen(false)
    this.ui.toast(`GPS WAYPOINT SET: ${target.label.toUpperCase()}`)
  }

  private handlePhoneDepositBank(): void {
    const moved = depositCashToBank(this.save as { money: number; bankBalance: number })
    if (moved <= 0) {
      this.ui.toast('No cash on hand to deposit')
      return
    }
    this.audio.phoneTone('beep')
    this.ui.toast(`BUCKME BANK: DEPOSITED $${moved.toLocaleString()} (PROTECTED)`)
    this.persist()
  }

  private handlePhoneWithdrawBank(): void {
    const bank = this.save.bankBalance ?? 0
    const amt = Math.min(500, bank)
    if (amt <= 0) {
      this.ui.toast('Bank balance empty')
      return
    }
    this.save.bankBalance = bank - amt
    this.save.money += amt
    this.audio.phoneTone('beep')
    this.ui.toast(`BUCKME BANK: WITHDREW $${amt.toLocaleString()}`)
    this.persist()
  }

  private deliverPersonalVehicle(): void {
    const personal = this.vehicles.getPersonalVehicle()
    if (!personal) {
      this.ui.toast('No Personal Vehicle available')
      return
    }
    const p = this.player.root.position
    const streetX = Math.abs(p.x) < 35 ? (p.x >= 0 ? 7.2 : -7.2) : THREE.MathUtils.clamp(p.x + 3.5, -280, 45)
    personal.root.position.set(streetX, 0, THREE.MathUtils.clamp(p.z + 4.5, -360, 360))
    personal.velocity.set(0, 0, 0)
    personal.speed = 0
    personal.health = 100
    this.vehicles.refuel(personal)
    this.setPhoneOpen(false)
    this.audio.phoneTone('respray')
    this.ui.toast(`MECHANIC DELIVERED ${personal.name.toUpperCase()} TO CURB`)
  }

  private openStoreDrawer(storeId: string): void {
    const spec = getStoreById(storeId)
    const runtime = this.storeWorld.states.find(s => s.spec.id === storeId)
    if (!spec || !runtime) return
    this.activeStoreId = storeId
    this.closeOverlays({ keepDrawer: true })
    this.syncPointerLock()

    const turfBenefits = this.turf.getAlliedBenefits()
    const discountMult = 1 - turfBenefits.storeDiscountPct / 100
    const storeStatus = getStoreStatus(runtime)
    const cooldownSec = getCooldownRemaining(runtime)

    const actions: HudDrawerState['actions'] = spec.items.map(item => {
      const price = item.price > 0 ? Math.max(1, Math.round(item.price * discountMult)) : 0
      return {
        id: `buy:${item.id}`,
        label: item.label,
        detail: item.detail,
        badge: price > 0 ? `$${price}` : 'FREE',
        disabled: price > this.save.money,
      }
    })
    if (!runtime.registerRobbed && cooldownSec <= 0) {
      actions.push({
        id: 'holdup:start',
        label: 'Hold Up Store (Draw & Rob Register)',
        detail: spec.hasGuard ? 'Armed guard inside — maintain high intimidation!' : 'Aim weapon or let partner cover hostages',
        badge: `+$${spec.registerReward}`,
      })
    }
    if (!runtime.safeCracked && cooldownSec <= 0) {
      actions.push({
        id: 'holdup:safe',
        label: 'Crack Back-Room Safe',
        detail: 'Drops high-value uncleaned loot (fence at Pawn/Jewelers)',
        badge: `+$${spec.safeLoot} LOOT`,
      })
    }

    const statusLabel = storeStatus === 'robbed_cooldown'
      ? `LOCKED (${cooldownSec}s)`
      : storeStatus === 'holdup_active'
        ? 'HOLDUP ACTIVE'
        : storeStatus === 'alarm_locked'
          ? 'ALARM LOCKED'
          : 'OPEN'
    const perkLabel = turfBenefits.storeDiscountPct > 0 ? ` · CREW -${turfBenefits.storeDiscountPct}%` : ''

    this.drawer = {
      kind: 'store',
      title: spec.name.toUpperCase(),
      subtitle: `${STORE_CATEGORY_LABELS[spec.category]} · ${statusLabel}${perkLabel}`,
      hint: 'CLICK OR PRESS [1–6] · [ESC] CLOSE · SHOOT RED CCTV TO KILL SILENT ALARM',
      actions,
    }
  }

  private openTrunkDrawer(): void {
    const personal = this.vehicles.getPersonalVehicle()
    if (!personal) return
    this.closeOverlays({ keepDrawer: true })
    this.syncPointerLock()
    const trunkList = this.save.trunkWeapons ?? personal.trunkWeapons
    const actions: HudDrawerState['actions'] = trunkList.map(wId => {
      const wSpec = WEAPON_CATALOG.find(w => w.id === wId)
      const capLabel = wSpec && isHandgunWeapon(wSpec.category)
        ? `Handgun (cap ${LOADOUT_LIMITS.maxHandguns})`
        : wSpec && isLongGunWeapon(wSpec.category)
          ? `Long Gun (cap ${LOADOUT_LIMITS.maxLongGuns})`
          : 'Tactical'
      return {
        id: `trunk:equip:${wId}`,
        label: `Equip ${wSpec?.name ?? wId} from Trunk`,
        detail: `Stows current weapon into trunk · ${capLabel}`,
        badge: this.arsenal.equippedId === wId ? 'EQUIPPED' : 'SWAP',
      }
    })
    actions.push({
      id: 'trunk:armor',
      label: 'Equip Spare Trunk Kevlar Vest',
      detail: 'Restores +50 Body Armor from vehicle storage',
      badge: 'FREE',
    })
    actions.push({
      id: 'trunk:outfit',
      label: 'Swap Trunk Disguise Outfit',
      detail: 'Clears police Outfit APB without visiting safehouse',
      badge: 'STEALTH',
    })
    this.drawer = {
      kind: 'trunk',
      title: `${personal.name.toUpperCase()} TRUNK ARMORY`,
      subtitle: 'PERSONAL VEHICLE STORAGE · REALISTIC CARRY CAP',
      hint: 'MAX CARRY: 2 HANDGUNS + 2 LONG GUNS · CLICK OR [1–6] TO SWAP · [ESC] CLOSE',
      actions,
    }
  }

  private openNpcDialogueDrawer(): void {
    const civ = this.life.findNearestCivilian(this.player.root.position, 4.8)
    if (!civ) {
      this.ui.toast('Walk closer to a pedestrian to interact [N]')
      return
    }
    this.activeDialogueNpcId = civ.id
    this.activeDialogueWitness = civ.witnessActive
    this.closeOverlays({ keepDrawer: true })
    this.syncPointerLock()
    this.drawer = {
      kind: 'dialogue',
      title: civ.witnessActive ? 'WITNESS INTERACTION (911 CALL!)' : 'STREET NPC INTERACTION',
      subtitle: 'GTA 6 REACTIVE 4-TONE DIALOGUE',
      hint: 'CLICK OR PRESS [1–4] · [ESC] CLOSE',
      actions: [
        { id: 'dlg:greet', label: 'Greet', detail: 'Friendly small talk (+Professional)', badge: '+1' },
        { id: 'dlg:antagonize', label: 'Antagonize', detail: 'Provoke bystander (may provoke fight/911)', badge: '-4' },
        { id: 'dlg:threaten', label: 'Threaten / Rob', detail: 'Intimidate for street cash & cancel 911', badge: 'CASH' },
        { id: 'dlg:defuse', label: 'Defuse', detail: 'Calm witness / talk down 911 alert', badge: 'CALM' },
      ],
    }
  }

  private handleDrawerAction(actionId: string): void {
    if (actionId.startsWith('dlg:')) {
      const tone = actionId.slice(4) as NpcDialogueTone
      const res = resolveNpcDialogue(tone, {
        masked: this.knowledge.masked,
        armed: !this.holstered && this.arsenal.current.fireMode !== 'melee',
        conductScore: this.save.conductScore ?? 0,
        witnessActive: this.activeDialogueWitness,
      })
      this.save.conductScore = THREE.MathUtils.clamp((this.save.conductScore ?? 0) + res.conductDelta, -100, 100)
      if (res.cashGained > 0) this.save.money += res.cashGained
      if (this.activeDialogueNpcId) {
        this.life.applyDialogueReaction(this.activeDialogueNpcId, {
          cancelledWitness: res.cancelledWitness,
          startedWitness: res.startedWitness,
          flee: tone === 'threaten' || tone === 'antagonize',
          origin: this.player.root.position,
        })
      }
      if (tone === 'threaten') this.reportCrime(this.player.root.position, 1)
      this.ui.toast(`${res.npcLine} (${res.callout})`)
      this.closeDrawer()
      this.persist(false)
      return
    }

    if (actionId.startsWith('trunk:')) {
      if (actionId === 'trunk:armor') {
        this.playerArmor = Math.min(100, this.playerArmor + 50)
        this.audio.reload()
        this.ui.toast('TRUNK ARMOR EQUIPPED (+50 AP)')
        this.closeDrawer()
        return
      }
      if (actionId === 'trunk:outfit') {
        const { outfit } = this.swapDisguiseOutfit()
        this.ui.toast(`TRUNK DISGUISE: ${outfit.label} (APB CLEARED)`)
        this.closeDrawer()
        return
      }
      if (actionId.startsWith('trunk:equip:')) {
        const nextId = actionId.slice('trunk:equip:'.length)
        const prevId = this.arsenal.equippedId
        const trunkList = [...(this.save.trunkWeapons ?? ['carbine', 'pump_shotgun'])]
        const idx = trunkList.indexOf(nextId)
        if (idx >= 0 && prevId !== nextId) trunkList[idx] = prevId
        this.save.trunkWeapons = trunkList
        const equipped = this.arsenal.selectWeapon(nextId)
        this.equipWeaponSpec(equipped, `TRUNK SWAP: EQUIPPED ${this.arsenal.current.shortName}`)
        this.audio.reload()
        this.closeDrawer()
        this.persist(false)
        return
      }
    }

    if (!this.activeStoreId) return
    const spec = getStoreById(this.activeStoreId)
    const runtime = this.storeWorld.states.find(s => s.spec.id === this.activeStoreId)
    if (!spec || !runtime) return

    if (actionId === 'holdup:start') {
      this.holstered = false
      this.player.setHolstered(false)
      this.storeWorld.startHoldup(runtime)
      this.audio.dispatchAlert()
      this.closeDrawer()
      this.ui.toast(`HOLDUP STARTED AT ${spec.name.toUpperCase()} — SHOOT RED CCTV OR KEEP AIMED!`)
      return
    }
    if (actionId === 'holdup:safe') {
      const bond = bondBonusMultipliers(this.save.partnerBond ?? 32)
      const res = this.storeWorld.triggerSafeCrackStep(runtime, 4, 1 + bond.robberySpeedBoost)
      if (res.crackedNow) {
        this.save.uncleanedLoot = (this.save.uncleanedLoot ?? 0) + res.loot
        this.save.conductScore = THREE.MathUtils.clamp((this.save.conductScore ?? 0) - 5, -100, 100)
        this.rpg.recordRobbery(res.loot, !runtime.alarmTriggered)
        this.hotZones.addZone({
          id: spec.id,
          label: spec.name,
          x: spec.x,
          z: spec.z,
          loggedOutfitId: this.knowledge.currentOutfit.id,
          loggedPlate: this.vehicles.active?.plateNumber ?? null,
        })
        this.audio.robbery()
        this.reportCrime(runtime.worldCenter, 2, { immediate: true, escalateIfEqual: true })
        this.ui.toast(`SAFE CRACKED! +$${res.loot.toLocaleString()} UNCLEANED LOOT (FENCE AT PAWN/JEWELERS)`)
      } else {
        this.ui.toast(`SAFE DRILL ${Math.round(runtime.safeProgress * 100)}% — PRESS AGAIN TO FINISH`)
      }
      this.closeDrawer()
      this.persist()
      return
    }
    if (actionId.startsWith('buy:')) {
      const itemId = actionId.slice(4)
      const item = spec.items.find(i => i.id === itemId)
      if (item) this.purchaseStoreItem(spec.name, item)
      this.openStoreDrawer(spec.id)
    }
  }

  private purchaseStoreItem(storeName: string, item: StoreMenuItem): void {
    const discountPct = this.turf.getAlliedBenefits().storeDiscountPct
    const finalPrice = item.price > 0 ? Math.max(1, Math.round(item.price * (1 - discountPct / 100))) : 0
    if (finalPrice > this.save.money) {
      this.ui.toast(`${storeName}: Need $${finalPrice}`)
      return
    }
    const act = item.action
    if (act.type === 'deposit_all') {
      this.handlePhoneDepositBank()
      return
    }
    if (act.type === 'withdraw_500') {
      this.handlePhoneWithdrawBank()
      return
    }
    if (act.type === 'fence_loot') {
      const res = fenceUncleanedLoot(this.save as { money: number; uncleanedLoot: number })
      if (res.cleanPayout <= 0) {
        this.ui.toast('No Uncleaned Loot to fence — rob safes or glass display cases!')
      } else {
        this.audio.robbery()
        this.ui.toast(`FENCED $${res.fencedGross.toLocaleString()} LOOT -> +$${res.cleanPayout.toLocaleString()} CLEAN CASH (85%)`)
        this.persist()
      }
      return
    }

    this.save.money -= finalPrice
    this.save.conductScore = THREE.MathUtils.clamp((this.save.conductScore ?? 0) + 1, -100, 100)
    if (act.type === 'heal') {
      this.save.health = Math.min(100, this.save.health + act.hp)
      this.rpg.eatMeal(act.hunger)
      if (act.focus) this.focusGauge = Math.min(100, this.focusGauge + act.focus)
      if (act.stamina) { this.rpg.stamina = 100; this.rpg.exhausted = false }
      this.audio.phoneTone('hotdog')
      this.ui.toast(`${item.label}: +${act.hp} HP & +${act.hunger} HUNGER`)
    } else if (act.type === 'armor') {
      this.playerArmor = Math.min(100, Math.max(this.playerArmor, act.amount))
      this.audio.reload()
      this.ui.toast(`${item.label}: ${Math.round(this.playerArmor)} BODY ARMOR`)
    } else if (act.type === 'ammo') {
      this.arsenal.addAmmo(act.category, act.amount)
      this.arsenal.addAmmo('handgun', 60)
      this.audio.reload()
      this.ui.toast(`RESTOCKED ${item.label}`)
    } else if (act.type === 'weapon') {
      const equipped = this.arsenal.selectWeapon(act.weaponId)
      this.equipWeaponSpec(equipped, `EQUIPPED ${item.label.toUpperCase()}`)
      this.audio.reload()
    } else if (act.type === 'attachment') {
      this.toggleWeaponAttachment(act.attachmentId)
    } else if (act.type === 'mask') {
      this.toggleBandanaMask(false)
    } else if (act.type === 'outfit') {
      const { outfit } = this.swapDisguiseOutfit()
      if (item.id === 'gift-watch') {
        this.save.partnerBond = Math.min(100, (this.save.partnerBond ?? 32) + 10)
      }
      this.ui.toast(`EQUIPPED ${outfit.label.toUpperCase()} — OUTFIT APB CLEARED`)
    } else if (act.type === 'hair') {
      this.save.hairstyle = act.style
      this.player.setProtagonistAppearance(this.save.protagonist === 'lucia' ? 'lucia' : 'jason', act.style)
      this.ui.toast(`HAIRCUT: ${act.style.toUpperCase()}`)
    } else if (act.type === 'tattoo') {
      const tats = new Set(this.save.tattoos ?? [])
      tats.add(act.label)
      this.save.tattoos = [...tats]
      this.rpg.respect = Math.min(100, this.rpg.respect + 4)
      this.ui.toast(`NEW INK: ${act.label} (+HOLDP INTIMIDATION & RESPECT)`)
    } else if (act.type === 'gym') {
      const gain = this.rpg.recordGymRep(act.kind)
      this.player.setPhysique(this.rpg.muscle, this.rpg.fat)
      this.audio.gymRep()
      this.ui.toast(`GYM: +${gain.muscleGain} MUSCLE · +${gain.staminaGain} STAMINA`)
    } else if (act.type === 'respray' || act.type === 'strip_tracker' || act.type === 'claim_personal' || act.type === 'refuel') {
      const target = this.vehicles.active ?? this.vehicles.nearest(this.player.root.position, 14) ?? this.vehicles.getPersonalVehicle()
      if (!target) {
        this.ui.toast('Park a vehicle nearby to service it')
        this.save.money += finalPrice
        return
      }
      if (act.type === 'respray') {
        const info = this.vehicles.respray(target)
        this.heat.onVehicleChanged(target)
        this.audio.phoneTone('respray')
        this.ui.toast(`RESPRAYED & NEW PLATE [${info.plateNumber}]`)
      } else if (act.type === 'strip_tracker') {
        this.vehicles.stripTracker(target)
        this.audio.phoneTone('respray')
        this.ui.toast(`GPS TRACKER STRIPPED FROM ${target.name.toUpperCase()}!`)
      } else if (act.type === 'claim_personal') {
        this.vehicles.setPersonalVehicle(target)
        this.audio.phoneTone('beep')
        this.ui.toast(`${target.name.toUpperCase()} REGISTERED AS PERSONAL VEHICLE!`)
      } else {
        this.vehicles.refuel(target)
        this.audio.phoneTone('beep')
        this.ui.toast(`${target.name.toUpperCase()} REFUELED / CHARGED TO 100%`)
      }
    }
    this.persist()
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
        void flushPendingCloudSync(user, this.save)
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

  persist(syncCloud = true): void {
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
    this.closeOverlays({ keepDrawer: true })
    this.cutsceneSkipGuard = 0.35
    this.cutsceneWeather = undefined
    this.pendingMissionTitle = missionTitle
    this.player.root.visible = false
    this.syncPointerLock()
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
    this.syncPointerLock()
    if (this.pendingMissionTitle) {
      playMissionCard(this.pendingMissionTitle)
      this.pendingMissionTitle = ''
    }
    if (endToast) this.ui.toast(endToast)
  }

  private resume(): void {
    this.audio.unlock()
    this.closeOverlays({ keepDrawer: true })
    this.mode = 'playing'
    this.ui.showGame()
    this.syncPointerLock()
  }

  private pause(): void {
    if (this.mode !== 'playing') return
    this.closeOverlays({ keepDrawer: true })
    this.touchControls.releaseAll()
    this.mode = 'pause'
    this.ui.showPause()
    this.syncPointerLock()
    this.persist()
  }

  private openMap(): void {
    this.closeOverlays({ keepDrawer: true })
    this.mode = 'map'
    this.ui.showMap()
    this.syncPointerLock()
  }

  private quit(): void {
    this.cutscenes.stop()
    this.cutsceneWeather = undefined
    this.closeOverlays()
    this.statsOpen = false
    this.taxiRide = null
    this.lastHailedCabPos = null
    this.touchControls.releaseAll()
    this.player.root.visible = !this.vehicles.active
    this.mode = 'title'
    this.ui.showTitle()
    this.syncPointerLock()
    this.persist()
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

  private reportCrime(origin: THREE.Vector3, severity: number, options: { immediate?: boolean; escalateIfEqual?: boolean; toast?: string } = {}): void {
    const policeSee = this.life.hasPoliceLineOfSight(this.player.root.position, this.heat.wanted, this.currentRecognitionModifiers())
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
      immediate: lifeExp.copsDown > 0 || this.life.hasPoliceLineOfSight(this.player.root.position, this.heat.wanted, this.currentRecognitionModifiers()),
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
    let hitNonLethal = false
    let anyKilled = false
    let warStarted: TurfZoneState | null = null
    let capturedZone: TurfZoneState | null = null
    const dmgBoost = 1 + (this.partner.active ? bondBonusMultipliers(this.save.partnerBond ?? 32).damageBoost : 0)

    for (let i = 0; i < spec.pellets; i += 1) {
      const dir = baseDir.clone()
      dir.x += (Math.random() - 0.5) * spread * 2
      dir.y += (Math.random() - 0.5) * spread * 1.4
      dir.z += (Math.random() - 0.5) * spread * 2
      dir.normalize()

      const range = worldRayDistance(start, dir, this.world.colliders, spec.range)
      const lifeHit = this.life.shootBallistic(start, dir, range, spec.damage * dmgBoost, spec.armorPenetration, i === 0 ? noiseRadius : 0)
      const turfHit = this.turf.shootBallistic(start, dir, range, spec.damage * dmgBoost, spec.armorPenetration)
      const storeHit = this.storeWorld.shootTarget(start, dir, range)
      const propHit = this.props.shoot(start, dir, range)

      if (storeHit.hitCctv) {
        this.audio.impact()
        this.ui.toast('CCTV CAMERA SHOT OUT — SILENT ALARM DISABLED!')
      }
      if (storeHit.smashedCaseStore && storeHit.lootGained > 0) {
        this.save.uncleanedLoot = (this.save.uncleanedLoot ?? 0) + storeHit.lootGained
        this.storeWorld.startHoldup(storeHit.smashedCaseStore)
        this.audio.impact()
        this.ui.toast(`DISPLAY CASE SMASHED +$${storeHit.lootGained} UNCLEANED LOOT`)
        this.reportCrime(storeHit.smashedCaseStore.worldCenter, 2, { immediate: true })
      }

      const hit = lifeHit.hit || turfHit.hit || propHit || Boolean(storeHit.hitCctv || storeHit.smashedCaseStore)
      if (lifeHit.hit) {
        anyPersonHit = true
        if (lifeHit.hitType === 'cop') hitCop = true
        if (lifeHit.critical) hitCritical = true
        if (lifeHit.armorBroken) hitArmor = true
        if (lifeHit.killed) anyKilled = true
        if (lifeHit.nonLethal) hitNonLethal = true
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
      const hmKind = hitCritical ? 'critical' : hitArmor ? 'armor' : hitNonLethal && !anyKilled ? 'nonlethal' : 'normal'
      this.ui.triggerHitmarker(hmKind)
      this.audio.hitmarker(hmKind === 'nonlethal' ? 'normal' : hmKind)
      if (anyKilled) {
        this.save.conductScore = THREE.MathUtils.clamp((this.save.conductScore ?? 0) - 4, -100, 100)
      }
      const promo = this.rpg.recordWeaponHit(hitCritical, anyKilled)
      if (promo.tierPromoted) {
        this.ui.toast(`WEAPON SKILL PROMOTED: ${promo.tierPromoted}!`)
      }
      this.handleTurfZoneEvents(warStarted, capturedZone)
    }

    // Firing inside any store immediately initiates holdup & can drop guard
    const nearStore = this.storeWorld.findNearestInteractable(this.player.root.position, 6.2)
    if (nearStore?.isInside) {
      this.storeWorld.startHoldup(nearStore.store)
      if (this.storeWorld.neutralizeNearestGuard(this.player.root.position, 9)) {
        this.ui.toast('SECURITY GUARD NEUTRALIZED!')
      }
    }

    if (!suppressed) {
      this.life.startle(start, noiseRadius)
      if (this.life.intimidateWitnesses(this.player.root.position, baseDir, true)) {
        this.ui.toast('WITNESS INTIMIDATED — 911 CALL CANCELLED')
      }
    }

    const policeSee = this.life.hasPoliceLineOfSight(this.player.root.position, this.heat.wanted, this.currentRecognitionModifiers())
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
      const cabExit = new THREE.Vector3(this.taxiRide.cabPos.x + 2.1, 0.2, this.taxiRide.cabPos.z)
      this.taxiRide = null
      this.life.consumeServiceUnit('taxi')
      this.clearActiveRide(cabExit, this.world.spawn)
      this.ui.toast('Exited Yellow Cab')
      this.persist()
      return
    }
    const v = this.vehicles.active
    if (v) {
      if (Math.abs(v.speed) > 12 && v.type !== 'helicopter' && v.type !== 'boat') {
        const bail = this.vehicles.bailout()
        if (bail) {
          this.clearActiveRide(bail.exitPos, bail.exitPos)
          this.player.launchRagdollTumble(bail.velocity)
          this.save.health = Math.max(0, this.save.health - 8)
          this.audio.crashSynth(11, false)
          this.input.padRumble(0.75, 180)
          this.ui.toast('HIGH-SPEED BAILOUT! (-8 HP)')
          this.persist()
        }
      } else {
        const exit = this.vehicles.exit()
        this.clearActiveRide(exit ?? undefined, exit ?? undefined)
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
        const policeSee = this.life.hasPoliceLineOfSight(this.player.root.position, this.heat.wanted, this.currentRecognitionModifiers())
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
    const near = this.scanNearbyInteractables(p)

    if (near.bay) {
      if (!active) {
        this.ui.toast(`${near.bay.name}: Drive a vehicle inside ($${near.bay.price})`)
        return true
      }
      if (this.save.money < near.bay.price) {
        this.ui.toast(`${near.bay.name}: Need $${near.bay.price}`)
        return true
      }
      this.save.money -= near.bay.price
      const resprayInfo = this.vehicles.respray(active)
      const policeSee = this.life.hasPoliceLineOfSight(p, this.heat.wanted, this.currentRecognitionModifiers())
      this.knowledge.onVehicleUpdated({
        model: active.name,
        color: resprayInfo.colorName,
        plateNumber: resprayInfo.plateNumber,
        damageState: 'Intact',
      }, policeSee)
      this.heat.onVehicleChanged(active)
      this.audio.phoneTone('respray')
      this.ui.toast(`PAY 'N' SPRAY: REPAIRED & NEW PLATE [${resprayInfo.plateNumber}] (-$${near.bay.price})`)
      this.persist()
      return true
    }

    if (near.amb) {
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
    if (near.jacob) {
      this.setPhoneOpen(true)
      this.ui.phone.setApp('jacob')
      this.ui.toast('LITTLE JACOB ARMS VAN — SELECT KEVLAR OR AMMO')
      return true
    }

    if (near.nearPersonalTrunk) {
      this.openTrunkDrawer()
      return true
    }
    if (!active && near.storeWorld) {
      this.openStoreDrawer(near.storeWorld.store.spec.id)
      return true
    }
    if (near.gym) {
      const gain = this.rpg.recordGymRep(near.gym.kind)
      this.player.setPhysique(this.rpg.muscle, this.rpg.fat)
      this.audio.gymRep()
      this.ui.toast(`${near.gym.name.toUpperCase()}: +${gain.muscleGain} MUSCLE · +${gain.staminaGain} STAMINA`)
      this.persist()
      return true
    }
    if (near.stand) {
      if (this.save.money < near.stand.price) {
        this.ui.toast(`${near.stand.name}: Need $${near.stand.price}`)
        return true
      }
      this.save.money -= near.stand.price
      const meal = this.rpg.eatMeal(near.stand.mealSize)
      this.save.health = Math.min(100, this.save.health + meal.healthGain)
      this.player.setPhysique(this.rpg.muscle, this.rpg.fat)
      this.audio.phoneTone('hotdog')
      this.ui.toast(`${near.stand.name}: ATE MEAL (-$${near.stand.price}) · HEALTH + HUNGER RESTORED`)
      this.persist()
      return true
    }
    if (near.atIntroBeacon) {
      this.startMission('intro')
      return true
    }
    if (near.atSafehouse) {
      const { outfit } = this.swapDisguiseOutfit()
      const cooled = this.heat.clearAtSafehouse()
      if (cooled) this.knowledge.reset()
      this.restockAllAmmo('safehouse')
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
    if (this.input.consume('map')) {
      if (this.mode === 'playing') this.openMap()
      else if (this.mode === 'map') this.resume()
    }
    if (this.input.consume('weather') && this.mode === 'playing') this.cycleWeather()
    const look = this.input.takeLook()

    // 25% Tactical Slow-Mo Weapon Wheel or 38% Combat Focus Slow-Mo
    const wantWheel = this.mode === 'playing' && (this.wheelPinned || this.input.held('wheel'))
    if (wantWheel !== this.wheelOpen) {
      this.wheelOpen = wantWheel
      this.syncPointerLock()
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
          this.equipWeaponSpec(next, `EQUIPPED: ${next.name.toUpperCase()}`)
        }
      }
    }

    if (this.focusActive && this.mode === 'playing' && !this.wheelOpen) {
      this.focusGauge = Math.max(0, this.focusGauge - dt * 24)
      if (this.focusGauge <= 0) this.focusActive = false
    } else {
      this.focusGauge = Math.min(100, this.focusGauge + dt * 11)
    }

    const simDt = this.wheelOpen ? dt * 0.25 : this.focusActive ? dt * 0.38 : dt
    this.shotCooldown = Math.max(0, this.shotCooldown - simDt)
    this.weaponHotTimer = Math.max(0, this.weaponHotTimer - simDt)
    this.fuelNoticeCooldown = Math.max(0, this.fuelNoticeCooldown - simDt)

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
        this.toggleBandanaMask(true)
      }
      if (this.input.consume('holster')) {
        this.holstered = !this.holstered
        this.player.setHolstered(this.holstered)
        this.ui.toast(this.holstered ? 'WEAPON CONCEALED — UNARMED PROFILE' : `DREW ${this.arsenal.current.shortName}`)
      }
      if (!this.wheelOpen && !this.phoneOpen && !this.drawer) {
        this.yaw -= look.x
        this.pitch = THREE.MathUtils.clamp(this.pitch + look.y, -.15, .65)
      }

      if (this.input.consume('stats')) {
        this.statsOpen = !this.statsOpen
      }
      if (this.input.consume('cover')) {
        this.togglePlayerCover(true)
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
        this.recruitCrewOrPartner(true)
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
            this.clearActiveRide(ejectFrom, active.root.position)
            this.player.launchRagdollTumble(rx.ejectionVelocity)
            this.save.health = Math.max(0, this.save.health - 28)
            this.ui.toast('LAUNCHED THROUGH WINDSHIELD! (-28 HP)')
            this.persist()
          }
        }
        const secStep = this.vehicles.stepSecurityAndFuel(simDt, this.save.fuelEnabled !== false, Math.abs(active.speed) / 34)
        if (secStep.trackerPing) {
          this.heat.reportCrime(active.root.position, Math.max(2, this.heat.wanted), { immediate: true, policeSeePlayer: true })
          this.audio.dispatchAlert()
          this.ui.toast('EXOTIC GPS TRACKER PINGED POLICE — STRIP AT CHOP SHOP!')
        }
        if (secStep.outOfFuel && this.fuelNoticeCooldown <= 0) {
          this.fuelNoticeCooldown = 4.5
          this.ui.toast('OUT OF FUEL / CHARGE — VISIT SUNSHINE GAS OR VICE CUSTOMS!')
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

      const bondBonuses = bondBonusMultipliers(this.save.partnerBond ?? 32)
      const storeStep = this.storeWorld.update(simDt, this.player.root.position, {
        aiming,
        weaponHot: this.weaponHotTimer > 0 || (!this.holstered && spec.fireMode !== 'melee'),
        partnerCovering: this.partner.active,
        bondBoost: bondBonuses.robberySpeedBoost,
        tattooCount: (this.save.tattoos ?? []).length,
        conductTier: getConductTier(this.save.conductScore ?? 0),
      })
      if (storeStep.alarmTriggered) {
        this.reportCrime(this.player.root.position, 2, { immediate: true, escalateIfEqual: true })
        this.ui.toast(storeStep.callout ?? 'SILENT ALARM TRIGGERED!')
      }
      if (storeStep.registerCleared) {
        const { spec: stSpec, cash } = storeStep.registerCleared
        this.robbedStores.add(stSpec.id)
        this.save.robbedStores = [...this.robbedStores]
        this.save.money += cash
        this.save.conductScore = THREE.MathUtils.clamp((this.save.conductScore ?? 0) - 5, -100, 100)
        this.rpg.recordRobbery(cash, !storeStep.alarmTriggered)
        if (this.partner.active) this.save.partnerBond = Math.min(100, (this.save.partnerBond ?? 32) + 4)
        this.hotZones.addZone({
          id: stSpec.id,
          label: stSpec.name,
          x: stSpec.x,
          z: stSpec.z,
          loggedOutfitId: this.knowledge.currentOutfit.id,
          loggedPlate: this.vehicles.active?.plateNumber ?? null,
        })
        this.audio.robbery()
        this.reportCrime(this.player.root.position, 2, { immediate: true })
        this.ui.toast(`${stSpec.name.toUpperCase()} REGISTER EMPTIED +$${cash.toLocaleString()}!`)
        this.persist()
      }

      const partnerStep = this.partner.update(
        simDt,
        this.player.root.position,
        this.yaw,
        Boolean(active),
        active?.heading ?? 0,
        Boolean(this.storeWorld.getActiveHoldup()),
        this.life.getNearestThreatPos(this.player.root.position, this.heat.wanted),
        this.world.colliders,
      )
      if (partnerStep.firedAtThreat) {
        const res = this.life.damageNearestThreat(this.partner.root.position, 34 * (1 + bondBonuses.damageBoost))
        if (res.hit) {
          this.audio.shootWeapon('handgun', false)
          if (res.killed) this.save.partnerBond = Math.min(100, (this.save.partnerBond ?? 32) + 1.5)
        }
      }

      const hotZoneCheck = this.hotZones.checkReentry(
        this.player.root.position,
        this.knowledge.currentOutfit.id,
        active?.plateNumber ?? null,
        this.knowledge.masked,
      )
      if (hotZoneCheck.triggeredApb) {
        this.reportCrime(this.player.root.position, Math.max(2, this.heat.wanted), { immediate: true })
        this.ui.toast(`APB RECOGNIZED IN HOT ZONE (${hotZoneCheck.zoneLabel}) — SWAP OUTFIT OR CAR!`)
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

      const policeSee = this.life.hasPoliceLineOfSight(this.player.root.position, this.heat.wanted, this.currentRecognitionModifiers())
      if (policeSee && this.heat.wanted > 0) {
        this.knowledge.recordSighting(this.currentSightingObservation())
      }
      const inStealth = this.world.districtAt(this.player.root.position.x, this.player.root.position.z) === 'The Wetlands'
        || this.world.safehouses.some(home => this.player.root.position.distanceTo(home.position) < home.radius + 8)
      const evasionBonus = this.knowledge.evasionDrainMultiplier(this.vehicles.active?.plateNumber ?? null)
      this.peakWanted = Math.max(this.peakWanted, this.heat.wanted)
      const heatStep = this.heat.update(simDt, this.player.root.position, policeSee, inStealth, evasionBonus)
      if (this.heat.wanted === 0) {
        if (this.peakWanted > 0) {
          this.rpg.recordEvadeHeat(this.peakWanted)
          this.peakWanted = 0
        }
        this.knowledge.reset()
      }
      if (heatStep.dispatchConfirmed || heatStep.reinforcementEscalated) {
        this.audio.dispatchRadio(this.heat.wanted)
        this.persist()
      } else if (heatStep.starDropped) {
        this.ui.toast(this.heat.wanted === 0 ? 'HEAT CLEARED — COAST IS CLEAR' : 'HEAT COOLED DOWN')
        this.persist()
      }

      this.turfIncomeAccum += simDt
      if (this.turfIncomeAccum >= 30) {
        this.turfIncomeAccum -= 30
        const benefits = this.turf.getAlliedBenefits()
        const payout = Math.round((benefits.passiveCashPerMin / 60) * 30)
        if (payout > 0) {
          this.save.money += payout
          this.ui.toast(`CREW TURF INCOME +$${payout.toLocaleString()}`)
          this.persist(false)
        }
      }

      const turfStep = this.turf.update(simDt, this.player.root.position, this.yaw, !!this.vehicles.active, this.heat.wanted, this.life.getPoliceBlips())
      if (turfStep.homieEliminatedRival) {
        this.handleTurfZoneEvents(null, turfStep.homieEliminatedRival)
      }

      const copDamage = this.life.getDamage(this.player.root.position, simDt, this.heat.wanted)
      let harm = copDamage + turfStep.playerDamage + storeStep.guardDamagePlayer
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
        const penalty = applyWastedEconomyPenalty({
          money: this.save.money,
          bankBalance: this.save.bankBalance ?? 0,
          uncleanedLoot: this.save.uncleanedLoot ?? 0,
        })
        this.save.money = 0
        this.save.uncleanedLoot = 0
        this.taxiRide = null; this.heat.reset(); this.knowledge.reset(); this.turf.dismissSquad(); this.closeDrawer()
        this.clearActiveRide(this.world.spawn, this.world.spawn)
        this.save.health = 100
        this.rpg.stamina = 100; this.rpg.exhausted = false; this.playerArmor = 0
        this.ui.toast(`WASTED — LOST $${(penalty.lostCash + penalty.lostLoot).toLocaleString()} POCKET/LOOT · BANK PROTECTED ($${penalty.bankProtected.toLocaleString()})`)
        this.persist()
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
      this.life.update(
        simDt,
        focus,
        this.mode === 'playing' ? this.heat.wanted : 0,
        searchTarget,
        this.mode === 'playing' && this.heat.phase === 'evading',
      )
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
    this.softwareGlRenderAccum += dt
    const shouldRenderWebGL = !this.renderer.isSoftwareGl || this.capturePhotoNextRender || this.softwareGlRenderAccum >= 0.14
    if (shouldRenderWebGL) {
      this.softwareGlRenderAccum = 0
      this.renderer.render(this.world.scene, this.camera)
    }
    if (this.capturePhotoNextRender) {
      this.capturePhotoNextRender = false
      try {
        this.latestPhoto = this.renderer.gl.domElement.toDataURL('image/jpeg', 0.78)
        this.photoCount += 1
      } catch {
        // Headless fallback
      }
    }

    const near = this.scanNearbyInteractables(focus)
    const { prompt, shortPrompt: interactShort } = this.buildInteractionPrompt(near)
    const personalCar = near.personalCar
    const nearbyCab = near.cabNearby
    const nearbyJacob = near.jacob

    const minutes = 16 * 60 + 13 + Math.floor(this.elapsed / 6)
    const time = `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
    this.currentTimeLabel = time
    const target = this.missions.target ?? this.customWaypoint
    const ammoInfo = this.arsenal.getAmmoDisplay(spec)
    const activeWar = this.turf.activeWar
    const apbIntel = this.knowledge.getApbHudIntel(this.vehicles.active?.plateNumber ?? null, this.heat.wanted)
    const apbExpanded = this.input.held('inspect') || this.wheelOpen
    const rawTele = this.vehicles.getActiveTelemetry()
    const activeHoldup = this.storeWorld.getActiveHoldup()
    const hzActive = this.hotZones.checkReentry(focus, this.knowledge.currentOutfit.id, this.vehicles.active?.plateNumber ?? null, this.knowledge.masked)
    const conductScore = this.save.conductScore ?? 0
    const conductTier = getConductTier(conductScore)
    const protagonist: ProtagonistId = this.save.protagonist === 'lucia' ? 'lucia' : 'jason'
    const heatHud = this.heat.getHudState()
    const turfBenefits = this.turf.getAlliedBenefits()
    const recMods = this.currentRecognitionModifiers()

    this.ui.update({
      money: this.save.money,
      bankBalance: this.save.bankBalance ?? 0,
      uncleanedLoot: this.save.uncleanedLoot ?? 0,
      health: this.save.health,
      ammo: ammoInfo.mag,
      weaponName: this.holstered ? `${spec.shortName} [HOLSTERED]` : spec.shortName,
      weaponAmmoText: this.holstered ? 'CONCEALED' : spec.fireMode === 'melee' ? 'MELEE' : `${ammoInfo.mag} / ${ammoInfo.reserve}`,
      stamina: this.rpg.stamina,
      focusGauge: this.focusGauge,
      focusActive: this.focusActive,
      protagonist,
      partnerActive: this.partner.active,
      partnerBond: this.save.partnerBond ?? 32,
      conductTier,
      homies: this.turf.recruitedCount,
      maxHomies: this.rpg.maxHomies,
      turfWar: activeWar ? { zoneName: activeWar.name, wave: activeWar.wave, totalWaves: activeWar.totalWaves, remaining: activeWar.remainingEnemies } : null,
      gangZones: this.turf.getMapZones(),
      homieBlips: this.turf.getHomiePositions(),
      rivalBlips: this.turf.getRivalPositions(),
      hotZones: this.hotZones.zones.map(z => ({ x: z.x, z: z.z, radius: z.radius, label: z.label })),
      activeHotZoneLabel: hzActive.inHotZone ? hzActive.zoneLabel : null,
      stores: STORES_CATALOG.map(s => {
        const rt = this.storeWorld.states.find(st => st.spec.id === s.id)
        return {
          id: s.id,
          name: s.name,
          category: s.category,
          x: s.x,
          z: s.z,
          robbed: this.robbedStores.has(s.id),
          status: rt ? getStoreStatus(rt) : 'open',
          cooldownSec: rt ? getCooldownRemaining(rt) : 0,
        }
      }),
      activeStoreCategory: this.activeStoreCategory,
      holdup: activeHoldup
        ? {
            storeName: activeHoldup.spec.name,
            intimidation: activeHoldup.intimidation,
            registerPct: activeHoldup.registerProgress,
            safePct: activeHoldup.safeProgress,
            cctvOn: activeHoldup.cctvActive,
            guardAlert: !activeHoldup.guardDown && (activeHoldup.alarmTriggered || activeHoldup.intimidation < 40),
          }
        : null,
      drawer: this.drawer,
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
      heat: heatHud,
      police: this.life.getPoliceBlips(),
      policeRadars: this.life.getPoliceRadars(focus, this.heat.wanted, recMods),
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
            securityTier: rawTele.securityTier,
            fuel: rawTele.fuel,
            isElectric: rawTele.isElectric,
            trackerActive: rawTele.trackerActive,
            isPersonal: rawTele.isPersonal,
            alarmActive: rawTele.alarmActive,
            hotwiringProgress: rawTele.hotwiringProgress,
          }
        : null,
    })

    const district = this.world.districtAt(focus.x, focus.z)
    this.ui.updatePhone(dt, {
      open: this.phoneOpen && this.mode === 'playing',
      time,
      money: this.save.money,
      bankBalance: this.save.bankBalance ?? 0,
      uncleanedLoot: this.save.uncleanedLoot ?? 0,
      personalCarName: personalCar?.name ?? 'Roman Liberty Cab',
      protagonist,
      district,
      grittyFilter: this.grittyFilter,
      ringtone: this.ringtone,
      weather: this.save.weather,
      cabActive: Boolean(nearbyCab),
      jacobActive: Boolean(nearbyJacob),
      latestPhoto: this.latestPhoto,
      photoCount: this.photoCount,
      wanted: this.heat.wanted,
      heatStatus: heatHud.statusText,
      dispatchEta: heatHud.dispatchEta,
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
      focusGauge: this.focusGauge,
      focusActive: this.focusActive,
      protagonist,
      conductTier,
      conductScore,
      partnerBond: this.save.partnerBond ?? 32,
      partnerActive: this.partner.active,
      loadoutStatus: `SLING: ${LOADOUT_LIMITS.maxHandguns} HG · ${LOADOUT_LIMITS.maxLongGuns} LG`,
      turfPerksText: `TURF ${turfBenefits.capturedCount}/${turfBenefits.totalDistricts} · +$${turfBenefits.passiveCashPerMin}/MIN · -${turfBenefits.storeDiscountPct}% STORES`,
    })

    this.touchControls.update({
      visible: this.mode === 'playing',
      inVehicle: Boolean(this.vehicles.active),
      inTaxi: Boolean(this.taxiRide),
      nearVehicleLabel: near.nearVehicle ? `ENTER ${near.nearVehicle.name.split(' ')[0].toUpperCase()}` : '',
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
