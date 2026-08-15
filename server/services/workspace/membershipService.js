/**
 * Workspace member management.
 *
 * Every exported operation authorizes through the Stage 5 engine *before* it
 * reads or writes anything. Authorization lives here rather than in the
 * controller because a future caller — a script, a job, another service — may
 * never go through HTTP, and the controller must not be the only boundary.
 *
 * No role names are compared anywhere in this file. Capability comes from
 * `authorize()`, delegation from `checkRoleAssignment()`.
 */

const Workspace = require('../../model/workspaceModel');
const Role = require('../../model/roleModel');
const WorkspaceMembership = require('../../model/workspaceMembershipModel');
const { SYSTEM_ROLES } = require('../../model/roleModel');

// Imported as a namespace, not destructured. Destructuring captures the
// function reference at require time, which makes the call invisible to a spy
// — and a test that cannot see the authorization call cannot prove it happened.
const authorization = require('../authorization');
const { AuthorizationError } = require('../authorization');
const { DOMAIN, domainError } = require('./workspaceErrors');

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

const sameId = (a, b) => Boolean(a) && Boolean(b) && String(a._id ?? a) === String(b._id ?? b);

/**
 * The only member shape allowed to cross the API boundary.
 *
 * Built by explicit field picking rather than by deleting unwanted keys — an
 * allowlist cannot be defeated by a new field appearing on the model later.
 * The user's password is `select: false` anyway; this is the second layer.
 */
const serialiseMember = (membership) => {
  const user = membership.user && membership.user._id ? membership.user : null;
  const role = membership.role && membership.role._id ? membership.role : null;

  return {
    membershipId: String(membership._id),
    workspaceId: String(membership.workspace),
    status: membership.status,
    joinedAt: membership.joinedAt,
    createdAt: membership.createdAt,
    updatedAt: membership.updatedAt,
    user: user
      ? { _id: String(user._id), name: user.name, email: user.email }
      : { _id: String(membership.user) },
    role: role
      ? {
          _id: String(role._id),
          name: role.name,
          systemKey: role.systemKey ?? null,
          isSystemRole: Boolean(role.isSystemRole),
        }
      : { _id: String(membership.role) },
  };
};

/** Load a membership that must belong to this workspace. */
const findMembershipInWorkspace = async (workspaceId, membershipId) => {
  // Both fields in the query: resolving by id alone would let a membership
  // from another workspace become a data-access path.
  const membership = await WorkspaceMembership.findOne({
    _id: membershipId,
    workspace: workspaceId,
  })
    .populate('user', 'name email')
    .populate('role', 'name systemKey isSystemRole rank workspace');

  if (!membership) {
    throw domainError(DOMAIN.MEMBER_NOT_FOUND, 'Member not found.');
  }

  return membership;
};

/**
 * Refuse anything that would break the owner invariant.
 *
 * `Workspace.owner` is authoritative, so the check is against that field and
 * not against whoever happens to hold the Owner role. Ownership moves only
 * through a dedicated transfer flow, which does not exist yet.
 */
const assertNotWorkspaceOwner = (workspace, membership, action) => {
  if (sameId(workspace.owner, membership.user?._id ?? membership.user)) {
    throw domainError(
      DOMAIN.OWNER_PROTECTED,
      `The workspace owner cannot be ${action}. Transfer ownership first.`
    );
  }
};

/** Self-service is not part of this stage's product semantics. */
const assertNotSelf = (actorUserId, membership, action) => {
  if (sameId(actorUserId, membership.user?._id ?? membership.user)) {
    throw domainError(
      DOMAIN.SELF_ACTION_NOT_ALLOWED,
      `You cannot ${action} yourself.`
    );
  }
};

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * List a workspace's members.
 *
 * Paginated in the database. Fetching every membership and slicing in memory
 * would put a workspace's whole roster in Node for a request that wanted ten
 * rows.
 */
const listMembers = async ({ workspaceId, actorUserId, filters = {}, pagination = {} }) => {
  await authorization.authorize({
    userId: actorUserId,
    workspaceId,
    permission: 'members.view',
  });

  const limit = Math.min(
    Math.max(parseInt(pagination.limit, 10) || DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE
  );
  const page = Math.max(parseInt(pagination.page, 10) || 1, 1);

  // Workspace is part of the query, never an afterthought.
  const query = { workspace: workspaceId };

  if (filters.status) query.status = filters.status;
  if (filters.roleId) query.role = filters.roleId;

  const [memberships, total] = await Promise.all([
    WorkspaceMembership.find(query)
      .populate('user', 'name email')
      .populate('role', 'name systemKey isSystemRole rank workspace')
      .sort({ createdAt: 1 })
      .skip((page - 1) * limit)
      .limit(limit),
    WorkspaceMembership.countDocuments(query),
  ]);

  return {
    members: memberships.map(serialiseMember),
    pagination: { page, limit, total, hasMore: page * limit < total },
  };
};

const getMember = async ({ workspaceId, actorUserId, membershipId }) => {
  await authorization.authorize({
    userId: actorUserId,
    workspaceId,
    permission: 'members.view',
  });

  const membership = await findMembershipInWorkspace(workspaceId, membershipId);
  return serialiseMember(membership);
};

// ---------------------------------------------------------------------------
// Role assignment
// ---------------------------------------------------------------------------

/**
 * Give a member a different role.
 *
 * The delegation rules — Owner never assignable, Admin needs
 * `members.assign_admin`, rank must exceed the target — all live in Stage 5's
 * `checkRoleAssignment`. Restating them here is exactly how two copies of a
 * security rule drift apart.
 */
const assignMemberRole = async ({ workspaceId, actorUserId, membershipId, roleId }) => {
  // The actor must be able to manage members at all before anything is looked
  // up, so a stranger cannot use this endpoint to probe role ids.
  await authorization.authorize({
    userId: actorUserId,
    workspaceId,
    permission: 'members.assign_role',
  });

  // Resolve the role scoped to this workspace first. A role that is missing and
  // a role that belongs elsewhere both come back as "not found" — matching the
  // invitation flow, and refusing to confirm another workspace's role ids.
  const role = await Role.findOne({ _id: roleId, workspace: workspaceId });

  if (!role) {
    throw domainError(DOMAIN.ROLE_NOT_FOUND, 'Role not found.');
  }

  // Delegation rules — Owner never assignable, Admin needs
  // `members.assign_admin`, rank must exceed the target — all come from Stage 5.
  const decision = await authorization.checkRoleAssignment({
    userId: actorUserId,
    workspaceId,
    targetRoleId: role._id,
  });

  if (!decision.allowed) {
    throw new AuthorizationError(decision.code, decision.message, decision.details);
  }

  const workspace = await Workspace.findById(workspaceId);
  const membership = await findMembershipInWorkspace(workspaceId, membershipId);

  // Re-roling the owner would leave the workspace with an owner who no longer
  // holds the Owner role — the integrity conflict Stage 5 refuses outright.
  assertNotWorkspaceOwner(workspace, membership, 'given a different role');

  membership.role = role._id;
  await membership.save();

  return serialiseMember(await findMembershipInWorkspace(workspaceId, membershipId));
};

// ---------------------------------------------------------------------------
// Status lifecycle
// ---------------------------------------------------------------------------

/**
 * Suspend a member.
 *
 * Uses the model's real statuses — `active` and `suspended`. No new state was
 * invented, and removal is a separate operation rather than a status.
 */
const suspendMember = async ({ workspaceId, actorUserId, membershipId }) => {
  await authorization.authorize({
    userId: actorUserId,
    workspaceId,
    permission: 'members.suspend',
  });

  const workspace = await Workspace.findById(workspaceId);
  const membership = await findMembershipInWorkspace(workspaceId, membershipId);

  assertNotWorkspaceOwner(workspace, membership, 'suspended');
  assertNotSelf(actorUserId, membership, 'suspend');

  if (membership.status === 'suspended') {
    throw domainError(DOMAIN.ALREADY_SUSPENDED, 'This member is already suspended.');
  }

  // Conditional update: two concurrent suspensions cannot both report success.
  const result = await WorkspaceMembership.updateOne(
    { _id: membership._id, workspace: workspaceId, status: 'active' },
    { $set: { status: 'suspended' } }
  );

  if (result.modifiedCount === 0) {
    throw domainError(DOMAIN.ALREADY_SUSPENDED, 'This member is already suspended.');
  }

  return serialiseMember(await findMembershipInWorkspace(workspaceId, membershipId));
};

/**
 * Lift a suspension.
 *
 * Governed by `members.suspend` — the same capability that imposed it. A
 * separate permission for undoing your own action would be ceremony, and
 * without this operation a suspension would be irreversible.
 */
const reactivateMember = async ({ workspaceId, actorUserId, membershipId }) => {
  await authorization.authorize({
    userId: actorUserId,
    workspaceId,
    permission: 'members.suspend',
  });

  const membership = await findMembershipInWorkspace(workspaceId, membershipId);

  if (membership.status !== 'suspended') {
    throw domainError(DOMAIN.NOT_SUSPENDED, 'This member is not suspended.');
  }

  const result = await WorkspaceMembership.updateOne(
    { _id: membership._id, workspace: workspaceId, status: 'suspended' },
    { $set: { status: 'active' } }
  );

  if (result.modifiedCount === 0) {
    throw domainError(DOMAIN.NOT_SUSPENDED, 'This member is not suspended.');
  }

  return serialiseMember(await findMembershipInWorkspace(workspaceId, membershipId));
};

// ---------------------------------------------------------------------------
// Removal
// ---------------------------------------------------------------------------

const removeMember = async ({ workspaceId, actorUserId, membershipId }) => {
  await authorization.authorize({
    userId: actorUserId,
    workspaceId,
    permission: 'members.remove',
  });

  const workspace = await Workspace.findById(workspaceId);
  const membership = await findMembershipInWorkspace(workspaceId, membershipId);

  // Removing the owner would leave a workspace whose `owner` points at a
  // non-member — which Stage 5 then refuses for everyone, locking the
  // workspace permanently.
  assertNotWorkspaceOwner(workspace, membership, 'removed');
  assertNotSelf(actorUserId, membership, 'remove');

  await WorkspaceMembership.deleteOne({ _id: membership._id, workspace: workspaceId });

  return { removed: true, membershipId: String(membership._id) };
};

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  serialiseMember,
  findMembershipInWorkspace,
  listMembers,
  getMember,
  assignMemberRole,
  suspendMember,
  reactivateMember,
  removeMember,
  SYSTEM_ROLES,
};
