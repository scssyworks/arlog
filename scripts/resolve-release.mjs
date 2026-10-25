// Decides what (if anything) a CI run should publish.
//
// Branch / tag            -> version                   dist-tag
// develop                 -> 0.0.0-canary.g<sha>       canary
// next                    -> 0.0.0-next.g<sha>         next
// release/vX.X.X          -> X.X.X-rc.<n>              rc
// release/mX.X.X          -> X.X.X-rc.<n>              maint-rc
// tag vX.X.X              -> X.X.X                     latest
// tag mX.X.X              -> X.X.X                     maint-<major>
//
// Everything else (main, main-v*, feature branches, PRs) publishes nothing.
//
// Threat model. Branch and tag names (GITHUB_REF) are chosen by whoever can
// push, and registry responses are remote data; both are untrusted. The
// script therefore:
// - never evaluates, interpolates into a shell, or spawns through a shell:
//   child processes use execFileSync with fixed argv and validated values;
// - only ever emits values built from fixed strings plus digits/hex that were
//   matched by anchored, linear-time patterns (no nested quantifiers) with
//   bounded lengths, and re-validates the final strings before writing them
//   to GITHUB_OUTPUT (no newlines, no `=` injection);
// - fails closed: any unexpected input or registry error aborts the run
//   instead of being treated as "not published".
//
// npm constraints enforced here:
// - Versions must be valid SemVer 2.0. A numeric prerelease identifier may not
//   have leading zeros, so a bare short SHA like `0123456` would be invalid;
//   the SHA is prefixed with `g` (as `git describe` does).
// - Build metadata (`+sha`) is ignored by the registry for uniqueness and is
//   never used.
// - A dist-tag must not parse as a semver version/range and must not start
//   with a digit or `v`.
import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const MAX_REF_LENGTH = 255;
// All patterns are regex LITERALS on purpose: static analysis (ESLint ReDoS
// rules) can only fully check literals, so nothing is assembled at runtime and
// shared tokens are repeated instead. ESLint forbids `RegExp(...)`.
//
// Numeric semver component, repeated below: (?:0|[1-9][0-9]{0,8})
// = no leading zeros, at most 9 digits (far inside Number.MAX_SAFE_INTEGER).
const RE_RELEASE_BRANCH =
  /^refs\/heads\/release\/([vm])((?:0|[1-9][0-9]{0,8})\.(?:0|[1-9][0-9]{0,8})\.(?:0|[1-9][0-9]{0,8}))$/;
const RE_STABLE_TAG =
  /^refs\/tags\/([vm])((?:0|[1-9][0-9]{0,8})\.(?:0|[1-9][0-9]{0,8})\.(?:0|[1-9][0-9]{0,8}))$/;
const RE_SHA = /^[0-9a-f]{40}$/;
const RE_NUM = /^(?:0|[1-9][0-9]{0,8})$/;
const RE_PKG_NAME = /^(?:@[a-z0-9][a-z0-9._-]{0,213}\/)?[a-z0-9][a-z0-9._-]{0,213}$/;

// SemVer 2.0 grammar (semver.org), without build metadata. A prerelease
// identifier is either a numeric one (no leading zeros) or an alphanumeric one
// containing at least one letter or hyphen:
//   (?:(?:0|[1-9][0-9]{0,8})|[0-9]{0,9}[A-Za-z-][0-9A-Za-z-]{0,63})
const RE_VERSION =
  /^(?:0|[1-9][0-9]{0,8})\.(?:0|[1-9][0-9]{0,8})\.(?:0|[1-9][0-9]{0,8})(?:-(?:(?:0|[1-9][0-9]{0,8})|[0-9]{0,9}[A-Za-z-][0-9A-Za-z-]{0,63})(?:\.(?:(?:0|[1-9][0-9]{0,8})|[0-9]{0,9}[A-Za-z-][0-9A-Za-z-]{0,63})){0,7})?$/;
const RE_TAG = /^[a-z][a-z0-9-]{0,63}$/;

class ReleaseError extends Error {}

export function validate({ version, tag }) {
  if (typeof version !== 'string' || version.length > 128 || !RE_VERSION.test(version)) {
    throw new ReleaseError('computed version is not a valid SemVer 2.0 version');
  }
  if (typeof tag !== 'string' || !RE_TAG.test(tag) || /^v[0-9]/.test(tag)) {
    throw new ReleaseError('computed dist-tag is not a safe npm dist-tag name');
  }
}

function parseRcSuffix(version, prefix) {
  if (typeof version !== 'string' || !version.startsWith(prefix)) return null;
  const rest = version.slice(prefix.length);
  // strict decimal only: rejects "1e3", " 5", "0x10", "-1", "1.5", ""
  return RE_NUM.test(rest) ? Number(rest) : null;
}

export function resolveRelease({ ref, sha, published }) {
  if (typeof ref !== 'string' || ref.length === 0 || ref.length > MAX_REF_LENGTH) {
    throw new ReleaseError('GITHUB_REF is missing or too long');
  }
  if (typeof sha !== 'string' || !RE_SHA.test(sha)) {
    throw new ReleaseError('GITHUB_SHA must be a 40-character lowercase hex SHA');
  }
  if (!Array.isArray(published) || published.some((v) => typeof v !== 'string')) {
    throw new ReleaseError('published versions must be an array of strings');
  }
  const short = `g${sha.slice(0, 7)}`;
  let m;

  if (ref === 'refs/heads/develop') {
    return { version: `0.0.0-canary.${short}`, tag: 'canary' };
  }
  if (ref === 'refs/heads/next') {
    return { version: `0.0.0-next.${short}`, tag: 'next' };
  }
  if ((m = RE_RELEASE_BRANCH.exec(ref))) {
    const [, kind, base] = m;
    if (published.includes(base)) {
      throw new ReleaseError(`${base} is already released; cannot publish more release candidates for it`);
    }
    const prefix = `${base}-rc.`;
    let max = 0;
    for (const v of published) {
      const n = parseRcSuffix(v, prefix);
      if (n !== null && n > max) max = n;
    }
    return {
      version: `${prefix}${max + 1}`,
      tag: kind === 'v' ? 'rc' : 'maint-rc',
    };
  }
  if ((m = RE_STABLE_TAG.exec(ref))) {
    const [, kind, version] = m;
    return {
      version,
      tag: kind === 'v' ? 'latest' : `maint-${version.split('.')[0]}`,
      // the tagged commit must sit on the matching release branch
      requireBranch: `release/${kind}${version}`,
      stable: true,
    };
  }
  return null;
}

function readPackageName() {
  const { name } = JSON.parse(readFileSync('package.json', 'utf8'));
  if (typeof name !== 'string' || !RE_PKG_NAME.test(name)) {
    throw new ReleaseError('package.json has an invalid name');
  }
  return name;
}

// Only a registry 404 means "never published". Any other failure (network,
// 5xx, auth, malformed output) aborts instead of silently assuming nothing
// exists, which would defeat the duplicate checks.
function listPublished(name) {
  let out;
  try {
    out = execFileSync('npm', ['view', name, 'versions', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const text = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    if (/\bE404\b/.test(text)) return [];
    throw new ReleaseError('could not read published versions from the npm registry');
  }
  const parsed = JSON.parse(out);
  const list = Array.isArray(parsed) ? parsed : [parsed];
  if (list.some((v) => typeof v !== 'string')) {
    throw new ReleaseError('unexpected registry response');
  }
  return list;
}

function branchesContaining(sha) {
  const out = execFileSync(
    'git',
    ['branch', '-r', '--contains', sha, '--format=%(refname:short)'],
    { encoding: 'utf8' },
  );
  return out.split('\n');
}

function writeOutput(file, key, value) {
  if (!/^[a-z]+$/.test(key) || !/^[A-Za-z0-9.+_-]*$/.test(value)) {
    throw new ReleaseError(`refusing to write unsafe output "${key}"`);
  }
  console.log(`${key}=${value}`);
  if (file) appendFileSync(file, `${key}=${value}\n`);
}

function main() {
  const { GITHUB_REF: ref, GITHUB_SHA: sha, GITHUB_OUTPUT: outFile } = process.env;
  const out = (k, v) => writeOutput(outFile, k, v);

  // Cheap, offline decision first: refs that never publish skip the network.
  const probe = resolveRelease({ ref, sha, published: [] });
  if (!probe) {
    console.log('Nothing to publish for this ref');
    out('publish', 'false');
    return;
  }

  const name = readPackageName();
  const published = listPublished(name);
  const r = resolveRelease({ ref, sha, published });
  validate(r);

  if (r.requireBranch && !branchesContaining(sha).includes(`origin/${r.requireBranch}`)) {
    throw new ReleaseError(`tag commit is not on origin/${r.requireBranch}`);
  }
  if (published.includes(r.version)) {
    if (r.stable) throw new ReleaseError(`${name}@${r.version} is already published`);
    console.log(`${r.version} already published, skipping`);
    out('publish', 'false');
    return;
  }
  out('publish', 'true');
  out('version', r.version);
  out('tag', r.tag);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    // Only our own fixed messages are surfaced; anything else (e.g. a JSON
    // parse error that could echo registry data) is reported generically so
    // untrusted text never reaches a `::` workflow command.
    const msg = err instanceof ReleaseError ? err.message : 'unexpected failure while resolving the release';
    console.error(`::error::${msg}`);
    process.exit(1);
  }
}
