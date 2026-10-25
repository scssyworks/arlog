# arlogger

## Development

```sh
npm ci
npm run lint   # ESLint incl. ReDoS analysis of every regex
npm test        # unit tests, run in Node and in happy-dom
npm run build   # ESM + CJS + types into dist/
```

Tests live next to their sources (`src/foo.test.ts`). Name a file `*.node.test.ts` to run only in Node, or `*.browser.test.ts` to run only in the browser (happy-dom) project.

## Branching and releases

| Branch / tag       | Publishes                | npm dist-tag     |
| ------------------ | ------------------------ | ---------------- |
| `develop`          | `0.0.0-canary.<sha>`     | `canary`         |
| `next`             | `0.0.0-next.<sha>`       | `next`           |
| `release/vX.X.X`   | `X.X.X-rc.N`             | `rc`             |
| tag `vX.X.X`       | `X.X.X`                  | `latest`         |
| `release/mX.X.X`   | `X.X.X-rc.N`             | `maint-rc`       |
| tag `mX.X.X`       | `X.X.X`                  | `maint-<major>`  |
| `main`, `main-v*`  | nothing                  | n/a              |

- Tags must point at a commit on the matching `release/*` branch.
- `package.json` stays at `0.0.0`; CI stamps the version at publish time.
- Publishing uses npm trusted publishing (OIDC) from `.github/workflows/release.yml`. Build and publish are separate jobs; only the publish job holds the OIDC token and it publishes a prebuilt tarball.
- Versions are valid SemVer; canary/next use `g<sha7>` so an all-numeric SHA with a leading zero cannot create an invalid version.
- Third-party actions are pinned to commit SHAs (version in a trailing comment); Dependabot opens PRs to bump them.
