import { describe, expect, it } from 'vitest';
import { AMBIENT_PROFILES } from '../src/audio/AudioManager';

describe('seasonal ambience profiles', () => {
  it('keeps every layer intentionally subtle and frequency-safe', () => {
    Object.values(AMBIENT_PROFILES).forEach((profile) => {
      expect(profile.noise).toBeGreaterThan(0);
      expect(profile.noise).toBeLessThan(.04);
      expect(profile.frequency).toBeGreaterThanOrEqual(500);
      expect(profile.notes.every((note) => note >= 40 && note <= 900)).toBe(true);
    });
  });
});
