# Stage 8.1 — Workspace Context Infrastructure Report

## Status

**Complete.** Infrastructure only.

```
No production migration was executed.
No task routes were modified.
No frontend changes were made.
No Assignee changes were made.
No authorization engine changes were made.
```

```
Server: 399 / 399 passing   (9 suites)
Client:  65 / 65 passing
Lint:    clean, 0 warnings
Build:   succeeds
```

Verified by `git diff`: `taskRoute.js`, `taskController.js`, `taskModel.js`,
`assigneeModel.js` and the entire `client/` tree show no diff. The
`services/authorization/` directory is unmodified.

---

## Architecture

```text
protect            → establishes WHO           (unchanged)
        ↓
requireWorkspaceContext → establishes WHICH WORKSPACE   (new, opt-in)
        ↓
authorization engine    → establishes WHETHER  (unchanged)
```

The middleware answers exactly one question — *which workspace is this request
about?* — and deliberately does nothing else. It performs **no database query
at all**: parsing an ObjectId does not need the document, and loading a
Workspace on every request to find something the engine is about to load anyway
would be waste.

It also performs no membership lookup. That is not an oversight but the point:
a second, weaker access path must not be able to grow here by accident.

---

## X-Workspace-Id Behaviour

> **The header identifies the requested workspace. It does not grant access.**

A header is a claim, not a credential. Anyone can send anyone else's workspace
id.

| Situation | Result |
| --- | --- |
| Valid id | `req.workspaceContext = { workspaceId, source }` |
| Missing, on a route that requires it | **400** — "This request needs a workspace" |
| Empty / whitespace-only | Treated as **absent**, not malformed |
| Malformed (`abc`, `'; drop--`) | **400**, before any query is attempted |
| Well-formed but no such workspace | Context resolves; authorization returns **404** |
| Caller is not a member | Context resolves; authorization returns **404** |
| Any casing (`x-workspace-id`, `X-WORKSPACE-ID`) | Accepted — HTTP header names are case-insensitive |
| Surrounding whitespace | Trimmed |
| Absent, on a route that does not require it | Nothing happens |

Empty and malformed are treated **differently on purpose**: a blank header means
the caller sent nothing, which is the "missing" case, not a parse failure.

---

## Middleware

`server/middleware/workspaceContext.js` exports:

| Export | Purpose |
| --- | --- |
| `requireWorkspaceContext` | The opt-in middleware |
| `resolveWorkspaceContext` | Pure resolution — no `req` mutation, unit-testable |
| `getWorkspaceId(req)` | The single accessor |
| `WORKSPACE_HEADER`, `SOURCE` | Constants |

**It is not mounted on any route.** Stage 8.1 ships the mechanism; opting routes
in belongs to the integration stages. Grep confirms it appears nowhere outside
its own module and its tests.

### The ordering guard

`requireWorkspaceContext` returns **401** if `req.user` is absent. Mounting it
without `protect` is a wiring mistake, and failing closed beats quietly building
a context for an anonymous caller. Tested with a deliberately unprotected route.

---

## Request Context

```js
req.workspaceContext = Object.freeze({ workspaceId, source });
```

Only the id and where it came from. No workspace document, no membership, no
role, no permissions — per §4, and because the engine resolves all of those
itself from current state.

`Object.freeze` stops a later handler quietly retargeting the request mid-flight.

**Request-local by construction.** Everything hangs off `req`; there is no
module-level mutable state, no singleton and no async-local storage. A test
asserts the pure resolver holds nothing between calls.

Services continue to receive `workspaceId` explicitly as a parameter — the
Stage 6 and 7 signatures are unchanged, and nothing reads context from a global.

---

## Authentication Interaction

Context is never meaningful without authentication. The chain is
`protect → requireWorkspaceContext → authorize`, and the 401 guard enforces it
even if a future route is wired wrongly.

An anonymous request carrying a perfectly valid header gets **401**, not a
context.

---

## Authorization Interaction

**Nothing changed in the engine.** Context resolution and authorization stay
separate, which is the entire security thesis of the stage.

The mandatory §23 test: a user who belongs only to workspace A sends
`X-Workspace-Id: <workspace B>`. The context resolves B successfully — and the
protected operation is then refused with `NOT_A_MEMBER` (404). Resolving a
workspace and being allowed to act in it are different questions.

A second test covers the subtler case: A's owner *is* a member of B, so
`members.view` succeeds there — while `workspace.delete` in B is still refused,
because owner authority does not travel.

---

## Route Interaction

Stage 6 and 7 routes are untouched and continue to take the workspace from
`/workspaces/:workspaceId/...`.

### Route parameter vs header

When a route carries `:workspaceId` and a header is also present, they **must
agree**:

| Route | Header | Result |
| --- | --- | --- |
| present | absent | Route wins, `source: 'route'` |
| absent | present | Header used, `source: 'header'` |
| present | present, same | Accepted |
| present | present, **different** | **400** |

Rejected rather than resolved by preference. Picking a winner would let a caller
aim a request at one workspace in the URL and another in the header, then rely
on which the server happens to prefer — the confused-deputy setup §17 warns
about.

### The body is never consulted

A `workspaceId` in a request body is ignored entirely: not a fallback when the
header is missing, and not an override when it is present. Tested both ways.

---

## Files Created

| File | Purpose |
| --- | --- |
| `server/middleware/workspaceContext.js` | The middleware and its pure resolver |
| `server/tests/workspace.context.test.js` | 31 tests |

## Files Modified

| File | Why |
| --- | --- |
| `AUTHORIZATION-POLICY.md` | Documented the header per §26 |

No application code was modified. `app.js` is untouched by this stage.

---

## Security Tests

| Test | Asserts |
| --- | --- |
| **Header ≠ authorization** | Context resolves workspace B for a non-member; operation refused `NOT_A_MEMBER` |
| Membership does not confer owner authority | Member of B may `members.view`; `workspace.delete` still denied |
| Stranger with a valid header | 404, not access |
| Anonymous with a valid header | 401 |
| Middleware without `protect` | 401 — fails closed |
| Malformed id | 400 with no `CastError`, `mongo` or `BSON` text in the response |
| Contradictory route + header | 400, no preference applied |
| Body `workspaceId` | Ignored; cannot override or substitute |

### Mutation check

I disabled the route/header conflict guard and re-ran: **2 tests failed**. The
suite genuinely exercises the confused-deputy protection rather than passing
vacuously. Restored and re-verified at 31/31.

---

## Concurrency Tests

- **Nine simultaneous requests** across three workspaces in interleaved order;
  every response carries its own workspace and no other.
- **Mixed presence**: one request with a header and one without, fired together.
  The first resolves; the second returns a clean 400 rather than inheriting the
  first's workspace.
- **Pure resolver**: consecutive calls with and without a header produce
  independent results, confirming no retained state.

---

## Regression Results

```
Server:  399 / 399   (9 suites)
  pre-existing:   55
  RBAC models:    47
  migration:      46
  authorization:  79
  members:        73
  roles:          68
  context:        31   new
Client:   65 / 65
Lint:     clean
Build:    succeeds
```

Two tests specifically confirm existing endpoints are unaffected: they still
work with no header, and they ignore a stray — or even deliberately
contradictory — header, because they do not opt into the middleware.

No existing test was removed or weakened.

---

## Known Limitations

- **No route uses the middleware yet.** By design; it is infrastructure for the
  integration stages.
- **Context does not verify the workspace exists.** A well-formed id for a
  non-existent workspace resolves, and authorization returns 404 a moment later.
  This is the smallest-responsibility choice §9 asked for, and it avoids a
  database round trip on every request.
- **No route/header conflict can arise today**, since no route both requires
  context and carries `:workspaceId`. The rule is implemented and tested ahead
  of the situation.
- **Stage 6/7 routes do not populate `req.workspaceContext`.** They read the
  path parameter directly. Opting them in would be harmless but would change
  working API behaviour for no benefit this stage.
- **No async-local storage.** Deliberate — explicit parameter passing is
  simpler to audit than implicit context, and §14 asked for it.

---

## Stage 8.2 Readiness

**Ready.** The next stage has:

- `requireWorkspaceContext` to mount on routes as they become workspace-aware
- `getWorkspaceId(req)` as the single accessor
- A documented and tested policy for route-vs-header conflicts
- Proof that the header confers nothing on its own

Two prerequisites still stand, unchanged from Stage 5 and 7:

1. **The migration must run before task routes are wired**, or every existing
   task — all with `workspace: null` — is correctly refused.
2. Task routes, `Task.workspace` requiredness and Task indexes remain untouched.

---

## Final Assessment

The header now identifies a workspace and nothing more. Authentication is
required before context is built, the context carries only an id, no database is
touched to produce it, and no membership is consulted — so there is no path by
which supplying a header becomes a way in.

The one design decision worth restating: contradictory workspace identifiers are
**rejected**, never reconciled. That is the difference between a request that is
unambiguous and one whose meaning depends on an implementation detail.

```
No production migration was executed.
No task routes were modified.
No frontend changes were made.
No Assignee changes were made.
No authorization engine changes were made.
```

**Stage 8.1 complete. Stopping — not beginning Stage 8.2.**
