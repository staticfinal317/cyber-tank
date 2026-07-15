import { describe, expect, it } from 'vitest';
import { PerformanceGovernor } from '../src/platform/PerformanceGovernor';

describe('performance governor', () => {
  it('downgrades only after sustained slow frames', () => {
    const governor = new PerformanceGovernor('auto');
    for (let i = 0; i < 71; i += 1) expect(governor.sample(.03)).toBeUndefined();
    expect(governor.sample(.03)).toBe('battery');
    expect(governor.fps).toBe(33);
  });

  it('keeps an explicitly selected quality level', () => {
    const governor = new PerformanceGovernor('high');
    for (let i = 0; i < 144; i += 1) governor.sample(.04);
    expect(governor.level).toBe('high');
  });

  it('reports bounded long-session diagnostics', () => {
    const governor = new PerformanceGovernor('balanced');
    for (let i = 0; i < 2000; i += 1) governor.sample(i % 20 === 0 ? .04 : .016);
    const report = governor.snapshot();
    expect(report.samples).toBe(1800);
    expect(report.worstMs).toBe(40);
    expect(report.longFrameRate).toBe(5);
  });
});
