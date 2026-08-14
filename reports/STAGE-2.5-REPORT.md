# Stage 2.5 — Test Fixtures

**Status:** Complete. Test files only — zero application code, models, routes or
dependencies changed.

Purpose: give the suite a single seam for workspace-awareness *before* any
model requires it, so the 55 existing tests stay green through the migration
rather than breaking all at once at Stage 8.

---

## What changed

### New — `server/tests/factories.js`

| Export | Purpose |
| --- | --- |
| `createUser(overrides)` | Registers through the real API, returns `{ user, token, email, password }` |
| `createTask(actor, overrides)` | Chainable supertest request — caller keeps the assertion |
| `listTasks(actor, query)` | Chainable `GET /tasks` |
| `authHeaders(actor)` | **The migration seam.** Token → headers, and later `X-Workspace-Id` |
| `withAuth(req, actor)` | Applies those headers to any request |
| `uniqueEmail(prefix)` | Collision-free addresses |
| `taskPayload(overrides)` | Minimum valid task body |
| `DEFAULT_PASSWORD` | Shared constant |

### Modified — three test suites

| File | Change |
| --- | --- |
| `stage1.test.js` | "Public task view" block now uses factories; registration/login tests left raw on purpose |
| `stage2.security.test.js` | Deleted local `registerUser` + `createTask`, imports instead |
| `stage3.data.test.js` | Same |

```
3 files changed, 19 insertions(+), 73 deletions(-)
```

---

## Design decisions

**`createTask` returns an unresolved request.** Eleven call sites deliberately
expect `400`, `409` or `413`. Baking in `.expect(201)` would have forced a
second "expect-failure" variant, so the factory sends the request and hands back
the chain.

**Actors are polymorphic.** `authHeaders` accepts a raw token string *or*
`{ token, workspace }`. Every existing `createTask(owner.token, …)` call site
kept working unchanged, so this stage carried no behavioural risk — while the
preferred `createTask(actor, …)` form is already available for Stage 8.

**Unique emails by default.** Both old helpers hardcoded `user@example.com`,
which only worked because the database is wiped between tests. Two
`registerUser()` calls in one test would have collided on the unique email
index — a trap that would have been hit the first time an RBAC test needed two
members. Tests that care about the address still pass it explicitly, and none
depended on the literal value (verified before changing).

**Registration tests were left alone.** `stage1`'s register/login cases *are*
the tests for registration semantics. Routing them through a factory would hide
the very payload under test.

**No stubs for the Stage 3 factories.** `createWorkspace`, `createRole`,
`createMember` and `setupWorkspace` are specified in the file header with exact
signatures, but not implemented — a stub returning half a graph is worse than an
honest absence.

**`setupTests.js` needed no change.** Its `afterEach` iterates
`mongoose.connection.collections`, so `workspaces`, `workspacememberships` and
`roles` will be wiped automatically the moment they exist.

---

## Verification

```
Server tests:  55 / 55 passing  (unchanged — that is the point)
Suites:        3 / 3
Client tests:  65 / 65 (untouched)

Application code changed:  none
Models changed:            none
Routes changed:            none
Dependencies installed:    none
```

`server/package.json` shows as modified in git, but that diff is the earlier
`bcrypt` 5→6 upgrade, not this stage.

---

## What Stage 3 inherits

- One place to add `X-Workspace-Id`: `authHeaders()`.
- One place to add workspace creation to user setup: `createUser()`.
- Documented signatures for the four workspace factories.

## Known limitation

The factories cannot yet produce a workspace, because no model exists. Stage 3
must extend `createUser` so every test user also receives a personal workspace,
mirroring what the Stage 4 migration does for existing production users —
otherwise fixtures and migrated data would diverge.

**Stage 2.5 complete. Stopping.**
