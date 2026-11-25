import type { HeatHudState } from '../game/heatSystem'
import type { ApbHudIntel } from '../game/policeKnowledge'

const STAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="12 2.4 14.95 8.5 21.7 9.45 16.8 14.2 18 20.9 12 17.7 6 20.9 7.2 14.2 2.3 9.45 9.05 8.5 12 2.4"/></svg>'

export type WantedStateSnapshot = {
  crimeLevel: number
  heat?: HeatHudState
  apb?: ApbHudIntel
}

export type WantedStateListener = (snapshot: WantedStateSnapshot) => void

/**
 * Top-right GTA-style WantedHUD component:
 * - Positioned in the top-right corner with 5-star indicator (expanding to 6-star Military Lockdown).
 * - Animates state transitions: pulsing bright stars during active pursuit, flashing/fading outline
 *   stars during cooldown/evasion, amber witness alert accent, and radial SVG heat/dispatch ring.
 * - Includes a reactive state listener (`subscribe` / `setCrimeLevel` / `bindState`) and the
 *   GTA 6 "APB KNOWN INTEL" badge cluster + expandable 1-line police dispatch ticker.
 */
export class WantedHUD {
  readonly element: HTMLElement
  private readonly starsEl: HTMLElement
  private readonly segments: HTMLElement[]
  private readonly heatWrap: HTMLElement | null
  private readonly heatStatus: HTMLElement | null
  private readonly heatFill: HTMLElement | null
  private readonly heatRing: SVGCircleElement | null
  private readonly apbWrap: HTMLElement | null
  private readonly apbFace: HTMLElement | null
  private readonly apbOutfit: HTMLElement | null
  private readonly apbWeapon: HTMLElement | null
  private readonly apbVehicle: HTMLElement | null
  private readonly apbTicker: HTMLElement | null
  private readonly listeners = new Set<WantedStateListener>()
  private crimeLevel = 0
  private lastHeat?: HeatHudState
  private lastApb?: ApbHudIntel
  private tickerExpanded = false
  private unboundSource?: () => void

  constructor(container?: HTMLElement) {
    this.element = document.createElement('div')
    this.element.className = 'vbn-wanted-hud'
    this.element.innerHTML = WantedHUD.markup()
    if (container) container.append(this.element)

    this.starsEl = this.element.querySelector<HTMLElement>('[data-wanted]')!
    this.segments = Array.from(this.element.querySelectorAll<HTMLElement>('[data-wanted-segment]'))
    this.heatWrap = this.element.querySelector<HTMLElement>('[data-heat-wrap]')
    this.heatStatus = this.element.querySelector<HTMLElement>('[data-value="heat-status"]')
    this.heatFill = this.element.querySelector<HTMLElement>('[data-heat-fill]')
    this.heatRing = this.element.querySelector<SVGCircleElement>('[data-heat-ring]')
    this.apbWrap = this.element.querySelector<HTMLElement>('[data-apb-wrap]')
    this.apbFace = this.element.querySelector<HTMLElement>('[data-apb-face]')
    this.apbOutfit = this.element.querySelector<HTMLElement>('[data-apb-outfit]')
    this.apbWeapon = this.element.querySelector<HTMLElement>('[data-apb-weapon]')
    this.apbVehicle = this.element.querySelector<HTMLElement>('[data-apb-vehicle]')
    this.apbTicker = this.element.querySelector<HTMLElement>('[data-apb-ticker]')
  }

  static markup(): string {
    const stars = Array.from(
      { length: 6 },
      (_, i) => `<span class="vbn-wanted-segment${i === 5 ? ' is-lockdown-star' : ''}" data-wanted-segment="${i + 1}"${i === 5 ? ' hidden' : ''} aria-hidden="true">${STAR_SVG}</span>`,
    ).join('')
    return `
      <div class="vbn-stars" data-wanted aria-label="Wanted level: 0 out of 5">${stars}</div>
      <div class="vbn-heat-wrap" data-heat-wrap hidden>
        <div class="vbn-heat-meta">
          <span class="vbn-heat-status" data-value="heat-status">IN SIGHT</span>
          <span class="vbn-heat-track"><i data-heat-fill></i></span>
        </div>
        <svg class="vbn-heat-ring" viewBox="0 0 36 36" aria-hidden="true">
          <circle class="vbn-heat-ring-bg" cx="18" cy="18" r="14"/>
          <circle class="vbn-heat-ring-fg" data-heat-ring cx="18" cy="18" r="14"/>
        </svg>
      </div>
      <div class="vbn-apb-wrap" data-apb-wrap hidden>
        <div class="vbn-apb-badges">
          <span class="vbn-apb-tag" data-apb-face>MASKED / UNKNOWN FACE</span>
          <span class="vbn-apb-tag" data-apb-outfit hidden>OUTFIT CLEARED</span>
          <span class="vbn-apb-tag is-red" data-apb-weapon hidden>ARMED</span>
          <span class="vbn-apb-tag" data-apb-vehicle hidden>CLEAN VEHICLE</span>
        </div>
        <div class="vbn-apb-ticker" data-apb-ticker hidden>APB: SCANNING…</div>
      </div>
    `
  }

  /** Register a reactive listener invoked whenever the player's crime level changes. */
  subscribe(listener: WantedStateListener): () => void {
    this.listeners.add(listener)
    listener({ crimeLevel: this.crimeLevel, heat: this.lastHeat, apb: this.lastApb })
    return () => this.listeners.delete(listener)
  }

  /** Bind WantedHUD directly to an external reactive crime-level state store. */
  bindState(source: { subscribe: (fn: WantedStateListener) => () => void }): () => void {
    this.unboundSource?.()
    this.unboundSource = source.subscribe(snapshot => {
      this.setCrimeLevel(snapshot.crimeLevel, snapshot.heat, snapshot.apb)
    })
    return () => {
      this.unboundSource?.()
      this.unboundSource = undefined
    }
  }

  getCrimeLevel(): number {
    return this.crimeLevel
  }

  setTickerExpanded(expanded: boolean): void {
    this.tickerExpanded = expanded
    if (this.apbTicker) {
      this.apbTicker.hidden = !expanded || (!this.lastApb && this.crimeLevel <= 0)
    }
  }

  setCrimeLevel(wantedInput: number, heat?: HeatHudState, apb?: ApbHudIntel): void {
    const prevLevel = this.crimeLevel
    this.update(wantedInput, heat, apb)
    if (this.crimeLevel !== prevLevel) {
      const snap: WantedStateSnapshot = { crimeLevel: this.crimeLevel, heat, apb }
      for (const listener of this.listeners) listener(snap)
    }
  }

  update(wantedInput: number, heat?: HeatHudState, apb?: ApbHudIntel): void {
    const wanted = Math.max(0, Math.min(6, Math.floor(Number.isFinite(wantedInput) ? wantedInput : 0)))
    this.crimeLevel = wanted
    this.lastHeat = heat
    this.lastApb = apb
    const maxDisplay = wanted >= 6 ? 6 : 5

    for (let i = 0; i < this.segments.length; i += 1) {
      const seg = this.segments[i]
      const index = i + 1
      seg.hidden = index === 6 && wanted < 6
      seg.classList.toggle('is-lit', i < wanted)
      seg.dataset.level = String(wanted)
    }

    const inPursuit = Boolean(heat ? (heat.wanted > 0 && heat.inSight) : wanted > 0)
    const isEvading = Boolean(heat && heat.wanted > 0 && !heat.inSight)
    const isWitness = Boolean(heat && heat.phase === 'witness')

    this.starsEl.setAttribute('aria-label', `Wanted level: ${wanted} out of ${maxDisplay}`)
    this.starsEl.dataset.level = String(wanted)
    this.starsEl.classList.toggle('is-pursuit', inPursuit)
    this.starsEl.classList.toggle('is-evading', isEvading)
    this.starsEl.classList.toggle('is-witness', isWitness)
    this.starsEl.classList.toggle('is-lockdown', wanted >= 6)

    // Progressive fade on active cooldown stars as evasion approaches 100%
    if (isEvading && heat) {
      const fadeOpacity = Math.max(0.32, 1 - heat.cooldownProgress * 0.65)
      this.starsEl.style.setProperty('--evade-fade', fadeOpacity.toFixed(2))
    } else {
      this.starsEl.style.removeProperty('--evade-fade')
    }

    if (this.heatWrap) {
      const showHeat = Boolean(heat && heat.phase !== 'clear')
      this.heatWrap.hidden = !showHeat
      if (heat && showHeat) {
        this.heatWrap.dataset.phase = heat.phase
        if (this.heatStatus && this.heatStatus.textContent !== heat.statusText) {
          this.heatStatus.textContent = heat.statusText
        }
        const pct = heat.phase === 'witness'
          ? heat.witnessProgress
          : heat.phase === 'evading'
            ? heat.cooldownProgress
            : heat.reinforcementProgress
        const clamped = Math.max(0, Math.min(1, pct))
        if (this.heatFill) this.heatFill.style.width = `${Math.round(clamped * 100)}%`
        if (this.heatRing) {
          const circumference = 87.96
          this.heatRing.style.strokeDasharray = `${circumference}`
          this.heatRing.style.strokeDashoffset = `${(circumference * (1 - clamped)).toFixed(2)}`
        }
      }
    }

    if (this.apbWrap) {
      const showApb = Boolean(
        apb && (wanted > 0 || apb.faceIdentified || apb.outfitLogged || apb.outfitCleared || apb.vehicleApb || apb.cleanVehicle || apb.masked || this.tickerExpanded),
      )
      this.apbWrap.hidden = !showApb
      if (apb && showApb) {
        if (this.apbFace) {
          this.apbFace.textContent = apb.faceIdentified ? 'FACE ID\'D' : apb.masked ? 'MASKED / UNKNOWN' : 'FACE UNKNOWN'
          this.apbFace.className = `vbn-apb-tag ${apb.faceIdentified ? 'is-red' : 'is-clear'}`
        }
        if (this.apbOutfit) {
          const showOutfit = apb.outfitLogged || apb.outfitCleared
          this.apbOutfit.hidden = !showOutfit
          if (showOutfit) {
            this.apbOutfit.textContent = apb.outfitLogged ? 'OUTFIT LOGGED' : 'OUTFIT CLEARED'
            this.apbOutfit.className = `vbn-apb-tag ${apb.outfitLogged ? 'is-amber' : 'is-clear'}`
          }
        }
        if (this.apbWeapon) {
          this.apbWeapon.hidden = !apb.armedClass
          if (apb.armedClass) this.apbWeapon.textContent = `ARMED: ${apb.armedClass}`
        }
        if (this.apbVehicle) {
          const showVeh = apb.vehicleApb || apb.cleanVehicle
          this.apbVehicle.hidden = !showVeh
          if (showVeh) {
            this.apbVehicle.textContent = apb.vehicleApb ? `PLATE APB: ${apb.plateNumber ?? ''}` : 'CLEAN VEHICLE'
            this.apbVehicle.className = `vbn-apb-tag ${apb.vehicleApb ? 'is-amber' : 'is-clear'}`
          }
        }
        if (this.apbTicker) {
          this.apbTicker.hidden = !this.tickerExpanded && !inPursuit
          this.apbTicker.textContent = apb.tickerLine
        }
      }
    }
  }

  dispose(): void {
    this.unboundSource?.()
    this.listeners.clear()
    this.element.remove()
  }
}
