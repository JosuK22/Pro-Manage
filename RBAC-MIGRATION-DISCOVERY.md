# RBAC Migration — Stage 1 Discovery

**Status:** Discovery only. No application code was modified in this stage.

This document records how Pro-Manage works today, what a multi-workspace RBAC
model would collide with, and the order in which the migration should proceed.

---

## Contents

- [1. Executive summary](#1-executive-summary)
- [2. Current architecture](#2-current-architecture)
- [3. The eight discovery questions](#3-the-eight-discovery-questions)
- [4. Affected files](#4-affected-files)
- [5. Affected APIs](#5-affected-apis)
- [6. Affected database models](#6-affected-database-models)
- [7. Migration risks](#7-migration-risks)
- [8. Backward compatibility](#8-backward-compatibility)
- [9. Recommended migration order](#9-recommended-migration-order)
- [10. Open decisions for Stage 2](#10-open-decisions-for-stage-2)

---

## 1. Executive summary

Pro-Manage currently has **no authorization layer at all** — only ownership
filters. There is exactly one access rule in the entire backend:

```js
// server/controllers/taskController.js
const visibleToUser = (userId) => ({
  $or: [{ createdBy: userId }, { assignedTo: userId }],
});
```

Every authenticated task operation — list, update, delete, analytics — is that
one predicate. There are no roles, no permissions, no groups, and no concept of
an organization. `User` has exactly four meaningful fields and none of them
describe authority.

**The good news:** there is no hardcoded role logic to unpick. A repository-wide
search for `user.role`, `isAdmin`, `req.user.role` or equivalent returns
**nothing**. The codebase has no business-role assumptions to remove, which
removes an entire category of migration risk that the brief anticipates
(Stage 22 will have very little to do).

**The main structural problem** is that the app already has a *second,
overlapping* sharing concept — the `Assignee` model — which is a per-user email
address book, not a membership list. Reconciling `Assignee` with
`WorkspaceMembership` is the single largest design decision in this migration,
and it is unresolved. See [§10](#10-open-decisions-for-stage-2).

**One security finding surfaced during discovery** that is independent of RBAC
and should be decided deliberately rather than inherited. See
[risk R-2](#r-2-assignees-currently-have-destructive-rights).

---

## 2. Current architecture

### Entity relationships as they exist

```text
User ──────────< Task.createdBy      (owner, immutable)
User ──────────< Task.assignedTo     (derived, nullable)
User ──────────< Assignee.createdBy  (per-user address book)

Task.assignee (email string)  ──resolves to──>  User._id  ──>  Task.assignedTo
```

There is no Workspace, Membership, Role or Permission entity of any kind.

### Request flow today

```text
Request
  ↓
express.json (100kb) → mongoSanitize → rate limiter
  ↓
protect()                      ← JWT verify, load User, set req.user
  ↓
validate*()                    ← allowlist into req.validated
  ↓
controller                     ← applies visibleToUser(req.user._id) inline
  ↓
Mongo query with ownership baked into the filter
```

Authorization is **not a layer**. It is a query predicate repeated in four
controller functions. That is why it is currently correct but not extensible:
there is nowhere to hang a permission check.

---

## 3. The eight discovery questions

### 3.1 How are users created?

`POST /api/v1/auth/register` → `validateRegister` → `User.create({ email, name,
password, confirmPassword })` → immediate JWT issue (201).

Field picking is explicit in the controller, so a client cannot smuggle extra
fields into the new document. Registration auto-authenticates. **No workspace,
role or membership is created.**

### 3.2 How does authentication work?

- **Token:** `jwt.sign({ id: userId }, JWT_SECRET_KEY, { expiresIn: JWT_EXPIRES_IN || '7d' })`.
  The payload carries **only** the user id — no role, no workspace.
- **Verification:** `protect` in `authController.js` reads `Authorization: Bearer`,
  verifies, loads the full `User` document, assigns `req.user`.
- **Storage:** `localStorage` key `user`, holding `{ info, token }`.
- **Client:** `AuthProvider` hydrates from storage and decodes `exp` locally
  *for UX only* — it explicitly documents the server as sole authority.
- **401 handling:** centralised in `apiClient.js`, de-duplicated across parallel
  requests.

**Implication for RBAC:** the JWT is already minimal, which is exactly what the
brief asks for ("do not put all workspace data into the JWT"). Current workspace
should be resolved server-side per request, not embedded. No token format change
is required.

### 3.3 How do tasks determine ownership?

`Task.createdBy` — `ObjectId`, `required`, **`immutable`**. Set exclusively from
`req.user._id` in `createTask`. Never read from the request body.

The immutability flag is enforced at the schema level, so even a bug in a future
controller cannot reassign ownership.

### 3.4 How do tasks determine assignment?

A deliberate two-field design, documented in the schema:

| Field | Type | Role |
| --- | --- | --- |
| `assignee` | `String` (email, lowercased) | Authoritative user input |
| `assignedTo` | `ObjectId → User` | **Derived** in `pre('save')` |
| `shared` | virtual | `Boolean(assignedTo)` |

The `pre('save')` hook looks up a `User` by the assignee email. If one exists,
`assignedTo` is set and the task becomes visible on that person's board. If not,
the email is retained for display and `assignedTo` stays `null`.

**This is the critical detail for RBAC:** assignment currently works for people
who *do not have accounts*. A workspace membership model normally requires a
real `User`, so this capability must be preserved via an invitation concept or
it will be a functional regression.

### 3.5 How are users currently shared?

Through the `Assignee` model:

```js
{ email: String, createdBy: ObjectId }
// unique compound index: { createdBy: 1, email: 1 }
```

This is a **per-owner address book of email strings**, not a membership table.
"Add people to the board" writes here. It populates the assignee dropdown.

Notably: adding someone to your `Assignee` list grants them **nothing**. Access
only materialises when a task is actually assigned to their email *and* that
email belongs to a registered account.

### 3.6 Which APIs depend on current user identity?

| Endpoint | Dependency | Notes |
| --- | --- | --- |
| `GET /tasks` | `visibleToUser(req.user._id)` | + range/status/priority filters, pagination |
| `POST /tasks` | `createdBy = req.user._id` | |
| `PATCH /tasks/:taskId` | `visibleToUser` | load-then-save |
| `DELETE /tasks/:taskId` | `visibleToUser` | |
| `GET /tasks/analytics` | `$or` match on user id | aggregation `$facet` |
| `GET /tasks/:taskId` | **none — public** | explicit projection, no auth |
| `GET /users` | `req.user` | |
| `PATCH /users` | `req.user._id` | no id in route by design |
| `GET/POST/PATCH/DELETE /assignees` | `createdBy: req.user._id` | |

Every one of these becomes workspace-scoped except the public share endpoint.

### 3.7 Which frontend screens assume a single user/workspace?

| Area | Assumption |
| --- | --- |
| `App.jsx` | **`AuthProvider` is instantiated twice** — separately under `/` and `/auth`. Two independent state trees. |
| `TaskProvider` | Wraps **only** `Board`. Analytics fetches independently via `useApiResource`. |
| `Navigation.jsx` | `LINKS` is a static array. No permission gating. |
| `Board/index.jsx` | "Add people" writes to the personal address book; assumes one board |
| `Analytics` | Requests global stats for "my" tasks |
| `Settings` | Profile + security only; no workspace concept |
| `apiClient.js` | No workspace header or path segment |
| `Dropdown.jsx` | Loads *all* of the user's assignees, unfiltered by permission |

The `AuthProvider` duplication is a real obstacle: a `WorkspaceProvider` placed
naively inside either subtree would have the same problem, and workspace state
would not survive an auth-route transition.

### 3.8 Which tests depend on the current model?

**Server — 55 tests, 3 suites.** All will need workspace-aware fixtures:

- `stage1.test.js` — registration, credential leakage, login, public task view
- `stage2.security.test.js` — **IDOR tests assert user A cannot touch user B's
  task.** These encode the current two-user model and must be *extended*, not
  replaced, to cover workspace isolation.
- `stage3.data.test.js` — assignment derivation, date-range, pagination,
  analytics correctness, assignee scoping

**Client — 65 tests, 5 suites.** Mostly insulated:

- `apiClient.test.js`, `taskUrgency.test.js` — unaffected
- `taskProvider.test.jsx` — mocks `taskApi`; affected only if the task API shape changes
- `components.test.jsx`, `board.dnd.test.jsx` — affected only if permission gating changes rendered output

---

## 4. Affected files

### Backend — will require changes

| File | Nature of change |
| --- | --- |
| `model/taskModel.js` | Add `workspace` ref + revised indexes |
| `model/userModel.js` | Minimal; no role field (deliberately) |
| `model/assigneeModel.js` | **Decision pending** — may be superseded |
| `controllers/taskController.js` | Replace `visibleToUser` with scope resolution |
| `controllers/authController.js` | `protect` unchanged; add workspace resolution middleware |
| `controllers/assigneeController.js` | Workspace scoping or removal |
| `routes/*.js` | Insert `authorize(...)` middleware |
| `middleware/validate.js` | Add workspace/role/permission validators |
| `constants.js` | Add permission catalogue |
| `app.js` | Mount workspace/role/member routers |

### Backend — new

`model/workspaceModel.js`, `model/membershipModel.js`, `model/roleModel.js`,
`middleware/authorize.js`, `constants/permissions.js`,
`controllers/workspaceController.js`, `controllers/roleController.js`,
`controllers/memberController.js`, `scripts/migrate-to-workspaces.js`

### Frontend — will require changes

`App.jsx` (provider composition), `store/AuthProvider.jsx`,
`store/TaskProvider.jsx`, `services/index.js`, `pages/Admin/index.jsx`,
`pages/Admin/Navigation/Navigation.jsx`, `pages/Admin/Board/index.jsx`,
`pages/Admin/Board/Card/Card.jsx`, `pages/Admin/Analytics/index.jsx`,
`components/form/SearchableDropdown/Dropdown.jsx`

### Frontend — new

`store/WorkspaceProvider.jsx`, `hooks/usePermission.js`,
`components/auth/Can.jsx`, `constants/permissions.js`,
`pages/Admin/Members/`, `pages/Admin/Roles/`, workspace switcher component

---

## 5. Affected APIs

**Breaking (require coordinated client+server change):**
`GET /tasks`, `POST /tasks`, `PATCH /tasks/:id`, `DELETE /tasks/:id`,
`GET /tasks/analytics` — all gain workspace scoping.

**Non-breaking:** `POST /auth/register`, `POST /auth/login`, `GET/PATCH /users`.

**Must remain unchanged:** `GET /tasks/:taskId` (public share). Its projection
already excludes `createdBy`/`assignedTo`; it must also **not** begin leaking
`workspace`, workspace name, or member information.

**New:** workspace CRUD + switch, member list/invite/role-change/remove, role
CRUD, permission catalogue read.

---

## 6. Affected database models

| Collection | Change |
| --- | --- |
| `users` | None structurally. Do **not** add `role`. |
| `tasks` | Add `workspace` (ObjectId, required post-migration). Re-key indexes. |
| `assignees` | Pending decision — scope to workspace, or migrate into memberships |
| `workspaces` | New |
| `workspacememberships` | New |
| `roles` | New |

### Index impact

Current task indexes are keyed owner-first:

```js
{ createdBy: 1, createdAt: -1 }
{ assignedTo: 1, createdAt: -1 }
{ createdBy: 1, status: 1 }
```

Once every query is workspace-scoped, the leading key should become `workspace`,
otherwise each board read scans a user-wide index and filters. Expected shape:

```js
{ workspace: 1, createdAt: -1 }
{ workspace: 1, assignedTo: 1, createdAt: -1 }
{ workspace: 1, status: 1 }
```

The existing indexes should not be dropped until the new queries are proven.

---

## 7. Migration risks

### R-1 — Tasks have no workspace and no default
**Severity: high.** Every existing task must be back-filled. A task whose
`createdBy` user is missing (deleted account) would be orphaned by a naive
migration. The script must handle orphans explicitly rather than skipping them
silently.

### R-2 — Assignees currently have destructive rights
**Severity: high. Pre-existing, not caused by this migration.**

`updateTask` and `deleteTask` both filter by `visibleToUser`, which is
`createdBy OR assignedTo`. **An assignee can therefore delete the creator's
task.** There is no permission separating "can edit what I'm assigned" from
"can delete".

The brief's example permission sets assume the opposite — a Student gets
`tasks.edit → assigned` but *not* `tasks.delete`. Introducing RBAC will
therefore **remove a capability people currently have**. That is almost
certainly the correct outcome, but it is a behaviour change that must be a
conscious decision, not a side effect. Flagging for Stage 2.

### R-3 — Assignment works for non-users
**Severity: high.** `assignee` accepts any email; `assignedTo` is set only if an
account exists. Workspace membership normally presupposes a `User`. If
membership becomes a hard requirement for assignment, assigning work to someone
who has not signed up breaks. Needs an invited-but-unregistered membership
state.

### R-4 — `Assignee` and `WorkspaceMembership` overlap
**Severity: high (design).** Two models would answer "who can I assign work to?"
with different data. Leaving both invites drift, exactly like the old
`assignee`/`assignedTo`/`shared` triple that a previous pass already had to fix.

### R-5 — Public share endpoint leakage
**Severity: medium.** Adding `workspace` to `Task` creates a new way to leak
organizational data through the one unauthenticated endpoint. The projection is
currently an explicit allowlist — this must be preserved, and a regression test
added asserting `workspace` never appears.

### R-6 — Analytics aggregation is user-scoped
**Severity: medium.** The `$facet` pipeline matches `$or: [createdBy, assignedTo]`.
Under RBAC the match must become workspace + permission-scope dependent
(`own` / `assigned` / `workspace`). Getting this wrong leaks aggregate counts
across a workspace to users who should only see their own.

### R-7 — Double `AuthProvider` instantiation
**Severity: medium (frontend).** `App.jsx` mounts `AuthProvider` twice. Workspace
state placed inside either subtree will not be shared. Provider composition must
be restructured before `WorkspaceProvider` is introduced.

### R-8 — Client/server constant drift
**Severity: low but recurring.** `server/constants.js` and
`client/src/constants/task.js` are already manually mirrored. A permission
catalogue duplicated the same way will drift. Prefer serving the catalogue from
an endpoint, or generating one file from the other.

### R-9 — Test fixtures assume no workspace
**Severity: medium.** All 55 server tests create users and tasks directly. Each
will need a workspace. Fixture helpers should be introduced *before* the
controllers change, so the suite stays green throughout.

---

## 8. Backward compatibility

**Data:** additive only. No field is dropped in the migration. `createdBy`,
`assignedTo`, `assignee`, checklists, timestamps and `_id` all survive. The
migration must be idempotent — re-running it must not create duplicate personal
workspaces.

**API:** the task endpoints change shape. Since client and server ship together
this is acceptable, but they must be deployed together — the brief's rule
"update both frontend and backend together" applies.

**Auth:** existing JWTs remain valid. The payload does not change, so tokens
issued before the migration continue to work after it.

**Behaviour:** the one intentional regression is R-2 (assignees losing delete
rights). Everything else should be invisible to a single-workspace user.

---

## 9. Recommended migration order

Broadly the brief's order, with three deviations, all of which move risk earlier:

| # | Stage | Deviation from brief |
| --- | --- | --- |
| 1 | Discovery | — (this document) |
| 2 | Architecture design | Must also resolve R-2, R-3, R-4 |
| **2.5** | **Test fixture refactor** | **Added.** Introduce workspace-aware fixtures before models land (R-9) |
| 3 | Models: Workspace, Membership, Role | — |
| 4 | Data migration script + dry-run | — |
| **4.5** | **Permission catalogue + `authorize()` skeleton** | **Pulled earlier.** Land the engine before any endpoint depends on it |
| 5 | Authorization engine | — |
| 6–7 | Workspace + Role APIs | — |
| 8 | Task migration to workspaces | Highest-risk backend stage |
| 9 | Auth + current workspace | — |
| 10–11 | Frontend context + permissions | **Fix R-7 first** |
| 12–15 | Switcher, members, roles, invitations UI | — |
| 16–18 | Task/analytics/nav permission UX | — |
| 19 | Onboarding | — |
| 20–21 | RBAC + security testing | — |
| 22 | Legacy cleanup | **Expected to be near-empty** — no role checks exist |
| 23–25 | UX audit, retro integration, final audit | — |

---

## 10. Open decisions for Stage 2

These must be settled before any model is written.

1. **`Assignee` vs `WorkspaceMembership`.** Options: (a) delete `Assignee`,
   migrate rows into memberships with an `invited` status; (b) keep `Assignee`
   scoped to a workspace as a lightweight address book; (c) keep as-is.
   Recommendation: **(a)** — one concept, matching R-4.

2. **Can non-users be assigned work?** If yes, membership needs a
   `status: 'invited'` row keyed by email with a null `user` ref until signup.
   Recommendation: **yes** — removing it is a functional regression (R-3).

3. **Do assignees keep delete rights?** Recommendation: **no** — grant
   `tasks.edit → assigned` and `tasks.change_status → assigned` but not
   `tasks.delete`, per the brief's own examples. Requires explicit sign-off (R-2).

4. **Personal workspace naming.** Every existing user gets one. `"{name}'s
   Workspace"` is the obvious default; needs confirmation.

5. **Is `workspace` required on `Task`?** Recommendation: nullable during
   migration, then required once back-fill is verified — never required in the
   same deploy that adds it.

6. **Permission catalogue delivery.** Endpoint vs duplicated constants file (R-8).

7. **Default role for a newly invited member.** The brief warns against assuming
   `Member` means "can do everything with tasks" — the default set must be
   defined explicitly.

---

## Verification

Nothing was executed against application code in this stage.

```
Code changes:  none
Build:         not re-run (no changes)
Tests:         not re-run (no changes) — baseline is 55 server / 65 client, all passing
```

**Stage 1 complete. Stopping here as instructed.**

Stage 2 (`RBAC-ARCHITECTURE.md`) should begin by resolving the seven open
decisions above, since every subsequent stage depends on them.
