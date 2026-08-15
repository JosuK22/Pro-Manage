/**
 * Turning a role into a set of effective permissions.
 *
 * Pure: it takes a role and an ownership flag and returns a map. Nothing here
 * touches the database, so the capability rules can be audited on their own.
 */

const {
  PERMISSIONS,
  PERMISSION_KEYS,
  isValidPermissionKey,
  defaultScopeFor,
  scopeCovers,
} = require('../../config/permissions');
const { SYSTEM_ROLES, SYSTEM_ROLE_RANK, DEFAULT_RANK } = require('../../model/roleModel');

/**
 * Operations the workspace owner must personally authorise.
 *
 * Holding the permission is not enough — the actor must also *be*
 * `workspace.owner`. This is the one place ownership adds a restriction rather
 * than removing one, and the list is deliberately tiny: only deleting the
 * workspace, which is unrecoverable and which an Admin should not be able to do
 * on their own. Everything else is governed by permissions alone.
 */
const OWNER_ONLY_PERMISSIONS = new Set(['workspace.delete']);

/**
 * The workspace owner's effective permissions.
 *
 * Every catalogue permission at its widest supported scope, computed rather
 * than stored. This is why editing the Owner role's permission array cannot
 * strip the owner's authority: authorization never reads that array for them.
 *
 * The Owner *role* exists so the members list has something to display; the
 * authority itself comes from `Workspace.owner`.
 */
const ownerPermissionMap = () => {
  const map = new Map();
  for (const key of PERMISSION_KEYS) {
    map.set(key, defaultScopeFor(key));
  }
  return map;
};

/**
 * `{ key, scope }[]` → `Map<key, scope>`.
 *
 * Works with both hydrated documents and lean objects, so callers are not
 * forced into one or the other.
 */
const rolePermissionMap = (role) => {
  const map = new Map();

  for (const entry of role?.permissions ?? []) {
    if (!entry?.key || !isValidPermissionKey(entry.key)) continue;
    map.set(entry.key, entry.scope ?? defaultScopeFor(entry.key));
  }

  return map;
};

/**
 * What can this actor do in this workspace?
 *
 * @param {{ role: object, isOwner: boolean }} input
 * @returns {Map<string, string>} permission key → granted scope
 */
const effectivePermissions = ({ role, isOwner = false }) =>
  isOwner ? ownerPermissionMap() : rolePermissionMap(role);

/**
 * The actor's rank, used *only* to decide which roles they may hand out.
 *
 * Rank is not a capability hierarchy — a rank-50 Admin has no more capability
 * than their permissions grant. It answers one question and no others.
 */
const actorRank = ({ role, isOwner = false }) => {
  if (isOwner) return SYSTEM_ROLE_RANK[SYSTEM_ROLES.OWNER];
  if (typeof role?.rank === 'number') return role.rank;
  return DEFAULT_RANK;
};

/**
 * May this actor hand out this role?
 *
 * Three rules, in order:
 *
 *   1. OWNER is never assignable. Ownership moves through an explicit transfer,
 *      never by editing somebody's role — otherwise anyone with
 *      `members.assign_role` could crown themselves.
 *   2. ADMIN needs `members.assign_admin`, which only the owner can grant
 *      (granting is itself bounded by the ceiling rule below). This is how an
 *      owner delegates admin-making without it being hardcoded.
 *   3. Everything else needs a strictly higher rank than the target, so an
 *      Admin cannot mint peers.
 *
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
const canAssignRole = ({ targetRole, permissions, rank, isOwner = false }) => {
  if (!targetRole) return { ok: false, reason: 'target role does not exist' };

  if (targetRole.systemKey === SYSTEM_ROLES.OWNER) {
    return {
      ok: false,
      reason: 'the Owner role cannot be assigned; use ownership transfer',
    };
  }

  if (targetRole.systemKey === SYSTEM_ROLES.ADMIN) {
    const mayAssignAdmin = isOwner || permissions.has('members.assign_admin');
    return mayAssignAdmin
      ? { ok: true }
      : { ok: false, reason: 'assigning the Admin role requires members.assign_admin' };
  }

  const targetRank = typeof targetRole.rank === 'number' ? targetRole.rank : DEFAULT_RANK;

  if (rank <= targetRank) {
    return {
      ok: false,
      reason: `cannot assign a role ranked ${targetRank} from rank ${rank}`,
    };
  }

  return { ok: true };
};

/**
 * The ceiling rule: you cannot grant what you do not hold.
 *
 * Without this, `roles.create` is a privilege-escalation primitive — mint a
 * role carrying `workspace.delete`, assign it to yourself, done. The scope
 * check matters as much as the key check: granting `tasks.edit: workspace`
 * when you only hold `tasks.edit: own` would be an escalation too.
 *
 * @returns {{ ok: true } | { ok: false, reason: string, permission: string }}
 */
const canGrantPermissions = ({ permissions, requested = [], isOwner = false }) => {
  if (isOwner) return { ok: true };

  for (const entry of requested) {
    const key = entry?.key ?? entry;

    if (!isValidPermissionKey(key)) {
      return { ok: false, permission: String(key), reason: 'unknown permission' };
    }

    if (!permissions.has(key)) {
      return { ok: false, permission: key, reason: 'actor does not hold this permission' };
    }

    const requestedScope = entry?.scope ?? defaultScopeFor(key);

    if (!scopeCovers(permissions.get(key), requestedScope)) {
      return {
        ok: false,
        permission: key,
        reason: `actor's scope '${permissions.get(key)}' does not cover '${requestedScope}'`,
      };
    }
  }

  return { ok: true };
};

module.exports = {
  OWNER_ONLY_PERMISSIONS,
  PERMISSIONS,
  ownerPermissionMap,
  rolePermissionMap,
  effectivePermissions,
  actorRank,
  canAssignRole,
  canGrantPermissions,
};
