export class ViceAudio {
  private context?: AudioContext
  private master?: GainNode
  private engine?: OscillatorNode
  private engineGain?: GainNode
  private siren?: OscillatorNode
  private sirenGain?: GainNode
  private nextBeat = 0
  private beat = 0
  private cutsceneActive = false
  muted = false

  unlock(): void {
    if (!this.context) {
      const c = new AudioContext(); this.context = c
      const master = c.createGain(); master.gain.value = this.muted ? 0 : .17; master.connect(c.destination); this.master = master
      const engine = c.createOscillator(), engineGain = c.createGain()
      engine.type = 'sawtooth'; engine.frequency.value = 55; engineGain.gain.value = 0
      engine.connect(engineGain).connect(master); engine.start(); this.engine = engine; this.engineGain = engineGain
      const siren = c.createOscillator(), sirenGain = c.createGain()
      siren.type = 'triangle'; siren.frequency.value = 660; sirenGain.gain.value = 0
      siren.connect(sirenGain).connect(master); siren.start(); this.siren = siren; this.sirenGain = sirenGain
      this.nextBeat = c.currentTime + .1
    }
    void this.context.resume()
  }

  toggle(): boolean {
    this.muted = !this.muted
    if (this.muted && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try { window.speechSynthesis.cancel() } catch {}
    }
    if (this.master && this.context) this.master.gain.setTargetAtTime(this.muted ? 0 : .17, this.context.currentTime, .03)
    return this.muted
  }

  setCutsceneMode(active: boolean): void {
    this.cutsceneActive = active
  }

  update(speed: number, inVehicle: boolean, wanted: number, playing: boolean, inSight = true): void {
    const c = this.context
    if (!c || !this.engine || !this.engineGain || !this.siren || !this.sirenGain) return
    const t = c.currentTime
    this.engine.frequency.setTargetAtTime(48 + Math.min(145, Math.abs(speed) * 3.3), t, .08)
    this.engineGain.gain.setTargetAtTime(playing && inVehicle ? .17 : 0, t, .12)
    this.siren.frequency.setTargetAtTime(620 + 220 * (.5 + .5 * Math.sin(t * (inSight ? 5.2 + wanted * 0.35 : 2.8))), t, .04)
    this.sirenGain.gain.setTargetAtTime(playing && wanted > 0 ? (inSight ? Math.min(0.075, .042 + wanted * 0.005) : .018) : 0, t, .1)
    if ((playing || this.cutsceneActive) && t >= this.nextBeat) {
      this.nextBeat = t + (this.cutsceneActive ? .36 : .29)
      const notes = this.cutsceneActive
        ? [146.83, 0, 220, 174.61, 0, 261.63, 196, 0]
        : [110, 0, 164.81, 0, 130.81, 0, 196, 0]
      const vol = this.cutsceneActive ? .032 : .045
      if (notes[this.beat % notes.length]) this.note(notes[this.beat % notes.length], this.cutsceneActive ? .28 : .13, vol)
      if (this.beat % 2 === 0) this.note(this.cutsceneActive ? 73.42 : 55, this.cutsceneActive ? .2 : .09, this.cutsceneActive ? .07 : .11)
      this.beat++
    }
  }

  private note(frequency: number, duration: number, volume: number): void {
    if (!this.context || !this.master) return
    const c = this.context, osc = c.createOscillator(), gain = c.createGain(), t = c.currentTime
    osc.type = 'triangle'; osc.frequency.setValueAtTime(frequency, t)
    gain.gain.setValueAtTime(volume, t); gain.gain.exponentialRampToValueAtTime(.001, t + duration)
    osc.connect(gain).connect(this.master); osc.start(t); osc.stop(t + duration)
  }

  /** Subtle procedural vocal cadence syllable for animated character dialogue. */
  voiceCadence(pitchHz: number): void {
    if (this.muted || !this.context || !this.master) return
    const c = this.context, osc = c.createOscillator(), filter = c.createBiquadFilter(), gain = c.createGain(), t = c.currentTime
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(pitchHz * (0.94 + Math.random() * 0.14), t)
    filter.type = 'bandpass'; filter.frequency.setValueAtTime(950, t); filter.Q.setValueAtTime(2.5, t)
    gain.gain.setValueAtTime(.022, t); gain.gain.exponentialRampToValueAtTime(.001, t + .075)
    osc.connect(filter).connect(gain).connect(this.master); osc.start(t); osc.stop(t + .08)
  }

  dispatchAlert(): void {
    this.dispatchRadio(1)
  }

  /** Police radio dispatch squelch + priority chirp scaled by wanted level (1..6). */
  dispatchRadio(level: number): void {
    if (this.muted || !this.context || !this.master) return
    const c = this.context, t = c.currentTime
    // Short VHF squelch burst
    const n = Math.floor(c.sampleRate * 0.08)
    const buf = c.createBuffer(1, n, c.sampleRate)
    const ch = buf.getChannelData(0)
    for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * 0.35
    const src = c.createBufferSource(), bp = c.createBiquadFilter(), g = c.createGain()
    src.buffer = buf; bp.type = 'bandpass'; bp.frequency.setValueAtTime(2100, t); bp.Q.setValueAtTime(3.2, t)
    g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.08)
    src.connect(bp).connect(g).connect(this.master); src.start(t)
    // Dual-tone dispatch chirp
    const base = level >= 6 ? 1240 : level >= 3 ? 1080 : 940
    this.note(base, .07, .075)
    window.setTimeout(() => this.note(base * 1.32, .11, .08), 85)
    if (level >= 4) window.setTimeout(() => this.note(base * 1.5, .14, .085), 185)
  }

  shoot(): void {
    if (!this.context || !this.master) return
    const c = this.context, t = c.currentTime, n = Math.floor(c.sampleRate * .13), data = c.createBuffer(1, n, c.sampleRate)
    const channel = data.getChannelData(0)
    for (let i = 0; i < n; i++) channel[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 1.8)
    const src = c.createBufferSource(), filter = c.createBiquadFilter(), gain = c.createGain()
    src.buffer = data; filter.type = 'lowpass'; filter.frequency.setValueAtTime(1800, t); filter.frequency.exponentialRampToValueAtTime(480, t + .12)
    gain.gain.setValueAtTime(.7, t); gain.gain.exponentialRampToValueAtTime(.001, t + .13)
    src.connect(filter).connect(gain).connect(this.master); src.start(t)
    const boom = c.createOscillator(), boomGain = c.createGain()
    boom.type = 'sine'; boom.frequency.setValueAtTime(115, t); boom.frequency.exponentialRampToValueAtTime(48, t + .16)
    boomGain.gain.setValueAtTime(.2, t); boomGain.gain.exponentialRampToValueAtTime(.001, t + .16)
    boom.connect(boomGain).connect(this.master); boom.start(t); boom.stop(t + .17)
  }

  robbery(): void {
    this.note(330, .12, .08); window.setTimeout(() => this.note(494, .16, .08), 70)
  }

  impact(): void { this.note(70, .16, .22) }
}
