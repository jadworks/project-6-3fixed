export type PhoneApp = 'home' | '911' | 'cab' | 'jacob' | 'social' | 'bank' | 'vehicle' | 'camera' | 'sms' | 'settings'
export type PhoneRingtone = 'classic' | 'chime' | 'silent'

export type SmsMessage = {
  id: string
  from: string
  time: string
  body: string
  unread: boolean
}

export type SmartphoneCallbacks = {
  onKeyBeep: () => void
  onCall911: (service: 'ambulance' | 'fire' | 'police') => void
  onCallCab: () => void
  onRideCab: (dest: 'objective' | 'safehouse' | 'respray') => void
  onSkipRide: (dest: 'objective' | 'safehouse' | 'respray') => void
  onCallJacob: (order: 'van' | 'armor' | 'ammo') => void
  onTakePhoto: () => void
  onToggleFilter: () => void
  onCycleWeather: () => void
  onCycleRingtone: () => PhoneRingtone
  onClose: () => void
  onSocialEvent?: (eventId: string) => void
  onDepositBank?: () => void
  onWithdrawBank?: () => void
  onRequestPersonalCar?: () => void
  onSwitchProtagonist?: () => void
}

export type SmartphoneState = {
  open: boolean
  time: string
  money: number
  bankBalance?: number
  uncleanedLoot?: number
  personalCarName?: string
  protagonist?: string
  district: string
  grittyFilter: boolean
  ringtone: PhoneRingtone
  weather: string
  cabActive: boolean
  jacobActive: boolean
  latestPhoto: string | null
  photoCount: number
  wanted?: number
  heatStatus?: string
  dispatchEta?: number
}

const DEFAULT_SMS: SmsMessage[] = [
  {
    id: 'sms-1',
    from: 'ELENA',
    time: '16:12',
    body: "Rico — keep your Badger phone handy. Call Roman for a cab or Jacob when heat gets thick.",
    unread: true,
  },
  {
    id: 'sms-2',
    from: 'ROMAN CAB',
    time: '16:14',
    body: "Cousin! Yellow cabs roll down the boulevard. Call me anytime or press E near a cab to ride.",
    unread: true,
  },
  {
    id: 'sms-3',
    from: 'LITTLE JACOB',
    time: '16:15',
    body: "Big man, ring me up for heavy iron & Kevlar delivery right to the curb, seen?",
    unread: false,
  },
]

export class SmartphoneHud {
  private readonly root: HTMLElement
  private app: PhoneApp = 'home'
  private selectedIndex = 0
  private sms: SmsMessage[] = [...DEFAULT_SMS]
  private ringPulseTimer = 0
  private lastState: SmartphoneState = {
    open: false,
    time: '16:15',
    money: 1500,
    district: 'VICE BAY',
    grittyFilter: true,
    ringtone: 'classic',
    weather: 'overcast',
    cabActive: false,
    jacobActive: false,
    latestPhoto: null,
    photoCount: 0,
    wanted: 0,
    heatStatus: 'CLEAR — NO ACTIVE APB',
    dispatchEta: 0,
  }

  constructor(parent: HTMLElement, private readonly callbacks: SmartphoneCallbacks) {
    this.root = document.createElement('aside')
    this.root.className = 'vbn-phone'
    this.root.hidden = true
    this.root.setAttribute('aria-label', 'Badger 2008 Smartphone')
    parent.append(this.root)
    this.root.addEventListener('click', ev => this.onClick(ev))
    this.render()
  }

  getUnreadCount(): number {
    return this.sms.filter(m => m.unread).length
  }

  addSms(from: string, body: string, time: string): void {
    this.sms.unshift({
      id: `sms-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      from: from.toUpperCase(),
      time,
      body,
      unread: true,
    })
    if (this.sms.length > 8) this.sms.length = 8
    this.ringPulseTimer = 2.4
    this.render()
  }

  moveSelection(delta: -1 | 1): void {
    const buttons = this.getNavButtons()
    if (buttons.length === 0) return
    this.selectedIndex = (this.selectedIndex + delta + buttons.length) % buttons.length
    this.callbacks.onKeyBeep()
    this.syncSelectionHighlight(buttons)
  }

  activateSelected(): void {
    const buttons = this.getNavButtons()
    const target = buttons[this.selectedIndex] ?? buttons[0]
    if (!target) return
    this.triggerAction(target.dataset.phoneAct)
  }

  goBack(): void {
    if (this.app !== 'home') {
      this.setApp('home')
    } else {
      this.callbacks.onKeyBeep()
      this.callbacks.onClose()
    }
  }

  private formatScannerLine(state: SmartphoneState): string {
    const wanted = Math.max(0, Math.floor(state.wanted ?? 0))
    if (wanted <= 0) {
      return `SCANNER · CLEAR (${state.district.toUpperCase()})`
    }
    const eta = state.dispatchEta ?? 0
    if (eta > 0) {
      return `SCANNER ★${wanted} · DISPATCH ${eta.toFixed(1)}s`
    }
    return `SCANNER ★${wanted} · ${(state.heatStatus ?? 'ACTIVE APB').slice(0, 22)}`
  }

  update(dt: number, state: SmartphoneState): void {
    this.lastState = state
    this.root.hidden = !state.open
    if (this.ringPulseTimer > 0) {
      this.ringPulseTimer = Math.max(0, this.ringPulseTimer - dt)
      this.root.classList.toggle('is-vibrating', this.ringPulseTimer > 0)
    } else {
      this.root.classList.remove('is-vibrating')
    }
    if (!state.open) return
    const clock = this.root.querySelector<HTMLElement>('[data-phone-clock]')
    if (clock) clock.textContent = state.time
    const moneyEl = this.root.querySelector<HTMLElement>('[data-phone-money]')
    if (moneyEl) moneyEl.textContent = `$${state.money.toLocaleString('en-US')}`
    const scannerEl = this.root.querySelector<HTMLElement>('[data-phone-scanner]')
    if (scannerEl) {
      scannerEl.textContent = this.formatScannerLine(state)
      scannerEl.classList.toggle('is-alert', (state.wanted ?? 0) > 0)
    }
    const bankEl = this.root.querySelector<HTMLElement>('[data-phone-bank]')
    if (bankEl) bankEl.textContent = `BuckMe $${(state.bankBalance ?? 0).toLocaleString('en-US')}`
    const bankBalEl = this.root.querySelector<HTMLElement>('[data-phone-bank-bal]')
    if (bankBalEl) bankBalEl.textContent = `$${(state.bankBalance ?? 0).toLocaleString('en-US')} (Safe if Wasted)`
    const lootEl = this.root.querySelector<HTMLElement>('[data-phone-loot]')
    if (lootEl) lootEl.textContent = `$${(state.uncleanedLoot ?? 0).toLocaleString('en-US')} · Fence at Pawn/Jewelers (85%)`
    const smsBadgeEl = this.root.querySelector<HTMLElement>('[data-phone-sms-badge]')
    if (smsBadgeEl) {
      const unread = this.getUnreadCount()
      smsBadgeEl.textContent = `Inbox ${unread > 0 ? `(${unread})` : ''}`
    }
    const filterEl = this.root.querySelector<HTMLElement>('[data-phone-filter]')
    if (filterEl) filterEl.textContent = state.grittyFilter ? 'GRITTY IV: ON' : 'GRITTY IV: OFF'
    const ringEl = this.root.querySelector<HTMLElement>('[data-phone-ring]')
    if (ringEl) ringEl.textContent = `TONE: ${state.ringtone.toUpperCase()}`
    const weatherEl = this.root.querySelector<HTMLElement>('[data-phone-weather]')
    if (weatherEl) weatherEl.textContent = `SKY: ${state.weather.toUpperCase()}`
    const img = this.root.querySelector<HTMLImageElement>('[data-phone-photo]')
    if (img && state.latestPhoto && img.src !== state.latestPhoto) {
      img.src = state.latestPhoto
      img.hidden = false
    }
  }

  setApp(next: PhoneApp): void {
    this.app = next
    this.selectedIndex = 0
    if (next === 'sms') {
      for (const m of this.sms) m.unread = false
    }
    this.callbacks.onKeyBeep()
    this.render()
  }

  private getNavButtons(): HTMLButtonElement[] {
    return Array.from(this.root.querySelectorAll<HTMLButtonElement>('.vbn-phone-menu button, .vbn-phone-sub button'))
  }

  private syncSelectionHighlight(buttons = this.getNavButtons()): void {
    if (buttons.length === 0) return
    this.selectedIndex = ((this.selectedIndex % buttons.length) + buttons.length) % buttons.length
    buttons.forEach((btn, idx) => btn.classList.toggle('is-key-focus', idx === this.selectedIndex))
  }

  private onClick(event: MouseEvent): void {
    const btn = (event.target as Element).closest<HTMLButtonElement>('button[data-phone-act]')
    if (!btn) return
    this.triggerAction(btn.dataset.phoneAct)
  }

  private triggerAction(act?: string): void {
    if (!act) return
    this.callbacks.onKeyBeep()
    switch (act) {
      case 'close': this.callbacks.onClose(); break
      case 'home': this.setApp('home'); break
      case 'app-911': this.setApp('911'); break
      case 'app-cab': this.setApp('cab'); break
      case 'app-jacob': this.setApp('jacob'); break
      case 'app-social': this.setApp('social'); break
      case 'app-bank': this.setApp('bank'); break
      case 'app-vehicle': this.setApp('vehicle'); break
      case 'app-camera': this.setApp('camera'); break
      case 'app-sms': this.setApp('sms'); break
      case 'app-settings': this.setApp('settings'); break
      case 'call-ambulance': this.callbacks.onCall911('ambulance'); break
      case 'call-fire': this.callbacks.onCall911('fire'); break
      case 'call-police': this.callbacks.onCall911('police'); break
      case 'dispatch-cab': this.callbacks.onCallCab(); break
      case 'ride-objective': this.callbacks.onRideCab('objective'); break
      case 'ride-safehouse': this.callbacks.onRideCab('safehouse'); break
      case 'skip-objective': this.callbacks.onSkipRide('objective'); break
      case 'skip-respray': this.callbacks.onSkipRide('respray'); break
      case 'skip-safehouse': this.callbacks.onSkipRide('safehouse'); break
      case 'jacob-van': this.callbacks.onCallJacob('van'); break
      case 'jacob-armor': this.callbacks.onCallJacob('armor'); break
      case 'jacob-ammo': this.callbacks.onCallJacob('ammo'); break
      case 'social-race': this.callbacks.onSocialEvent?.('race'); break
      case 'social-truck': this.callbacks.onSocialEvent?.('truck'); break
      case 'social-cargo': this.callbacks.onSocialEvent?.('cargo'); break
      case 'bank-deposit': this.callbacks.onDepositBank?.(); this.render(); break
      case 'bank-withdraw': this.callbacks.onWithdrawBank?.(); this.render(); break
      case 'deliver-car': this.callbacks.onRequestPersonalCar?.(); break
      case 'switch-lead': this.callbacks.onSwitchProtagonist?.(); this.render(); break
      case 'snap-photo': this.callbacks.onTakePhoto(); break
      case 'toggle-filter': this.callbacks.onToggleFilter(); this.render(); break
      case 'cycle-weather': this.callbacks.onCycleWeather(); this.render(); break
      case 'cycle-ringtone': this.callbacks.onCycleRingtone(); this.render(); break
    }
  }

  private render(): void {
    const unread = this.getUnreadCount()
    const s = this.lastState
    let screenHtml = ''

    if (this.app === 'home') {
      screenHtml = `
        <div class="vbn-phone-menu">
          <button type="button" data-phone-act="app-social"><b>FEED</b><span>Leonida Social Feed</span></button>
          <button type="button" data-phone-act="app-bank"><b>BANK</b><span data-phone-bank>BuckMe $${(s.bankBalance ?? 0).toLocaleString('en-US')}</span></button>
          <button type="button" data-phone-act="app-vehicle"><b>RIDE</b><span>Personal Car Delivery</span></button>
          <button type="button" data-phone-act="app-911"><b>911</b><span>Emergency Dispatch</span></button>
          <button type="button" data-phone-act="app-cab"><b>CAB</b><span>Roman Express Service</span></button>
          <button type="button" data-phone-act="app-jacob"><b>JACOB</b><span>Arms &amp; Kevlar Van</span></button>
          <button type="button" data-phone-act="app-camera"><b>CAM</b><span>Snapmatic (${s.photoCount})</span></button>
          <button type="button" data-phone-act="app-sms"><b>SMS</b><span data-phone-sms-badge>Inbox ${unread > 0 ? `(${unread})` : ''}</span></button>
          <button type="button" data-phone-act="app-settings"><b>CFG</b><span>Sky, Audio &amp; Lead</span></button>
        </div>`
    } else if (this.app === '911') {
      screenHtml = `
        <div class="vbn-phone-sub">
          <p class="vbn-phone-title">911 EMERGENCY SERVICES</p>
          <button type="button" data-phone-act="call-ambulance">1 · AMBULANCE (HEAL)</button>
          <button type="button" data-phone-act="call-fire">2 · FIRE DEPARTMENT</button>
          <button type="button" data-phone-act="call-police">3 · POLICE PATROL</button>
          <button type="button" class="is-back" data-phone-act="home">← CONTACTS</button>
        </div>`
    } else if (this.app === 'cab') {
      screenHtml = `
        <div class="vbn-phone-sub">
          <p class="vbn-phone-title">ROMAN'S LIBERTY CAB</p>
          <button type="button" data-phone-act="dispatch-cab">CALL YELLOW CAB TO CURB</button>
          <button type="button" data-phone-act="ride-objective">RIDE BACKSEAT → OBJECTIVE ($20)</button>
          <button type="button" data-phone-act="ride-safehouse">RIDE BACKSEAT → SAFEHOUSE ($20)</button>
          <button type="button" data-phone-act="skip-objective">SKIP RIDE → OBJECTIVE ($30)</button>
          <button type="button" data-phone-act="skip-respray">SKIP RIDE → PAY 'N' SPRAY ($30)</button>
          <button type="button" class="is-back" data-phone-act="home">← BACK</button>
        </div>`
    } else if (this.app === 'jacob') {
      screenHtml = `
        <div class="vbn-phone-sub">
          <p class="vbn-phone-title">LITTLE JACOB ARMS</p>
          <button type="button" data-phone-act="jacob-van">MEET ARMS VAN AT CURB</button>
          <button type="button" data-phone-act="jacob-armor">BUY KEVLAR VEST (+100 · $200)</button>
          <button type="button" data-phone-act="jacob-ammo">RESUPPLY ALL AMMO ($120)</button>
          <button type="button" class="is-back" data-phone-act="home">← BACK</button>
        </div>`
    } else if (this.app === 'camera') {
      screenHtml = `
        <div class="vbn-phone-sub">
          <p class="vbn-phone-title">BADGER SNAPMATIC</p>
          <div class="vbn-phone-cambox">
            <img data-phone-photo ${s.latestPhoto ? `src="${s.latestPhoto}"` : 'hidden'} alt="Camera snapshot" />
            ${s.latestPhoto ? '' : '<span>NO SNAPSHOT YET</span>'}
          </div>
          <button type="button" data-phone-act="snap-photo">CAPTURE PHOTO [SNAP]</button>
          <button type="button" class="is-back" data-phone-act="home">← BACK</button>
        </div>`
    } else if (this.app === 'sms') {
      screenHtml = `
        <div class="vbn-phone-sub">
          <p class="vbn-phone-title">INBOX (${this.sms.length})</p>
          <div class="vbn-phone-smslist">
            ${this.sms.map(m => `<div class="vbn-phone-sms"><strong>${m.from} <span>${m.time}</span></strong><p>${m.body}</p></div>`).join('')}
          </div>
          <button type="button" class="is-back" data-phone-act="home">← BACK</button>
        </div>`
    } else if (this.app === 'social') {
      screenHtml = `
        <div class="vbn-phone-sub">
          <p class="vbn-phone-title">LEONIDA SOCIAL FEED</p>
          <button type="button" data-phone-act="social-race">@vice_nights: Midnight Beach Sprint LIVE → WAYPOINT</button>
          <button type="button" data-phone-act="social-truck">@bleeter_lb: Fleeca Armored Cash Van near Downtown → WAYPOINT</button>
          <button type="button" data-phone-act="social-cargo">@port_watch: Unmarked Cargo Drop at Port Quay → WAYPOINT</button>
          <button type="button" class="is-back" data-phone-act="home">← BACK</button>
        </div>`
    } else if (this.app === 'bank') {
      screenHtml = `
        <div class="vbn-phone-sub">
          <p class="vbn-phone-title">BUCKME MOBILE BANKING</p>
          <div class="vbn-phone-sms"><strong>PROTECTED BANK</strong><p data-phone-bank-bal>$${(s.bankBalance ?? 0).toLocaleString('en-US')} (Safe if Wasted)</p></div>
          <div class="vbn-phone-sms"><strong>UNCLEANED LOOT DUFFEL</strong><p data-phone-loot>$${(s.uncleanedLoot ?? 0).toLocaleString('en-US')} · Fence at Pawn/Jewelers (85%)</p></div>
          <button type="button" data-phone-act="bank-deposit">DEPOSIT ALL CASH ($${s.money.toLocaleString('en-US')})</button>
          <button type="button" data-phone-act="bank-withdraw">WITHDRAW $500 CASH</button>
          <button type="button" class="is-back" data-phone-act="home">← BACK</button>
        </div>`
    } else if (this.app === 'vehicle') {
      screenHtml = `
        <div class="vbn-phone-sub">
          <p class="vbn-phone-title">PERSONAL RIDE MECHANIC</p>
          <div class="vbn-phone-sms"><strong>REGISTERED VEHICLE</strong><p>${(s.personalCarName ?? 'Roman Liberty Cab').toUpperCase()}</p></div>
          <button type="button" data-phone-act="deliver-car">DELIVER PERSONAL CAR TO CURB</button>
          <button type="button" data-phone-act="switch-lead">SWITCH LEAD (${(s.protagonist ?? 'jason').toUpperCase()})</button>
          <button type="button" class="is-back" data-phone-act="home">← BACK</button>
        </div>`
    } else {
      screenHtml = `
        <div class="vbn-phone-sub">
          <p class="vbn-phone-title">BADGER SETTINGS</p>
          <button type="button" data-phone-act="toggle-filter" data-phone-filter>${s.grittyFilter ? 'GRITTY IV: ON' : 'GRITTY IV: OFF'}</button>
          <button type="button" data-phone-act="cycle-ringtone" data-phone-ring>TONE: ${s.ringtone.toUpperCase()}</button>
          <button type="button" data-phone-act="cycle-weather" data-phone-weather>SKY: ${s.weather.toUpperCase()}</button>
          <button type="button" data-phone-act="switch-lead">SWITCH LEAD (${(s.protagonist ?? 'jason').toUpperCase()})</button>
          <button type="button" class="is-back" data-phone-act="home">← BACK</button>
        </div>`
    }

    this.root.innerHTML = `
      <div class="vbn-phone-shell">
        <div class="vbn-phone-earpiece"><span></span><small>BADGER IV</small><button type="button" data-phone-act="close" aria-label="Put away phone">✕</button></div>
        <div class="vbn-phone-lcd">
          <div class="vbn-phone-status"><span>▂▄▆ WHIZ</span><span data-phone-clock>${s.time}</span><span data-phone-money>$${s.money.toLocaleString('en-US')}</span></div>
          <div class="vbn-phone-scanner ${(s.wanted ?? 0) > 0 ? 'is-alert' : ''}" data-phone-scanner>${this.formatScannerLine(s)}</div>
          ${screenHtml}
        </div>
        <div class="vbn-phone-keys">
          <button type="button" data-phone-act="home">MENU</button>
          <button type="button" data-phone-act="app-911">911</button>
          <button type="button" data-phone-act="app-cab">CAB</button>
          <button type="button" data-phone-act="close">END</button>
        </div>
      </div>`
    this.syncSelectionHighlight()
  }
}
