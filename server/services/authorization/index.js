/**
 * The authorization engine's public surface.
 *
 * Later stages should import from here rather than reaching into the
 * individual modules, so the internal split between DB resolution and pure
 * policy stays free to change.
 */

const service = require('./authorizationService');
const errors = require('./authorizationErrors');
const scope = require('./scopeResolver');
const permissions = require('./permissionResolver');

module.exports = {
  // Decisions
  check: service.check,
  authorize: service.authorize,
  resolveContext: service.resolveContext,
  scopedFilter: service.scopedFilter,
  checkRoleAssignment: service.checkRoleAssignment,
  checkPermissionGrant: service.checkPermissionGrant,

  // Errors
  DENIAL: errors.DENIAL,
  AuthorizationError: errors.AuthorizationError,

  // Pure policy helpers, exported for auditing and unit tests
  isScopeSatisfied: scope.isScopeSatisfied,
  isTaskWithinScope: scope.isTaskWithinScope,
  taskScopeFilter: scope.taskScopeFilter,
  resolveRequestedScope: scope.resolveRequestedScope,
  effectivePermissions: permissions.effectivePermissions,
  canAssignRole: permissions.canAssignRole,
  canGrantPermissions: permissions.canGrantPermissions,
  OWNER_ONLY_PERMISSIONS: permissions.OWNER_ONLY_PERMISSIONS,
};
