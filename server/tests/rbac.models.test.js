const mongoose = require('mongoose');

const Workspace = require('../model/workspaceModel');
const Role = require('../model/roleModel');
const WorkspaceMembership = require('../model/workspaceMembershipModel');
const WorkspaceInvitation = require('../model/workspaceInvitationModel');
const Task = require('../model/taskModel');
const { SYSTEM_ROLES } = require('../model/roleModel');
const { PERMISSIONS, isValidScopeFor, scopeCovers } = require('../config/permissions');
const {
  createUser,
  createWorkspace,
  createRole,
  createMember,
  setupWorkspace,
  createTask,
} = require('./factories');

const anId = () => new mongoose.Types.ObjectId();

describe('RBAC models', () => {
  // -------------------------------------------------------------------------
  describe('Workspace', () => {
    it('creates a valid workspace with timestamps', async () => {
      const { user } = await createUser();

      const workspace = await Workspace.create({
        owner: user._id,
        name: 'Class 10A',
        description: 'Year 10 coursework',
      });

      expect(workspace.name).toBe('Class 10A');
      expect(workspace.createdAt).toBeInstanceOf(Date);
      expect(workspace.updatedAt).toBeInstanceOf(Date);
    });

    it('requires a name', async () => {
      const { user } = await createUser();

      await expect(Workspace.create({ owner: user._id })).rejects.toThrow(/name is required/i);
    });

    // Setters run before validators, so '    ' is trimmed to '' and caught by
    // `required` rather than by a separate blank check.
    it('rejects a whitespace-only name', async () => {
      const { user } = await createUser();

      await expect(
        Workspace.create({ owner: user._id, name: '    ' })
      ).rejects.toThrow(/name is required/i);
    });

    it('trims the name', async () => {
      const { user } = await createUser();
      const workspace = await Workspace.create({ owner: user._id, name: '  Acme  ' });

      expect(workspace.name).toBe('Acme');
    });

    it('requires an owner', async () => {
      await expect(Workspace.create({ name: 'Ownerless' })).rejects.toThrow(/owner/i);
    });

    it('rejects an owner that is not a real user', async () => {
      await expect(
        Workspace.create({ name: 'Ghost', owner: anId() })
      ).rejects.toThrow(/existing user/i);
    });
  });

  // -------------------------------------------------------------------------
  describe('Role', () => {
    it('creates a custom role with scoped permissions', async () => {
      const { workspace } = await setupWorkspace();

      const role = await createRole({
        workspace,
        name: 'Class Representative',
        permissions: [
          { key: 'tasks.view', scope: 'workspace' },
          { key: 'tasks.assign' },
        ],
      });

      expect(role.isSystemRole).toBe(false);
      expect(role.systemKey).toBeNull();
      expect(role.permissionMap().get('tasks.view')).toBe('workspace');
    });

    it('requires a name and a workspace', async () => {
      const { workspace } = await setupWorkspace();

      await expect(Role.create({ workspace: workspace._id })).rejects.toThrow(/name/i);
      await expect(Role.create({ name: 'Orphan' })).rejects.toThrow(/workspace/i);
    });

    it('rejects a duplicate role name in the same workspace', async () => {
      const { workspace } = await setupWorkspace();
      await createRole({ workspace, name: 'Developer' });

      await expect(createRole({ workspace, name: 'Developer' })).rejects.toThrow();
    });

    // Case-insensitive, because an administrator would not expect "developer"
    // and "Developer" to be two different roles.
    it('treats role names case-insensitively within a workspace', async () => {
      const { workspace } = await setupWorkspace();
      await createRole({ workspace, name: 'Developer' });

      await expect(createRole({ workspace, name: 'developer' })).rejects.toThrow();
    });

    // The whole point of workspace-scoped roles.
    it('allows the same role name in two different workspaces', async () => {
      const first = await setupWorkspace({ name: 'Agency' });
      const second = await setupWorkspace({ name: 'School' });

      await createRole({ workspace: first.workspace, name: 'Developer' });

      await expect(
        createRole({ workspace: second.workspace, name: 'Developer' })
      ).resolves.toBeDefined();
    });

    it('refuses a permission key that is not in the catalogue', async () => {
      const { workspace } = await setupWorkspace();

      await expect(
        createRole({ workspace, name: 'Impostor', permissions: ['tasks.obliterate'] })
      ).rejects.toThrow(/not a known permission/i);
    });

    it('refuses a scope the permission does not support', async () => {
      const { workspace } = await setupWorkspace();

      // Creating a task cannot meaningfully be narrowed to "own".
      await expect(
        createRole({
          workspace,
          name: 'Confused',
          permissions: [{ key: 'tasks.create', scope: 'own' }],
        })
      ).rejects.toThrow(/not supported/i);
    });

    it('defaults an omitted scope to the widest the permission allows', async () => {
      const { workspace } = await setupWorkspace();
      const role = await createRole({ workspace, name: 'Wide', permissions: ['tasks.view'] });

      expect(role.permissionMap().get('tasks.view')).toBe('workspace');
    });

    it('rejects the same permission granted twice', async () => {
      const { workspace } = await setupWorkspace();

      await expect(
        createRole({
          workspace,
          name: 'Doubled',
          permissions: [
            { key: 'tasks.view', scope: 'own' },
            { key: 'tasks.view', scope: 'workspace' },
          ],
        })
      ).rejects.toThrow(/same permission twice/i);
    });

    describe('system role constraints', () => {
      it('seeds Owner, Admin and Member for a new workspace', async () => {
        const { workspace } = await setupWorkspace();
        const roles = await Role.find({ workspace: workspace._id, isSystemRole: true });

        expect(roles.map((r) => r.systemKey).sort()).toEqual(['ADMIN', 'MEMBER', 'OWNER']);
      });

      it('requires a systemKey when isSystemRole is set', async () => {
        const { workspace } = await setupWorkspace();

        await expect(
          Role.create({ workspace: workspace._id, name: 'Half', isSystemRole: true })
        ).rejects.toThrow(/must have a systemKey/i);
      });

      it('refuses a systemKey on a custom role', async () => {
        const { workspace } = await setupWorkspace();

        await expect(
          Role.create({
            workspace: workspace._id,
            name: 'Pretender',
            isSystemRole: false,
            systemKey: SYSTEM_ROLES.ADMIN,
          })
        ).rejects.toThrow(/cannot have a systemKey/i);
      });

      it('refuses a second role with the same systemKey in one workspace', async () => {
        const { workspace } = await setupWorkspace();

        await expect(
          Role.create({
            workspace: workspace._id,
            name: 'Second Owner',
            isSystemRole: true,
            systemKey: SYSTEM_ROLES.OWNER,
          })
        ).rejects.toThrow();
      });

      // The partial index must not treat every custom role's null systemKey as
      // a collision — a plain sparse index would.
      it('still allows many custom roles, which all have a null systemKey', async () => {
        const { workspace } = await setupWorkspace();

        await createRole({ workspace, name: 'Photographer' });
        await createRole({ workspace, name: 'Editor' });

        await expect(createRole({ workspace, name: 'Designer' })).resolves.toBeDefined();
      });

      it('gives the Member role no delete permission', async () => {
        const { roles } = await setupWorkspace();

        expect(roles.member.permissionMap().has('tasks.delete')).toBe(false);
      });
    });
  });

  // -------------------------------------------------------------------------
  describe('WorkspaceMembership', () => {
    it('creates a valid membership defaulting to active', async () => {
      const { workspace, roles } = await setupWorkspace();
      const { membership } = await createMember({ workspace, role: roles.member });

      expect(membership.status).toBe('active');
      expect(membership.joinedAt).toBeInstanceOf(Date);
    });

    it('rejects a second membership for the same user in one workspace', async () => {
      const { workspace, roles, member } = await setupWorkspace();

      await expect(
        WorkspaceMembership.create({
          workspace: workspace._id,
          user: member.user._id,
          role: roles.admin._id,
        })
      ).rejects.toThrow();
    });

    // A user belonging to many workspaces is the entire point.
    it('allows one user to be a member of two workspaces with different roles', async () => {
      const school = await setupWorkspace({ name: 'School' });
      const agency = await setupWorkspace({ name: 'Agency' });
      const person = await createUser();

      await createMember({ workspace: school.workspace, role: school.roles.member, actor: person });

      await expect(
        createMember({ workspace: agency.workspace, role: agency.roles.admin, actor: person })
      ).resolves.toBeDefined();
    });

    // Privilege escalation: build a permissive role somewhere you control,
    // then attach it to your membership elsewhere.
    it('refuses a role belonging to a different workspace', async () => {
      const first = await setupWorkspace({ name: 'First' });
      const second = await setupWorkspace({ name: 'Second' });
      const person = await createUser();

      await expect(
        WorkspaceMembership.create({
          workspace: first.workspace._id,
          user: person.user._id,
          role: second.roles.admin._id,
        })
      ).rejects.toThrow(/same workspace/i);
    });

    it('refuses a role that does not exist', async () => {
      const { workspace } = await setupWorkspace();
      const person = await createUser();

      await expect(
        WorkspaceMembership.create({
          workspace: workspace._id,
          user: person.user._id,
          role: anId(),
        })
      ).rejects.toThrow(/does not exist/i);
    });

    it('requires workspace, user and role', async () => {
      await expect(WorkspaceMembership.create({})).rejects.toThrow();
    });

    it('rejects an unknown status', async () => {
      const { workspace, roles } = await setupWorkspace();
      const person = await createUser();

      await expect(
        WorkspaceMembership.create({
          workspace: workspace._id,
          user: person.user._id,
          role: roles.member._id,
          status: 'vacationing',
        })
      ).rejects.toThrow(/status must be one of/i);
    });

    // Invitation state lives on the invitation, not here.
    it('does not accept "invited" as a membership status', async () => {
      const { workspace, roles } = await setupWorkspace();
      const person = await createUser();

      await expect(
        WorkspaceMembership.create({
          workspace: workspace._id,
          user: person.user._id,
          role: roles.member._id,
          status: 'invited',
        })
      ).rejects.toThrow(/status must be one of/i);
    });
  });

  // -------------------------------------------------------------------------
  describe('WorkspaceInvitation', () => {
    const invite = async ({ workspace, roles, owner }, overrides = {}) =>
      WorkspaceInvitation.create({
        workspace: workspace._id,
        email: 'invitee@example.com',
        role: roles.member._id,
        invitedBy: owner.user._id,
        ...overrides,
      });

    it('creates a valid pending invitation', async () => {
      const setup = await setupWorkspace();
      const invitation = await invite(setup);

      expect(invitation.status).toBe('pending');
      expect(invitation.acceptedAt).toBeNull();
      expect(invitation.isUsable).toBe(true);
    });

    it('normalises the email to lowercase and trims it', async () => {
      const setup = await setupWorkspace();
      const invitation = await invite(setup, { email: '  John@Example.COM ' });

      expect(invitation.email).toBe('john@example.com');
    });

    it('rejects an invalid email', async () => {
      const setup = await setupWorkspace();

      await expect(invite(setup, { email: 'not-an-email' })).rejects.toThrow(/valid email/i);
    });

    it('allows only one pending invitation per workspace and email', async () => {
      const setup = await setupWorkspace();
      await invite(setup);

      await expect(invite(setup)).rejects.toThrow();
    });

    // The partial index must permit a fresh invitation once the old one is no
    // longer pending — otherwise revoking someone locks them out forever.
    it('allows a new invitation after the previous one was revoked', async () => {
      const setup = await setupWorkspace();
      const first = await invite(setup);

      first.status = 'revoked';
      await first.save();

      await expect(invite(setup)).resolves.toBeDefined();
    });

    it('allows the same email to be invited to two different workspaces', async () => {
      const school = await setupWorkspace({ name: 'School' });
      const agency = await setupWorkspace({ name: 'Agency' });

      await invite(school);

      await expect(invite(agency)).resolves.toBeDefined();
    });

    it('refuses a role from another workspace', async () => {
      const school = await setupWorkspace({ name: 'School' });
      const agency = await setupWorkspace({ name: 'Agency' });

      await expect(
        invite(school, { role: agency.roles.member._id })
      ).rejects.toThrow(/same workspace/i);
    });

    it('derives expiry rather than storing a flag', async () => {
      const setup = await setupWorkspace();

      const live = await invite(setup, { expiresAt: new Date(Date.now() + 60_000) });
      expect(live.isExpired).toBe(false);
      expect(live.isUsable).toBe(true);

      live.expiresAt = new Date(Date.now() - 60_000);
      expect(live.isExpired).toBe(true);
      expect(live.isUsable).toBe(false);
    });

    it('treats an invitation with no expiry as non-expiring', async () => {
      const setup = await setupWorkspace();
      const invitation = await invite(setup);

      expect(invitation.isExpired).toBe(false);
    });

    it('never returns the token hash on an ordinary read', async () => {
      const setup = await setupWorkspace();
      const { raw, hash } = WorkspaceInvitation.createToken();
      const created = await invite(setup, { tokenHash: hash });

      const reloaded = await WorkspaceInvitation.findById(created._id);

      expect(reloaded.tokenHash).toBeUndefined();
      expect(WorkspaceInvitation.hashToken(raw)).toBe(hash);
      expect(raw).not.toBe(hash);
    });
  });

  // -------------------------------------------------------------------------
  describe('Task.workspace (phase A)', () => {
    it('defaults to null so existing behaviour is unaffected', async () => {
      const owner = await createUser();
      const res = await createTask(owner).expect(201);

      const task = await Task.findById(res.body.data.task._id);
      expect(task.workspace).toBeNull();
    });

    it('accepts a workspace reference when one is supplied', async () => {
      const { workspace, owner } = await setupWorkspace();

      const task = await Task.create({
        title: 'Scoped task',
        priority: 'low',
        checklists: [{ title: 'step' }],
        createdBy: owner.user._id,
        workspace: workspace._id,
      });

      expect(task.workspace.equals(workspace._id)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // The suite's afterEach wipes `mongoose.connection.collections`. That should
  // pick up the new collections automatically, but "should" is not "does" —
  // if it silently missed one, every uniqueness test above would start failing
  // in ways that look like model bugs.
  describe('test isolation covers the new collections', () => {
    it('leaves documents behind within a single test', async () => {
      const setup = await setupWorkspace();
      await WorkspaceInvitation.create({
        workspace: setup.workspace._id,
        email: 'leftover@example.com',
        role: setup.roles.member._id,
        invitedBy: setup.owner.user._id,
      });

      expect(await Workspace.countDocuments()).toBeGreaterThan(0);
      expect(await Role.countDocuments()).toBeGreaterThan(0);
      expect(await WorkspaceMembership.countDocuments()).toBeGreaterThan(0);
      expect(await WorkspaceInvitation.countDocuments()).toBeGreaterThan(0);
    });

    it('starts the next test with all four collections empty', async () => {
      expect(await Workspace.countDocuments()).toBe(0);
      expect(await Role.countDocuments()).toBe(0);
      expect(await WorkspaceMembership.countDocuments()).toBe(0);
      expect(await WorkspaceInvitation.countDocuments()).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('permission catalogue', () => {
    it('has a unique key, a label and a category for every entry', () => {
      const keys = PERMISSIONS.map((p) => p.key);

      expect(new Set(keys).size).toBe(keys.length);
      PERMISSIONS.forEach((p) => {
        expect(p.label).toEqual(expect.any(String));
        expect(p.category).toEqual(expect.any(String));
        expect(p.supportedScopes.length).toBeGreaterThan(0);
      });
    });

    it('contains no speculative media permissions', () => {
      expect(PERMISSIONS.some((p) => p.key.startsWith('media.'))).toBe(false);
    });

    it('validates scopes per permission', () => {
      expect(isValidScopeFor('tasks.view', 'assigned')).toBe(true);
      expect(isValidScopeFor('tasks.create', 'assigned')).toBe(false);
      expect(isValidScopeFor('nope.nope', 'workspace')).toBe(false);
    });

    it('orders scopes so workspace is the widest', () => {
      expect(scopeCovers('workspace', 'assigned')).toBe(true);
      expect(scopeCovers('assigned', 'own')).toBe(true);
      expect(scopeCovers('own', 'workspace')).toBe(false);
    });
  });
});
