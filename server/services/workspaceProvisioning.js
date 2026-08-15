/**
 * Workspace provisioning.
 *
 * Creating a workspace is never just one document: it is a workspace, its three
 * protected roles, and an owner membership. Stage 3 encoded that sequence only
 * in `tests/factories.js`, which is test-only code the migration cannot import.
 * Rather than write a second copy of the role definitions — the exact drift the
 * Stage 3 report warned about — this module is the one definition, and the test
 * factories now call it too.
 *
 * Every function here is idempotent: it resolves what already exists before
 * creating anything, and reports whether it created or reused. That is what
 * makes the migration safe to re-run and safe to resume after a failure.
 */

const Workspace = require('../model/workspaceModel');
const Role = require('../model/roleModel');
const WorkspaceMembership = require('../model/workspaceMembershipModel');
const { SYSTEM_ROLES, SYSTEM_ROLE_RANK } = require('../model/roleModel');

/** Mongo's duplicate-key error. Two concurrent runs must not both fail. */
const DUPLICATE_KEY = 11000;

/**
 * The three protected roles every workspace is seeded with.
 *
 * Owner is granted no permissions on purpose. The authorization engine
 * short-circuits on `workspace.owner`, so owner authority does not come from
 * this array and cannot be revoked by editing it.
 */
const SYSTEM_ROLE_DEFINITIONS = [
  {
    systemKey: SYSTEM_ROLES.OWNER,
    name: 'Owner',
    description: 'Full authority over the workspace.',
    rank: SYSTEM_ROLE_RANK[SYSTEM_ROLES.OWNER],
    permissions: [],
  },
  {
    systemKey: SYSTEM_ROLES.ADMIN,
    name: 'Admin',
    description: 'Manages members, roles and tasks.',
    rank: SYSTEM_ROLE_RANK[SYSTEM_ROLES.ADMIN],
    permissions: [
      { key: 'workspace.view' },
      { key: 'workspace.edit' },
      { key: 'members.view' },
      { key: 'members.invite' },
      { key: 'members.remove' },
      { key: 'members.assign_role' },
      { key: 'roles.view' },
      { key: 'roles.create' },
      { key: 'roles.edit' },
      { key: 'roles.delete' },
      { key: 'tasks.view', scope: 'workspace' },
      { key: 'tasks.create' },
      { key: 'tasks.edit', scope: 'workspace' },
      { key: 'tasks.delete', scope: 'workspace' },
      { key: 'tasks.assign' },
      { key: 'tasks.change_status', scope: 'workspace' },
      { key: 'analytics.view', scope: 'workspace' },
    ],
  },
  {
    systemKey: SYSTEM_ROLES.MEMBER,
    name: 'Member',
    description: 'Works on the tasks assigned to them.',
    rank: SYSTEM_ROLE_RANK[SYSTEM_ROLES.MEMBER],
    isDefault: true,
    // No tasks.delete. Assignment and deletion are separate concepts under the
    // new model — being given a task does not confer the right to destroy it.
    permissions: [
      { key: 'workspace.view' },
      { key: 'members.view' },
      { key: 'tasks.view', scope: 'assigned' },
      { key: 'tasks.change_status', scope: 'assigned' },
      { key: 'tasks.manage_checklists', scope: 'assigned' },
      { key: 'analytics.view', scope: 'own' },
    ],
  },
];

/** The deterministic name a user's personal workspace is given. */
const personalWorkspaceName = (user) => `${user.name}'s Workspace`;

/**
 * Find a user's personal workspace.
 *
 * Keyed on `isPersonal`, not on ownership: once a user can own several
 * workspaces, "the one they own" stops being a single answer.
 */
const findPersonalWorkspace = (userId) =>
  Workspace.findOne({ owner: userId, isPersonal: true });

/**
 * Create the personal workspace for a user, or return the existing one.
 *
 * @returns {{ workspace: object, created: boolean }}
 */
const ensurePersonalWorkspace = async (user) => {
  const existing = await findPersonalWorkspace(user._id);
  if (existing) return { workspace: existing, created: false };

  try {
    const workspace = await Workspace.create({
      owner: user._id,
      name: personalWorkspaceName(user),
      isPersonal: true,
    });

    return { workspace, created: true };
  } catch (error) {
    // Lost a race against a concurrent run — the partial unique index did its
    // job. Re-read rather than failing the whole migration.
    if (error.code === DUPLICATE_KEY) {
      return { workspace: await findPersonalWorkspace(user._id), created: false };
    }
    throw error;
  }
};

/**
 * Ensure a workspace has its three protected roles.
 *
 * @returns {{ roles: { owner, admin, member }, created: number }}
 */
const ensureSystemRoles = async (workspaceId) => {
  const existing = await Role.find({
    workspace: workspaceId,
    systemKey: { $in: Object.values(SYSTEM_ROLES) },
  });

  const bySystemKey = new Map(existing.map((role) => [role.systemKey, role]));
  let created = 0;

  for (const definition of SYSTEM_ROLE_DEFINITIONS) {
    if (bySystemKey.has(definition.systemKey)) continue;

    try {
      const role = await Role.create({
        workspace: workspaceId,
        isSystemRole: true,
        ...definition,
      });

      bySystemKey.set(definition.systemKey, role);
      created += 1;
    } catch (error) {
      if (error.code === DUPLICATE_KEY) {
        const role = await Role.findOne({
          workspace: workspaceId,
          systemKey: definition.systemKey,
        });
        bySystemKey.set(definition.systemKey, role);
      } else {
        throw error;
      }
    }
  }

  return {
    roles: {
      owner: bySystemKey.get(SYSTEM_ROLES.OWNER),
      admin: bySystemKey.get(SYSTEM_ROLES.ADMIN),
      member: bySystemKey.get(SYSTEM_ROLES.MEMBER),
    },
    created,
  };
};

/**
 * Ensure a user has a membership in a workspace with the given role.
 *
 * Existing memberships are never re-roled — silently changing someone's role
 * during a data migration would be a security event, not a fix.
 *
 * @returns {{ membership: object, created: boolean }}
 */
const ensureMembership = async ({ workspace, user, role, invitedBy = null }) => {
  const workspaceId = workspace._id ?? workspace;
  const userId = user._id ?? user;

  const existing = await WorkspaceMembership.findOne({
    workspace: workspaceId,
    user: userId,
  });

  if (existing) return { membership: existing, created: false };

  try {
    const membership = await WorkspaceMembership.create({
      workspace: workspaceId,
      user: userId,
      role: role._id ?? role,
      status: 'active',
      invitedBy,
    });

    return { membership, created: true };
  } catch (error) {
    if (error.code === DUPLICATE_KEY) {
      const membership = await WorkspaceMembership.findOne({
        workspace: workspaceId,
        user: userId,
      });
      return { membership, created: false };
    }
    throw error;
  }
};

/**
 * The whole sequence: workspace, roles, owner membership.
 *
 * Used by the migration and by the test factories, so both describe the same
 * shape of workspace.
 */
const provisionWorkspace = async ({ owner, name, description = '', isPersonal = false }) => {
  const ownerId = owner._id ?? owner;

  let workspace;
  let workspaceCreated = false;

  if (isPersonal) {
    const result = await ensurePersonalWorkspace(owner);
    workspace = result.workspace;
    workspaceCreated = result.created;
  } else {
    workspace = await Workspace.create({ owner: ownerId, name, description });
    workspaceCreated = true;
  }

  const { roles, created: rolesCreated } = await ensureSystemRoles(workspace._id);

  const { membership, created: membershipCreated } = await ensureMembership({
    workspace,
    user: ownerId,
    role: roles.owner,
  });

  return {
    workspace,
    roles,
    membership,
    created: {
      workspace: workspaceCreated,
      roles: rolesCreated,
      membership: membershipCreated,
    },
  };
};

module.exports = {
  SYSTEM_ROLE_DEFINITIONS,
  personalWorkspaceName,
  findPersonalWorkspace,
  ensurePersonalWorkspace,
  ensureSystemRoles,
  ensureMembership,
  provisionWorkspace,
};
