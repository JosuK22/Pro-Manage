const crypto = require('crypto');
const mongoose = require('mongoose');

const { EMAIL_REGEX } = require('../middleware/validate');

const INVITATION_STATUSES = ['pending', 'accepted', 'expired', 'revoked'];

/**
 * A pending offer of membership.
 *
 * Kept separate from WorkspaceMembership on purpose: an invitation is a
 * *conversation with an email address*, not a member. It may be sent to someone
 * who has no account at all, and it must be able to expire or be revoked
 * without leaving a half-real member behind.
 *
 * This is what preserves the existing product behaviour of assigning work to a
 * person who has not signed up yet — the invitation holds the email, and a real
 * membership is created only when they accept.
 */
const workspaceInvitationSchema = new mongoose.Schema(
  {
    workspace: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: [true, 'An invitation must belong to a workspace.'],
      immutable: true,
    },

    /**
     * Always normalised. `John@Example.com` and `john@example.com` are the same
     * person, and storing both casings would let one person hold two pending
     * invitations to the same workspace.
     */
    email: {
      type: String,
      required: [true, 'An invitation needs an email address.'],
      trim: true,
      lowercase: true,
      validate: {
        validator: (value) => EMAIL_REGEX.test(value),
        message: 'Please enter a valid email address.',
      },
    },

    role: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Role',
      required: [true, 'An invitation must specify a role.'],
    },

    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'An invitation must record who sent it.'],
    },

    /**
     * Only the hash is stored. The raw token goes in the invitation link and is
     * never persisted, so a database leak cannot be replayed into workspace
     * access. `select: false` keeps it out of ordinary reads as well.
     */
    tokenHash: {
      type: String,
      default: null,
      select: false,
    },

    status: {
      type: String,
      enum: {
        values: INVITATION_STATUSES,
        message: `Status must be one of: ${INVITATION_STATUSES.join(', ')}.`,
      },
      default: 'pending',
    },

    /**
     * Set by the invitation service, not by the model — the lifetime of an
     * invitation is a product decision, and hardcoding a magic duration here
     * would put it in the wrong layer.
     */
    expiresAt: {
      type: Date,
      default: null,
    },

    acceptedAt: {
      type: Date,
      default: null,
    },

    /** Who actually accepted — may differ from nobody only after registration. */
    acceptedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

// --- Indexes ---------------------------------------------------------------

// At most one *pending* invitation per workspace + email. A partial index is
// what makes this expressible: a plain unique index would also forbid a second
// invitation after the first was revoked or expired, which is a legitimate
// thing to want. Re-inviting therefore means revoking or replacing the
// outstanding one first.
workspaceInvitationSchema.index(
  { workspace: 1, email: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } }
);

// "Do I have any invitations waiting?" — looked up by email at registration and
// at login, to claim anything outstanding.
workspaceInvitationSchema.index({ email: 1, status: 1 });

// The workspace's own pending-invitation list, shown beside its members.
workspaceInvitationSchema.index({ workspace: 1, status: 1 });

// --- Integrity -------------------------------------------------------------

/** An invitation must not offer a role belonging to some other workspace. */
workspaceInvitationSchema.pre('validate', async function (next) {
  if (!this.workspace || !this.role) return next();
  if (!this.isModified('role') && !this.isNew) return next();

  const Role = mongoose.model('Role');
  const role = await Role.findById(this.role).select('workspace');

  if (!role) {
    return next(new Error('The invited role does not exist.'));
  }

  if (!role.workspace.equals(this.workspace)) {
    return next(new Error('A role must belong to the same workspace as the invitation.'));
  }

  next();
});

/**
 * Expiry is derived, never a stored flag.
 *
 * A boolean would need a sweeper job to stay true, and would be wrong in the
 * window before it ran. The invitation service still writes `status: 'expired'`
 * when it retires one, but authorization can rely on this regardless.
 */
workspaceInvitationSchema.virtual('isExpired').get(function () {
  if (!this.expiresAt) return false;
  return Date.now() > this.expiresAt.getTime();
});

/** Usable only while pending and not past its expiry. */
workspaceInvitationSchema.virtual('isUsable').get(function () {
  return this.status === 'pending' && !this.isExpired;
});

workspaceInvitationSchema.set('toJSON', { virtuals: true });
workspaceInvitationSchema.set('toObject', { virtuals: true });

/**
 * Mint a raw token and its hash.
 *
 * Returned as a pair so the caller can put the raw value in the emailed link
 * and persist only the digest. SHA-256 is appropriate here rather than bcrypt:
 * the token is 32 bytes of CSPRNG output, so it has no guessable structure to
 * protect against brute force, and lookups must be fast.
 */
workspaceInvitationSchema.statics.createToken = function () {
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
};

/** Hash a presented token so it can be compared against stored digests. */
workspaceInvitationSchema.statics.hashToken = function (raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
};

const WorkspaceInvitation = mongoose.model(
  'WorkspaceInvitation',
  workspaceInvitationSchema
);

module.exports = WorkspaceInvitation;
module.exports.INVITATION_STATUSES = INVITATION_STATUSES;
