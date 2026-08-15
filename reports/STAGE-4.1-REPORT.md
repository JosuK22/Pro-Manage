# Stage 4.1 — Migration Database Safety Hardening

## Status

**Complete.** Hardening only — the migration's logic, semantics and idempotency
are untouched.

```
No real migration was executed.
No live data was modified.
```

Two things this stage found that Stage 4 had wrong are documented below: the
`autoIndex` fix I reported in Stage 4 **never actually worked**, and your live
database is named `test`.

---

## Problem Identified

Stage 4 gated real execution on `NODE_ENV !== 'production'`. That is a label,
not a safety mechanism. This repository runs with `NODE_ENV=development` while
`MONGODB_URI` points at a live Atlas cluster holding 37 users, 33 tasks and 31
assignees — so the guard would have let a real migration run against real data
without complaint.

---

## Safety Strategy

The gate is now a **positive identity match**:

```text
name of the database the connection actually opened
                    ==
      name the operator explicitly confirmed
```

A mislabelled environment can no longer authorise anything. `NODE_ENV` is
displayed as context and retained only as a secondary layer.

---

## Database Identity Resolution

Taken from the live connection, never parsed from the URI:

```js
connection?.db?.databaseName ?? connection?.name ?? null
```

The URI can omit the database entirely, carry credentials, or carry query
parameters that shift the target. The connected database object is the only
authority on what is really being written to.

When it cannot be established the function returns `null`, and callers must
treat that as **refuse** — never as "probably fine". There is no fallback to
`NODE_ENV`.

---

## CLI Changes

```bash
# Read-only. No confirmation needed, writes nothing.
node scripts/migrate-to-workspaces.js --dry-run

# Real execution. Confirmation is mandatory.
node scripts/migrate-to-workspaces.js --confirm-database=<database-name>

node scripts/migrate-to-workspaces.js --help
```

Identity banner printed before anything else happens:

```text
Workspace Migration

Mode:         DRY RUN
Environment:  development
Database:     test
```

---

## Confirmation Mechanism

Order of checks, all in `checkExecutionSafety`:

1. dry run → allowed immediately (nothing to authorise)
2. database name unresolved → `UNKNOWN_DATABASE`
3. no `--confirm-database` → `CONFIRMATION_REQUIRED`
4. name mismatch → `DATABASE_MISMATCH`
5. `NODE_ENV=production` without `--allow-production` → `PRODUCTION_BLOCKED`
6. otherwise → allowed

**Exact, case-sensitive comparison.** MongoDB database names are
case-sensitive, so folding case would accept a name the server treats as a
different database.

The production check sits *after* the identity match deliberately, so it can
never be mistaken for the primary gate. A test asserts `--allow-production`
cannot substitute for confirmation.

**No bypass flag exists.** A test asserts `--force`, `--yes`, `--skip-safety`
and `--unsafe` are all inert.

---

## Dry-Run Behaviour

### Stage 4's fix did not work — corrected here

Stage 4 reported that `mongoose.set('autoIndex', false)` stopped dry runs from
creating empty collections. **It did not.** The new end-to-end test proved the
collections were still being created. Two reasons:

1. `mongoose.set()` only affects models compiled *after* the call, and every
   model is already compiled by the script's requires.
2. The empty collections were never `autoIndex`'s doing. Mongoose has a
   separate **`autoCreate`** option, defaulting to `true`, which calls
   `createCollection()` independently.

Both are now **connection options**:

```js
await mongoose.connect(process.env.MONGODB_URI, {
  autoIndex: false,
  autoCreate: false,
});
```

Applied to every run, not just dry runs, so nothing is created before the safety
gate has decided anything. Indexes are built explicitly via `syncIndexes()`
after a run passes confirmation *and* succeeds.

A dry run now performs **0 document writes, 0 collection creations, 0 index
builds** — verified by a test comparing the full collection list and per-collection
counts before and after.

---

## Production Guard

Retained, now secondary. Verified: `NODE_ENV=production` with a *correct*
database confirmation still exits 1 without `--allow-production`.

---

## Tests Added

**23 new tests** (46 total in the migration suite).

### Safety rules — unit

| Test | Asserts |
| --- | --- |
| matching confirmation | allowed |
| no confirmation | `CONFIRMATION_REQUIRED`, message names the exact database to type |
| wrong database | `DATABASE_MISMATCH`, shows connected vs confirmed |
| case sensitivity | `PROMANAGE-DEV` ≠ `promanage-dev` |
| unresolvable database | `UNKNOWN_DATABASE` |
| **`NODE_ENV=development` does not authorise a write** | still `CONFIRMATION_REQUIRED` |
| production guard | blocks, and `--allow-production` unblocks |
| `--allow-production` is not a substitute | still `CONFIRMATION_REQUIRED` |
| dry run in any environment | allowed without confirmation |
| argument parsing | empty confirmation is not a confirmation |
| no bypass flags | `--force` etc. are inert |
| identity resolution | prefers `db.databaseName`; returns null rather than guessing |
| banner redaction | no `mongodb://`, no `@` |

### CLI — real subprocess against the in-memory server

Each spawns the actual script with `MONGODB_URI` pointed at a dedicated
database, so the wiring is proven where it runs, not only where it is defined.

| Test | Asserts |
| --- | --- |
| no flags | exit ≠ 0, **document counts identical**, clear message |
| wrong confirmation | exit ≠ 0, counts identical — **did not partially execute** |
| `--dry-run` alone | exit 0, plan produced, **collection list unchanged**, no `workspaces` collection |
| correct confirmation | exit 0, backup warning shown, workspace + 3 roles + membership created, task backfilled |
| output redaction | neither dry run nor refusal prints a connection string |
| `--help` | prints usage |

---

## Test Results

```
Server tests:   148 / 148 passing   (5 suites)
  ├─ pre-existing:  55
  ├─ RBAC models:   47
  └─ migration:     46   (23 from Stage 4 + 23 new)
Client tests:    65 / 65 passing
Lint:            clean, 0 warnings
Build:           succeeds

Exit codes, verified against the development database:
  no confirmation                  → 1
  wrong confirmation               → 1
  --dry-run                        → 0
  NODE_ENV=production + right db   → 1
```

---

## Database Verification

Per §25, the connected database was identified without executing anything.

```text
Environment:  development
Database:     test
```

### ⚠️ Your live data is in a database named `test`

`MONGODB_URI` carries no database path segment, so the driver falls back to its
default, `test`. Three consequences:

1. The confirmation string for a real run would be **`--confirm-database=test`**
   — the least distinctive name possible, and exactly what a throwaway database
   would be called. The identity check still works, but it protects you much
   less than a name like `promanage-prod` would.
2. Anything else connecting to that cluster without an explicit database also
   lands on `test`.
3. I did **not** change the URI. Adding `/pro-manage` would point the running
   application at a different, empty database and your 37 users and 33 tasks
   would appear to vanish. Renaming the target is a data-move, not a config
   edit, and belongs in its own deliberate step.

State confirmed unchanged after all Stage 4.1 verification:

| Collection | Documents |
| --- | --- |
| users | 37 |
| tasks | 33 (0 with a workspace) |
| assignees | 31 |
| workspaces | 0 |
| roles | 0 |
| workspacememberships | 0 |
| workspaceinvitations | 0 |

The four empty collections are the artifacts left by Stage 4's *first* dry run,
before the `autoCreate` cause was understood. Stage 4.1 added nothing to them,
and future dry runs will not create their like again.

---

## Files Created

| File | Purpose |
| --- | --- |
| `server/services/migrationSafety.js` | Argument parsing, database identity resolution, the safety gate, redacted banner, usage text |

## Files Modified

| File | Why |
| --- | --- |
| `server/scripts/migrate-to-workspaces.js` | Uses the safety module; `autoIndex: false, autoCreate: false` as connection options; backup warning; `--help` |
| `server/tests/rbac.migration.test.js` | Added 23 safety tests |

**Not touched:** `workspaceMigration.js`, `workspaceProvisioning.js`, all
models, controllers, routes, middleware, frontend.

The safety logic went into a **new** module rather than into
`workspaceMigration.js` specifically so §2's "do not redesign" applies
literally — that file has zero changes this stage.

---

## Security Considerations

- The connection string is never rendered. The banner is built only from the
  resolved database name and `NODE_ENV`; a test asserts no `mongodb://` and no
  `@` appears in any output.
- Credentials, hosts and query parameters cannot reach a terminal history, a log
  or a CI transcript.
- No force/unsafe/skip flag exists, and a test would fail if one were added.
- The gate runs before `buildPlan()`, so a refused run performs no reads beyond
  connecting and no writes whatsoever.

---

## Remaining Limitations

- **The migration still has not been run.** Only dry runs.
- **The database is named `test`**, which weakens the confirmation's value as
  documented above. Worth fixing before a production cutover — as a deliberate
  data move.
- The confirmation is a single flag. A typo that happens to match the connected
  name still authorises the run; the protection is against *pointing at the
  wrong database*, not against changing your mind.
- The CLI takes no backup and does not claim to. It only reminds.
- Migration semantics, idempotency and additive guarantees are unchanged and
  re-verified by the existing 23 Stage 4 tests.

---

## Stage 5 Readiness

**Ready.** Nothing in this stage touches the authorization surface. The
migration is now safe to execute deliberately, and safe against being executed
accidentally.

To run it for real when you choose:

```bash
cd server
node scripts/migrate-to-workspaces.js --dry-run
node scripts/migrate-to-workspaces.js --confirm-database=test
```

Back up first — the CLI will remind you, but it will not do it for you.

---

## Final Assessment

The primary safety mechanism is now a positive database identity match rather
than an environment label. Wrong-database, missing-confirmation, unknown-database
and production paths all refuse with a non-zero exit and zero writes, proven by
tests that drive the real CLI as a subprocess.

The stage also corrected a claim from the Stage 4 report: dry runs were still
creating empty collections, because the cause was `autoCreate`, not `autoIndex`,
and because `mongoose.set()` came too late to affect already-compiled models.
Dry runs are now literally read-only.

**No real migration was executed. No live data was modified.**

**Stage 4.1 complete. Stopping — not beginning Stage 5.**
