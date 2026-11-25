/**
 * Unified input: keyboard + mouse (pointer lock), every standard/non-standard gamepad, and mobile multi-touch.
 * Gameplay reads `move`, `look`, `triggers`, `sticks`, `menuNav` and `pressed()/held()/consume()`.
 *
 * Call `endFrame()` once per rendered frame after gameplay consumed edge-triggered presses.
 */
export type Action =
  | 'jump'
  | 'sprint'
  | 'dash'
  | 'pause'
  | 'confirm'
  | 'back'
  | 'interact'
  | 'vehicle'
  | 'shoot'
  | 'crouch'
  | 'map'
  | 'reload'
  | 'weather'
  | 'wheel'
  | 'stats'
  | 'recruit'
  | 'attach'
  | 'aim'
  | 'cover'
  | 'phone'
  | 'mask'
  | 'holster'
  | 'inspect'

export type InputMethod = 'keyboard' | 'gamepad' | 'touch'

const KEY_BINDINGS: Record<Action, string[]> = {
  jump: ['Space'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  dash: ['KeyF'],
  pause: ['Escape'],
  confirm: ['Enter', 'NumpadEnter'],
  // Menus handle Escape/Backspace themselves via DOM keydown; `back` is the gamepad B button.
  back: [],
  interact: ['KeyE'],
  vehicle: ['KeyF'],
  shoot: [],
  crouch: ['KeyC', 'ControlLeft'],
  map: ['KeyM'],
  reload: ['KeyR'],
  weather: ['KeyT'],
  wheel: ['Tab'],
  stats: ['KeyJ'],
  recruit: ['KeyG', 'KeyH'],
  attach: ['KeyB'],
  aim: [],
  cover: ['KeyQ'],
  phone: ['KeyP'],
  mask: ['KeyV'],
  holster: ['KeyX'],
  inspect: ['AltLeft'],
}

const MOVE_KEYS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
}

// Standard gamepad mapping:
// A/Cross=0, B/Circle=1, X/Square=2, Y/Triangle=3,
// LB/L1=4, RB/R1=5, LT/L2=6, RT/R2=7, Back/Select/View=8, Start/Options=9,
// L3=10, R3=11, DPad-Up=12, DPad-Down=13, DPad-Left=14, DPad-Right=15, Guide/PS=16, Touchpad=17
const PAD_BINDINGS: Record<Action, number[]> = {
  jump: [0],
  sprint: [4, 10],
  dash: [2, 5],
  pause: [9],
  confirm: [0],
  back: [1],
  interact: [3],
  vehicle: [2, 3],
  shoot: [7],
  crouch: [1],
  map: [8],
  reload: [2],
  weather: [],
  wheel: [5, 11],
  stats: [],
  recruit: [],
  attach: [],
  aim: [6],
  cover: [10],
  phone: [16, 17],
  mask: [],
  holster: [],
  inspect: [],
}

function clamp1(v: number): number {
  return Math.max(-1, Math.min(1, v))
}

function deadzone(v: number, dz = 0.18): number {
  return Math.abs(v) < dz ? 0 : v
}

function detectTouchCapability(): boolean {
  if (typeof window === 'undefined') return false
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
  const points = typeof navigator !== 'undefined' ? (navigator.maxTouchPoints ?? 0) : 0
  return coarse || points > 0 || 'ontouchstart' in window
}

function sampleGamepad(pad: Gamepad): {
  lx: number
  ly: number
  rx: number
  ry: number
  lt: number
  rt: number
  dx: number
  dy: number
  buttons: Array<{ pressed: boolean; value: number }>
} {
  const axes = pad.axes ?? []
  const rawBtns = pad.buttons ?? []
  const isStandard = pad.mapping === 'standard' || pad.mapping === ''
  const buttons = rawBtns.map(b => ({
    pressed: Boolean(b?.pressed) || (b?.value ?? 0) > 0.45,
    value: b?.value ?? (b?.pressed ? 1 : 0),
  }))

  let lx = deadzone(axes[0] ?? 0)
  let ly = deadzone(axes[1] ?? 0)
  let rx = deadzone(axes[2] ?? 0)
  let ry = deadzone(axes[3] ?? 0)
  let lt = buttons[6]?.value ?? 0
  let rt = buttons[7]?.value ?? 0

  // Many DirectInput / Linux / Android DualShock/DualSense & 3rd-party HID pads
  // expose triggers on axes[3]/axes[4] resting at -1 and right-stick Y on axes[5] (or axes[3]).
  if (!isStandard && axes.length >= 5) {
    const a3RestingNeg = Math.abs((axes[3] ?? 0) + 1) < 0.08
    const a4RestingNeg = Math.abs((axes[4] ?? 0) + 1) < 0.08
    if (axes.length >= 6 && (a3RestingNeg || a4RestingNeg || /dual|sony|wireless controller|ps4|ps5/i.test(pad.id))) {
      const candRy = deadzone(axes[5] ?? 0)
      const candTrigL = Math.max(0, Math.min(1, ((axes[3] ?? -1) + 1) * 0.5))
      const candTrigR = Math.max(0, Math.min(1, ((axes[4] ?? -1) + 1) * 0.5))
      if (Math.abs(candRy) <= 1) ry = candRy
      if (lt === 0 && candTrigL > 0.05) lt = candTrigL
      if (rt === 0 && candTrigR > 0.05) rt = candTrigR
    }
  }

  let dx = (buttons[15]?.pressed ? 1 : 0) - (buttons[14]?.pressed ? 1 : 0)
  let dy = (buttons[12]?.pressed ? 1 : 0) - (buttons[13]?.pressed ? 1 : 0)

  // Support HID Hat-switch D-pad on axes[9] when standard D-pad buttons 12-15 aren't present
  if (!isStandard && dx === 0 && dy === 0 && axes.length >= 10) {
    const hat = axes[9]
    if (hat !== undefined && Math.abs(hat) <= 1.05 && hat < 1.1) {
      // Standard USB HID hat encoding in [-1, 1] (~ -1 N, -0.43 E, 0.14 S, 0.71 W)
      if (Math.abs(hat + 1) < 0.18) dy = 1
      else if (Math.abs(hat + 0.71) < 0.18) { dy = 1; dx = 1 }
      else if (Math.abs(hat + 0.43) < 0.18) dx = 1
      else if (Math.abs(hat + 0.14) < 0.18) { dy = -1; dx = 1 }
      else if (Math.abs(hat - 0.14) < 0.18) dy = -1
      else if (Math.abs(hat - 0.43) < 0.18) { dy = -1; dx = -1 }
      else if (Math.abs(hat - 0.71) < 0.18) dx = -1
      else if (Math.abs(hat - 1.0) < 0.15) { dy = 1; dx = -1 }
    }
  }

  // Nintendo Switch Pro / Joy-Con face-button orientation keeps physical B=south / A=east,
  // while browsers usually map index 0=B(south) 1=A(east) — already aligns spatially with Xbox A/B!
  lx = clamp1(lx)
  ly = clamp1(ly)
  rx = clamp1(rx)
  ry = clamp1(ry)

  return { lx, ly, rx, ry, lt, rt, dx, dy, buttons }
}

export class Input {
  /** Movement intent in [-1, 1]: x = strafe right, y = forward. */
  readonly move = { x: 0, y: 0 }
  /** Camera look delta accumulated since the last `endFrame()` (radians-ish units, pre-sensitivity). */
  readonly look = { x: 0, y: 0 }
  /** Analog trigger values [0..1] for GTA-style gas/brake & trigger checks. */
  readonly triggers = { left: 0, right: 0 }
  /** Normalized live analog sticks for radial weapon wheels & UI navigation. */
  readonly sticks = { lx: 0, ly: 0, rx: 0, ry: 0 }
  /** Edge-triggered UI menu direction from gamepad D-pad / Left Stick. */
  readonly menuNav = { x: 0 as -1 | 0 | 1, y: 0 as -1 | 0 | 1 }

  method: InputMethod = detectTouchCapability() ? 'touch' : 'keyboard'
  readonly isTouchDevice = detectTouchCapability()
  /** Multiplies look deltas; settings screen writes it. */
  sensitivity = 1
  invertY = false
  padConnected = false
  padLabel = ''

  private keys = new Set<string>()
  private held_ = new Set<Action>()
  private pressed_ = new Set<Action>()
  private touchMove = { x: 0, y: 0 }
  private touchButtons = new Set<Action>()
  private padPrev: boolean[] = []
  private padIndex = -1
  private padId = ''
  private padRef: Gamepad | null = null
  private navRepeatTimer = 0
  private prevNavDir = { x: 0, y: 0 }
  private mouseFireHeld = false
  private mouseAimHeld = false
  private listeners: Array<() => void> = []

  constructor(private readonly canvas: HTMLCanvasElement) {
    const on = <K extends keyof WindowEventMap>(
      target: Window | HTMLElement,
      type: K,
      fn: (e: WindowEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, fn as EventListener, opts)
      this.listeners.push(() => target.removeEventListener(type, fn as EventListener, opts))
    }
    on(window, 'keydown', e => {
      if (e.repeat) return
      this.keys.add(e.code)
      this.method = 'keyboard'
      for (const [action, codes] of Object.entries(KEY_BINDINGS) as [Action, string[]][]) {
        if (codes.includes(e.code)) this.pressed_.add(action)
      }
      // Keep the page from scrolling or tabbing away while in game controls.
      const typing = (e.target as HTMLElement | null)?.matches?.('input, textarea')
      if (!typing && (e.code === 'Space' || e.code === 'Tab' || e.code.startsWith('Arrow'))) e.preventDefault()
    })
    on(window, 'keyup', e => this.keys.delete(e.code))
    on(window, 'blur', () => {
      this.keys.clear()
      this.touchButtons.clear()
      this.touchMove.x = 0
      this.touchMove.y = 0
      this.mouseFireHeld = false
      this.mouseAimHeld = false
    })
    on(window, 'gamepadconnected', e => {
      const gp = e.gamepad
      if (gp) {
        this.padIndex = gp.index
        this.padId = gp.id
        this.padPrev = []
        this.padConnected = true
        this.padLabel = gp.id
      }
    })
    on(window, 'gamepaddisconnected', e => {
      if (e.gamepad.index === this.padIndex) this.resetPad()
    })
    on(window, 'mousedown', e => {
      if (document.pointerLockElement === canvas) {
        if (e.button === 0) {
          this.pressed_.add('shoot')
          this.mouseFireHeld = true
        }
        if (e.button === 2) {
          this.pressed_.add('aim')
          this.mouseAimHeld = true
        }
      }
    })
    on(window, 'mouseup', e => {
      if (e.button === 0) this.mouseFireHeld = false
      if (e.button === 2) this.mouseAimHeld = false
    })
    on(window, 'mousemove', e => {
      if (document.pointerLockElement !== canvas) return
      this.look.x += e.movementX * 0.0022
      this.look.y += e.movementY * 0.0022
    })
  }

  /** Request pointer lock for mouse look (must be called from a user gesture on non-touch input). */
  lockPointer(): void {
    if (this.method === 'touch' || this.isTouchDevice) return
    if (document.pointerLockElement !== this.canvas) {
      this.canvas.requestPointerLock?.()?.catch?.(() => undefined)
    }
  }

  unlockPointer(): void {
    if (document.pointerLockElement) document.exitPointerLock()
  }

  /** Touch controls feed these from the on-screen joystick and buttons. */
  setTouchMove(x: number, y: number): void {
    this.method = 'touch'
    this.touchMove.x = x
    this.touchMove.y = y
  }

  addTouchLook(dx: number, dy: number): void {
    this.method = 'touch'
    this.look.x += dx * 0.006
    this.look.y += dy * 0.006
  }

  setTouchButton(action: Action, down: boolean): void {
    this.method = 'touch'
    if (down && !this.touchButtons.has(action)) this.pressed_.add(action)
    if (down) this.touchButtons.add(action)
    else this.touchButtons.delete(action)
  }

  /** Trigger dual-rumble haptic pulse on the active controller when supported. */
  padRumble(intensity = 0.5, durationMs = 110): void {
    if (this.method !== 'gamepad' || !this.padRef) return
    const actuator = (this.padRef as unknown as {
      vibrationActuator?: { playEffect?: (type: string, opts: Record<string, number>) => Promise<unknown> }
    }).vibrationActuator
    if (!actuator?.playEffect) return
    const strong = Math.max(0, Math.min(1, intensity))
    const weak = Math.max(0, Math.min(1, intensity * 0.7))
    void actuator.playEffect('dual-rumble', {
      startDelay: 0,
      duration: Math.max(30, Math.min(600, durationMs)),
      weakMagnitude: weak,
      strongMagnitude: strong,
    }).catch(() => undefined)
  }

  private resetPad(): void {
    this.padPrev = []
    this.padIndex = -1
    this.padId = ''
    this.padRef = null
    this.padConnected = false
    this.padLabel = ''
    this.triggers.left = 0
    this.triggers.right = 0
    this.sticks.lx = 0
    this.sticks.ly = 0
    this.sticks.rx = 0
    this.sticks.ry = 0
    this.menuNav.x = 0
    this.menuNav.y = 0
  }

  private pickActivePad(): Gamepad | undefined {
    const raw = navigator.getGamepads?.()
    if (!raw) return undefined
    const connected: Gamepad[] = []
    for (let i = 0; i < raw.length; i += 1) {
      const p = raw[i]
      if (p && p.connected) connected.push(p)
    }
    if (connected.length === 0) return undefined

    // Prefer whichever controller is actively receiving user input so secondary virtual/idle devices don't shadow a real pad.
    const active = connected.find(p => {
      const axesActive = p.axes?.some((a, idx) => idx < 4 && Math.abs(a) > 0.25)
      const btnActive = p.buttons?.some(b => b?.pressed || (b?.value ?? 0) > 0.45)
      return Boolean(axesActive || btnActive)
    })
    if (active) return active
    return connected.find(p => p.index === this.padIndex && p.id === this.padId) ?? connected[0]
  }

  /** Sample once per rendered frame; elapsed time scales continuous stick look only. */
  update(frameSeconds = 1 / 60): void {
    const k = (codes: string[]) => codes.some(code => this.keys.has(code))
    let x = (k(MOVE_KEYS.right) ? 1 : 0) - (k(MOVE_KEYS.left) ? 1 : 0)
    let y = (k(MOVE_KEYS.up) ? 1 : 0) - (k(MOVE_KEYS.down) ? 1 : 0)
    this.held_.clear()
    for (const [action, codes] of Object.entries(KEY_BINDINGS) as [Action, string[]][]) {
      if (k(codes)) this.held_.add(action)
    }
    if (this.mouseFireHeld) this.held_.add('shoot')
    if (this.mouseAimHeld) this.held_.add('aim')
    for (const action of this.touchButtons) this.held_.add(action)
    if (this.touchMove.x !== 0 || this.touchMove.y !== 0) {
      x = this.touchMove.x
      y = this.touchMove.y
    }

    this.menuNav.x = 0
    this.menuNav.y = 0
    const pad = this.pickActivePad()
    if (pad) {
      if (pad.index !== this.padIndex || pad.id !== this.padId) this.padPrev = []
      this.padIndex = pad.index
      this.padId = pad.id
      this.padRef = pad
      this.padConnected = true
      this.padLabel = pad.id

      const sampled = sampleGamepad(pad)
      this.sticks.lx = sampled.lx
      this.sticks.ly = -sampled.ly
      this.sticks.rx = sampled.rx
      this.sticks.ry = -sampled.ry
      this.triggers.left = sampled.lt
      this.triggers.right = sampled.rt

      const padActive =
        sampled.lx !== 0
        || sampled.ly !== 0
        || sampled.rx !== 0
        || sampled.ry !== 0
        || sampled.lt > 0.25
        || sampled.rt > 0.25
        || sampled.dx !== 0
        || sampled.dy !== 0
        || sampled.buttons.some(b => b.pressed)
      if (padActive) this.method = 'gamepad'

      if (sampled.lx !== 0 || sampled.ly !== 0 || sampled.dx !== 0 || sampled.dy !== 0) {
        x = sampled.dx || sampled.lx
        y = sampled.dy || -sampled.ly
      }

      // Menu cursor navigation from D-pad or Left Stick with smooth repeat debounce
      const navX: -1 | 0 | 1 = sampled.dx !== 0 ? (sampled.dx > 0 ? 1 : -1) : Math.abs(sampled.lx) > 0.55 ? (sampled.lx > 0 ? 1 : -1) : 0
      const rawNavY = sampled.dy !== 0 ? -sampled.dy : Math.abs(sampled.ly) > 0.55 ? (sampled.ly > 0 ? 1 : -1) : 0
      const navY: -1 | 0 | 1 = rawNavY === 0 ? 0 : rawNavY > 0 ? 1 : -1
      if (navX === 0 && navY === 0) {
        this.navRepeatTimer = 0
      } else if (navX !== this.prevNavDir.x || navY !== this.prevNavDir.y) {
        this.menuNav.x = navX
        this.menuNav.y = navY
        this.navRepeatTimer = 0.28
      } else {
        this.navRepeatTimer -= frameSeconds
        if (this.navRepeatTimer <= 0) {
          this.menuNav.x = navX
          this.menuNav.y = navY
          this.navRepeatTimer = 0.16
        }
      }
      this.prevNavDir.x = navX
      this.prevNavDir.y = navY

      // Preserve the 60 Hz turn rate at every render frequency.
      this.look.x += sampled.rx * 2.7 * frameSeconds
      this.look.y += sampled.ry * 2.7 * frameSeconds

      for (const [action, buttons] of Object.entries(PAD_BINDINGS) as [Action, number[]][]) {
        if (buttons.some(i => sampled.buttons[i]?.pressed)) this.held_.add(action)
        if (buttons.some(i => sampled.buttons[i]?.pressed && !this.padPrev[i])) this.pressed_.add(action)
      }
      // Analog trigger edges when non-standard axis triggers are pulled
      if (sampled.rt > 0.45 && !this.padPrev[7]) {
        this.held_.add('shoot')
        this.pressed_.add('shoot')
      }
      if (sampled.lt > 0.45 && !this.padPrev[6]) {
        this.held_.add('aim')
        this.pressed_.add('aim')
      }

      // Combo shortcuts on standard gamepads (LB + D-pad) so every PC key action works on controller:
      const lbHeld = Boolean(sampled.buttons[4]?.pressed)
      if (lbHeld) {
        if (sampled.buttons[12]?.pressed && !this.padPrev[12]) this.pressed_.add('phone')
        if (sampled.buttons[13]?.pressed && !this.padPrev[13]) this.pressed_.add('stats')
        if (sampled.buttons[14]?.pressed && !this.padPrev[14]) this.pressed_.add('holster')
        if (sampled.buttons[15]?.pressed && !this.padPrev[15]) this.pressed_.add('mask')
      }

      this.padPrev = sampled.buttons.map(b => b.pressed)
    } else {
      this.resetPad()
    }

    const len = Math.hypot(x, y)
    this.move.x = len > 1 ? x / len : x
    this.move.y = len > 1 ? y / len : y
  }

  held(action: Action): boolean {
    return this.held_.has(action)
  }

  /** True once per physical press. */
  pressed(action: Action): boolean {
    return this.pressed_.has(action)
  }

  /**
   * Read and clear a press. Use this inside fixed simulation steps: several steps can run in one
   * rendered frame, and a press must trigger exactly one jump/confirm.
   */
  consume(action: Action): boolean {
    return this.pressed_.delete(action)
  }

  /** Consume the look delta with sensitivity/invert applied. */
  takeLook(): { x: number; y: number } {
    const out = {
      x: this.look.x * this.sensitivity,
      y: this.look.y * this.sensitivity * (this.invertY ? -1 : 1),
    }
    this.look.x = 0
    this.look.y = 0
    return out
  }

  endFrame(): void {
    this.pressed_.clear()
  }

  dispose(): void {
    for (const off of this.listeners) off()
    this.listeners = []
  }
}
