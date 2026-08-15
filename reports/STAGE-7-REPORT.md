# Stage 7 — Role Management & Permission Delegation Report

## Status

**Complete.**

```
No production migration was executed.
No frontend changes were made.
No ownership-transfer API was implemented.
No task-route integration was implemented.
No global workspace middleware was implemented.
```

```
Server: 368 / 368 passing   (8 suites)
Client:  65 / 65 passing
Lint:    clean, 0 warnings
Build:   succeeds
```

Verified by grep: `taskRoute.js`, `taskController.js` and `taskModel.js` show no
diff; no `X-Workspace-Id` middleware exists; no role-name security comparison
exists; the ceiling algorithm appears nowhere outside Stage 5.

---

## Scope

Implemented: role listing, lookup, permission catalogue, custom role creation,
editing, deletion, permission and scope validation, ceiling enforcement, system
role protection, role-in-use protection.

Not implemented: ownership transfer, workspace deletion, task-route
integration, global workspace middleware, frontend, Assignee retirement,
production migration.

---

## Architecture

```text
route → protect → validate → controller → roleService → authorization engine → db
                                              │
                                              ├─ authorize('roles.*')
                                              └─ checkPermissionGrant(final set)
```

Identical to Stage 6: controllers translate, services decide, and authorization
lives in the service so a non-HTTP caller is protected too.

---

## Files Created

| File | Purpose |
| --- | --- |
| `server/services/workspace/roleService.js` | All role business rules |
| `server/controllers/workspaceRoleController.js` | Thin HTTP layer |
| `server/tests/workspace.roles.test.js` | 68 tests |

## Files Modified

| File | Why |
| --- | --- |
| `server/services/workspace/workspaceErrors.js` | 7 new domain codes |
| `server/middleware/validate.js` | `validateRoleCreate`, `validateRoleUpdate` |
| `server/routes/workspaceRoute.js` | Role routes appended |

No model, no authorization-engine file, and no Stage 6 service was changed.

---

## Role Model

Used as-is. No schema change was needed: `systemKey`, `isSystemRole`, `rank`,
`isDefault`, the `{workspace, name}` case-insensitive unique index and the
partial `{workspace, systemKey}` index all already existed from Stage 3.

---

## System Role Protection

The policy, decided from Stage 2's D10 and Stage 3's model:

| Role | Name / description | Permissions | Delete | Identity |
| --- | --- | --- | --- | --- |
| `OWNER` | ❌ sealed | ❌ sealed | ❌ | immutable |
| `ADMIN` | ✅ editable | ✅ bounded by ceiling | ❌ | immutable |
| `MEMBER` | ✅ editable | ✅ bounded by ceiling | ❌ | immutable |
| custom | ✅ | ✅ bounded by ceiling | ✅ if unused | `systemKey` always `null` |

**Why Admin and Member permissions are editable.** §18 requires
`members.assign_admin` to become operational in this stage. In practice that
means an Owner granting it to the Admin role — which is editing a system role's
permissions. Sealing all three would make §18 impossible.

**Why Owner is sealed.** Editing its permission array is *meaningless*: the
engine short-circuits for the workspace owner and never reads it. Allowing edits
would create the illusion that they matter.

Identity — `systemKey`, `isSystemRole`, `rank`, `workspace`, `isDefault` — is
immutable on every role. A test edits the Admin role while submitting
`systemKey: 'OWNER'`, `isSystemRole: false` and `rank: 100`, and confirms the
name changed while all three were ignored.

---

## Custom Roles

Always `systemKey: null`, `isSystemRole: false`, `rank: DEFAULT_RANK`. All three
are set by the server; none is read from the request body.

A custom role gets **no power from its display name**. A role called
"Administrator" with only `tasks.view: own` is tested to be denied
`members.remove`.

Custom roles cannot be named after a seeded system role — not by a special rule,
but because the system roles already occupy those names under the existing
case-insensitive unique index.

---

## Role Creation

```text
authorize('roles.create')
  → normalise name
  → normalise + validate permissions against the catalogue
  → checkPermissionGrant(complete set)
  → write
```

Every validation happens **before the first write** (§20), so a rejected request
never leaves a partially-populated role. Tested: a role containing two valid
permissions and one forbidden one is refused entirely, and `countDocuments`
confirms nothing was created.

---

## Role Editing

PATCH semantics: only supplied fields change. Omitting `permissions` leaves them
untouched; supplying them without a name does not clear the name.

**When permissions are supplied, the entire resulting set goes through the
ceiling — not just the additions.** §26 names the bypass this prevents: pairing
"remove a harmless permission" with "add a forbidden one" so the second slips
past a delta-only check. A dedicated test performs exactly that pairing and
confirms it is refused.

A rejected edit leaves the original role byte-identical — asserted by reloading
it and checking its permission array.

---

## Role Deletion

```text
authorize('roles.delete')
  → resolve in workspace (404 if missing or foreign)
  → refuse if isSystemRole
  → refuse if memberships reference it
  → delete
  → re-count; restore on a straggler
```

System roles are never deletable — **not even by the workspace owner, and not
even with `roles.delete`**. A workspace without its Member role has no fallback
for new joiners. All three are tested.

Members are never silently reassigned or deleted. The error names the count:
*"1 member uses this role. Reassign them before deleting it."*

---

## Permission Validation

Unknown keys fail closed with `INVALID_PERMISSION` (400). They are never
created, ignored, or silently stripped — a role that quietly lost a permission
the caller asked for would be worse than an error.

Duplicate keys are rejected with `DUPLICATE_PERMISSION` rather than being
resolved to one arbitrary scope, so a role definition can never be ambiguous.

Both `'tasks.view'` and `{ key: 'tasks.view', scope: 'own' }` are accepted as
input shapes; both normalise to the latter before persistence.

---

## Scope Validation

A scope the permission does not support is rejected with `UNSUPPORTED_SCOPE`,
never silently widened or narrowed. `{ key: 'tasks.create', scope: 'own' }` is
tested to fail, and the message names the supported scopes.

An omitted scope defaults to **the widest the permission supports** — the same
rule as Stage 5's `resolveRequestedScope`, deliberately, because a role that
meant something different from what the engine enforces would be a silent lie.

---

## Permission Grant Ceiling

**Not reimplemented.** `assertMayGrant` is a five-line wrapper around Stage 5's
`checkPermissionGrant`. Grep confirms `canGrantPermissions` and `scopeCovers`
appear nowhere in `services/workspace/`.

| Actor holds | Attempts to grant | Result |
| --- | --- | --- |
| `tasks.view: workspace` | `tasks.view: workspace` | ✅ |
| `tasks.view: workspace` | `tasks.view: assigned` | ✅ narrower |
| `tasks.view: workspace` | `tasks.delete: workspace` | ❌ not held |
| `tasks.view: assigned` | `tasks.view: workspace` | ❌ wider |
| anything | mixed valid + forbidden | ❌ whole request |
| workspace owner | anything | ✅ |

### `members.assign_admin`

Stage 6 left this ungrantable because role editing did not exist. It is now
operational and governed entirely by the ceiling: an actor holding it can pass
it on; an actor without it cannot. No special case, no hardcoded role name.

---

## Role Rank

**Rank is not client-settable.** Custom roles always receive `DEFAULT_RANK`
(10). §40 warned that a user creating `rank: 100` would manufacture an
Owner-equivalent delegation authority; refusing the field entirely closes that
without inventing a new rank model.

Rank continues to mean only what Stage 5 says it means — *may this actor hand
out this role?* — and is never consulted for capability.

---

## Cross-Workspace Protection

Every lookup is `findOne({ _id, workspace })`. A role that is missing and a role
belonging to another workspace are **indistinguishable**: both are 404, per
Stage 6's disclosure policy. §10 explicitly asked for this rather than a 409
that would confirm existence.

Tested for view, edit and delete, each asserting the foreign role was not
mutated. A client-supplied `workspace` / `workspaceId` in the body is ignored —
the route is authoritative — and a test confirms no role appears in the target
workspace.

---

## Role-in-Use Protection

`WorkspaceMembership.countDocuments({ workspace, role })`, served by the
`{ workspace: 1, role: 1 }` index Stage 3 created for exactly this. No new index
was added.

---

## Authorization Integration

Spies assert `authorize` is called with `roles.view` / `roles.create` /
`roles.edit` / `roles.delete`, and that `checkPermissionGrant` receives the
**normalised** permission set. Services are also called directly, bypassing
HTTP, and still refuse.

End-to-end with Stages 5 and 6:

- create a custom role → assign it → the engine honours its permissions
- edit its permissions → **the very next** authorization decision reflects it
  (no caching anywhere)
- delete it → assignment becomes impossible (404)

---

## API Endpoints

```text
GET    /api/v1/workspaces/:workspaceId/roles
GET    /api/v1/workspaces/:workspaceId/roles/permissions
GET    /api/v1/workspaces/:workspaceId/roles/:roleId
POST   /api/v1/workspaces/:workspaceId/roles
PATCH  /api/v1/workspaces/:workspaceId/roles/:roleId
DELETE /api/v1/workspaces/:workspaceId/roles/:roleId
```

`/roles/permissions` is declared before `/roles/:roleId` so it is not swallowed
by the parameterised route.

> **One small addition beyond §3's list:** the permission-catalogue endpoint.
> A role editor cannot render human-readable checkboxes without it, and §42
> requires such metadata to derive from the canonical catalogue rather than
> being restated. It is workspace-scoped behind `roles.view` and returns only
> `key`, `label`, `description`, `category`, `supportedScopes`. Easy to drop if
> you would rather it wait.

---

## Error Handling

Reuses `WorkspaceDomainError`, `AuthorizationError` and `AppError`. No second
hierarchy.

| Code | Status |
| --- | --- |
| `ROLE_NOT_FOUND` | 404 |
| `SYSTEM_ROLE_PROTECTED` | 409 |
| `ROLE_IN_USE` | 409 |
| `ROLE_NAME_ALREADY_EXISTS` | 409 |
| `INVALID_ROLE_NAME` / `INVALID_PERMISSION` / `UNSUPPORTED_SCOPE` / `DUPLICATE_PERMISSION` | 400 |
| ceiling breach | 403 via `PERMISSION_GRANT_EXCEEDS_ACTOR` |

Ceiling denials surface Stage 5's `publicMessage`, so the response never names
which permission the actor was missing.

---

## Concurrency

| Race | Handling |
| --- | --- |
| Duplicate role name | Existing unique index; `11000` → `ROLE_NAME_ALREADY_EXISTS` (409) |
| Delete vs. assignment | Count → delete → **re-count → restore** |

The delete race is mitigated by a compensating action: if a membership appears
between the count and the delete, the role is recreated **with its original
`_id`**, so the membership that raced in still resolves. A test forces the race
by stubbing the count and confirms the role comes back intact.

**This is not a foreign-key constraint.** MongoDB has none, and the compensating
window is narrowed, not eliminated — a membership created in the microseconds
between the delete and the re-count would still be missed. Documented as a known
limitation rather than claimed as safety.

---

## Security Review

| Question | Answer |
| --- | --- |
| Can a user grant more than they hold? | No — ceiling on the complete set |
| Can a user manufacture OWNER/ADMIN/MEMBER? | No — server sets `systemKey`; tested for all three |
| Can a foreign role be read or mutated? | No — 404, no mutation |
| Can a role with members be deleted? | No — count guard + compensating re-check |
| Can rank bypass delegation? | No — not client-settable |
| Can permission edits bypass the ceiling? | No — final set validated |
| Can services be called without authorization? | No — tested directly |
| Does anything trust client role/systemKey/workspace? | No — all ignored |
| Do foreign roles leak via 403/409/500? | No — 404 |
| Is authorization stale after an edit? | No — next call reflects it |

### Mutation check

I disabled the ceiling enforcement and re-ran: **7 tests failed**. The suite
genuinely exercises the property rather than passing vacuously. Restored and
re-verified.

---

## Tests Added

68 tests in `server/tests/workspace.roles.test.js`.

## Test Matrix

| Category | Coverage |
| --- | --- |
| Listing | authorized, no permission, non-member 404, workspace isolation, pagination, catalogue |
| Viewing | same workspace, foreign 404, missing 404, malformed 400 |
| Create | valid, default scope, unauthorized, unknown permission, unsupported scope, duplicate permission, empty/whitespace/long name, duplicate name (incl. case), system-role name, same name other workspace, trimming |
| Spoofing | `systemKey` × 3, `rank`, `workspace`, `isDefault` all ignored |
| Ceiling | same scope, narrower, not held, wider, mixed set, owner exempt, member blocked, `members.assign_admin` both ways |
| Edit | rename, replace permissions, unauthorized, escalation blocked + unchanged, whole-set validation, unknown permission, foreign 404, name collision, empty update |
| System roles | Owner sealed, Admin permissions editable, identity immutable, all three undeletable |
| Delete | unused, unauthorized, in use, after reassignment, foreign, missing |
| End-to-end | create→assign→authorize, name confers nothing, edit reflected immediately, delete unassignable |
| Integration | spies on `authorize` and `checkPermissionGrant`, direct service calls, auth required |
| Concurrency | duplicate-name race, delete/assign race with restore |

## Test Results

```
workspace.roles: 68 / 68
```

## Regression Results

```
Server:  368 / 368   (8 suites)
  pre-existing:   55
  RBAC models:    47
  migration:      46
  authorization:  79   unchanged
  members:        73   unchanged
  roles:          68   new
Client:   65 / 65
Lint:     clean
Build:    succeeds
```

No existing test was removed or weakened.

---

## Known Limitations

- **The delete/assign race is mitigated, not eliminated.** No database-level
  foreign key exists. Detailed above.
- **`isDefault` cannot be moved to another role.** New invitees always receive
  the seeded Member role. Changing the default role is not implemented.
- **Role rank is fixed for custom roles.** Every custom role sits at rank 10, so
  one custom role cannot be made to out-delegate another. If that becomes a
  product requirement it needs a deliberate extension of Stage 5's delegation
  model.
- **Owner role permissions are unreachable by API.** By design — they are inert.
- **No audit log**, consistent with Stages 5 and 6.
- **Deleting a role does not warn about pending invitations** that reference it.
  An invitation pointing at a deleted role fails closed at acceptance (Stage 6
  already tests this), but the delete guard counts memberships only.

---

## Stage 8 Readiness

**Ready.** Stage 8 (task-route integration) inherits a complete authorization
surface: engine, member management, role management, and a permission catalogue
that can now be edited by workspaces at runtime.

Two things Stage 8 must handle, unchanged from Stage 5's report:

1. **The migration must run first.** Every existing task has `workspace: null`
   and the engine correctly refuses those resources.
2. **The global workspace-context decision** — the approved `X-Workspace-Id`
   header — still has to be built. Stage 6 and 7 routes carry the workspace in
   the path, which is deliberate and does not pre-empt that choice.

---

## Final Assessment

Role management is complete and workspace-scoped. The central invariant — a user
cannot grant what they cannot grant themselves — is enforced by calling Stage 5
rather than by a second implementation, verified both by spy and by deliberately
breaking it.

System roles are protected by `systemKey`, never by display name. Custom roles
derive no authority from what they are called. Rank stays a delegation concept
and cannot be chosen by a client.

```
No production migration was executed.
No frontend changes were made.
No ownership-transfer API was implemented.
No task-route integration was implemented.
No global workspace middleware was implemented.
```

**Stage 7 complete. Stopping — not beginning Stage 8.**
