export type LoadingStage = {
  percent: number
  label: string
  detail: string
}

const SLIDES = [
  {
    kicker: 'VICE BAY · DOWNTOWN CORRIDOR',
    title: 'RICO VALDEZ',
    subtitle: 'HEAT IS PERSONAL',
    accent: '#ff4b98',
    cardBg: 'linear-gradient(135deg, #1b1026 0%, #0d1b28 52%, #1d1221 100%)',
    tip: 'HOLD [TAB] FOR TACTICAL SLOW-MO WEAPON WHEEL · PRESS [X] TO CONCEAL WEAPONS',
  },
  {
    kicker: 'PORT VICE · AFTER HOURS',
    title: 'HEAVY METAL',
    subtitle: '4-WHEEL SUSPENSION & SOFT-BODY DEFORMATION',
    accent: '#77e6e7',
    cardBg: 'linear-gradient(135deg, #0b1c24 0%, #162834 55%, #0a121b 100%)',
    tip: 'HOLD [W] TO CRANK A STALLED ENGINE · HIT PAY \'N\' SPRAY ($150) FOR NEW PLATES',
  },
  {
    kicker: 'LIBERTY DISPATCH · CODE 3',
    title: 'NO FACE, NO CASE',
    subtitle: 'WITNESS 911 REPORTING & APB RECOGNITION',
    accent: '#f6d66d',
    cardBg: 'linear-gradient(135deg, #211a0c 0%, #141923 55%, #0c1018 100%)',
    tip: 'PRESS [V] FOR BANDANA MASK · PRESS [Q] TO SNAP TO WALL OR CAR DOOR COVER',
  },
  {
    kicker: 'WHIZ WIRELESS · BADGER IV',
    title: 'ROMAN & JACOB',
    subtitle: 'PLAY WITH ANY CONTROLLER, KEYBOARD, OR TOUCH',
    accent: '#62f4b8',
    cardBg: 'linear-gradient(135deg, #0d211b 0%, #101b24 55%, #091116 100%)',
    tip: 'CONTROLLERS: RT FIRE · LT AIM · RB WHEEL · Y CAR/USE  |  MOBILE: LEFT STICK MOVE · RIGHT SWIPE LOOK',
  },
] as const

/**
 * Animated GTA IV / GTA VI style loading screen with parallax neon skyline,
 * sweeping helicopter searchlight, rotating character/city cards, live stage bar,
 * and automatic fade-out straight into gameplay.
 */
export class LoadingScreen {
  readonly element: HTMLElement
  private slideIdx = 0
  private progress = 0
  private targetProgress = 6
  private rafId = 0
  private slideTimer = 0
  private lastTick = performance.now()
  private dismissed = false

  constructor(private readonly host: HTMLElement) {
    this.element = document.createElement('section')
    this.element.className = 'vbn-loader'
    this.element.setAttribute('aria-label', 'Loading Vice Bay Nights')
    this.element.innerHTML = this.buildMarkup()
    this.host.append(this.element)
    this.applySlide(0)
    this.startAnimationLoop()
  }

  setStage(stage: LoadingStage): void {
    this.targetProgress = Math.max(this.targetProgress, Math.min(100, stage.percent))
    const labelEl = this.element.querySelector<HTMLElement>('[data-load-label]')
    const detailEl = this.element.querySelector<HTMLElement>('[data-load-detail]')
    if (labelEl) labelEl.textContent = stage.label
    if (detailEl) detailEl.textContent = stage.detail
  }

  /** Smoothly animate progress bar up to current target and wait until visually caught up. */
  async finishAndEnter(): Promise<void> {
    this.setStage({
      percent: 100,
      label: 'DROPPING INTO VICE BAY',
      detail: 'All systems online — welcome to the streets.',
    })
    await new Promise<void>(resolve => {
      const check = () => {
        if (this.progress >= 99.4) {
          resolve()
          return
        }
        requestAnimationFrame(check)
      }
      check()
    })
    this.dismissed = true
    cancelAnimationFrame(this.rafId)
    this.element.classList.add('is-done')
    await new Promise<void>(resolve => window.setTimeout(resolve, 440))
    this.element.remove()
  }

  private startAnimationLoop(): void {
    const tick = (now: number) => {
      if (this.dismissed) return
      const dt = Math.min(0.08, (now - this.lastTick) / 1000)
      this.lastTick = now

      const step = Math.max(18, (this.targetProgress - this.progress) * 4.2) * dt
      this.progress = Math.min(this.targetProgress, this.progress + step)

      const fill = this.element.querySelector<HTMLElement>('[data-load-fill]')
      const pct = this.element.querySelector<HTMLElement>('[data-load-pct]')
      if (fill) fill.style.width = `${this.progress.toFixed(1)}%`
      if (pct) pct.textContent = `${Math.round(this.progress)}%`

      this.slideTimer += dt
      if (this.slideTimer >= 2.2) {
        this.slideTimer = 0
        this.slideIdx = (this.slideIdx + 1) % SLIDES.length
        this.applySlide(this.slideIdx)
      }

      this.rafId = requestAnimationFrame(tick)
    }
    this.rafId = requestAnimationFrame(tick)
  }

  private applySlide(index: number): void {
    const slide = SLIDES[index]
    const stage = this.element.querySelector<HTMLElement>('[data-load-backdrop]')
    const kicker = this.element.querySelector<HTMLElement>('[data-load-kicker]')
    const title = this.element.querySelector<HTMLElement>('[data-load-title]')
    const sub = this.element.querySelector<HTMLElement>('[data-load-sub]')
    const tip = this.element.querySelector<HTMLElement>('[data-load-tip]')
    if (stage) stage.style.background = slide.cardBg
    if (kicker) {
      kicker.textContent = slide.kicker
      kicker.style.color = slide.accent
    }
    if (title) title.textContent = slide.title
    if (sub) sub.textContent = slide.subtitle
    if (tip) tip.textContent = slide.tip
    this.element.style.setProperty('--load-accent', slide.accent)
  }

  private buildMarkup(): string {
    return `
      <div class="vbn-loader-backdrop" data-load-backdrop></div>
      <svg class="vbn-loader-skyline" viewBox="0 0 1200 420" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
        <defs>
          <linearGradient id="vbnBeam" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#9beeff" stop-opacity="0.34"/>
            <stop offset="100%" stop-color="#9beeff" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <g class="vbn-loader-beam">
          <polygon points="820,40 620,420 980,420" fill="url(#vbnBeam)"/>
        </g>
        <g class="vbn-loader-city-far" fill="#0d1420">
          <rect x="0" y="210" width="90" height="210"/><rect x="105" y="160" width="75" height="260"/>
          <rect x="200" y="130" width="95" height="290"/><rect x="315" y="185" width="80" height="235"/>
          <rect x="420" y="95" width="110" height="325"/><rect x="550" y="155" width="90" height="265"/>
          <rect x="665" y="120" width="105" height="300"/><rect x="795" y="170" width="85" height="250"/>
          <rect x="905" y="105" width="120" height="315"/><rect x="1050" y="165" width="150" height="255"/>
        </g>
        <g class="vbn-loader-city-near" fill="#070b12">
          <rect x="35" y="245" width="110" height="175"/><rect x="170" y="195" width="95" height="225"/>
          <rect x="295" y="220" width="120" height="200"/><rect x="465" y="170" width="105" height="250"/>
          <rect x="615" y="215" width="115" height="205"/><rect x="765" y="180" width="100" height="240"/>
          <rect x="920" y="205" width="130" height="215"/><rect x="1080" y="235" width="120" height="185"/>
        </g>
        <g class="vbn-loader-neon">
          <rect x="215" y="148" width="65" height="4" fill="#ff4b98"/>
          <rect x="436" y="116" width="78" height="4" fill="#77e6e7"/>
          <rect x="680" y="138" width="70" height="4" fill="#f6d66d"/>
          <rect x="924" y="124" width="82" height="4" fill="#ff4b98"/>
        </g>
      </svg>
      <div class="vbn-loader-grid" aria-hidden="true"></div>

      <header class="vbn-loader-top">
        <div class="vbn-top-brand"><span class="vbn-mark">V<span>B</span></span><span>VICE BAY<br><small>NIGHTS</small></span></div>
        <div class="vbn-loader-badge"><span class="vbn-live-dot"></span><span>STREAMING CITY WORLD</span></div>
      </header>

      <div class="vbn-loader-center">
        <p class="vbn-loader-kicker" data-load-kicker>VICE BAY · DOWNTOWN CORRIDOR</p>
        <h1 class="vbn-loader-title" data-load-title>RICO VALDEZ</h1>
        <p class="vbn-loader-sub" data-load-sub>HEAT IS PERSONAL</p>
      </div>

      <footer class="vbn-loader-foot">
        <div class="vbn-loader-tip-box">
          <span>FIELD INTEL</span>
          <strong data-load-tip>HOLD [TAB] FOR TACTICAL SLOW-MO WEAPON WHEEL</strong>
        </div>
        <div class="vbn-loader-status">
          <div class="vbn-loader-meta">
            <span class="vbn-loader-spinner" aria-hidden="true"></span>
            <div>
              <strong data-load-label>INITIALIZING RENDERER</strong>
              <small data-load-detail>Preparing Vice Bay lighting &amp; atmosphere…</small>
            </div>
            <em data-load-pct>0%</em>
          </div>
          <div class="vbn-loader-track"><i data-load-fill></i></div>
        </div>
      </footer>
    `
  }
}
