# Publishing `defineworkflow` — one-time setup TODO

Everything in the repo (package bundling, security hardening, release-please
automation) is already wired. These are the **manual steps only you can do**
(npm account + GitHub settings). Do them once, then releases are automatic.

---

## 1. Enable release PRs on GitHub

GitHub → **Settings → Actions → General → Workflow permissions** →
check **"Allow GitHub Actions to create and approve pull requests."**

(Without this, release-please can't open its release PR.)

---

## 2. Bootstrap the first publish (manual — required once)

npm trusted publishing can't be configured until the package exists on npm, so
the very first `0.1.0` publish is manual. Run from the repo root:

```bash
cd packages/workflow
pnpm build

# strip build-only workspace devDeps so npm accepts the manifest
node -e "const fs=require('fs'),p=require('./package.json');delete p.devDependencies;fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')"

# publish (uses your npm login + 2FA)
npm publish --access public

# restore the manifest and tag the release so release-please anchors at 0.1.0
git checkout package.json
cd ../..
git tag v0.1.0
git push origin v0.1.0
```

> If you aren't logged in to npm yet: run `npm login` first.

---

## 3. Configure the npm trusted publisher

npmjs.com → package **`defineworkflow`** → **Settings → Trusted Publisher** →
add a GitHub Actions publisher with:

- **Organization / repository:** `alexanderop/defineworkflow`
- **Workflow filename:** `release.yml`
- **Environment:** `npm-publish`

(After this, CI publishes via short-lived OIDC tokens — no `NPM_TOKEN` secret.)

---

## 4. Protect the publish environment

GitHub → **Settings → Environments → `npm-publish`** (create it if missing) →

- Restrict deployment to **protected tags** (e.g. `v*`)
- (Optional) add yourself as a **required reviewer** so every publish needs a click

---

## Done. From now on the flow is:

1. Merge `feat:` / `fix:` PRs to `main` (conventional commits).
2. release-please keeps an open **"chore: release vX.Y.Z"** PR with the changelog.
3. Merge that PR when you want to ship → it tags `vX.Y.Z`, creates the GitHub
   Release, and `release.yml` publishes to npm with provenance.

**Version math (0.x):** `fix:` → patch (`0.1.0→0.1.1`), `feat:` → minor
(`0.1.1→0.2.0`), `feat!:` / `BREAKING CHANGE:` → minor while pre-1.0
(`0.2.0→0.3.0`).

When the API is stable and you want real semver (breaking → major), edit
`release-please-config.json` and remove `"bump-minor-pre-major": true`, then
manually cut `1.0.0`.

---

## Quick reference — what's already in the repo

| File | Purpose |
|------|---------|
| `packages/workflow/` (`defineworkflow`) | the single published package; bundles `@workflow/*` internally |
| `.github/workflows/release-please.yml` | maintains the release PR, calls release.yml on merge |
| `.github/workflows/release.yml` | OIDC + provenance npm publish (reusable + manual dispatch) |
| `.github/workflows/ci.yml` | lint / typecheck / affected tests, SHA-pinned, least-privilege |
| `.github/workflows/zizmor.yml` | GitHub Actions security analysis |
| `release-please-config.json` / `.release-please-manifest.json` | versioning config + current version |
| `SECURITY.md`, `renovate.json`, `LICENSE` | disclosure policy, dep updates, license |

Break-glass manual publish of an existing tag: GitHub → Actions → **release** →
**Run workflow** → enter the tag (e.g. `v0.2.0`).
