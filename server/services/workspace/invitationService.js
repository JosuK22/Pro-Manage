/**
 * Workspace invitations.
 *
 * An invitation is a conversation with an email address, not a member. It may
 * be sent to somebody with no account at all, which is what preserves the
 * product's original ability to assign work to a person before they sign up.
 *
 * Token handling follows the Stage 3 design: only the SHA-256 digest is ever
 * persisted. The plaintext exists in memory for exactly as long as it takes to
 * hand it back to the caller for delivery, and is never logged.
 */

const User = require('../../model/userModel');
const Role = require('../../model/roleModel');
const WorkspaceMembership = require('../../model/workspaceMembershipModel');
const WorkspaceInvitation = require('../../model/workspaceInvitationModel');

// Namespace import so the authorization calls stay observable to tests.
const authorization = require('../authorization');
const { AuthorizationError } = require('../authorization');
const { DOMAIN, domainError } = require('./workspaceErrors');

const DUPLICATE_KEY = 11000;

/** Fourteen days. A product decision, so it lives here and not in the model. */
const INVITATION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

/**
 * One normalisation strategy, matching the User and Assignee models' own
 * `trim` + `lowercase` setters. Two spellings of the same address must never
 * become two invitations.
 */
const normaliseEmail = (email) => String(email ?? '').trim().toLowerCase();

/** Safe invitation shape. `tokenHash` is `select: false`, and never picked here. */
const serialiseInvitation = (invitation) => {
  const role = invitation.role && invitation.role._id ? invitation.role : null;

  return {
    invitationId: String(invitation._id),
    workspaceId: String(invitation.workspace),
    email: invitation.email,
    status: invitation.status,
    expiresAt: invitation.expiresAt,
    acceptedAt: invitation.acceptedAt,
    createdAt: invitation.createdAt,
    role: role
      ? { _id: String(role._id), name: role.name, systemKey: role.systemKey ?? null }
      : { _id: String(invitation.role) },
  };
};

/** Resolve a role that must belong to this workspace. */
const resolveWorkspaceRole = async (workspaceId, roleId) => {
  if (!roleId) {
    throw domainError(DOMAIN.ROLE_NOT_FOUND, 'A role must be specified.');
  }

  const role = await Role.findOne({ _id: roleId, workspace: workspaceId });

  if (!role) {
    // Reported as "not found" whether it is missing or belongs elsewhere —
    // distinguishing the two would confirm another workspace's role ids.
    throw domainError(DOMAIN.ROLE_NOT_FOUND, 'Role not found.');
  }

  return role;
};

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Invite somebody to the workspace.
 *
 * @returns {{ invitation: object, token: string|null }} the plaintext token is
 *          returned once, for delivery, and is not stored anywhere.
 */
const inviteMember = async ({ workspaceId, actorUserId, email, roleId }) => {
  await authorization.authorize({
    userId: actorUserId,
    workspaceId,
    permission: 'members.invite',
  });

  const normalisedEmail = normaliseEmail(email);

  if (!normalisedEmail) {
    throw domainError(DOMAIN.INVITATION_INVALID, 'An email address is required.');
  }

  const role = await resolveWorkspaceRole(workspaceId, roleId);

  // Inviting somebody *as* a role is a role assignment, so it obeys the same
  // delegation rules — otherwise the invite endpoint would be a way to mint
  // Admins that the role endpoint forbids.
  const delegation = await authorization.checkRoleAssignment({
    userId: actorUserId,
    workspaceId,
    targetRoleId: role._id,
  });

  if (!delegation.allowed) {
    throw new AuthorizationError(delegation.code, delegation.message, delegation.details);
  }

  // --- Already a member? --------------------------------------------------
  const existingUser = await User.findOne({ email: normalisedEmail }).select('_id');

  if (existingUser) {
    const membership = await WorkspaceMembership.findOne({
      workspace: workspaceId,
      user: existingUser._id,
    });

    if (membership && membership.status === 'active') {
      throw domainError(DOMAIN.ALREADY_MEMBER, 'This person is already a member.');
    }

    // A suspended member is not re-invited. Suspension is a deliberate act and
    // an invitation must not become a way around it — the correct route is to
    // lift the suspension explicitly.
    if (membership && membership.status === 'suspended') {
      throw domainError(
        DOMAIN.MEMBER_SUSPENDED,
        'This person is suspended. Reactivate them instead of re-inviting.'
      );
    }
  }

  // --- Already invited? ---------------------------------------------------
  const pending = await WorkspaceInvitation.findOne({
    workspace: workspaceId,
    email: normalisedEmail,
    status: 'pending',
  });

  if (pending) {
    // Deliberately a conflict rather than a silent refresh.
    //
    // Only the hash is stored, so the original link cannot be re-sent, and
    // quietly minting a new token would invalidate a link the invitee may
    // already have without anyone asking for that. Revoking first makes the
    // intent explicit.
    throw domainError(
      DOMAIN.INVITATION_ALREADY_PENDING,
      'An invitation is already pending for this address. Revoke it first to send a new one.'
    );
  }

  const { raw, hash } = WorkspaceInvitation.createToken();

  try {
    const invitation = await WorkspaceInvitation.create({
      workspace: workspaceId,
      email: normalisedEmail,
      role: role._id,
      invitedBy: actorUserId,
      tokenHash: hash,
      status: 'pending',
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
    });

    await invitation.populate('role', 'name systemKey');

    // The raw token leaves here and is never written down.
    return { invitation: serialiseInvitation(invitation), token: raw };
  } catch (error) {
    // Lost a race against a concurrent invite — the partial unique index on
    // (workspace, email) where status='pending' did its job.
    if (error.code === DUPLICATE_KEY) {
      throw domainError(
        DOMAIN.INVITATION_ALREADY_PENDING,
        'An invitation is already pending for this address.'
      );
    }
    throw error;
  }
};

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

const listInvitations = async ({ workspaceId, actorUserId, filters = {}, pagination = {} }) => {
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

  const query = { workspace: workspaceId };
  if (filters.status) query.status = filters.status;

  const [invitations, total] = await Promise.all([
    WorkspaceInvitation.find(query)
      .populate('role', 'name systemKey')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    WorkspaceInvitation.countDocuments(query),
  ]);

  return {
    invitations: invitations.map(serialiseInvitation),
    pagination: { page, limit, total, hasMore: page * limit < total },
  };
};

// ---------------------------------------------------------------------------
// Revoke
// ---------------------------------------------------------------------------

const revokeInvitation = async ({ workspaceId, actorUserId, invitationId }) => {
  await authorization.authorize({
    userId: actorUserId,
    workspaceId,
    permission: 'members.invite',
  });

  // Conditional on status, so two concurrent revocations cannot both claim to
  // have done it, and an accepted invitation cannot be retroactively revoked.
  const result = await WorkspaceInvitation.findOneAndUpdate(
    { _id: invitationId, workspace: workspaceId, status: 'pending' },
    { $set: { status: 'revoked' } },
    { new: true }
  ).populate('role', 'name systemKey');

  if (!result) {
    throw domainError(
      DOMAIN.INVITATION_NOT_FOUND,
      'No pending invitation was found.'
    );
  }

  return serialiseInvitation(result);
};

// ---------------------------------------------------------------------------
// Accept
// ---------------------------------------------------------------------------

/**
 * Accept an invitation.
 *
 * The token is a bearer credential, so every failure returns the *same*
 * generic error: distinguishing "no such token" from "expired" from "already
 * used" would let someone probe which tokens were ever real.
 *
 * Ordering note. Without transactions — the test environment is a standalone
 * mongod, so a transactional path could not be tested — the membership is
 * created *before* the invitation is marked accepted. If the second write
 * fails, the worst outcome is a pending invitation whose membership already
 * exists, and re-accepting is idempotent. The reverse order would risk
 * consuming the invitation while leaving the invitee with no membership and no
 * way back in.
 */
const acceptInvitation = async ({ token, userId }) => {
  const invalid = () =>
    domainError(DOMAIN.INVITATION_INVALID, 'This invitation link is not valid.');

  if (!token || !userId) throw invalid();

  const tokenHash = WorkspaceInvitation.hashToken(token);

  // Looked up by hash — the plaintext is never compared against stored text.
  //
  // `tokenHash` is not selected: a query can filter on an unselected field, so
  // the digest never needs to be loaded into memory here at all.
  const invitation = await WorkspaceInvitation.findOne({ tokenHash });

  if (!invitation) throw invalid();
  if (invitation.status !== 'pending') throw invalid();
  if (invitation.isExpired) throw invalid();

  const role = await Role.findOne({
    _id: invitation.role,
    workspace: invitation.workspace,
  });

  // The role was validated at creation, but a raw update could have moved it
  // since. An invitation pointing at a foreign role is not honoured.
  if (!role) throw invalid();

  const existing = await WorkspaceMembership.findOne({
    workspace: invitation.workspace,
    user: userId,
  });

  let membership = existing;

  if (!membership) {
    try {
      membership = await WorkspaceMembership.create({
        workspace: invitation.workspace,
        user: userId,
        role: role._id,
        status: 'active',
        invitedBy: invitation.invitedBy,
      });
    } catch (error) {
      // Concurrent acceptance created it first — that is success, not failure.
      if (error.code === DUPLICATE_KEY) {
        membership = await WorkspaceMembership.findOne({
          workspace: invitation.workspace,
          user: userId,
        });
      } else {
        throw error;
      }
    }
  }

  // Claim the invitation atomically. A racer that already claimed it leaves
  // this a no-op, and the membership above is still correct.
  await WorkspaceInvitation.updateOne(
    { _id: invitation._id, status: 'pending' },
    { $set: { status: 'accepted', acceptedAt: new Date(), acceptedBy: userId } }
  );

  return {
    accepted: true,
    workspaceId: String(invitation.workspace),
    membershipId: String(membership._id),
    roleId: String(role._id),
  };
};

module.exports = {
  INVITATION_TTL_MS,
  normaliseEmail,
  serialiseInvitation,
  resolveWorkspaceRole,
  inviteMember,
  listInvitations,
  revokeInvitation,
  acceptInvitation,
};
