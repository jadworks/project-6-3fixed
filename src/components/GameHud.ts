import './gameHud.css'
import type { CutsceneHudState } from '../game/cutscene'
import type { HeatHudState } from '../game/heatSystem'
import type { PoliceRadarUnit } from '../game/cityLife'
import type { GangMapZone } from '../game/gangTurf'
import { WantedHUD } from './WantedHUD'
import { CombatHud, type CombatHudCallbacks, type CombatHudState } from './CombatHud'
import { SmartphoneHud, type SmartphoneCallbacks, type SmartphoneState } from './SmartphoneHud'
import type { ApbHudIntel } from '../game/policeKnowledge'

export type HudState = {
  money: number
  health: number
  ammo: number
  wanted: number
  speed: number
  district: string
  objective: string
  time: string
  inVehicle: boolean
  x: number
  z: number
  heading: number
  prompt: string
  weather: string
  target: { x: number; z: number } | null
  safehouses: { x: number; z: number }[]
  heat?: HeatHudState
  police?: { x: number; z: number; kind: 'cop' | 'heli' }[]
  policeRadars?: PoliceRadarUnit[]
  nearestPursuerDist?: number
  weaponName?: string
  weaponAmmoText?: string
  stamina?: number
  homies?: number
  maxHomies?: number
  turfWar?: { zoneName: string; wave: number; totalWaves: number; remaining: number } | null
  gangZones?: GangMapZone[]
  homieBlips?: { x: number; z: number; recruited: boolean }[]
  rivalBlips?: { x: number; z: number; color: string }[]
  armor?: number
  apb?: ApbHudIntel | null
  apbTickerExpanded?: boolean
  grittyFilter?: boolean
  vehicleTelemetry?: {
    seatbeltLatched: boolean
    engineStalled: boolean
    crankProgress: number
    plateNumber: string
    windshieldCracked: boolean
    damagedTire: boolean
  } | null
}

export type HudCallbacks = {
  start: () => void
  resume: () => void
  map: () => void
  audio: () => void
  weather: () => void
  mission: (id: string) => void
  quit: () => void
  leaderboard: () => Promise<string>
  retryLeaderboard: () => Promise<string>
  skipCutscene?: () => void
  replayIntro?: () => void
  auth?: () => void
  togglePhone?: () => void
  toggleTouch?: () => void
  combat?: CombatHudCallbacks
  phone?: SmartphoneCallbacks
}

type View = 'title' | 'game' | 'pause' | 'map' | 'controls' | 'missions' | 'leaderboard' | 'cutscene'
type ReturnView = 'title' | 'game' | 'pause'

const icons = {
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15M14 6l6 6-6 6"/></svg>',
  map: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  target: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></svg>',
  heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20S4 15 4 9.5a4.5 4.5 0 0 1 8-2.8 4.5 4.5 0 0 1 8 2.8C20 15 12 20 12 20Z"/></svg>',
}

const mapArt = (): string => `
  <svg class="vbn-map-art" viewBox="0 0 260 260" preserveAspectRatio="none" aria-hidden="true">
    <rect width="260" height="260" fill="#11232c"/>
    <path d="M0 0H260V260H0Z" fill="#173943"/>
    <path d="M0 0H173V260H0Z" fill="#293b3b"/>
    <path d="M0 0H57V260H0Z" fill="#314c3b"/>
    <path d="M157 0H173V260H157Z" fill="#887f68"/>
    <path d="M173 0V260" fill="none" stroke="#c1ad84" stroke-opacity=".8" stroke-width="2"/>
    <path d="M0 34H155M0 70H155M0 106H155M0 142H155M0 178H155M0 214H170M0 250H155M65 0V260M95 0V260M130 0V260M152.5 0V260" fill="none" stroke="#aab4a9" stroke-opacity=".46" stroke-width="4"/>
    <path d="M0 70H155M0 142H155M130 0V260M152.5 0V260" fill="none" stroke="#f7d687" stroke-opacity=".5" stroke-width="1" stroke-dasharray="3 4"/>
    <path d="M70 40h20v23H70zm30 0h25v23h-25zm35 0h12v23h-12zM70 76h20v23H70zm30 0h25v23h-25zm35 0h12v23h-12zM70 112h20v23H70zm30 0h25v23h-25zm35 0h12v23h-12zM70 148h20v23H70zm30 0h25v23h-25zm35 0h12v23h-12zM70 184h20v23H70zm30 0h25v23h-25zm35 0h12v23h-12zM70 220h20v23H70zm30 0h25v23h-25zm35 0h12v23h-12z" fill="#415652" fill-opacity=".8"/>
    <path d="M236 19v15m-7-7h15" stroke="#e7f6ee" stroke-width="1.3"/>
    <text x="232" y="16" fill="#e7f6ee" font-size="9" font-family="sans-serif" font-weight="bold">N</text>
  </svg>
  <svg class="vbn-map-zones" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"></svg>
  <svg class="vbn-map-cones" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"></svg>
  <span class="vbn-map-marker vbn-marker-beach" title="Vice Beach"><i></i></span>
  <span class="vbn-map-marker vbn-marker-downtown" title="Downtown"><i></i></span>
  <span class="vbn-map-marker vbn-marker-port" title="Port Vice"><i></i></span>
  <span class="vbn-map-marker vbn-marker-wetlands" title="The Wetlands"><i></i></span>
  <span class="vbn-map-lkp" title="Police search zone" hidden></span>
  <span class="vbn-map-homies"></span>
  <span class="vbn-map-rivals"></span>
  <span class="vbn-map-witnesses"></span>
  <span class="vbn-map-police"></span>
  <span class="vbn-map-homes"></span>
  <span class="vbn-map-target" title="Current objective" hidden></span>
  <span class="vbn-map-player" aria-label="Your position"><i></i></span>`

const controls = [
  ['W A S D', 'Move / drive'],
  ['MOUSE', 'Look / aim'],
  ['SHIFT', 'Sprint'],
  ['SPACE', 'Jump / handbrake'],
  ['F', 'Enter / exit vehicle'],
  ['E', 'Interact / gym / food / cab / spray'],
  ['C', 'Crouch / combat slide'],
  ['Q / RMB', 'Snap to cover / aim peek'],
  ['CLICK', 'Fire / blind-fire / brawl'],
  ['SPACE (UNARMED)', 'Dodge sway in brawl'],
  ['TAB / B / R', 'Weapon wheel / mod / reload'],
  ['P / ↑ / V / X', 'Phone / mask / holster'],
  ['ALT', 'Expand police APB ticker'],
  ['J / G / M / T', 'RPG stats / crew / map / sky'],
  ['PAD: L-STICK / RT / LT', 'Move, drive, accelerate & aim'],
  ['PAD: A / B / X / Y', 'Jump, crouch, reload & car/use'],
  ['PAD: RB / LB+D-PAD', 'Weapon wheel & phone/stats/mask'],
  ['TOUCH: STICKS & ARCS', 'Virtual stick, drag aim & pedals'],
  ['ESC / START', 'Pause'],
]

const missions = [
  { id: 'intro', number: '01', title: 'WELCOME TO VICE BAY', description: 'Find your way from the neon strip to the downtown plaza.', tag: 'THE INTRODUCTION' },
  { id: 'race', number: '02', title: 'MIDNIGHT RUN', description: 'Drive the checkpoints from the waterfront back to the strip.', tag: 'STREET RACE' },
  { id: 'delivery', number: '03', title: 'DOCKSIDE DELIVERY', description: 'Pick up a package at the port and take it to the western safehouse.', tag: 'DELIVERY' },
  { id: 'stunt', number: '04', title: 'STUNT DRIVER', description: 'Get behind the wheel and hit the stunt zone at speed.', tag: 'STUNT' },
]

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const m = Math.floor(s / 60)
  const rem = s % 60
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`
}

function toMapPct(val: number): number {
  return Math.max(2, Math.min(98, (val + 380) / 760 * 100))
}

function buildConePath(cx: number, cz: number, heading: number, rangeMeters: number, fovDeg: number, sweepOffset: number): string {
  const r = Math.min(18, Math.max(2.6, rangeMeters / 760 * 100))
  const half = (fovDeg * Math.PI / 180) * 0.5
  const baseAngle = heading + sweepOffset
  const pts: string[] = [`M ${cx.toFixed(2)} ${cz.toFixed(2)}`]
  const steps = 6
  for (let i = 0; i <= steps; i += 1) {
    const a = baseAngle - half + (i / steps) * (half * 2)
    const x = cx + Math.sin(a) * r
    const y = cz + Math.cos(a) * r
    pts.push(`L ${x.toFixed(2)} ${y.toFixed(2)}`)
  }
  pts.push('Z')
  return pts.join(' ')
}

/** DOM overlay for the game. The host owns simulation, pointer lock and input. */
export class GameHud {
  private readonly element: HTMLElement
  readonly wantedHud: WantedHUD
  readonly combat: CombatHud
  readonly phone: SmartphoneHud
  private view: View = 'title'
  private returnView: ReturnView = 'title'
  private toastTimer: number | undefined
  private padFocusIndex = 0
  readonly gamePanel: HTMLElement

  constructor(root: HTMLElement, private readonly callbacks: HudCallbacks) {
    this.element = document.createElement('div')
    this.element.className = 'vbn'
    this.element.innerHTML = this.template()
    this.element.querySelector('.vbn-map-legend')?.insertAdjacentHTML('beforeend', '<p class="vbn-map-symbol-key">◆ OBJECTIVE &nbsp; · &nbsp; ■ SAFEHOUSE</p>')
    root.replaceChildren(this.element)

    const wantedMount = this.element.querySelector<HTMLElement>('[data-wanted-mount]')!
    this.wantedHud = new WantedHUD(wantedMount)

    const gamePanel = this.element.querySelector<HTMLElement>('[data-view-panel="game"]')!
    this.gamePanel = gamePanel
    const combatCallbacks: CombatHudCallbacks = callbacks.combat ?? {
      selectSector: () => {},
      selectWeapon: () => {},
      toggleAttachment: () => {},
      closeWheel: () => {},
      closeStats: () => {},
    }
    this.combat = new CombatHud(gamePanel, combatCallbacks)

    const phoneCallbacks: SmartphoneCallbacks = callbacks.phone ?? {
      onKeyBeep: () => {},
      onCall911: () => {},
      onCallCab: () => {},
      onRideCab: () => {},
      onSkipRide: () => {},
      onCallJacob: () => {},
      onTakePhoto: () => {},
      onToggleFilter: () => {},
      onCycleWeather: () => {},
      onCycleRingtone: () => 'classic',
      onClose: () => {},
    }
    this.phone = new SmartphoneHud(gamePanel, phoneCallbacks)

    this.element.addEventListener('click', event => this.onClick(event))
    this.showTitle()
  }

  updatePhone(dt: number, state: SmartphoneState): void {
    this.phone.update(dt, state)
  }

  updateCombat(dt: number, state: CombatHudState): void {
    this.combat.update(dt, state, this.view === 'game')
  }

  triggerHitmarker(kind: 'normal' | 'critical' | 'armor' = 'normal'): void {
    this.combat.triggerHitmarker(kind)
  }

  showTitle(): void { this.setView('title') }
  showGame(): void { this.setView('game') }
  showPause(): void { this.setView('pause') }
  showCutscene(): void { this.setView('cutscene') }
  setAuthStatus(name: string | null): void {
    const signedIn = Boolean(name)
    this.text('auth-title', signedIn ? `CLOUD SYNC: ${name} · SIGN OUT` : 'SIGN IN WITH GOOGLE (CLOUD SAVE)')
    this.text('auth-pause', signedIn ? `CLOUD ACCOUNT: ${name} (SIGN OUT)` : 'SIGN IN WITH GOOGLE (CLOUD SAVE)')
    this.text('auth-board', signedIn ? `SIGNED IN AS ${name}` : 'SIGN IN WITH GOOGLE TO POST SCORE')
  }
  setTouchModeLabel(mode: string): void {
    this.text('touch-mode', `TOUCH PAD: ${mode.toUpperCase()}`)
  }

  get currentView(): View {
    return this.view
  }

  private getMenuButtons(): HTMLButtonElement[] {
    if (this.view === 'game' || this.view === 'cutscene') return []
    const panel = this.element.querySelector<HTMLElement>(`[data-view-panel="${this.view}"]`)
    if (!panel) return []
    return Array.from(panel.querySelectorAll<HTMLButtonElement>('button')).filter(b => !b.hidden && b.offsetParent !== null)
  }

  navigateMenu(delta: number): void {
    const buttons = this.getMenuButtons()
    if (buttons.length === 0) return
    this.padFocusIndex = ((this.padFocusIndex + delta) % buttons.length + buttons.length) % buttons.length
    buttons.forEach((btn, idx) => btn.classList.toggle('is-pad-focus', idx === this.padFocusIndex))
    buttons[this.padFocusIndex]?.scrollIntoView({ block: 'nearest' })
  }

  activateFocusedMenu(): boolean {
    const buttons = this.getMenuButtons()
    if (buttons.length === 0) return false
    const btn = buttons[this.padFocusIndex] ?? buttons[0]
    btn?.click()
    return Boolean(btn)
  }

  backMenu(): boolean {
    if (this.view === 'pause' || this.view === 'map') {
      this.callbacks.resume()
      this.showGame()
      return true
    }
    if (this.view === 'controls' || this.view === 'missions' || this.view === 'leaderboard') {
      this.goBack()
      return true
    }
    return false
  }

  showMap(): void {
    if (this.view !== 'map') this.returnView = this.baseView()
    this.setView('map')
  }
  showControls(): void {
    if (this.view !== 'controls') this.returnView = this.baseView()
    this.setView('controls')
  }

  updateCutscene(state: CutsceneHudState): void {
    if (!state.active) return
    this.text('cut-location', state.location)
    this.text('cut-speaker', state.speaker)
    this.text('cut-line', state.line)
    this.text('cut-time', `${formatClock(state.elapsed)} / ${formatClock(state.duration)}`)
    const speakerEl = this.element.querySelector<HTMLElement>('[data-value="cut-speaker"]')
    if (speakerEl) {
      speakerEl.style.color = state.speakerColor
      speakerEl.hidden = !state.speaker
    }
    const bar = this.element.querySelector<HTMLElement>('[data-cut-progress]')
    if (bar) bar.style.width = `${Math.round(state.progress * 1000) / 10}%`
  }

  update(state: HudState): void {
    const number = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback
    const health = Math.max(0, Math.min(100, number(state.health)))
    const stamina = Math.max(0, Math.min(100, number(state.stamina ?? 100)))
    const wanted = Math.max(0, Math.min(6, Math.floor(number(state.wanted))))
    this.text('money', `$${Math.max(0, Math.floor(number(state.money))).toLocaleString('en-US')}`)
    this.text('health', `${Math.round(health)}`)
    this.text('weapon', state.weaponName || 'WEAPON / AMMO')
    this.text('ammo', state.weaponAmmoText || `${Math.max(0, Math.floor(number(state.ammo)))}`)
    this.text('district', state.district || 'VICE BAY')
    this.text('objective', state.objective || 'Explore Vice Bay')
    this.text('time', state.time || '--:--')
    this.text('weather', state.weather || 'CLEAR')
    this.text('mode', state.inVehicle ? 'IN VEHICLE' : 'ON FOOT')
    this.text('speed', `${Math.round(Math.abs(number(state.speed)))}`)
    this.text('prompt', state.prompt || '')
    this.element.querySelectorAll<HTMLElement>('[data-health-fill]').forEach(el => { el.style.width = `${health}%` })
    this.element.querySelectorAll<HTMLElement>('[data-stamina-fill]').forEach(el => { el.style.width = `${stamina}%` })

    const squadEl = this.element.querySelector<HTMLElement>('[data-squad-badge]')
    if (squadEl) {
      const hCount = state.homies ?? 0
      const hMax = state.maxHomies ?? 1
      squadEl.textContent = `HOMIES ${hCount}/${hMax}`
      squadEl.classList.toggle('is-active', hCount > 0)
    }

    const turfEl = this.element.querySelector<HTMLElement>('[data-turf-banner]')
    if (turfEl) {
      turfEl.hidden = !state.turfWar
      if (state.turfWar) {
        this.text('turf-title', `TURF WAR · ${state.turfWar.zoneName.toUpperCase()}`)
        this.text('turf-wave', `WAVE ${state.turfWar.wave}/${state.turfWar.totalWaves} · ${state.turfWar.remaining} LEFT`)
      }
    }

    const heat = state.heat
    this.wantedHud.setTickerExpanded(Boolean(state.apbTickerExpanded))
    this.wantedHud.update(wanted, heat, state.apb ?? undefined)

    const gamePanel = this.element.querySelector<HTMLElement>('[data-view-panel="game"]')
    if (gamePanel) {
      gamePanel.classList.toggle('is-gritty', Boolean(state.grittyFilter))
    }
    const wipers = this.element.querySelector<HTMLElement>('[data-wipers]')
    if (wipers) {
      wipers.hidden = !(state.inVehicle && state.weather === 'rain')
    }
    const vehMeta = this.element.querySelector<HTMLElement>('[data-vehicle-meta]')
    if (vehMeta) {
      const vt = state.vehicleTelemetry
      vehMeta.hidden = !vt
      if (vt) {
        const items: string[] = []
        items.push(`<span class="${vt.seatbeltLatched ? '' : 'is-warn'}">${vt.seatbeltLatched ? 'BELT LATCHED' : 'NO SEATBELT'} · ${vt.plateNumber}</span>`)
        if (vt.engineStalled) {
          items.push(`<span class="is-warn">${vt.crankProgress > 0 ? `CRANKING ${Math.round(vt.crankProgress * 100)}%` : 'ENGINE STALLED — HOLD W'}</span>`)
        } else if (vt.damagedTire) {
          items.push(`<span class="is-warn">PUNCTURED TIRE / BENT AXLE</span>`)
        }
        vehMeta.innerHTML = items.join('')
      }
    }

    const dispatchEl = this.element.querySelector<HTMLElement>('[data-dispatch-banner]')
    if (dispatchEl) {
      const banner = heat?.dispatchBanner
      dispatchEl.hidden = !banner
      if (banner) {
        dispatchEl.dataset.level = String(banner.level)
        this.text('dispatch-code', banner.code)
        this.text('dispatch-text', banner.text)
      }
    }

    const nearPursuer = wanted > 0 && Number.isFinite(state.nearestPursuerDist) && (state.nearestPursuerDist ?? Infinity) <= 60
    this.element.querySelectorAll<HTMLElement>('.vbn-minimap-frame').forEach(el => {
      el.classList.toggle('is-siren-near', nearPursuer)
      el.classList.toggle('is-lockdown', wanted >= 6)
    })

    this.element.querySelectorAll<HTMLElement>('[data-vehicle-only]').forEach(el => { el.hidden = !state.inVehicle })
    this.element.querySelectorAll<HTMLElement>('[data-prompt-wrap]').forEach(el => { el.hidden = !state.prompt })
    const x = Math.max(3, Math.min(97, (number(state.x) + 380) / 760 * 100))
    const z = Math.max(3, Math.min(97, (number(state.z) + 380) / 760 * 100))
    this.element.querySelectorAll<HTMLElement>('.vbn-map-player').forEach(el => {
      el.style.left = `${x}%`
      el.style.top = `${z}%`
      el.style.setProperty('--heading', `${-number(state.heading)}rad`)
    })
    const place = (el: HTMLElement, point: { x: number; z: number }): void => {
      el.style.left = `${Math.max(3, Math.min(97, (number(point.x) + 380) / 760 * 100))}%`
      el.style.top = `${Math.max(3, Math.min(97, (number(point.z) + 380) / 760 * 100))}%`
    }
    this.element.querySelectorAll<HTMLElement>('.vbn-map-target').forEach(el => {
      el.hidden = !state.target
      if (state.target) place(el, state.target)
    })
    this.element.querySelectorAll<HTMLElement>('.vbn-map-lkp').forEach(el => {
      const lkp = heat?.lkp && !heat.inSight ? heat.lkp : null
      el.hidden = !lkp
      if (lkp) place(el, lkp)
    })

    const radarUnits = state.policeRadars ?? []
    const sweepOffset = heat && heat.wanted > 0 && !heat.inSight ? Math.sin(performance.now() * 0.0024) * 0.42 : 0
    const strobeRed = Math.floor(performance.now() / 220) % 2 === 0
    const conesMarkup = radarUnits.map(unit => {
      const cx = toMapPct(number(unit.x))
      const cz = toMapPct(number(unit.z))
      const isChase = Boolean(heat && heat.wanted > 0 && (unit.inSight || heat.inSight))
      const isSearch = Boolean(heat && heat.wanted > 0 && !isChase)
      const coneClass = unit.kind === 'military'
        ? 'vbn-cone is-military'
        : isChase
          ? `vbn-cone is-pursuit ${strobeRed ? 'is-red' : 'is-blue'}`
          : isSearch
            ? 'vbn-cone is-search'
            : 'vbn-cone is-patrol'
      if (unit.fovDeg >= 350) {
        const r = Math.min(18, Math.max(3, unit.range / 760 * 100))
        return `<circle class="${coneClass}" cx="${cx.toFixed(2)}" cy="${cz.toFixed(2)}" r="${r.toFixed(2)}"/>`
      }
      const d = buildConePath(cx, cz, unit.heading, unit.range, unit.fovDeg, isSearch ? sweepOffset : 0)
      return `<path class="${coneClass}" d="${d}"/>`
    }).join('')
    this.element.querySelectorAll<SVGSVGElement>('.vbn-map-cones').forEach(svg => {
      svg.innerHTML = conesMarkup
    })

    const witnessList = heat?.witnesses ?? []
    this.element.querySelectorAll<HTMLElement>('.vbn-map-witnesses').forEach(container => {
      while (container.children.length < witnessList.length) {
        const mark = document.createElement('i')
        mark.className = 'vbn-map-witness'
        mark.textContent = '!'
        container.append(mark)
      }
      while (container.children.length > witnessList.length) container.lastElementChild?.remove()
      witnessList.forEach((w, idx) => {
        const el = container.children[idx] as HTMLElement
        el.classList.toggle('is-reporting', w.state === 'reporting')
        place(el, w)
      })
    })

    const policeMarkers = radarUnits.length > 0
      ? radarUnits.map(u => ({ x: u.x, z: u.z, kind: u.kind }))
      : (state.police ?? []).map(p => ({ x: p.x, z: p.z, kind: p.kind }))
    this.element.querySelectorAll<HTMLElement>('.vbn-map-police').forEach(container => {
      while (container.children.length < policeMarkers.length) {
        const dot = document.createElement('i')
        dot.className = 'vbn-map-cop'
        container.append(dot)
      }
      while (container.children.length > policeMarkers.length) container.lastElementChild?.remove()
      policeMarkers.forEach((unit, idx) => {
        const el = container.children[idx] as HTMLElement
        el.classList.toggle('is-heli', unit.kind === 'heli')
        el.classList.toggle('is-swat', unit.kind === 'swat')
        el.classList.toggle('is-military', unit.kind === 'military')
        place(el, unit)
      })
    })

    const zones = state.gangZones ?? []
    if (zones.length > 0) {
      const zonesMarkup = zones.map(z => {
        const zx = toMapPct(z.x)
        const zz = toMapPct(z.z)
        const zr = Math.max(4, Math.min(16, (z.radius / 760) * 100))
        return `<circle class="vbn-map-zone${z.warActive ? ' is-war' : ''}" cx="${zx.toFixed(2)}" cy="${zz.toFixed(2)}" r="${zr.toFixed(2)}" style="fill:${z.color};stroke:${z.color}"/>`
      }).join('')
      this.element.querySelectorAll<SVGSVGElement>('.vbn-map-zones').forEach(svg => { svg.innerHTML = zonesMarkup })
    }

    const homies = state.homieBlips ?? []
    this.element.querySelectorAll<HTMLElement>('.vbn-map-homies').forEach(container => {
      while (container.children.length < homies.length) {
        const dot = document.createElement('i')
        dot.className = 'vbn-map-homie'
        container.append(dot)
      }
      while (container.children.length > homies.length) container.lastElementChild?.remove()
      homies.forEach((h, idx) => {
        const el = container.children[idx] as HTMLElement
        el.classList.toggle('is-recruited', h.recruited)
        place(el, h)
      })
    })

    const rivals = state.rivalBlips ?? []
    this.element.querySelectorAll<HTMLElement>('.vbn-map-rivals').forEach(container => {
      while (container.children.length < rivals.length) {
        const dot = document.createElement('i')
        dot.className = 'vbn-map-rival'
        container.append(dot)
      }
      while (container.children.length > rivals.length) container.lastElementChild?.remove()
      rivals.forEach((r, idx) => {
        const el = container.children[idx] as HTMLElement
        el.style.background = r.color
        place(el, r)
      })
    })

    this.element.querySelectorAll<HTMLElement>('.vbn-map-homes').forEach(container => {
      while (container.children.length < state.safehouses.length) {
        const marker = document.createElement('i')
        marker.className = 'vbn-map-home'
        marker.title = 'Safehouse'
        container.append(marker)
      }
      while (container.children.length > state.safehouses.length) container.lastElementChild?.remove()
      state.safehouses.forEach((home, index) => place(container.children[index] as HTMLElement, home))
    })
  }

  toast(message: string): void {
    const el = this.element.querySelector<HTMLElement>('.vbn-toast')
    if (!el) return
    el.textContent = message
    el.classList.toggle('is-visible', Boolean(message))
    if (this.toastTimer !== undefined) window.clearTimeout(this.toastTimer)
    if (message) this.toastTimer = window.setTimeout(() => el.classList.remove('is-visible'), 3200)
  }

  private async refreshLeaderboard(): Promise<void> {
    this.text('leaderboard', 'Loading scores…')
    try { this.text('leaderboard', await this.callbacks.leaderboard()) }
    catch { this.text('leaderboard', 'Leaderboard unavailable. Local play is unaffected.') }
  }

  private async retryLeaderboard(): Promise<void> {
    this.text('board-status', 'Retrying submission…')
    try { this.text('board-status', await this.callbacks.retryLeaderboard()) }
    catch { this.text('board-status', 'Retry failed. Local play is unaffected.') }
    await this.refreshLeaderboard()
  }

  private text(slot: string, value: string): void {
    this.element.querySelectorAll<HTMLElement>(`[data-value="${slot}"]`).forEach(el => {
      if (el.textContent !== value) el.textContent = value
    })
  }

  private baseView(): ReturnView {
    if (this.view === 'title') return 'title'
    if (this.view === 'pause') return 'pause'
    if (this.view === 'game') return 'game'
    return this.returnView
  }

  private setView(view: View): void {
    this.view = view
    this.padFocusIndex = 0
    this.element.dataset.view = view
    this.element.querySelectorAll<HTMLElement>('[data-view-panel]').forEach(panel => {
      const name = panel.dataset.viewPanel
      const active = name === view || (name === 'game' && (view === 'pause' || view === 'map' || ((view === 'controls' || view === 'missions' || view === 'leaderboard') && this.returnView !== 'title')))
      panel.hidden = !active
    })
    const buttons = this.getMenuButtons()
    this.element.querySelectorAll('button.is-pad-focus').forEach(b => b.classList.remove('is-pad-focus'))
    if (buttons[0]) buttons[0].classList.add('is-pad-focus')
  }

  private goBack(): void {
    if (this.returnView === 'game' && this.view === 'map') {
      this.callbacks.resume()
      this.showGame()
    } else {
      this.setView(this.returnView)
    }
  }

  private onClick(event: MouseEvent): void {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-action]')
    if (!button || !this.element.contains(button)) return
    switch (button.dataset.action) {
      case 'start': this.callbacks.start(); break
      case 'replay-intro': this.callbacks.replayIntro?.(); break
      case 'skip-cutscene': this.callbacks.skipCutscene?.(); break
      case 'resume': this.callbacks.resume(); this.showGame(); break
      case 'pause':
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
        window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true }))
        break
      case 'map': this.callbacks.map(); this.showMap(); break
      case 'controls': this.showControls(); break
      case 'missions': this.returnView = this.baseView(); this.setView('missions'); break
      case 'leaderboard': this.returnView = this.baseView(); this.setView('leaderboard'); this.text('board-status', ''); void this.refreshLeaderboard(); break
      case 'refresh-board': void this.refreshLeaderboard(); break
      case 'retry-board': void this.retryLeaderboard(); break
      case 'back': this.goBack(); break
      case 'audio': this.callbacks.audio(); break
      case 'weather': this.callbacks.weather(); break
      case 'auth': this.callbacks.auth?.(); break
      case 'phone-toggle': this.callbacks.togglePhone?.(); break
      case 'touch-toggle': this.callbacks.toggleTouch?.(); break
      case 'quit': this.callbacks.quit(); this.showTitle(); break
      case 'mission': {
        const id = button.dataset.mission
        if (id) this.callbacks.mission(id)
        break
      }
    }
  }

  private template(): string {
    const key = (name: string, action: string) => `<div class="vbn-key-row"><kbd>${name}</kbd><span>${action}</span></div>`
    return `
      <section class="vbn-title" data-view-panel="title" aria-label="Vice Bay Nights main menu">
        <div class="vbn-title-shade"></div>
        <header class="vbn-title-top"><div class="vbn-top-brand"><span class="vbn-mark">V<span>B</span></span><span>VICE BAY<br><small>NIGHTS</small></span></div><div class="vbn-top-right"><span class="vbn-live-dot"></span> THE CITY IS AWAKE <span class="vbn-top-divider"></span> <span>EST. AFTER DARK</span></div></header>
        <div class="vbn-title-content">
          <div class="vbn-eyebrow"><span class="vbn-yellow-line"></span> THE CITY NEVER SLEEPS <span class="vbn-yellow-line short"></span></div>
          <h1 class="vbn-logo"><span>VICE BAY</span><em>Nights</em></h1>
          <div class="vbn-title-caption"><span class="vbn-caption-line"></span><span>WELCOME TO THE OTHER SIDE OF PARADISE.</span></div>
          <nav class="vbn-title-menu" aria-label="Main menu">
            <button type="button" class="vbn-btn vbn-btn-primary" data-action="start"><span><small>01 / LET'S RIDE</small><strong>START CAMPAIGN</strong></span>${icons.arrow}</button>
            <button type="button" class="vbn-btn vbn-btn-secondary" data-action="missions"><span><small>02 / PICK YOUR STORY</small><strong>MISSION SELECT</strong></span>${icons.arrow}</button>
            <button type="button" class="vbn-btn vbn-btn-secondary" data-action="controls"><span><small>03 / KNOW THE STREETS</small><strong>CONTROLS</strong></span>${icons.arrow}</button>
            <div class="vbn-title-links">
              <button type="button" class="vbn-title-board" data-action="leaderboard">FIRESTORE LEADERBOARD <span>↗</span></button>
              <button type="button" class="vbn-title-board" data-action="replay-intro">OPENING STORY (2:00) <span>▶</span></button>
              <button type="button" class="vbn-title-board" data-action="auth"><em data-value="auth-title" style="font-style:normal">SIGN IN WITH GOOGLE (CLOUD SAVE)</em> <span>✦</span></button>
            </div>
          </nav>
        </div>
        <aside class="vbn-title-side" aria-hidden="true"><span>VICE BAY, USA</span><i></i><span>AFTER HOURS</span></aside>
        <footer class="vbn-title-bottom"><div class="vbn-mini-controls"><span><kbd>W A S D</kbd> MOVE</span><span><kbd>F</kbd> VEHICLE</span><span><kbd>M</kbd> MAP</span><span><kbd>ESC</kbd> PAUSE</span></div><div class="vbn-bottom-tag"><span class="vbn-live-dot"></span> YOUR NIGHT STARTS HERE</div></footer>
      </section>

      <section class="vbn-cutscene" data-view-panel="cutscene" aria-label="Story cutscene" hidden>
        <div class="vbn-cut-bar vbn-cut-top">
          <div class="vbn-cut-loc"><span class="vbn-live-dot"></span><span data-value="cut-location">VICE BAY</span></div>
          <div class="vbn-cut-controls">
            <span class="vbn-cut-time" data-value="cut-time">00:00 / 02:00</span>
            <button type="button" class="vbn-cut-skip" data-action="skip-cutscene">SKIP CUTSCENE <kbd>SPACE</kbd></button>
          </div>
        </div>
        <div class="vbn-cut-bar vbn-cut-bottom">
          <div class="vbn-cut-dialogue">
            <span class="vbn-cut-speaker" data-value="cut-speaker">ELENA</span>
            <p class="vbn-cut-line" data-value="cut-line"></p>
          </div>
          <div class="vbn-cut-track"><i data-cut-progress></i></div>
        </div>
      </section>

      <section class="vbn-game" data-view-panel="game" aria-label="Game status" hidden><div class="vbn-camera-grade" aria-hidden="true"></div>
        <div class="vbn-wipers" data-wipers hidden aria-hidden="true"><i class="vbn-wiper is-left"></i><i class="vbn-wiper is-right"></i></div>
        <div class="vbn-dispatch-banner" data-dispatch-banner hidden>
          <span class="vbn-dispatch-badge" data-value="dispatch-code">10-31</span>
          <span class="vbn-dispatch-msg" data-value="dispatch-text">DISPATCH: 10-31 IN PROGRESS</span>
        </div>
        <div class="vbn-turf-banner" data-turf-banner hidden>
          <strong data-value="turf-title">TURF WAR</strong>
          <span data-value="turf-wave">WAVE 1/3</span>
        </div>
        <div class="vbn-game-top-left">
          <div class="vbn-hud-kicker"><span class="vbn-live-dot"></span> VICE BAY <b>/</b> <span data-value="district">VICE BAY</span></div>
          <div class="vbn-objective"><span class="vbn-objective-icon">${icons.target}</span><div><small>CURRENT OBJECTIVE</small><strong data-value="objective">Explore Vice Bay</strong></div></div>
          <div class="vbn-world-meta"><span data-value="time">--:--</span><i></i><span data-value="weather">CLEAR</span><i></i><span data-value="mode">ON FOOT</span><i></i><span class="vbn-squad-pill" data-squad-badge>HOMIES 0/1</span></div>
        </div>
        <div class="vbn-game-top-right">
          <div class="vbn-money"><small>CASH ON HAND</small><strong data-value="money">$0</strong></div>
          <div data-wanted-mount></div>
          <div class="vbn-vitals"><span class="vbn-vital-icon">${icons.heart}</span><div class="vbn-health"><div><small>HEALTH</small><b data-value="health">100</b></div><span class="vbn-health-track"><i data-health-fill></i></span><span class="vbn-stamina-track"><i data-stamina-fill></i></span></div><div class="vbn-ammo"><small data-value="weapon">WEAPON / AMMO</small><strong data-value="ammo">0</strong></div></div>
        </div>
        <div class="vbn-game-bottom-left">
          <div class="vbn-minimap-frame"><div class="vbn-minimap">${mapArt()}</div><span class="vbn-map-corner">N</span></div>
          <div class="vbn-map-caption"><div><small>CURRENT DISTRICT</small><strong data-value="district">VICE BAY</strong></div><button class="vbn-icon-btn" type="button" data-action="map" aria-label="Open city map">${icons.map}</button></div>
        </div>
        <div class="vbn-prompt" data-prompt-wrap hidden><span class="vbn-prompt-accent"></span><span data-value="prompt"></span></div>
        <div class="vbn-game-bottom-right"><div class="vbn-vehicle-meta" data-vehicle-meta hidden></div><div class="vbn-speed" data-vehicle-only hidden><strong data-value="speed">0</strong><span>SPEED</span></div><button class="vbn-hud-phone-btn" type="button" data-action="phone-toggle"><span>📱 PHONE <kbd>P</kbd></span></button><button class="vbn-hud-pause" type="button" data-action="pause">${icons.pause}<span>PAUSE <kbd>ESC</kbd></span></button></div>
      </section>

      <section class="vbn-overlay" data-view-panel="pause" aria-label="Pause menu" hidden>
        <div class="vbn-modal vbn-pause-modal"><div class="vbn-modal-top"><span>VICE BAY NIGHTS <b>/</b> PAUSE MENU</span><span class="vbn-modal-index">01 — 04</span></div><p class="vbn-section-label">TAKE A BREATH</p><h2>PAUSED<span>.</span></h2><p class="vbn-modal-copy">The city can wait. For a moment.</p><nav class="vbn-modal-menu" aria-label="Pause options"><button type="button" class="vbn-btn vbn-btn-primary" data-action="resume"><span><strong>RESUME GAME</strong></span>${icons.arrow}</button><button type="button" class="vbn-menu-row" data-action="map"><span>CITY MAP</span><span>↗</span></button><button type="button" class="vbn-menu-row" data-action="missions"><span>MISSION SELECT</span><span>↗</span></button><button type="button" class="vbn-menu-row" data-action="replay-intro"><span>REPLAY OPENING STORY (2:00)</span><span>▶</span></button><button type="button" class="vbn-menu-row" data-action="leaderboard"><span>FIRESTORE LEADERBOARD</span><span>↗</span></button><button type="button" class="vbn-menu-row" data-action="auth"><span data-value="auth-pause">SIGN IN WITH GOOGLE (CLOUD SAVE)</span><span>✦</span></button><button type="button" class="vbn-menu-row" data-action="controls"><span>CONTROLS</span><span>↗</span></button><button type="button" class="vbn-menu-row" data-action="touch-toggle"><span data-value="touch-mode">TOUCH PAD: AUTO</span><span>✦</span></button><button type="button" class="vbn-menu-row" data-action="audio"><span>TOGGLE AUDIO</span><span>↗</span></button><button type="button" class="vbn-menu-row" data-action="weather"><span>CHANGE WEATHER</span><span>↗</span></button><button type="button" class="vbn-menu-row vbn-quit" data-action="quit"><span>RETURN TO TITLE</span><span>↗</span></button></nav><div class="vbn-modal-foot">THE NIGHT IS STILL YOUNG <span>✦</span></div></div>
      </section>

      <section class="vbn-overlay" data-view-panel="leaderboard" aria-label="Firestore leaderboard" hidden>
        <div class="vbn-modal vbn-wide-modal"><div class="vbn-modal-top"><span>VICE BAY NIGHTS <b>/</b> FIREBASE</span><button class="vbn-close" data-action="back" type="button" aria-label="Back">${icons.close}</button></div><p class="vbn-section-label">THE CITY'S CONTRACTS</p><h2>LEADER<span>BOARD.</span></h2><p class="vbn-modal-copy">Live rankings and cloud saves powered by Google Firebase Firestore. Sign in with Google to post your contract completions.</p><div class="vbn-board-list" data-value="leaderboard" role="status" aria-live="polite">Loading scores…</div><p class="vbn-board-status" data-value="board-status" role="status" aria-live="polite"></p><div class="vbn-board-actions"><button class="vbn-menu-row" type="button" data-action="auth"><span data-value="auth-board">SIGN IN WITH GOOGLE TO POST SCORE</span> <span>✦</span></button><button class="vbn-menu-row" type="button" data-action="refresh-board">REFRESH SCORES ↗</button><button class="vbn-menu-row" type="button" data-action="retry-board">RETRY FAILED SUBMISSION ↗</button></div><button class="vbn-back" type="button" data-action="back">← &nbsp; BACK</button></div>
      </section>

      <section class="vbn-overlay" data-view-panel="missions" aria-label="Mission selection" hidden>
        <div class="vbn-modal vbn-wide-modal"><div class="vbn-modal-top"><span>VICE BAY NIGHTS <b>/</b> CONTRACTS</span><button class="vbn-close" data-action="back" type="button" aria-label="Back">${icons.close}</button></div><p class="vbn-section-label">MAKE YOUR MOVE</p><h2>MISSION <span>SELECT.</span></h2><p class="vbn-modal-copy">Pick a story and take it to the streets.</p><div class="vbn-missions">${missions.map(mission => `<button type="button" class="vbn-mission" data-action="mission" data-mission="${mission.id}"><span class="vbn-mission-no">${mission.number}</span><span class="vbn-mission-main"><small>${mission.tag}</small><strong>${mission.title}</strong><span>${mission.description}</span></span><span class="vbn-mission-arrow">↗</span></button>`).join('')}</div><button class="vbn-back" type="button" data-action="back">← &nbsp; BACK</button></div>
      </section>

      <section class="vbn-overlay" data-view-panel="controls" aria-label="Controls" hidden>
        <div class="vbn-modal vbn-wide-modal"><div class="vbn-modal-top"><span>VICE BAY NIGHTS <b>/</b> FIELD GUIDE</span><button class="vbn-close" data-action="back" type="button" aria-label="Back">${icons.close}</button></div><p class="vbn-section-label">KNOW THE STREETS</p><h2>THE <span>CONTROLS.</span></h2><p class="vbn-modal-copy">Everything you need for a night out in Vice Bay.</p><div class="vbn-control-grid">${controls.map(([name, action]) => key(name, action)).join('')}</div><button class="vbn-back" type="button" data-action="back">← &nbsp; BACK</button></div>
      </section>

      <section class="vbn-overlay vbn-map-overlay" data-view-panel="map" aria-label="City map" hidden>
        <div class="vbn-modal vbn-map-modal"><div class="vbn-modal-top"><span>VICE BAY NIGHTS <b>/</b> CITY DIRECTORY</span><button class="vbn-close" data-action="back" type="button" aria-label="Close map">${icons.close}</button></div><div class="vbn-map-heading"><div><p class="vbn-section-label">FIND YOUR WAY</p><h2>VICE BAY <span>MAP.</span></h2></div><div class="vbn-map-heading-meta"><small>YOU ARE IN</small><strong data-value="district">VICE BAY</strong></div></div><div class="vbn-map-layout"><div class="vbn-full-map">${mapArt()}<span class="vbn-map-label vbn-map-label-beach">VICE BEACH</span><span class="vbn-map-label vbn-map-label-downtown">DOWNTOWN</span><span class="vbn-map-label vbn-map-label-port">PORT VICE</span><span class="vbn-map-label vbn-map-label-wetlands">THE WETLANDS</span></div><div class="vbn-map-legend"><p class="vbn-section-label">THE DISTRICTS</p><div><i class="vbn-dot pink"></i><span>01 <strong>VICE BEACH</strong><small>Beachfront / nightlife</small></span></div><div><i class="vbn-dot cyan"></i><span>02 <strong>DOWNTOWN</strong><small>City center / bank</small></span></div><div><i class="vbn-dot yellow"></i><span>03 <strong>PORT VICE</strong><small>Waterfront / warehouses</small></span></div><div><i class="vbn-dot green"></i><span>04 <strong>THE WETLANDS</strong><small>Outskirts / open roads</small></span></div><p class="vbn-legend-you"><i></i> YOUR POSITION</p></div></div><button class="vbn-back" type="button" data-action="back">← &nbsp; BACK</button></div>
      </section>
      <div class="vbn-toast" role="status" aria-live="polite"></div>`
  }
}
