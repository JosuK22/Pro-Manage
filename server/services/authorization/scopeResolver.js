/**
 * Scope logic.
 *
 * Entirely pure — no database, no models, no Mongoose documents beyond reading
 * plain fields. That is deliberate: these are the rules most worth auditing,
 * and they should be readable and testable without standing anything up.
 *
 * The hierarchy is `own ⊆ assigned ⊆ workspace`, where `assigned` includes what
 * the actor created. A task that vanished from view the moment its creator
 * saved it would be absurd, and the inclusion is what makes the three
 * comparable rather than merely different.
 */

const { SCOPES, SCOPE_RANK, scopeCovers, isValidScopeFor, defaultScopeFor } = require('../../config/permissions');

/** Compare two ObjectId-ish values without caring which form they arrived in. */
const sameId = (a, b) => {
  if (!a || !b) return false;
  return String(a._id ?? a) === String(b._id ?? b);
};

/**
 * Does a granted scope satisfy a required one?
 *
 * Ordering comes from the catalogue's SCOPE_RANK rather than string comparison,
 * so adding a scope later is a change in one table instead of a hunt through
 * conditionals.
 */
const isScopeSatisfied = (grantedScope, requiredScope) =>
  scopeCovers(grantedScope, requiredScope);

/**
 * Work out which scope a request is actually asking for.
 *
 * An omitted scope resolves to the widest the permission supports — which is
 * the *strictest* thing to ask for, so omitting it can never accidentally
 * weaken a check.
 *
 * @returns {{ ok: true, scope: string } | { ok: false, reason: string }}
 */
const resolveRequestedScope = (permissionKey, requestedScope) => {
  if (requestedScope === undefined || requestedScope === null) {
    const fallback = defaultScopeFor(permissionKey);
    return fallback
      ? { ok: true, scope: fallback }
      : { ok: false, reason: 'unknown permission' };
  }

  // A scope the permission does not support is a malformed request, not a
  // narrower one. Silently widening or reinterpreting it would turn a caller's
  // mistake into a policy.
  if (!isValidScopeFor(permissionKey, requestedScope)) {
    return { ok: false, reason: `scope '${requestedScope}' is not supported` };
  }

  return { ok: true, scope: requestedScope };
};

/**
 * Is this task inside the granted scope, for this actor, in this workspace?
 *
 * Field names are the Task model's own: `workspace`, `createdBy`, `assignedTo`.
 *
 * @returns {{ ok: true } | { ok: false, reason: 'workspace' | 'scope' }}
 */
const isTaskWithinScope = ({ task, userId, workspaceId, grantedScope }) => {
  // Tenancy first, always. A resource from another workspace is out of bounds
  // no matter how broad the actor's permission is in *this* one — otherwise
  // `tasks.view: workspace` would become a key to every workspace.
  if (!task || !task.workspace || !sameId(task.workspace, workspaceId)) {
    return { ok: false, reason: 'workspace' };
  }

  if (grantedScope === SCOPES.WORKSPACE) return { ok: true };

  const isCreator = sameId(task.createdBy, userId);

  if (grantedScope === SCOPES.OWN) {
    return isCreator ? { ok: true } : { ok: false, reason: 'scope' };
  }

  if (grantedScope === SCOPES.ASSIGNED) {
    const isAssignee = sameId(task.assignedTo, userId);
    return isCreator || isAssignee ? { ok: true } : { ok: false, reason: 'scope' };
  }

  // An unrecognised scope is not a licence to continue.
  return { ok: false, reason: 'scope' };
};

/**
 * The Mongo filter fragment that narrows a query to a granted scope.
 *
 * Lists must never fetch-then-filter: the database should return only what the
 * actor may see. Always merged with `{ workspace }` by the caller.
 */
const taskScopeFilter = ({ userId, grantedScope }) => {
  if (grantedScope === SCOPES.WORKSPACE) return {};
  if (grantedScope === SCOPES.OWN) return { createdBy: userId };
  if (grantedScope === SCOPES.ASSIGNED) {
    return { $or: [{ createdBy: userId }, { assignedTo: userId }] };
  }

  // Fail closed: a filter that matches nothing beats a filter that matches all.
  return { _id: null };
};

/** Dispatch table, so new resource types are an entry rather than a branch. */
const RESOURCE_CHECKS = {
  task: isTaskWithinScope,
};

/** Infer the resource type from the permission's category prefix. */
const resourceTypeFor = (permissionKey) => {
  const [category] = String(permissionKey).split('.');
  return category === 'tasks' ? 'task' : null;
};

const isResourceWithinScope = ({ resourceType, resource, userId, workspaceId, grantedScope }) => {
  const check = RESOURCE_CHECKS[resourceType];

  // No checker means we cannot prove the resource is in bounds, so we do not
  // pretend it is.
  if (!check) return { ok: false, reason: 'workspace' };

  return check({ task: resource, resource, userId, workspaceId, grantedScope });
};

module.exports = {
  SCOPES,
  SCOPE_RANK,
  sameId,
  isScopeSatisfied,
  resolveRequestedScope,
  isTaskWithinScope,
  taskScopeFilter,
  isResourceWithinScope,
  resourceTypeFor,
};
