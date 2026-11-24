import * as THREE from 'three'
import type { WorldCollider, WorldRamp } from './viceWorld'

const _ray = new THREE.Ray()
const _box = new THREE.Box3()
const _hit = new THREE.Vector3()
const _dir = new THREE.Vector3()

/** Resolve a circle-footprint actor against rotated OBB world colliders with smooth wall sliding. */
export function resolvePlayerCollision(
  position: THREE.Vector3,
  _previous: THREE.Vector3,
  colliders: WorldCollider[],
  radius = 0.44,
): boolean {
  let hit = false
  for (let pass = 0; pass < 2; pass++) {
    for (const collider of colliders) {
      const top = collider.center.y + collider.halfExtents.y
      const bottom = collider.center.y - collider.halfExtents.y
      if (position.y >= top - 0.18 || position.y + 1.8 <= bottom) continue
      const dx = position.x - collider.center.x
      const dz = position.z - collider.center.z
      const limit = Math.max(collider.halfExtents.x, collider.halfExtents.z) + radius + 0.5
      if (Math.abs(dx) > limit || Math.abs(dz) > limit) continue

      const c = Math.cos(collider.rotationY)
      const s = Math.sin(collider.rotationY)
      // Transform into collider local space
      const lx = dx * c - dz * s
      const lz = dx * s + dz * c
      const hx = collider.halfExtents.x
      const hz = collider.halfExtents.z

      const cx = THREE.MathUtils.clamp(lx, -hx, hx)
      const cz = THREE.MathUtils.clamp(lz, -hz, hz)
      let px = lx - cx
      let pz = lz - cz
      const distSq = px * px + pz * pz

      if (distSq >= radius * radius) continue

      hit = true
      let pushLx = 0
      let pushLz = 0
      if (distSq > 1e-6) {
        const dist = Math.sqrt(distSq)
        const push = radius - dist
        pushLx = (px / dist) * push
        pushLz = (pz / dist) * push
      } else {
        // Center is inside the box; push out along the shallowest axis
        const penX = hx - Math.abs(lx)
        const penZ = hz - Math.abs(lz)
        if (penX < penZ) {
          pushLx = (lx >= 0 ? 1 : -1) * (penX + radius)
        } else {
          pushLz = (lz >= 0 ? 1 : -1) * (penZ + radius)
        }
      }
      // Rotate push back to world space
      position.x += pushLx * c + pushLz * s
      position.z += -pushLx * s + pushLz * c
    }
  }
  return hit
}

export type VehicleCollisionResult = {
  hit: boolean
  impactSpeed: number
  contact: THREE.Vector3
  normalX: number
  normalZ: number
}

/** Resolve a vehicle's multi-circle chassis against solid world OBBs, returning wall-slide normal and impact speed. */
export function resolveVehicleWorldCollision(
  position: THREE.Vector3,
  heading: number,
  halfWidth: number,
  halfLength: number,
  colliders: WorldCollider[],
  velocity: THREE.Vector3,
  isHelicopter = false,
): VehicleCollisionResult {
  const result: VehicleCollisionResult = {
    hit: false,
    impactSpeed: 0,
    contact: new THREE.Vector3(),
    normalX: 0,
    normalZ: 0,
  }
  const fwdX = -Math.sin(heading)
  const fwdZ = -Math.cos(heading)
  const bodyRadius = Math.max(0.5, halfWidth * 0.96)
  const sampleOffset = Math.max(0, halfLength - bodyRadius * 0.72)
  const offsets = sampleOffset > 0.25 ? [-sampleOffset, 0, sampleOffset] : [0]
  const actorHeight = isHelicopter ? 2.4 : 1.7

  for (let pass = 0; pass < 2; pass++) {
    for (const collider of colliders) {
      const top = collider.center.y + collider.halfExtents.y
      const bottom = collider.center.y - collider.halfExtents.y
      if (position.y >= top - 0.15 || position.y + actorHeight <= bottom) continue

      const roughLimit = Math.max(collider.halfExtents.x, collider.halfExtents.z) + halfLength + bodyRadius + 0.5
      if (Math.abs(position.x - collider.center.x) > roughLimit || Math.abs(position.z - collider.center.z) > roughLimit) continue

      const c = Math.cos(collider.rotationY)
      const s = Math.sin(collider.rotationY)
      const hx = collider.halfExtents.x
      const hz = collider.halfExtents.z

      for (const offset of offsets) {
        const sx = position.x + fwdX * offset
        const sz = position.z + fwdZ * offset
        const dx = sx - collider.center.x
        const dz = sz - collider.center.z
        const lx = dx * c - dz * s
        const lz = dx * s + dz * c

        const cx = THREE.MathUtils.clamp(lx, -hx, hx)
        const cz = THREE.MathUtils.clamp(lz, -hz, hz)
        const px = lx - cx
        const pz = lz - cz
        const distSq = px * px + pz * pz
        if (distSq >= bodyRadius * bodyRadius) continue

        let pushLx = 0
        let pushLz = 0
        let nLx = 0
        let nLz = 0
        if (distSq > 1e-6) {
          const dist = Math.sqrt(distSq)
          const push = bodyRadius - dist
          nLx = px / dist
          nLz = pz / dist
          pushLx = nLx * push
          pushLz = nLz * push
        } else {
          const penX = hx - Math.abs(lx)
          const penZ = hz - Math.abs(lz)
          if (penX < penZ) {
            nLx = lx >= 0 ? 1 : -1
            pushLx = nLx * (penX + bodyRadius)
          } else {
            nLz = lz >= 0 ? 1 : -1
            pushLz = nLz * (penZ + bodyRadius)
          }
        }

        const wx = pushLx * c + pushLz * s
        const wz = -pushLx * s + pushLz * c
        const nWx = nLx * c + nLz * s
        const nWz = -nLx * s + nLz * c

        position.x += wx
        position.z += wz

        const vn = velocity.x * nWx + velocity.z * nWz
        if (vn < 0) {
          const impact = -vn
          if (impact > result.impactSpeed) {
            result.impactSpeed = impact
            result.normalX = nWx
            result.normalZ = nWz
            result.contact.set(sx - nWx * bodyRadius, position.y + 0.7, sz - nWz * bodyRadius)
          }
          // Slide smoothly along walls with mild restitution and scrape damping
          const restitution = impact > 8 ? 0.22 : 0.08
          velocity.x -= (1 + restitution) * vn * nWx
          velocity.z -= (1 + restitution) * vn * nWz
          velocity.x *= 0.94
          velocity.z *= 0.94
        }
        result.hit = true
      }
    }
  }
  return result
}

/** Support height (ramps + walkable container/building tops) underneath (x, z) for the given currentY. */
export function supportHeightAt(
  x: number,
  z: number,
  currentY: number,
  colliders: WorldCollider[],
  ramps: WorldRamp[],
  baseFloor = 0,
): number {
  let floor = baseFloor
  for (const ramp of ramps) {
    const dx = x - ramp.position.x
    const dz = z - ramp.position.z
    const c = Math.cos(ramp.rotationY)
    const s = Math.sin(ramp.rotationY)
    const lx = dx * c - dz * s
    const lz = dx * s + dz * c
    if (Math.abs(lx) <= ramp.width * 0.52 && Math.abs(lz) <= ramp.length * 0.52) {
      // Ramp rises from +Z/2 (base) to -Z/2 (peak) when rotationY = 0
      const t = THREE.MathUtils.clamp((ramp.length * 0.5 - lz) / ramp.length, 0, 1)
      const h = ramp.position.y + t * ramp.rise
      if (currentY >= h - 0.85) floor = Math.max(floor, h)
    }
  }
  for (const collider of colliders) {
    if (collider.kind === 'tree') continue
    const top = collider.center.y + collider.halfExtents.y
    if (top > 12 || currentY < top - 0.45) continue
    const dx = x - collider.center.x
    const dz = z - collider.center.z
    const c = Math.cos(collider.rotationY)
    const s = Math.sin(collider.rotationY)
    const lx = dx * c - dz * s
    const lz = dx * s + dz * c
    if (Math.abs(lx) <= collider.halfExtents.x + 0.15 && Math.abs(lz) <= collider.halfExtents.z + 0.15) {
      floor = Math.max(floor, top)
    }
  }
  return floor
}

/** Distance to the first solid world footprint along a shot ray. */
export function worldRayDistance(origin: THREE.Vector3, direction: THREE.Vector3, colliders: WorldCollider[], range: number): number {
  let nearest = range
  for (const collider of colliders) {
    const dx = origin.x - collider.center.x
    const dz = origin.z - collider.center.z
    const c = Math.cos(collider.rotationY)
    const s = Math.sin(collider.rotationY)
    _ray.origin.set(dx * c - dz * s, origin.y - collider.center.y, dx * s + dz * c)
    _ray.direction.set(direction.x * c - direction.z * s, direction.y, direction.x * s + direction.z * c)
    _box.min.copy(collider.halfExtents).negate()
    _box.max.copy(collider.halfExtents)
    if (_box.containsPoint(_ray.origin)) return 0
    if (_ray.intersectBox(_box, _hit)) nearest = Math.min(nearest, _hit.distanceTo(_ray.origin))
  }
  return nearest
}

/** True if no building/container blocks direct line-of-sight between two world points. */
export function hasLineOfSight(from: THREE.Vector3, to: THREE.Vector3, colliders: WorldCollider[]): boolean {
  _dir.subVectors(to, from)
  const dist = _dir.length()
  if (dist < 0.05) return true
  _dir.multiplyScalar(1 / dist)
  return worldRayDistance(from, _dir, colliders, dist) >= dist - 0.35
}
