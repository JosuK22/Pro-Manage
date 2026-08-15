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
      // Mongoose applies setters before validators, so `trim` turns a
      // whitespace-only name into '' and `required` then rejects it. No
      // separate "not blank" validator is needed — one here would never run.
      required: [true, 'Workspace name is required.'],
      trim: true,
      maxLength: [
        MAX_NAME_LENGTH,
        `Workspace name cannot be longer than ${MAX_NAME_LENGTH} characters.`,
      ],
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

    /**
     * Marks the one workspace a user gets automatically.
     *
     * Added in Stage 4 because ownership alone could not identify it. Once a
     * user can create additional workspaces, `findOne({ owner })` returns an
     * arbitrary document, so a re-run of the migration could bind tasks and
     * memberships to the wrong workspace. The partial unique index below makes
     * "at most one personal workspace per user" a database guarantee rather
     * than a convention the migration has to remember.
     *
     * Immutable: a personal workspace cannot be demoted into an ordinary one,
     * which would leave the user without a fallback board.
     */
    isPersonal: {
      type: Boolean,
      default: false,
      immutable: true,
    },
  },
  { timestamps: true }
);

// --- Indexes ---------------------------------------------------------------
// "Which workspaces does this person own?" is asked by the migration (to make
// it idempotent), by ownership transfer, and by the guard that stops an owner
// deleting their last workspace. Without this it is a collection scan.
workspaceSchema.index({ owner: 1 });

// At most one personal workspace per user, enforced by the database.
// Partial rather than sparse for the usual reason: a sparse unique index still
// indexes explicit `false` values, so every ordinary workspace would collide
// with every other one belonging to the same owner.
workspaceSchema.index(
  { owner: 1, isPersonal: 1 },
  { unique: true, partialFilterExpression: { isPersonal: true } }
);

const Workspace = mongoose.model('Workspace', workspaceSchema);

module.exports = Workspace;
module.exports.MAX_NAME_LENGTH = MAX_NAME_LENGTH;
module.exports.MAX_DESCRIPTION_LENGTH = MAX_DESCRIPTION_LENGTH;
