import * as THREE from 'three'

export type RagdollState = 'upright' | 'stumble' | 'falling' | 'down_writhing' | 'recovering' | 'sleeping'
export type RagdollHitZone = 'head' | 'torso' | 'arm' | 'leg'

export type RagdollRig = {
  state: RagdollState
  velocity: THREE.Vector3
  angularVel: THREE.Vector3
  stateTimer: number
  sleepTimer: number
  woundZone: RagdollHitZone
  woundSide: number
  lethal: boolean
  armFlailPhase: number
  curbTripCooldown: number
  grabbingSupport: boolean
  droppedWeapon: boolean
}

export type RagdollBodyNodes = {
  root: THREE.Object3D
  model: THREE.Object3D
  leftArm: THREE.Object3D
  rightArm: THREE.Object3D
  leftLeg: THREE.Object3D
  rightLeg: THREE.Object3D
}

const damp = THREE.MathUtils.damp
const clamp = THREE.MathUtils.clamp

export function createRagdollRig(): RagdollRig {
  return {
    state: 'upright',
    velocity: new THREE.Vector3(),
    angularVel: new THREE.Vector3(),
    stateTimer: 0,
    sleepTimer: 0,
    woundZone: 'torso',
    woundSide: 1,
    lethal: false,
    armFlailPhase: 0,
    curbTripCooldown: 0,
    grabbingSupport: false,
    droppedWeapon: false,
  }
}

/**
 * Apply a localized Euphoria-style procedural impulse:
 * - Light/medium shoulder or calf hits trigger active balance recovery (`stumble` + arm windmilling).
 * - Heavy shotgun/vehicle impacts or fatal hits trigger full procedural tumble (`falling` -> `down_writhing` -> `sleeping`).
 */
export function applyRagdollImpulse(
  rig: RagdollRig,
  actorPos: THREE.Vector3,
  impulseOrigin: THREE.Vector3,
  force: number,
  zone: RagdollHitZone,
  lethal: boolean,
  isRunning = false,
): { knockedOffFeet: boolean; droppedWeapon: boolean } {
  let dx = actorPos.x - impulseOrigin.x
  let dz = actorPos.z - impulseOrigin.z
  const dist = Math.hypot(dx, dz)
  if (dist < 0.01) {
    dx = 0.3
    dz = 0.95
  } else {
    dx /= dist
    dz /= dist
  }

  rig.woundZone = zone
  rig.woundSide = (impulseOrigin.x - actorPos.x) >= 0 ? 1 : -1
  rig.lethal = rig.lethal || lethal
  rig.sleepTimer = 0
  rig.armFlailPhase = 0

  const speedBoost = clamp(force, 1.5, 18)
  rig.velocity.set(dx * speedBoost * 0.72, 0, dz * speedBoost * 0.72)

  // Calf shot while running trips victim face-first; shotgun blast lifts off feet
  const legTrip = zone === 'leg' && (isRunning || force >= 5.5)
  const heavyKnock = lethal || force >= 7.2 || legTrip

  let knockedOffFeet = false
  if (heavyKnock) {
    rig.state = 'falling'
    rig.stateTimer = lethal ? 8.5 : 4.8
    rig.velocity.y = clamp(force * 0.28, 1.2, 5.2)
    rig.angularVel.set(
      (zone === 'leg' ? 4.8 : -3.4) * (force / 7),
      rig.woundSide * 2.2,
      rig.woundSide * 3.1,
    )
    knockedOffFeet = true
  } else {
    rig.state = 'stumble'
    rig.stateTimer = 0.85 + Math.min(0.9, force * 0.12)
    rig.angularVel.set(zone === 'torso' ? -1.8 : 1.2, rig.woundSide * 1.4, rig.woundSide * 1.9)
  }

  const shouldDrop = !rig.droppedWeapon && (heavyKnock || zone === 'arm')
  if (shouldDrop) rig.droppedWeapon = true
  return { knockedOffFeet, droppedWeapon: shouldDrop }
}

/** Check whether a stumbling NPC trips over raised Vice Bay curbs around x = +-10.1m. */
export function checkCurbTrip(rig: RagdollRig, pos: THREE.Vector3): boolean {
  if (rig.state !== 'stumble' || rig.curbTripCooldown > 0) return false
  const nearCurb = Math.abs(Math.abs(pos.x) - 10.1) < 0.55 || Math.abs(Math.abs(pos.x) - 7.8) < 0.45
  if (!nearCurb) return false
  rig.curbTripCooldown = 1.8
  rig.state = 'falling'
  rig.stateTimer = 3.2
  rig.velocity.y = 2.0
  rig.angularVel.x = 5.4
  return true
}

/** Advance active ragdoll pose & physics; automatically enters `sleeping` once settled for 60 FPS perf. */
export function stepRagdoll(
  rig: RagdollRig,
  nodes: RagdollBodyNodes,
  dt: number,
  groundY = 0.04,
  nearbySupport = false,
): void {
  rig.curbTripCooldown = Math.max(0, rig.curbTripCooldown - dt)
  if (rig.state === 'upright' || rig.state === 'sleeping') return

  rig.armFlailPhase += dt * (rig.state === 'stumble' ? 14 : 9)
  rig.stateTimer = Math.max(0, rig.stateTimer - dt)
  rig.grabbingSupport = nearbySupport && rig.state === 'stumble'

  const pos = nodes.root.position
  pos.x += rig.velocity.x * dt
  pos.z += rig.velocity.z * dt

  if (rig.state === 'falling' || pos.y > groundY || rig.velocity.y > 0) {
    rig.velocity.y -= 17.5 * dt
    pos.y += rig.velocity.y * dt
    if (pos.y <= groundY) {
      pos.y = groundY
      if (rig.velocity.y < -3.2) {
        rig.velocity.y = Math.abs(rig.velocity.y) * 0.24
      } else {
        rig.velocity.y = 0
      }
      rig.velocity.x *= 0.62
      rig.velocity.z *= 0.62
      if (rig.state === 'falling' && Math.hypot(rig.velocity.x, rig.velocity.z) < 2.2) {
        rig.state = rig.lethal ? 'sleeping' : 'down_writhing'
        rig.stateTimer = rig.lethal ? 7.5 : 3.8
      }
    }
  } else {
    rig.velocity.x *= Math.exp(-5.2 * dt)
    rig.velocity.z *= Math.exp(-5.2 * dt)
  }

  if (rig.state === 'stumble') {
    checkCurbTrip(rig, pos)
    const sway = Math.sin(rig.armFlailPhase) * 0.85
    // Windmilling arms & reaching toward wound or nearby hood/railing
    if (rig.grabbingSupport) {
      nodes.leftArm.rotation.x = damp(nodes.leftArm.rotation.x, -1.65, 10, dt)
      nodes.rightArm.rotation.x = damp(nodes.rightArm.rotation.x, -1.45, 10, dt)
    } else if (rig.woundZone === 'torso' || rig.woundZone === 'arm') {
      nodes.leftArm.rotation.x = damp(nodes.leftArm.rotation.x, -0.9 + sway * 0.4, 12, dt)
      nodes.rightArm.rotation.x = damp(nodes.rightArm.rotation.x, -1.2 - sway * 0.6, 12, dt)
      nodes.leftArm.rotation.z = damp(nodes.leftArm.rotation.z, 0.55 + sway * 0.35, 12, dt)
      nodes.rightArm.rotation.z = damp(nodes.rightArm.rotation.z, -0.55 - sway * 0.35, 12, dt)
    } else {
      nodes.leftArm.rotation.x = damp(nodes.leftArm.rotation.x, -1.2 + sway, 14, dt)
      nodes.rightArm.rotation.x = damp(nodes.rightArm.rotation.x, -1.2 - sway, 14, dt)
    }
    nodes.model.rotation.x = damp(nodes.model.rotation.x, rig.woundZone === 'torso' ? -0.34 : 0.28, 10, dt)
    nodes.model.rotation.z = damp(nodes.model.rotation.z, rig.woundSide * 0.28 + sway * 0.14, 10, dt)
    nodes.leftLeg.rotation.x = Math.sin(rig.armFlailPhase * 0.7) * 0.65
    nodes.rightLeg.rotation.x = -Math.sin(rig.armFlailPhase * 0.7) * 0.65

    if (rig.stateTimer <= 0) {
      rig.state = 'recovering'
      rig.stateTimer = 0.45
    }
  } else if (rig.state === 'falling') {
    const pitchTarget = rig.woundZone === 'leg' ? 1.42 : -1.45
    nodes.model.rotation.x = damp(nodes.model.rotation.x, pitchTarget, 7, dt)
    nodes.model.rotation.z = damp(nodes.model.rotation.z, rig.woundSide * 1.1, 7, dt)
    nodes.model.position.y = damp(nodes.model.position.y, 0.18, 9, dt)
    nodes.leftArm.rotation.x = -1.7 + Math.sin(rig.armFlailPhase * 1.4) * 0.7
    nodes.rightArm.rotation.x = -1.7 - Math.sin(rig.armFlailPhase * 1.4) * 0.7
    nodes.leftLeg.rotation.x = Math.cos(rig.armFlailPhase) * 0.5
    nodes.rightLeg.rotation.x = -Math.cos(rig.armFlailPhase) * 0.5
  } else if (rig.state === 'down_writhing') {
    // Non-lethal wounded NPC clutches wound and slowly crawls/writhes
    nodes.model.rotation.x = damp(nodes.model.rotation.x, 1.38, 6, dt)
    nodes.model.rotation.z = damp(nodes.model.rotation.z, rig.woundSide * 0.42 + Math.sin(rig.armFlailPhase * 0.45) * 0.14, 6, dt)
    nodes.model.position.y = damp(nodes.model.position.y, 0.14, 8, dt)
    nodes.rightArm.rotation.x = -1.05 + Math.sin(rig.armFlailPhase * 0.6) * 0.25
    nodes.leftArm.rotation.x = -0.65 + Math.cos(rig.armFlailPhase * 0.5) * 0.3
    nodes.leftLeg.rotation.x = 0.28 + Math.sin(rig.armFlailPhase * 0.5) * 0.22
    nodes.rightLeg.rotation.x = -0.15 - Math.sin(rig.armFlailPhase * 0.5) * 0.22
    if (rig.stateTimer <= 0) {
      rig.state = rig.lethal ? 'sleeping' : 'recovering'
      rig.stateTimer = 0.8
    }
  } else if (rig.state === 'recovering') {
    nodes.model.rotation.x = damp(nodes.model.rotation.x, 0, 8, dt)
    nodes.model.rotation.z = damp(nodes.model.rotation.z, 0, 8, dt)
    nodes.model.position.y = damp(nodes.model.position.y, 0, 8, dt)
    nodes.leftArm.rotation.z = damp(nodes.leftArm.rotation.z, 0, 8, dt)
    nodes.rightArm.rotation.z = damp(nodes.rightArm.rotation.z, 0, 8, dt)
    if (rig.stateTimer <= 0) {
      rig.state = 'upright'
      nodes.model.rotation.set(0, 0, 0)
      nodes.model.position.y = 0
    }
  }

  // Sleep settled bodies so idle downed corpses cost zero physics cycles
  if (rig.state === 'down_writhing' && rig.lethal && Math.hypot(rig.velocity.x, rig.velocity.z) < 0.08) {
    rig.sleepTimer += dt
    if (rig.sleepTimer > 1.2) rig.state = 'sleeping'
  }
}
