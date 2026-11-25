import { auth } from '../firebase/client'
import { listLeaderboardFromFirestore, submitLeaderboardToFirestore } from '../firebase/cloudStore'

type PendingSubmission = {
  contractsCompleted: number
  durationMs: number
  missionId: string
}

/** Casual Firestore-backed online leaderboard; local contracts never depend on online availability. */
export class OnlineLeaderboard {
  private lastFailed: PendingSubmission | null = null
  private sessionCompletions = 0

  constructor(private readonly notify: (message: string) => void) {}

  begin(_eligible: boolean): void {
    // Score runs are recorded directly to Firestore on contract completion for signed-in players.
  }

  async complete(seconds: number, eligible: boolean, missionId = 'contract'): Promise<void> {
    if (!eligible) return
    this.sessionCompletions++
    const durationMs = Math.max(1000, Math.round(seconds * 1000))
    const user = auth.currentUser
    if (!user) {
      this.notify('Contract saved locally. Sign in with Google to post to Firestore leaderboard.')
      return
    }
    const pending: PendingSubmission = { contractsCompleted: this.sessionCompletions, durationMs, missionId }
    try {
      await submitLeaderboardToFirestore(user, pending.contractsCompleted, pending.durationMs, pending.missionId)
      if (this.lastFailed?.missionId === missionId) this.lastFailed = null
      this.notify('Contract score submitted to Firestore leaderboard')
    } catch (error) {
      this.lastFailed = pending
      const reason = error instanceof Error ? error.message : 'leaderboard_unavailable'
      this.notify(`Leaderboard submission failed: ${reason}`)
    }
  }

  async retry(): Promise<string> {
    if (!this.lastFailed) return 'No leaderboard submission to retry.'
    const user = auth.currentUser
    if (!user) return 'Sign in with Google first to submit your pending score to Firestore.'
    try {
      await submitLeaderboardToFirestore(
        user,
        this.lastFailed.contractsCompleted,
        this.lastFailed.durationMs,
        this.lastFailed.missionId,
      )
      this.lastFailed = null
      return 'Leaderboard score submitted to Firestore.'
    } catch (error) {
      return `Leaderboard retry failed: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  async list(): Promise<string> {
    try {
      const entries = await listLeaderboardFromFirestore(10)
      if (!entries.length) return 'No scores yet. Sign in with Google and complete contracts to set the first score.'
      return entries
        .map((entry, idx) => `${idx + 1}. ${entry.displayName} — ${entry.contractsCompleted} contracts (${(entry.bestDurationMs / 1000).toFixed(1)}s best)`)
        .join('\n')
    } catch (error) {
      return `Leaderboard unavailable: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}
