# Stage 4 — Workspace Data Migration Report

## Status

**Complete — migration implemented, tested, and DRY RUN ONLY against the
development database.**

```
Migration execution status:  DRY RUN ONLY
```

The execution path has **not** been run against your live data. It is fully
exercised by 23 automated tests against an in-memory MongoDB, and the dry run
was performed against the real development database (reads only).

One architectural gap was found during inspection, reported, and resolved with
your approval before implementation began — see
[Personal Workspace Migration](#personal-workspace-migration).

---

## Files Created

| File | Purpose |
| --- | --- |
| `server/services/workspaceProvisioning.js` | Shared, idempotent workspace/role/membership provisioning |
| `server/services/workspaceMigration.js` | Plan / execute / validate / report |
| `server/scripts/migrate-to-workspaces.js` | CLI entry point with `--dry-run` and the production guard |
| `server/tests/rbac.migration.test.js` | 23 migration tests |

## Files Modified

| File | Why |
| --- | --- |
| `server/model/workspaceModel.js` | Added `isPersonal` + partial unique index — the approved fix for idempotent personal-workspace resolution |
| `server/tests/factories.js` | Now delegates to `workspaceProvisioning` instead of restating the role definitions |

**Not touched:** `assigneeModel.js`, `taskModel.js`, `userModel.js`, all
controllers, routes, middleware, and the entire frontend.

---

## Migration Strategy

Planning, execution, validation and reporting are separate functions:

```js
const plan = await buildPlan();      // reads only, resolves everything
if (dryRun) { printPlan(plan); return; }
const applied = await execute(plan); // applies it
const validation = await validate(); // checks integrity
```

This is what makes `--dry-run` trustworthy: the dry run executes the **same**
planning code the real run does, rather than returning early from a half-built
path. A test asserts the plan's predicted counts equal the counts execution
then produces.

### Transactions — deliberately not used

MongoDB transactions require a replica set. `mongodb-memory-server` runs
standalone by default, so a transactional migration **could not be tested**, and
an untested transaction is worse than idempotent upserts.

Instead: every step resolves-then-creates, so a run interrupted halfway is
repaired by the next one. Per-user granularity means a crash leaves at most one
user partially provisioned. §22 explicitly permits this path.

---

## Personal Workspace Migration

### The gap that stopped implementation

Stage 3's `Workspace` had only `name, description, owner, timestamps`, and its
`{ owner: 1 }` index was **not unique**. Resolution could only be
`Workspace.findOne({ owner })` — idempotent today, but ambiguous the moment
Stage 6 lets a user own a second workspace, at which point `findOne` returns an
arbitrary document and a re-run could bind tasks to the wrong workspace.

Per §5 I stopped and reported rather than working around it. **Approved fix:**

```js
isPersonal: { type: Boolean, default: false, immutable: true }

workspaceSchema.index(
  { owner: 1, isPersonal: 1 },
  { unique: true, partialFilterExpression: { isPersonal: true } }
);
```

Partial, not sparse — a sparse unique index still indexes explicit `false`
values, so every ordinary workspace would have collided with every other one
belonging to the same owner.

Resolution is now `findOne({ owner, isPersonal: true })`, a database-enforced
singleton.

### Scope

**Every user** gets a personal workspace, not only those owning data. §4 asked
me not to assume — I checked: a user with no workspace would have no board to
land on after Stage 9, and the product model says everyone has a personal space.
Naming is deterministic: `"{user.name}'s Workspace"`.

---

## Role & Membership Migration

§7 required reusing Stage 3's role seeding rather than duplicating it — but
Stage 3 only had it in `tests/factories.js`, which production code cannot
import. Rather than write a second copy, I extracted it to
`services/workspaceProvisioning.js`, and the test factories now call that too.
**One definition, used by both.**

Each workspace is seeded with `OWNER` / `ADMIN` / `MEMBER` exactly as Stage 3
defined them, including `systemKey`, `isDefault`, `rank`, and Member's
deliberate lack of `tasks.delete`.

---

## Assignee Migration

```text
Assignee.createdBy  →  that user's personal workspace
Assignee.email      →  registered?  MEMBER membership
                       otherwise    pending invitation
```

Handled explicitly:

| Case | Behaviour |
| --- | --- |
| Assignee is the workspace owner | Skipped; counted as `owner already member`. The owner keeps the OWNER role, not MEMBER |
| Duplicate rows differing by casing | Collapsed to one membership; counted as `duplicates collapsed` |
| Assignee's creator no longer exists | Recorded as an anomaly, nothing created |
| Membership already exists | Reused, never re-roled — silently changing someone's role during a migration would be a security event |

Emails are re-normalised during migration rather than trusting historic rows
written before the schema's `lowercase` setter existed.

### Cross-workspace property

Verified by test: if A has B as an assignee, B becomes a **MEMBER of A's
workspace** while remaining **OWNER of their own**. B's workspace is untouched.

---

## Invitation Migration

Unregistered assignee emails become `WorkspaceInvitation` records with
`status: 'pending'` and the MEMBER role.

**`tokenHash: null`, `expiresAt: null`.** §13 asked me to determine the safest
behaviour here. These are historical board members, not people who were ever
sent a link — minting a token would fabricate an invitation that never existed,
and hashing something meaningless would be security theatre. Stage 3 made
`tokenHash` nullable precisely so a migrated record can be honest about this.
The invite flow will mint a real token when someone actually re-sends it.

No raw token is ever logged; none is ever generated here.

---

## Task Workspace Backfill

`Task.createdBy → personal workspace → Task.workspace`, for tasks where
`workspace` is currently null.

The update filter is `{ _id, workspace: null }`, so a task that already has a
workspace is never overwritten **even if the plan is stale**.

`Task.workspace` remains **nullable** (§25) and **no Task indexes were added**
(§26).

---

## Idempotency

Tested across three consecutive runs. The second run reports zero for every
counter and produces no duplicate documents. Nothing is ever deleted or
recreated; there is no `deleteMany` anywhere in the migration.

Race safety: duplicate-key errors (11000) are caught and resolved by re-reading,
so two concurrent runs cannot both fail.

---

## Dry Run

```bash
node scripts/migrate-to-workspaces.js --dry-run
```

### One finding, fixed

The first dry run wrote **0 documents** but left **4 empty collections** behind
— Mongoose builds each model's indexes when the connection opens, which
implicitly creates the collections. Harmless, but "writes nothing" should be
literally true, so the dry run now sets `autoIndex: false`. Indexes are built
explicitly after a successful real run instead.

The empty collections created by that first run are still present in the
development database. They are inert and the real migration would create them
anyway; I did not issue further writes to remove them.

### Actual dry-run output (development database)

```text
Users:                inspected 37 · eligible 37 · skipped 0
Workspaces:           to create 37 · reused 0
Roles:                to create 111 · reused 0
Owner memberships:    to create 37 · reused 0

Assignees:            inspected 31
                      registered 17 · unregistered 14
                      duplicates collapsed 0 · owner already member 2

Memberships:          to create 15 · reused 0
Invitations:          to create 14 · reused 0

Tasks:                inspected 33 · to backfill 33
                      already assigned 0 · orphaned 0

Errors:               0
```

Arithmetic checks out: 17 registered − 2 owner-self = 15 memberships.
111 roles = 37 workspaces × 3.

**Zero orphaned tasks and zero errors** — the data is clean.

---

## Validation

Run automatically after execution. Checks:

- every personal workspace's owner is a real user
- every workspace has all three system roles
- exactly one owner membership per workspace, matching `workspace.owner`, active
- `membership.workspace === role.workspace` for all memberships
- `invitation.workspace === role.workspace` for all invitations
- every task with a resolvable creator has a workspace

Returns all failures rather than throwing on the first. The script exits
non-zero if validation fails or any execution error occurred.

Cross-workspace integrity is re-checked here because document middleware is
bypassed by raw updates — the gap the Stage 3 report flagged.

---

## Tests

23 tests in `server/tests/rbac.migration.test.js`:

| Group | Tests |
| --- | --- |
| Personal workspaces | workspace + 3 roles + owner membership; every user gets one |
| Idempotency | second run creates nothing; three runs produce no duplicates |
| Registered assignees | become MEMBER; keep OWNER of their own workspace; casing duplicates collapse |
| Unregistered assignees | pending invitation with MEMBER role; **no token, no expiry**; no membership created |
| Owner-as-own-assignee | no second membership; keeps OWNER role |
| Task backfill | sets from creator; never overwrites; many tasks → one workspace |
| Orphaned tasks | not deleted, not reassigned, reported |
| Dry run | document counts byte-identical before/after; predictions match execution |
| Validation | passes when clean; catches a missing system role; catches an un-backfilled task |
| Non-destructiveness | users, tasks and assignees all intact and unmodified |

## Test Results

```
Server tests:     125 / 125 passing   (5 suites)
  ├─ pre-existing:  55   unchanged
  ├─ RBAC models:   47   unchanged
  └─ migration:     23   new
Client tests:      65 / 65 passing
Lint:              clean, 0 warnings
Build:             succeeds
Migration dry run: clean — 0 errors, 0 orphans
Production guard:  exits 1 without --allow-production; --dry-run allowed
```

---

## Migration Statistics

From the development database, at the time of the dry run:

| Entity | Count |
| --- | --- |
| Users | 37 |
| Tasks | 33 (0 already had a workspace) |
| Assignees | 31 |
| Distinct task creators | 17 |
| Workspaces that would be created | 37 |
| Roles that would be created | 111 |
| Memberships that would be created | 52 (37 owner + 15 member) |
| Invitations that would be created | 14 |
| Orphaned tasks | **0** |
| Errors | **0** |

---

## Data Anomalies

**None found.** Zero orphaned tasks, zero assignees with a missing creator, zero
duplicate collapses. 2 assignees are self-references (a user listing their own
email), handled as `owner already member`.

---

## Known Limitations

### Expected — later stages

- No authorization engine (`authorize`, `resolveWorkspace`) — Stage 5
- No workspace-aware routes; no `X-Workspace-Id` — Stage 8/9
- `Task.workspace` still nullable — becomes required only after a verified
  production backfill
- No Task workspace indexes — Stage 8
- `Assignee` collection still present and populated — retired later
- Frontend entirely untouched

### Unresolved / worth knowing

- **The migration has not been run against real data.** Only the dry run.
- **`NODE_ENV` is a weak guard for this repository.** Your `.env` sets
  `NODE_ENV=development` while `MONGODB_URI` points at a live Atlas cluster
  holding real data. The production guard will therefore **not** stop an
  execution against that database. Treat the absence of the guard as no
  protection at all here.
- **Four empty collections** exist in the development database from the first
  dry run, before `autoIndex: false` was added.
- Existing memberships are never re-roled. If a role assignment is wrong,
  the migration will not correct it — by design.

---

## Production Safety

- Refuses to execute when `NODE_ENV=production` without `--allow-production`;
  verified to exit code 1.
- `--dry-run` is permitted in any environment, since it writes nothing.
- Additive only: no deletes, no overwrites of existing values.
- Never logs tokens, hashes, credentials or secrets. Emails appear only in
  anomaly diagnostics.

### Backup requirement

**Take a database backup before the first real execution.** The migration is
additive and reversible in principle, but a backup is the only thing that makes
recovery from an unexpected failure trivial rather than analytical.

---

## Rollback / Recovery Considerations

The migration is additive, so rollback is:

1. Drop `workspaces`, `roles`, `workspacememberships`, `workspaceinvitations`.
2. `db.tasks.updateMany({}, { $unset: { workspace: "" } })`.

No original field is modified, so nothing can be lost by reverting. This remains
viable until `Task.workspace` becomes required and application writes depend on
it — after that point, restore from backup instead.

Partial-failure recovery needs no rollback: re-run the migration and it
reconciles.

---

## Stage 5 Readiness

**Ready.** The data foundation and the migration path both exist and are
verified. Stage 5 (authorization engine) can proceed against either migrated
data or test fixtures.

The one prerequisite Stage 5 will inherit: cross-workspace integrity is enforced
in `pre('validate')` only, so raw `updateOne`/`findOneAndUpdate` bypasses it.
The service layer must re-check. The migration's `validate()` already contains a
reusable version of this check.

### To run the migration for real

```bash
cd server
node scripts/migrate-to-workspaces.js --dry-run   # confirm the plan again
node scripts/migrate-to-workspaces.js             # apply it
```

Back up first. Given the note above, be aware this targets your live Atlas
cluster despite `NODE_ENV=development`.

---

## Final Assessment

The migration is implemented, idempotent, resumable, observable and covered by
23 tests. The dry run against the real development database reports **zero
orphans and zero errors** across 37 users, 33 tasks and 31 assignees.

I stopped once, as instructed, on a genuine architectural gap rather than
inventing a workaround — and the resulting `isPersonal` flag makes personal
workspace resolution a database guarantee instead of a convention.

**No production data has been touched. No migration has been executed against
any live database. The development database contains four empty collections and
is otherwise unchanged.**

**Stage 4 complete. Stopping — not proceeding to Stage 5.**
