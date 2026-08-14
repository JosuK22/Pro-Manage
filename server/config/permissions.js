/**
 * The permission catalogue.
 *
 * This is the canonical list. Roles may only reference keys that appear here,
 * so a client cannot invent a permission string and have it stored. It lives in
 * `config/` rather than being appended to `constants.js` because it will grow
 * with the product and is consumed by four separate concerns: the Role model,
 * the authorization engine, the role-management API and the frontend editor.
 *
 * `supportedScopes` is the honest answer to "does narrowing this permission
 * mean anything?". Creating a task cannot be scoped to tasks you already own,
 * so `tasks.create` supports only `workspace`. Viewing tasks obviously can be.
 */

/** The only scopes the system understands. Adding one is a deliberate act. */
const SCOPES = {
  OWN: 'own',
  ASSIGNED: 'assigned',
  WORKSPACE: 'workspace',
};

const SCOPE_VALUES = Object.values(SCOPES);

/**
 * Scopes widen in this order: own ⊆ assigned ⊆ workspace.
 *
 * `assigned` deliberately includes what you created — a task that vanished the
 * moment you saved it would be absurd — which is what makes the three
 * comparable rather than merely different.
 */
const SCOPE_RANK = {
  [SCOPES.OWN]: 1,
  [SCOPES.ASSIGNED]: 2,
  [SCOPES.WORKSPACE]: 3,
};

const RESOURCE_SCOPES = SCOPE_VALUES;
const WORKSPACE_ONLY = [SCOPES.WORKSPACE];

const PERMISSIONS = [
  // --- Tasks ---------------------------------------------------------------
  {
    key: 'tasks.view',
    label: 'View tasks',
    description: 'See tasks on the board.',
    category: 'Tasks',
    supportedScopes: RESOURCE_SCOPES,
  },
  {
    key: 'tasks.create',
    label: 'Create tasks',
    description: 'Add new tasks to the workspace.',
    category: 'Tasks',
    supportedScopes: WORKSPACE_ONLY,
  },
  {
    key: 'tasks.edit',
    label: 'Edit tasks',
    description: 'Change a task’s title, description or details.',
    category: 'Tasks',
    supportedScopes: RESOURCE_SCOPES,
  },
  {
    key: 'tasks.delete',
    label: 'Delete tasks',
    description: 'Permanently remove tasks.',
    category: 'Tasks',
    supportedScopes: RESOURCE_SCOPES,
  },
  {
    key: 'tasks.assign',
    label: 'Assign tasks',
    description: 'Assign tasks to workspace members.',
    category: 'Tasks',
    supportedScopes: WORKSPACE_ONLY,
  },
  {
    key: 'tasks.change_status',
    label: 'Move tasks',
    description: 'Move tasks between board columns.',
    category: 'Tasks',
    supportedScopes: RESOURCE_SCOPES,
  },
  {
    key: 'tasks.change_priority',
    label: 'Change priority',
    description: 'Set how urgent a task is.',
    category: 'Tasks',
    supportedScopes: RESOURCE_SCOPES,
  },
  {
    key: 'tasks.manage_checklists',
    label: 'Manage checklists',
    description: 'Add, edit and tick checklist items.',
    category: 'Tasks',
    supportedScopes: RESOURCE_SCOPES,
  },
  {
    key: 'tasks.share',
    label: 'Share tasks',
    description: 'Create public read-only share links.',
    category: 'Tasks',
    supportedScopes: RESOURCE_SCOPES,
  },

  // --- Members -------------------------------------------------------------
  {
    key: 'members.view',
    label: 'View members',
    description: 'See who belongs to the workspace.',
    category: 'Members',
    supportedScopes: WORKSPACE_ONLY,
  },
  {
    key: 'members.invite',
    label: 'Invite people',
    description: 'Send invitations to join the workspace.',
    category: 'Members',
    supportedScopes: WORKSPACE_ONLY,
  },
  {
    key: 'members.edit',
    label: 'Edit members',
    description: 'Change a member’s workspace details.',
    category: 'Members',
    supportedScopes: WORKSPACE_ONLY,
  },
  {
    key: 'members.remove',
    label: 'Remove members',
    description: 'Remove people from the workspace.',
    category: 'Members',
    supportedScopes: WORKSPACE_ONLY,
  },
  {
    key: 'members.suspend',
    label: 'Suspend members',
    description: 'Temporarily block a member’s access.',
    category: 'Members',
    supportedScopes: WORKSPACE_ONLY,
  },
  {
    key: 'members.assign_role',
    label: 'Assign roles',
    description: 'Change which role a member has.',
    category: 'Members',
    supportedScopes: WORKSPACE_ONLY,
  },
  {
    // Carried over from the Stage 2 architecture. This is what lets an Owner
    // decide whether Admins may create other Admins, instead of that rule
    // being hardcoded in a controller.
    key: 'members.assign_admin',
    label: 'Assign the Admin role',
    description: 'Grant or remove the Admin role. Owners can always do this.',
    category: 'Members',
    supportedScopes: WORKSPACE_ONLY,
  },

  // --- Roles ---------------------------------------------------------------
  {
    key: 'roles.view',
    label: 'View roles',
    description: 'See the workspace’s roles and their permissions.',
    category: 'Roles',
    supportedScopes: WORKSPACE_ONLY,
  },
  {
    key: 'roles.create',
    label: 'Create roles',
    description: 'Define new roles for the workspace.',
    category: 'Roles',
    supportedScopes: WORKSPACE_ONLY,
  },
  {
    key: 'roles.edit',
    label: 'Edit roles',
    description: 'Change a role’s name or permissions.',
    category: 'Roles',
    supportedScopes: WORKSPACE_ONLY,
  },
  {
    key: 'roles.delete',
    label: 'Delete roles',
    description: 'Remove roles that are no longer needed.',
    category: 'Roles',
    supportedScopes: WORKSPACE_ONLY,
  },

  // --- Analytics -----------------------------------------------------------
  {
    // Scopable on purpose: this is what lets one role see workspace-wide
    // figures while another sees only their own.
    key: 'analytics.view',
    label: 'View analytics',
    description: 'See task statistics and progress.',
    category: 'Analytics',
    supportedScopes: RESOURCE_SCOPES,
  },
  {
    key: 'analytics.export',
    label: 'Export analytics',
    description: 'Download analytics data.',
    category: 'Analytics',
    supportedScopes: WORKSPACE_ONLY,
  },

  // --- Workspace -----------------------------------------------------------
  {
    key: 'workspace.view',
    label: 'View workspace',
    description: 'See the workspace and its settings.',
    category: 'Workspace',
    supportedScopes: WORKSPACE_ONLY,
  },
  {
    key: 'workspace.edit',
    label: 'Edit workspace',
    description: 'Change the workspace name and description.',
    category: 'Workspace',
    supportedScopes: WORKSPACE_ONLY,
  },
  {
    key: 'workspace.manage',
    label: 'Manage workspace',
    description: 'Change workspace-wide configuration.',
    category: 'Workspace',
    supportedScopes: WORKSPACE_ONLY,
  },
  {
    key: 'workspace.delete',
    label: 'Delete workspace',
    description: 'Permanently delete the workspace. Owners only.',
    category: 'Workspace',
    supportedScopes: WORKSPACE_ONLY,
  },
];

/** Frozen so nothing at runtime can mutate the catalogue. */
Object.freeze(PERMISSIONS);
PERMISSIONS.forEach((permission) => {
  Object.freeze(permission);
  Object.freeze(permission.supportedScopes);
});

const PERMISSION_BY_KEY = new Map(PERMISSIONS.map((p) => [p.key, p]));
const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

const isValidPermissionKey = (key) => PERMISSION_BY_KEY.has(key);

/** Is `scope` meaningful for this permission? */
const isValidScopeFor = (key, scope) => {
  const permission = PERMISSION_BY_KEY.get(key);
  if (!permission) return false;
  return permission.supportedScopes.includes(scope);
};

/** The widest scope a permission allows — used as the default when none is given. */
const defaultScopeFor = (key) => {
  const permission = PERMISSION_BY_KEY.get(key);
  if (!permission) return null;
  return permission.supportedScopes[permission.supportedScopes.length - 1];
};

/** True when `a` is at least as wide as `b`. Used later by the ceiling rule. */
const scopeCovers = (a, b) => (SCOPE_RANK[a] ?? 0) >= (SCOPE_RANK[b] ?? 0);

/** Grouped for the future role editor. */
const PERMISSION_CATEGORIES = PERMISSIONS.reduce((acc, permission) => {
  if (!acc.includes(permission.category)) acc.push(permission.category);
  return acc;
}, []);

module.exports = {
  SCOPES,
  SCOPE_VALUES,
  SCOPE_RANK,
  PERMISSIONS,
  PERMISSION_KEYS,
  PERMISSION_BY_KEY,
  PERMISSION_CATEGORIES,
  isValidPermissionKey,
  isValidScopeFor,
  defaultScopeFor,
  scopeCovers,
};
