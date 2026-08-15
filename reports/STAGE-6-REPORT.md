# Stage 6 — Workspace Member & Invitation Management Report

## Status

**Complete.**

```
No production migration was executed.
No frontend changes were made.
No role-management API was implemented.
No ownership-transfer API was implemented.
```

```
Server: 300 / 300 passing   (7 suites)
Client:  65 / 65 passing
Lint:    clean, 0 warnings
Build:   succeeds
```

Verified by `git diff`: `taskRoute.js`, `taskController.js` and `taskModel.js`
are untouched. The Stage 5 boundary holds everywhere except the new endpoints.

---

## Scope

Implemented: member listing and lookup, invitation creation, listing, revocation
and acceptance, role assignment, suspension, reactivation, removal.

Not implemented: role CRUD (Stage 7), ownership transfer, workspace deletion,
task-route integration, global workspace middleware, Assignee retirement.

---

## Architecture

```text
Request → protect (JWT) → validate → controller
                                        ↓
                                     service          ← authorization lives here
                                        ↓
                            authorization engine (Stage 5)
                                        ↓
                                 database mutation
```

Controllers are translation only. Every rule lives in the services, because a
future caller — a script, a job, another service — may never go through HTTP,
and the controller must not be the only boundary. A test calls the services
directly with a permissionless actor and confirms they still refuse.

---

## Files Created

| File | Purpose |
| --- | --- |
| `server/services/workspace/workspaceErrors.js` | 15 domain codes + status mapping |
| `server/services/workspace/membershipService.js` | List, view, assign role, suspend, reactivate, remove |
| `server/services/workspace/invitationService.js` | Invite, list, revoke, accept |
| `server/controllers/workspaceMemberController.js` | Thin HTTP layer |
| `server/routes/workspaceRoute.js` | Routes + separate accept router |
| `server/tests/workspace.members.test.js` | 73 tests |

## Files Modified

| File | Why |
| --- | --- |
| `server/app.js` | Mount the two new routers |
| `server/middleware/validate.js` | 4 validators + a `next()`-style error helper |
| `server/controllers/errorController.js` | **Security fix** — see below |

### The errorController change was necessary, not incidental

The handler returned `error.message` in production. `AuthorizationError.message`
holds the **diagnostic** ("Role 'Coordinator' does not grant 'members.remove'"),
while `publicMessage` holds the safe one. Without this change, denial text would
have named roles, permissions and workspaces to callers with no access to them.
Production now prefers `publicMessage`; development still shows detail, matching
how it already exposes stack traces.

---

## Member Service

`listMembers`, `getMember`, `assignMemberRole`, `suspendMember`,
`reactivateMember`, `removeMember`.

Every one calls `authorization.authorize()` before it reads or writes. Listing
is paginated **in the database** (default 50, max 100) and every query carries
`workspace` as a filter field — never fetch-then-filter.

Member responses are built by **explicit field picking**, not by deleting
unwanted keys: an allowlist cannot be defeated by a field appearing on the model
later. A test asserts the user object has exactly `_id`, `name`, `email`, and
that no response contains `password`, `tokenHash` or a bcrypt prefix.

### On `members.edit`

**No generic edit endpoint was built.** `WorkspaceMembership` has exactly two
mutable fields — `role` and `status` — and both are already governed by more
specific permissions (`members.assign_role`, `members.suspend`). A generic edit
would therefore be either a no-op or a way around those two, which §23 forbids.
`members.edit` remains in the catalogue, currently ungranted by any endpoint.

---

## Invitation Service

`inviteMember`, `listInvitations`, `revokeInvitation`, `acceptInvitation`.

Emails are normalised with `trim` + `lowercase`, matching the User and Assignee
models' own setters. A test invites `"  MiXeD@Example.COM "` and confirms the
second attempt at `mixed@example.com` conflicts.

Inviting somebody **as a role is a role assignment**, so it runs through the
same `checkRoleAssignment` delegation rules. Otherwise the invite endpoint would
be a way to mint Admins that the role endpoint refuses — tested.

---

## API Endpoints

```text
GET    /api/v1/workspaces/:workspaceId/members
GET    /api/v1/workspaces/:workspaceId/members/:membershipId
PATCH  /api/v1/workspaces/:workspaceId/members/:membershipId/role
PATCH  /api/v1/workspaces/:workspaceId/members/:membershipId/suspend
PATCH  /api/v1/workspaces/:workspaceId/members/:membershipId/reactivate
DELETE /api/v1/workspaces/:workspaceId/members/:membershipId

GET    /api/v1/workspaces/:workspaceId/invitations
POST   /api/v1/workspaces/:workspaceId/invitations
DELETE /api/v1/workspaces/:workspaceId/invitations/:invitationId

POST   /api/v1/invitations/accept
```

**Workspace travels in the path, not a header.** These are new routes, so there
is no churn to avoid, and putting the tenant in the URL makes the boundary
visible at the routing layer. This is *not* the global workspace-context
mechanism — how existing task routes acquire a workspace remains the integration
stage's problem, and the `X-Workspace-Id` decision from Stage 2 still applies
there.

Acceptance sits outside the workspace path deliberately: the accepting user is
not a member yet, so there is nothing to scope the request to. The token is the
credential.

Role assignment is its own endpoint rather than a field on a generic update, so
it can never be reached without passing the delegation rules.

---

## Authorization Integration

| Operation | Permission |
| --- | --- |
| list / view members, list invitations | `members.view` |
| invite, revoke | `members.invite` + `checkRoleAssignment` |
| assign role | `members.assign_role` + `checkRoleAssignment` |
| suspend / reactivate | `members.suspend` |
| remove | `members.remove` |

### Proving it, rather than asserting it

§53 warns that endpoint tests can silently pass against reimplemented rules.
Two things address that:

1. **Spies.** Tests assert `authorization.authorize` was called with the exact
   permission. This forced a real change: the services originally destructured
   `const { authorize } = require(...)`, which captures the reference at require
   time and makes the call **invisible to a spy**. They now use a namespace
   import, so the call is observable — a test that cannot see the call cannot
   prove it happened.
2. **Direct service calls.** A permissionless actor invokes the services with no
   HTTP involved and is refused.

No role-name comparison exists anywhere in the new code — verified by grep for
`role.name ===`, `isAdmin` and `user.role`.

---

## Membership Lifecycle

`active ⇄ suspended`, plus removal. No status was invented; removal is a delete,
not a state.

Suspension and reactivation both use conditional updates
(`{ status: 'active' }` / `{ status: 'suspended' }` in the filter), so two
concurrent calls cannot both report success. Reactivation is governed by
`members.suspend` — the same capability that imposed it, and without it a
suspension would be irreversible.

**Self-suspension and self-removal are denied.** §24/§25 said not to invent
behaviour; neither is part of the current product semantics, so both refuse
with `SELF_ACTION_NOT_ALLOWED`.

---

## Invitation Lifecycle

`pending → accepted | revoked | expired`. TTL is 14 days, set by the service
rather than the model — expiry length is a product decision.

### Duplicate pending invitations: conflict, not refresh

Only the hash is stored, so the original link **cannot** be re-sent, and quietly
minting a new token would invalidate a link the invitee may already hold without
anyone asking for that. A second invitation therefore returns
`INVITATION_ALREADY_PENDING` (409), and revoking first makes the intent
explicit. Tested both ways.

### Token handling

Only the SHA-256 digest is persisted. The plaintext is returned **once**, to the
authorised inviter, for delivery — and never appears on any listing endpoint.
Tests assert the stored document does not contain the plaintext anywhere, and
that listings contain neither the token nor the field name.

`acceptInvitation` does not even select `tokenHash`: a query can filter on an
unselected field, so the digest never needs to be in memory.

### Acceptance ordering, without transactions

The test environment is a standalone mongod, so a transactional path could not
be tested — and an untested transaction is worse than a reasoned ordering. The
membership is created **before** the invitation is marked accepted:

- If the second write fails: a pending invitation whose membership already
  exists. Re-accepting is idempotent. Recoverable.
- The reverse order risks consuming the invitation while leaving the invitee
  with no membership and no way back in.

---

## Role Assignment

Delegation is entirely Stage 5's `checkRoleAssignment`; none of it is restated
here. Owner is never assignable, Admin needs `members.assign_admin`, and rank
must strictly exceed the target.

**Ordering changed during implementation.** The role is now resolved
workspace-scoped *first*, so a missing role and a role belonging to another
workspace both return **404** rather than 403 — matching the invitation flow and
refusing to confirm another workspace's role ids.

---

## Suspension / Removal / Owner Protection

`assertNotWorkspaceOwner` checks against `Workspace.owner`, the authoritative
field — not against whoever holds the Owner role.

The owner cannot be removed, suspended, or given a different role. Removing them
would leave `workspace.owner` pointing at a non-member, which Stage 5 then
refuses **for everyone**, locking the workspace permanently.

The owner-protection tests deliberately grant the acting Admin
`members.suspend` and `members.assign_admin` first, so they prove the *guard*
fires rather than merely that a permission was missing.

---

## Cross-Workspace Protection

Every membership, role and invitation lookup carries `workspace` in the query.
Tested: a workspace owner has full authority at home and **none** of it in a
workspace where they are an ordinary member; a foreign membership id 404s; a
foreign role 404s; a foreign invitation cannot be revoked and remains pending.

---

## Concurrency Handling

| Race | Handling |
| --- | --- |
| Duplicate invitations | Partial unique index; `11000` → `INVITATION_ALREADY_PENDING` (409) |
| Duplicate memberships | Unique index; `11000` → re-read the winner's row |
| Double acceptance | Membership creation is idempotent; the invitation claim is conditional on `status: 'pending'` |
| Double suspension | Conditional update; second call conflicts |

Two tests fire four concurrent invitations and three concurrent acceptances, and
assert exactly one invitation and one membership result — with the losers
failing as typed domain errors, not raw driver errors.

---

## Error Handling

`AuthorizationError` is reused; no second authorization error system exists.
Domain conflicts use `WorkspaceDomainError`, which also extends `AppError` so
the global handler already understands it.

`ROLE_FROM_OTHER_WORKSPACE` maps to **404**, not 409 — confirming the role
exists would leak another workspace's configuration.

Every acceptance failure — bogus, expired, revoked, already used — returns an
**identical** response. A test asserts the status and message match, so the
endpoint cannot be used as an oracle for which tokens were ever real.

---

## Security Review

| Check | Result |
| --- | --- |
| Every protected op calls Stage 5 | ✅ spied |
| No role-name comparisons | ✅ grep-verified |
| No client-supplied authorization | ✅ only `roleId` read from bodies |
| No workspace-less member query | ✅ grep-verified |
| Active membership required | ✅ suspended actor denied immediately |
| Cross-workspace isolation | ✅ members, roles, invitations |
| Foreign roles rejected | ✅ 404 |
| OWNER never assignable | ✅ even by the owner |
| Admin assignment via Stage 5 | ✅ |
| Rank only for delegation | ✅ |
| Token hashes only | ✅ plaintext absent from stored doc |
| Expiration + status enforced | ✅ |
| Owner cannot be removed/suspended/downgraded | ✅ with permissions granted |
| Ownership transfer not implemented | ✅ |
| Unique indexes respected | ✅ |

---

## Tests Added

73 tests in `server/tests/workspace.members.test.js`.

## Test Matrix

| Group | Tests |
| --- | --- |
| Listing | authorized, non-member 404, suspended, no permission, no sensitive fields, pagination, bad params, status filter, workspace isolation |
| Viewing | same workspace, foreign 404, missing 404, malformed 400 |
| Inviting | authorized, unauthorized, normalisation, registered user, already member, suspended member, duplicate pending, after revoke, missing role, foreign role, admin→Admin blocked, Owner blocked, validation |
| Token storage | hash only, plaintext absent, not in listings, listing permission |
| Accepting | membership created, invitation marked, invalid, expired, revoked, replayed, identical failures, already-a-member reconciliation, foreign role |
| Role assignment | owner→custom, owner→Admin, admin→custom, admin→Admin blocked/unblocked, member denied, custom-role escalation, Owner never, foreign role, missing role, foreign membership |
| Suspension | suspend, unauthorized, immediate denial, double-suspend, reactivate, reactivate-not-suspended, self |
| Removal | remove, unauthorized, missing, foreign, self |
| Owner protection | remove, suspend, downgrade to Member and Admin, invariant intact |
| Cross-workspace | authority does not travel, foreign invitation revoke |
| Engine integration | spies on `authorize` and `checkRoleAssignment`, direct service calls, auth required |
| Concurrency | invitation race, acceptance race |

## Test Results

```
Server:         300 / 300   (7 suites)
  pre-existing:   55
  RBAC models:    47
  migration:      46
  authorization:  79
  members:        73   new
Client:          65 / 65
Lint:            clean
Build:           succeeds
Authorization:   79 / 79 (unchanged)
```

### Six failures during development, all real

Four were my bugs: destructured imports made spies blind (fixed by namespace
import); role resolution ordering returned 403 where 404 was correct (fixed for
consistency with invitations). Two were wrong tests: the seeded Member role
*does* hold `members.view`, so it never proved a denial; and you cannot invite
somebody who is already a member, so that test's premise was impossible. Both
were rewritten to test the thing they were meant to.

---

## Known Limitations

- **`members.edit` has no endpoint.** No mutable field remains that is not
  already governed by a more specific permission. Documented above.
- **No email delivery.** The plaintext token is returned to the inviter; wiring
  it to an email provider is out of scope.
- **No transactions.** Reasoned ordering plus idempotency instead, for the
  reason given above.
- **Re-inviting requires an explicit revoke.** Deliberate; there is no "resend"
  because the original token cannot be recovered.
- **No audit log.** The repository has no audit system and §55/§56 say not to
  build one. Services are structured so actor, workspace, action, target and
  result are all available at the call site when one is added.
- **Existing task/user/assignee routes remain workspace-unaware.**
- **`members.assign_admin` is not grantable through any API yet** — Stage 7's
  role editor is what will grant it.

---

## Stage 7 Readiness

**Ready.** Stage 7 (role CRUD) inherits:

- `checkPermissionGrant` for the ceiling rule
- `WorkspaceDomainError` and its status mapping
- The workspace-scoped route pattern
- `findMembershipInWorkspace`-style scoped lookups
- The role-in-use count query, already indexed by `{ workspace, role }` from
  Stage 3

The one thing Stage 7 must add is the guard refusing to delete a role that still
has members — the index for it already exists.

---

## Final Assessment

Member and invitation management is complete, workspace-scoped throughout, and
provably routed through the Stage 5 engine rather than reimplementing it. Owner
protection is enforced against `Workspace.owner` and holds even when the acting
Admin has been granted every relevant permission.

The one change outside the stage's nominal scope — `errorController` preferring
`publicMessage` — was a genuine security fix: without it, authorization
diagnostics naming roles and permissions would have been returned to callers in
production.

```
No production migration was executed.
No frontend changes were made.
No role-management API was implemented.
No ownership-transfer API was implemented.
```

**Stage 6 complete. Stopping — not beginning Stage 7.**
