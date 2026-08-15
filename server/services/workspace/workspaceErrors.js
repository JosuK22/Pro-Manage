const AppError = require('../../utils/AppError');

/**
 * Domain conflicts for member and invitation management.
 *
 * Deliberately separate from `AuthorizationError`: these are not "you may not",
 * they are "that does not make sense". An actor with every permission still
 * cannot invite somebody who is already a member.
 */
const DOMAIN = {
  MEMBER_NOT_FOUND: 'MEMBER_NOT_FOUND',
  ALREADY_MEMBER: 'ALREADY_MEMBER',
  MEMBER_SUSPENDED: 'MEMBER_SUSPENDED',
  ALREADY_SUSPENDED: 'ALREADY_SUSPENDED',
  NOT_SUSPENDED: 'NOT_SUSPENDED',

  INVITATION_NOT_FOUND: 'INVITATION_NOT_FOUND',
  INVITATION_ALREADY_PENDING: 'INVITATION_ALREADY_PENDING',
  INVITATION_EXPIRED: 'INVITATION_EXPIRED',
  INVITATION_REVOKED: 'INVITATION_REVOKED',
  INVITATION_ALREADY_ACCEPTED: 'INVITATION_ALREADY_ACCEPTED',
  INVITATION_INVALID: 'INVITATION_INVALID',

  ROLE_NOT_FOUND: 'ROLE_NOT_FOUND',
  ROLE_FROM_OTHER_WORKSPACE: 'ROLE_FROM_OTHER_WORKSPACE',

  // --- Role management (Stage 7) -------------------------------------------
  SYSTEM_ROLE_PROTECTED: 'SYSTEM_ROLE_PROTECTED',
  ROLE_IN_USE: 'ROLE_IN_USE',
  ROLE_NAME_ALREADY_EXISTS: 'ROLE_NAME_ALREADY_EXISTS',
  INVALID_ROLE_NAME: 'INVALID_ROLE_NAME',
  INVALID_PERMISSION: 'INVALID_PERMISSION',
  UNSUPPORTED_SCOPE: 'UNSUPPORTED_SCOPE',
  DUPLICATE_PERMISSION: 'DUPLICATE_PERMISSION',

  OWNER_PROTECTED: 'OWNER_PROTECTED',
  SELF_ACTION_NOT_ALLOWED: 'SELF_ACTION_NOT_ALLOWED',
};

const STATUS_BY_CODE = {
  [DOMAIN.MEMBER_NOT_FOUND]: 404,
  [DOMAIN.INVITATION_NOT_FOUND]: 404,
  [DOMAIN.ROLE_NOT_FOUND]: 404,

  // A role that exists but belongs elsewhere is reported as "not found" rather
  // than "wrong workspace" — confirming it exists would leak another
  // workspace's configuration.
  [DOMAIN.ROLE_FROM_OTHER_WORKSPACE]: 404,

  [DOMAIN.ALREADY_MEMBER]: 409,
  [DOMAIN.MEMBER_SUSPENDED]: 409,
  [DOMAIN.ALREADY_SUSPENDED]: 409,
  [DOMAIN.NOT_SUSPENDED]: 409,
  [DOMAIN.INVITATION_ALREADY_PENDING]: 409,

  [DOMAIN.INVITATION_EXPIRED]: 410,
  [DOMAIN.INVITATION_REVOKED]: 410,
  [DOMAIN.INVITATION_ALREADY_ACCEPTED]: 410,

  // Deliberately indistinguishable from the above at the API surface —
  // see `invitationService.acceptInvitation`.
  [DOMAIN.INVITATION_INVALID]: 400,

  [DOMAIN.OWNER_PROTECTED]: 409,
  [DOMAIN.SELF_ACTION_NOT_ALLOWED]: 409,

  [DOMAIN.SYSTEM_ROLE_PROTECTED]: 409,
  [DOMAIN.ROLE_IN_USE]: 409,
  [DOMAIN.ROLE_NAME_ALREADY_EXISTS]: 409,

  // Malformed submissions, not conflicts.
  [DOMAIN.INVALID_ROLE_NAME]: 400,
  [DOMAIN.INVALID_PERMISSION]: 400,
  [DOMAIN.UNSUPPORTED_SCOPE]: 400,
  [DOMAIN.DUPLICATE_PERMISSION]: 400,
};

class WorkspaceDomainError extends AppError {
  constructor(code, message, details = {}) {
    super(message, STATUS_BY_CODE[code] ?? 400);

    this.name = 'WorkspaceDomainError';
    this.code = code;
    // Domain conflicts are safe to state plainly: they describe the caller's
    // own workspace, which they already have permission to see.
    this.publicMessage = message;
    this.details = details;
  }
}

const domainError = (code, message, details) =>
  new WorkspaceDomainError(code, message, details);

module.exports = { DOMAIN, WorkspaceDomainError, domainError };
