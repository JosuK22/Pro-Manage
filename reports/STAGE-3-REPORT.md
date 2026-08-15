# Stage 3 — Workspace / Membership / Role Database Foundation

**Status:** Complete. Models and test fixtures only. No controllers, routes,
middleware, frontend, migrations or dependencies were touched.

---

## 1. Models created

| Model | File | Collection |
| --- | --- | --- |
| `Workspace` | `server/model/workspaceModel.js` | `workspaces` |
| `Role` | `server/model/roleModel.js` | `roles` |
| `WorkspaceMembership` | `server/model/workspaceMembershipModel.js` | `workspacememberships` |
| `WorkspaceInvitation` | `server/model/workspaceInvitationModel.js` | `workspaceinvitations` |

Plus `server/config/permissions.js` — the permission catalogue (not a collection).

Files use `server/model/` (singular), matching the existing project layout
rather than the `server/models/` in the brief.

## 2. Models modified

| Model | Change |
| --- | --- |
| `Task` | Added nullable `workspace` ref. Nothing else. |
| `User` | **Unchanged.** No workspace, role or permission field was added. |
| `Assignee` | **Untouched**, as instructed. |

## 3. Schema details

### Workspace

`name` (required, trimmed, ≤80) · `description` (≤500) · `owner` (ref User,
required, **validated to exist**) · timestamps.

`owner` is the authoritative record of ownership. An Owner *role* also exists,
but only so the members list has something to display — authorization will read
this field, which is what makes owner authority impossible to revoke by editing
a role's permissions.

### Role

`workspace` (required, immutable) · `name` (required, ≤60) · `description` ·
`permissions[]` · `isSystemRole` · `systemKey` · `isDefault` · `rank`.

**Permissions are subdocuments, not strings:**

```js
{ key: 'tasks.view', scope: 'assigned' }
```

A bare string array would have made scope impossible to add without a
migration. `{ _id: false }` keeps the subdocuments from accumulating ids.

`systemKey` (`OWNER` / `ADMIN` / `MEMBER`) is the stable identity; the display
name is not. A workspace can rename "Member" to "Contributor" without the
backend losing track of which role is the protected fallback.

`rank` (Owner 100, Admin 50, everything else 10) exists for exactly one future
question — *may this actor hand out this role?* It is not a hierarchy of
capability; capability comes only from permissions.

### WorkspaceMembership

`workspace` · `user` · `role` · `status` · `invitedBy` · `joinedAt` · timestamps.

### WorkspaceInvitation

`workspace` · `email` (lowercased) · `role` · `invitedBy` · `tokenHash`
(`select: false`) · `status` · `expiresAt` · `acceptedAt` · `acceptedBy`.

Only the SHA-256 **hash** of the token is stored; `createToken()` returns
`{ raw, hash }` so the service can put the raw value in the link and persist
only the digest. SHA-256 rather than bcrypt is correct here: the token is 32
bytes of CSPRNG output with no guessable structure, and lookups must be fast.

`isExpired` / `isUsable` are **virtuals**, never stored flags — a boolean would
need a sweeper job to stay true and would be wrong until it ran.

### Task

```js
workspace: { type: ObjectId, ref: 'Workspace', default: null }
```

Phase A only. Verified `required === false`.

## 4. Relationships

```text
User ──1:N──► WorkspaceMembership ──N:1──► Workspace
                      │                        │
                      └──N:1──► Role ◄──1:N────┘
                                  ▲
Workspace ──1:N──► WorkspaceInvitation ──N:1──┘

Workspace ──1:N──► Task   (nullable until phase D)
```

No workspace or role data lives on `User`. The same person is an Owner in one
workspace and a Student in another purely through their memberships.

## 5. Permission catalogue

26 permissions across five categories, each with
`{ key, label, description, category, supportedScopes }`.

**Tasks** — `view`, `create`, `edit`, `delete`, `assign`, `change_status`,
`change_priority`, `manage_checklists`, `share`
**Members** — `view`, `invite`, `edit`, `remove`, `suspend`, `assign_role`,
**`assign_admin`**
**Roles** — `view`, `create`, `edit`, `delete`
**Analytics** — `view`, `export`
**Workspace** — `view`, `edit`, `manage`, `delete`

> ⚠️ **`members.assign_admin` is one addition** to the list in §11. It is carried
> over from the Stage 2 architecture, where it is how an Owner decides whether
> Admins may create other Admins — the alternative was hardcoding that rule in a
> controller. Easy to remove if you'd rather it wait.

No `media.*` permissions: the feature does not exist. A test asserts this.

## 6. Scope model

`own ⊆ assigned ⊆ workspace`, with `assigned` deliberately including what you
created — a task that vanished the moment you saved it would be absurd, and the
inclusion is what makes the three genuinely comparable.

`supportedScopes` records where narrowing is meaningful. `tasks.create` supports
only `workspace`; scoping "create" to `own` would read as a rule and enforce
nothing, so the model rejects it. An omitted scope defaults to the widest the
permission allows.

## 7. Indexes

| Collection | Index | Why |
| --- | --- | --- |
| `workspaces` | `{ owner: 1 }` | Migration idempotency, ownership transfer, "don't delete your last workspace" |
| `roles` | `{ workspace: 1, name: 1 }` unique, collation strength 2 | Names unique *per workspace*; case-insensitive so `Developer`/`developer` collide |
| `roles` | `{ workspace: 1, systemKey: 1 }` unique, **partial** | One Owner role per workspace |
| `workspacememberships` | `{ workspace: 1, user: 1 }` unique | **Critical** — one membership per person per workspace |
| `workspacememberships` | `{ user: 1, status: 1 }` | "Which workspaces can I switch to?" |
| `workspacememberships` | `{ workspace: 1, status: 1 }` | Members screen |
| `workspacememberships` | `{ workspace: 1, role: 1 }` | "How many members still use this role?" — the delete guard |
| `workspaceinvitations` | `{ workspace: 1, email: 1 }` unique, **partial on `status: 'pending'`** | One *pending* invitation per email |
| `workspaceinvitations` | `{ email: 1, status: 1 }` | Claim outstanding invitations at registration |
| `workspaceinvitations` | `{ workspace: 1, status: 1 }` | Pending list beside the members list |

**Two partial indexes, and both had to be partial rather than sparse.** A sparse
unique index still indexes explicit `null`s, so every custom role — all with
`systemKey: null` — would have collided with every other. Restricting to
`{ systemKey: { $type: 'string' } }` sidesteps it. Same reasoning for
invitations: a plain unique index would forbid re-inviting someone after their
first invitation was revoked, which is legitimate.

**No Task indexes were added.** Nothing queries by workspace yet, so they would
index an all-null field. Planned for Stage 8:

```js
{ workspace: 1, createdAt: -1 }                  // workspace-scope board
{ workspace: 1, assignedTo: 1, createdAt: -1 }   // assigned-scope board
{ workspace: 1, createdBy: 1, createdAt: -1 }    // own-scope board
{ workspace: 1, status: 1 }                      // analytics
```

The three existing owner-first indexes stay until phase D verifies, then drop.

## 8. Test fixtures

| Factory | Behaviour |
| --- | --- |
| `createUser({ withWorkspace })` | Registers via the real API. **`withWorkspace` defaults to `false`.** |
| `createWorkspace({ owner, name })` | Workspace + the three seeded system roles |
| `createRole({ workspace, name, permissions })` | Custom role; accepts `'tasks.view'` or `{ key, scope }` |
| `createMember({ workspace, role, user? })` | Registers a user if none given |
| `setupWorkspace({ name })` | `{ workspace, roles, owner, admin, member }` |

**`withWorkspace` defaults to `false`, contradicting my Stage 2.5 note.**
Registration does not create a workspace in production yet, so defaulting to
`true` would make fixtures describe a system that does not exist and add three
writes to forty tests that never read them. The default flips in Stage 8, when
tasks actually require a workspace.

Role seeding lives in `createWorkspace`, not a model hook — a hook that silently
creates three documents makes test failures much harder to read.

## 9. Existing behaviour

**Nothing changed.** Verified:

- `git diff` over `server/controllers`, `server/routes`, `server/middleware` — empty
- `assigneeModel.js` — untouched
- `Task.workspace.isRequired === false`
- Task indexes still exactly the three original ones
- App boots; `mongoose.modelNames()` returns only `Assignee, Task, User` — the
  new models are not loaded by the application at all, only by tests

## 10. Tests

```
Server:      102 / 102 passing  (4 suites)
  ├─ pre-existing:  55 / 55   (unchanged)
  └─ new RBAC:      47 / 47
Client:       65 / 65 passing
Lint:         clean, 0 warnings
Build:        succeeds
```

### One test failed and was investigated, not papered over

`rejects a whitespace-only name` failed expecting `/cannot be empty/` but got
`name is required`. Diagnosis: **Mongoose applies setters before validators**,
so `'    '` is trimmed to `''` and caught by `required` — meaning my extra
"not blank" validator was unreachable dead code.

The model was right; the test asserted the wrong message. I removed the
redundant validator from both `Workspace` and `Role` and corrected the
assertion, rather than keeping a validator that never runs.

## 11. Known limitations

- **No authorization engine.** No `authorize()`, `resolveWorkspace()` or
  `requirePermission()`. Stage 4.5/5.
- **No workspace-aware API.** No route sends or reads `X-Workspace-Id`.
- **No production migration.** No real user has a workspace.
- **`Assignee` still exists**, untouched.
- **`Task.workspace` is nullable** and unread.
- **Cross-workspace integrity is enforced in `pre('validate')` only.** A raw
  `updateOne`/`findOneAndUpdate` bypasses document middleware entirely, so the
  service layer must re-check `role.workspace === membership.workspace`. This is
  a real gap, not a theoretical one — noted for Stage 5.
- **Owner-membership invariants are not yet enforced** (exactly one Owner role
  holder, equal to `workspace.owner`). Belongs with the workspace service.

## 12. Migration readiness

**Ready for Stage 4.** Everything the migration needs exists:

- `Workspace` with a validated owner → personal workspaces
- `Role` with system seeding → protected roles per workspace
- `WorkspaceMembership` → owner memberships
- `WorkspaceInvitation` → the destination for unregistered `Assignee` rows
- `Task.workspace` nullable → the backfill target

### `Assignee` inspection (§27)

| Field | Type |
| --- | --- |
| `email` | String, required, trimmed, lowercased, regex-validated |
| `createdBy` | ObjectId → User, required, immutable |
| timestamps | `createdAt` / `updatedAt` |

Index: `{ createdBy: 1, email: 1 }` unique — per-owner address book.

**Data volume: not measured.** I have not queried production, and will not
without instruction. The migration script must report counts during `--dry-run`
rather than assuming a scale.

Mapping for Stage 4:

```text
Assignee.createdBy  →  that user's personal Workspace
Assignee.email      →  registered?  WorkspaceMembership (active, role Member)
                       otherwise    WorkspaceInvitation (pending)
```

Edge cases the script must handle: an assignee email equal to the workspace
owner's (skip — already a member), duplicates collapsing under the new unique
indexes, and tasks whose `createdBy` no longer resolves to a user.

---

**Stage 3 complete. Stopping.** No migration has been run and no production data
has been touched.
