const mongoose = require('mongoose');

const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;

/**
 * A workspace is the collaboration, membership, authorization and task
 * boundary all at once. The application attaches no meaning to what it
 * represents — a class, an agency, a team and one person's private board are
 * all the same shape.
 *
 * This model enforces structural integrity only. Whether a given user may
 * *do* anything here is a question for Membership + Role + the authorization
 * engine, not for the schema.
 */
const workspaceSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Workspace name is required.'],
      trim: true,
      maxLength: [
        MAX_NAME_LENGTH,
        `Workspace name cannot be longer than ${MAX_NAME_LENGTH} characters.`,
      ],
      validate: {
        // `trim` turns "   " into "", but `required` has already passed by
        // then, so a whitespace-only name would otherwise slip through.
        validator: (value) => typeof value === 'string' && value.trim().length > 0,
        message: 'Workspace name cannot be empty.',
      },
    },

    description: {
      type: String,
      trim: true,
      default: '',
      maxLength: [
        MAX_DESCRIPTION_LENGTH,
        `Description cannot be longer than ${MAX_DESCRIPTION_LENGTH} characters.`,
      ],
    },

    /**
     * The authoritative record of who owns this workspace.
     *
     * The Owner *role* exists too, but only so the members list has something
     * to display. Authorization reads this field, which is why owner authority
     * cannot be revoked by editing a role's permission array.
     */
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'A workspace must have an owner.'],
      validate: {
        validator: async function (value) {
          // Resolved lazily rather than by requiring the module, so model load
          // order can never introduce a cycle.
          const User = mongoose.model('User');
          return Boolean(await User.exists({ _id: value }));
        },
        message: 'The workspace owner must be an existing user.',
      },
    },
  },
  { timestamps: true }
);

// --- Indexes ---------------------------------------------------------------
// "Which workspaces does this person own?" is asked by the migration (to make
// it idempotent), by ownership transfer, and by the guard that stops an owner
// deleting their last workspace. Without this it is a collection scan.
workspaceSchema.index({ owner: 1 });

const Workspace = mongoose.model('Workspace', workspaceSchema);

module.exports = Workspace;
module.exports.MAX_NAME_LENGTH = MAX_NAME_LENGTH;
module.exports.MAX_DESCRIPTION_LENGTH = MAX_DESCRIPTION_LENGTH;
