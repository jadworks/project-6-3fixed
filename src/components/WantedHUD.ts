import type { HeatHudState } from '../game/heatSystem'

const STAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="12 2.4 14.95 8.5 21.7 9.45 16.8 14.2 18 20.9 12 17.7 6 20.9 7.2 14.2 2.3 9.45 9.05 8.5 12 2.4"/></svg>'

/**
 * Top-right GTA-style WantedHUD component:
 * - Renders the 5-star indicator cluster (expanding to a 6th Military Lockdown star at heat 6).
 * - Animates state transitions: pulsing bright stars during active pursuit, flashing/fading outline
 *   stars during cooldown/evasion, amber witness alert accent, and radial SVG heat/dispatch ring.
 */
export class WantedHUD {
  readonly element: HTMLElement
  private readonly starsEl: HTMLElement
  private readonly segments: HTMLElement[]
  private readonly heatWrap: HTMLElement | null
  private readonly heatStatus: HTMLElement | null
  private readonly heatFill: HTMLElement | null
  private readonly heatRing: SVGCircleElement | null

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
    `
  }

  update(wantedInput: number, heat?: HeatHudState): void {
    const wanted = Math.max(0, Math.min(6, Math.floor(Number.isFinite(wantedInput) ? wantedInput : 0)))
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
  }

  dispose(): void {
    this.element.remove()
  }
}
