# Dependencies and security

Inventory and vulnerability posture as of lot 16 (25 Nov 2026).

## Inventory

- 71 direct runtime dependencies + 16 dev dependencies (`package.json`).
- About 950 resolved packages in `bun.lock` (transitive closure).
- Package manager: Bun 1.3.x, lockfile `bun.lock`, installed with
  `bun install --frozen-lockfile` in CI.
- `jspdf` 4.2.1 and `sharp` ^0.35.5 are identical on `main` and
  `Features-promethe` (the Dependabot fixes from main were already
  re-applied to the branch during lot 1).

## Audit status

- `bun audit` cannot run from this VM: the npm audit endpoint
  (`registry.npmjs.org/-/npm/v1/security/advisories/bulk`) returns 403
  through the egress proxy. The OSV API is unreachable the same way.
  The source of truth for alerts is therefore GitHub Dependabot on the
  repository, not a local audit run.
- Known open alerts (Dependabot, unchanged since 18 Nov 2026): **2, both
  on `xlsx`**. No patched version exists — the latest published version
  is 0.18.5, which is what the project already uses.

## xlsx: kept, with analysis

`xlsx` is used in exactly one place, read-only:
`src/lib/import/index.ts` (`XLSX.read` + `sheet_to_json`) parses broker
history workbooks (MT5 / cTrader `.xlsx` statements) into rows.

Exploitability in this architecture is low:

- Parsing happens **client-side only**, inside a Web Worker in the user's
  own browser (`import-file.worker.ts`). The server never receives the raw
  file — only normalized rows in chunks.
- The input is the user's **own broker statement**, a file they chose to
  import. There is no other user's file, no shared upload, no stored file
  parsed later for someone else.
- The known `xlsx` advisories (prototype pollution / ReDoS in parsing)
  would need a crafted file parsed in a privileged context. Here the
  worst case is the user's own browser tab misbehaving on their own file.

Decision: keep `xlsx` 0.18.5 and do **not** swap to `exceljs`.

- `exceljs` latest is 4.4.0 (MIT). It was evaluated as a replacement, but
  the swap was not made: it needs a new dependency + lockfile regeneration
  that cannot be verified from this environment, and the only evidence for
  the swap would be "fewer alerts" — not a fixed exploit in this
  architecture.
- Revisit if: a `xlsx` advisory becomes exploitable server-side, parsing
  ever moves server-side, or a patched `xlsx` version is published.

## Updates in this lot

None. No version was bumped: without audit access from the VM and
without an exploitable alert, bumping versions would be churn, not
security work. Dependency updates stay targeted version bumps, verified
by typecheck + lint + tests + build — never `npm audit fix --force`.
