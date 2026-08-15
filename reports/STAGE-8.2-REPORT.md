# Stage 8.2 — Workspace Migration Preflight & Controlled Execution Report

## Status

**Complete — rehearsed on a disposable database. Production untouched.**

```
Migration execution status:  RUN AGAINST A DISPOSABLE IN-MEMORY DATABASE
Production / live data:      NOT TOUCHED, NOT CONNECTED TO
```

```
Server: 435 / 435 passing   (10 suites)
Client:  65 / 65 passing
Lint:    clean, 0 warnings
Build:   succeeds
```

Production readiness verdict: **NOT READY** — see
[Production Readiness Assessment](#production-readiness-assessment). One
blocking item remains, and it is not a code defect.

---

## Migration Implementation Reviewed

Read from source, not from the earlier reports. `services/workspaceMigration.js`
exports `preflight`, `buildPlan`, `execute`, `validate`, `formatReport`.
Provisioning lives in `services/workspaceProvisioning.js`; the CLI is
`scripts/migrate-to-workspaces.js` with the Stage 4.1 safety gate.

What it actually does, verified against the code:

| Step | Behaviour |
| --- | --- |
| Users | **Every** user gets a personal workspace, not only data owners |
| Workspace | `ensurePersonalWorkspace` keyed on `{ owner, isPersonal: true }` |
| Roles | `ensureSystemRoles` seeds OWNER/ADMIN/MEMBER by `systemKey` |
| Owner membership | `ensureMembership`, status `active`, OWNER role |
| Assignee → known user | MEMBER membership in the creator's personal workspace |
| Assignee → unknown email | Pending invitation, `tokenHash: null`, `expiresAt: null` |
| Task | `workspace` ← creator's personal workspace, filtered on `workspace: null` |

### Additions this stage

Two gaps against §10 and §29 were closed:

- **`preflight()`** — new. Reports index presence and whether every existing
  workspace still has its three system roles. Reads only.
- **`validate()`** — extended with referential integrity: every
  `workspace`/`role` reference must *resolve*, not merely agree. The previous
  checks proved related documents were consistent with each other but would
  pass even if the workspace they both named had never existed.

---

## Migration Contract

```text
User → personal Workspace (isPersonal: true)
         → Workspace.owner = User
         → active membership → OWNER system role

Assignee → registered?  → MEMBER membership in creator's workspace
         → unregistered? → pending WorkspaceInvitation

Task → workspace = creator's personal workspace   (only where workspace is null)
```

No mapping was invented. Personal workspace resolution is
`{ owner, isPersonal: true }` throughout — the database-enforced singleton from
Stage 4. Nothing resolves by name, by age, or via a mapping collection.

---

## Preflight Results

```text
ready:                    true
workspaces inspected:     3
workspaces missing roles: 0

indexes present / missing
  workspaces            3 / none   (incl. owner_1_isPersonal_1)
  roles                 3 / none   (incl. workspace_1_name_1, workspace_1_systemKey_1)
  workspacememberships  5 / none   (incl. workspace_1_user_1, workspace_1_role_1)
  workspaceinvitations  4 / none   (incl. workspace_1_email_1)
```

Preflight wrote nothing — verified by comparing a full snapshot before and
after.

---

## Test Database

An **in-memory MongoDB** (`mongodb-memory-server`, already a dev dependency),
created fresh per run and destroyed afterwards. Database name
`stage82_rehearsal`, chosen so it could not be mistaken for anything real.

This is the reset mechanism §24 asks for: every run starts from nothing, so
"reset → migrate → validate → reset → migrate again" is the normal case rather
than a special procedure.

No real or customer data was used. Fixtures are synthetic.

---

## Environment Safety Verification

**The configured `MONGODB_URI` was not connected to at any point in this stage.**

Stage 4.1 established why: it points at a live Atlas cluster holding 37 real
users, 33 real tasks and 31 real assignees, while `NODE_ENV=development` and the
database is literally named `test`. Under §3 that environment **cannot be
positively identified as non-production**, so it is out of bounds — for
execution *and*, by choice, for reading.

The figures from that cluster quoted below are the read-only counts recorded in
the **Stage 4.1 report**, not fresh reads.

The Stage 4.1 CLI guard remains in force: a real run requires
`--confirm-database=<name>` matching the connected database, and no bypass flag
exists.

---

## Pre-Migration Snapshot

Disposable database, after seeding the §25 fixture world:

| Entity | Count |
| --- | --- |
| Users | 4 |
| Workspaces | 3 |
| — personal | 1 |
| Roles | 9 |
| Memberships | 3 |
| Invitations | 0 |
| Assignees | 5 |
| Tasks | 6 |
| — with workspace | 1 |
| — without workspace | 5 |

Fixtures deliberately cover the awkward cases: a user with nothing, a user
already partially migrated, a user owning **two non-personal workspaces**, a
known assignee, an unknown email, casing duplicates, an owner listed as their
own assignee, a task already scoped, and a task whose creator no longer exists.

---

## Migration Execution

```bash
# preflight (read-only)
node scripts/migrate-to-workspaces.js --dry-run

# execution
node scripts/migrate-to-workspaces.js --confirm-database=<database-name>
```

Rehearsal ran the same `buildPlan` → `execute` → `validate` sequence the CLI
uses, against the disposable database.

| | Run 1 | Run 2 |
| --- | --- | --- |
| Workspaces created | 3 | **0** |
| Roles created | 9 | **0** |
| Owner memberships created | 3 | **0** |
| Memberships created | 2 | **0** |
| Invitations created | 1 | **0** |
| Tasks backfilled | 4 | **0** |
| Errors | 0 | 0 |
| Duration | 60 ms | 20 ms |
| Validation | passed | passed |

Skipped/failed: 1 task deliberately left unmapped (orphan), 1 assignee skipped
as owner-self, 1 assignee collapsed as a casing duplicate, 1 task left alone
because it already had a workspace. **0 failures.**

---

## Post-Migration Validation

`validate()` passed with **zero failures** after both runs. It checks: workspace
owners resolve to real users; every workspace has all three system roles;
exactly one active OWNER membership per workspace matching `workspace.owner`;
membership and invitation roles belong to the same workspace; every task with a
resolvable creator has a workspace; every workspace and role reference resolves;
one personal workspace per owner.

---

## Personal Workspace Validation

| Check | Result |
| --- | --- |
| Every user has exactly one personal workspace | ✅ 4 / 4 |
| `owner` resolves to a real user | ✅ |
| `isPersonal === true` | ✅ |
| No duplicate personal workspace per owner | ✅ |
| Owner membership exists, active, OWNER role | ✅ |

**The case that matters most:** Linus owns two non-personal workspaces plus his
personal one. A test asserts he ends with 3 owned workspaces, exactly 1 personal,
and that his task is scoped to the *personal* one — the resolution strategy Stage
4.1's `isPersonal` flag exists to make unambiguous.

---

## Membership Validation

3 → 8 memberships. Every one verified: workspace resolves, user resolves, role
resolves, and `membership.role.workspace === membership.workspace`. Every OWNER
membership matches its workspace's `owner`, and there is exactly one per
workspace.

An owner listed as their own assignee keeps the **OWNER** role rather than being
demoted to MEMBER.

---

## Invitation Validation

1 invitation created, for `stranger@example.com`. Status `pending`, role MEMBER,
`invitation.role.workspace === invitation.workspace`.

**`tokenHash: null` and `expiresAt: null`.** A migrated record is not an
invitation anyone was ever sent; minting a token would fabricate one. No
plaintext token exists anywhere, and none is logged.

No user was created for the unknown email — user count stayed at 4.

---

## Role Validation

9 → 18 roles (6 workspaces × 3). All resolved by `systemKey`, never by display
name — a test renames a MEMBER role to "Contributor" and preflight still finds
it. Every role's workspace resolves.

Preflight refuses to proceed cleanly if a workspace is missing a system role: a
test deletes one and confirms `ready: false` with the specific role named.

---

## Task Workspace Validation

| | Before | After |
| --- | --- | --- |
| Total | 6 | 6 |
| With workspace | 1 | **5** |
| Without workspace | 5 | **1** |

The remaining one is the orphan, and that is correct.

- The pre-scoped task kept its original workspace — the update filter includes
  `workspace: null`, so an already-scoped task is never touched even by a stale
  plan.
- Every `Task.workspace` references a workspace that exists.
- **`Task.workspace` remains optional** (`required: false`, verified). Schema
  hardening is not part of this stage.

---

## Assignee Validation

5 assignees, all with a deterministic outcome:

| Case | Outcome |
| --- | --- |
| Known user (`mate@`) | MEMBER membership in the creator's workspace |
| Unknown email (`stranger@`) | Pending invitation |
| Owner listed as own assignee | Skipped — already the OWNER |
| Casing duplicate (`MATE@` + `mate@`) | Collapsed to one membership |
| Creator no longer exists | Reported as an anomaly; nothing created |

**The Assignee collection is untouched** — 5 before, 5 after. Retirement is a
later stage, and the rows are worth keeping for rollback and debugging.

---

## Cross-Workspace Integrity

Explicitly queried after migration, all zero:

- membership whose role belongs to another workspace — **0**
- invitation whose role belongs to another workspace — **0**
- workspace whose owner is not a real user — **0**
- OWNER membership pointing at the wrong user — **0**
- personal workspace with a duplicate owner — **0**

---

## Referential Integrity

Every reference verified to resolve, not merely to agree:

| Reference | Dangling |
| --- | --- |
| `Task.workspace` → Workspace | 0 |
| `Membership.workspace` → Workspace | 0 |
| `Membership.role` → Role | 0 |
| `Role.workspace` → Workspace | 0 |
| `Invitation.workspace` → Workspace | 0 |
| `Invitation.role` → Role | 0 |

A test breaks one deliberately (points a task at a non-existent workspace) and
confirms validation now fails — this check did not exist before this stage.

---

## Idempotency Results

| Entity | Before | After 1 | Δ1 | After 2 | Δ2 |
| --- | ---: | ---: | ---: | ---: | ---: |
| users | 4 | 4 | 0 | 4 | **0** |
| workspaces | 3 | 6 | +3 | 6 | **0** |
| personal | 1 | 4 | +3 | 4 | **0** |
| roles | 9 | 18 | +9 | 18 | **0** |
| memberships | 3 | 8 | +5 | 8 | **0** |
| invitations | 0 | 1 | +1 | 1 | **0** |
| assignees | 5 | 5 | 0 | 5 | **0** |
| tasks | 6 | 6 | 0 | 6 | **0** |
| tasks with workspace | 1 | 5 | +4 | 5 | **0** |
| tasks without workspace | 5 | 1 | −4 | 1 | **0** |

A third run also produces zero. A full reset-and-repeat cycle (wipe everything,
re-seed, migrate again) produces a **byte-identical snapshot**.

---

## Failure-Path Tests

| Scenario | Behaviour |
| --- | --- |
| Task whose creator vanished | Reported as an anomaly; left `null`; not deleted, not guessed |
| Assignee whose creator vanished | Reported; nothing created |
| Membership pointed at a foreign role | Validation **fails** |
| Task pointed at a non-existent workspace | Validation **fails** |
| System role deleted post-migration | Validation **fails** |
| Owner membership removed | Validation **fails** |
| Task created after migration | Validation **fails** (`task backfilled`) |

Corrupted data is never laundered into apparently valid data, and an incomplete
migration cannot report success.

---

## Performance

Run 1: **60 ms**. Run 2: **20 ms**. On 4 users, 6 tasks and 5 assignees.

**This dataset is far too small to characterise production performance** — it
says nothing useful about 37 users or about a dataset an order of magnitude
larger.

Query-shape review found no N+1 in the planning pass: users, workspaces, roles,
memberships, assignees, invitations and tasks are each read once, in bulk, and
joined in memory via `Map`. `execute()` does perform per-user work
(`ensurePersonalWorkspace` → `ensureSystemRoles` → `ensureMembership`), which is
inherent to resolve-then-create idempotency and is bounded by user count, not by
task count. `resolve()` memoises per owner within a run.

No caching was introduced.

---

## Database Indexes

All expected indexes present after migration:

```text
workspaces            _id_, owner_1, owner_1_isPersonal_1
roles                 _id_, workspace_1_name_1, workspace_1_systemKey_1
workspacememberships  _id_, workspace_1_user_1, user_1_status_1,
                      workspace_1_status_1, workspace_1_role_1
workspaceinvitations  _id_, workspace_1_email_1, email_1_status_1,
                      workspace_1_status_1
```

No index was created or duplicated by this stage. The CLI builds them via
`syncIndexes()` **after** a successful run, which is why preflight reports them
missing on a first-ever migration — expected, and stated in the finding.

**No Task workspace index exists yet**, deliberately. It belongs with the
queries that will need it.

---

## Authorization Smoke Tests

Against migrated data, using the Stage 5 engine unchanged:

| Actor | Check | Result |
| --- | --- | --- |
| Migrated owner, own workspace | `workspace.delete` | ✅ allowed, `isOwner` |
| Migrated assignee | `tasks.view: assigned` | ✅ allowed |
| Migrated assignee | `tasks.delete` | ❌ denied — Member has no delete |
| Non-member | `tasks.view` | ❌ `NOT_A_MEMBER` |
| Owner of another workspace | `workspace.delete` | ❌ authority does not travel |
| Migrated task as a resource | `tasks.view` | ✅ allowed |
| **Orphan task** as a resource | `tasks.view` | ❌ `RESOURCE_OUTSIDE_WORKSPACE` |

That last row is the important one: an unmigrated task is correctly refused,
which is exactly why task routes cannot be wired before the real migration runs.

---

## Regression Results

```
Server:  435 / 435   (10 suites)
  pre-existing:   55
  RBAC models:    47
  migration:      46
  authorization:  79
  members:        73
  roles:          68
  context:        31
  migration e2e:  36   new
Client:   65 / 65
Lint:     clean
Build:    succeeds
```

One test of mine failed during development and was **my error, not the
migration's**: the reset-and-repeat case dropped *all* workspaces including the
fixture's non-personal ones, which the migration is right not to recreate, so
the two runs measured different worlds. Rewritten as a full wipe-and-reseed.

No existing test was removed or weakened.

---

## Git Diff Review

`git diff` over `client/`, `taskRoute.js`, `taskController.js`, `taskModel.js`,
`assigneeModel.js` and `services/authorization/` is **empty**.

`Task.workspace.isRequired === false`, verified programmatically.

No dumps, credentials, connection strings or production data were added. The
rehearsal harness lives in the session scratchpad, outside the repository.

Changed this stage: `services/workspaceMigration.js` (preflight + referential
integrity) and the new `tests/workspace.migration.e2e.test.js`.

---

## Production Readiness Assessment

### NOT READY

Not because anything failed — everything passed — but because §42's checklist
has one item that testing cannot supply.

| Requirement | Status |
| --- | --- |
| Idempotency | ✅ proven over three runs |
| Validation | ✅ zero failures |
| Referential integrity | ✅ zero dangling |
| No unresolved records | ⚠️ **1 orphan expected in production** |
| No duplicate personal workspaces | ✅ |
| No cross-workspace relationships | ✅ |
| Task workspace completeness | ⚠️ complete *except* orphans |
| Rollback / recovery plan | ✅ documented |
| Runtime characteristics | ❌ **unknown at production scale** |
| Execution command | ✅ |
| Preflight command | ✅ |
| Postflight validation | ✅ |

### The blocking item

**Runtime behaviour at production scale is unmeasured.** 60 ms on 4 users tells
us nothing about 37 — let alone about growth. Stage 4's dry run against the real
cluster reported **0 orphaned tasks and 0 errors**, which is a good sign, but a
dry run measures planning, not execution.

Passing tests on synthetic data is **not** the same as being safe to run against
real data, and §43 is explicit that the two must not be conflated.

---

## Known Limitations

- **No transactions.** MongoDB requires a replica set;
  `mongodb-memory-server` is standalone, so a transactional path could not be
  tested. Idempotent resolve-then-create is used instead, giving resumability
  rather than atomicity. **No atomicity is claimed.**
- **Orphaned tasks stay orphaned.** By design — the migration will not guess a
  workspace for a task whose creator no longer exists. They must be resolved by
  a human, or accepted as permanently unscoped, before `Task.workspace` can
  become required.
- **Rehearsal scale is tiny.** 4 users vs 37 in the real cluster.
- **The `NODE_ENV` guard does not protect the configured cluster**, since it is
  labelled `development`. The `--confirm-database` gate is the real protection.
- **`Task.workspace` is still optional** and there is no Task workspace index.
- **The Assignee collection is still present and populated.**

---

## Required Steps Before Production

1. **Take a full database backup.** The CLI reminds but does not create one.
2. Run `--dry-run` against the target and confirm the orphan count is
   acceptable — Stage 4 reported 0.
3. Decide what happens to any orphaned tasks. They will remain invisible to the
   workspace-scoped API once Stage 8.3 lands.
4. Resolve the ambiguity that the production database is named `test`. The
   confirmation string would be `--confirm-database=test`, which is the least
   distinctive name possible.
5. Run the migration, then `validate()`, and require zero failures.
6. Only then consider Stage 8.3 (task route integration).

Rollback, while `Task.workspace` remains optional: drop `workspaces`, `roles`,
`workspacememberships`, `workspaceinvitations`, and `$unset` `task.workspace`.
No original field is modified, so nothing is lost by reverting. After schema
hardening, restore from backup instead.

---

## Stage 8.3 Readiness

**The code is ready; the data is not yet.**

Stage 8.3 needs every task to carry a workspace, or the engine will correctly
refuse it — demonstrated by the orphan smoke test above. That requires the real
migration to have been executed against the real database, which is a decision
for you, not something this stage should perform.

---

## Final Assessment

The migration is demonstrably safe, repeatable and auditable **on synthetic
data**: idempotent across three runs and a full reset cycle, validated with zero
failures, referentially intact, and correct on every awkward case the fixtures
throw at it — including the one that would defeat a naive personal-workspace
resolution.

Two real gaps were closed rather than assumed away: preflight now checks index
and system-role readiness, and validation now proves references *resolve* rather
than merely agree.

It is **not** certified production-ready. Testing proved the logic; it did not
prove the runtime, and it did not touch the data that matters.

```
Production was not touched.
The configured MONGODB_URI was never connected to.
No task routes were modified.
Task.workspace is still optional.
No frontend changes.
Assignee was not retired.
```

**Stage 8.2 complete. Stopping — not beginning Stage 8.3.**
