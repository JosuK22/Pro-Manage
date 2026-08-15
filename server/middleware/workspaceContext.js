const mongoose = require('mongoose');

const AppError = require('../utils/AppError');

/**
 * Workspace request context.
 *
 * Answers exactly one question: **which workspace is this request about?**
 *
 * It does not answer whether the caller may act there. A header is a claim, not
 * a credential — anyone can send `X-Workspace-Id: <someone else's workspace>`.
 * Membership, role and permission remain entirely the authorization engine's
 * business, and this middleware deliberately performs no membership lookup so
 * that a second, weaker access path cannot grow here by accident.
 *
 * It also performs no database query at all. Parsing an ObjectId does not
 * require the document, and loading a Workspace on every request to discover
 * something authorization is about to load anyway would be waste.
 *
 * Request-local by construction: everything hangs off `req`. There is no
 * module-level mutable state, so one request's workspace can never surface in
 * another's.
 */

/** The canonical header. HTTP header names are case-insensitive. */
const WORKSPACE_HEADER = 'X-Workspace-Id';

/** Where a request's workspace came from, kept for diagnostics. */
const SOURCE = {
  ROUTE: 'route',
  HEADER: 'header',
};

/**
 * Read the header.
 *
 * `req.get()` is case-insensitive, so `X-Workspace-Id`, `x-workspace-id` and
 * `X-WORKSPACE-ID` all resolve. Whitespace is trimmed; an empty or
 * whitespace-only value counts as absent rather than as a malformed id, since
 * the caller plainly sent nothing.
 */
const readHeader = (req) => {
  const raw = typeof req.get === 'function' ? req.get(WORKSPACE_HEADER) : undefined;
  if (typeof raw !== 'string') return null;

  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/** Read `:workspaceId` when the route carries one. */
const readRouteParam = (req) => {
  const raw = req.params?.workspaceId;
  if (typeof raw !== 'string') return null;

  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * Resolve the workspace a request is operating in.
 *
 * @returns {{ ok: true, workspaceId: string, source: string }
 *          | { ok: false, error: AppError }}
 */
const resolveWorkspaceContext = (req) => {
  const fromRoute = readRouteParam(req);
  const fromHeader = readHeader(req);

  // Two sources that disagree are never silently reconciled. Picking one would
  // mean a caller could aim a request at workspace A in the URL and workspace B
  // in the header and rely on the server's preference — the classic
  // confused-deputy setup.
  if (fromRoute && fromHeader && fromRoute !== fromHeader) {
    return {
      ok: false,
      error: new AppError(
        `The workspace in the URL does not match the ${WORKSPACE_HEADER} header.`,
        400
      ),
    };
  }

  const workspaceId = fromRoute ?? fromHeader;

  if (!workspaceId) {
    return {
      ok: false,
      error: new AppError(
        `This request needs a workspace. Send the ${WORKSPACE_HEADER} header.`,
        400
      ),
    };
  }

  // Validated before it can reach a query. Handing a malformed value to
  // Mongoose would surface as a CastError from somewhere deep in a controller
  // instead of a clean 400 here.
  if (!mongoose.Types.ObjectId.isValid(workspaceId)) {
    return {
      ok: false,
      error: new AppError(`'${workspaceId}' is not a valid workspace id.`, 400),
    };
  }

  return {
    ok: true,
    workspaceId,
    source: fromRoute ? SOURCE.ROUTE : SOURCE.HEADER,
  };
};

/**
 * Require workspace context on a route.
 *
 * Opt-in: routes that need a workspace mount this, and every other route is
 * untouched. Mounting it globally would break every existing endpoint that has
 * no reason to know about workspaces.
 *
 * Must be mounted **after** `protect`. The guard below makes a wiring mistake
 * fail closed rather than quietly producing a context for an anonymous caller.
 */
const requireWorkspaceContext = (req, res, next) => {
  if (!req.user) {
    return next(new AppError('Please log in to access this resource.', 401));
  }

  const resolved = resolveWorkspaceContext(req);

  if (!resolved.ok) return next(resolved.error);

  // Frozen so a later handler cannot quietly retarget the request mid-flight.
  req.workspaceContext = Object.freeze({
    workspaceId: resolved.workspaceId,
    source: resolved.source,
  });

  next();
};

/**
 * The workspace a request is operating in.
 *
 * The single accessor, so no caller has to remember the shape — and so a body
 * field named `workspaceId` can never be mistaken for the real thing. The body
 * is never consulted here, by design.
 */
const getWorkspaceId = (req) => req.workspaceContext?.workspaceId ?? null;

module.exports = {
  WORKSPACE_HEADER,
  SOURCE,
  readHeader,
  resolveWorkspaceContext,
  requireWorkspaceContext,
  getWorkspaceId,
};
