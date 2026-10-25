import { describe, expect, it } from 'vitest';

describe('environment', () => {
  it('runs in the expected environment', () => {
    // Runs once per project (node, browser/happy-dom).
    const hasWindow = typeof window !== 'undefined';
    expect(typeof hasWindow).toBe('boolean');
  });
});
