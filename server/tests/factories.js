/**
 * Test factories.
 *
 * Why this exists
 * ---------------
 * `registerUser` and `createTask` were defined twice — once in
 * stage2.security.test.js and again, byte-identical, in stage3.data.test.js.
 * Two copies of a fixture drift exactly the way two copies of anything else do.
 *
 * More importantly, the RBAC migration is about to add a workspace dimension to
 * every authenticated request. `authHeaders` below is the single place that
 * will learn to send `X-Workspace-Id`, so Stage 8 changes one function instead
 * of the ~46 call sites across the suite.
 *
 * Stage 3 added the workspace graph: `createWorkspace`, `createRole`,
 * `createMember` and the `setupWorkspace` composite.
 */

const request = require('supertest');

const app = require('../app');
const Workspace = require('../model/workspaceModel');
const Role = require('../model/roleModel');
const WorkspaceMembership = require('../model/workspaceMembershipModel');
const { SYSTEM_ROLES, SYSTEM_ROLE_RANK } = require('../model/roleModel');

const DEFAULT_PASSWORD = 'a-good-long-password';

/**
 * Unique by default.
 *
 * The old helpers both defaulted to `user@example.com`, which only worked
 * because the database is wiped between tests — two `registerUser()` calls in
 * one test would collide on the unique email index. Callers that care about the
 * address still pass it explicitly.
 */
let sequence = 0;
const uniqueEmail = (prefix = 'user') => `${prefix}${(sequence += 1)}@example.com`;

/**
 * An "actor" is whatever a test has to hand:
 *   - a raw token string            (legacy call sites)
 *   - { token, workspace? }         (preferred)
 *
 * Returns the headers that identify it to the API. This is the seam the
 * workspace header will be added to.
 */
const authHeaders = (actor) => {
  if (!actor) return {};

  const token = typeof actor === 'string' ? actor : actor.token;
  const workspace = typeof actor === 'string' ? null : actor.workspace;

  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (workspace) headers['X-Workspace-Id'] = String(workspace._id ?? workspace);

  return headers;
};

/** Apply an actor's headers to a supertest request and return it for chaining. */
const withAuth = (req, actor) => {
  Object.entries(authHeaders(actor)).forEach(([key, value]) => req.set(key, value));
  return req;
};

/**
 * Register a user through the real API rather than the model, so the fixture
 * exercises the same hashing and validation path production does.
 */
const createUser = async (overrides = {}) => {
  // Opt-in rather than automatic. Registration does not yet create a workspace
  // in production, so defaulting this to `true` would make fixtures describe a
  // system that does not exist and would add three writes to forty tests that
  // never look at them. The default flips in Stage 8, when tasks actually
  // require a workspace.
  const { withWorkspace = false, workspaceName, ...userOverrides } = overrides;

  const payload = {
    name: 'Test User',
    email: uniqueEmail(),
    password: DEFAULT_PASSWORD,
    confirmPassword: DEFAULT_PASSWORD,
    ...userOverrides,
  };

  const res = await request(app).post('/api/v1/auth/register').send(payload).expect(201);

  const actor = {
    user: res.body.data.info,
    token: res.body.data.token,
    email: payload.email,
    password: payload.password,
  };

  if (!withWorkspace) return actor;

  const { workspace, roles } = await createWorkspace({
    owner: actor.user._id,
    name: workspaceName ?? `${payload.name}'s Workspace`,
  });

  await createMember({
    workspace,
    user: actor.user._id,
    role: roles.owner,
  });

  return { ...actor, workspace, roles };
};

/**
 * A workspace plus the three protected roles every workspace is seeded with.
 *
 * Seeding happens here rather than in a model hook so the roles are visible in
 * the test's own setup — a hidden side effect that silently creates three
 * documents makes failures much harder to read.
 */
const createWorkspace = async ({ owner, name = 'Test Workspace', description = '' } = {}) => {
  const workspace = await Workspace.create({ owner, name, description });

  const [ownerRole, adminRole, memberRole] = await Promise.all([
    Role.create({
      workspace: workspace._id,
      name: 'Owner',
      description: 'Full authority over the workspace.',
      isSystemRole: true,
      systemKey: SYSTEM_ROLES.OWNER,
      rank: SYSTEM_ROLE_RANK.OWNER,
    }),
    Role.create({
      workspace: workspace._id,
      name: 'Admin',
      description: 'Manages members, roles and tasks.',
      isSystemRole: true,
      systemKey: SYSTEM_ROLES.ADMIN,
      rank: SYSTEM_ROLE_RANK.ADMIN,
      permissions: [
        { key: 'workspace.view' },
        { key: 'workspace.edit' },
        { key: 'members.view' },
        { key: 'members.invite' },
        { key: 'members.remove' },
        { key: 'members.assign_role' },
        { key: 'roles.view' },
        { key: 'roles.create' },
        { key: 'roles.edit' },
        { key: 'roles.delete' },
        { key: 'tasks.view', scope: 'workspace' },
        { key: 'tasks.create' },
        { key: 'tasks.edit', scope: 'workspace' },
        { key: 'tasks.delete', scope: 'workspace' },
        { key: 'tasks.assign' },
        { key: 'tasks.change_status', scope: 'workspace' },
        { key: 'analytics.view', scope: 'workspace' },
      ],
    }),
    Role.create({
      workspace: workspace._id,
      name: 'Member',
      description: 'Works on the tasks assigned to them.',
      isSystemRole: true,
      systemKey: SYSTEM_ROLES.MEMBER,
      rank: SYSTEM_ROLE_RANK.MEMBER,
      isDefault: true,
      // Deliberately no tasks.delete — assignment and deletion are separate
      // concepts under the new model.
      permissions: [
        { key: 'workspace.view' },
        { key: 'members.view' },
        { key: 'tasks.view', scope: 'assigned' },
        { key: 'tasks.change_status', scope: 'assigned' },
        { key: 'tasks.manage_checklists', scope: 'assigned' },
        { key: 'analytics.view', scope: 'own' },
      ],
    }),
  ]);

  return {
    workspace,
    roles: { owner: ownerRole, admin: adminRole, member: memberRole },
  };
};

/** A custom role. `permissions` accepts `'tasks.view'` or `{ key, scope }`. */
const createRole = async ({ workspace, name, permissions = [], description = '' }) => {
  const normalised = permissions.map((entry) =>
    typeof entry === 'string' ? { key: entry } : entry
  );

  return Role.create({
    workspace: workspace._id ?? workspace,
    name: name ?? `Role ${(sequence += 1)}`,
    description,
    permissions: normalised,
  });
};

/**
 * Put a person in a workspace.
 *
 * Pass an existing `user`/actor, or omit it and a fresh user is registered —
 * which is what makes `createMember({ workspace, role })` read as one line in a
 * permission test.
 */
const createMember = async ({ workspace, role, user, actor } = {}) => {
  const resolved = actor ?? (user ? { user: { _id: user._id ?? user } } : await createUser());

  const membership = await WorkspaceMembership.create({
    workspace: workspace._id ?? workspace,
    user: resolved.user._id,
    role: role._id ?? role,
  });

  return { ...resolved, workspace, role, membership };
};

/**
 * The common arrangement: one workspace with an owner, an admin and a member.
 *
 * Named so the side effects are obvious — it says "setup", and it creates
 * exactly the three people the name implies, nothing more.
 */
const setupWorkspace = async ({ name = 'Test Workspace' } = {}) => {
  const owner = await createUser({ withWorkspace: true, workspaceName: name });
  const { workspace, roles } = owner;

  const admin = await createMember({ workspace, role: roles.admin });
  const member = await createMember({ workspace, role: roles.member });

  return { workspace, roles, owner, admin, member };
};

/** The minimum body the task API accepts. */
const taskPayload = (overrides = {}) => ({
  title: 'A task',
  priority: 'low',
  checklists: [{ title: 'step', checked: false }],
  ...overrides,
});

/**
 * Returns the unresolved supertest request so callers keep control of the
 * assertion — several tests deliberately expect 400 or 413 here, so this must
 * not bake in `.expect(201)`.
 */
const createTask = (actor, overrides = {}) =>
  withAuth(request(app).post('/api/v1/tasks'), actor).send(taskPayload(overrides));

/** GET /tasks for an actor, chainable. */
const listTasks = (actor, query = {}) =>
  withAuth(request(app).get('/api/v1/tasks'), actor).query(query);

module.exports = {
  DEFAULT_PASSWORD,
  uniqueEmail,
  authHeaders,
  withAuth,
  createUser,
  createTask,
  listTasks,
  taskPayload,
  createWorkspace,
  createRole,
  createMember,
  setupWorkspace,
};
