import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { Quality } from './save'

type Preset = { pixelRatio: number; shadows: boolean; shadowMap: number; bloom: boolean; antialias: boolean }
export const QUALITY_PRESETS: Record<Quality, Preset> = {
  low: { pixelRatio: 1, shadows: false, shadowMap: 512, bloom: false, antialias: false },
  medium: { pixelRatio: 1.5, shadows: true, shadowMap: 2048, bloom: true, antialias: true },
  high: { pixelRatio: 2, shadows: true, shadowMap: 2048, bloom: true, antialias: true },
}

export function detectSoftwareWebGL(): boolean {
  try {
    const probe = document.createElement('canvas')
    const gl = probe.getContext('webgl2')
    if (!gl) return true
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER
    const gpu = String(gl.getParameter(param) || '')
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu)
  } catch {
    return false
  }
}

/** Pick a starting quality from device hints; the player can override it in Settings. */
export function suggestQuality(): Quality {
  if (detectSoftwareWebGL()) return 'low'
  const coarse = matchMedia('(pointer: coarse)').matches
  const cores = navigator.hardwareConcurrency ?? 4
  if (coarse || cores <= 4) return 'medium'
  return 'high'
}

/**
 * Owns the WebGL renderer, environment reflections, post-processing chain and resize handling.
 * Scenes call `render(scene, camera)`; they never touch the composer directly.
 */
export class Renderer {
  readonly gl: THREE.WebGLRenderer
  readonly isSoftwareGl: boolean
  private composer?: EffectComposer
  private bloom?: UnrealBloomPass
  private preset: Preset
  private scene?: THREE.Scene
  private camera?: THREE.PerspectiveCamera
  private envTarget?: THREE.WebGLRenderTarget
  private envScene?: THREE.Scene

  constructor(readonly canvas: HTMLCanvasElement, quality: Quality) {
    this.isSoftwareGl = detectSoftwareWebGL()
    this.preset = QUALITY_PRESETS[quality]
    this.gl = new THREE.WebGLRenderer({
      canvas,
      antialias: !this.isSoftwareGl && this.preset.antialias,
      powerPreference: 'high-performance',
    })
    this.gl.outputColorSpace = THREE.SRGBColorSpace
    this.gl.toneMapping = THREE.ACESFilmicToneMapping
    this.gl.toneMappingExposure = 1.08
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap
    this.applyQuality(quality)
    window.addEventListener('resize', () => this.resize())
  }

  get shadowMapSize(): number {
    return this.preset.shadowMap
  }

  /** Attach a procedural PBR studio reflection environment so metallic vehicles and wet streets catch realistic highlights. */
  attachEnvironment(scene: THREE.Scene): void {
    if (this.envScene === scene && this.envTarget) return
    this.envTarget?.dispose()
    const pmrem = new THREE.PMREMGenerator(this.gl)
    const room = new RoomEnvironment()
    this.envTarget = pmrem.fromScene(room, 0.04)
    scene.environment = this.envTarget.texture
    scene.environmentIntensity = 0.65
    room.dispose()
    pmrem.dispose()
    this.envScene = scene
  }

  applyQuality(quality: Quality): void {
    this.preset = QUALITY_PRESETS[quality]
    this.gl.shadowMap.enabled = !this.isSoftwareGl && this.preset.shadows
    this.gl.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, this.preset.pixelRatio))
    this.bloom?.dispose()
    this.composer?.dispose()
    this.composer = undefined
    this.bloom = undefined
    this.resize()
  }

  private ensureComposer(scene: THREE.Scene, camera: THREE.PerspectiveCamera): EffectComposer | undefined {
    if (!this.preset.bloom || this.isSoftwareGl) return undefined
    if (this.composer && this.scene === scene && this.camera === camera) return this.composer
    this.scene = scene
    this.camera = camera
    const size = this.gl.getSize(new THREE.Vector2())
    this.composer = new EffectComposer(this.gl)
    this.composer.addPass(new RenderPass(scene, camera))
    this.composer.addPass(new ShaderPass({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){vec4 c=texture2D(tDiffuse,vUv); if(!(c.r>=0.0 || c.r<0.0)) c.r=0.0; if(!(c.g>=0.0 || c.g<0.0)) c.g=0.0; if(!(c.b>=0.0 || c.b<0.0)) c.b=0.0; gl_FragColor=vec4(clamp(c.rgb,0.0,16.0),c.a);}',
    }))
    this.bloom = new UnrealBloomPass(size, 0.36, 0.28, 1.35)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())
    this.composer.setSize(size.x, size.y)
    return this.composer
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    this.gl.setSize(w, h, false)
    this.composer?.setSize(w, h)
    if (this.camera) {
      this.camera.aspect = w / h
      this.camera.updateProjectionMatrix()
    }
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    if (Math.abs(camera.aspect - w / h) > 1e-3) {
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    const composer = this.ensureComposer(scene, camera)
    if (composer) composer.render()
    else this.gl.render(scene, camera)
  }

  /** Pre-compile all materials/shaders into WebGL during the loading screen to eliminate first-frame stutter. */
  precompile(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    try {
      this.gl.compile(scene, camera)
      this.render(scene, camera)
    } catch {
      // Safe fallback in headless/mocked environments
    }
  }
}
