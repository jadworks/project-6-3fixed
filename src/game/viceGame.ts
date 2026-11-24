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
import { resolvePlayerCollision, supportHeightAt, worldRayDistance } from './worldCollision'
import { CONFIG } from './config'
import { tuning } from './tuning'

type Mode = 'title' | 'playing' | 'pause' | 'map' | 'cutscene'
type Tracer = { mesh: THREE.Line; life: number }
const WEATHERS = ['day', 'sunset', 'rain', 'night'] as const

export class ViceGame {
  readonly world = new ViceWorld()
  readonly player = new VicePlayer(this.world.spawn)
  readonly vehicles = new VehicleSystem(this.world.scene)
  readonly life = new CityLife(this.world.scene)
  readonly missions = new MissionDirector(this.world.scene)
  readonly props = new WorldProps(this.world.scene)
  readonly heat = new HeatSystem()
  readonly cutscenes: CutsceneDirector
  readonly save = loadCitySave()
  readonly camera = new THREE.PerspectiveCamera(60, 1, .1, 980)
  readonly ui: GameHud
  mode: Mode = 'title'
  private yaw = 0
  private pitch = .2
  private elapsed = 0
  private ammo = 15
  private readonly robbedStores: Set<string>
  private shotCooldown = 0
  private hitCooldown = 0
  private rampCooldown = 0
  private lockLostAt = 0
  private saveTimer = 0
  private cutsceneSkipGuard = 0
  private cutsceneWeather?: ViceWeather
  private pendingMissionTitle = ''
  private tracers: Tracer[] = []
  private flashTime = 0
  private readonly muzzleFlash = new THREE.Mesh(new THREE.SphereGeometry(.3, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffdc75 }))
  private objectiveBeacon: THREE.Group
  private readonly board = new OnlineLeaderboard(message => this.ui.toast(message))

  constructor(private readonly renderer: Renderer, private readonly input: Input, private readonly audio: ViceAudio, root: HTMLElement) {
    this.renderer.attachEnvironment(this.world.scene)
    this.vehicles.setWorldGeometry(this.world.colliders, this.world.ramps)
    this.life.setWorldColliders(this.world.colliders)
    this.cutscenes = new CutsceneDirector(this.world.scene, this.audio)

    this.world.scene.add(this.player.root)
    this.muzzleFlash.visible = false; this.world.scene.add(this.muzzleFlash)
    this.player.upgrade = this.save.upgrade
    this.robbedStores = new Set(this.save.robbedStores)
    this.audio.muted = this.save.muted
    this.camera.position.set(0, 7, 28)
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
    })
    this.ui.showTitle()
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.mode === 'playing' && this.input.method === 'keyboard') { this.lockLostAt = performance.now(); this.pause() }
    })
    window.addEventListener('blur', () => { if (this.mode === 'playing') this.pause() })
  }

  get wanted(): number {
    return this.heat.wanted
  }

  private persist(): void { saveCityProgress(this.save) }

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
    this.ui.toast('Vice Bay is yours. Find a ride or head to the yellow marker.')
  }

  playOpeningCutscene(): void {
    tuning.activate('run')
    this.startCutscene('opening', undefined, 'Vice Bay is yours. Find a ride or head to the yellow marker.')
  }

  private startCutscene(id: CutsceneId, focus?: THREE.Vector3, endToast?: string, missionTitle = ''): void {
    this.mode = 'cutscene'
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
    this.audio.unlock(); this.mode = 'playing'; this.ui.showGame(); this.input.lockPointer()
  }

  private pause(): void {
    if (this.mode !== 'playing') return
    this.mode = 'pause'; this.ui.showPause(); this.input.unlockPointer(); this.persist()
  }

  private openMap(): void { this.mode = 'map'; this.ui.showMap(); this.input.unlockPointer() }

  private quit(): void {
    this.cutscenes.stop()
    this.cutsceneWeather = undefined
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

  private fire(): void {
    if (this.shotCooldown > 0 || this.vehicles.active) return
    if (this.ammo <= 0) { this.ui.toast('Out of ammo — press R to reload'); return }
    this.ammo--; this.shotCooldown = .22; this.audio.shoot()
    const start = this.player.root.position.clone().add(new THREE.Vector3(0, 1.65, 0))
    const direction = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize()
    this.muzzleFlash.position.copy(start).addScaledVector(direction, .7); this.muzzleFlash.visible = true; this.flashTime = .08
    const range = worldRayDistance(start, direction, this.world.colliders, 60)
    const hit = this.life.shoot(start, direction, range) || this.props.shoot(start, direction, range)
    this.life.startle(start)
    const policeSee = this.life.hasPoliceLineOfSight(this.player.root.position)
    const witnessPresent = this.life.hasWitnessNearby(this.player.root.position)
    const report = this.heat.reportCrime(this.player.root.position, 1, { immediate: policeSee || hit, policeSeePlayer: policeSee, witnessPresent })
    if (report.dispatchStarted) {
      this.audio.dispatchAlert()
      this.ui.toast('WITNESS SPOTTED CRIME — LEAVE THE AREA')
    }
    const end = start.clone().addScaledVector(direction, Math.min(range, hit ? 22 : 55))
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([start, end]), new THREE.LineBasicMaterial({ color: 0xffe4a4, transparent: true, opacity: .9 }))
    this.world.scene.add(line); this.tracers.push({ mesh: line, life: .12 })
    this.yaw += (Math.random() - .5) * .025; this.pitch = Math.min(.6, this.pitch + .012)
  }

  private interact(): void {
    const p = this.player.root.position
    const store = this.world.stores.find(item => !this.robbedStores.has(item.id) && p.distanceTo(item.position) < item.radius)
    if (store) {
      this.robbedStores.add(store.id)
      this.save.robbedStores = [...this.robbedStores]
      this.save.money += store.reward
      this.heat.reportCrime(p, 2, { immediate: true, policeSeePlayer: true })
      this.audio.robbery()
      this.ui.toast(`${store.name} HIT  +$${store.reward.toLocaleString()}  — BREAK SIGHT & MOVE`)
      this.persist()
      return
    }
    if (!this.missions.current && Math.hypot(p.x + 8, p.z) < 7) { this.startMission('intro'); return }
    if (this.world.safehouses.some(home => p.distanceTo(home.position) < home.radius + 4)) {
      const cooled = this.heat.clearAtSafehouse()
      if (this.save.health < 100 || cooled) {
        this.save.health = 100
        this.ui.toast(cooled ? 'Safehouse: heat cleared & health restored' : 'Safehouse: health restored')
      } else if (this.save.upgrade < 3 && this.save.money >= 500) {
        this.save.money -= 500; this.save.upgrade++; this.player.upgrade = this.save.upgrade
        this.ui.toast(`Sprint upgrade ${this.save.upgrade}/3 purchased for $500`)
      } else this.ui.toast(this.save.upgrade >= 3 ? 'Sprint fully upgraded' : 'Earn $500 for a sprint upgrade')
      this.persist()
    }
  }

  step(dt: number): void {
    this.elapsed += dt
    this.shotCooldown = Math.max(0, this.shotCooldown - dt)
    this.hitCooldown = Math.max(0, this.hitCooldown - dt)
    this.rampCooldown = Math.max(0, this.rampCooldown - dt)

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
    if (this.input.consume('map') && this.mode === 'playing') this.openMap()
    if (this.input.consume('weather') && this.mode === 'playing') this.cycleWeather()
    const look = this.input.takeLook()
    if (this.mode === 'playing') {
      this.yaw -= look.x; this.pitch = THREE.MathUtils.clamp(this.pitch + look.y, -.15, .65)
      if (this.input.consume('vehicle')) {
        const v = this.vehicles.active
        if (v) {
          const exit = this.vehicles.exit()
          if (exit) {
            this.player.root.position.copy(exit)
            resolvePlayerCollision(this.player.root.position, exit, this.world.colliders)
          }
          this.heat.onVehicleChanged(null)
          this.player.root.visible = true; this.ui.toast('Exited vehicle')
        } else {
          const nearest = this.vehicles.nearest(this.player.root.position, 6)
          if (nearest) {
            this.vehicles.enter(nearest)
            this.player.root.visible = false
            const swapped = this.heat.onVehicleChanged(nearest)
            this.ui.toast(swapped ? `Driving ${nearest.name} — NEW PLATES COOLING HEAT` : `Driving ${nearest.type}`)
          } else this.ui.toast('No vehicle nearby')
        }
      }
      if (this.input.consume('interact')) this.interact()
      if (this.input.consume('reload')) { this.ammo = 15; this.ui.toast('Pistol reloaded') }
      if (this.input.consume('shoot')) this.fire()
      const active = this.vehicles.active
      if (active) {
        // Space is a handbrake in vehicles, not a buffered on-foot jump.
        this.input.consume('jump')
        const previousSpeed = active.speed
        if (this.rampCooldown === 0 && active.type !== 'boat' && active.type !== 'helicopter' && Math.abs(active.speed) > 8) {
          const ramp = this.world.ramps.find(item => Math.hypot(active.root.position.x - item.position.x, active.root.position.z - item.position.z) < 5.5)
          if (ramp) { active.root.position.y = Math.max(active.root.position.y, .24); active.velocity.y = Math.min(9.5, 4.2 + Math.abs(active.speed) * .13); this.rampCooldown = 2; this.ui.toast('STUNT JUMP') }
        }
        this.vehicles.update(dt, { throttle: this.input.move.y, steer: this.input.move.x, handbrake: this.input.held('jump') }, (x, z) => this.world.surfaceAt(x, z))
        const dynHit = this.life.resolveDynamicCollisions(active.root.position, active.velocity, true, active.type === 'motorbike' ? 0.9 : 1.35)
        if (dynHit.impactSpeed > 4) {
          this.vehicles.damage(active, dynHit.impactSpeed * 0.85)
          this.audio.impact()
          if (dynHit.hitRoadblock) {
            this.heat.reportCrime(active.root.position, 2, { immediate: true, policeSeePlayer: true })
            this.ui.toast('SMASHED POLICE ROADBLOCK')
          } else if (dynHit.hitTraffic && dynHit.impactSpeed > 8) {
            this.heat.reportCrime(active.root.position, 1, {
              policeSeePlayer: this.life.hasPoliceLineOfSight(active.root.position),
              witnessPresent: this.life.hasWitnessNearby(active.root.position),
            })
          }
        }
        const boundedX = THREE.MathUtils.clamp(active.root.position.x, -378, 368)
        const boundedZ = THREE.MathUtils.clamp(active.root.position.z, -378, 378)
        if (boundedX !== active.root.position.x) active.velocity.x = 0
        if (boundedZ !== active.root.position.z) active.velocity.z = 0
        active.root.position.x = boundedX; active.root.position.z = boundedZ
        const turn = Math.atan2(Math.sin(active.heading - this.yaw), Math.cos(active.heading - this.yaw))
        this.yaw += turn * Math.min(1, dt * 1.8)
        this.player.root.position.copy(active.root.position)
        if (this.props.impact(active.root.position, previousSpeed)) { this.vehicles.damage(active, Math.abs(previousSpeed) * 1.2); this.audio.impact() }
        const hit = this.life.impact(active.root.position, 1.6, Math.abs(previousSpeed))
        if (hit && Math.abs(active.speed) > 4) {
          const policeSee = this.life.hasPoliceLineOfSight(active.root.position)
          this.heat.reportCrime(active.root.position, 1, { immediate: true, policeSeePlayer: policeSee })
          this.audio.impact()
        }
      } else {
        const swimming = this.world.surfaceAt(this.player.root.position.x, this.player.root.position.z) === 'water'
        const previous = this.player.root.position.clone()
        const supportY = swimming ? 0 : supportHeightAt(previous.x, previous.z, previous.y, this.world.colliders, this.world.ramps, 0)
        this.player.update(dt, this.input.move.x, this.input.move.y, this.yaw, this.input.held('sprint'), this.input.held('crouch'), this.input.consume('jump'), swimming, supportY)
        if (resolvePlayerCollision(this.player.root.position, previous, this.world.colliders)) this.player.velocity.multiplyScalar(.45)
        if (this.vehicles.resolvePlayerCollision(this.player.root.position)) this.player.velocity.multiplyScalar(.4)
        this.life.resolveDynamicCollisions(this.player.root.position, this.player.velocity, false, 0.44)
        const trafficHit = this.hitCooldown <= 0 ? this.life.hitPlayer(this.player.root.position) : null
        if (trafficHit) { this.player.stagger(trafficHit.direction, trafficHit.force * .65); this.save.health = Math.max(0, this.save.health - trafficHit.force * 1.2); this.hitCooldown = 1; this.audio.impact() }
        this.vehicles.update(dt, { throttle: 0, steer: 0, handbrake: false }, (x, z) => this.world.surfaceAt(x, z))
      }
      const stuntJump = !!active && active.type !== 'boat' && active.type !== 'helicopter' && active.root.position.y > .1 && active.velocity.y > 0
      const result = this.missions.update(dt, this.player.root.position, !!active, active?.speed ?? 0, stuntJump)
      if (result) {
        this.save.money += result.reward
        if (!this.save.completed.includes(result.id)) this.save.completed.push(result.id)
        void this.board.complete(result.seconds, !tuning.unranked)
        this.persist()
        this.startCutscene('complete', this.player.root.position, `${result.title} COMPLETE  +$${result.reward.toLocaleString()}`)
      }
      const policeSee = this.life.hasPoliceLineOfSight(this.player.root.position)
      const inStealth = this.world.districtAt(this.player.root.position.x, this.player.root.position.z) === 'The Wetlands'
        || this.world.safehouses.some(home => this.player.root.position.distanceTo(home.position) < home.radius + 8)
      const heatStep = this.heat.update(dt, this.player.root.position, policeSee, inStealth)
      if (heatStep.dispatchConfirmed) {
        this.audio.dispatchAlert()
        this.ui.toast('DISPATCH: POLICE UNITS RESPONDING TO REPORT')
      } else if (heatStep.starDropped) {
        this.ui.toast(this.heat.wanted === 0 ? 'HEAT CLEARED — COAST IS CLEAR' : 'HEAT COOLED DOWN')
      }
      const harm = this.life.getDamage(this.player.root.position, dt, this.heat.wanted)
      if (harm > 0 && this.hitCooldown <= 0) {
        this.save.health = Math.max(0, this.save.health - harm); this.hitCooldown = .35
        if (!active) this.player.stagger(new THREE.Vector3(Math.random() - .5, 0, Math.random() - .5).normalize(), 2)
      }
      if (this.save.health <= 0) {
        this.vehicles.exit(); this.heat.reset(); this.player.root.visible = true; this.save.health = 100
        this.save.money = Math.max(0, this.save.money - 250); this.player.root.position.copy(this.world.spawn)
        this.ui.toast('WASTED — $250 hospital fee'); this.persist()
      }
      this.saveTimer += dt
      if (this.saveTimer > 15) { this.saveTimer = 0; this.persist() }
    } else {
      this.input.consume('vehicle'); this.input.consume('interact'); this.input.consume('reload'); this.input.consume('shoot'); this.input.consume('jump'); this.input.consume('confirm')
    }
    const focus = this.player.root.position
    this.world.update(dt, focus, this.save.weather)
    if (this.mode === 'playing' || this.mode === 'title') {
      const searchTarget = this.heat.getSearchTarget(focus)
      this.life.update(dt, focus, this.mode === 'playing' ? this.heat.wanted : 0, searchTarget)
    }
    this.props.update(dt)
    this.flashTime = Math.max(0, this.flashTime - dt); this.muzzleFlash.visible = this.flashTime > 0
    this.objectiveBeacon.visible = !this.missions.current
    this.objectiveBeacon.rotation.y += dt * .6
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const trace = this.tracers[i]; trace.life -= dt
      if (trace.life <= 0) { this.world.scene.remove(trace.mesh); trace.mesh.geometry.dispose(); (trace.mesh.material as THREE.Material).dispose(); this.tracers.splice(i, 1) }
    }
    this.audio.update(this.vehicles.active?.speed ?? 0, !!this.vehicles.active, this.heat.wanted, this.mode === 'playing', this.heat.inSight)
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
    const distance = this.vehicles.active ? 11.5 + Math.min(2.5, speed * .035) : CONFIG.camera.distance + 1.4
    const desired = new THREE.Vector3(focus.x + Math.sin(targetYaw) * distance, focus.y + 4.8 + this.pitch * 5, focus.z + Math.cos(targetYaw) * distance)
    this.camera.position.lerp(desired, 1 - Math.exp(-Math.max(2, CONFIG.camera.follow) * dt))
    this.camera.fov = this.vehicles.active ? 59 + Math.min(4, speed * .08) : CONFIG.camera.fov; this.camera.updateProjectionMatrix()
    this.camera.lookAt(focus.x, focus.y + 1.45, focus.z)
    this.renderer.render(this.world.scene, this.camera)
    const near = this.vehicles.nearest(focus, 6)
    let prompt = this.vehicles.active ? 'F  EXIT VEHICLE' : near ? `F  ENTER ${near.type.toUpperCase()}` : ''
    const nearbyStore = this.world.stores.find(item => focus.distanceTo(item.position) < item.radius && !this.robbedStores.has(item.id))
    if (nearbyStore) prompt = `E  ROB ${nearbyStore.name}`
    else if (!this.missions.current && Math.hypot(focus.x + 8, focus.z) < 7) prompt = 'E  START FIRST CONTRACT'
    if (this.world.safehouses.some(home => focus.distanceTo(home.position) < home.radius + 4)) prompt = 'E  SAFEHOUSE / UPGRADES'
    const minutes = 16 * 60 + 13 + Math.floor(this.elapsed / 6)
    const time = `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
    const target = this.missions.target
    this.ui.update({
      money: this.save.money,
      health: this.save.health,
      ammo: this.ammo,
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
    })
  }
}
