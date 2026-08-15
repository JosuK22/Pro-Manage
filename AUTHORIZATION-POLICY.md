# Authorization Policy

The rules the engine in `server/services/authorization/` actually implements.
Nothing is documented here that is not in the code.

---

## The invariant

> Authorization is always evaluated in the context of **one** workspace, using
> **that** workspace's membership and **that** workspace's role.

Permissions never travel between workspaces. Being an Owner in workspace A
confers nothing in workspace B.

---

## Decision sequence

```text
userId + workspaceId + permission [+ scope] [+ resource]
   │
   ├─ permission in catalogue?          no → INVALID_PERMISSION
   ├─ workspace exists?                 no → WORKSPACE_NOT_FOUND      404
   ├─ membership for (workspace, user)? no → NOT_A_MEMBER             404
   ├─ membership.status === 'active'?   no → MEMBERSHIP_INACTIVE
   ├─ role exists?                      no → ROLE_MISSING
   ├─ role.workspace === workspace?     no → ROLE_INTEGRITY_VIOLATION
   ├─ Owner role but not workspace.owner?  → OWNERSHIP_INTEGRITY_CONFLICT
   ├─ role grants permission?           no → PERMISSION_MISSING
   ├─ owner-only permission + not owner?   → OWNER_ONLY
   │
   ├─ resource given → resource.workspace === workspace?
   │                     no → RESOURCE_OUTSIDE_WORKSPACE              404
   │                   resource within granted scope?
   │                     no → RESOURCE_OUTSIDE_SCOPE
   │
   └─ no resource  → requested scope valid for permission?
                       no → INVALID_SCOPE
                     granted scope covers required?
                       no → SCOPE_INSUFFICIENT
                     → ALLOW
```

Anything unrecognised or malformed denies. There is no path where uncertainty
results in an allow.

---

## Scopes

`own ⊆ assigned ⊆ workspace`

| Scope | A task is in scope when |
| --- | --- |
| `own` | `task.createdBy === actor` |
| `assigned` | `task.assignedTo === actor` **or** `task.createdBy === actor` |
| `workspace` | it belongs to the workspace — no ownership restriction |

`assigned` includes what the actor created deliberately: a task that disappeared
the moment its creator saved it would be absurd, and the inclusion is what makes
the three comparable rather than merely different.

**Tenancy is checked before scope, always.** A task from another workspace is
refused even for an actor holding `workspace` scope.

### Worked example — `tasks.view`

```text
workspace → every task in the workspace
assigned  → tasks assigned to the actor OR created by the actor
own       → tasks created by the actor
```

### Requested scope

- Omitted → defaults to the **widest** scope the permission supports, which is
  the strictest thing to ask for. Omitting can never weaken a check.
- A scope the permission does not support → `INVALID_SCOPE`. It is a malformed
  request, not a narrower one; reinterpreting it would turn a caller's mistake
  into a policy.
- When a `resource` is supplied, the resource is evaluated against the actor's
  **granted** scope and the requested scope is not used.

---

## Roles

Identity is `systemKey`, never the display name. A workspace may rename `Member`
to `Contributor` and it remains the Member system role.

| systemKey | rank |
| --- | --- |
| `OWNER` | 100 |
| `ADMIN` | 50 |
| custom / `MEMBER` | 10 |

**Rank is not capability.** It answers exactly one question — *may this actor
hand out this role?* — and is used nowhere else. A rank-50 Admin has no more
capability than their permissions grant.

---

## Owner authority

`Workspace.owner` is authoritative. The Owner *role* exists so the members list
has something to display.

- The recorded owner receives **every catalogue permission at its widest scope**,
  computed rather than stored. Editing the Owner role's permission array cannot
  strip it, because authorization never reads that array for them.
- The owner must still hold an **active membership**. A missing membership is
  `NOT_A_MEMBER`, not an implicit pass.
- Holding the Owner role while **not** being `workspace.owner` is an integrity
  violation: the membership is refused outright rather than honoured at some
  reduced level. It is never silently repaired.

### Owner-only permissions

| Permission | Rule |
| --- | --- |
| `workspace.delete` | Requires the permission **and** being `workspace.owner` |

This is the only entry. It is deliberately minimal: deleting a workspace is
unrecoverable and an Admin should not be able to do it alone. Everything else is
governed by permissions alone — there is no blanket "owner bypasses all
restrictions" rule.

---

## Role assignment

Requires `members.assign_role`, then:

1. **`OWNER` is never assignable.** Ownership moves through an explicit transfer.
   Otherwise anyone with `members.assign_role` could crown themselves.
2. **`ADMIN` requires `members.assign_admin`**, or being the owner. This is how
   an owner delegates admin-making without the rule being hardcoded.
3. **Everything else requires a strictly higher rank** than the target, so an
   Admin cannot mint peers.

A target role from another workspace is always refused — that would be the
cross-tenant escalation path.

---

## Granting permissions (the ceiling rule)

You cannot grant a permission you do not hold, at a scope wider than your own.

Without this, `roles.create` is a privilege-escalation primitive: mint a role
carrying `workspace.delete`, assign it to yourself, done. The scope half matters
as much as the key half — granting `tasks.edit: workspace` while holding only
`tasks.edit: own` would be an escalation too.

The owner is exempt, since they already hold everything.

---

## List queries

`scopedFilter()` returns a Mongo fragment merged into the caller's query:

| Granted scope | Filter |
| --- | --- |
| `workspace` | `{ workspace }` |
| `assigned` | `{ workspace, $or: [{ createdBy }, { assignedTo }] }` |
| `own` | `{ workspace, createdBy }` |
| unrecognised | `{ workspace, _id: null }` — matches nothing |

Lists must never fetch-then-filter. The database does the narrowing.

---

## Error exposure

Two messages per denial:

- `message` — diagnostic, for logs and tests.
- `publicMessage` — what may cross the API boundary.

`404` rather than `403` wherever a `403` would confirm something exists:
`NOT_A_MEMBER`, `WORKSPACE_NOT_FOUND`, `RESOURCE_MISSING`,
`RESOURCE_OUTSIDE_WORKSPACE`. Anything *inside* a workspace the actor genuinely
belongs to is a `403`, because they already know it exists.

---

---

## Workspace context — `X-Workspace-Id`

> **`X-Workspace-Id` identifies the requested workspace. It does not grant
> access to it.**

A header is a claim, not a credential. Anyone can send anyone else's workspace
id. Resolving the context and being allowed to act are two separate questions,
and only the second involves membership.

| | |
| --- | --- |
| **Header** | `X-Workspace-Id` (case-insensitive, as HTTP requires) |
| **Format** | A MongoDB ObjectId. Surrounding whitespace is trimmed |
| **Authentication** | Required. The middleware refuses an unauthenticated request even with a valid header |
| **Authorization** | Unchanged. Membership, role, permission and scope are still resolved by the engine |
| **Opt-in** | Routes mount `requireWorkspaceContext` individually. It is never global |

### Behaviour

| Situation | Result |
| --- | --- |
| Valid header | `req.workspaceContext = { workspaceId, source }` |
| Missing header on a route that requires it | **400** — "This request needs a workspace" |
| Empty or whitespace-only header | Treated as **absent**, not malformed |
| Malformed id (`abc`) | **400**, before any query is attempted |
| Well-formed id for a workspace that does not exist | Context resolves; authorization then returns **404** |
| Caller is not a member of the named workspace | Context resolves; authorization returns **404** |
| No header, on a route that does not require one | Nothing happens; the route is unaffected |

### Route parameter vs header

Routes carrying `:workspaceId` (the Stage 6 and 7 member, invitation and role
APIs) take the workspace from the path.

When both are present they **must agree**. A disagreement is rejected with 400
rather than resolved by preference — otherwise a caller could aim a request at
one workspace in the URL and another in the header and rely on which the server
happens to prefer. That is the confused-deputy setup.

### The body is never consulted

A `workspaceId` in a request body is ignored entirely. It is not a fallback when
the header is missing, and it cannot override the header when present.

---

## Not implemented

- No caching. Every decision reads current state, so a permission or membership
  change is visible on the very next call.
- Resource checks cover **tasks** only. Other resource types deny, because an
  unproven resource is not an in-bounds one.
- The workspace-context middleware exists but **no route opts into it yet** —
  task routes are still workspace-unaware, pending the integration stage.
