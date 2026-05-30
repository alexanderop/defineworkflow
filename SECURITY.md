# Security Policy

## Supported Versions

The latest published `defineworkflow` release on npm receives security fixes.

## Reporting a Vulnerability

Please **do not** open a public issue for security vulnerabilities.

Report privately via [GitHub Security Advisories](https://github.com/alexanderop/clanker-workflow/security/advisories/new). If that is not possible, email **opalicalexander@gmail.com**.

You can expect an initial response within a few days. Verified vulnerabilities
will be addressed promptly, and we will coordinate a disclosure timeline with you.

## Supply-chain posture

This project takes supply-chain security seriously:

- **OIDC trusted publishing + provenance** — releases are published from CI via
  short-lived OIDC tokens (no long-lived npm token) with signed provenance
  attestations linking each tarball to the exact commit and workflow run.
- **Pinned GitHub Actions** — all actions are pinned to full commit SHAs.
- **Least-privilege workflows** — `permissions: {}` by default, scoped per job.
- **`zizmor`** static analysis runs on every push and pull request.
- **pnpm `allowBuilds`** allowlists which dependencies may run install scripts.
- **`trustPolicy: no-downgrade`** blocks installs whose trust level regressed.
- **Renovate** keeps dependencies (and pinned action SHAs) current.
