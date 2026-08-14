const mongoose = require('mongoose');

/**
 * Membership statuses.
 *
 * Deliberately does NOT include `invited`. An invitation has its own lifecycle
 * (pending → accepted / expired / revoked) and belongs to
 * `workspaceInvitationModel`. Overloading membership status to carry both would
 * mean every membership query has to remember to exclude people who have not
 * actually joined — exactly the kind of implicit rule that gets forgotten once.
 */
const MEMBERSHIP_STATUSES = ['active', 'suspended'];

/**
 * The link between a User and a Workspace, and the only place workspace-specific
 * role information is allowed to live.
 *
 * The same person can be an Owner here, a Photographer there and a Student
 * somewhere else — which is precisely why none of this is stored on User.
 */
const workspaceMembershipSchema = new mongoose.Schema(
  {
    workspace: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: [true, 'A membership must belong to a workspace.'],
      immutable: true,
    },

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'A membership must belong to a user.'],
      immutable: true,
    },

    role: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Role',
      required: [true, 'A membership must have a role.'],
    },

    status: {
      type: String,
      enum: {
        values: MEMBERSHIP_STATUSES,
        message: `Status must be one of: ${MEMBERSHIP_STATUSES.join(', ')}.`,
      },
      default: 'active',
    },

    /** Null for the founding owner, set for everyone who was invited in. */
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    joinedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// --- Indexes ---------------------------------------------------------------

// The critical one. A person cannot hold two memberships in the same
// workspace, so "which role does this user have here?" always has exactly one
// answer. Enforced by the database rather than by a check two concurrent
// requests could both pass.
workspaceMembershipSchema.index({ workspace: 1, user: 1 }, { unique: true });

// "Which workspaces can I switch to?" — the workspace switcher's query, and
// resolved on every authenticated request once workspace resolution lands.
workspaceMembershipSchema.index({ user: 1, status: 1 });

// The members screen: list a workspace's people, optionally filtered by status.
workspaceMembershipSchema.index({ workspace: 1, status: 1 });

// "How many members still use this role?" — the guard that refuses to delete a
// role that is in use. Without role in the key this counts by scanning the
// whole workspace's membership list.
workspaceMembershipSchema.index({ workspace: 1, role: 1 });

// --- Integrity -------------------------------------------------------------

/**
 * A membership must never point at a role from a different workspace.
 *
 * Allowing it would be a privilege-escalation primitive: create a permissive
 * role in a workspace you own, then attach it to your membership somewhere
 * else. The schema cannot express a cross-document constraint, so it is
 * enforced here — and must be re-checked at the service layer, since a raw
 * `updateOne` bypasses document middleware entirely.
 */
workspaceMembershipSchema.pre('validate', async function (next) {
  if (!this.workspace || !this.role) return next();
  if (!this.isModified('role') && !this.isNew) return next();

  const Role = mongoose.model('Role');
  const role = await Role.findById(this.role).select('workspace');

  if (!role) {
    return next(new Error('The assigned role does not exist.'));
  }

  if (!role.workspace.equals(this.workspace)) {
    return next(new Error('A role must belong to the same workspace as the membership.'));
  }

  next();
});

const WorkspaceMembership = mongoose.model(
  'WorkspaceMembership',
  workspaceMembershipSchema
);

module.exports = WorkspaceMembership;
module.exports.MEMBERSHIP_STATUSES = MEMBERSHIP_STATUSES;
