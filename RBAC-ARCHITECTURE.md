# RBAC + Workspace Architecture — Stage 2

**Status:** Design only. No application code, models, migrations, APIs, UI or
dependencies were changed in this stage.

This document settles the architecture. Every decision from the Stage 2 brief is
answered explicitly, and the ambiguities Stage 1 raised are closed.

---

## Contents

- [1. Final decisions](#1-final-decisions)
- [2. Entity relationship model](#2-entity-relationship-model)
- [3. Authorization flow](#3-authorization-flow)
- [4. Permission catalogue](#4-permission-catalogue)
- [5. Scope model](#5-scope-model)
- [6. Role model](#6-role-model)
- [7. Migration strategy](#7-migration-strategy)
- [8. Test fixture architecture (Stage 2.5)](#8-test-fixture-architecture-stage-25)
- [9. Permission engine architecture (Stage 4.5)](#9-permission-engine-architecture-stage-45)
- [10. API design](#10-api-design)
- [11. Frontend architecture](#11-frontend-architecture)
- [12. Security model](#12-security-model)
- [13. Index strategy](#13-index-strategy)
- [14. Migration risks](#14-migration-risks)
- [15. Implementation order](#15-implementation-order)

---

## 1. Final decisions

### D1 — Task deletion is decoupled from assignment ✅

**Today:** `updateTask` and `deleteTask` both filter by
`{ $or: [{createdBy}, {assignedTo}] }`. An assignee can delete the creator's task.

**After:** assignment answers *"whose work is this?"*. Deletion is governed by
`tasks.delete` plus scope. They never touch.

| Actor | Before | After |
| --- | --- | --- |
| Creator | edit + delete | governed by `tasks.edit` / `tasks.delete` |
| Assignee | edit + delete | edit if `tasks.edit → assigned`; **delete only if `tasks.delete` scope reaches the task** |
| Workspace admin | no access unless assigned | full, via permissions |

**This is an intentional capability removal.** Anyone relying on "the person I
assigned it to can delete it" loses that unless their role grants
`tasks.delete`. The default `Member` role will **not** include `tasks.delete`.

### D2 — Unregistered assignees keep working, via pending membership ✅

Retained. Implemented as a **membership with `status: 'pending'` and a null
`user`**, not a separate model — see [D3](#d3--assignee-is-retired-into-membership-)
for why one model rather than two.

| # | Question | Answer |
| --- | --- | --- |
| 1 | How is an invitation created? | `POST /workspaces/:id/members` with `{ email, roleId }` by a caller holding `members.invite` |
| 2 | How is the email stored? | `WorkspaceMembership.email`, always lowercased, always present — even for registered users |
| 3 | How is a role associated? | `membership.role` is set at invite time and validated against the rank rule (§12) |
| 4 | What happens on registration? | A post-registration hook claims every pending membership matching the new user's email |
| 5 | How does it become real? | Claim sets `user`, `status: 'active'`, `joinedAt`. No new row is created |
| 6 | Email already a User? | The membership is created **already active** with `user` populated — no invitation round-trip needed for someone who already has an account |
| 7 | Expiry? | `expiresAt` on pending rows only. Expired rows stay for audit but are inert; re-inviting refreshes them in place |
| 8 | Can a pending invitee be assigned a task? | **Yes.** `Task.assignee` holds the email; `assignedTo` stays null until they register |
| 9 | Existing assignments on registration? | The same claim hook re-resolves `Task.assignedTo` for tasks in those workspaces whose `assignee` matches the email |

**Invariant:** a pending membership grants **zero** permissions. Authorization
requires `status === 'active'` **and** a non-null `user`.

### D3 — `Assignee` is retired into membership ✅

Two models answering "who can I assign to?" is exactly the drift that the old
`assignee`/`assignedTo`/`shared` triple caused. One concept wins.

**Why membership-with-pending-status rather than a separate `WorkspaceInvitation`:**
an invitation is a membership that has not been claimed. Modelling it separately
means two tables, two uniqueness rules, and a join every time you ask "who is in
this workspace?". The single-model design keeps the member list one query and
makes the "already a user" case ([D2](#d2--unregistered-assignees-keep-working-via-pending-membership-) Q6) a
status flag rather than a branch.

Migration path is in [§7.3](#73-assignee-records).

### D4 — Workspace is the boundary ✅

A workspace is simultaneously the collaboration, membership, authorization and
task boundary. The application attaches **no** meaning to what it represents.

### D5 — Multiple workspaces per user ✅

No workspace or role data on `User`. Ever. The chain is
`User → WorkspaceMembership → Role → Permissions → Scope`.

### D6 — Owner is a protected authority, not an ordinary role ✅

Owner is represented **twice, deliberately**:

- `Workspace.owner` → **authoritative**. One `ObjectId`, the single source of truth.
- An `Owner` role row with `isSystemRole: true` → **presentational**, so the
  member list can render a role for everyone and `membership.role` is never null.

The engine **short-circuits**: if `req.user._id.equals(workspace.owner)`, every
permission is granted at `workspace` scope without consulting the role.

This is what makes owner authority unloseable — editing the Owner role's
permission array cannot strip it, because the check never reads that array.

**Invariants:**
- Exactly one active membership per workspace holds the Owner role, and its
  `user` equals `workspace.owner`.
- The owner's membership cannot be removed, suspended, or role-changed.
- Ownership moves **only** through the transfer endpoint, never through role assignment.

### D7 — Admin is protected and strictly below Owner ✅

`Admin` is a system role (`isSystemRole: true`, undeletable). Admin is **not**
owner-equivalent. Owner-only operations are guarded by an identity check against
`workspace.owner`, never by a permission:

```text
Owner-only (permission cannot grant these):
  • transfer ownership
  • delete the workspace
  • remove / suspend / re-role the owner
```

Owner controls admin-on-admin management through the `members.assign_admin`
permission, which only the Owner can grant (because granting is itself bounded
by the ceiling rule in §12). Default: **not granted**.

### D8 — Member is the default ✅

New invitations default to `Member` when no role is specified. `Member` carries
a deliberately small set — notably **no `tasks.delete`**:

```text
tasks.view          → assigned
tasks.change_status → assigned
tasks.manage_checklists → assigned
workspace.view
members.view
```

### D9 — Custom roles are opaque to the backend ✅

The backend never reads `role.name` for a decision. Only
`role.permissions[]` and each entry's `scope`. A repo-wide grep for
`role.name ===` must return nothing; this becomes a Stage 20 test.

### D10 — System vs custom roles ✅

| Role | Deletable | Renamable | Permissions editable |
| --- | --- | --- | --- |
| Owner | ❌ | ❌ | ❌ (ignored — engine short-circuits) |
| Admin | ❌ | ❌ | ✅ by Owner only, bounded by ceiling |
| Member | ❌ | ✅ | ✅ bounded by ceiling |
| Custom | ✅ (if unassigned) | ✅ | ✅ bounded by ceiling |

**`Member` is editable in permissions but protected in identity** — it cannot be
deleted, so a workspace can never lose its fallback role. Deleting a custom role
that still has members is refused with a count, per the brief.

### D11–D12 — Permission catalogue is backend-canonical ✅

See [§4](#4-permission-catalogue). Each entry is `{ key, label, description,
category, scopable }`. The catalogue is a frozen server-side constant. A role
may only reference keys that exist in it — client-invented strings are rejected
at validation.

### D13 — How the frontend gets permissions ✅

**Both, for different consumers, with no duplication:**

| Need | Source | When |
| --- | --- | --- |
| "What may *I* do here?" | `GET /workspaces/current` → `permissions: [{key, scope}]` | On load and on workspace switch |
| "What permissions exist?" | `GET /permissions` → catalogue with labels | Lazily, **only** by the role editor |

No shared constants file is generated to the client — that was Stage 1 risk R-8
(the existing `constants.js` / `constants/task.js` pair already drifts). The
client hardcodes only permission *literals* at call sites
(`hasPermission('tasks.create')`), which is unavoidable and harmless because the
server is authoritative.

### D14 — Scope vocabulary: `own | assigned | workspace` ✅

See [§5](#5-scope-model). No `team`/`project`/`department` — those concepts do
not exist in the product.

### D15 — Example roles validate the model ✅

All four sample roles (Teacher, Class Rep, Student, Photographer) are
expressible purely as `{key, scope}` sets with no backend awareness of their
names. Worked through in [§5.3](#53-the-example-roles-expressed-in-the-model).

### D16 — Phased `Task.workspace` ✅

```text
A  add nullable  →  B  backfill  →  C  verify count(workspace: null) === 0  →  D  enforce required
```

Phases A–B ship together; **D ships in a later deploy**, gated on C passing
against production data.

### D17 — Personal workspaces ✅

Every existing user gets one, named `"{name}'s Workspace"`, with themselves as
owner. It persists after they join other workspaces.

### D18 — Current workspace is a client preference, server-validated ✅

`localStorage` remembers the last selection for UX. The server re-validates
membership on **every** request and ignores the client's claim if it fails.

### D19 — Provider hierarchy corrected before Stage 10 ✅

See [§11](#11-frontend-architecture).

### D20 — Stage 2.5 fixtures approved ✅

See [§8](#8-test-fixture-architecture-stage-25).

### D21 — Index strategy ✅

See [§13](#13-index-strategy).

### D22 — Canonical middleware chain ✅

See [§3](#3-authorization-flow).

### D23 — Frontend is never trusted ✅

See [§12](#12-security-model).

### D24 — Assignment keeps two fields, gains one constraint ✅

**No new fields.** `assignee` (email, authoritative input) + `assignedTo`
(ObjectId, derived in `pre('save')`) already work, and `shared` is already a
virtual — the old ambiguity was the third *persisted* field, which is gone.

The one addition is a **validation constraint**: the assignee email must match
an active or pending membership of the task's workspace. This is what stops a
task being assigned to a stranger.

### D25 — Public sharing stays outside the workspace model ✅

`GET /tasks/:taskId` remains unauthenticated with an explicit projection. A
public viewer gets no membership, no permissions, and must never see
`workspace`, workspace name, member emails or `createdBy`. A Stage 8 regression
test will assert the response key set exactly.

### D26 — Backward compatibility ✅

The migration is strictly additive. See [§7](#7-migration-strategy).

---

## 2. Entity relationship model

```text
┌──────────┐
│   User   │  identity + auth only. No role. No workspace.
└────┬─────┘
     │ 1
     │
     │ N
┌────▼──────────────────┐        N        ┌───────────────┐
│ WorkspaceMembership   ├────────────────►│   Workspace   │
│  • workspace          │         1       │  • name       │
│  • user      (nullable│                 │  • owner ─────┼──► User
│  • email     (always) │                 │  • description│
│  • role ──────────┐   │                 └───────┬───────┘
│  • status         │   │                         │ 1
│  • invitedBy      │   │                         │
│  • invitationToken│   │                         │ N
│  • expiresAt      │   │                 ┌───────▼───────┐
│  • joinedAt       │   │        N        │     Role      │
└───────────────────┼───┴───────────────► │  • workspace  │
                    └────────────────────►│  • name       │
                                          │  • permissions│──┐
                                          │  • isSystemRole│ │
                                          │  • isDefault  │  │
                                          └───────────────┘  │
                                                             │
                              ┌──────────────────────────────┘
                              │  embedded: [{ key, scope }]
                              ▼
                    ┌─────────────────────┐
                    │ Permission catalogue│  server constant, not a collection
                    │  key/label/desc/cat │
                    └─────────────────────┘

┌───────────────┐
│     Task      │
│  • workspace ─┼──► Workspace   (nullable in phase A, required in phase D)
│  • createdBy ─┼──► User        (immutable)
│  • assignee   │    email string, authoritative input
│  • assignedTo─┼──► User        (derived from assignee)
│  • shared     │    virtual = Boolean(assignedTo)
└───────────────┘
```

**Deliberate omissions:** there is no `Permission` collection (a frozen constant
is cheaper and cannot drift), and no separate `Invitation` collection (a pending
membership is an invitation).

---

## 3. Authorization flow

```text
HTTP request
    │
    ▼
rate limit → helmet → cors → json(100kb) → mongoSanitize      [unchanged]
    │
    ▼
protect()                    JWT → req.user                    [unchanged]
    │
    ▼
resolveWorkspace()           NEW
    │  reads X-Workspace-Id header
    │  validates ObjectId shape
    │  finds membership { workspace, user, status: 'active' }
    │  ─── no membership ──────────────────► 404
    │  loads role, computes effective permissions
    │  owner short-circuit → all permissions @ workspace
    │  sets req.workspace, req.membership, req.permissions
    ▼
authorize('tasks.delete')    NEW
    │  ─── permission absent ──────────────► 403
    ▼
authorizeResource('tasks.edit', loadTask)   NEW
    │  loads resource, asserts resource.workspace === req.workspace._id
    │  ─── different workspace ─────────────► 404
    │  applies scope test (own / assigned / workspace)
    │  ─── scope excludes resource ─────────► 403
    ▼
controller                   receives a pre-authorized resource
```

### Error semantics

| Code | Meaning | Used when |
| --- | --- | --- |
| 401 | Not authenticated | Missing/invalid/expired token |
| 403 | Authenticated **and** a member, but lacks the permission or scope | Inside a workspace you belong to |
| 404 | Deliberately indistinguishable from "does not exist" | Not a member of the workspace; resource belongs to another workspace |

The rule: **non-membership is always 404**; insufficient permission *within* a
workspace you belong to is 403. Confirming that a workspace or task exists to
someone outside it is itself a leak.

### Why a header, not path nesting

Rejected alternative: `/api/v1/workspaces/:workspaceId/tasks`.

| | Header `X-Workspace-Id` | Path nesting |
| --- | --- | --- |
| Existing routes | unchanged | every task route rewritten |
| Client call sites | one (apiClient sets it centrally) | every call site |
| Visibility of the boundary | lower | higher |
| Cacheability / REST purity | lower | higher |

Chosen: **header**, because the brief says not to change API contracts
unnecessarily and the client already funnels through a single `apiClient`.
The security properties are identical — the header is validated and
membership-checked on every request and is never trusted.

---

## 4. Permission catalogue

Shape: `{ key, label, description, category, scopable }`.
`scopable: true` means the role editor offers `own | assigned | workspace`.

### Tasks

| Key | Label | Scopable |
| --- | --- | --- |
| `tasks.view` | View tasks | ✅ |
| `tasks.create` | Create tasks | ❌ |
| `tasks.edit` | Edit tasks | ✅ |
| `tasks.delete` | Delete tasks | ✅ |
| `tasks.assign` | Assign tasks to people | ✅ |
| `tasks.change_status` | Move tasks between columns | ✅ |
| `tasks.change_priority` | Change task priority | ✅ |
| `tasks.manage_checklists` | Tick and edit checklists | ✅ |
| `tasks.share` | Create public share links | ✅ |

### Members

`members.view`, `members.invite`, `members.edit`, `members.remove`,
`members.suspend`, `members.assign_role`, `members.assign_admin` — none scopable.

> `members.assign_admin` is an addition to the brief's list. It is what lets the
> Owner decide whether Admins may create other Admins ([D7](#d7--admin-is-protected-and-strictly-below-owner-)).

### Roles

`roles.view`, `roles.create`, `roles.edit`, `roles.delete` — none scopable.

### Analytics

`analytics.view` (**scopable** — this is what makes a Student see only their own
numbers), `analytics.export` (not scopable).

### Workspace

`workspace.view`, `workspace.edit`, `workspace.manage`, `workspace.delete` —
none scopable. `workspace.delete` additionally requires being the owner.

**Not included:** all `media.*` permissions. Pro-Manage has no media feature;
the brief explicitly forbids speculative permissions.

---

## 5. Scope model

### 5.1 Semantics

| Scope | Task filter | Meaning |
| --- | --- | --- |
| `own` | `{ createdBy: me }` | Only what I made |
| `assigned` | `{ $or: [{ assignedTo: me }, { createdBy: me }] }` | What I'm working on, plus what I made |
| `workspace` | `{}` | Everything in this workspace |

### 5.2 Why `assigned` includes `own`

So the chain is a genuine widening: `own ⊆ assigned ⊆ workspace`. A user who can
create a task must be able to see it afterwards; the alternative is a task that
vanishes the moment you save it. Scopes are therefore comparable, which lets the
engine answer "is scope A at least as wide as scope B?" with a simple rank.

Every scope filter is **always** intersected with `{ workspace: currentWorkspace }`.
Scope narrows within a workspace; it can never widen across one.

### 5.3 The example roles expressed in the model

```jsonc
// Teacher — no backend knowledge of the word "Teacher"
[
  { "key": "tasks.view",            "scope": "workspace" },
  { "key": "tasks.create" },
  { "key": "tasks.edit",            "scope": "workspace" },
  { "key": "tasks.delete",          "scope": "workspace" },
  { "key": "tasks.assign",          "scope": "workspace" },
  { "key": "tasks.change_status",   "scope": "workspace" },
  { "key": "tasks.change_priority", "scope": "workspace" },
  { "key": "members.view" },
  { "key": "members.invite" },
  { "key": "analytics.view",        "scope": "workspace" }
]

// Class Representative — note: no tasks.delete, no roles.*
[
  { "key": "tasks.view",          "scope": "workspace" },
  { "key": "tasks.create" },
  { "key": "tasks.assign",        "scope": "workspace" },
  { "key": "tasks.change_status", "scope": "workspace" },
  { "key": "members.view" },
  { "key": "analytics.view",      "scope": "workspace" }
]

// Student — and Photographer is byte-identical, which is the point
[
  { "key": "tasks.view",              "scope": "assigned" },
  { "key": "tasks.edit",              "scope": "assigned" },
  { "key": "tasks.change_status",     "scope": "assigned" },
  { "key": "tasks.manage_checklists", "scope": "assigned" },
  { "key": "analytics.view",          "scope": "own" }
]
```

Student and Photographer producing identical permission sets is the strongest
evidence the architecture is role-name-agnostic.

### 5.4 Adding scopes later

A new scope is a new entry in the scope rank table plus a filter builder in one
switch. Because scope lives per-permission inside the role document, no
migration is needed to introduce one — existing roles keep their values.

---

## 6. Role model

```text
Role
├── workspace      ObjectId, required
├── name           String, required, unique per workspace (case-insensitive)
├── description    String
├── permissions    [{ key, scope }]
├── isSystemRole   Boolean
├── isDefault      Boolean   ← the role new invitees receive
└── rank           Number    ← 100 Owner · 50 Admin · 10 everything else
```

`rank` is the escalation guard, not a hierarchy of capability. It answers one
question: *may this actor hand out this role?*

Each workspace is seeded with Owner (rank 100), Admin (50), Member (10,
`isDefault: true`) at creation.

---

## 7. Migration strategy

Modelled on the existing `scripts/migrate-task-assignment.js` conventions:
`--dry-run`, idempotent, logged, with a printed summary.

### 7.1 Existing users

For each `User` with no owned workspace:

1. Create `Workspace { name: "{name}'s Workspace", owner: user._id }`
2. Seed roles Owner / Admin / Member
3. Create `WorkspaceMembership { workspace, user, email: user.email, role: Owner, status: 'active' }`

Idempotency key: skip any user who already owns a workspace.

### 7.2 Existing tasks

`task.workspace = personalWorkspaceOf(task.createdBy)`.

**Orphans** — tasks whose `createdBy` no longer resolves to a `User` — are
**not** silently skipped. They are counted, listed, and left with
`workspace: null`; phase D cannot proceed until the count is zero, forcing an
explicit decision rather than silent data loss.

Preserved untouched: `_id`, `title`, `status`, `priority`, `checklists`,
`dueDate`, `assignee`, `assignedTo`, `createdBy`, `createdAt`, `completedAt`.

### 7.3 `Assignee` records

For each `Assignee { email, createdBy }`:

| Case | Result |
| --- | --- |
| Email belongs to a registered `User` | Membership `status: 'active'`, `user` set, role `Member` |
| Email has no account | Membership `status: 'pending'`, `user: null`, role `Member`, no expiry (grandfathered) |
| Duplicate email in the same workspace | Collapsed — `{ workspace, email }` is unique; first wins, duplicates logged |
| Email equals the workspace owner | Skipped — the owner already has a membership |

The workspace is the creator's personal workspace. **The `Assignee` collection
is not dropped by this migration.** It is retired in Stage 22, after the members
UI has shipped and been verified in production.

### 7.4 Existing assignments

Nothing changes. `assignee` and `assignedTo` keep their values. Because §7.3
creates a membership for every assignee email, every pre-existing assignment
satisfies the new "assignee must be a member" constraint automatically — no
task is orphaned by the new validation.

### 7.5 Rollback

Additive-only, so rollback is deletion of new collections plus `$unset` of
`task.workspace`. No original field is modified, so no data can be lost by
reverting. Rollback is only viable **before** phase D.

---

## 8. Test fixture architecture (Stage 2.5)

New file: `server/tests/factories.js`.

```js
createUser({ name, email, password })            → { user, token }
createWorkspace({ owner, name })                 → { workspace, roles: {owner, admin, member} }
createRole({ workspace, name, permissions })     → role
createMember({ workspace, role, user | email })  → membership
createTask({ workspace, createdBy, ...overrides })→ task
authFor(user, workspace)                         → { Authorization, 'X-Workspace-Id' }
```

Plus one composite that covers most suites:

```js
const ws = await setupWorkspace();
// → { workspace, owner, admin, member, roles, tokens, headers }
```

Target ergonomics, exactly as the brief specifies:

```js
const teacher = await createMember({ role: teacherRole });
const student = await createMember({ role: studentRole });
```

**Existing helpers:** `setupTests.js` needs **no change** — its `afterEach` wipe
iterates `mongoose.connection.collections`, so new collections are cleaned
automatically.

**Cross-workspace simulation:** two `setupWorkspace()` calls give two isolated
graphs; a test asserts `ws1.owner` gets 404 against `ws2`'s resources.

**Permission simulation:** `createRole({ permissions: [...] })` lets a test
express exactly the permission set under test without inventing a business role.

The three existing suites are migrated to factories **before** any model change,
so the suite stays green throughout.

---

## 9. Permission engine architecture (Stage 4.5)

```text
PERMISSIONS (frozen catalogue)
        │
        ▼
role.permissions [{key, scope}]
        │
        ▼
membership (status active, user set)
        │
        ▼
effectivePermissions(membership, workspace)
        │   owner? → every key @ workspace
        │   else   → role.permissions
        ▼
    Map<key, scope>
        │
        ├─► authorize(key)                  key present?
        └─► authorizeResource(key, resource) key present AND scope covers resource?
```

### `authorize('tasks.delete')`

1. `req.permissions` exists (else `resolveWorkspace` never ran → 500, a wiring bug)
2. `req.permissions.has('tasks.delete')` → else **403**

### `authorizeResource('tasks.edit', task)`

1. `task.workspace.equals(req.workspace._id)` → else **404**
2. `req.permissions.has('tasks.edit')` → else **403**
3. Scope test on the resolved scope:
   - `workspace` → pass
   - `assigned` → `task.assignedTo == me || task.createdBy == me`
   - `own` → `task.createdBy == me`
   - else **403**

### List endpoints

Lists never enumerate-then-filter. `scopeFilter(permission, req)` returns a Mongo
fragment merged into the query, so the database does the narrowing:

```js
{ workspace: req.workspace._id, ...scopeFilter('tasks.view', req) }
```

The same builder feeds the analytics `$match`, which is what keeps aggregate
counts honest for `own`/`assigned` scopes (Stage 1 risk R-6).

---

## 10. API design

All new routes sit under `/api/v1`. `X-Workspace-Id` is required except where noted.

### Workspaces

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/workspaces` | authenticated (no workspace header) |
| POST | `/workspaces` | authenticated |
| GET | `/workspaces/current` | membership |
| PATCH | `/workspaces/current` | `workspace.edit` |
| POST | `/workspaces/current/transfer-ownership` | **owner only** |
| DELETE | `/workspaces/current` | **owner only** + `workspace.delete` |

### Members

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/members` | `members.view` |
| POST | `/members` | `members.invite` + rank rule |
| PATCH | `/members/:id` | `members.assign_role` + rank rule |
| DELETE | `/members/:id` | `members.remove` + rank rule |
| POST | `/members/:id/suspend` | `members.suspend` |

### Roles

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/roles` | `roles.view` |
| POST | `/roles` | `roles.create` + ceiling rule |
| PATCH | `/roles/:id` | `roles.edit` + ceiling + not system |
| DELETE | `/roles/:id` | `roles.delete` + not system + member count 0 |

### Permissions

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/permissions` | authenticated |

### Modified existing

`GET/POST/PATCH/DELETE /tasks`, `GET /tasks/analytics` — gain
`resolveWorkspace` + `authorize`. **`GET /tasks/:taskId` is untouched** and
remains unauthenticated.

`/assignees` is frozen (no new features) until retirement in Stage 22.

---

## 11. Frontend architecture

### Provider hierarchy — the D19 fix

```text
createBrowserRouter([
  {
    element: <AppProviders />,        ← AuthProvider ▸ WorkspaceProvider ▸ <Outlet/>
    children: [
      { path: '/',      element: <AdminLayout/>, children: [...] },
      { path: '/auth',  element: <AuthLayout/>,  children: [...] },
    ],
  },
  { path: '/tasks/:taskId', element: <PublicLayout/> },   ← deliberately outside
]);
```

One `AuthProvider` instance, shared across `/` and `/auth`. The public share
route sits outside both providers, which is what keeps it genuinely public.

### `WorkspaceProvider`

Exposes `currentWorkspace`, `workspaces`, `membership`, `role`, `permissions`,
`isLoading`, `error`, `switchWorkspace()`, `refreshWorkspace()`.

`apiClient` gains a `getWorkspaceId` injection point, mirroring the existing
`getToken`/`onUnauthorized` wiring, so the header is set in exactly one place.

### Clearing state on switch

```jsx
<TaskProvider key={currentWorkspace?._id}>
```

Changing the key unmounts and remounts the provider, so stale task state from
the previous workspace cannot survive a switch. This is preferable to a manual
reset effect, which is the usual source of "workspace A's tasks briefly visible
in workspace B".

### Permission utilities

```jsx
const can = usePermission();
can('tasks.create')                    // → boolean

<Can permission="tasks.delete">…</Can>  // renders nothing without it
```

UX only. Every gated action is independently enforced server-side.

---

## 12. Security model

### Identity vs authority

```text
JWT            → establishes IDENTITY  (unchanged, still { id } only)
Membership     → establishes ACCESS    (server-resolved every request)
Role+Scope     → establishes AUTHORITY (server-resolved every request)
```

Never trusted from the client: `role`, `permissions`, `userId`, or an
unvalidated `workspaceId`.

### Escalation prevention — two rules

**Rank rule** (assignment). You may only assign a role with `rank <` your own.
Admin (50) can assign Member/custom (10), not Admin (50) or Owner (100).
`members.assign_admin` relaxes this to `rank <=` for Admin specifically. Owner is
never assignable — only transferable.

**Ceiling rule** (role authoring). When creating or editing a role you may only
grant permissions you hold yourself, at a scope no wider than your own.

Without the ceiling rule, `roles.create` is a privilege-escalation primitive: mint
a role with `workspace.delete`, assign it to yourself, done. This is precisely
the Stage 21 "permission injection" attack.

### Workspace isolation

Every query is `{ workspace: req.workspace._id, ... }`. Cross-workspace resource
access returns 404, never 403. `resolveWorkspace` refuses any workspace the user
has no **active** membership in — pending and suspended both fail.

### Mass assignment

Existing `req.validated` allowlist pattern extends to the new endpoints. Role
creation validates every key against the frozen catalogue; unknown keys are
rejected outright rather than stored and ignored.

---

## 13. Index strategy

Derived from the four queries that actually exist after migration.

| Query | Index |
| --- | --- |
| Board, `workspace` scope, sorted | `{ workspace: 1, createdAt: -1 }` |
| Board, `assigned` scope | `{ workspace: 1, assignedTo: 1, createdAt: -1 }` |
| Board, `own` scope | `{ workspace: 1, createdBy: 1, createdAt: -1 }` |
| Analytics `$match` + group by status | `{ workspace: 1, status: 1 }` |

The three existing owner-first indexes are **kept until phase D verifies**, then
dropped — they become non-selective once every query leads with `workspace`.

Supporting collections:

```js
WorkspaceMembership: { workspace: 1, email: 1 }  unique
                     { workspace: 1, user: 1 }   unique, sparse
                     { user: 1, status: 1 }      ← "my workspaces"
Role:                { workspace: 1, name: 1 }   unique, case-insensitive collation
Workspace:           { owner: 1 }
```

Not created: `{ workspace, priority }` (analytics groups priority in the same
`$facet` pass already served by the status index) and every other combination —
the brief forbids blind index creation.

---

## 14. Migration risks

| # | Risk | Mitigation |
| --- | --- | --- |
| A-1 | Assignees silently lose delete rights | Explicitly decided ([D1](#d1--task-deletion-is-decoupled-from-assignment-)); call out in release notes |
| A-2 | Orphaned tasks block phase D | Counted and listed, never skipped; phase D gated on zero |
| A-3 | Owner accidentally removable | `Workspace.owner` authoritative + engine short-circuit + membership invariants |
| A-4 | Admin self-escalation | Rank rule + ceiling rule + owner-only operation list |
| A-5 | Permission injection via role editor | Ceiling rule + catalogue validation |
| A-6 | Public endpoint leaks workspace | Projection unchanged; Stage 8 test asserts exact key set |
| A-7 | Analytics leaks cross-scope counts | Same `scopeFilter` builder feeds `$match` |
| A-8 | Stale tasks after switch | `key={workspace._id}` remount |
| A-9 | Catalogue drift client↔server | No generated client file; effective permissions come from the server |
| A-10 | Test suite breaks mid-migration | Stage 2.5 factories land first |
| A-11 | Header spoofing | Validated + membership-checked every request; 404 on failure |
| A-12 | Pending member gains access early | Authorization requires `status === 'active'` **and** non-null `user` |

---

## 15. Implementation order

| Stage | Deliverable | Gate |
| --- | --- | --- |
| ~~1~~ | ~~Discovery~~ | ✅ done |
| ~~2~~ | ~~Architecture (this doc)~~ | ✅ **review checkpoint** |
| **2.5** | Test factories; existing 55 tests migrated | 55/55 green, no model changes yet |
| 3 | Models: Workspace, Membership, Role + model tests | Lint + tests green |
| 4 | Migration script + `--dry-run` against a copy | Dry run reports 0 orphans |
| **4.5** | Permission catalogue + `authorize()` engine + unit tests | Engine tested in isolation |
| 5 | Wire engine into middleware; error semantics | Boundary tests pass |
| 6–7 | Workspace + Role APIs | Permission boundary tests |
| 8 | Tasks workspace-scoped (**highest risk**) | Full regression + public-projection test |
| 9 | Auth + current workspace endpoints | |
| 10 | **Fix AuthProvider duplication**, add WorkspaceProvider | |
| 11 | Frontend permission utilities | |
| 12–15 | Switcher, members, roles, invitations UI | |
| 16–18 | Task/analytics/nav permission UX | |
| 19 | Onboarding + role templates | |
| 20–21 | RBAC + security testing | Escalation suite must pass |
| 22 | Retire `Assignee`; phase D enforce `workspace` required | Verify count zero first |
| 23–25 | UX audit, retro integration, final audit | |

---

## Verification

```
Application code changed:  none
Models created:            none
Migrations run:            none
APIs changed:              none
UI changed:                none
Dependencies installed:    none

Baseline unchanged: 55 server / 65 client tests passing
```

**Stage 2 complete. Stopping for architecture review.**

Seven Stage 1 open decisions are now closed: D1 (deletion), D2 (unregistered
assignees), D3 (Assignee retirement), D8/D17 (defaults and personal workspaces),
D13 (catalogue delivery), D16 (phased requirement).
