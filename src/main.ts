import './styles/main.css'
import { Input } from './engine/input'
import { GameLoop } from './engine/loop'
import { Renderer, suggestQuality } from './engine/renderer'
import { ViceAudio } from './engine/viceAudio'
import { ViceGame } from './game/viceGame'
import { LoadingScreen } from './components/LoadingScreen'

function nextFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()))
}

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#game')!
  const root = document.querySelector<HTMLElement>('#ui')!
  const params = new URLSearchParams(window.location.search)
  const fastAutoStart = params.get('autostart') === '1'

  const loader = fastAutoStart ? null : new LoadingScreen(document.body)
  loader?.setStage({
    percent: 18,
    label: 'INITIALIZING ENGINE',
    detail: 'Configuring WebGL pipeline, lighting & post-processing…',
  })
  if (!fastAutoStart) await nextFrame()

  const quality = suggestQuality()
  const renderer = new Renderer(canvas, quality)
  const input = new Input(canvas)
  const audio = new ViceAudio()

  loader?.setStage({
    percent: 48,
    label: 'STREAMING LEONIDA & VICE BAY',
    detail: 'Constructing 20 enterable stores, streets, traffic & patrol grids…',
  })
  if (!fastAutoStart) await nextFrame()

  const game = new ViceGame(renderer, input, audio, root)

  loader?.setStage({
    percent: 82,
    label: 'WARMING SHADERS & PHYSICS',
    detail: 'Pre-compiling PBR reflections, ragdoll rigs & ballistic systems…',
  })
  if (!fastAutoStart) await nextFrame()

  game.step(1 / 60)
  if (!renderer.isSoftwareGl) {
    renderer.precompile(game.world.scene, game.camera)
  }

  const loop = new GameLoop({
    beforeFrame: dt => input.update(dt),
    step: dt => game.step(dt),
    render: (_alpha, dt) => game.render(dt),
  })

  const unlockOnce = () => {
    audio.unlock()
  }
  window.addEventListener('pointerdown', unlockOnce, { once: true, passive: true })
  window.addEventListener('touchstart', unlockOnce, { once: true, passive: true })
  window.addEventListener('keydown', unlockOnce, { once: true })

  canvas.addEventListener('click', () => {
    if (game.mode === 'playing') input.lockPointer()
  })

  game.enterDirectlyIntoGame()
  loop.start()
  ;(window as unknown as { __game: unknown }).__game = { game, input }

  if (loader) {
    await loader.finishAndEnter()
  }
}

boot().catch(error => {
  console.error(error)
  const root = document.querySelector<HTMLElement>('#ui')
  if (root) root.textContent = `Unable to start Vice Bay Nights: ${String(error)}`
})
