export type PauseReason = 'manual' | 'hidden' | 'webgl';

/** Keeps independent pause blockers from accidentally clearing one another. */
export class PauseState {
  private readonly reasons = new Set<PauseReason>();

  get paused(): boolean { return this.reasons.size > 0; }
  has(reason: PauseReason): boolean { return this.reasons.has(reason); }
  snapshot(): PauseReason[] { return [...this.reasons]; }

  set(reason: PauseReason, active: boolean): boolean {
    if (active) this.reasons.add(reason); else this.reasons.delete(reason);
    return this.paused;
  }

  /** A user resume clears user/visibility pauses, but never an active WebGL loss. */
  resumeByUser(): boolean {
    this.reasons.delete('manual');
    this.reasons.delete('hidden');
    return this.paused;
  }

  reset(): void { this.reasons.clear(); }
}
