import * as THREE from 'three'
import type { ViceAudio } from '../engine/viceAudio'
import type { ViceWeather } from './viceWorld'

export type CutsceneId = 'opening' | 'intro' | 'race' | 'delivery' | 'stunt' | 'complete'

export type CutsceneHudState = {
  active: boolean
  id: CutsceneId | null
  location: string
  speaker: string
  speakerColor: string
  line: string
  elapsed: number
  duration: number
  progress: number
}

type SpeakerId = 'RICO' | 'ELENA' | 'MERCER' | 'MARCO'

type DialogueCue = {
  start: number
  end: number
  speaker: SpeakerId
  text: string
}

type CameraShot = {
  start: number
  end: number
  location: string
  weather?: ViceWeather
  fromPos: [number, number, number]
  toPos: [number, number, number]
  fromLook: [number, number, number]
  toLook: [number, number, number]
  stageActors: 'ocean-club' | 'downtown-bank' | 'port-docks' | 'boulevard' | 'none'
}

type CutsceneScript = {
  id: CutsceneId
  duration: number
  shots: CameraShot[]
  cues: DialogueCue[]
}

type ActorRig = {
  root: THREE.Group
  head: THREE.Group
  jaw: THREE.Mesh
  leftArm: THREE.Group
  rightArm: THREE.Group
  leftLeg: THREE.Mesh
  rightLeg: THREE.Mesh
  baseY: number
}

const SPEAKER_STYLE: Record<SpeakerId, { color: string; voicePitch: number; voiceRate: number; cadenceHz: number }> = {
  RICO: { color: '#49d8dc', voicePitch: 0.90, voiceRate: 0.97, cadenceHz: 135 },
  ELENA: { color: '#ff5ea8', voicePitch: 1.18, voiceRate: 1.02, cadenceHz: 205 },
  MERCER: { color: '#ffbd59', voicePitch: 0.76, voiceRate: 0.93, cadenceHz: 112 },
  MARCO: { color: '#9cf27d', voicePitch: 0.86, voiceRate: 1.04, cadenceHz: 150 },
}

const OPENING_SCRIPT: CutsceneScript = {
  id: 'opening',
  duration: 120,
  shots: [
    {
      start: 0, end: 20,
      location: 'VICE BEACH & OCEAN DRIVE — 16:10',
      weather: 'sunset',
      fromPos: [98, 16, 42], toPos: [44, 7.5, -18],
      fromLook: [24, 3, -12], toLook: [14, 2.2, -10],
      stageActors: 'ocean-club',
    },
    {
      start: 20, end: 42,
      location: 'OCEAN CLUB TERRACE — VICE BOULEVARD',
      weather: 'sunset',
      fromPos: [10.5, 2.3, -14.8], toPos: [16.8, 2.1, -6.2],
      fromLook: [14.2, 1.75, -10.5], toLook: [14.0, 1.75, -10.5],
      stageActors: 'ocean-club',
    },
    {
      start: 42, end: 62,
      location: 'VICE BOULEVARD — THE NEON STRIP',
      weather: 'night',
      fromPos: [4.5, 4.2, 22], toPos: [-3.5, 3.6, -78],
      fromLook: [0, 3.2, -30], toLook: [-12, 4.5, -118],
      stageActors: 'none',
    },
    {
      start: 62, end: 82,
      location: 'DOWNTOWN FINANCIAL — VICE BANK PLAZA',
      weather: 'night',
      fromPos: [-11.5, 2.5, -153], toPos: [-18.5, 3.2, -138],
      fromLook: [-16.2, 1.75, -145], toLook: [-16.2, 1.85, -145],
      stageActors: 'downtown-bank',
    },
    {
      start: 82, end: 102,
      location: 'PORT VICE — CARGO TERMINALS',
      weather: 'rain',
      fromPos: [46, 12, 132], toPos: [62, 6.5, 198],
      fromLook: [64, 3.0, 160], toLook: [60, 2.0, 205],
      stageActors: 'port-docks',
    },
    {
      start: 102, end: 120,
      location: 'VICE BOULEVARD — YOUR NIGHT STARTS HERE',
      weather: 'sunset',
      fromPos: [8.5, 3.0, 9.5], toPos: [0, 4.8, 25],
      fromLook: [0, 1.6, 16], toLook: [0, 1.45, 16],
      stageActors: 'boulevard',
    },
  ],
  cues: [
    { start: 1.0, end: 6.8, speaker: 'ELENA', text: 'Five years away, Rico... and Vice Bay still shines like a freshly painted getaway car.' },
    { start: 7.2, end: 13.5, speaker: 'RICO', text: 'The neon never changed, Elena. Just the people holding the ledger.' },
    { start: 14.0, end: 19.5, speaker: 'ELENA', text: 'Then keep your eyes open. Everything south of Downtown belongs to Marco and the docks now.' },

    { start: 20.8, end: 26.5, speaker: 'ELENA', text: 'You wanted a clean start, but a clean start in this town costs twenty-five hundred just to breathe.' },
    { start: 27.0, end: 32.5, speaker: 'RICO', text: 'Give me four solid contracts and an open boulevard. I will clear that debt before sunrise.' },
    { start: 33.0, end: 37.8, speaker: 'ELENA', text: 'Good. There is a Coastline Sedan and a Neon Sport fueled right outside the strip.' },
    { start: 38.2, end: 41.8, speaker: 'RICO', text: 'Tell me who is watching the streets tonight.' },

    { start: 43.0, end: 49.0, speaker: 'MERCER', text: 'All units on Vice Boulevard, new Heat Grid is live. Witnesses report straight to dispatch.' },
    { start: 49.5, end: 55.8, speaker: 'ELENA', text: 'That is Detective Mercer. Break line-of-sight behind buildings, swap plates, and stay out of chopper beams.' },
    { start: 56.2, end: 61.5, speaker: 'RICO', text: 'So if they lose eyes on me, they only search my last known position. Smart.' },

    { start: 63.0, end: 69.0, speaker: 'MARCO', text: 'Listen to me, Mercer! My convoy hits Port Vice at midnight. Keep your patrol cars off the quay.' },
    { start: 69.5, end: 75.5, speaker: 'MERCER', text: 'Double my cut, Marco, or I park two roadblocks across every avenue from Vice Bank to the pier.' },
    { start: 76.0, end: 81.5, speaker: 'RICO', text: 'A dirty detective and a nervous dock boss. That explains why the city is boiling over.' },

    { start: 83.0, end: 89.2, speaker: 'ELENA', text: 'Down at Port Vice, Marco moves crates between the gantry cranes and the container yard.' },
    { start: 89.8, end: 95.8, speaker: 'MARCO', text: 'Lock down pier three! Nobody touches those containers unless they are on my payroll!' },
    { start: 96.2, end: 101.5, speaker: 'ELENA', text: 'Deliveries, street runs, stunt heat... take any contract from the pause menu when you are ready.' },

    { start: 102.8, end: 108.8, speaker: 'ELENA', text: 'Keys are in the ignition, Rico. Three safehouses across the bay will patch you up and cool your heat.' },
    { start: 109.2, end: 114.5, speaker: 'RICO', text: 'I know the deal. Hit the yellow beacon, watch the radar, and own the night.' },
    { start: 115.0, end: 119.5, speaker: 'ELENA', text: 'Welcome back to Vice Bay, partner. Do not keep the city waiting.' },
  ],
}

const MISSION_SCRIPTS: Record<Exclude<CutsceneId, 'opening'>, CutsceneScript> = {
  intro: {
    id: 'intro',
    duration: 8.5,
    shots: [{
      start: 0, end: 8.5,
      location: 'CONTRACT 01 — WELCOME TO VICE BAY',
      fromPos: [9, 4.2, 6], toPos: [-6, 5.5, -38],
      fromLook: [0, 1.8, -15], toLook: [-22, 4.0, -95],
      stageActors: 'boulevard',
    }],
    cues: [
      { start: 0.4, end: 4.3, speaker: 'ELENA', text: 'First stop: head north up the neon strip and check in at the Downtown Plaza.' },
      { start: 4.5, end: 8.2, speaker: 'RICO', text: 'Copy that. Eyes on the yellow marker — rolling out now.' },
    ],
  },
  race: {
    id: 'race',
    duration: 8.5,
    shots: [{
      start: 0, end: 8.5,
      location: 'CONTRACT 02 — MIDNIGHT RUN',
      fromPos: [14, 3.6, -24], toPos: [-12, 4.5, 40],
      fromLook: [0, 1.5, -55], toLook: [0, 1.5, 75],
      stageActors: 'none',
    }],
    cues: [
      { start: 0.4, end: 4.3, speaker: 'MARCO', text: 'Think you still know these avenues? Show me your taillights from Downtown to the waterfront.' },
      { start: 4.5, end: 8.2, speaker: 'RICO', text: 'Grab a Neon Sport and burn every checkpoint. Watch my dust.' },
    ],
  },
  delivery: {
    id: 'delivery',
    duration: 8.5,
    shots: [{
      start: 0, end: 8.5,
      location: 'CONTRACT 03 — DOCKSIDE DELIVERY',
      fromPos: [-12, 6.5, 120], toPos: [-65, 5.5, 110],
      fromLook: [-30, 2.0, 140], toLook: [-105, 2.5, 85],
      stageActors: 'port-docks',
    }],
    cues: [
      { start: 0.4, end: 4.3, speaker: 'ELENA', text: 'Package is waiting at the Port Vice depot. Grab it and haul straight to Palm House.' },
      { start: 4.5, end: 8.2, speaker: 'RICO', text: 'If patrols spot me, I will cut through the alleys and drop the heat.' },
    ],
  },
  stunt: {
    id: 'stunt',
    duration: 8.0,
    shots: [{
      start: 0, end: 8.0,
      location: 'CONTRACT 04 — STUNT DRIVER',
      fromPos: [42, 4.5, 84], toPos: [18, 4.0, 116],
      fromLook: [28, 2.0, 100], toLook: [28, 2.4, 100],
      stageActors: 'none',
    }],
    cues: [
      { start: 0.4, end: 4.1, speaker: 'ELENA', text: 'Waterfront ramp is primed. Hit it in a fast ride and launch clear over the boardwalk.' },
      { start: 4.3, end: 7.7, speaker: 'RICO', text: 'Full throttle. Let us wake up the whole beachfront.' },
    ],
  },
  complete: {
    id: 'complete',
    duration: 4.8,
    shots: [{
      start: 0, end: 4.8,
      location: 'CONTRACT COMPLETE',
      fromPos: [6, 2.6, 6], toPos: [-6, 3.0, 6],
      fromLook: [0, 1.5, 0], toLook: [0, 1.6, 0],
      stageActors: 'none',
    }],
    cues: [
      { start: 0.3, end: 4.5, speaker: 'ELENA', text: 'Clean execution, Rico. Wire just landed in your account — pick your next move.' },
    ],
  },
}

export class CutsceneDirector {
  private readonly group = new THREE.Group()
  private readonly actors: Record<SpeakerId, ActorRig>
  private readonly propCar: THREE.Group
  private activeScript: CutsceneScript | null = null
  private elapsed = 0
  private lastCueIndex = -1
  private cadenceTimer = 0
  private onComplete?: () => void
  private completeCenter = new THREE.Vector3()
  private readonly camPos = new THREE.Vector3()
  private readonly camLook = new THREE.Vector3()

  constructor(private readonly scene: THREE.Scene, private readonly audio: ViceAudio) {
    this.group.name = 'Cutscene stage'
    this.group.visible = false
    this.scene.add(this.group)

    this.actors = {
      RICO: this.makeActor('#49b9be', '#17263d', '#b8795d', '#211916', true),
      ELENA: this.makeActor('#ef4e8e', '#261a34', '#dda383', '#2e1a1a', true),
      MERCER: this.makeActor('#2c4464', '#5c5346', '#d8a688', '#3c3633', false),
      MARCO: this.makeActor('#d99345', '#1d2228', '#c18562', '#17171b', true),
    }
    for (const actor of Object.values(this.actors)) this.group.add(actor.root)

    this.propCar = this.makePropCar('#ee518d')
    this.group.add(this.propCar)
  }

  get isPlaying(): boolean {
    return this.activeScript !== null
  }

  start(id: CutsceneId, focus?: THREE.Vector3, onComplete?: () => void): void {
    this.stopSpeech()
    this.activeScript = id === 'opening' ? OPENING_SCRIPT : MISSION_SCRIPTS[id]
    this.elapsed = 0
    this.lastCueIndex = -1
    this.cadenceTimer = 0
    this.onComplete = onComplete
    if (focus) this.completeCenter.copy(focus)
    this.group.visible = true
    this.audio.unlock()
    this.audio.setCutsceneMode(true)
    this.positionStage('ocean-club')
  }

  skip(): void {
    if (!this.activeScript) return
    const done = this.onComplete
    this.stop()
    done?.()
  }

  stop(): void {
    this.stopSpeech()
    this.activeScript = null
    this.lastCueIndex = -1
    this.group.visible = false
    this.audio.setCutsceneMode(false)
    this.onComplete = undefined
  }

  update(dt: number, camera: THREE.PerspectiveCamera): { state: CutsceneHudState; weather?: ViceWeather; finished: boolean } {
    if (!this.activeScript) {
      return {
        state: { active: false, id: null, location: '', speaker: '', speakerColor: '#fff', line: '', elapsed: 0, duration: 0, progress: 0 },
        finished: false,
      }
    }

    const script = this.activeScript
    this.elapsed += Math.min(dt, 0.1)
    if (this.elapsed >= script.duration) {
      const done = this.onComplete
      this.stop()
      done?.()
      return {
        state: { active: false, id: null, location: '', speaker: '', speakerColor: '#fff', line: '', elapsed: script.duration, duration: script.duration, progress: 1 },
        finished: true,
      }
    }

    const shot = script.shots.find(s => this.elapsed >= s.start && this.elapsed < s.end) ?? script.shots[script.shots.length - 1]
    const shotT = THREE.MathUtils.clamp((this.elapsed - shot.start) / Math.max(0.01, shot.end - shot.start), 0, 1)
    const smoothT = shotT * shotT * (3 - 2 * shotT)

    if (script.id === 'complete') {
      const angle = smoothT * Math.PI * 1.15
      camera.position.set(
        this.completeCenter.x + Math.sin(angle) * 6.5,
        this.completeCenter.y + 2.4 + smoothT * 0.6,
        this.completeCenter.z + Math.cos(angle) * 6.5,
      )
      camera.lookAt(this.completeCenter.x, this.completeCenter.y + 1.5, this.completeCenter.z)
    } else {
      this.camPos.set(
        THREE.MathUtils.lerp(shot.fromPos[0], shot.toPos[0], smoothT),
        THREE.MathUtils.lerp(shot.fromPos[1], shot.toPos[1], smoothT),
        THREE.MathUtils.lerp(shot.fromPos[2], shot.toPos[2], smoothT),
      )
      this.camLook.set(
        THREE.MathUtils.lerp(shot.fromLook[0], shot.toLook[0], smoothT),
        THREE.MathUtils.lerp(shot.fromLook[1], shot.toLook[1], smoothT),
        THREE.MathUtils.lerp(shot.fromLook[2], shot.toLook[2], smoothT),
      )
      camera.position.copy(this.camPos)
      camera.lookAt(this.camLook)
    }
    camera.fov = 46
    camera.updateProjectionMatrix()

    this.positionStage(shot.stageActors)

    const cueIndex = script.cues.findIndex(c => this.elapsed >= c.start && this.elapsed < c.end)
    const cue = cueIndex >= 0 ? script.cues[cueIndex] : null
    if (cueIndex !== this.lastCueIndex) {
      this.lastCueIndex = cueIndex
      if (cue) this.speak(cue.speaker, cue.text)
    }

    this.animateActors(dt, cue?.speaker ?? null)

    const speaker = cue?.speaker ?? ''
    const speakerColor = cue ? SPEAKER_STYLE[cue.speaker].color : '#ffe45b'
    return {
      state: {
        active: true,
        id: script.id,
        location: shot.location,
        speaker,
        speakerColor,
        line: cue?.text ?? '',
        elapsed: this.elapsed,
        duration: script.duration,
        progress: THREE.MathUtils.clamp(this.elapsed / script.duration, 0, 1),
      },
      weather: shot.weather,
      finished: false,
    }
  }

  private positionStage(stage: CameraShot['stageActors']): void {
    for (const actor of Object.values(this.actors)) actor.root.visible = false
    this.propCar.visible = false

    if (stage === 'ocean-club') {
      this.actors.RICO.root.visible = true
      this.actors.RICO.root.position.set(13.1, 0, -10.5)
      this.actors.RICO.root.rotation.y = Math.PI * 0.42
      this.actors.ELENA.root.visible = true
      this.actors.ELENA.root.position.set(15.2, 0, -10.2)
      this.actors.ELENA.root.rotation.y = -Math.PI * 0.52
      this.propCar.visible = true
      this.propCar.position.set(11.4, 0, -6.2)
      this.propCar.rotation.y = 0.25
    } else if (stage === 'downtown-bank') {
      this.actors.MERCER.root.visible = true
      this.actors.MERCER.root.position.set(-17.4, 0, -145)
      this.actors.MERCER.root.rotation.y = Math.PI * 0.48
      this.actors.MARCO.root.visible = true
      this.actors.MARCO.root.position.set(-15.0, 0, -145)
      this.actors.MARCO.root.rotation.y = -Math.PI * 0.52
    } else if (stage === 'port-docks') {
      this.actors.MARCO.root.visible = true
      this.actors.MARCO.root.position.set(57.5, 0, 198)
      this.actors.MARCO.root.rotation.y = -Math.PI * 0.35
      this.actors.ELENA.root.visible = true
      this.actors.ELENA.root.position.set(55.5, 0, 195.5)
      this.actors.ELENA.root.rotation.y = Math.PI * 0.65
    } else if (stage === 'boulevard') {
      this.actors.RICO.root.visible = true
      this.actors.RICO.root.position.set(-0.9, 0, 16)
      this.actors.RICO.root.rotation.y = Math.PI * 0.4
      this.actors.ELENA.root.visible = true
      this.actors.ELENA.root.position.set(1.2, 0, 16)
      this.actors.ELENA.root.rotation.y = -Math.PI * 0.45
    }
  }

  private animateActors(dt: number, talking: SpeakerId | null): void {
    this.cadenceTimer -= dt
    if (talking && this.cadenceTimer <= 0) {
      this.cadenceTimer = 0.14 + Math.random() * 0.08
      this.audio.voiceCadence(SPEAKER_STYLE[talking].cadenceHz)
    }
    for (const [id, rig] of Object.entries(this.actors) as [SpeakerId, ActorRig][]) {
      if (!rig.root.visible) continue
      const isTalking = talking === id
      const breath = Math.sin(this.elapsed * 2.2 + rig.baseY) * 0.02
      rig.root.position.y = breath
      if (isTalking) {
        const talkWave = Math.abs(Math.sin(this.elapsed * 15))
        rig.jaw.position.y = -0.14 - talkWave * 0.055
        rig.jaw.scale.y = 0.7 + talkWave * 0.6
        rig.head.rotation.y = Math.sin(this.elapsed * 2.7) * 0.14
        rig.head.rotation.x = Math.sin(this.elapsed * 4.2) * 0.06
        rig.rightArm.rotation.x = -0.55 - Math.sin(this.elapsed * 5.2) * 0.28
        rig.rightArm.rotation.z = 0.18 + Math.cos(this.elapsed * 3.8) * 0.12
        rig.leftArm.rotation.x = -0.22 + Math.sin(this.elapsed * 3.4) * 0.12
      } else {
        rig.jaw.position.y = -0.14
        rig.jaw.scale.y = 0.65
        rig.head.rotation.y = THREE.MathUtils.damp(rig.head.rotation.y, Math.sin(this.elapsed * 0.9) * 0.08, 4, dt)
        rig.head.rotation.x = THREE.MathUtils.damp(rig.head.rotation.x, 0, 4, dt)
        rig.rightArm.rotation.x = THREE.MathUtils.damp(rig.rightArm.rotation.x, 0.05, 5, dt)
        rig.rightArm.rotation.z = THREE.MathUtils.damp(rig.rightArm.rotation.z, 0, 5, dt)
        rig.leftArm.rotation.x = THREE.MathUtils.damp(rig.leftArm.rotation.x, -0.05, 5, dt)
      }
    }
  }

  private speak(speaker: SpeakerId, text: string): void {
    if (this.audio.muted) return
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    try {
      window.speechSynthesis.cancel()
      const utter = new SpeechSynthesisUtterance(text)
      const style = SPEAKER_STYLE[speaker]
      utter.pitch = style.voicePitch
      utter.rate = style.voiceRate
      utter.volume = 0.85
      window.speechSynthesis.speak(utter)
    } catch {
      // Headless or restricted browsers still get subtitles and Web Audio voice cadence.
    }
  }

  private stopSpeech(): void {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try { window.speechSynthesis.cancel() } catch {}
    }
  }

  private makeActor(shirtColor: string, jacketColor: string, skinColor: string, hairColor: string, shades: boolean): ActorRig {
    const root = new THREE.Group()
    const mat = (color: string, rough = 0.8) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.08 })
    const box = (w: number, h: number, d: number, color: string, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color))
      m.position.set(x, y, z)
      m.castShadow = true
      m.receiveShadow = true
      return m
    }

    root.add(box(0.72, 0.82, 0.38, shirtColor, 0, 1.46, 0))
    root.add(box(0.82, 0.22, 0.43, jacketColor, 0, 1.82, 0))

    const head = new THREE.Group()
    head.position.set(0, 2.2, 0)
    head.add(box(0.46, 0.44, 0.42, skinColor, 0, 0.04, 0))
    head.add(box(0.48, 0.16, 0.44, hairColor, 0, 0.3, 0.01))
    const jaw = box(0.32, 0.1, 0.3, skinColor, 0, -0.14, 0.06)
    head.add(jaw)
    if (shades) head.add(box(0.38, 0.1, 0.06, '#141720', 0, 0.08, 0.22))
    root.add(head)

    const armRig = (x: number) => {
      const pivot = new THREE.Group()
      pivot.position.set(x, 1.82, 0)
      pivot.add(box(0.2, 0.72, 0.22, jacketColor, 0, -0.34, 0))
      pivot.add(box(0.18, 0.16, 0.18, skinColor, 0, -0.74, 0))
      root.add(pivot)
      return pivot
    }
    const leftArm = armRig(-0.48)
    const rightArm = armRig(0.48)
    const leftLeg = box(0.28, 0.86, 0.3, '#1f2838', -0.19, 0.45, 0)
    const rightLeg = box(0.28, 0.86, 0.3, '#1f2838', 0.19, 0.45, 0)
    root.add(leftLeg, rightLeg)

    return { root, head, jaw, leftArm, rightArm, leftLeg, rightLeg, baseY: Math.random() * 6 }
  }

  private makePropCar(color: string): THREE.Group {
    const car = new THREE.Group()
    const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.48, roughness: 0.32 })
    const dark = new THREE.MeshStandardMaterial({ color: '#1b202b', roughness: 0.7 })
    const glass = new THREE.MeshStandardMaterial({ color: '#4d899c', metalness: 0.3, roughness: 0.18 })
    const add = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)
      mesh.position.set(x, y, z)
      mesh.castShadow = true
      mesh.receiveShadow = true
      car.add(mesh)
    }
    add(2.05, 0.56, 4.15, paint, 0, 0.65, 0)
    add(1.65, 0.44, 1.85, glass, 0, 1.15, 0.15)
    add(1.72, 0.1, 1.65, paint, 0, 1.4, 0.2)
    for (const x of [-1.02, 1.02]) for (const z of [-1.25, 1.25]) add(0.24, 0.82, 0.82, dark, x, 0.41, z)
    return car
  }
}

export function playMissionCard(title: string): void {
  document.querySelector('.mission-cinematic')?.remove()
  const card = document.createElement('div')
  card.className = 'mission-cinematic'
  const label = document.createElement('small'); label.textContent = 'CONTRACT ACCEPTED'
  const name = document.createElement('strong'); name.textContent = title
  card.append(label, name)
  Object.assign(card.style, { position: 'fixed', left: '0', top: '34%', width: '100%', zIndex: '40', pointerEvents: 'none', textAlign: 'center', fontFamily: 'system-ui,sans-serif', textShadow: '0 3px 15px #000', transition: 'opacity .7s' })
  Object.assign(label.style, { display: 'block', color: '#ffe45b', fontSize: '12px', fontWeight: '800', letterSpacing: '.3em' })
  Object.assign(name.style, { display: 'block', color: '#fff', fontSize: 'clamp(30px,5vw,70px)', fontStyle: 'italic', fontWeight: '1000', letterSpacing: '-.03em' })
  document.body.append(card)
  window.setTimeout(() => { card.style.opacity = '0' }, 1800)
  window.setTimeout(() => card.remove(), 2600)
}
