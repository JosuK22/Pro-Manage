const express = require('express');

const { protect } = require('../controllers/authController');
const controller = require('../controllers/workspaceMemberController');
const roleController = require('../controllers/workspaceRoleController');
const {
  validateObjectIdParam,
  validateInvitation,
  validateRoleAssignment,
  validateInvitationToken,
  validateMemberQuery,
  validateRoleCreate,
  validateRoleUpdate,
} = require('../middleware/validate');

/**
 * Workspace member and invitation routes.
 *
 * The workspace travels in the path rather than a header. These are new routes,
 * so there is no churn to avoid, and putting the tenant in the URL makes the
 * security boundary visible at the routing layer — a route without
 * `:workspaceId` is obviously not workspace-scoped.
 *
 * This is not the global workspace-context mechanism. Existing task routes are
 * untouched; how they acquire a workspace is the integration stage's problem.
 */
const router = express.Router();

router.use(protect);

// --- Members ---------------------------------------------------------------

router.get(
  '/:workspaceId/members',
  validateObjectIdParam('workspaceId'),
  validateMemberQuery,
  controller.listMembers
);

router.get(
  '/:workspaceId/members/:membershipId',
  validateObjectIdParam('workspaceId'),
  validateObjectIdParam('membershipId'),
  controller.getMember
);

// Role assignment is its own endpoint rather than a field on a generic update,
// so it can never be reached without passing the delegation rules.
router.patch(
  '/:workspaceId/members/:membershipId/role',
  validateObjectIdParam('workspaceId'),
  validateObjectIdParam('membershipId'),
  validateRoleAssignment,
  controller.assignMemberRole
);

router.patch(
  '/:workspaceId/members/:membershipId/suspend',
  validateObjectIdParam('workspaceId'),
  validateObjectIdParam('membershipId'),
  controller.suspendMember
);

router.patch(
  '/:workspaceId/members/:membershipId/reactivate',
  validateObjectIdParam('workspaceId'),
  validateObjectIdParam('membershipId'),
  controller.reactivateMember
);

router.delete(
  '/:workspaceId/members/:membershipId',
  validateObjectIdParam('workspaceId'),
  validateObjectIdParam('membershipId'),
  controller.removeMember
);

// --- Invitations -----------------------------------------------------------

router.get(
  '/:workspaceId/invitations',
  validateObjectIdParam('workspaceId'),
  validateMemberQuery,
  controller.listInvitations
);

router.post(
  '/:workspaceId/invitations',
  validateObjectIdParam('workspaceId'),
  validateInvitation,
  controller.createInvitation
);

router.delete(
  '/:workspaceId/invitations/:invitationId',
  validateObjectIdParam('workspaceId'),
  validateObjectIdParam('invitationId'),
  controller.revokeInvitation
);

// --- Roles -----------------------------------------------------------------

router.get(
  '/:workspaceId/roles',
  validateObjectIdParam('workspaceId'),
  validateMemberQuery,
  roleController.listRoles
);

// Declared before `/:roleId` so it is not swallowed by the parameterised route.
router.get(
  '/:workspaceId/roles/permissions',
  validateObjectIdParam('workspaceId'),
  roleController.listPermissions
);

router.get(
  '/:workspaceId/roles/:roleId',
  validateObjectIdParam('workspaceId'),
  validateObjectIdParam('roleId'),
  roleController.getRole
);

router.post(
  '/:workspaceId/roles',
  validateObjectIdParam('workspaceId'),
  validateRoleCreate,
  roleController.createRole
);

router.patch(
  '/:workspaceId/roles/:roleId',
  validateObjectIdParam('workspaceId'),
  validateObjectIdParam('roleId'),
  validateRoleUpdate,
  roleController.updateRole
);

router.delete(
  '/:workspaceId/roles/:roleId',
  validateObjectIdParam('workspaceId'),
  validateObjectIdParam('roleId'),
  roleController.deleteRole
);

module.exports = router;

/**
 * Acceptance lives outside the workspace path on purpose: the accepting user is
 * not a member yet, so there is nothing to scope the request to. Mounted
 * separately by app.js.
 */
const acceptRouter = express.Router();
acceptRouter.use(protect);
acceptRouter.post('/accept', validateInvitationToken, controller.acceptInvitation);

module.exports.acceptRouter = acceptRouter;
