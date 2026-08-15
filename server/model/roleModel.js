const mongoose = require('mongoose');

const {
  SCOPE_VALUES,
  SCOPES,
  isValidPermissionKey,
  isValidScopeFor,
  defaultScopeFor,
} = require('../config/permissions');

const MAX_NAME_LENGTH = 60;
const MAX_DESCRIPTION_LENGTH = 300;

/**
 * Stable identifiers for the three protected roles.
 *
 * The *display name* is deliberately not the identity: a workspace may one day
 * rename "Member" to "Student" or "Contributor" without the backend losing
 * track of which role is the protected fallback.
 */
const SYSTEM_ROLES = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  MEMBER: 'MEMBER',
};

const SYSTEM_ROLE_KEYS = Object.values(SYSTEM_ROLES);

/**
 * Rank exists for exactly one question: may this actor hand out this role?
 * It is not a hierarchy of capability — capability comes from permissions.
 */
const SYSTEM_ROLE_RANK = {
  [SYSTEM_ROLES.OWNER]: 100,
  [SYSTEM_ROLES.ADMIN]: 50,
  [SYSTEM_ROLES.MEMBER]: 10,
};

const DEFAULT_RANK = 10;

/**
 * A single granted permission.
 *
 * Stored as a subdocument rather than a bare string so a scope can travel with
 * it. `{ key: 'tasks.view', scope: 'assigned' }` is the difference between a
 * student seeing their own work and seeing the whole class's.
 */
const grantedPermissionSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: [true, 'A permission needs a key.'],
      trim: true,
      validate: {
        // The catalogue is the allowlist. A client cannot invent a permission
        // string and have it persisted.
        validator: isValidPermissionKey,
        message: (props) => `'${props.value}' is not a known permission.`,
      },
    },
    scope: {
      type: String,
      enum: {
        values: SCOPE_VALUES,
        message: `Scope must be one of: ${SCOPE_VALUES.join(', ')}.`,
      },
      default: SCOPES.WORKSPACE,
    },
  },
  { _id: false }
);

const roleSchema = new mongoose.Schema(
  {
    /**
     * Roles are always workspace-scoped. There is deliberately no global
     * "Teacher" role — business roles belong to the organization that defined
     * them, not to the product.
     */
    workspace: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Workspace',
      required: [true, 'A role must belong to a workspace.'],
      immutable: true,
    },

    name: {
      type: String,
      // As on Workspace: `trim` runs before validation, so a whitespace-only
      // name arrives at `required` as '' and is rejected there.
      required: [true, 'Role name is required.'],
      trim: true,
      maxLength: [
        MAX_NAME_LENGTH,
        `Role name cannot be longer than ${MAX_NAME_LENGTH} characters.`,
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

    permissions: {
      type: [grantedPermissionSchema],
      default: [],
      validate: {
        // A role granting the same key twice is ambiguous about which scope
        // wins, so reject it rather than silently picking one.
        validator: (values) => {
          const keys = values.map((entry) => entry.key);
          return keys.length === new Set(keys).size;
        },
        message: 'A role cannot grant the same permission twice.',
      },
    },

    isSystemRole: {
      type: Boolean,
      default: false,
    },

    systemKey: {
      type: String,
      enum: {
        values: [...SYSTEM_ROLE_KEYS, null],
        message: `System key must be one of: ${SYSTEM_ROLE_KEYS.join(', ')}.`,
      },
      default: null,
    },

    /** The role new members receive when none is specified. */
    isDefault: {
      type: Boolean,
      default: false,
    },

    rank: {
      type: Number,
      default: DEFAULT_RANK,
      min: [0, 'Rank cannot be negative.'],
    },
  },
  { timestamps: true }
);

// --- Indexes ---------------------------------------------------------------
// Role names are unique *within* a workspace, never globally: two different
// organizations may both have a "Developer". Collation strength 2 makes the
// comparison case-insensitive, so "Developer" and "developer" collide — which
// is what an administrator would expect.
roleSchema.index(
  { workspace: 1, name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } }
);

// A workspace must never end up with two Owner roles. A *partial* index (not
// sparse) is required here: sparse still indexes explicit nulls, so every
// custom role — all of which have `systemKey: null` — would collide with each
// other. Restricting the index to string values sidesteps that entirely.
roleSchema.index(
  { workspace: 1, systemKey: 1 },
  { unique: true, partialFilterExpression: { systemKey: { $type: 'string' } } }
);

// --- Integrity -------------------------------------------------------------

roleSchema.pre('validate', function (next) {
  // The two system fields must agree. A role flagged as a system role with no
  // stable key is unidentifiable; a custom role carrying one is a system role
  // in disguise and would dodge the deletion guard.
  if (this.isSystemRole && !this.systemKey) {
    return next(new Error('A system role must have a systemKey.'));
  }

  if (!this.isSystemRole && this.systemKey) {
    return next(new Error('A custom role cannot have a systemKey.'));
  }

  // Fill in the widest scope the permission allows when the caller did not say.
  // Then reject any scope that is meaningless for its key — `tasks.create`
  // scoped to `own` would read as a rule but enforce nothing.
  for (const entry of this.permissions ?? []) {
    if (!entry.key || !isValidPermissionKey(entry.key)) continue;

    if (!entry.scope) entry.scope = defaultScopeFor(entry.key);

    if (!isValidScopeFor(entry.key, entry.scope)) {
      return next(
        new Error(`Scope '${entry.scope}' is not supported by '${entry.key}'.`)
      );
    }
  }

  // Keep rank consistent with the system role it claims to be.
  if (this.isSystemRole && SYSTEM_ROLE_RANK[this.systemKey] !== undefined) {
    this.rank = SYSTEM_ROLE_RANK[this.systemKey];
  }

  next();
});

/** Convenience for the authorization engine and tests. */
roleSchema.methods.permissionMap = function () {
  return new Map((this.permissions ?? []).map((entry) => [entry.key, entry.scope]));
};

const Role = mongoose.model('Role', roleSchema);

module.exports = Role;
module.exports.SYSTEM_ROLES = SYSTEM_ROLES;
module.exports.SYSTEM_ROLE_KEYS = SYSTEM_ROLE_KEYS;
module.exports.SYSTEM_ROLE_RANK = SYSTEM_ROLE_RANK;
module.exports.DEFAULT_RANK = DEFAULT_RANK;
module.exports.MAX_NAME_LENGTH = MAX_NAME_LENGTH;
