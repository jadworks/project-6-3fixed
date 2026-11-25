import * as THREE from 'three'
import { CONFIG } from './config'
import { tuning } from './tuning'
import type { WeaponCategoryId } from './weapons'

const material = (color: number, roughness = 0.86, metalness = 0.08) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness })

function makeFootShadow(): THREE.Texture {
  if (typeof document === 'undefined') {
    const data = new Uint8Array([0, 0, 0, 120])
    const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat)
    tex.needsUpdate = true
    return tex
  }
  const canvas = document.createElement('canvas')
  canvas.width = 48
  canvas.height = 48
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const grad = ctx.createRadialGradient(24, 24, 3, 24, 24, 22)
    grad.addColorStop(0, 'rgba(6, 8, 14, 0.72)')
    grad.addColorStop(1, 'rgba(6, 8, 14, 0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 48, 48)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export class VicePlayer {
  readonly root = new THREE.Group()
  readonly velocity = new THREE.Vector3()
  private readonly torso = new THREE.Group()
  private readonly shirtMesh: THREE.Mesh
  private readonly jacketMesh: THREE.Mesh
  private readonly leftArm: THREE.Mesh
  private readonly rightArm: THREE.Mesh
  private readonly leftLeg: THREE.Mesh
  private readonly rightLeg: THREE.Mesh
  private readonly weaponGroup = new THREE.Group()
  private readonly slingGroup = new THREE.Group()
  private readonly contactShadow: THREE.Mesh
  private vertical = 0
  private gait = 0
  private hitTime = 0
  private swingTime = 0
  private aimingPose = false
  private grounded = true
  private weaponKey = ''
  private slingKey = ''
  upgrade = 0

  constructor(spawn: THREE.Vector3) {
    this.root.position.copy(spawn)
    const skin = material(0xb8795d), shirt = material(0x49b9be), trousers = material(0x222944), hair = material(0x211916)
    const jacket = material(0x17263d)
    const mesh = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
      const part = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
      part.position.set(x, y, z); part.castShadow = true; part.receiveShadow = true; return part
    }
    this.root.add(this.torso)
    this.shirtMesh = mesh(.74, .83, .4, shirt, 0, 1.48, 0)
    this.jacketMesh = mesh(.84, .12, .44, jacket, 0, 1.88, 0)
    this.torso.add(this.shirtMesh, this.jacketMesh)
    this.torso.add(mesh(.48, .53, .43, skin, 0, 2.2, 0))
    this.torso.add(mesh(.5, .16, .45, hair, 0, 2.49, .02))
    this.torso.add(mesh(.33, .1, .045, material(0x1b1722), 0, 2.23, -.238))
    this.leftArm = mesh(.2, .78, .23, skin, -.49, 1.47, 0)
    this.rightArm = mesh(.2, .78, .23, skin, .49, 1.47, 0)
    this.leftLeg = mesh(.28, .82, .3, trousers, -.19, .47, 0)
    this.rightLeg = mesh(.28, .82, .3, trousers, .19, .47, 0)

    this.weaponGroup.position.set(.5, 1.24, -.16)
    this.slingGroup.position.set(0, 1.5, .24)
    this.slingGroup.rotation.set(0, 0, 0.52)
    this.torso.add(this.leftArm, this.rightArm, this.weaponGroup, this.slingGroup)
    this.root.add(this.leftLeg, this.rightLeg)
    this.setWeaponVisual('handgun', 'pistol', false, 'carbine')

    this.contactShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.15, 1.15),
      new THREE.MeshBasicMaterial({ map: makeFootShadow(), transparent: true, opacity: 0.6, depthWrite: false }),
    )
    this.contactShadow.rotation.x = -Math.PI / 2
    this.contactShadow.position.y = 0.03
    this.root.add(this.contactShadow)
  }

  /** Dynamically sculpt player silhouette based on San Andreas Muscle & Fat RPG stats (0..100). */
  setPhysique(muscle: number, fat: number): void {
    const m = Math.max(0, Math.min(1, muscle / 100))
    const f = Math.max(0, Math.min(1, fat / 100))
    const width = 0.94 + m * 0.24 + f * 0.22
    const depth = 0.95 + m * 0.14 + f * 0.34
    this.shirtMesh.scale.set(width, 1, depth)
    this.jacketMesh.scale.set(0.96 + m * 0.24 + f * 0.14, 1, 0.96 + m * 0.14 + f * 0.22)
    const armScale = 0.92 + m * 0.34 + f * 0.12
    this.leftArm.scale.set(armScale, 1, armScale)
    this.rightArm.scale.set(armScale, 1, armScale)
    this.leftArm.position.x = -0.49 - m * 0.06 - f * 0.05
    this.rightArm.position.x = 0.49 + m * 0.06 + f * 0.05
  }

  setAiming(aiming: boolean): void {
    this.aimingPose = aiming
  }

  triggerSwing(): void {
    this.swingTime = 0.28
  }

  /** Build procedural 3D held weapon + optional back-slung long gun. */
  setWeaponVisual(category: WeaponCategoryId, weaponId: string, suppressed: boolean, backSlingId: string | null): void {
    const nextKey = `${category}:${weaponId}:${suppressed}`
    if (nextKey !== this.weaponKey) {
      this.weaponKey = nextKey
      this.clearGroup(this.weaponGroup)
      const steel = material(0x1f252e, 0.35, 0.78)
      const trim = material(0x4b5563, 0.48, 0.55)
      const wood = material(0x6d472b, 0.82, 0.05)
      const addPart = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
        const part = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
        part.position.set(x, y, z)
        part.castShadow = true
        this.weaponGroup.add(part)
        return part
      }

      if (weaponId === 'fists') {
        // Bare fists: nothing extra in hand
      } else if (category === 'melee') {
        if (weaponId === 'knife') {
          addPart(0.05, 0.06, 0.16, trim, 0, 0, -0.06)
          addPart(0.03, 0.05, 0.34, material(0xcfd9e3, 0.22, 0.9), 0, 0.01, -0.28)
        } else {
          addPart(0.08, 0.08, 0.88, weaponId === 'bat' ? wood : material(0xb33b3b, 0.45, 0.7), 0, 0.12, -0.35)
        }
      } else if (category === 'handgun') {
        addPart(0.1, 0.14, 0.38, steel, 0, 0, -0.16)
        addPart(0.11, 0.22, 0.11, trim, 0, -0.15, -0.02)
        if (suppressed) addPart(0.08, 0.08, 0.26, material(0x11151b, 0.4, 0.75), 0, 0.02, -0.46)
      } else if (category === 'smg') {
        addPart(0.12, 0.18, 0.54, steel, 0, 0.02, -0.22)
        addPart(0.09, 0.26, 0.1, trim, 0, -0.16, -0.14)
        addPart(0.08, 0.2, 0.1, trim, 0, -0.14, 0.02)
        if (suppressed) addPart(0.08, 0.08, 0.24, material(0x11151b, 0.4, 0.75), 0, 0.03, -0.58)
      } else if (category === 'shotgun') {
        addPart(0.12, 0.15, 0.92, steel, 0, 0.03, -0.34)
        addPart(0.13, 0.14, 0.32, wood, 0, -0.01, 0.18)
        addPart(0.13, 0.12, 0.26, wood, 0, -0.04, -0.4)
      } else if (category === 'rifle' || category === 'precision') {
        addPart(0.12, 0.17, 1.0, weaponId === 'ak_rifle' ? wood : steel, 0, 0.03, -0.38)
        addPart(0.08, 0.28, 0.12, trim, 0, -0.18, -0.26)
        addPart(0.09, 0.09, 0.34, trim, 0, 0.15, -0.22)
        if (suppressed) addPart(0.08, 0.08, 0.28, material(0x11151b, 0.4, 0.75), 0, 0.04, -0.96)
      } else if (category === 'heavy') {
        addPart(0.24, 0.24, 0.85, material(0x2c362c, 0.55, 0.5), 0, 0.04, -0.34)
        addPart(0.28, 0.28, 0.34, trim, 0, 0.04, -0.28)
      } else {
        addPart(0.16, 0.2, 0.16, material(weaponId === 'flashbang' ? 0x9bb3c7 : 0x3b4d38, 0.5, 0.55), 0, 0, -0.1)
      }
    }

    const showSling = Boolean(backSlingId && backSlingId !== weaponId && category !== 'rifle' && category !== 'precision' && category !== 'shotgun')
    const nextSling = showSling ? String(backSlingId) : 'none'
    if (nextSling !== this.slingKey) {
      this.slingKey = nextSling
      this.clearGroup(this.slingGroup)
      if (showSling) {
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.96, 0.12), material(0x1f252e, 0.42, 0.72))
        body.castShadow = true
        const strap = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.65, 0.04), material(0x3a3228, 0.85, 0.1))
        strap.position.set(0.05, 0, -0.05)
        this.slingGroup.add(body, strap)
      }
    }
  }

  private clearGroup(g: THREE.Group): void {
    while (g.children.length > 0) {
      const child = g.children[0]
      g.remove(child)
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose()
      }
    }
  }

  update(dt: number, moveX: number, moveY: number, yaw: number, sprint: boolean, crouch: boolean, jump: boolean, swimming: boolean, supportY = 0): void {
    const sx = Math.sin(yaw), cz = Math.cos(yaw)
    const dx = moveX * cz - moveY * sx
    const dz = -moveX * sx - moveY * cz
    const length = Math.hypot(dx, dz)
    const speed = swimming ? 3.2 : crouch ? 2.6 : sprint ? CONFIG.player.sprintSpeed + this.upgrade : CONFIG.player.walkSpeed
    const desiredX = length > .01 ? dx / Math.max(1, length) * speed : 0
    const desiredZ = length > .01 ? dz / Math.max(1, length) * speed : 0
    const blend = 1 - Math.exp(-Math.max(4, CONFIG.player.acceleration / 5) * (this.grounded ? 1 : CONFIG.player.airControl) * dt)
    this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, desiredX, blend)
    this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, desiredZ, blend)
    this.root.position.x = THREE.MathUtils.clamp(this.root.position.x + this.velocity.x * dt, -378, 368)
    this.root.position.z = THREE.MathUtils.clamp(this.root.position.z + this.velocity.z * dt, -378, 378)
    if ((length > .05 || this.aimingPose) && this.hitTime <= 0) {
      const target = this.aimingPose ? yaw : Math.atan2(-dx, -dz)
      this.root.rotation.y += Math.atan2(Math.sin(target - this.root.rotation.y), Math.cos(target - this.root.rotation.y)) * Math.min(1, dt * 14)
    }
    if (jump && this.grounded && !swimming) { tuning.activate('jump'); this.vertical = CONFIG.player.jumpSpeed * .65; this.grounded = false }
    this.vertical -= 18 * dt
    const floor = swimming ? -.75 : supportY
    this.root.position.y += this.vertical * dt
    if (this.root.position.y <= floor) { this.root.position.y = floor; this.vertical = 0; this.grounded = true }
    else if (this.root.position.y > floor + 0.08) this.grounded = false
    this.contactShadow.visible = !swimming
    this.contactShadow.position.y = Math.max(0.03, floor - this.root.position.y + 0.03)
    const heightGap = Math.max(0, this.root.position.y - floor)
    this.contactShadow.scale.setScalar(Math.max(0.5, 1 - heightGap * 0.12))
    this.gait += dt * (sprint ? 12 : 8) * Math.min(1, length)
    const swing = Math.sin(this.gait) * Math.min(.6, length * .6)
    this.leftLeg.rotation.x = swing; this.rightLeg.rotation.x = -swing
    this.leftArm.rotation.x = -swing * .7
    this.swingTime = Math.max(0, this.swingTime - dt)
    if (this.swingTime > 0) {
      this.rightArm.rotation.x = -1.6 + Math.sin(this.swingTime * 22) * 0.9
      this.weaponGroup.rotation.x = -0.8 + Math.sin(this.swingTime * 22) * 0.9
    } else if (this.aimingPose) {
      this.rightArm.rotation.x = -1.35
      this.weaponGroup.rotation.x = 0
    } else {
      this.rightArm.rotation.x = swing * .7
      this.weaponGroup.rotation.x = -0.18
    }
    this.torso.scale.y = crouch ? .72 : 1
    this.hitTime = Math.max(0, this.hitTime - dt)
    this.torso.rotation.z = this.hitTime > 0 ? Math.sin(this.hitTime * 18) * .18 : THREE.MathUtils.lerp(this.torso.rotation.z, 0, dt * 8)
  }

  stagger(direction: THREE.Vector3, force: number): void {
    this.hitTime = .6
    this.velocity.addScaledVector(direction, force)
    this.vertical = Math.min(5, force * .3)
    this.grounded = false
  }
}
