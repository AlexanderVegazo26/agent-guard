# Security Policy

## Reporting a vulnerability

Please report suspected security vulnerabilities in this repository or in any
of the published `@alexvegman/*` packages privately, **not** via a public
GitHub issue.

- Preferred: open a [GitHub Security Advisory](https://github.com/AlexanderVegazo26/agent-guard/security/advisories/new)
  on this repository (this repo's own private-reporting channel — GitHub
  notifies the repository owner directly and keeps the report out of the
  public issue tracker until a fix is ready).
- If you cannot use GitHub Security Advisories, open a normal GitHub issue at
  https://github.com/AlexanderVegazo26/agent-guard/issues asking for a private
  channel to be opened, without describing the vulnerability itself.

**Owner / contact:** repository owner [@AlexanderVegazo26](https://github.com/AlexanderVegazo26)
(this repository's own GitHub identity — the same convention the repo already
uses for its `git remote` and package publishing identity; no separate email
address is published for this project).

Please include: affected package(s) and version(s), a minimal reproduction,
and the impact you believe it has. We aim to acknowledge a report within 5
business days.

## Supported versions

This project has not yet reached a 1.0 release. All `@alexvegman/*` packages
are currently versioned `0.1.0` and pre-1.0 — only the latest published
version of each package receives fixes. There is no LTS/backport policy at
this stage.

## Deprecation and yank procedure

If a published version of an `@alexvegman/*` package is found to contain a
vulnerability after release, the following procedure applies:

1. **Fix and release first.** Publish a patched version under the same major
   line as soon as the fix is ready and merged — `npm unpublish` is
   deliberately not used as a first response; npm restricts unpublishing
   after 72 hours specifically because pulling a version out from under
   consumers without a replacement breaks builds worse than leaving it in
   place.
2. **Deprecate the vulnerable version(s)** so anyone installing them sees a
   warning and a pointer to the fix, using npm's own deprecation mechanism:

   ```bash
   npm deprecate @alexvegman/<package>@"<vulnerable-range>" \
     "Security fix available in <patched-version>. See GHSA-<id>. Upgrade to <patched-version> or later."
   ```

   This does not remove the tarball (existing installs and lockfiles keep
   working), it only marks it in the registry and in `npm install` output.
3. **Publish a GitHub Security Advisory** for the affected package(s),
   including affected version range, the patched version, and (once a CVE is
   assigned, if applicable) the CVE identifier. GitHub Security Advisories on
   a public repository are automatically forwarded to the GitHub Advisory
   Database, which is what feeds `npm audit`, Dependabot, and other
   downstream vulnerability scanners — this step is what actually gets
   consumers a `npm audit` warning, not the `npm deprecate` call alone.
4. **Only unpublish** (`npm unpublish`) a version within npm's 72-hour window,
   and only when the vulnerability is severe enough (e.g. leaked credentials,
   actively exploited RCE) that leaving it installable is worse than the
   breakage unpublishing causes. Outside that window, deprecation +
   advisory (steps 2–3) is the mechanism — npm will not unpublish a version
   more than 72 hours old that would break other packages depending on it,
   and this project does not build tooling to route around that restriction.

## Scope

This policy covers the `agent-guard` repository and every package published
from it under the `@alexvegman/` npm scope. It does not cover third-party
dependencies — report those upstream, to their own maintainers.
