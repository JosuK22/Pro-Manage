# Stage 5 — Authorization Engine Report

## Status

**Complete.** A tested, standalone authorization engine.

```
No frontend changes were made.
No existing controllers/routes were wired to the authorization engine.
No production migration was executed.
```

Verified: `grep` over `server/controllers`, `server/routes`, `server/middleware`
and `app.js` finds no reference to the engine. It is importable and fully
tested, but nothing calls it yet — which is exactly the stage boundary.

---

## Authorization Architecture

```text
server/services/authorization/
├── authorizationErrors.js    denial codes, HTTP mapping, public/internal split
├── scopeResolver.js          PURE — scope hierarchy, resource membership, filters
├── permissionResolver.js     PURE — effective permissions, rank, delegation rules
├── authorizationService.js   the only module that touches the database
└── index.js                  public surface
```

The split is deliberate: the rules most worth auditing are pure functions that
need no database to read or test. `authorizationService` does resolution and
orchestration; it holds no policy of its own.

---

## Files Created

| File | Purpose |
| --- | --- |
| `server/services/authorization/authorizationErrors.js` | 17 denial codes, status mapping, `AuthorizationError` |
| `server/services/authorization/scopeResolver.js` | Scope hierarchy, task-in-scope, query filters |
| `server/services/authorization/permissionResolver.js` | Effective permissions, owner map, rank, ceiling rule |
| `server/services/authorization/authorizationService.js` | `check`, `authorize`, `scopedFilter`, `checkRoleAssignment`, `checkPermissionGrant` |
| `server/services/authorization/index.js` | Barrel |
| `server/tests/rbac.authorization.test.js` | 79 tests |
| `AUTHORIZATION-POLICY.md` | The implemented policy, documented |

## Files Modified

**None.** No existing file was changed this stage.

---

## Authorization API

```js
const { check, authorize } = require('./services/authorization');

// Structured result; never throws for a "no".
const result = await check({
  userId, workspaceId,
  permission: 'tasks.edit',
  scope,      // optional
  resource,   // optional — the decision is about this document
});

// Same decision, throws AuthorizationError on denial.
await authorize({ userId, workspaceId, permission: 'tasks.create' });
```

Grant shape:

```js
{
  allowed: true,
  userId, workspaceId, membershipId,
  roleId, roleKey, roleName,
  isOwner, permission, scope
}
```

Denial shape:

```js
{ allowed: false, code, status, message, publicMessage, details }
```

Both variants exist because middleware wants to throw and query builders want a
value. They share one code path, so the two can never disagree.

Also exported: `resolveContext`, `scopedFilter`, `checkRoleAssignment`,
`checkPermissionGrant`, plus the pure helpers for auditing.

---

## Membership Resolution

```js
WorkspaceMembership.findOne({ workspace, user })
```

Scoped by **both** fields — resolving a membership by id alone would let one
from another workspace become an authorization path. Status must be exactly
`'active'`; `'suspended'` denies. The model's real statuses are used; none were
invented.

---

## Role Resolution

The role is fetched by id and its workspace is then **explicitly compared**,
rather than being queried workspace-scoped. That is intentional: it lets a
mismatch be reported as `ROLE_INTEGRITY_VIOLATION` instead of vanishing into a
generic "role not found".

The mismatch is never repaired during authorization. Quietly fixing it would
hide a security event.

Identity is `systemKey` throughout. A test renames the Member role to
`Contributor` and confirms it still resolves as `MEMBER`.

---

## Permission Resolution

Non-owner: `role.permissions[]` → `Map<key, scope>`, skipping any key not in the
catalogue, so a stale or injected permission cannot take effect.

Owner: every catalogue key at its widest supported scope, **computed**. This is
why editing the Owner role's array cannot strip owner authority.

Unknown permission keys deny with `INVALID_PERMISSION` before anything else
happens.

---

## Scope Resolution

`own ⊆ assigned ⊆ workspace`, ordered by the catalogue's `SCOPE_RANK` rather
than string comparison, so adding a scope later is one table entry.

- Omitted scope → widest the permission supports, which is the strictest thing
  to ask for.
- Unsupported scope → `INVALID_SCOPE`, never silently widened.
- When a resource is supplied, it is evaluated against the actor's **granted**
  scope and the requested scope is not consulted.

---

## Resource Authorization

Task fields used are the model's own: `workspace`, `createdBy`, `assignedTo`.

```text
own       → createdBy === actor
assigned  → assignedTo === actor OR createdBy === actor
workspace → no ownership restriction
```

`tasks.create` takes no resource — the catalogue makes it workspace-only, so it
is a capability check.

---

## Workspace Isolation

**Tenancy is checked before scope, unconditionally.** A task whose `workspace`
does not equal the requested workspace is refused even for an actor holding
`workspace` scope, and the denial is a **404**.

Two dedicated tests:

- an owner of workspace A is denied a task belonging to workspace B
- a user who is Owner of B and Member of A is evaluated **only** by their A
  membership, in both directions

A task with `workspace: null` — which is every existing task until the migration
runs — is also refused. Correct fail-closed behaviour, and the reason Stage 8
must not mount this before the migration executes.

---

## Owner Authority

`Workspace.owner` is authoritative; the Owner role is presentational.

| Situation | Result |
| --- | --- |
| Recorded owner | Every permission at widest scope |
| Owner role stripped of permissions | Owner authority unchanged |
| Owner has no active membership | `NOT_A_MEMBER` — no implicit pass |
| Holds Owner role, is not `workspace.owner` | `OWNERSHIP_INTEGRITY_CONFLICT` — refused outright |

### `workspace.delete`

Requires the permission **and** being the recorded owner (`OWNER_ONLY`). A test
grants an Admin the permission explicitly and confirms they are still refused.

This is the **only** owner-only permission. §11 warned against inventing an
implicit "OWNER → everything forever" rule; the owner's broad grant comes from
the documented Stage 2 design (`RBAC-ARCHITECTURE.md` D6), and ownership adds a
*restriction* in exactly one place.

---

## Role Assignment Rules

Requires `members.assign_role`, then in order:

1. **`OWNER` is never assignable** — even by the owner. Ownership moves by
   transfer.
2. **`ADMIN`** requires `members.assign_admin`, or being the owner.
3. **Everything else** requires strictly higher rank than the target.

Cross-workspace target roles and non-existent roles are refused.

`rank` is used **only** here. It is never consulted for capability.

---

## Custom Role Handling

No role name appears anywhere in the engine — verified by grep for
`role.name ===` and `name === 'Admin'`-style comparisons. Custom roles flow
through the identical path as system roles.

A test gives a custom role `members.assign_role` and confirms it still cannot
assign Admin: a custom role cannot be used to route around the protected rules.

---

## Error Handling

17 denial codes: `UNAUTHENTICATED`, `WORKSPACE_NOT_FOUND`, `NOT_A_MEMBER`,
`MEMBERSHIP_INACTIVE`, `ROLE_MISSING`, `ROLE_INTEGRITY_VIOLATION`,
`OWNERSHIP_INTEGRITY_CONFLICT`, `INVALID_PERMISSION`, `INVALID_SCOPE`,
`PERMISSION_MISSING`, `SCOPE_INSUFFICIENT`, `OWNER_ONLY`, `RESOURCE_MISSING`,
`RESOURCE_OUTSIDE_WORKSPACE`, `RESOURCE_OUTSIDE_SCOPE`,
`ROLE_ASSIGNMENT_FORBIDDEN`, `PERMISSION_GRANT_EXCEEDS_ACTOR`.

`AuthorizationError` extends the project's existing `AppError`, so the global
error handler already understands it.

Every denial carries both a diagnostic `message` and a vague `publicMessage`.
A test asserts the public message names neither the role nor the permission.

**404 vs 403:** 404 wherever 403 would confirm existence (non-member, foreign
resource); 403 inside a workspace the actor genuinely belongs to.

---

## Fail-Closed Behaviour

Every unknown or malformed condition denies. Tested: null/undefined/malformed
user ids, null/malformed workspace ids, non-existent workspace, missing
membership, suspended membership, missing role, foreign role, unknown
permission, unsupported scope, missing resource, foreign resource, unrecognised
scope, and assorted junk (`{}`, `[]`, `0`, `null`, `42`).

Unrecognised scopes produce a filter of `{ _id: null }` — matching nothing beats
matching everything.

---

## Security Checks

| Property | How it holds |
| --- | --- |
| IDOR / tenant escape | Resource workspace compared before scope; 404 |
| Cross-workspace permissions | Membership resolved per workspace; nothing global |
| Role confusion | `systemKey` only, never display name |
| Owner confusion | `Workspace.owner` authoritative; role-only claim refused |
| Permission escalation | Ceiling rule on granting |
| Scope escalation | Ceiling rule covers scope, not just key |
| Custom-role escalation | Rank rule applies regardless of role type |
| Inactive membership | Explicit status check |
| Client-supplied role/permission | Never read; everything resolved from the database |
| Raw update bypass | Authorization is service-layer, before mutation; role/workspace consistency re-checked on every call |

### Mutation check

Passing tests alone are weak evidence, so I disabled the tenant-isolation check
in `isTaskWithinScope` and re-ran: **4 tests failed**. The suite genuinely
exercises the property rather than passing vacuously. The file was restored and
re-verified.

---

## Tests Added

79 tests in `server/tests/rbac.authorization.test.js`.

## Test Matrix

| Group | Coverage |
| --- | --- |
| Scope hierarchy (pure) | all 9 granted×required combinations, plus unknown scope |
| Requested scope (pure) | default to widest, supported narrower, unsupported rejected |
| Task scope (pure) | own/assigned/workspace, creator, assignee, foreign workspace, null workspace, unknown scope |
| Scope filters (pure) | filter per scope; unknown scope matches nothing |
| Effective permissions (pure) | owner map; catalogue-unknown keys ignored |
| Membership | active, missing, suspended, wrong workspace |
| Roles | custom role, renamed system role, missing role, foreign role |
| Permissions | granted, missing, unknown, all five categories, unsupported scope, insufficient scope |
| Resources | workspace scope, member denied, member's assigned task, null resource, **foreign workspace**, unmigrated null workspace |
| Cross-workspace | owner authority does not travel; same user judged differently per workspace |
| Owner | full grant, permissions stripped, admin refused `workspace.delete`, role-only claim refused, owner without membership |
| Role assignment | owner→admin, admin→custom, admin→admin blocked, unblocked by `members.assign_admin`, OWNER never assignable, member refused, foreign role, missing role, custom-role escalation |
| Ceiling rule | owner exempt, unheld permission, wider scope, narrower allowed, unknown key |
| Scoped filters | admin unnarrowed, member narrowed, **real query returns only permitted tasks**, denial returns no filter |
| Fail closed | 5 malformed-input cases, non-existent workspace, junk inputs |
| `authorize()` | grant, `AuthorizationError` with safe message, 404 for non-member |
| Current state | permission added, membership suspended, ownership transferred — all visible immediately |

## Test Results

```
Server tests:   227 / 227 passing   (6 suites)
  ├─ pre-existing:   55
  ├─ RBAC models:    47
  ├─ migration:      46
  └─ authorization:  79   new
Client tests:    65 / 65 passing
Lint:            clean, 0 warnings
Build:           succeeds
Authorization:   79 / 79 passing
```

Baseline of 148 preserved; nothing was removed or weakened.

---

## Performance Considerations

Three queries per decision: workspace, membership, role. `scopedFilter` reuses
the same resolution and returns a database filter, so lists never fetch-then-filter.

**No caching**, per §39. Authorization depends on membership, role, permissions,
ownership and resource state; a stale cache is a stale security decision. Three
tests confirm changes are visible on the very next call.

### Index note (documented, not added)

The hot query is `{ workspace, user }` on memberships, already covered by the
unique index from Stage 3. No new index is required, and none was added.

---

## Known Limitations

- **Not wired into anything.** Deliberate — Stage 8 integrates it.
- **Resource checks cover tasks only.** Other resource types deny. Member and
  role resources get capability-level checks, which is all the current
  permissions need.
- **Every existing task has `workspace: null`** and is therefore denied by
  resource checks. Correct, and the reason the migration must run before Stage 8
  mounts this.
- **`checkPermissionGrant` does not check `roles.create` / `roles.edit`.** It
  answers only the escalation question; callers check capability separately.
- **No ownership-transfer authorization yet** — needs the transfer endpoint to
  exist first.
- Owner-only permissions are a single-entry set. If more are needed, that set is
  the one place to change.

---

## Stage 6/Next Stage Readiness

**Ready.** The engine gives later stages:

- `check` / `authorize` for middleware
- `scopedFilter` for list endpoints
- `checkRoleAssignment` for member APIs (Stage 6)
- `checkPermissionGrant` for role APIs (Stage 7)
- `AuthorizationError` already compatible with the global error handler

Before Stage 8 mounts this on task routes, the migration must have run —
otherwise every `workspace: null` task is correctly refused.

---

## Final Assessment

The engine is centralized, fails closed on every malformed or unknown input, and
treats tenancy as the first question rather than the last. Owner authority comes
from `Workspace.owner` and cannot be edited away; rank governs delegation only;
role display names are invisible to it.

The tenant-isolation property was verified by deliberately breaking it and
confirming the suite caught it.

```
No frontend changes were made.
No existing controllers/routes were wired to the authorization engine.
No production migration was executed.
```

**Stage 5 complete. Stopping — not beginning Stage 6 or 8.**
