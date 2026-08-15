/**
 * Workspace role management.
 *
 * The central rule of this file, and the reason it exists:
 *
 *   A user must never create or modify a role carrying permissions they are
 *   not themselves authorized to grant.
 *
 * That rule is *not* implemented here. It lives in Stage 5's
 * `checkPermissionGrant`, and this service calls it. Restating a ceiling
 * algorithm in a second place is how the two copies eventually disagree, and
 * the disagreement is a privilege-escalation bug.
 *
 * As in Stage 6, authorization happens in the service rather than the
 * controller, so a caller that never touches HTTP is protected too.
 */

const mongoose = require('mongoose');

const Role = require('../../model/roleModel');
const WorkspaceMembership = require('../../model/workspaceMembershipModel');
const { SYSTEM_ROLES, DEFAULT_RANK, MAX_NAME_LENGTH } = require('../../model/roleModel');

// Namespace import so the authorization calls stay observable to tests.
const authorization = require('../authorization');
const { AuthorizationError } = require('../authorization');
const {
  PERMISSION_BY_KEY,
  isValidPermissionKey,
  isValidScopeFor,
  defaultScopeFor,
  PERMISSIONS,
} = require('../../config/permissions');
const { DOMAIN, domainError } = require('./workspaceErrors');

const DUPLICATE_KEY = 11000;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

/**
 * System roles the API refuses to touch at all.
 *
 * OWNER is fully sealed. Editing its permission array is meaningless — the
 * authorization engine short-circuits for the workspace owner and never reads
 * it — so allowing edits would only create the illusion that they matter.
 */
const SEALED_SYSTEM_ROLES = new Set([SYSTEM_ROLES.OWNER]);

/**
 * Fields a client may never set, on any role.
 *
 * The server decides what is a system role. A client submitting
 * `{ systemKey: 'OWNER' }` must not be able to manufacture one, so these are
 * dropped before anything is written rather than validated and rejected —
 * there is no legitimate reason to send them.
 */
const NEVER_CLIENT_SETTABLE = ['systemKey', 'isSystemRole', 'workspace', 'rank', '_id', 'isDefault'];

/** Safe role shape. */
const serialiseRole = (role, memberCount) => ({
  roleId: String(role._id),
  workspaceId: String(role.workspace),
  name: role.name,
  description: role.description ?? '',
  systemKey: role.systemKey ?? null,
  isSystemRole: Boolean(role.isSystemRole),
  isDefault: Boolean(role.isDefault),
  rank: role.rank,
  permissions: (role.permissions ?? []).map((entry) => ({
    key: entry.key,
    scope: entry.scope,
  })),
  ...(memberCount === undefined ? {} : { memberCount }),
  createdAt: role.createdAt,
  updatedAt: role.updatedAt,
});

/** Load a role that must belong to this workspace. */
const findRoleInWorkspace = async (workspaceId, roleId) => {
  // Both fields in the query. A role that is missing and a role belonging to
  // another workspace are indistinguishable to the caller — confirming the
  // latter exists would leak another workspace's configuration.
  const role = await Role.findOne({ _id: roleId, workspace: workspaceId });

  if (!role) {
    throw domainError(DOMAIN.ROLE_NOT_FOUND, 'Role not found.');
  }

  return role;
};

/**
 * Validate a proposed permission set against the catalogue.
 *
 * Shape only — the *ceiling* is Stage 5's job. Returns the normalised set that
 * should actually be persisted, so a caller can never write the raw input.
 */
const normalisePermissions = (permissions) => {
  if (!Array.isArray(permissions)) {
    throw domainError(DOMAIN.INVALID_PERMISSION, 'Permissions must be a list.');
  }

  const seen = new Set();
  const normalised = [];

  for (const entry of permissions) {
    const key = typeof entry === 'string' ? entry : entry?.key;

    if (!isValidPermissionKey(key)) {
      // Unknown permissions fail closed. They are never created, ignored or
      // quietly stripped — a role that silently lost a permission the caller
      // asked for would be worse than an error.
      throw domainError(
        DOMAIN.INVALID_PERMISSION,
        `'${key}' is not a known permission.`
      );
    }

    if (seen.has(key)) {
      // The Role model rejects these too; catching it here gives a clear
      // message instead of a Mongoose validation error.
      throw domainError(
        DOMAIN.DUPLICATE_PERMISSION,
        `'${key}' is listed more than once.`
      );
    }
    seen.add(key);

    // Same default as Stage 5: an omitted scope becomes the widest the
    // permission supports. The role API and the engine must agree, or a role
    // would mean something different from what it enforces.
    const scope = (typeof entry === 'object' && entry?.scope) || defaultScopeFor(key);

    if (!isValidScopeFor(key, scope)) {
      const supported = PERMISSION_BY_KEY.get(key).supportedScopes.join(', ');
      throw domainError(
        DOMAIN.UNSUPPORTED_SCOPE,
        `'${key}' does not support the '${scope}' scope. Supported: ${supported}.`
      );
    }

    normalised.push({ key, scope });
  }

  return normalised;
};

const normaliseName = (name) => {
  if (typeof name !== 'string' || !name.trim()) {
    throw domainError(DOMAIN.INVALID_ROLE_NAME, 'A role name is required.');
  }

  const trimmed = name.trim();

  if (trimmed.length > MAX_NAME_LENGTH) {
    throw domainError(
      DOMAIN.INVALID_ROLE_NAME,
      `Role name cannot be longer than ${MAX_NAME_LENGTH} characters.`
    );
  }

  return trimmed;
};

/** Run the proposed grants past Stage 5's ceiling. */
const assertMayGrant = async ({ actorUserId, workspaceId, permissions }) => {
  const verdict = await authorization.checkPermissionGrant({
    userId: actorUserId,
    workspaceId,
    permissions,
  });

  if (!verdict.allowed) {
    throw new AuthorizationError(verdict.code, verdict.message, verdict.details);
  }
};

/** Refuse anything that would alter a protected role's identity. */
const assertEditableSystemRole = (role) => {
  if (!role.isSystemRole) return;

  if (SEALED_SYSTEM_ROLES.has(role.systemKey)) {
    throw domainError(
      DOMAIN.SYSTEM_ROLE_PROTECTED,
      'The Owner role cannot be modified.'
    );
  }
};

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

const listRoles = async ({ workspaceId, actorUserId, pagination = {} }) => {
  await authorization.authorize({
    userId: actorUserId,
    workspaceId,
    permission: 'roles.view',
  });

  const limit = Math.min(
    Math.max(parseInt(pagination.limit, 10) || DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE
  );
  const page = Math.max(parseInt(pagination.page, 10) || 1, 1);

  const query = { workspace: workspaceId };

  const [roles, total] = await Promise.all([
    Role.find(query).sort({ rank: -1, name: 1 }).skip((page - 1) * limit).limit(limit),
    Role.countDocuments(query),
  ]);

  // One grouped count rather than a query per role — the roles screen shows
  // this beside every role, and N+1 would scale with the workspace's roles.
  // Matched on the workspace itself, not on the first row, so an empty page
  // still produces a correct (empty) map.
  const counts = await WorkspaceMembership.aggregate([
    { $match: { workspace: new mongoose.Types.ObjectId(String(workspaceId)) } },
    { $group: { _id: '$role', count: { $sum: 1 } } },
  ]);

  const byRole = new Map(counts.map((row) => [String(row._id), row.count]));

  return {
    roles: roles.map((role) => serialiseRole(role, byRole.get(String(role._id)) ?? 0)),
    pagination: { page, limit, total, hasMore: page * limit < total },
  };
};

const getRole = async ({ workspaceId, actorUserId, roleId }) => {
  await authorization.authorize({
    userId: actorUserId,
    workspaceId,
    permission: 'roles.view',
  });

  const role = await findRoleInWorkspace(workspaceId, roleId);

  const memberCount = await WorkspaceMembership.countDocuments({
    workspace: workspaceId,
    role: role._id,
  });

  return serialiseRole(role, memberCount);
};

/** The catalogue a role editor needs to render human-readable choices. */
const listAvailablePermissions = async ({ workspaceId, actorUserId }) => {
  await authorization.authorize({
    userId: actorUserId,
    workspaceId,
    permission: 'roles.view',
  });

  // Derived from the canonical catalogue, never re-described here.
  return PERMISSIONS.map((permission) => ({
    key: permission.key,
    label: permission.label,
    description: permission.description,
    category: permission.category,
    supportedScopes: permission.supportedScopes,
  }));
};

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Create a custom role.
 *
 * Everything is validated before the first write, so a rejected request never
 * leaves a partially-populated role behind.
 */
const createRole = async ({ workspaceId, actorUserId, name, description, permissions = [] }) => {
  await authorization.authorize({
    userId: actorUserId,
    workspaceId,
    permission: 'roles.create',
  });

  const cleanName = normaliseName(name);
  const cleanPermissions = normalisePermissions(permissions);

  // The ceiling, checked against the *complete* proposed set before anything
  // is written.
  await assertMayGrant({ actorUserId, workspaceId, permissions: cleanPermissions });

  try {
    const role = await Role.create({
      // Explicit field picking. `systemKey`, `isSystemRole`, `rank` and
      // `workspace` are set by the server, never taken from the caller, so a
      // client cannot manufacture a system role or an Owner-ranked one.
      workspace: workspaceId,
      name: cleanName,
      description: typeof description === 'string' ? description.trim() : '',
      permissions: cleanPermissions,
      isSystemRole: false,
      systemKey: null,
      // Custom roles always take the base rank. Rank governs delegation only,
      // and letting a caller pick it would let them mint a role nobody below
      // an Owner could manage.
      rank: DEFAULT_RANK,
      isDefault: false,
    });

    return serialiseRole(role, 0);
  } catch (error) {
    if (error.code === DUPLICATE_KEY) {
      throw domainError(
        DOMAIN.ROLE_NAME_ALREADY_EXISTS,
        'A role with that name already exists in this workspace.'
      );
    }
    throw error;
  }
};

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

/**
 * Edit a role.
 *
 * PATCH semantics: only supplied fields change. Omitting `permissions` leaves
 * them untouched rather than clearing them.
 *
 * When permissions *are* supplied, the **entire resulting set** goes through
 * the ceiling — not just the additions. Validating only the delta would let a
 * request pair "remove a harmless permission" with "add a forbidden one" and
 * slip the second past the check.
 */
const updateRole = async ({ workspaceId, actorUserId, roleId, name, description, permissions }) => {
  await authorization.authorize({
    userId: actorUserId,
    workspaceId,
    permission: 'roles.edit',
  });

  const role = await findRoleInWorkspace(workspaceId, roleId);

  assertEditableSystemRole(role);

  const updates = {};

  if (name !== undefined) updates.name = normaliseName(name);

  if (description !== undefined) {
    updates.description = typeof description === 'string' ? description.trim() : '';
  }

  if (permissions !== undefined) {
    const cleanPermissions = normalisePermissions(permissions);

    await assertMayGrant({ actorUserId, workspaceId, permissions: cleanPermissions });

    updates.permissions = cleanPermissions;
  }

  if (Object.keys(updates).length === 0) {
    throw domainError(DOMAIN.INVALID_ROLE_NAME, 'No updatable fields were provided.');
  }

  Object.assign(role, updates);

  try {
    await role.save();
  } catch (error) {
    if (error.code === DUPLICATE_KEY) {
      throw domainError(
        DOMAIN.ROLE_NAME_ALREADY_EXISTS,
        'A role with that name already exists in this workspace.'
      );
    }
    throw error;
  }

  const memberCount = await WorkspaceMembership.countDocuments({
    workspace: workspaceId,
    role: role._id,
  });

  return serialiseRole(role, memberCount);
};

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Delete a custom role.
 *
 * Members are never silently reassigned or deleted; a role still in use simply
 * cannot go.
 *
 * On the count-then-delete race: MongoDB has no foreign keys, so a membership
 * created between the count and the delete would otherwise be left pointing at
 * a role that no longer exists. The window is narrowed by re-counting after the
 * delete and restoring the role — with its original `_id`, so any membership
 * that slipped through stays valid — if one appeared. This is a compensating
 * action, not a constraint; see the Stage 7 report.
 */
const deleteRole = async ({ workspaceId, actorUserId, roleId }) => {
  await authorization.authorize({
    userId: actorUserId,
    workspaceId,
    permission: 'roles.delete',
  });

  const role = await findRoleInWorkspace(workspaceId, roleId);

  // No system role is ever deletable — not even by the workspace owner, and
  // not even with roles.delete. A workspace without its Member role has no
  // fallback for new joiners.
  if (role.isSystemRole) {
    throw domainError(
      DOMAIN.SYSTEM_ROLE_PROTECTED,
      'System roles cannot be deleted.'
    );
  }

  const inUse = await WorkspaceMembership.countDocuments({
    workspace: workspaceId,
    role: role._id,
  });

  if (inUse > 0) {
    throw domainError(
      DOMAIN.ROLE_IN_USE,
      `${inUse} ${inUse === 1 ? 'member uses' : 'members use'} this role. Reassign them before deleting it.`
    );
  }

  const snapshot = role.toObject();

  await Role.deleteOne({ _id: role._id, workspace: workspaceId, isSystemRole: false });

  // Re-check: a concurrent assignment may have landed during the delete.
  const appeared = await WorkspaceMembership.countDocuments({
    workspace: workspaceId,
    role: role._id,
  });

  if (appeared > 0) {
    // Put it back exactly as it was, keeping `_id` so the membership that
    // raced in still resolves.
    await Role.create(snapshot);

    throw domainError(
      DOMAIN.ROLE_IN_USE,
      'This role was assigned to a member while it was being deleted.'
    );
  }

  return { deleted: true, roleId: String(role._id) };
};

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  SEALED_SYSTEM_ROLES,
  NEVER_CLIENT_SETTABLE,
  serialiseRole,
  findRoleInWorkspace,
  normalisePermissions,
  normaliseName,
  listRoles,
  getRole,
  listAvailablePermissions,
  createRole,
  updateRole,
  deleteRole,
};
