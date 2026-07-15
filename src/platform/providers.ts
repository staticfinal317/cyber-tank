import type { ReplayData, RunSummary } from '../core/types';

/** Cloud capabilities are kept behind providers so the offline game never depends on a vendor SDK. */
export interface IdentityProvider {
  signInWithParentConsent(): Promise<{ playerId: string; displayName: string }>;
  signOut(): Promise<void>;
}

export interface LeaderboardProvider {
  submit(run: RunSummary): Promise<void>;
  top(scope: 'friends' | 'class' | 'global', limit: number): Promise<RunSummary[]>;
}

export interface ChallengeProvider {
  today(): Promise<{ seed: number; title: string; rule: string }>;
}

export interface ReplayProvider {
  upload(replay: ReplayData): Promise<{ replayId: string }>;
  download(replayId: string): Promise<ReplayData>;
}

export interface TelemetryProvider {
  track(event: string, properties?: Record<string, string | number | boolean>): void;
}

export class OfflineTelemetry implements TelemetryProvider {
  track(): void {
    // Intentionally empty: the default child profile sends no analytics.
  }
}
