import { describe, expect, it } from 'vitest';
import { version } from './version';

describe('version', () => {
  it('is a string', () => {
    expect(typeof version).toBe('string');
  });
});
