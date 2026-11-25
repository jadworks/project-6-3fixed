import type { User } from 'firebase/auth'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import {
  type CitySave,
  type PlayerHeatSave,
  type PlayerInventory,
  type PlayerPosition,
  sanitizeCapturedTurfs,
  sanitizeHeatSave,
  sanitizeInventory,
  sanitizePosition,
  sanitizeRpgStats,
  sanitizeWeather,
  sanitizeWeaponArsenal,
  saveCityProgress,
} from '../game/saveSystem'
import type { SanAndreasStatsSave } from '../game/sanAndreasRpg'
import type { WeaponSaveState } from '../game/weapons'
import { db, handleFirestoreError, OperationType } from './client'

export type CloudLeaderboardRow = {
  uid: string
  displayName: string
  contractsCompleted: number
  bestDurationMs: number
  lastMissionId: string
}

export type PlayerStateSnapshot = {
  position: PlayerPosition
  inventory: PlayerInventory
  heat: PlayerHeatSave
  rpgStats?: SanAndreasStatsSave
  weaponArsenal?: WeaponSaveState
  capturedTurfs?: string[]
}

const VALID_ID = /^[a-zA-Z0-9_-]{1,128}$/
const VALID_MISSION = /^[a-zA-Z0-9_-]{1,32}$/

function sanitizeDisplayName(raw: string | null | undefined, maxLen: number): string {
  const cleaned = (raw ?? 'VICE PLAYER').replace(/\s+/g, ' ').trim()
  const safe = cleaned.length > 0 ? cleaned : 'VICE PLAYER'
  return safe.slice(0, maxLen)
}

function sanitizeIdList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item === 'string' && VALID_MISSION.test(item) && !out.includes(item)) {
      out.push(item)
      if (out.length >= maxItems) break
    }
  }
  return out
}

export function mergeCitySaves(local: CitySave, remote: Partial<CitySave>): CitySave {
  const completed = sanitizeIdList([...local.completed, ...(remote.completed ?? [])], 20)
  const robbedStores = sanitizeIdList([...local.robbedStores, ...(remote.robbedStores ?? [])], 24)
  const upgrade = Math.max(local.upgrade, Number.isFinite(remote.upgrade) ? Math.min(3, Math.max(0, Math.floor(remote.upgrade!))) : 0)
  const merged: CitySave = {
    version: 1,
    money: Math.max(local.money, Number.isFinite(remote.money) ? Math.min(1_000_000_000, Math.max(0, Math.floor(remote.money!))) : 0),
    bankBalance: Math.max(local.bankBalance ?? 2500, Number.isFinite(remote.bankBalance) ? Math.min(1_000_000_000, Math.max(0, Math.floor(remote.bankBalance!))) : 0),
    uncleanedLoot: Math.max(local.uncleanedLoot ?? 0, Number.isFinite(remote.uncleanedLoot) ? Math.min(1_000_000_000, Math.max(0, Math.floor(remote.uncleanedLoot!))) : 0),
    health: Number.isFinite(remote.health) ? Math.min(100, Math.max(0, remote.health!)) : local.health,
    completed,
    upgrade,
    muted: local.muted,
    weather: sanitizeWeather(remote.weather ?? local.weather),
    robbedStores,
    seenIntro: Boolean(local.seenIntro || remote.seenIntro),
    protagonist: remote.protagonist === 'lucia' ? 'lucia' : (local.protagonist ?? 'jason'),
    partnerBond: Math.max(local.partnerBond ?? 32, Number.isFinite(remote.partnerBond) ? Math.min(100, Math.max(0, remote.partnerBond!)) : 0),
    conductScore: typeof remote.conductScore === 'number' && Number.isFinite(remote.conductScore) ? Math.min(100, Math.max(-100, remote.conductScore)) : (local.conductScore ?? 0),
    fuelEnabled: remote.fuelEnabled !== undefined ? Boolean(remote.fuelEnabled) : (local.fuelEnabled ?? true),
    trunkWeapons: local.trunkWeapons ?? remote.trunkWeapons ?? ['carbine', 'pump_shotgun'],
  }
  const position = sanitizePosition(remote.position) ?? sanitizePosition(local.position)
  const inventory = sanitizeInventory(remote.inventory, upgrade) ?? sanitizeInventory(local.inventory, upgrade)
  const heat = sanitizeHeatSave(remote.heat) ?? sanitizeHeatSave(local.heat)
  const rpgStats = sanitizeRpgStats(remote.rpgStats) ?? sanitizeRpgStats(local.rpgStats)
  const weaponArsenal = sanitizeWeaponArsenal(remote.weaponArsenal) ?? sanitizeWeaponArsenal(local.weaponArsenal)
  const capturedTurfs = sanitizeCapturedTurfs([...(local.capturedTurfs ?? []), ...(remote.capturedTurfs ?? [])])
  if (position) merged.position = position
  if (inventory) merged.inventory = inventory
  if (heat) merged.heat = heat
  if (rpgStats) merged.rpgStats = rpgStats
  if (weaponArsenal) merged.weaponArsenal = weaponArsenal
  if (capturedTurfs && capturedTurfs.length > 0) merged.capturedTurfs = capturedTurfs
  return merged
}

export async function loadCloudPlayerSave(uid: string): Promise<Partial<CitySave> | null> {
  if (!VALID_ID.test(uid)) return null
  const path = `players/${uid}`
  try {
    const snap = await getDoc(doc(db, 'players', uid))
    if (!snap.exists()) return null
    const data = snap.data()
    const upgrade = typeof data.upgrade === 'number' && Number.isFinite(data.upgrade) ? Math.min(3, Math.max(0, Math.floor(data.upgrade))) : 0
    const parsed: Partial<CitySave> = {
      version: 1,
      money: typeof data.money === 'number' && Number.isFinite(data.money) ? Math.max(0, Math.floor(data.money)) : 1500,
      bankBalance: typeof data.bankBalance === 'number' && Number.isFinite(data.bankBalance) ? Math.max(0, Math.floor(data.bankBalance)) : 2500,
      uncleanedLoot: typeof data.uncleanedLoot === 'number' && Number.isFinite(data.uncleanedLoot) ? Math.max(0, Math.floor(data.uncleanedLoot)) : 0,
      health: typeof data.health === 'number' && Number.isFinite(data.health) ? Math.min(100, Math.max(0, data.health)) : 100,
      completed: sanitizeIdList(data.completed, 20),
      upgrade,
      muted: data.muted === true,
      weather: sanitizeWeather(data.weather),
      robbedStores: sanitizeIdList(data.robbedStores, 24),
      seenIntro: data.seenIntro === true,
      protagonist: data.protagonist === 'lucia' ? 'lucia' : 'jason',
      partnerBond: typeof data.partnerBond === 'number' && Number.isFinite(data.partnerBond) ? Math.min(100, Math.max(0, data.partnerBond)) : 32,
      conductScore: typeof data.conductScore === 'number' && Number.isFinite(data.conductScore) ? Math.min(100, Math.max(-100, data.conductScore)) : 0,
    }
    const position = sanitizePosition(data.position)
    const inventory = sanitizeInventory(data.inventory, upgrade)
    const heat = sanitizeHeatSave(data.heat)
    const rpgStats = sanitizeRpgStats(data.rpgStats)
    const weaponArsenal = sanitizeWeaponArsenal(data.weaponArsenal)
    const capturedTurfs = sanitizeCapturedTurfs(data.capturedTurfs)
    if (position) parsed.position = position
    if (inventory) parsed.inventory = inventory
    if (heat) parsed.heat = heat
    if (rpgStats) parsed.rpgStats = rpgStats
    if (weaponArsenal) parsed.weaponArsenal = weaponArsenal
    if (capturedTurfs) parsed.capturedTurfs = capturedTurfs
    return parsed
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path)
  }
}

export async function saveCloudPlayerSave(user: User, save: CitySave): Promise<void> {
  if (!VALID_ID.test(user.uid) || !user.emailVerified) return
  const path = `players/${user.uid}`
  const ref = doc(db, 'players', user.uid)
  const upgrade = Math.min(3, Math.max(0, Math.floor(Number.isFinite(save.upgrade) ? save.upgrade : 0)))
  const position = sanitizePosition(save.position)
  const inventory = sanitizeInventory(save.inventory, upgrade)
  const heat = sanitizeHeatSave(save.heat)
  const rpgStats = sanitizeRpgStats(save.rpgStats)
  const weaponArsenal = sanitizeWeaponArsenal(save.weaponArsenal)
  const capturedTurfs = sanitizeCapturedTurfs(save.capturedTurfs)
  const payload: Record<string, unknown> = {
    uid: user.uid,
    displayName: sanitizeDisplayName(user.displayName, 60),
    money: Math.min(1_000_000_000, Math.max(0, Math.floor(Number.isFinite(save.money) ? save.money : 1500))),
    bankBalance: Math.min(1_000_000_000, Math.max(0, Math.floor(Number.isFinite(save.bankBalance) ? save.bankBalance! : 2500))),
    uncleanedLoot: Math.min(1_000_000_000, Math.max(0, Math.floor(Number.isFinite(save.uncleanedLoot) ? save.uncleanedLoot! : 0))),
    health: Math.min(100, Math.max(0, Number.isFinite(save.health) ? save.health : 100)),
    completed: sanitizeIdList(save.completed, 20),
    upgrade,
    muted: Boolean(save.muted),
    weather: sanitizeWeather(save.weather),
    robbedStores: sanitizeIdList(save.robbedStores, 24),
    seenIntro: Boolean(save.seenIntro),
    protagonist: save.protagonist === 'lucia' ? 'lucia' : 'jason',
    partnerBond: Math.min(100, Math.max(0, Number.isFinite(save.partnerBond) ? save.partnerBond! : 32)),
    conductScore: Math.min(100, Math.max(-100, Number.isFinite(save.conductScore) ? save.conductScore! : 0)),
  }
  if (position) payload.position = position
  if (inventory) payload.inventory = inventory
  if (heat) payload.heat = heat
  if (rpgStats) payload.rpgStats = rpgStats
  if (weaponArsenal) payload.weaponArsenal = weaponArsenal
  if (capturedTurfs) payload.capturedTurfs = capturedTurfs

  let exists = false
  try {
    exists = (await getDoc(ref)).exists()
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path)
  }

  try {
    if (exists) {
      const updatePayload: Record<string, unknown> = {
        displayName: payload.displayName,
        money: payload.money,
        health: payload.health,
        completed: payload.completed,
        upgrade: payload.upgrade,
        muted: payload.muted,
        weather: payload.weather,
        robbedStores: payload.robbedStores,
        seenIntro: payload.seenIntro,
        updatedAt: serverTimestamp(),
      }
      if (position) updatePayload.position = position
      if (inventory) updatePayload.inventory = inventory
      if (heat) updatePayload.heat = heat
      if (rpgStats) updatePayload.rpgStats = rpgStats
      if (weaponArsenal) updatePayload.weaponArsenal = weaponArsenal
      if (capturedTurfs) updatePayload.capturedTurfs = capturedTurfs
      await updateDoc(ref, updatePayload)
    } else {
      await setDoc(ref, {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    }
  } catch (error) {
    handleFirestoreError(error, exists ? OperationType.UPDATE : OperationType.CREATE, path)
  }
}

/**
 * Persist the player's position, inventory, heat, RPG stats, arsenal, and captured turfs
 * to Firestore whenever game state changes, falling back cleanly to localStorage if offline or signed out.
 */
export async function persistPlayerState(
  user: User | null,
  state: PlayerStateSnapshot,
  save: CitySave,
): Promise<{ syncedToCloud: boolean }> {
  const cleanPos = sanitizePosition(state.position)
  const cleanInv = sanitizeInventory(state.inventory, save.upgrade)
  const cleanHeat = sanitizeHeatSave(state.heat)
  const cleanRpg = sanitizeRpgStats(state.rpgStats)
  const cleanArsenal = sanitizeWeaponArsenal(state.weaponArsenal)
  const cleanTurfs = sanitizeCapturedTurfs(state.capturedTurfs)
  if (cleanPos) save.position = cleanPos
  if (cleanInv) {
    save.inventory = cleanInv
    save.upgrade = cleanInv.sprintTier
  }
  if (cleanHeat) save.heat = cleanHeat
  if (cleanRpg) save.rpgStats = cleanRpg
  if (cleanArsenal) save.weaponArsenal = cleanArsenal
  if (cleanTurfs) save.capturedTurfs = cleanTurfs

  saveCityProgress(save)

  if (!user || !user.emailVerified || !VALID_ID.test(user.uid)) {
    return { syncedToCloud: false }
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { syncedToCloud: false }
  }
  try {
    await saveCloudPlayerSave(user, save)
    return { syncedToCloud: true }
  } catch {
    return { syncedToCloud: false }
  }
}

export async function submitLeaderboardToFirestore(
  user: User,
  contractsCompleted: number,
  durationMs: number,
  missionId: string,
): Promise<void> {
  if (!VALID_ID.test(user.uid) || !user.emailVerified) {
    throw new Error('verified_google_account_required')
  }
  const path = `leaderboard/${user.uid}`
  const ref = doc(db, 'leaderboard', user.uid)
  const clampedContracts = Math.min(10_000, Math.max(1, Math.floor(contractsCompleted)))
  const clampedDuration = Math.min(1_800_000, Math.max(500, Math.floor(durationMs)))
  const safeMissionId = VALID_MISSION.test(missionId) ? missionId : 'contract'
  const displayName = sanitizeDisplayName(user.displayName, 40)

  let snapData: Record<string, unknown> | null = null
  try {
    const snap = await getDoc(ref)
    snapData = snap.exists() ? snap.data() : null
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path)
  }

  try {
    if (snapData) {
      const prevContracts = typeof snapData.contractsCompleted === 'number' ? snapData.contractsCompleted : 0
      const prevBest = typeof snapData.bestDurationMs === 'number' ? snapData.bestDurationMs : clampedDuration
      await updateDoc(ref, {
        displayName,
        contractsCompleted: Math.min(10_000, Math.max(prevContracts + 1, clampedContracts)),
        bestDurationMs: Math.min(prevBest, clampedDuration),
        lastMissionId: safeMissionId,
        updatedAt: serverTimestamp(),
      })
    } else {
      await setDoc(ref, {
        uid: user.uid,
        displayName,
        contractsCompleted: clampedContracts,
        bestDurationMs: clampedDuration,
        lastMissionId: safeMissionId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    }
  } catch (error) {
    handleFirestoreError(error, snapData ? OperationType.UPDATE : OperationType.CREATE, path)
  }
}

export async function listLeaderboardFromFirestore(maxEntries = 10): Promise<CloudLeaderboardRow[]> {
  const path = 'leaderboard'
  try {
    const q = query(
      collection(db, 'leaderboard'),
      where('contractsCompleted', '>=', 1),
      orderBy('contractsCompleted', 'desc'),
      limit(Math.max(maxEntries, 20)),
    )
    const snap = await getDocs(q)
    const rows: CloudLeaderboardRow[] = snap.docs.map(docSnap => {
      const d = docSnap.data()
      return {
        uid: String(d.uid ?? docSnap.id),
        displayName: sanitizeDisplayName(typeof d.displayName === 'string' ? d.displayName : 'VICE PLAYER', 40),
        contractsCompleted: typeof d.contractsCompleted === 'number' ? d.contractsCompleted : 1,
        bestDurationMs: typeof d.bestDurationMs === 'number' ? d.bestDurationMs : 60_000,
        lastMissionId: typeof d.lastMissionId === 'string' ? d.lastMissionId : 'intro',
      }
    })
    rows.sort((a, b) => b.contractsCompleted - a.contractsCompleted || a.bestDurationMs - b.bestDurationMs)
    return rows.slice(0, maxEntries)
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path)
  }
}
