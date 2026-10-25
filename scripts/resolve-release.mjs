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
// npm constraints this script enforces (see validate()):
// - Versions must be valid SemVer 2.0. A purely numeric prerelease identifier
//   may not have leading zeros, so a bare short SHA like `0123456` would make
//   an invalid version. The SHA is prefixed with `g` (as `git describe` does)
//   so the identifier is always alphanumeric.
// - Build metadata (`+sha`) is ignored by the registry for uniqueness, so it
//   is never used.
// - A dist-tag must not parse as a semver version or range, and npm advises
//   against names starting with a digit or `v`.
import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const SEMVER = '(\\d+\\.\\d+\\.\\d+)';

export function resolveRelease({ ref, sha, published }) {
  const short = `g${sha.slice(0, 7)}`;
  let m;

  if (ref === 'refs/heads/develop') {
    return { version: `0.0.0-canary.${short}`, tag: 'canary' };
  }
  if (ref === 'refs/heads/next') {
    return { version: `0.0.0-next.${short}`, tag: 'next' };
  }
  if ((m = ref.match(new RegExp(`^refs/heads/release/([vm])${SEMVER}$`)))) {
    const [, kind, base] = m;
    const prefix = `${base}-rc.`;
    const n = published
      .filter((v) => v.startsWith(prefix))
      .map((v) => Number(v.slice(prefix.length)))
      .filter(Number.isInteger)
      .reduce((max, x) => Math.max(max, x), 0);
    return {
      version: `${prefix}${n + 1}`,
      tag: kind === 'v' ? 'rc' : 'maint-rc',
    };
  }
  if ((m = ref.match(new RegExp(`^refs/tags/([vm])${SEMVER}$`)))) {
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

// SemVer 2.0 grammar (semver.org): numeric identifiers have no leading zeros,
// alphanumeric identifiers contain at least one letter or hyphen.
const NUM = '(?:0|[1-9]\\d*)';
const PRE_ID = `(?:${NUM}|\\d*[A-Za-z-][0-9A-Za-z-]*)`;
const VERSION_RE = new RegExp(`^${NUM}\\.${NUM}\\.${NUM}(?:-${PRE_ID}(?:\\.${PRE_ID})*)?$`);
const TAG_RE = /^[a-z][a-z0-9-]*$/; // never starts with a digit or `v`-number
const SEMVERISH_TAG_RE = /^v?\d/;

export function validate({ version, tag }) {
  if (!VERSION_RE.test(version)) {
    throw new Error(`"${version}" is not a valid SemVer 2.0 version`);
  }
  if (!TAG_RE.test(tag) || SEMVERISH_TAG_RE.test(tag) || tag === 'v') {
    throw new Error(`"${tag}" is not a safe npm dist-tag name`);
  }
}

function npm(...args) {
  return execFileSync('npm', args, { encoding: 'utf8' });
}

function listPublished(name) {
  try {
    const out = npm('view', name, 'versions', '--json').trim();
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return []; // package not published yet
  }
}

function main() {
  const { GITHUB_REF: ref, GITHUB_SHA: sha, GITHUB_OUTPUT: out } = process.env;
  const name = JSON.parse(
    execFileSync('node', ['-p', 'JSON.stringify(require("./package.json"))'], {
      encoding: 'utf8',
    }),
  ).name;
  const published = listPublished(name);
  const r = resolveRelease({ ref, sha, published });
  if (r) validate(r);
  const emit = (k, v) => {
    console.log(`${k}=${v}`);
    if (out) appendFileSync(out, `${k}=${v}\n`);
  };

  if (!r) {
    console.log(`Nothing to publish for ${ref}`);
    emit('publish', 'false');
    return;
  }
  if (r.requireBranch) {
    const branches = execFileSync(
      'git',
      ['branch', '-r', '--contains', sha, '--format=%(refname:short)'],
      { encoding: 'utf8' },
    ).split('\n');
    if (!branches.includes(`origin/${r.requireBranch}`)) {
      console.error(`::error::${ref} is not on origin/${r.requireBranch}`);
      process.exit(1);
    }
  }
  if (published.includes(r.version)) {
    if (r.stable) {
      console.error(`::error::${name}@${r.version} is already published`);
      process.exit(1);
    }
    console.log(`${r.version} already published, skipping`);
    emit('publish', 'false');
    return;
  }
  emit('publish', 'true');
  emit('version', r.version);
  emit('tag', r.tag);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
