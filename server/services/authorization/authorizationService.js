/**
 * The authorization engine.
 *
 * The single source of truth for "may this user do this?". Everything else in
 * the application should ask this rather than reimplementing membership, role
 * and scope checks — that duplication is how tenant isolation gets holes.
 *
 * The invariant the whole design rests on:
 *
 *   Authorization is always evaluated in the context of ONE workspace, using
 *   THAT workspace's membership and THAT workspace's role.
 *
 * A user who is an Owner in workspace A gets nothing from that fact in
 * workspace B. Permissions never travel.
 *
 * This module owns the database resolution. The rules themselves live in
 * `scopeResolver` and `permissionResolver`, which are pure.
 */

const mongoose = require('mongoose');

const Workspace = require('../../model/workspaceModel');
const Role = require('../../model/roleModel');
const WorkspaceMembership = require('../../model/workspaceMembershipModel');
const { SYSTEM_ROLES } = require('../../model/roleModel');
const { isValidPermissionKey } = require('../../config/permissions');

const { DENIAL, AuthorizationError, denial } = require('./authorizationErrors');
const {
  effectivePermissions,
  actorRank,
  canAssignRole,
  canGrantPermissions,
  OWNER_ONLY_PERMISSIONS,
} = require('./permissionResolver');
const {
  sameId,
  isScopeSatisfied,
  resolveRequestedScope,
  isResourceWithinScope,
  resourceTypeFor,
  taskScopeFilter,
} = require('./scopeResolver');

const isUsableId = (value) =>
  Boolean(value) && mongoose.Types.ObjectId.isValid(String(value._id ?? value));

/**
 * Establish who the actor is inside one workspace.
 *
 * Returns a context, or a structured denial. Never throws for an ordinary
 * "no" — callers that want an exception use `authorize()`.
 *
 * Three queries: workspace, membership, role. Nothing is cached; a permission
 * or membership change is visible to the very next call, which is the point.
 */
const resolveContext = async ({ userId, workspaceId }) => {
  if (!isUsableId(userId)) {
    return denial(DENIAL.UNAUTHENTICATED, 'No authenticated user was supplied.');
  }

  if (!isUsableId(workspaceId)) {
    return denial(DENIAL.WORKSPACE_NOT_FOUND, 'No usable workspace id was supplied.');
  }

  const workspace = await Workspace.findById(workspaceId);

  if (!workspace) {
    return denial(DENIAL.WORKSPACE_NOT_FOUND, 'Workspace does not exist.');
  }

  // Scoped by workspace *and* user. Resolving a membership by id alone would
  // let a membership from another workspace become an authorization path.
  const membership = await WorkspaceMembership.findOne({
    workspace: workspace._id,
    user: userId,
  });

  if (!membership) {
    return denial(DENIAL.NOT_A_MEMBER, 'User has no membership in this workspace.');
  }

  if (membership.status !== 'active') {
    return denial(
      DENIAL.MEMBERSHIP_INACTIVE,
      `Membership status is '${membership.status}'.`
    );
  }

  const role = await Role.findById(membership.role);

  if (!role) {
    return denial(DENIAL.ROLE_MISSING, 'Membership points at a role that does not exist.');
  }

  // Re-checked here rather than trusted, because a raw `updateOne` bypasses the
  // document middleware that normally enforces it. Never repaired on the fly —
  // a mismatch is an integrity violation, and quietly fixing it during an
  // authorization check would hide a security event.
  if (!sameId(role.workspace, workspace._id)) {
    return denial(
      DENIAL.ROLE_INTEGRITY_VIOLATION,
      'Membership role belongs to a different workspace.',
      { roleId: String(role._id), roleWorkspace: String(role.workspace) }
    );
  }

  // `Workspace.owner` is authoritative — not the Owner role.
  const isOwner = sameId(workspace.owner, userId);

  // Holding the Owner role without being the recorded owner means the two
  // sources disagree. The membership is not trustworthy, so it is refused
  // outright rather than being honoured at some reduced level.
  if (!isOwner && role.systemKey === SYSTEM_ROLES.OWNER) {
    return denial(
      DENIAL.OWNERSHIP_INTEGRITY_CONFLICT,
      'Membership holds the Owner role but is not the recorded workspace owner.',
      { workspaceOwner: String(workspace.owner) }
    );
  }

  return {
    allowed: true,
    workspace,
    membership,
    role,
    isOwner,
    permissions: effectivePermissions({ role, isOwner }),
    rank: actorRank({ role, isOwner }),
  };
};

/** Shape the success payload once, so every path returns the same thing. */
const grant = ({ userId, context, permission, scope }) => ({
  allowed: true,
  userId: String(userId),
  workspaceId: String(context.workspace._id),
  membershipId: String(context.membership._id),
  roleId: String(context.role._id),
  roleKey: context.role.systemKey ?? null,
  roleName: context.role.name,
  isOwner: context.isOwner,
  permission,
  scope,
});

/**
 * The main entry point. Returns a structured result; never throws for a "no".
 *
 * @param {object}  input
 * @param {*}       input.userId
 * @param {*}       input.workspaceId
 * @param {string}  input.permission     catalogue key
 * @param {string} [input.scope]         required scope; defaults to the widest
 *                                       the permission supports
 * @param {object} [input.resource]      when given, the decision is about this
 *                                       specific document
 * @param {string} [input.resourceType]  inferred from the permission if omitted
 */
const check = async ({ userId, workspaceId, permission, scope, resource, resourceType }) => {
  // Unknown permissions fail closed. Authorization never invents capabilities.
  if (!isValidPermissionKey(permission)) {
    return denial(DENIAL.INVALID_PERMISSION, `'${permission}' is not a known permission.`);
  }

  const context = await resolveContext({ userId, workspaceId });
  if (!context.allowed) return context;

  const grantedScope = context.permissions.get(permission);

  if (grantedScope === undefined) {
    return denial(
      DENIAL.PERMISSION_MISSING,
      `Role '${context.role.name}' does not grant '${permission}'.`
    );
  }

  // Ownership as a *restriction*: some operations require being the recorded
  // owner in addition to holding the permission.
  if (OWNER_ONLY_PERMISSIONS.has(permission) && !context.isOwner) {
    return denial(
      DENIAL.OWNER_ONLY,
      `'${permission}' may only be performed by the workspace owner.`
    );
  }

  // --- Resource-level decision -------------------------------------------
  if (resource !== undefined && resource !== null) {
    const type = resourceType ?? resourceTypeFor(permission);

    const verdict = isResourceWithinScope({
      resourceType: type,
      resource,
      userId,
      workspaceId: context.workspace._id,
      grantedScope,
    });

    if (!verdict.ok) {
      return verdict.reason === 'workspace'
        ? denial(
            DENIAL.RESOURCE_OUTSIDE_WORKSPACE,
            'Resource does not belong to the requested workspace.'
          )
        : denial(
            DENIAL.RESOURCE_OUTSIDE_SCOPE,
            `Resource is outside the actor's '${grantedScope}' scope.`
          );
    }

    return grant({ userId, context, permission, scope: grantedScope });
  }

  // A resource was expected but arrived empty — deny rather than fall through
  // to the scope-only path, which would be a weaker check than intended.
  if (resource === null) {
    return denial(DENIAL.RESOURCE_MISSING, 'No resource was supplied.');
  }

  // --- Capability-level decision ------------------------------------------
  const required = resolveRequestedScope(permission, scope);

  if (!required.ok) {
    return denial(DENIAL.INVALID_SCOPE, `${permission}: ${required.reason}.`);
  }

  if (!isScopeSatisfied(grantedScope, required.scope)) {
    return denial(
      DENIAL.SCOPE_INSUFFICIENT,
      `Granted scope '${grantedScope}' does not cover '${required.scope}'.`
    );
  }

  return grant({ userId, context, permission, scope: required.scope });
};

/** `check()`, but throws an AuthorizationError on denial. */
const authorize = async (input) => {
  const result = await check(input);

  if (!result.allowed) {
    throw new AuthorizationError(result.code, result.message, result.details);
  }

  return result;
};

/**
 * The Mongo filter that narrows a list query to what the actor may see.
 *
 * Lists must never fetch-then-filter, so this hands back a fragment the caller
 * merges into its query and lets the database do the narrowing.
 */
const scopedFilter = async ({ userId, workspaceId, permission }) => {
  if (!isValidPermissionKey(permission)) {
    return denial(DENIAL.INVALID_PERMISSION, `'${permission}' is not a known permission.`);
  }

  const context = await resolveContext({ userId, workspaceId });
  if (!context.allowed) return context;

  const grantedScope = context.permissions.get(permission);

  if (grantedScope === undefined) {
    return denial(
      DENIAL.PERMISSION_MISSING,
      `Role '${context.role.name}' does not grant '${permission}'.`
    );
  }

  // Built at the actor's *granted* scope, not the widest one. A list should
  // return what they can see rather than failing because they cannot see
  // everything — which is exactly why this does not go through `check()`.
  return {
    allowed: true,
    scope: grantedScope,
    filter: {
      workspace: context.workspace._id,
      ...taskScopeFilter({ userId, grantedScope }),
    },
  };
};

/**
 * May this actor give somebody this role?
 *
 * Requires `members.assign_role`, then the delegation rules in
 * `permissionResolver.canAssignRole`.
 */
const checkRoleAssignment = async ({ userId, workspaceId, targetRoleId }) => {
  const permitted = await check({
    userId,
    workspaceId,
    permission: 'members.assign_role',
  });

  if (!permitted.allowed) return permitted;

  const context = await resolveContext({ userId, workspaceId });
  if (!context.allowed) return context;

  if (!isUsableId(targetRoleId)) {
    return denial(DENIAL.ROLE_ASSIGNMENT_FORBIDDEN, 'No usable target role id.');
  }

  const targetRole = await Role.findById(targetRoleId);

  if (!targetRole) {
    return denial(DENIAL.ROLE_ASSIGNMENT_FORBIDDEN, 'Target role does not exist.');
  }

  // A role from another workspace is never assignable here — that would be the
  // cross-tenant escalation path.
  if (!sameId(targetRole.workspace, context.workspace._id)) {
    return denial(
      DENIAL.ROLE_ASSIGNMENT_FORBIDDEN,
      'Target role belongs to a different workspace.'
    );
  }

  const verdict = canAssignRole({
    targetRole,
    permissions: context.permissions,
    rank: context.rank,
    isOwner: context.isOwner,
  });

  if (!verdict.ok) {
    return denial(DENIAL.ROLE_ASSIGNMENT_FORBIDDEN, verdict.reason, {
      targetRoleId: String(targetRole._id),
    });
  }

  return {
    ...grant({ userId, context, permission: 'members.assign_role', scope: 'workspace' }),
    targetRoleId: String(targetRole._id),
    targetRoleKey: targetRole.systemKey ?? null,
  };
};

/**
 * May this actor put these permissions on a role?
 *
 * The ceiling rule — you cannot grant what you do not hold. Callers still have
 * to check `roles.create` / `roles.edit` separately; this answers only the
 * escalation question.
 */
const checkPermissionGrant = async ({ userId, workspaceId, permissions = [] }) => {
  const context = await resolveContext({ userId, workspaceId });
  if (!context.allowed) return context;

  const verdict = canGrantPermissions({
    permissions: context.permissions,
    requested: permissions,
    isOwner: context.isOwner,
  });

  if (!verdict.ok) {
    return denial(
      DENIAL.PERMISSION_GRANT_EXCEEDS_ACTOR,
      `Cannot grant '${verdict.permission}': ${verdict.reason}.`,
      { permission: verdict.permission }
    );
  }

  return { allowed: true, workspaceId: String(context.workspace._id) };
};

module.exports = {
  resolveContext,
  check,
  authorize,
  scopedFilter,
  checkRoleAssignment,
  checkPermissionGrant,
};
