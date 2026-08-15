const AppError = require('../../utils/AppError');

/**
 * Every way an authorization decision can end in denial.
 *
 * Codes exist so tests and callers can branch on the *reason* without matching
 * on prose, and so internal diagnostics stay separate from what an API consumer
 * is told.
 */
const DENIAL = {
  // --- Identity ------------------------------------------------------------
  UNAUTHENTICATED: 'UNAUTHENTICATED',

  // --- Tenancy -------------------------------------------------------------
  WORKSPACE_NOT_FOUND: 'WORKSPACE_NOT_FOUND',
  NOT_A_MEMBER: 'NOT_A_MEMBER',
  MEMBERSHIP_INACTIVE: 'MEMBERSHIP_INACTIVE',

  // --- Integrity -----------------------------------------------------------
  ROLE_MISSING: 'ROLE_MISSING',
  ROLE_INTEGRITY_VIOLATION: 'ROLE_INTEGRITY_VIOLATION',
  OWNERSHIP_INTEGRITY_CONFLICT: 'OWNERSHIP_INTEGRITY_CONFLICT',

  // --- Request validity ----------------------------------------------------
  INVALID_PERMISSION: 'INVALID_PERMISSION',
  INVALID_SCOPE: 'INVALID_SCOPE',

  // --- Capability ----------------------------------------------------------
  PERMISSION_MISSING: 'PERMISSION_MISSING',
  SCOPE_INSUFFICIENT: 'SCOPE_INSUFFICIENT',
  OWNER_ONLY: 'OWNER_ONLY',

  // --- Resource ------------------------------------------------------------
  RESOURCE_MISSING: 'RESOURCE_MISSING',
  RESOURCE_OUTSIDE_WORKSPACE: 'RESOURCE_OUTSIDE_WORKSPACE',
  RESOURCE_OUTSIDE_SCOPE: 'RESOURCE_OUTSIDE_SCOPE',

  // --- Delegation ----------------------------------------------------------
  ROLE_ASSIGNMENT_FORBIDDEN: 'ROLE_ASSIGNMENT_FORBIDDEN',
  PERMISSION_GRANT_EXCEEDS_ACTOR: 'PERMISSION_GRANT_EXCEEDS_ACTOR',
};

/**
 * HTTP status per denial reason.
 *
 * 404 rather than 403 wherever a 403 would confirm that something exists:
 * "you are not a member of this workspace" and "this task is in a different
 * workspace" both tell an attacker that their guessed id was real. Anything
 * *inside* a workspace the actor genuinely belongs to can safely be a 403,
 * because they already know the workspace exists.
 */
const STATUS_BY_CODE = {
  [DENIAL.UNAUTHENTICATED]: 401,

  [DENIAL.WORKSPACE_NOT_FOUND]: 404,
  [DENIAL.NOT_A_MEMBER]: 404,
  [DENIAL.RESOURCE_MISSING]: 404,
  [DENIAL.RESOURCE_OUTSIDE_WORKSPACE]: 404,
};

const DEFAULT_STATUS = 403;

/** What an API consumer is allowed to be told. Never the reason. */
const PUBLIC_MESSAGE = {
  [DENIAL.UNAUTHENTICATED]: 'Please log in to access this resource.',
  [DENIAL.WORKSPACE_NOT_FOUND]: 'Workspace not found.',
  [DENIAL.NOT_A_MEMBER]: 'Workspace not found.',
  [DENIAL.RESOURCE_MISSING]: 'Not found.',
  [DENIAL.RESOURCE_OUTSIDE_WORKSPACE]: 'Not found.',
};

const DEFAULT_PUBLIC_MESSAGE = 'You do not have permission to do this.';

/**
 * A denial.
 *
 * `message` carries the diagnostic detail and is for logs and tests.
 * `publicMessage` is what may be returned over the wire — deliberately vague,
 * so a probe cannot map out someone else's workspace by reading error text.
 */
class AuthorizationError extends AppError {
  constructor(code, message, details = {}) {
    const status = STATUS_BY_CODE[code] ?? DEFAULT_STATUS;

    super(message || code, status);

    this.name = 'AuthorizationError';
    this.code = code;
    this.publicMessage = PUBLIC_MESSAGE[code] ?? DEFAULT_PUBLIC_MESSAGE;
    this.details = details;
  }
}

/** Build the structured denial that `check()` returns instead of throwing. */
const denial = (code, message, details = {}) => ({
  allowed: false,
  code,
  status: STATUS_BY_CODE[code] ?? DEFAULT_STATUS,
  message: message || code,
  publicMessage: PUBLIC_MESSAGE[code] ?? DEFAULT_PUBLIC_MESSAGE,
  details,
});

module.exports = {
  DENIAL,
  STATUS_BY_CODE,
  DEFAULT_STATUS,
  AuthorizationError,
  denial,
};
