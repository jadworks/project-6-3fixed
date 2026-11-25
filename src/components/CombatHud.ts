import {
  type AttachmentId,
  WEAPON_CATALOG,
  WEAPON_SECTORS,
  type WeaponSpec,
} from '../game/weapons'
import type { RpgHudState } from '../game/sanAndreasRpg'

export type CombatHudState = {
  wheelOpen: boolean
  statsOpen: boolean
  aiming: boolean
  reloading: boolean
  reloadProgress: number
  spreadPx: number
  weapon: WeaponSpec
  mag: number
  reserve: number
  attachments: AttachmentId[]
  rpg: RpgHudState
  homieCount: number
  turfWar: { zoneName: string; wave: number; totalWaves: number; remaining: number } | null
}

export type CombatHudCallbacks = {
  selectSector: (sectorIndex: number, cycle?: boolean) => void
  selectWeapon: (weaponId: string) => void
  toggleAttachment: (attachment: AttachmentId) => void
  closeWheel: () => void
  closeStats: () => void
}

function polarPt(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)]
}

function wedgePath(cx: number, cy: number, rIn: number, rOut: number, startDeg: number, endDeg: number): string {
  const [x1, y1] = polarPt(cx, cy, rOut, startDeg)
  const [x2, y2] = polarPt(cx, cy, rOut, endDeg)
  const [x3, y3] = polarPt(cx, cy, rIn, endDeg)
  const [x4, y4] = polarPt(cx, cy, rIn, startDeg)
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${rOut} ${rOut} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)} L ${x3.toFixed(1)} ${y3.toFixed(1)} A ${rIn} ${rIn} 0 0 0 ${x4.toFixed(1)} ${y4.toFixed(1)} Z`
}

const ATTACHMENT_LABELS: Record<AttachmentId, string> = {
  suppressor: 'SUPPRESSOR',
  extMag: 'EXT. MAG',
  reflex: 'REFLEX / GRIP',
}

/**
 * GTA 6 Tactical Combat HUD + 8-Sector Radial Weapon Wheel + San Andreas RPG Stats Overlay.
 */
export class CombatHud {
  readonly reticleEl: HTMLElement
  readonly wheelEl: HTMLElement
  readonly statsEl: HTMLElement
  readonly vignetteEl: HTMLElement
  private hitmarkerTimer = 0
  private lastSector = -1

  constructor(gamePanel: HTMLElement, private readonly callbacks: CombatHudCallbacks) {
    this.vignetteEl = document.createElement('div')
    this.vignetteEl.className = 'vbn-slowmo-vignette'
    this.vignetteEl.hidden = true

    this.reticleEl = document.createElement('div')
    this.reticleEl.className = 'vbn-reticle'
    this.reticleEl.innerHTML = `
      <span class="vbn-ret-prong is-top"></span>
      <span class="vbn-ret-prong is-right"></span>
      <span class="vbn-ret-prong is-bottom"></span>
      <span class="vbn-ret-prong is-left"></span>
      <span class="vbn-ret-dot"></span>
      <span class="vbn-ret-circle"></span>
      <span class="vbn-hitmarker" data-hitmarker hidden></span>
      <span class="vbn-reload-pill" data-reload-pill hidden><i data-reload-fill></i></span>
    `

    this.wheelEl = document.createElement('div')
    this.wheelEl.className = 'vbn-wheel-overlay'
    this.wheelEl.hidden = true
    this.wheelEl.innerHTML = this.buildWheelMarkup()

    this.statsEl = document.createElement('aside')
    this.statsEl.className = 'vbn-sa-stats'
    this.statsEl.hidden = true
    this.statsEl.innerHTML = this.buildStatsMarkup()

    gamePanel.append(this.vignetteEl, this.reticleEl, this.wheelEl, this.statsEl)

    this.wheelEl.addEventListener('click', ev => {
      const target = ev.target as Element
      const sectorBtn = target.closest<HTMLElement>('[data-wheel-sector]')
      if (sectorBtn) {
        const idx = Number(sectorBtn.dataset.wheelSector)
        this.callbacks.selectSector(idx, idx === this.lastSector)
        return
      }
      const variantBtn = target.closest<HTMLElement>('[data-wheel-variant]')
      if (variantBtn?.dataset.wheelVariant) {
        this.callbacks.selectWeapon(variantBtn.dataset.wheelVariant)
        return
      }
      const attBtn = target.closest<HTMLElement>('[data-wheel-att]')
      if (attBtn?.dataset.wheelAtt) {
        this.callbacks.toggleAttachment(attBtn.dataset.wheelAtt as AttachmentId)
        return
      }
      if (target.closest('[data-wheel-close]')) this.callbacks.closeWheel()
    })

    this.statsEl.addEventListener('click', ev => {
      if ((ev.target as Element).closest('[data-stats-close]')) {
        this.callbacks.closeStats()
      }
    })
  }

  private buildWheelMarkup(): string {
    const cx = 210
    const cy = 210
    const wedges = WEAPON_SECTORS.map((sector, idx) => {
      const start = idx * 45 - 22.5
      const end = start + 45
      const [lx, ly] = polarPt(cx, cy, 138, idx * 45)
      return `
        <g class="vbn-wheel-sector" data-wheel-sector="${idx}" role="button" tabindex="0" aria-label="${sector.label}">
          <path d="${wedgePath(cx, cy, 86, 192, start + 1.2, end - 1.2)}"/>
          <text x="${lx.toFixed(1)}" y="${(ly - 4).toFixed(1)}" class="vbn-wheel-num">${idx + 1}</text>
          <text x="${lx.toFixed(1)}" y="${(ly + 11).toFixed(1)}" class="vbn-wheel-label">${sector.short}</text>
        </g>
      `
    }).join('')

    return `
      <div class="vbn-wheel-stage">
        <div class="vbn-wheel-header"><span>TACTICAL SLOW-MO · 25%</span><strong>WEAPON WHEEL</strong><button type="button" class="vbn-wheel-close" data-wheel-close>✕</button></div>
        <div class="vbn-wheel-body">
          <svg class="vbn-wheel-svg" viewBox="0 0 420 420" aria-label="8-sector weapon wheel">
            ${wedges}
          </svg>
          <div class="vbn-wheel-core">
            <small data-wheel-cat>HANDGUNS</small>
            <strong data-wheel-name>9mm Combat Pistol</strong>
            <div class="vbn-wheel-ammo" data-wheel-ammo>15 / 90</div>
            <div class="vbn-wheel-bars">
              <div><span>DMG</span><i><b data-bar-dmg></b></i></div>
              <div><span>ROF</span><i><b data-bar-rof></b></i></div>
              <div><span>ACC</span><i><b data-bar-acc></b></i></div>
            </div>
            <div class="vbn-wheel-variants" data-wheel-variants></div>
            <div class="vbn-wheel-atts" data-wheel-atts></div>
            <p class="vbn-wheel-hint">1–8 SECTOR · CLICK SECTOR TO CYCLE · B ATTACH · RELEASE TAB</p>
          </div>
        </div>
      </div>
    `
  }

  private buildStatsMarkup(): string {
    const rows: Array<[string, string, string]> = [
      ['respect', 'RESPECT', 'Unlocks up to 6 homies (G/H)'],
      ['stamina', 'STAMINA', 'Sprint & swim endurance'],
      ['muscle', 'MUSCLE', 'Physique & melee damage'],
      ['fat', 'FAT', 'Burned at Gym or sprinting'],
      ['hunger', 'HUNGER', 'Eat at street stands (E)'],
      ['weaponSkill', 'WEAPON SKILL', 'Spread, recoil & reload speed'],
      ['drivingSkill', 'DRIVING SKILL', 'Vehicle grip & high-speed control'],
    ]
    return `
      <div class="vbn-sa-head">
        <div><small>VICE BAY / SAN ANDREAS RPG</small><strong>CHARACTER STATS</strong></div>
        <button type="button" class="vbn-wheel-close" data-stats-close>J · ✕</button>
      </div>
      <div class="vbn-sa-badges">
        <span data-sa-tier>WEAPON: POOR</span>
        <span data-sa-homies>HOMIES CAP: 1</span>
      </div>
      <div class="vbn-sa-bars">
        ${rows.map(([key, label, hint]) => `
          <div class="vbn-sa-row" title="${hint}">
            <div class="vbn-sa-label"><span>${label}</span><b data-sa-val="${key}">0%</b></div>
            <div class="vbn-sa-track"><i data-sa-fill="${key}"></i></div>
          </div>
        `).join('')}
      </div>
      <p class="vbn-sa-foot">TRAIN MUSCLE AT BEACH/DOWNTOWN GYM · RECRUIT CREW WITH <kbd>G</kbd>/<kbd>H</kbd></p>
    `
  }

  triggerHitmarker(kind: 'normal' | 'critical' | 'armor' = 'normal'): void {
    const hm = this.reticleEl.querySelector<HTMLElement>('[data-hitmarker]')
    if (!hm) return
    this.hitmarkerTimer = 0.2
    hm.hidden = false
    hm.dataset.kind = kind
  }

  update(dt: number, state: CombatHudState, visibleInPlay: boolean): void {
    if (this.hitmarkerTimer > 0) {
      this.hitmarkerTimer = Math.max(0, this.hitmarkerTimer - dt)
      if (this.hitmarkerTimer === 0) {
        const hm = this.reticleEl.querySelector<HTMLElement>('[data-hitmarker]')
        if (hm) hm.hidden = true
      }
    }

    this.reticleEl.hidden = !visibleInPlay || state.wheelOpen
    if (!this.reticleEl.hidden) {
      this.reticleEl.classList.toggle('is-aiming', state.aiming)
      this.reticleEl.classList.toggle('is-shotgun', state.weapon.category === 'shotgun')
      this.reticleEl.classList.toggle('is-melee', state.weapon.category === 'melee')
      this.reticleEl.classList.toggle('is-precision', state.weapon.category === 'precision')
      this.reticleEl.style.setProperty('--ret-gap', `${Math.round(state.spreadPx)}px`)
      const reloadPill = this.reticleEl.querySelector<HTMLElement>('[data-reload-pill]')
      if (reloadPill) {
        reloadPill.hidden = !state.reloading
        const fill = reloadPill.querySelector<HTMLElement>('[data-reload-fill]')
        if (fill && state.reloading) fill.style.width = `${Math.round(state.reloadProgress * 100)}%`
      }
    }

    this.vignetteEl.hidden = !visibleInPlay || !state.wheelOpen
    this.wheelEl.hidden = !visibleInPlay || !state.wheelOpen
    if (visibleInPlay && state.wheelOpen) {
      this.syncWheel(state)
    }

    this.statsEl.hidden = !visibleInPlay || !state.statsOpen
    if (visibleInPlay && state.statsOpen) {
      this.syncStats(state.rpg, state.homieCount)
    }
  }

  private syncWheel(state: CombatHudState): void {
    const w = state.weapon
    this.lastSector = w.sectorIndex
    this.wheelEl.querySelectorAll<HTMLElement>('[data-wheel-sector]').forEach(el => {
      el.classList.toggle('is-active', Number(el.dataset.wheelSector) === w.sectorIndex)
    })
    const cat = this.wheelEl.querySelector<HTMLElement>('[data-wheel-cat]')
    const name = this.wheelEl.querySelector<HTMLElement>('[data-wheel-name]')
    const ammo = this.wheelEl.querySelector<HTMLElement>('[data-wheel-ammo]')
    if (cat) cat.textContent = WEAPON_SECTORS[w.sectorIndex]?.label ?? ''
    if (name) name.textContent = w.name.toUpperCase()
    if (ammo) ammo.textContent = w.fireMode === 'melee' ? 'MELEE / UNLIMITED' : `${state.mag} / ${state.reserve}`

    const dmgBar = this.wheelEl.querySelector<HTMLElement>('[data-bar-dmg]')
    const rofBar = this.wheelEl.querySelector<HTMLElement>('[data-bar-rof]')
    const accBar = this.wheelEl.querySelector<HTMLElement>('[data-bar-acc]')
    if (dmgBar) dmgBar.style.width = `${Math.min(100, Math.round((w.damage * w.pellets) / 1.2))}%`
    if (rofBar) rofBar.style.width = `${Math.min(100, Math.round((1 / Math.max(0.08, w.fireInterval)) * 8.5))}%`
    if (accBar) accBar.style.width = `${Math.max(12, Math.min(100, Math.round(100 - w.baseSpread * 900)))}%`

    const variantsWrap = this.wheelEl.querySelector<HTMLElement>('[data-wheel-variants]')
    if (variantsWrap) {
      const list = WEAPON_CATALOG.filter(item => item.sectorIndex === w.sectorIndex)
      variantsWrap.innerHTML = list
        .map(item => `<button type="button" class="vbn-wheel-chip${item.id === w.id ? ' is-selected' : ''}" data-wheel-variant="${item.id}">${item.shortName}</button>`)
        .join('')
    }

    const attsWrap = this.wheelEl.querySelector<HTMLElement>('[data-wheel-atts]')
    if (attsWrap) {
      if (w.supportsAttachments.length === 0) {
        attsWrap.innerHTML = '<span class="vbn-wheel-noatt">NO MOD SLOTS</span>'
      } else {
        attsWrap.innerHTML = w.supportsAttachments
          .map(att => {
            const on = state.attachments.includes(att)
            return `<button type="button" class="vbn-wheel-att${on ? ' is-on' : ''}" data-wheel-att="${att}">${on ? '✓ ' : '+ '}${ATTACHMENT_LABELS[att]}</button>`
          })
          .join('')
      }
    }
  }

  private syncStats(rpg: RpgHudState, homieCount: number): void {
    const tierEl = this.statsEl.querySelector<HTMLElement>('[data-sa-tier]')
    const homiesEl = this.statsEl.querySelector<HTMLElement>('[data-sa-homies]')
    if (tierEl) tierEl.textContent = `WEAPON: ${rpg.weaponTier}`
    if (homiesEl) homiesEl.textContent = `SQUAD: ${homieCount} / ${rpg.maxHomies}`

    const values: Record<string, number> = {
      respect: rpg.respect,
      stamina: rpg.staminaSkill,
      muscle: rpg.muscle,
      fat: rpg.fat,
      hunger: rpg.hunger,
      weaponSkill: rpg.weaponSkill,
      drivingSkill: rpg.drivingSkill,
    }
    for (const [k, v] of Object.entries(values)) {
      const txt = this.statsEl.querySelector<HTMLElement>(`[data-sa-val="${k}"]`)
      const fill = this.statsEl.querySelector<HTMLElement>(`[data-sa-fill="${k}"]`)
      if (txt) txt.textContent = `${Math.round(v)}%`
      if (fill) fill.style.width = `${Math.max(0, Math.min(100, v))}%`
    }
  }
}
