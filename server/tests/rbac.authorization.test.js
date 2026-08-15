const mongoose = require('mongoose');

const Task = require('../model/taskModel');
const Role = require('../model/roleModel');
const Workspace = require('../model/workspaceModel');
const WorkspaceMembership = require('../model/workspaceMembershipModel');
const { SYSTEM_ROLES } = require('../model/roleModel');

const {
  check,
  authorize,
  resolveContext,
  scopedFilter,
  checkRoleAssignment,
  checkPermissionGrant,
  DENIAL,
  AuthorizationError,
  isScopeSatisfied,
  isTaskWithinScope,
  taskScopeFilter,
  resolveRequestedScope,
  effectivePermissions,
} = require('../services/authorization');

const { createUser, createRole, createMember, setupWorkspace } = require('./factories');

const anId = () => new mongoose.Types.ObjectId();

/** A task written straight to the collection so workspace/assignee are exact. */
const makeTask = (overrides = {}) =>
  Task.create({
    title: 'A task',
    priority: 'low',
    checklists: [{ title: 'step' }],
    ...overrides,
  });

describe('Stage 5 — authorization engine', () => {
  // ===========================================================================
  // Pure policy — no database
  // ===========================================================================
  describe('scope hierarchy (pure)', () => {
    it('lets workspace satisfy every narrower scope', () => {
      expect(isScopeSatisfied('workspace', 'workspace')).toBe(true);
      expect(isScopeSatisfied('workspace', 'assigned')).toBe(true);
      expect(isScopeSatisfied('workspace', 'own')).toBe(true);
    });

    it('lets assigned satisfy assigned and own, but not workspace', () => {
      expect(isScopeSatisfied('assigned', 'assigned')).toBe(true);
      expect(isScopeSatisfied('assigned', 'own')).toBe(true);
      expect(isScopeSatisfied('assigned', 'workspace')).toBe(false);
    });

    it('lets own satisfy only own', () => {
      expect(isScopeSatisfied('own', 'own')).toBe(true);
      expect(isScopeSatisfied('own', 'assigned')).toBe(false);
      expect(isScopeSatisfied('own', 'workspace')).toBe(false);
    });

    it('treats an unknown scope as satisfying nothing', () => {
      expect(isScopeSatisfied('galaxy', 'own')).toBe(false);
    });
  });

  describe('requested scope resolution (pure)', () => {
    it('defaults to the widest scope the permission supports', () => {
      expect(resolveRequestedScope('tasks.view', undefined)).toEqual({
        ok: true,
        scope: 'workspace',
      });
    });

    it('accepts a supported narrower scope', () => {
      expect(resolveRequestedScope('tasks.view', 'own')).toEqual({ ok: true, scope: 'own' });
    });

    // tasks.create is workspace-only; narrowing it would read as a rule and
    // enforce nothing.
    it('rejects a scope the permission does not support', () => {
      const result = resolveRequestedScope('tasks.create', 'own');

      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/not supported/);
    });
  });

  describe('task scope membership (pure)', () => {
    const workspaceId = anId();
    const actor = anId();
    const other = anId();

    const task = (overrides = {}) => ({
      workspace: workspaceId,
      createdBy: other,
      assignedTo: null,
      ...overrides,
    });

    it('rejects a task from another workspace whatever the scope', () => {
      const result = isTaskWithinScope({
        task: task({ workspace: anId(), createdBy: actor }),
        userId: actor,
        workspaceId,
        grantedScope: 'workspace',
      });

      expect(result).toEqual({ ok: false, reason: 'workspace' });
    });

    // Every existing task is workspace: null until the migration runs.
    it('rejects a task with no workspace at all', () => {
      const result = isTaskWithinScope({
        task: task({ workspace: null, createdBy: actor }),
        userId: actor,
        workspaceId,
        grantedScope: 'workspace',
      });

      expect(result.ok).toBe(false);
    });

    it('own allows the creator only', () => {
      expect(
        isTaskWithinScope({
          task: task({ createdBy: actor }),
          userId: actor,
          workspaceId,
          grantedScope: 'own',
        }).ok
      ).toBe(true);

      expect(
        isTaskWithinScope({
          task: task({ createdBy: other }),
          userId: actor,
          workspaceId,
          grantedScope: 'own',
        }).ok
      ).toBe(false);
    });

    it('assigned allows the assignee', () => {
      expect(
        isTaskWithinScope({
          task: task({ createdBy: other, assignedTo: actor }),
          userId: actor,
          workspaceId,
          grantedScope: 'assigned',
        }).ok
      ).toBe(true);
    });

    // Stage 3 defines assigned as including what the actor created.
    it('assigned also allows the creator', () => {
      expect(
        isTaskWithinScope({
          task: task({ createdBy: actor, assignedTo: other }),
          userId: actor,
          workspaceId,
          grantedScope: 'assigned',
        }).ok
      ).toBe(true);
    });

    it('assigned rejects a task that is neither created by nor assigned to the actor', () => {
      expect(
        isTaskWithinScope({
          task: task({ createdBy: other, assignedTo: other }),
          userId: actor,
          workspaceId,
          grantedScope: 'assigned',
        })
      ).toEqual({ ok: false, reason: 'scope' });
    });

    it('workspace allows any task inside the workspace', () => {
      expect(
        isTaskWithinScope({
          task: task({ createdBy: other, assignedTo: other }),
          userId: actor,
          workspaceId,
          grantedScope: 'workspace',
        }).ok
      ).toBe(true);
    });

    it('fails closed on an unrecognised scope', () => {
      expect(
        isTaskWithinScope({
          task: task({ createdBy: actor }),
          userId: actor,
          workspaceId,
          grantedScope: 'everything',
        }).ok
      ).toBe(false);
    });
  });

  describe('scope filters (pure)', () => {
    const userId = anId();

    it('does not narrow at workspace scope', () => {
      expect(taskScopeFilter({ userId, grantedScope: 'workspace' })).toEqual({});
    });

    it('narrows to creator at own scope', () => {
      expect(taskScopeFilter({ userId, grantedScope: 'own' })).toEqual({ createdBy: userId });
    });

    it('narrows to creator or assignee at assigned scope', () => {
      expect(taskScopeFilter({ userId, grantedScope: 'assigned' })).toEqual({
        $or: [{ createdBy: userId }, { assignedTo: userId }],
      });
    });

    // A filter matching nothing beats a filter matching everything.
    it('matches nothing for an unknown scope', () => {
      expect(taskScopeFilter({ userId, grantedScope: 'nonsense' })).toEqual({ _id: null });
    });
  });

  describe('effective permissions (pure)', () => {
    it('gives the workspace owner every permission at its widest scope', () => {
      const map = effectivePermissions({ role: { permissions: [] }, isOwner: true });

      expect(map.get('workspace.delete')).toBe('workspace');
      expect(map.get('tasks.view')).toBe('workspace');
      expect(map.size).toBeGreaterThan(20);
    });

    it('ignores permission keys that are not in the catalogue', () => {
      const map = effectivePermissions({
        role: { permissions: [{ key: 'tasks.obliterate', scope: 'workspace' }] },
        isOwner: false,
      });

      expect(map.has('tasks.obliterate')).toBe(false);
    });
  });

  // ===========================================================================
  // Membership resolution
  // ===========================================================================
  describe('membership resolution', () => {
    it('resolves an active member', async () => {
      const { workspace, member } = await setupWorkspace();

      const context = await resolveContext({
        userId: member.user._id,
        workspaceId: workspace._id,
      });

      expect(context.allowed).toBe(true);
      expect(context.isOwner).toBe(false);
      expect(context.role.systemKey).toBe(SYSTEM_ROLES.MEMBER);
    });

    it('denies a user with no membership', async () => {
      const { workspace } = await setupWorkspace();
      const stranger = await createUser();

      const result = await check({
        userId: stranger.user._id,
        workspaceId: workspace._id,
        permission: 'tasks.view',
      });

      expect(result.allowed).toBe(false);
      expect(result.code).toBe(DENIAL.NOT_A_MEMBER);
      // 404, not 403 — a 403 would confirm the workspace exists.
      expect(result.status).toBe(404);
    });

    it('denies a suspended member', async () => {
      const { workspace, member } = await setupWorkspace();

      await WorkspaceMembership.updateOne(
        { _id: member.membership._id },
        { $set: { status: 'suspended' } }
      );

      const result = await check({
        userId: member.user._id,
        workspaceId: workspace._id,
        permission: 'tasks.view',
        scope: 'assigned',
      });

      expect(result.allowed).toBe(false);
      expect(result.code).toBe(DENIAL.MEMBERSHIP_INACTIVE);
    });

    it('denies a membership that belongs to a different workspace', async () => {
      const first = await setupWorkspace({ name: 'First' });
      const second = await setupWorkspace({ name: 'Second' });

      const result = await check({
        userId: first.member.user._id,
        workspaceId: second.workspace._id,
        permission: 'tasks.view',
      });

      expect(result.allowed).toBe(false);
      expect(result.code).toBe(DENIAL.NOT_A_MEMBER);
    });
  });

  // ===========================================================================
  // Roles
  // ===========================================================================
  describe('role resolution', () => {
    it('authorizes through a custom role', async () => {
      const { workspace } = await setupWorkspace();
      const role = await createRole({
        workspace,
        name: 'Class Representative',
        permissions: [{ key: 'tasks.assign' }, { key: 'tasks.view', scope: 'workspace' }],
      });
      const rep = await createMember({ workspace, role });

      const result = await check({
        userId: rep.user._id,
        workspaceId: workspace._id,
        permission: 'tasks.assign',
      });

      expect(result.allowed).toBe(true);
      expect(result.roleName).toBe('Class Representative');
      expect(result.roleKey).toBeNull();
    });

    // Display names are cosmetic; systemKey is identity.
    it('keeps treating a renamed system role as that system role', async () => {
      const { workspace, roles, member } = await setupWorkspace();

      await Role.updateOne({ _id: roles.member._id }, { $set: { name: 'Contributor' } });

      const context = await resolveContext({
        userId: member.user._id,
        workspaceId: workspace._id,
      });

      expect(context.role.name).toBe('Contributor');
      expect(context.role.systemKey).toBe(SYSTEM_ROLES.MEMBER);
    });

    it('denies when the role no longer exists', async () => {
      const { workspace, roles, member } = await setupWorkspace();

      await Role.deleteOne({ _id: roles.member._id });

      const result = await check({
        userId: member.user._id,
        workspaceId: workspace._id,
        permission: 'tasks.view',
      });

      expect(result.allowed).toBe(false);
      expect(result.code).toBe(DENIAL.ROLE_MISSING);
    });

    // Raw updates bypass document middleware, so the engine re-checks.
    it('denies a membership whose role belongs to another workspace', async () => {
      const first = await setupWorkspace({ name: 'First' });
      const second = await setupWorkspace({ name: 'Second' });

      await WorkspaceMembership.updateOne(
        { _id: first.member.membership._id },
        { $set: { role: second.roles.admin._id } }
      );

      const result = await check({
        userId: first.member.user._id,
        workspaceId: first.workspace._id,
        permission: 'tasks.view',
      });

      expect(result.allowed).toBe(false);
      expect(result.code).toBe(DENIAL.ROLE_INTEGRITY_VIOLATION);
    });
  });

  // ===========================================================================
  // Permissions
  // ===========================================================================
  describe('permission resolution', () => {
    it('allows when the role grants the permission', async () => {
      const { workspace, admin } = await setupWorkspace();

      const result = await check({
        userId: admin.user._id,
        workspaceId: workspace._id,
        permission: 'members.invite',
      });

      expect(result.allowed).toBe(true);
    });

    it('denies when the role lacks the permission', async () => {
      const { workspace, member } = await setupWorkspace();

      const result = await check({
        userId: member.user._id,
        workspaceId: workspace._id,
        permission: 'members.invite',
      });

      expect(result.allowed).toBe(false);
      expect(result.code).toBe(DENIAL.PERMISSION_MISSING);
      expect(result.status).toBe(403);
    });

    it('denies an unknown permission rather than inventing it', async () => {
      const { workspace, owner } = await setupWorkspace();

      const result = await check({
        userId: owner.user._id,
        workspaceId: workspace._id,
        permission: 'tasks.some_new_permission',
      });

      expect(result.allowed).toBe(false);
      expect(result.code).toBe(DENIAL.INVALID_PERMISSION);
    });

    it('covers every permission category', async () => {
      const { workspace, owner, member } = await setupWorkspace();

      const categories = [
        'tasks.create',
        'members.view',
        'roles.view',
        'analytics.view',
        'workspace.view',
      ];

      for (const permission of categories) {
        const asOwner = await check({
          userId: owner.user._id,
          workspaceId: workspace._id,
          permission,
        });
        expect(asOwner.allowed).toBe(true);
      }

      // The Member role holds none of the management permissions.
      for (const permission of ['roles.view', 'members.invite', 'workspace.edit']) {
        const asMember = await check({
          userId: member.user._id,
          workspaceId: workspace._id,
          permission,
        });
        expect(asMember.allowed).toBe(false);
      }
    });

    it('denies a scope the permission does not support', async () => {
      const { workspace, owner } = await setupWorkspace();

      const result = await check({
        userId: owner.user._id,
        workspaceId: workspace._id,
        permission: 'tasks.create',
        scope: 'own',
      });

      expect(result.allowed).toBe(false);
      expect(result.code).toBe(DENIAL.INVALID_SCOPE);
    });

    it('denies when the granted scope is too narrow for what was asked', async () => {
      const { workspace, member } = await setupWorkspace();

      // Member holds tasks.view at 'assigned'.
      const narrow = await check({
        userId: member.user._id,
        workspaceId: workspace._id,
        permission: 'tasks.view',
        scope: 'own',
      });
      expect(narrow.allowed).toBe(true);

      const broad = await check({
        userId: member.user._id,
        workspaceId: workspace._id,
        permission: 'tasks.view',
        scope: 'workspace',
      });
      expect(broad.allowed).toBe(false);
      expect(broad.code).toBe(DENIAL.SCOPE_INSUFFICIENT);
    });
  });

  // ===========================================================================
  // Resource authorization + tenant isolation
  // ===========================================================================
  describe('resource authorization', () => {
    it('allows a workspace-scoped role to reach any task in the workspace', async () => {
      const { workspace, owner, admin } = await setupWorkspace();
      const task = await makeTask({ createdBy: owner.user._id, workspace: workspace._id });

      const result = await check({
        userId: admin.user._id,
        workspaceId: workspace._id,
        permission: 'tasks.view',
        resource: task,
      });

      expect(result.allowed).toBe(true);
      expect(result.scope).toBe('workspace');
    });

    it('denies a member a task they neither created nor were assigned', async () => {
      const { workspace, owner, member } = await setupWorkspace();
      const task = await makeTask({ createdBy: owner.user._id, workspace: workspace._id });

      const result = await check({
        userId: member.user._id,
        workspaceId: workspace._id,
        permission: 'tasks.view',
        resource: task,
      });

      expect(result.allowed).toBe(false);
      expect(result.code).toBe(DENIAL.RESOURCE_OUTSIDE_SCOPE);
    });

    it('allows a member the task assigned to them', async () => {
      const { workspace, owner, member } = await setupWorkspace();
      const task = await makeTask({
        createdBy: owner.user._id,
        workspace: workspace._id,
        assignedTo: member.user._id,
      });

      const result = await check({
        userId: member.user._id,
        workspaceId: workspace._id,
        permission: 'tasks.view',
        resource: task,
      });

      expect(result.allowed).toBe(true);
    });

    it('denies when no resource is supplied but one was expected', async () => {
      const { workspace, owner } = await setupWorkspace();

      const result = await check({
        userId: owner.user._id,
        workspaceId: workspace._id,
        permission: 'tasks.edit',
        resource: null,
      });

      expect(result.allowed).toBe(false);
      expect(result.code).toBe(DENIAL.RESOURCE_MISSING);
    });

    // The single most important security property of the stage.
    it('denies a task from another workspace even with workspace-wide permission', async () => {
      const first = await setupWorkspace({ name: 'First' });
      const second = await setupWorkspace({ name: 'Second' });

      const foreignTask = await makeTask({
        createdBy: second.owner.user._id,
        workspace: second.workspace._id,
      });

      const result = await check({
        userId: first.owner.user._id,
        workspaceId: first.workspace._id,
        permission: 'tasks.view',
        resource: foreignTask,
      });

      expect(result.allowed).toBe(false);
      expect(result.code).toBe(DENIAL.RESOURCE_OUTSIDE_WORKSPACE);
      expect(result.status).toBe(404);
    });

    // Every task is workspace: null until the migration runs.
    it('denies an unmigrated task with a null workspace', async () => {
      const { workspace, owner } = await setupWorkspace();
      const task = await makeTask({ createdBy: owner.user._id });

      const result = await check({
        userId: owner.user._id,
        workspaceId: workspace._id,
        permission: 'tasks.view',
        resource: task,
      });

      expect(result.allowed).toBe(false);
      expect(result.code).toBe(DENIAL.RESOURCE_OUTSIDE_WORKSPACE);
    });
  });

  // ===========================================================================
  // Cross-workspace role confusion
  // ===========================================================================
  describe('cross-workspace isolation', () => {
    it('does not carry owner authority from one workspace into another', async () => {
      const agency = await setupWorkspace({ name: 'Agency' });
      const school = await setupWorkspace({ name: 'School' });

      // The agency's owner joins the school as an ordinary member.
      await createMember({
        workspace: school.workspace,
        role: school.roles.member,
        actor: agency.owner,
      });

      // Owner everywhere in their own workspace...
      const atHome = await check({
        userId: agency.owner.user._id,
        workspaceId: agency.workspace._id,
        permission: 'workspace.delete',
      });
      expect(atHome.allowed).toBe(true);

      // ...and nothing special in the other one.
      const away = await check({
        userId: agency.owner.user._id,
        workspaceId: school.workspace._id,
        permission: 'workspace.delete',
      });
      expect(away.allowed).toBe(false);
      expect(away.code).toBe(DENIAL.PERMISSION_MISSING);

      const awayTasks = await check({
        userId: agency.owner.user._id,
        workspaceId: school.workspace._id,
        permission: 'tasks.view',
        scope: 'workspace',
      });
      expect(awayTasks.allowed).toBe(false);
    });

    it('evaluates the same user differently in each workspace', async () => {
      const first = await setupWorkspace({ name: 'First' });
      const second = await setupWorkspace({ name: 'Second' });
      const person = await createUser();

      await createMember({ workspace: first.workspace, role: first.roles.admin, actor: person });
      await createMember({ workspace: second.workspace, role: second.roles.member, actor: person });

      const asAdmin = await check({
        userId: person.user._id,
        workspaceId: first.workspace._id,
        permission: 'members.invite',
      });
      expect(asAdmin.allowed).toBe(true);

      const asMember = await check({
        userId: person.user._id,
        workspaceId: second.workspace._id,
        permission: 'members.invite',
      });
      expect(asMember.allowed).toBe(false);
    });
  });

  // ===========================================================================
  // Owner authority
  // ===========================================================================
  describe('owner authority', () => {
    it('grants the recorded owner every permission', async () => {
      const { workspace, owner } = await setupWorkspace();

      for (const permission of ['workspace.delete', 'roles.delete', 'members.assign_admin']) {
        const result = await check({
          userId: owner.user._id,
          workspaceId: workspace._id,
          permission,
        });
        expect(result.allowed).toBe(true);
        expect(result.isOwner).toBe(true);
      }
    });

    // Authority comes from Workspace.owner, so the role's array is irrelevant.
    it('keeps owner authority even after the Owner role is stripped of permissions', async () => {
      const { workspace, owner, roles } = await setupWorkspace();

      await Role.updateOne({ _id: roles.owner._id }, { $set: { permissions: [] } });

      const result = await check({
        userId: owner.user._id,
        workspaceId: workspace._id,
        permission: 'workspace.delete',
      });

      expect(result.allowed).toBe(true);
    });

    it('refuses workspace.delete to an admin who holds every other power', async () => {
      const { workspace, admin, roles } = await setupWorkspace();

      // Give Admin the permission explicitly — it still is not enough.
      await Role.updateOne(
        { _id: roles.admin._id },
        { $push: { permissions: { key: 'workspace.delete', scope: 'workspace' } } }
      );

      const result = await check({
        userId: admin.user._id,
        workspaceId: workspace._id,
        permission: 'workspace.delete',
      });

      expect(result.allowed).toBe(false);
      expect(result.code).toBe(DENIAL.OWNER_ONLY);
    });

    // Holding the Owner role without being the recorded owner is corruption.
    it('does not elevate someone holding the Owner role who is not the owner', async () => {
      const { workspace, roles, member } = await setupWorkspace();

      await WorkspaceMembership.updateOne(
        { _id: member.membership._id },
        { $set: { role: roles.owner._id } }
      );

      const result = await check({
        userId: member.user._id,
        workspaceId: workspace._id,
        permission: 'workspace.delete',
      });

      expect(result.allowed).toBe(false);
      expect(result.code).toBe(DENIAL.OWNERSHIP_INTEGRITY_CONFLICT);
    });

    it('still denies the real owner if their membership was removed', async () => {
      const { workspace, owner } = await setupWorkspace();

      await WorkspaceMembership.deleteOne({ workspace: workspace._id, user: owner.user._id });

      const result = await check({
        userId: owner.user._id,
        workspaceId: workspace._id,
        permission: 'tasks.view',
      });

      expect(result.allowed).toBe(false);
      expect(result.code).toBe(DENIAL.NOT_A_MEMBER);
    });
  });

  // ===========================================================================
  // Role assignment and the ceiling rule
  // ===========================================================================
  describe('role assignment', () => {
    it('lets the owner assign the Admin role', async () => {
      const { workspace, owner, roles } = await setupWorkspace();

      const result = await checkRoleAssignment({
        userId: owner.user._id,
        workspaceId: workspace._id,
        targetRoleId: roles.admin._id,
      });

      expect(result.allowed).toBe(true);
      expect(result.targetRoleKey).toBe(SYSTEM_ROLES.ADMIN);
    });

    it('lets an admin assign a lower-ranked custom role', async () => {
      const { workspace, admin } = await setupWorkspace();
      const custom = await createRole({ workspace, name: 'Photographer' });

      const result = await checkRoleAssignment({
        userId: admin.user._id,
        workspaceId: workspace._id,
        targetRoleId: custom._id,
      });

      expect(result.allowed).toBe(true);
    });

    // Rank rule: an admin cannot mint peers without members.assign_admin.
    it('stops an admin creating another admin by default', async () => {
      const { workspace, admin, roles } = await setupWorkspace();

      const result = await checkRoleAssignment({
        userId: admin.user._id,
        workspaceId: workspace._id,
        targetRoleId: roles.admin._id,
      });

      expect(result.allowed).toBe(false);
      expect(result.code).toBe(DENIAL.ROLE_ASSIGNMENT_FORBIDDEN);
    });

    it('lets an admin assign Admin once granted members.assign_admin', async () => {
      const { workspace, admin, roles } = await setupWorkspace();

      await Role.updateOne(
        { _id: roles.admin._id },
        { $push: { permissions: { key: 'members.assign_admin', scope: 'workspace' } } }
      );

      const result = await checkRoleAssignment({
        userId: admin.user._id,
        workspaceId: workspace._id,
        targetRoleId: roles.admin._id,
      });

      expect(result.allowed).toBe(true);
    });

    // Ownership moves by transfer, never by role assignment.
    it('never allows the Owner role to be assigned, even by the owner', async () => {
      const { workspace, owner, roles } = await setupWorkspace();

      const result = await checkRoleAssignment({
        userId: owner.user._id,
        workspaceId: workspace._id,
        targetRoleId: roles.owner._id,
      });

      expect(result.allowed).toBe(false);
      expect(result.message).toMatch(/ownership transfer/i);
    });

    it('denies a member with no assign permission', async () => {
      const { workspace, member, roles } = await setupWorkspace();

      const result = await checkRoleAssignment({
        userId: member.user._id,
        workspaceId: workspace._id,
        targetRoleId: roles.member._id,
      });

      expect(result.allowed).toBe(false);
      expect(result.code).toBe(DENIAL.PERMISSION_MISSING);
    });

    it('denies a target role from another workspace', async () => {
      const first = await setupWorkspace({ name: 'First' });
      const second = await setupWorkspace({ name: 'Second' });

      const result = await checkRoleAssignment({
        userId: first.owner.user._id,
        workspaceId: first.workspace._id,
        targetRoleId: second.roles.member._id,
      });

      expect(result.allowed).toBe(false);
      expect(result.code).toBe(DENIAL.ROLE_ASSIGNMENT_FORBIDDEN);
    });

    it('denies a target role that does not exist', async () => {
      const { workspace, owner } = await setupWorkspace();

      const result = await checkRoleAssignment({
        userId: owner.user._id,
        workspaceId: workspace._id,
        targetRoleId: anId(),
      });

      expect(result.allowed).toBe(false);
      expect(result.code).toBe(DENIAL.ROLE_ASSIGNMENT_FORBIDDEN);
    });

    // A custom role given assign_role must still obey the rank rule.
    it('stops a custom role escalating through role assignment', async () => {
      const { workspace, roles } = await setupWorkspace();
      const sneaky = await createRole({
        workspace,
        name: 'Coordinator',
        permissions: [{ key: 'members.assign_role' }],
      });
      const actor = await createMember({ workspace, role: sneaky });

      const result = await checkRoleAssignment({
        userId: actor.user._id,
        workspaceId: workspace._id,
        targetRoleId: roles.admin._id,
      });

      expect(result.allowed).toBe(false);
      expect(result.code).toBe(DENIAL.ROLE_ASSIGNMENT_FORBIDDEN);
    });
  });

  describe('permission granting (ceiling rule)', () => {
    it('lets the owner grant anything', async () => {
      const { workspace, owner } = await setupWorkspace();

      const result = await checkPermissionGrant({
        userId: owner.user._id,
        workspaceId: workspace._id,
        permissions: [{ key: 'workspace.delete' }],
      });

      expect(result.allowed).toBe(true);
    });

    // Without this, roles.create is an escalation primitive.
    it('stops an actor granting a permission they do not hold', async () => {
      const { workspace, admin } = await setupWorkspace();

      const result = await checkPermissionGrant({
        userId: admin.user._id,
        workspaceId: workspace._id,
        permissions: [{ key: 'workspace.delete' }],
      });

      expect(result.allowed).toBe(false);
      expect(result.code).toBe(DENIAL.PERMISSION_GRANT_EXCEEDS_ACTOR);
    });

    it('stops an actor granting a wider scope than their own', async () => {
      const { workspace } = await setupWorkspace();
      const narrow = await createRole({
        workspace,
        name: 'Narrow',
        permissions: [{ key: 'tasks.edit', scope: 'own' }],
      });
      const actor = await createMember({ workspace, role: narrow });

      const result = await checkPermissionGrant({
        userId: actor.user._id,
        workspaceId: workspace._id,
        permissions: [{ key: 'tasks.edit', scope: 'workspace' }],
      });

      expect(result.allowed).toBe(false);
      expect(result.details.permission).toBe('tasks.edit');
    });

    it('allows granting an equal or narrower scope', async () => {
      const { workspace } = await setupWorkspace();
      const role = await createRole({
        workspace,
        name: 'Broad',
        permissions: [{ key: 'tasks.edit', scope: 'workspace' }],
      });
      const actor = await createMember({ workspace, role });

      const result = await checkPermissionGrant({
        userId: actor.user._id,
        workspaceId: workspace._id,
        permissions: [{ key: 'tasks.edit', scope: 'assigned' }],
      });

      expect(result.allowed).toBe(true);
    });

    it('rejects an unknown permission key', async () => {
      const { workspace, admin } = await setupWorkspace();

      const result = await checkPermissionGrant({
        userId: admin.user._id,
        workspaceId: workspace._id,
        permissions: [{ key: 'tasks.obliterate' }],
      });

      expect(result.allowed).toBe(false);
    });
  });

  // ===========================================================================
  // Query narrowing
  // ===========================================================================
  describe('scoped list filters', () => {
    it('returns an unnarrowed workspace filter for an admin', async () => {
      const { workspace, admin } = await setupWorkspace();

      const result = await scopedFilter({
        userId: admin.user._id,
        workspaceId: workspace._id,
        permission: 'tasks.view',
      });

      expect(result.allowed).toBe(true);
      expect(result.scope).toBe('workspace');
      expect(result.filter).toEqual({ workspace: workspace._id });
    });

    it('narrows a member to their own and assigned work', async () => {
      const { workspace, member } = await setupWorkspace();

      const result = await scopedFilter({
        userId: member.user._id,
        workspaceId: workspace._id,
        permission: 'tasks.view',
      });

      expect(result.scope).toBe('assigned');
      expect(result.filter.workspace).toEqual(workspace._id);
      expect(result.filter.$or).toEqual([
        { createdBy: member.user._id },
        { assignedTo: member.user._id },
      ]);
    });

    it('actually returns only permitted tasks when used as a query', async () => {
      const { workspace, owner, member } = await setupWorkspace();

      await makeTask({ title: 'Owner only', createdBy: owner.user._id, workspace: workspace._id });
      await makeTask({
        title: 'Assigned to member',
        createdBy: owner.user._id,
        workspace: workspace._id,
        assignedTo: member.user._id,
      });

      const { filter } = await scopedFilter({
        userId: member.user._id,
        workspaceId: workspace._id,
        permission: 'tasks.view',
      });

      const visible = await Task.find(filter);

      expect(visible).toHaveLength(1);
      expect(visible[0].title).toBe('Assigned to member');
    });

    it('denies rather than returning a filter when the permission is missing', async () => {
      const { workspace, member } = await setupWorkspace();

      const result = await scopedFilter({
        userId: member.user._id,
        workspaceId: workspace._id,
        permission: 'members.remove',
      });

      expect(result.allowed).toBe(false);
      expect(result.filter).toBeUndefined();
    });
  });

  // ===========================================================================
  // Fail closed
  // ===========================================================================
  describe('fails closed', () => {
    const cases = [
      ['null user', { userId: null, workspaceId: 'ws' }],
      ['undefined user', { userId: undefined, workspaceId: 'ws' }],
      ['malformed user id', { userId: 'not-an-object-id', workspaceId: 'ws' }],
      ['null workspace', { userId: 'user', workspaceId: null }],
      ['malformed workspace id', { userId: 'user', workspaceId: 'nope' }],
    ];

    it.each(cases)('denies with %s', async (_label, input) => {
      const { workspace, owner } = await setupWorkspace();

      const result = await check({
        userId: input.userId === 'user' ? owner.user._id : input.userId,
        workspaceId: input.workspaceId === 'ws' ? workspace._id : input.workspaceId,
        permission: 'tasks.view',
      });

      expect(result.allowed).toBe(false);
    });

    it('denies a workspace id that is well-formed but does not exist', async () => {
      const { owner } = await setupWorkspace();

      const result = await check({
        userId: owner.user._id,
        workspaceId: anId(),
        permission: 'tasks.view',
      });

      expect(result.allowed).toBe(false);
      expect(result.code).toBe(DENIAL.WORKSPACE_NOT_FOUND);
    });

    it('never throws an unexpected error that could be mistaken for success', async () => {
      const weird = [
        { userId: {}, workspaceId: [] },
        { userId: 0, workspaceId: 0 },
        { userId: 'x', workspaceId: 'y', permission: null },
        { userId: 'x', workspaceId: 'y', permission: 42 },
      ];

      for (const input of weird) {
        const result = await check({ permission: 'tasks.view', ...input });
        expect(result.allowed).toBe(false);
      }
    });
  });

  // ===========================================================================
  // Throwing variant
  // ===========================================================================
  describe('authorize() throws structured errors', () => {
    it('returns the grant on success', async () => {
      const { workspace, owner } = await setupWorkspace();

      const result = await authorize({
        userId: owner.user._id,
        workspaceId: workspace._id,
        permission: 'tasks.create',
      });

      expect(result.allowed).toBe(true);
    });

    it('throws an AuthorizationError carrying a code and a safe message', async () => {
      const { workspace, member } = await setupWorkspace();

      expect.assertions(4);

      try {
        await authorize({
          userId: member.user._id,
          workspaceId: workspace._id,
          permission: 'members.remove',
        });
      } catch (error) {
        expect(error).toBeInstanceOf(AuthorizationError);
        expect(error.code).toBe(DENIAL.PERMISSION_MISSING);
        expect(error.statusCode).toBe(403);
        // The public message must not name the role or the permission.
        expect(error.publicMessage).toBe('You do not have permission to do this.');
      }
    });

    it('hides existence behind a 404 for a non-member', async () => {
      const { workspace } = await setupWorkspace();
      const stranger = await createUser();

      expect.assertions(2);

      try {
        await authorize({
          userId: stranger.user._id,
          workspaceId: workspace._id,
          permission: 'tasks.view',
        });
      } catch (error) {
        expect(error.statusCode).toBe(404);
        expect(error.publicMessage).toBe('Workspace not found.');
      }
    });
  });

  // ===========================================================================
  // Stale state
  // ===========================================================================
  describe('reflects current database state', () => {
    it('sees a permission added to a role immediately', async () => {
      const { workspace, member, roles } = await setupWorkspace();

      const before = await check({
        userId: member.user._id,
        workspaceId: workspace._id,
        permission: 'members.invite',
      });
      expect(before.allowed).toBe(false);

      await Role.updateOne(
        { _id: roles.member._id },
        { $push: { permissions: { key: 'members.invite', scope: 'workspace' } } }
      );

      const after = await check({
        userId: member.user._id,
        workspaceId: workspace._id,
        permission: 'members.invite',
      });
      expect(after.allowed).toBe(true);
    });

    it('sees a membership suspension immediately', async () => {
      const { workspace, admin } = await setupWorkspace();

      expect(
        (await check({
          userId: admin.user._id,
          workspaceId: workspace._id,
          permission: 'members.view',
        })).allowed
      ).toBe(true);

      await WorkspaceMembership.updateOne(
        { _id: admin.membership._id },
        { $set: { status: 'suspended' } }
      );

      const after = await check({
        userId: admin.user._id,
        workspaceId: workspace._id,
        permission: 'members.view',
      });

      expect(after.allowed).toBe(false);
      expect(after.code).toBe(DENIAL.MEMBERSHIP_INACTIVE);
    });

    it('sees an ownership transfer immediately', async () => {
      const { workspace, admin } = await setupWorkspace();

      await Workspace.updateOne(
        { _id: workspace._id },
        { $set: { owner: admin.user._id } }
      );

      const result = await check({
        userId: admin.user._id,
        workspaceId: workspace._id,
        permission: 'workspace.delete',
      });

      expect(result.allowed).toBe(true);
      expect(result.isOwner).toBe(true);
    });
  });
});
