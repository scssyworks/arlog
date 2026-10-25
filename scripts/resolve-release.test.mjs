import { describe, expect, it } from 'vitest';
import { resolveRelease, validate } from './resolve-release.mjs';

const sha = 'abcdef1234567890abcdef1234567890abcdef12';
const run = (ref, published = [], s = sha) => resolveRelease({ ref, sha: s, published });

describe('resolveRelease', () => {
  it('maps refs to versions and dist-tags', () => {
    const published = ['1.2.3-rc.1', '1.2.3-rc.2', '1.2.30-rc.9'];
    expect(run('refs/heads/develop')).toEqual({ version: '0.0.0-canary.gabcdef1', tag: 'canary' });
    expect(run('refs/heads/next')).toEqual({ version: '0.0.0-next.gabcdef1', tag: 'next' });
    expect(run('refs/heads/release/v1.2.3', published)).toEqual({ version: '1.2.3-rc.3', tag: 'rc' });
    expect(run('refs/heads/release/m1.2.3', published)).toEqual({ version: '1.2.3-rc.3', tag: 'maint-rc' });
    expect(run('refs/tags/v1.2.3')).toMatchObject({ version: '1.2.3', tag: 'latest', requireBranch: 'release/v1.2.3' });
    expect(run('refs/tags/m12.0.4')).toMatchObject({ version: '12.0.4', tag: 'maint-12', requireBranch: 'release/m12.0.4' });
  });

  it('never publishes from other refs', () => {
    for (const ref of ['refs/heads/main', 'refs/heads/main-v1.2.3', 'refs/heads/feature/x', 'refs/pull/1/merge', 'refs/heads/developer', 'refs/heads/release/v1.2', 'refs/tags/1.2.3', 'refs/tags/latest']) {
      expect(run(ref)).toBeNull();
    }
  });

  it('keeps canary versions valid even for numeric SHAs with leading zeros', () => {
    const r = run('refs/heads/develop', [], '0123456789012345678901234567890123456789');
    expect(r.version).toBe('0.0.0-canary.g0123456');
    expect(() => validate(r)).not.toThrow();
  });

  it('refuses RCs once the stable version exists', () => {
    expect(() => run('refs/heads/release/v1.2.3', ['1.2.3'])).toThrow();
  });

  it('parses RC counters strictly', () => {
    expect(run('refs/heads/release/v1.0.0', ['1.0.0-rc.1e3', '1.0.0-rc. 7', '1.0.0-rc.0x10', '1.0.0-rc.-1', '1.0.0-rc.2']).version).toBe('1.0.0-rc.3');
  });

  it('rejects malformed environment input', () => {
    expect(() => run('refs/heads/develop', [], 'ABCDEF')).toThrow();
    expect(() => run('refs/heads/develop', [], `${sha}\nx=y`)).toThrow();
    expect(() => run('', [])).toThrow();
    expect(() => run('refs/heads/' + 'a'.repeat(300))).toThrow();
    expect(() => run('refs/heads/develop', [{}])).toThrow();
  });

  it('rejects hostile ref names', () => {
    const hostile = [
      'refs/heads/release/v1.2.3\n',
      'refs/heads/release/v1.2.3\nversion=9.9.9',
      'refs/heads/release/v01.2.3',
      'refs/heads/release/v1.2.3 ',
      'refs/heads/release/v1.2.3;rm -rf /',
      'refs/heads/release/v1.2.3$(id)',
      'refs/heads/release/v1.2.3`id`',
      'refs/heads/release/v9999999999.0.0',
      'refs/heads/release/v1.2.3/../../x',
      'refs/tags/v1.2.3\n',
      'refs/tags/v1.2.3-rc.1',
      'refs/tags/v1.2.3+build',
      'refs/heads/develop\n',
      'refs/heads/release/v١.٢.٣',
    ];
    for (const ref of hostile) expect(run(ref)).toBeNull();
  });
});

describe('validate', () => {
  it('rejects invalid versions and dist-tags', () => {
    for (const version of ['0.0.0-canary.0123456', '01.0.0', '1.0.0+build', '1.0', 'v1.0.0', '1.0.0\n', '1.0.0-', '']) {
      expect(() => validate({ version, tag: 'canary' })).toThrow();
    }
    for (const tag of ['v1.4', 'v1', '1', '', 'Latest', 'a b', 'rc\nx', 'a'.repeat(65)]) {
      expect(() => validate({ version: '1.0.0', tag })).toThrow();
    }
  });
});

describe('invariants', () => {
  const alphabet = ['refs/', 'heads/', 'tags/', 'release/', 'v', 'm', '0', '1', '9', '.', '-', '\n', ' ', '$', '`', ';', 'rc', '+', '/', 'é'];
  it('any output is a valid, newline-free version and tag (fuzz)', () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let i = 0; i < 20000; i++) {
      let ref = rnd() < 0.5 ? 'refs/heads/release/' : 'refs/tags/';
      const len = Math.floor(rnd() * 14);
      for (let j = 0; j < len; j++) ref += alphabet[Math.floor(rnd() * alphabet.length)];
      const pub = [`${ref.split('/').pop()}-rc.1`, '1.0.0-rc.1'];
      const r = run(ref, pub);
      if (r) expect(() => validate(r)).not.toThrow();
    }
  });

  it('does not exhibit catastrophic backtracking', () => {
    const evil = [
      'refs/heads/release/v' + '1.'.repeat(50000) + '!',
      'refs/heads/release/v' + '9'.repeat(100000) + '.0.0',
      'refs/tags/m' + '0'.repeat(100000),
    ];
    const start = performance.now();
    for (const ref of evil) {
      try { run(ref); } catch { /* length cap rejects first */ }
    }
    expect(performance.now() - start).toBeLessThan(200);
    const bigVersion = '1.0.0-' + 'a'.repeat(200000) + '!';
    const t = performance.now();
    expect(() => validate({ version: bigVersion, tag: 'rc' })).toThrow();
    expect(performance.now() - t).toBeLessThan(200);
  });
});
