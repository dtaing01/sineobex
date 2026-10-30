# Security

Sineobex handles protected health information. Treat every report about it as urgent.

## Reporting a vulnerability

Email the maintainers privately (see the repository owner's GitHub profile) or open a [GitHub private vulnerability report](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability). Do not open a public issue, and never include real patient data in a report.

We acknowledge reports within two business days and tell you what we will do and when.

## What is in place

- Secret scanning of the full git history on every pull request and weekly.
- CodeQL, `pnpm audit` and OSV scanning of every lockfile weekly; Dependabot updates.
- A PHI guard in CI that rejects realistic identifiers in fixtures and enforces the data-path rules in `README.md`.
- GitHub Actions pinned by commit SHA, with read-only default permissions.

## Known accepted findings

| Finding | Why it is accepted | Review by |
|---|---|---|
| gitleaks `generic-api-key` in commit `471b018` (`app/lib/core/security/db_key.dart:14`) | The string is a Keychain entry name, not a secret; the file was deleted by the Oct 8 reset. Ignored by exact fingerprint in `.gitleaksignore`. | Permanent |
| GHSA-vfj7-8cjw-p6xm (`braces`) | Lint-time dependency only, expands our own glob strings, no patched release. Ignored in `pnpm-workspace.yaml`. | When a fix ships |
