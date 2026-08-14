# Pro-Manage — Modernisation & Hardening Report

An 18-stage pass over the MERN task manager, turning a desktop-only portfolio
project into a responsive, accessible, security-hardened application — without
rewriting the architecture that already worked.

| | |
| --- | --- |
| **Tests** | 100 passing (55 server · 45 client) |
| **Server audit** | 0 vulnerabilities |
| **Main client bundle** | 57.1 kB gzip (down from 68.3 kB) |
| **Breakpoints** | 4, covering 320px → 1440px+ |
| **Build & lint** | Clean, 0 warnings |

Architecture preserved throughout: no Redux, no TypeScript migration, no rewrite.

---

## Contents

- [What this pass set out to fix](#what-this-pass-set-out-to-fix)
- [The design system](#the-design-system)
- [Responsive rebuild](#responsive-rebuild)
- [Component library](#component-library)
- [Interface and interaction](#interface-and-interaction)
- [Accessibility](#accessibility)
- [Backend and security](#backend-and-security)
- [Dependencies](#dependencies)
- [Verification](#verification)
- [Not verified](#not-verified)

---

## What this pass set out to fix

The opening audit found a well-organised codebase with a thin, brittle surface.
Three problems mattered more than the rest.

**It crashed.** A task with no assignee reached `task.assignee.substring()` and
blanked the board. The public share page had the same fault, so a link to an
unassigned task rendered nothing at all.

**It leaked.** Registration returned the full user document — bcrypt hash
included. Error responses carried stack traces and filesystem paths regardless
of environment.

**It was desktop-only.** A fixed 250px sidebar, a 400px minimum column width, a
700px task form and a 500px modal meant a phone got a ~1900px board pushed
sideways through a 375px viewport.

Underneath those sat quieter faults: optimistic updates with no rollback, so the
board kept showing states the server had rejected; success toasts that fired
before the request resolved; no central handling for an expired session, so one
dead token produced a toast per in-flight request.

---

## The design system

Before this pass, styling lived in the modules themselves — a dozen greys, five
card radii, colour picked per component. Everything now resolves through one
token layer in `client/src/index.css`, and the visual identity the project
already had was kept rather than replaced.

### Brand and priority colour

The teal stayed. The priority hues stayed in spirit but not in value: all three
failed WCAG AA as text on white, so each was darkened to the nearest shade that
passes while still reading as the same colour.

| Token | Was | Now | Why |
| --- | --- | --- | --- |
| `--priority-high` | `#ff2473` | `#e01a5f` | Reaches AA on white |
| `--priority-moderate` | `#18b0ff` | `#0d84c9` | Reaches AA on white |
| `--priority-low` | `#63c05b` | `#3f8f38` | Reaches AA on white |
| `--text-muted` | `#767575` @ 40% | `#5b6b78` | 5.4:1 — the old value was nowhere near AA |

Brand ramp: `--primary #17a2b8`, `--primary-hover #148fa3`,
`--primary-active #117d8e`, `--primary-soft #e7f6f8`, `--primary-focus #1baec5`.

Colour also stopped being the sole carrier of meaning. A priority dot now sits
beside a text label, and the "move task" controls are named buttons rather than
coloured pills.

### Spacing, radius, elevation

- **Spacing** runs on a 4px base — `--space-1` through `--space-7`
  (0.25rem → 3rem).
- **Radius** collapsed to five steps: 6px, 10px, 16px, 20px, and a pill (999px).
- **Elevation** is three shadows only (`sm`, `md`, `lg`), all cool-tinted from
  the same `rgb(16 24 40 / …)` base so stacked surfaces read as one material.
- **Motion** is two durations — 120ms for state changes, 200ms for the drawer.
- **Layering** is a named z-index scale rather than escalating numbers:
  dropdown 100, sticky 200, drawer 300, modal 400, toast 500.

### Type scale

Poppins and Inter stayed. Every step became fluid, so text is readable at 320px
and comfortable past 1440px without a single font-size media query.

| Token | Range | Used for |
| --- | --- | --- |
| `--text-xs` | 0.6875 → 0.75rem | Checklist counts, meta |
| `--text-sm` | 0.8125 → 0.875rem | Buttons, badges, labels |
| `--text-base` | 0.875 → 1rem | Body copy |
| `--text-lg` | 1 → 1.125rem | Card titles |
| `--text-xl` | 1.125 → 1.375rem | Column headings |
| `--text-2xl` | 1.375 → 1.75rem | Section titles |
| `--text-3xl` | 1.625 → 2.25rem | Page titles |

```css
/* e.g. */
--text-base: clamp(0.875rem, 0.85rem + 0.13vw, 1rem);
```

---

## Responsive rebuild

Four intentional breakpoints, not one per device. Everything between them is
handled by fluid sizing — `clamp()`, `minmax()`, `min()` — rather than more
media queries.

| Width | Name | Board | Navigation |
| --- | --- | --- | --- |
| `< 640px` | Mobile | Status tabs, 1 column | Top app bar + drawer |
| `640–1023px` | Tablet | 2 columns | Top app bar + drawer |
| `1024–1279px` | Desktop | 4 columns | Persistent sidebar |
| `≥ 1280px` | Large | 4 columns, capped at 100rem | Persistent sidebar |

### Navigation

The 250px sidebar survives, but only from 1024px up, where it becomes a sticky
full-height rail. Below that it converts to a drawer at `min(17rem, 82vw)`
behind a top app bar, with a backdrop and an `aria-expanded` toggle. The drawer
closes itself on navigation — the classic bug is leaving it open over the page
you just moved to.

### The board

The old `min-width: 400px` per column is what forced the sideways scroll;
columns are now `repeat(4, minmax(0, 1fr))`, so four fit inside 1024px. On
mobile the four statuses become a `role="tablist"` strip with live counts, and
only the selected panel renders — no horizontal board on a phone.

### Modals

Fixed 700px and 500px dialogs became three responsive sizes, capped at
`calc(100dvh - 2rem)` with the body scrolling inside:

```css
.sm { max-width: min(24rem, calc(100vw - var(--space-6))); }
.md { max-width: min(34rem, calc(100vw - var(--space-6))); }
.lg { max-width: min(46rem, calc(100vw - var(--space-6))); }
```

Under 640px a dialog re-anchors to the bottom of the screen as a sheet, rounded
on the top corners only, at `92dvh`, with `env(safe-area-inset-bottom)` padding
so the actions clear the home indicator.

Every `100vh` became `100dvh`, so mobile browser chrome no longer clips the
layout.

---

## Component library

Primitives that existed were improved in place; the gaps were filled. Nothing
was duplicated — the old bespoke Tooltip was removed rather than run alongside a
second system.

| Component | Note |
| --- | --- |
| `Text` | Gained `as`. It always rendered a `<p>`, so every heading was a paragraph that merely looked large — no document outline existed |
| `Button` | Defaults to `type="button"`, so a stray control can no longer submit its form. Gained `loading` |
| `IconButton` **(new)** | `label` is required, not optional. Replaces the clickable bare `<svg>`s that had no accessible name |
| `Badge` | Renders a real `<button>` when interactive, with an explicit name: *Move "Draft report" to Done* |
| `Modal` | Portalled, `role="dialog"`, focus trap, focus restoration, Escape, scroll lock |
| `Avatar` **(new)** | Treats "no assignee" as a first-class state — a labelled placeholder, not a crash |
| `PageHeader` **(new)** | One real `<h1>` per screen, with consistent title / description / actions rhythm |
| `Skeleton` **(new)** | Card, column and analytics variants, shaped like the content they replace so nothing jumps on load |
| `EmptyState` **(new)** | Always answers three questions: what happened, why it's empty, what to do next |
| `ErrorState` **(new)** | `role="alert"` with a retry action, and offline-aware copy |
| `OfflineBanner` **(new)** | A banner, not a toast — the condition lasts until it's fixed. Removes itself on reconnect |

---

## Interface and interaction

### Board

Gained a search across title, assignee and priority, a priority filter, a
date-range filter and live task counts. Filtering happens once in the parent and
the result is grouped once — the board used to run four full scans of the task
array to render four columns.

An empty board and an over-filtered board are different situations and now say
different things:

```
No tasks yet
Create your first task and start organising your work.
[Create task]
```

```
No matching tasks
Try a different search term or clear your filters.
[Clear filters]
```

### Drag and drop

Added with `@dnd-kit/core`, on a strict condition: it enhances, it never becomes
the only way to move a task. The per-card status buttons remain, and a test
asserts they do.

- Only a grip handle carries the drag listeners, so the card menu, checklist and
  badges stay clickable.
- Mouse needs 8px of travel; touch needs a 220ms hold — otherwise the sensors
  eat ordinary taps and column scrolling.
- Keyboard dragging works, with spoken announcements naming the column on
  pick-up, hover and drop.
- The dragged card stays as a dimmed placeholder while a light preview follows
  the pointer.
- The handle is hidden below 640px, where one column is visible and a grip would
  be a false affordance.
- The move is optimistic and rolls back if the server refuses it.

### Loading, error, empty

Bare `Loading…` text was replaced with content-shaped skeletons. Every
data-backed screen now has all four states — loading, empty, error with retry,
and offline — where previously a failed analytics request rendered silently as
nothing.

### Optimistic updates

The provider snapshots the list, applies the change, sends the request, and
restores the exact previous state on failure:

```
capture previous state
  → apply optimistic update
  → send request
      success → keep new state
      failure → restore previous state + surface the error
```

Nothing stays on screen that the server rejected. Toasts fire only after a
confirmed result, and a session-expiry error is flagged so screens suppress
their own message while the central handler shows one.

### Destructive actions

Deleting names the task, styles the confirm as destructive, disables both
buttons while the request is in flight, and only claims success once the API
confirms it. Previously a failed delete still closed the dialog and reported
success.

```
Delete "Prepare project report"?
This action cannot be undone.
[Cancel] [Delete task]
```

### Analytics

Four summary tiles over two breakdown panels. Each row carries a proportion bar
rather than a charting library for what amounts to eight numbers — and each bar
is labelled for screen readers with its real figures (*"3 of 12 tasks (25%)"*).

Behind it, counting moved from loading whole collections into Node to a single
MongoDB aggregation, which also fixed self-assigned tasks being counted twice
and completed tasks being reported as overdue.

### Settings

Split into `Profile` and `Security` fieldsets, so the session-ending actions sit
apart from ordinary edits. The logout that follows a password or email change no
longer reads stale React state.

### Public share page

Mobile-first, readable without authentication, and explicitly marked read-only
with an eye icon rather than leaving it implied. Checklist boxes are both
`disabled` and `readOnly`; they were previously controlled inputs with no
handler, which React warns about and which invited clicks that did nothing.

---

## Accessibility

Targeting WCAG 2.2 AA. The starting point had no semantic headings, no form
labels, clickable `<div>`s, and hover-only tooltips.

| Area | Before | Now |
| --- | --- | --- |
| Headings | Every heading was a styled `<p>` | Real `h1`–`h4`, one `h1` per screen |
| Landmarks | Nested `div`s | `header`, `nav`, `main`, labelled `section`s |
| Icon controls | Bare clickable `<svg>` | `IconButton` with a required label |
| Focus | Outlines removed globally | `:focus-visible` ring, never suppressed |
| Dialogs | Plain divs, no role or trap | Role, name, trap, restore, Escape |
| Active nav | Colour only | `aria-current="page"` |
| Offline | Nothing | `role="status"`, `aria-live="polite"` |
| Errors | Silent | `role="alert"` with retry |
| Motion | Unconditional | `prefers-reduced-motion` honoured |
| Tooltips | Hover-only, two systems | One removed; labels carry the meaning |

---

## Backend and security

### Fixed

- Registration returned the bcrypt hash — it now returns id, name, email and a
  token.
- The global error handler could itself throw: a missing `AppError` import, and
  `process.env.NODE_ENV.trim()` on an undefined value.
- A malformed ObjectId produced a 500; it now returns clean JSON with a 400.
- Stack traces are development-only.
- Password hashing skips unchanged passwords via `isModified`.

### Added

- Helmet, a CORS allowlist driven by `CLIENT_URL`, a 100kb body cap, and rate
  limiting on the auth routes returning a clean 429.
- Explicit field allowlists on every update endpoint — no request body is spread
  into a database write.
- Validation for ids, query parameters, date ranges, priorities, statuses and
  checklists, rather than relying on Mongoose casting.
- `express-mongo-sanitize`, so `{"email": {"$gt": ""}}` cannot become an
  operator query.
- Ownership scoping on every task query. Reaching another user's task returns
  404, not 403 — the API doesn't confirm it exists.
- Central 401 handling that clears the session once, shows one message, and
  de-duplicates a burst of parallel failures.

### Data model

The three-way `assignee` / `assignedTo` / `shared` representation was collapsed
to one authoritative relationship with the rest derived, migrated by a script
that preserves existing records. Indexes were added on the actual query paths —
`createdBy`, `assignedTo`, `createdAt` — and timestamps are server-generated
rather than trusted from the client.

The date filter was also redesigned. It previously hid old unfinished work,
which reads as data loss; the range now applies only to *completed* tasks, so
open work is always visible.

---

## Dependencies

| Change | Package | Reason |
| --- | --- | --- |
| Added | `@dnd-kit/core` 6.3.1 | Keyboard dragging, touch-delay sensors and screen-reader announcements — none of which native HTML5 drag gives you |
| Removed | `uuid` | Only generated throwaway React keys; `crypto.randomUUID()` is native |
| Removed | `react-loader-spinner` | Pulled in styled-components + postcss for one spinner on one screen |
| Upgraded | `bcrypt` 5 → 6 | Clears the `node-pre-gyp` → `tar` advisory chain |
| Patched | `jws`, `body-parser` | `jws` improperly verified HMAC signatures — directly under `jsonwebtoken` |

Net effect: the main client chunk fell from **68.3 kB to 57.1 kB gzipped**
despite gaining a drag-and-drop library, and the server audit went to zero.

---

## Verification

| Check | Result |
| --- | --- |
| Server tests (Jest + Supertest, in-memory Mongo) | 55 / 55 |
| Client tests (Vitest + Testing Library) | 45 / 45 |
| ESLint `--max-warnings 0` | Clean |
| Production build | Succeeds |
| Server `npm audit` | 0 vulnerabilities |
| Client `npm audit` (runtime) | 2 moderate — see below |
| Live API smoke test | Passing |

Backend coverage includes the credential-leak regressions, JWT handling, IDOR
attempts across users, mass assignment, NoSQL injection, rate limiting and
analytics correctness. Frontend coverage includes the API client's session
handling, optimistic rollback, modal focus management, unassigned-task
rendering, and the guarantee that drag-and-drop did not displace the accessible
fallback.

```bash
cd server && npm test     # Jest + Supertest
cd client && npm test     # Vitest + React Testing Library
```

---

## Not verified

> **No manual browser QA.** Responsive behaviour, colour contrast and real drag
> gestures are verified by code inspection and jsdom tests only. jsdom reports
> zero-size elements, so an actual cross-column drop is not covered by an
> automated test.

> **Two moderate client advisories remain**, both in React Router 6. One is
> SSR-only and this is a client-rendered SPA; the other is an open redirect via
> `<Link>`, and every navigation target in the app is a static literal. Clearing
> them needs a React Router 6 → 7 migration, deliberately left as separate work
> rather than folded in untested.

> **Local database workaround.** One development machine's Node DNS resolver
> defaults to a dead `127.0.0.1`, breaking the SRV lookup that `mongodb+srv://`
> requires. That machine's local `.env` uses Atlas's explicit-host connection
> string instead. Nothing in the repository changed.

---

## Manual QA checklist

Before deploying, walk these flows in a real browser at 375px, 768px and 1280px:

- [ ] Register → lands authenticated, no hash in the response
- [ ] Log in, log out, and return to a protected route while signed out
- [ ] Let a token expire → one message, one redirect
- [ ] Create, edit and delete a task; confirm a failed delete does not claim success
- [ ] Move a task by status button, by mouse drag, and by keyboard drag
- [ ] Tick a checklist item and reload to confirm it persisted
- [ ] Assign a task, then open its public link in a private window
- [ ] Open a share link for an *unassigned* task
- [ ] Analytics: loading, populated, and with the network throttled to failure
- [ ] Change password → confirm the session ends cleanly
- [ ] Go offline mid-session → banner appears, then clears on reconnect
- [ ] Tab through the board and both modals without losing focus

---

*Pro-Manage — React 18 · Vite · React Router · Context + use-immer · CSS Modules
· Express · MongoDB · JWT.*
