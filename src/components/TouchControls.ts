import type { Action, Input } from '../engine/input'

export type TouchModePreference = 'auto' | 'on' | 'off'

export type TouchHudContext = {
  visible: boolean
  inVehicle: boolean
  inTaxi: boolean
  nearVehicleLabel: string
  interactLabel: string
  holstered: boolean
  masked: boolean
  inCover: boolean
  aiming: boolean
  wheelOpen: boolean
  phoneOpen: boolean
}

export type TouchControlsCallbacks = {
  onToggleWheel: () => void
  onInteractOrVehicle: () => void
  onEnterExitVehicle: () => void
  onTogglePhone: () => void
  onToggleCover: () => void
  onToggleMask: () => void
  onToggleStats: () => void
  onRecruit: () => void
  onSkipTaxi: () => void
}

/**
 * Multi-touch virtual controller overlay for mobile & tablets.
 * Tracks independent `pointerId` captures so left-thumb movement/steering,
 * right-side swipe look, and action buttons (including hold-and-drag Fire) work simultaneously.
 */
export class TouchControls {
  readonly element: HTMLElement
  preference: TouchModePreference = 'auto'
  private stickZone: HTMLElement
  private stickRing: HTMLElement
  private stickKnob: HTMLElement
  private lookPad: HTMLElement
  private footCluster: HTMLElement
  private vehicleCluster: HTMLElement
  private taxiCluster: HTMLElement
  private quickBar: HTMLElement
  private contextBtn: HTMLButtonElement
  private carBtn: HTMLButtonElement
  private aimBtn: HTMLButtonElement
  private coverBtn: HTMLButtonElement
  private maskBtn: HTMLButtonElement

  private stickPointerId: number | null = null
  private stickOrigin = { x: 0, y: 0 }
  private stickVec = { x: 0, y: 0 }
  private lookPointerId: number | null = null
  private lookLast = { x: 0, y: 0 }
  private pedalThrottle = 0
  private touchSeen = false

  constructor(
    parent: HTMLElement,
    private readonly input: Input,
    private readonly callbacks: TouchControlsCallbacks,
  ) {
    this.touchSeen = input.isTouchDevice
    this.element = document.createElement('div')
    this.element.className = 'vbn-touch'
    this.element.hidden = true
    this.element.innerHTML = this.template()
    parent.append(this.element)

    this.stickZone = this.element.querySelector<HTMLElement>('[data-touch-stick-zone]')!
    this.stickRing = this.element.querySelector<HTMLElement>('[data-touch-ring]')!
    this.stickKnob = this.element.querySelector<HTMLElement>('[data-touch-knob]')!
    this.lookPad = this.element.querySelector<HTMLElement>('[data-touch-look]')!
    this.footCluster = this.element.querySelector<HTMLElement>('[data-touch-foot]')!
    this.vehicleCluster = this.element.querySelector<HTMLElement>('[data-touch-vehicle]')!
    this.taxiCluster = this.element.querySelector<HTMLElement>('[data-touch-taxi]')!
    this.quickBar = this.element.querySelector<HTMLElement>('[data-touch-quick]')!
    this.contextBtn = this.element.querySelector<HTMLButtonElement>('[data-touch-context]')!
    this.carBtn = this.element.querySelector<HTMLButtonElement>('[data-touch-car]')!
    this.aimBtn = this.element.querySelector<HTMLButtonElement>('[data-touch-action="aim"]')!
    this.coverBtn = this.element.querySelector<HTMLButtonElement>('[data-touch-trigger="cover"]')!
    this.maskBtn = this.element.querySelector<HTMLButtonElement>('[data-touch-trigger="mask"]')!

    this.bindStickEvents()
    this.bindLookEvents()
    this.bindButtonEvents()
    window.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch') this.touchSeen = true
    }, { passive: true })
    window.addEventListener('touchstart', () => {
      this.touchSeen = true
    }, { passive: true })
  }

  get active(): boolean {
    if (this.preference === 'on') return true
    if (this.preference === 'off') return false
    return this.touchSeen || this.input.method === 'touch'
  }

  cyclePreference(): TouchModePreference {
    const order: TouchModePreference[] = ['auto', 'on', 'off']
    this.preference = order[(order.indexOf(this.preference) + 1) % order.length]
    if (!this.active) this.releaseAll()
    return this.preference
  }

  releaseAll(): void {
    this.stickPointerId = null
    this.lookPointerId = null
    this.stickVec.x = 0
    this.stickVec.y = 0
    this.pedalThrottle = 0
    this.input.setTouchMove(0, 0)
    const actions: Action[] = ['shoot', 'aim', 'jump', 'crouch', 'sprint', 'reload', 'vehicle', 'interact']
    for (const a of actions) this.input.setTouchButton(a, false)
    this.stickRing.classList.remove('is-active')
    this.stickKnob.style.transform = 'translate(-50%, -50%)'
    this.element.querySelectorAll('.is-down').forEach(el => el.classList.remove('is-down'))
  }

  update(ctx: TouchHudContext): void {
    const show = ctx.visible && this.active && !ctx.phoneOpen && !ctx.wheelOpen
    this.element.hidden = !show
    document.body.classList.toggle('has-mobile-touch', this.active && ctx.visible)
    if (!show) {
      if (this.stickPointerId !== null || this.lookPointerId !== null) this.releaseAll()
      return
    }

    this.footCluster.hidden = ctx.inVehicle || ctx.inTaxi
    this.vehicleCluster.hidden = !ctx.inVehicle || ctx.inTaxi
    this.taxiCluster.hidden = !ctx.inTaxi
    this.quickBar.hidden = ctx.inTaxi

    this.aimBtn.classList.toggle('is-toggled', ctx.aiming)
    this.coverBtn.classList.toggle('is-toggled', ctx.inCover)
    this.maskBtn.classList.toggle('is-toggled', ctx.masked)

    if (!ctx.inVehicle && !ctx.inTaxi) {
      const hasPrompt = Boolean(ctx.interactLabel)
      this.contextBtn.hidden = !hasPrompt
      if (hasPrompt) this.contextBtn.textContent = ctx.interactLabel

      const hasCar = Boolean(ctx.nearVehicleLabel)
      this.carBtn.hidden = !hasCar
      if (hasCar) this.carBtn.textContent = ctx.nearVehicleLabel
    } else if (ctx.inVehicle) {
      const hasSpray = Boolean(ctx.interactLabel)
      const sprayBtn = this.vehicleCluster.querySelector<HTMLButtonElement>('[data-touch-trigger="interact"]')
      if (sprayBtn) {
        sprayBtn.hidden = !hasSpray
        if (hasSpray) sprayBtn.textContent = ctx.interactLabel
      }
    }
  }

  private bindStickEvents(): void {
    const maxRadius = 46
    const updateStick = (clientX: number, clientY: number) => {
      const dx = clientX - this.stickOrigin.x
      const dy = clientY - this.stickOrigin.y
      const dist = Math.hypot(dx, dy)
      const clamped = Math.min(maxRadius, dist)
      const angle = Math.atan2(dy, dx)
      const kx = Math.cos(angle) * clamped
      const ky = Math.sin(angle) * clamped
      this.stickKnob.style.transform = `translate(calc(-50% + ${kx.toFixed(1)}px), calc(-50% + ${ky.toFixed(1)}px))`

      const norm = clamped / maxRadius
      if (norm < 0.12) {
        this.stickVec.x = 0
        this.stickVec.y = 0
        this.input.setTouchButton('sprint', false)
      } else {
        this.stickVec.x = kx / maxRadius
        this.stickVec.y = -ky / maxRadius
        this.input.setTouchButton('sprint', norm > 0.86)
      }
      this.syncMove()
    }

    this.stickZone.addEventListener('pointerdown', e => {
      if (this.stickPointerId !== null) return
      e.preventDefault()
      this.stickPointerId = e.pointerId
      this.stickZone.setPointerCapture?.(e.pointerId)
      const rect = this.stickRing.getBoundingClientRect()
      this.stickOrigin = { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.5 }
      this.stickRing.classList.add('is-active')
      updateStick(e.clientX, e.clientY)
    })

    this.stickZone.addEventListener('pointermove', e => {
      if (e.pointerId !== this.stickPointerId) return
      e.preventDefault()
      updateStick(e.clientX, e.clientY)
    })

    const endStick = (e: PointerEvent) => {
      if (e.pointerId !== this.stickPointerId) return
      this.stickPointerId = null
      this.stickVec.x = 0
      this.stickVec.y = 0
      this.input.setTouchButton('sprint', false)
      this.syncMove()
      this.stickRing.classList.remove('is-active')
      this.stickKnob.style.transform = 'translate(-50%, -50%)'
    }
    this.stickZone.addEventListener('pointerup', endStick)
    this.stickZone.addEventListener('pointercancel', endStick)
  }

  private bindLookEvents(): void {
    this.lookPad.addEventListener('pointerdown', e => {
      if (this.lookPointerId !== null) return
      e.preventDefault()
      this.lookPointerId = e.pointerId
      this.lookLast = { x: e.clientX, y: e.clientY }
      this.lookPad.setPointerCapture?.(e.pointerId)
    })
    this.lookPad.addEventListener('pointermove', e => {
      if (e.pointerId !== this.lookPointerId) return
      e.preventDefault()
      const dx = e.clientX - this.lookLast.x
      const dy = e.clientY - this.lookLast.y
      this.lookLast = { x: e.clientX, y: e.clientY }
      this.input.addTouchLook(dx * 1.15, dy * 1.15)
    })
    const endLook = (e: PointerEvent) => {
      if (e.pointerId !== this.lookPointerId) return
      this.lookPointerId = null
    }
    this.lookPad.addEventListener('pointerup', endLook)
    this.lookPad.addEventListener('pointercancel', endLook)
  }

  private bindButtonEvents(): void {
    // Holdable action buttons (shoot supports drag-to-aim while firing!)
    const holdButtons = this.element.querySelectorAll<HTMLButtonElement>('[data-touch-action]')
    holdButtons.forEach(btn => {
      const action = btn.dataset.touchAction as Action
      let activeId: number | null = null
      let lastPt = { x: 0, y: 0 }
      btn.addEventListener('pointerdown', e => {
        e.preventDefault()
        e.stopPropagation()
        activeId = e.pointerId
        lastPt = { x: e.clientX, y: e.clientY }
        btn.setPointerCapture?.(e.pointerId)
        btn.classList.add('is-down')
        this.input.setTouchButton(action, true)
      })
      if (action === 'shoot') {
        btn.addEventListener('pointermove', e => {
          if (e.pointerId !== activeId) return
          const dx = e.clientX - lastPt.x
          const dy = e.clientY - lastPt.y
          lastPt = { x: e.clientX, y: e.clientY }
          this.input.addTouchLook(dx * 0.95, dy * 0.95)
        })
      }
      const release = (e: PointerEvent) => {
        if (e.pointerId !== activeId) return
        activeId = null
        btn.classList.remove('is-down')
        this.input.setTouchButton(action, false)
      }
      btn.addEventListener('pointerup', release)
      btn.addEventListener('pointercancel', release)
    })

    // Vehicle throttle / brake pedals
    this.element.querySelectorAll<HTMLButtonElement>('[data-touch-pedal]').forEach(btn => {
      const dir = btn.dataset.touchPedal === 'gas' ? 1 : -1
      let activeId: number | null = null
      btn.addEventListener('pointerdown', e => {
        e.preventDefault()
        e.stopPropagation()
        activeId = e.pointerId
        btn.setPointerCapture?.(e.pointerId)
        btn.classList.add('is-down')
        this.pedalThrottle = dir
        this.syncMove()
      })
      const release = (e: PointerEvent) => {
        if (e.pointerId !== activeId) return
        activeId = null
        btn.classList.remove('is-down')
        if (this.pedalThrottle === dir) {
          this.pedalThrottle = 0
          this.syncMove()
        }
      }
      btn.addEventListener('pointerup', release)
      btn.addEventListener('pointercancel', release)
    })

    // Single-tap triggers
    this.element.querySelectorAll<HTMLButtonElement>('[data-touch-trigger]').forEach(btn => {
      btn.addEventListener('pointerdown', e => {
        e.preventDefault()
        e.stopPropagation()
        btn.classList.add('is-down')
        switch (btn.dataset.touchTrigger) {
          case 'wheel': this.callbacks.onToggleWheel(); break
          case 'interact': this.callbacks.onInteractOrVehicle(); break
          case 'vehicle': this.callbacks.onEnterExitVehicle(); break
          case 'phone': this.callbacks.onTogglePhone(); break
          case 'cover': this.callbacks.onToggleCover(); break
          case 'mask': this.callbacks.onToggleMask(); break
          case 'stats': this.callbacks.onToggleStats(); break
          case 'recruit': this.callbacks.onRecruit(); break
          case 'skip-taxi': this.callbacks.onSkipTaxi(); break
        }
      })
      const unpress = () => btn.classList.remove('is-down')
      btn.addEventListener('pointerup', unpress)
      btn.addEventListener('pointercancel', unpress)
    })
  }

  private syncMove(): void {
    const x = this.stickVec.x
    const y = this.pedalThrottle !== 0 ? this.pedalThrottle : this.stickVec.y
    this.input.setTouchMove(x, y)
  }

  private template(): string {
    return `
      <div class="vbn-touch-look" data-touch-look aria-hidden="true"></div>
      <div class="vbn-touch-stick-zone" data-touch-stick-zone>
        <div class="vbn-touch-ring" data-touch-ring>
          <span class="vbn-touch-knob" data-touch-knob></span>
        </div>
      </div>

      <div class="vbn-touch-quick" data-touch-quick>
        <button type="button" class="vbn-tbtn is-util" data-touch-trigger="wheel">WHEEL</button>
        <button type="button" class="vbn-tbtn is-util" data-touch-trigger="mask">MASK</button>
        <button type="button" class="vbn-tbtn is-util" data-touch-trigger="stats">STATS</button>
        <button type="button" class="vbn-tbtn is-util" data-touch-trigger="recruit">CREW</button>
        <button type="button" class="vbn-tbtn is-util" data-touch-trigger="phone">PHONE</button>
      </div>

      <div class="vbn-touch-foot" data-touch-foot>
        <div class="vbn-touch-ctx-row">
          <button type="button" class="vbn-tbtn is-ctx" data-touch-trigger="interact" data-touch-context hidden>INTERACT</button>
          <button type="button" class="vbn-tbtn is-ctx is-car" data-touch-trigger="vehicle" data-touch-car hidden>ENTER CAR</button>
        </div>
        <div class="vbn-touch-arc">
          <button type="button" class="vbn-tbtn is-sec" data-touch-action="aim">AIM</button>
          <button type="button" class="vbn-tbtn is-sec" data-touch-trigger="cover">COVER</button>
          <button type="button" class="vbn-tbtn is-sec" data-touch-action="reload">RLD</button>
          <button type="button" class="vbn-tbtn is-sec" data-touch-action="crouch">DUCK</button>
          <button type="button" class="vbn-tbtn is-sec" data-touch-action="jump">JUMP</button>
          <button type="button" class="vbn-tbtn is-fire" data-touch-action="shoot">FIRE</button>
        </div>
      </div>

      <div class="vbn-touch-vehicle" data-touch-vehicle hidden>
        <div class="vbn-touch-ctx-row">
          <button type="button" class="vbn-tbtn is-ctx" data-touch-trigger="interact" hidden>SPRAY</button>
          <button type="button" class="vbn-tbtn is-ctx is-car" data-touch-trigger="vehicle">EXIT</button>
        </div>
        <div class="vbn-touch-pedals">
          <button type="button" class="vbn-tbtn is-sec" data-touch-action="jump">DRIFT</button>
          <button type="button" class="vbn-tbtn is-brake" data-touch-pedal="brake">BRAKE</button>
          <button type="button" class="vbn-tbtn is-gas" data-touch-pedal="gas">GAS</button>
        </div>
      </div>

      <div class="vbn-touch-taxi" data-touch-taxi hidden>
        <button type="button" class="vbn-tbtn is-gas" data-touch-trigger="skip-taxi">SKIP ($10)</button>
        <button type="button" class="vbn-tbtn is-car" data-touch-trigger="vehicle">EXIT CAB</button>
      </div>
    `
  }
}
