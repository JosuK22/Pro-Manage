/**
 * Member and invitation endpoints.
 *
 * Deliberately thin. Every rule — authorization, owner protection, delegation,
 * invitation lifecycle — lives in the services, so a caller that bypasses HTTP
 * gets the same protection. These functions translate request to service call
 * and service result to response envelope, and nothing else.
 */

const catchAsync = require('../utils/catchAsync');
const membershipService = require('../services/workspace/membershipService');
const invitationService = require('../services/workspace/invitationService');

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

exports.listMembers = catchAsync(async (req, res) => {
  const result = await membershipService.listMembers({
    workspaceId: req.params.workspaceId,
    actorUserId: req.user._id,
    filters: { status: req.query.status, roleId: req.query.roleId },
    pagination: { page: req.query.page, limit: req.query.limit },
  });

  res.status(200).json({
    status: 'success',
    results: result.members.length,
    data: result,
  });
});

exports.getMember = catchAsync(async (req, res) => {
  const member = await membershipService.getMember({
    workspaceId: req.params.workspaceId,
    actorUserId: req.user._id,
    membershipId: req.params.membershipId,
  });

  res.status(200).json({ status: 'success', data: { member } });
});

exports.assignMemberRole = catchAsync(async (req, res) => {
  const member = await membershipService.assignMemberRole({
    workspaceId: req.params.workspaceId,
    actorUserId: req.user._id,
    membershipId: req.params.membershipId,
    // Only the role id is read from the body. Nothing else in it can reach the
    // membership document.
    roleId: req.body.roleId,
  });

  res.status(200).json({ status: 'success', data: { member } });
});

exports.suspendMember = catchAsync(async (req, res) => {
  const member = await membershipService.suspendMember({
    workspaceId: req.params.workspaceId,
    actorUserId: req.user._id,
    membershipId: req.params.membershipId,
  });

  res.status(200).json({ status: 'success', data: { member } });
});

exports.reactivateMember = catchAsync(async (req, res) => {
  const member = await membershipService.reactivateMember({
    workspaceId: req.params.workspaceId,
    actorUserId: req.user._id,
    membershipId: req.params.membershipId,
  });

  res.status(200).json({ status: 'success', data: { member } });
});

exports.removeMember = catchAsync(async (req, res) => {
  await membershipService.removeMember({
    workspaceId: req.params.workspaceId,
    actorUserId: req.user._id,
    membershipId: req.params.membershipId,
  });

  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

exports.listInvitations = catchAsync(async (req, res) => {
  const result = await invitationService.listInvitations({
    workspaceId: req.params.workspaceId,
    actorUserId: req.user._id,
    filters: { status: req.query.status },
    pagination: { page: req.query.page, limit: req.query.limit },
  });

  res.status(200).json({
    status: 'success',
    results: result.invitations.length,
    data: result,
  });
});

exports.createInvitation = catchAsync(async (req, res) => {
  const { invitation, token } = await invitationService.inviteMember({
    workspaceId: req.params.workspaceId,
    actorUserId: req.user._id,
    email: req.body.email,
    roleId: req.body.roleId,
  });

  // The plaintext token is returned exactly once, to the authorised inviter,
  // so a delivery mechanism can build the link. It is not persisted and does
  // not appear on any listing endpoint.
  res.status(201).json({ status: 'success', data: { invitation, token } });
});

exports.revokeInvitation = catchAsync(async (req, res) => {
  const invitation = await invitationService.revokeInvitation({
    workspaceId: req.params.workspaceId,
    actorUserId: req.user._id,
    invitationId: req.params.invitationId,
  });

  res.status(200).json({ status: 'success', data: { invitation } });
});

/**
 * Accept an invitation.
 *
 * Not workspace-scoped: the accepting user is not yet a member, so there is no
 * membership to authorize against. The token itself is the credential.
 */
exports.acceptInvitation = catchAsync(async (req, res) => {
  const result = await invitationService.acceptInvitation({
    token: req.body.token,
    userId: req.user._id,
  });

  res.status(200).json({ status: 'success', data: result });
});
