const request = require('supertest');
const mongoose = require('mongoose');

const app = require('../app');
const Role = require('../model/roleModel');
const WorkspaceMembership = require('../model/workspaceMembershipModel');
const { SYSTEM_ROLES, DEFAULT_RANK } = require('../model/roleModel');

const roleService = require('../services/workspace/roleService');
const authorization = require('../services/authorization');

const { createUser, createRole, createMember, setupWorkspace, withAuth } = require('./factories');

const anId = () => new mongoose.Types.ObjectId();

const api = (actor) => ({
  get: (path) => withAuth(request(app).get(path), actor),
  post: (path, body) => withAuth(request(app).post(path), actor).send(body ?? {}),
  patch: (path, body) => withAuth(request(app).patch(path), actor).send(body ?? {}),
  delete: (path) => withAuth(request(app).delete(path), actor),
});

const rolesUrl = (ws) => `/api/v1/workspaces/${ws._id}/roles`;

/** Grant the seeded Admin role the roles.* permissions it needs for a test. */
const grantAdmin = (roles, keys) =>
  Role.updateOne(
    { _id: roles.admin._id },
    { $push: { permissions: { $each: keys.map((key) => ({ key, scope: 'workspace' })) } } }
  );

describe('Stage 7 — role management', () => {
  // ===========================================================================
  // Listing and viewing
  // ===========================================================================
  describe('listing roles', () => {
    it('lists the workspace roles with member counts', async () => {
      const { workspace, owner } = await setupWorkspace();

      const res = await api(owner).get(rolesUrl(workspace)).expect(200);

      expect(res.body.data.roles).toHaveLength(3);

      const member = res.body.data.roles.find((r) => r.systemKey === SYSTEM_ROLES.MEMBER);
      expect(member.memberCount).toBe(1);
    });

    it('denies an actor without roles.view', async () => {
      const { workspace, member } = await setupWorkspace();

      // The seeded Member role holds no roles.* permissions.
      await api(member).get(rolesUrl(workspace)).expect(403);
    });

    it('denies a non-member with 404', async () => {
      const { workspace } = await setupWorkspace();
      const stranger = await createUser();

      await api(stranger).get(rolesUrl(workspace)).expect(404);
    });

    it('never returns roles from another workspace', async () => {
      const first = await setupWorkspace({ name: 'First' });
      const second = await setupWorkspace({ name: 'Second' });
      await createRole({ workspace: second.workspace, name: 'Second Only' });

      const res = await api(first.owner).get(rolesUrl(first.workspace)).expect(200);

      const names = res.body.data.roles.map((r) => r.name);
      expect(names).not.toContain('Second Only');
      res.body.data.roles.forEach((r) =>
        expect(r.workspaceId).toBe(String(first.workspace._id))
      );
    });

    it('paginates', async () => {
      const { workspace, owner } = await setupWorkspace();
      await createRole({ workspace, name: 'Extra One' });
      await createRole({ workspace, name: 'Extra Two' });

      const res = await api(owner).get(`${rolesUrl(workspace)}?page=1&limit=2`).expect(200);

      expect(res.body.data.roles).toHaveLength(2);
      expect(res.body.data.pagination).toMatchObject({ total: 5, hasMore: true });
    });

    it('serves the permission catalogue for a role editor', async () => {
      const { workspace, owner } = await setupWorkspace();

      const res = await api(owner).get(`${rolesUrl(workspace)}/permissions`).expect(200);

      const keys = res.body.data.permissions.map((p) => p.key);
      expect(keys).toContain('tasks.view');
      expect(keys).toContain('members.assign_admin');

      const view = res.body.data.permissions.find((p) => p.key === 'tasks.view');
      expect(view).toMatchObject({
        label: expect.any(String),
        category: 'Tasks',
        supportedScopes: expect.arrayContaining(['own', 'assigned', 'workspace']),
      });
    });
  });

  describe('viewing one role', () => {
    it('returns a role from the same workspace', async () => {
      const { workspace, owner } = await setupWorkspace();
      const custom = await createRole({ workspace, name: 'Reviewer' });

      const res = await api(owner).get(`${rolesUrl(workspace)}/${custom._id}`).expect(200);

      expect(res.body.data.role.name).toBe('Reviewer');
      expect(res.body.data.role.memberCount).toBe(0);
    });

    // Existence of another workspace's role must not be confirmed.
    it('404s for a role from another workspace', async () => {
      const first = await setupWorkspace({ name: 'First' });
      const second = await setupWorkspace({ name: 'Second' });

      await api(first.owner)
        .get(`${rolesUrl(first.workspace)}/${second.roles.admin._id}`)
        .expect(404);
    });

    it('404s for a role that does not exist', async () => {
      const { workspace, owner } = await setupWorkspace();

      await api(owner).get(`${rolesUrl(workspace)}/${anId()}`).expect(404);
    });

    it('400s on a malformed id', async () => {
      const { workspace, owner } = await setupWorkspace();

      await api(owner).get(`${rolesUrl(workspace)}/nonsense`).expect(400);
    });
  });

  // ===========================================================================
  // Creation
  // ===========================================================================
  describe('creating roles', () => {
    it('creates a custom role', async () => {
      const { workspace, owner } = await setupWorkspace();

      const res = await api(owner)
        .post(rolesUrl(workspace), {
          name: 'Class Representative',
          description: 'Helps manage class tasks',
          permissions: [
            { key: 'tasks.view', scope: 'workspace' },
            { key: 'tasks.assign' },
            'members.view',
          ],
        })
        .expect(201);

      const role = res.body.data.role;
      expect(role.name).toBe('Class Representative');
      expect(role.isSystemRole).toBe(false);
      expect(role.systemKey).toBeNull();
      expect(role.rank).toBe(DEFAULT_RANK);
      expect(role.permissions).toHaveLength(3);
    });

    it('defaults an omitted scope to the widest the permission allows', async () => {
      const { workspace, owner } = await setupWorkspace();

      const res = await api(owner)
        .post(rolesUrl(workspace), { name: 'Wide', permissions: ['tasks.view'] })
        .expect(201);

      expect(res.body.data.role.permissions[0].scope).toBe('workspace');
    });

    it('denies an actor without roles.create', async () => {
      const { workspace, admin } = await setupWorkspace();

      // The seeded Admin has roles.create — use a bare custom role instead.
      const bare = await createRole({ workspace, name: 'Bare', permissions: [] });
      const actor = await createMember({ workspace, role: bare });

      await api(actor).post(rolesUrl(workspace), { name: 'Nope' }).expect(403);
      expect(admin).toBeDefined();
    });

    it('rejects an unknown permission', async () => {
      const { workspace, owner } = await setupWorkspace();

      const res = await api(owner)
        .post(rolesUrl(workspace), { name: 'Bogus', permissions: ['tasks.superuser'] })
        .expect(400);

      expect(res.body.message).toMatch(/not a known permission/i);
      expect(await Role.countDocuments({ workspace: workspace._id, name: 'Bogus' })).toBe(0);
    });

    it('rejects a scope the permission does not support', async () => {
      const { workspace, owner } = await setupWorkspace();

      const res = await api(owner)
        .post(rolesUrl(workspace), {
          name: 'Narrow Create',
          permissions: [{ key: 'tasks.create', scope: 'own' }],
        })
        .expect(400);

      expect(res.body.message).toMatch(/does not support/i);
    });

    it('rejects a duplicate permission key', async () => {
      const { workspace, owner } = await setupWorkspace();

      await api(owner)
        .post(rolesUrl(workspace), {
          name: 'Doubled',
          permissions: [
            { key: 'tasks.view', scope: 'own' },
            { key: 'tasks.view', scope: 'workspace' },
          ],
        })
        .expect(400);
    });

    it('rejects an empty or whitespace name', async () => {
      const { workspace, owner } = await setupWorkspace();

      await api(owner).post(rolesUrl(workspace), { name: '' }).expect(400);
      await api(owner).post(rolesUrl(workspace), { name: '    ' }).expect(400);
    });

    it('rejects an over-long name', async () => {
      const { workspace, owner } = await setupWorkspace();

      await api(owner).post(rolesUrl(workspace), { name: 'x'.repeat(200) }).expect(400);
    });

    it('rejects a duplicate name, case-insensitively', async () => {
      const { workspace, owner } = await setupWorkspace();

      await api(owner).post(rolesUrl(workspace), { name: 'Reviewer' }).expect(201);
      await api(owner).post(rolesUrl(workspace), { name: 'Reviewer' }).expect(409);
      await api(owner).post(rolesUrl(workspace), { name: 'REVIEWER' }).expect(409);
    });

    // The system roles occupy their names, so this falls out of the same index.
    it('rejects a custom role named after a seeded system role', async () => {
      const { workspace, owner } = await setupWorkspace();

      await api(owner).post(rolesUrl(workspace), { name: 'Admin' }).expect(409);
    });

    it('allows the same role name in a different workspace', async () => {
      const first = await setupWorkspace({ name: 'First' });
      const second = await setupWorkspace({ name: 'Second' });

      await api(first.owner).post(rolesUrl(first.workspace), { name: 'Reviewer' }).expect(201);
      await api(second.owner).post(rolesUrl(second.workspace), { name: 'Reviewer' }).expect(201);
    });

    it('trims the name and description', async () => {
      const { workspace, owner } = await setupWorkspace();

      const res = await api(owner)
        .post(rolesUrl(workspace), { name: '  Padded  ', description: '  text  ' })
        .expect(201);

      expect(res.body.data.role.name).toBe('Padded');
      expect(res.body.data.role.description).toBe('text');
    });
  });

  // ===========================================================================
  // System role spoofing
  // ===========================================================================
  describe('system role spoofing', () => {
    it.each([[SYSTEM_ROLES.OWNER], [SYSTEM_ROLES.ADMIN], [SYSTEM_ROLES.MEMBER]])(
      'ignores a client-supplied systemKey of %s',
      async (systemKey) => {
        const { workspace, owner } = await setupWorkspace();

        const res = await api(owner)
          .post(rolesUrl(workspace), {
            name: `Fake ${systemKey}`,
            systemKey,
            isSystemRole: true,
          })
          .expect(201);

        expect(res.body.data.role.systemKey).toBeNull();
        expect(res.body.data.role.isSystemRole).toBe(false);

        const stored = await Role.findById(res.body.data.role.roleId);
        expect(stored.systemKey).toBeNull();
        expect(stored.isSystemRole).toBe(false);
      }
    );

    // Rank governs delegation, so a client-chosen rank would be an escalation.
    it('ignores a client-supplied rank', async () => {
      const { workspace, owner } = await setupWorkspace();

      const res = await api(owner)
        .post(rolesUrl(workspace), { name: 'Overreach', rank: 100 })
        .expect(201);

      expect(res.body.data.role.rank).toBe(DEFAULT_RANK);
    });

    it('ignores a client-supplied workspace, using the route instead', async () => {
      const first = await setupWorkspace({ name: 'First' });
      const second = await setupWorkspace({ name: 'Second' });

      const res = await api(first.owner)
        .post(rolesUrl(first.workspace), {
          name: 'Planted',
          workspace: String(second.workspace._id),
          workspaceId: String(second.workspace._id),
        })
        .expect(201);

      expect(res.body.data.role.workspaceId).toBe(String(first.workspace._id));
      expect(
        await Role.countDocuments({ workspace: second.workspace._id, name: 'Planted' })
      ).toBe(0);
    });

    it('ignores a client-supplied isDefault', async () => {
      const { workspace, owner } = await setupWorkspace();

      const res = await api(owner)
        .post(rolesUrl(workspace), { name: 'NotDefault', isDefault: true })
        .expect(201);

      expect(res.body.data.role.isDefault).toBe(false);
    });
  });

  // ===========================================================================
  // The permission ceiling
  // ===========================================================================
  describe('permission grant ceiling', () => {
    /** An actor whose role holds exactly `permissions`, plus roles.create/edit. */
    const actorWith = async (workspace, permissions, name = 'Limited') => {
      const role = await createRole({
        workspace,
        name,
        permissions: [{ key: 'roles.create' }, { key: 'roles.edit' }, ...permissions],
      });
      return createMember({ workspace, role });
    };

    it('allows granting a permission the actor holds at the same scope', async () => {
      const { workspace } = await setupWorkspace();
      const actor = await actorWith(workspace, [{ key: 'tasks.view', scope: 'workspace' }]);

      await api(actor)
        .post(rolesUrl(workspace), {
          name: 'Mirror',
          permissions: [{ key: 'tasks.view', scope: 'workspace' }],
        })
        .expect(201);
    });

    it('allows granting a narrower scope than the actor holds', async () => {
      const { workspace } = await setupWorkspace();
      const actor = await actorWith(workspace, [{ key: 'tasks.view', scope: 'workspace' }]);

      await api(actor)
        .post(rolesUrl(workspace), {
          name: 'Narrower',
          permissions: [{ key: 'tasks.view', scope: 'assigned' }],
        })
        .expect(201);
    });

    it('refuses a permission the actor does not hold', async () => {
      const { workspace } = await setupWorkspace();
      const actor = await actorWith(workspace, [{ key: 'tasks.view', scope: 'workspace' }]);

      await api(actor)
        .post(rolesUrl(workspace), {
          name: 'Escalated',
          permissions: [{ key: 'tasks.delete', scope: 'workspace' }],
        })
        .expect(403);

      expect(await Role.countDocuments({ workspace: workspace._id, name: 'Escalated' })).toBe(0);
    });

    it('refuses a wider scope than the actor holds', async () => {
      const { workspace } = await setupWorkspace();
      const actor = await actorWith(workspace, [{ key: 'tasks.view', scope: 'assigned' }]);

      await api(actor)
        .post(rolesUrl(workspace), {
          name: 'Widened',
          permissions: [{ key: 'tasks.view', scope: 'workspace' }],
        })
        .expect(403);
    });

    // The whole request fails; no partially-populated role is written.
    it('refuses the whole role when one permission among many is forbidden', async () => {
      const { workspace } = await setupWorkspace();
      const actor = await actorWith(workspace, [
        { key: 'tasks.view', scope: 'workspace' },
        { key: 'members.view' },
      ]);

      await api(actor)
        .post(rolesUrl(workspace), {
          name: 'Mixed',
          permissions: [
            { key: 'tasks.view', scope: 'workspace' },
            { key: 'members.view' },
            { key: 'workspace.delete' },
          ],
        })
        .expect(403);

      expect(await Role.countDocuments({ workspace: workspace._id, name: 'Mixed' })).toBe(0);
    });

    it('lets the workspace owner grant anything', async () => {
      const { workspace, owner } = await setupWorkspace();

      await api(owner)
        .post(rolesUrl(workspace), {
          name: 'Powerful',
          permissions: [{ key: 'workspace.delete' }, { key: 'members.assign_admin' }],
        })
        .expect(201);
    });

    // A plain member could not reach this endpoint anyway, but the ceiling is
    // the second line of defence.
    it('stops a member creating an owner-equivalent role', async () => {
      const { workspace } = await setupWorkspace();
      const actor = await actorWith(workspace, []);

      await api(actor)
        .post(rolesUrl(workspace), {
          name: 'Shadow Owner',
          permissions: [{ key: 'workspace.delete' }],
        })
        .expect(403);
    });

    // The capability Stage 6 left ungrantable; Stage 7 makes it operational.
    it('lets an actor holding members.assign_admin pass it on', async () => {
      const { workspace } = await setupWorkspace();
      const actor = await actorWith(workspace, [{ key: 'members.assign_admin' }]);

      const res = await api(actor)
        .post(rolesUrl(workspace), {
          name: 'Admin Maker',
          permissions: [{ key: 'members.assign_admin' }],
        })
        .expect(201);

      expect(res.body.data.role.permissions[0].key).toBe('members.assign_admin');
    });

    it('stops an actor without members.assign_admin from granting it', async () => {
      const { workspace } = await setupWorkspace();
      const actor = await actorWith(workspace, [{ key: 'members.view' }]);

      await api(actor)
        .post(rolesUrl(workspace), {
          name: 'Sneaky',
          permissions: [{ key: 'members.assign_admin' }],
        })
        .expect(403);
    });
  });

  // ===========================================================================
  // Editing
  // ===========================================================================
  describe('editing roles', () => {
    it('renames a custom role without touching its permissions', async () => {
      const { workspace, owner } = await setupWorkspace();
      const role = await createRole({
        workspace,
        name: 'Before',
        permissions: [{ key: 'tasks.view', scope: 'workspace' }],
      });

      const res = await api(owner)
        .patch(`${rolesUrl(workspace)}/${role._id}`, { name: 'After' })
        .expect(200);

      expect(res.body.data.role.name).toBe('After');
      expect(res.body.data.role.permissions).toHaveLength(1);
    });

    it('replaces permissions without clearing the name', async () => {
      const { workspace, owner } = await setupWorkspace();
      const role = await createRole({ workspace, name: 'Keeper', permissions: [] });

      const res = await api(owner)
        .patch(`${rolesUrl(workspace)}/${role._id}`, {
          permissions: [{ key: 'members.view' }],
        })
        .expect(200);

      expect(res.body.data.role.name).toBe('Keeper');
      expect(res.body.data.role.permissions).toHaveLength(1);
    });

    it('denies an actor without roles.edit', async () => {
      const { workspace } = await setupWorkspace();
      const role = await createRole({ workspace, name: 'Target' });
      const bare = await createRole({ workspace, name: 'Bare', permissions: [] });
      const actor = await createMember({ workspace, role: bare });

      await api(actor)
        .patch(`${rolesUrl(workspace)}/${role._id}`, { name: 'Hijacked' })
        .expect(403);
    });

    // §52 — the original must survive a rejected escalation.
    it('refuses an edit that adds a forbidden permission, leaving the role unchanged', async () => {
      const { workspace } = await setupWorkspace();
      const actorRole = await createRole({
        workspace,
        name: 'Editor',
        permissions: [{ key: 'roles.edit' }, { key: 'tasks.view', scope: 'workspace' }],
      });
      const actor = await createMember({ workspace, role: actorRole });

      const target = await createRole({
        workspace,
        name: 'Target',
        permissions: [{ key: 'tasks.view', scope: 'workspace' }],
      });

      await api(actor)
        .patch(`${rolesUrl(workspace)}/${target._id}`, {
          permissions: [
            { key: 'tasks.view', scope: 'workspace' },
            { key: 'workspace.delete' },
          ],
        })
        .expect(403);

      const reloaded = await Role.findById(target._id);
      expect(reloaded.permissions).toHaveLength(1);
      expect(reloaded.permissions[0].key).toBe('tasks.view');
    });

    // §26 — the bypass this guards against.
    it('validates the whole resulting set, not just the additions', async () => {
      const { workspace } = await setupWorkspace();
      const actorRole = await createRole({
        workspace,
        name: 'Editor',
        permissions: [{ key: 'roles.edit' }, { key: 'members.view' }],
      });
      const actor = await createMember({ workspace, role: actorRole });

      const target = await createRole({
        workspace,
        name: 'Target',
        permissions: [{ key: 'members.view' }],
      });

      // Removing a harmless permission while adding a forbidden one.
      await api(actor)
        .patch(`${rolesUrl(workspace)}/${target._id}`, {
          permissions: [{ key: 'workspace.delete' }],
        })
        .expect(403);
    });

    it('rejects an unknown permission on edit', async () => {
      const { workspace, owner } = await setupWorkspace();
      const role = await createRole({ workspace, name: 'Target' });

      await api(owner)
        .patch(`${rolesUrl(workspace)}/${role._id}`, { permissions: ['nope.nope'] })
        .expect(400);
    });

    it('404s for a role from another workspace and does not mutate it', async () => {
      const first = await setupWorkspace({ name: 'First' });
      const second = await setupWorkspace({ name: 'Second' });
      const foreign = await createRole({ workspace: second.workspace, name: 'Foreign' });

      await api(first.owner)
        .patch(`${rolesUrl(first.workspace)}/${foreign._id}`, { name: 'Hijacked' })
        .expect(404);

      expect((await Role.findById(foreign._id)).name).toBe('Foreign');
    });

    it('rejects a rename that collides with an existing role', async () => {
      const { workspace, owner } = await setupWorkspace();
      await createRole({ workspace, name: 'Taken' });
      const role = await createRole({ workspace, name: 'Free' });

      await api(owner)
        .patch(`${rolesUrl(workspace)}/${role._id}`, { name: 'Taken' })
        .expect(409);
    });

    it('rejects an empty update', async () => {
      const { workspace, owner } = await setupWorkspace();
      const role = await createRole({ workspace, name: 'Target' });

      await api(owner).patch(`${rolesUrl(workspace)}/${role._id}`, {}).expect(400);
    });
  });

  // ===========================================================================
  // System role protection
  // ===========================================================================
  describe('system role protection', () => {
    it('refuses to modify the Owner role at all', async () => {
      const { workspace, roles, owner } = await setupWorkspace();

      const res = await api(owner)
        .patch(`${rolesUrl(workspace)}/${roles.owner._id}`, { name: 'Supreme Leader' })
        .expect(409);

      expect(res.body.message).toMatch(/owner role cannot be modified/i);
      expect((await Role.findById(roles.owner._id)).name).toBe('Owner');
    });

    // Admin and Member permissions are editable — that is how an Owner
    // delegates. Identity is not.
    it('allows the owner to edit the Admin role’s permissions', async () => {
      const { workspace, roles, owner } = await setupWorkspace();

      const res = await api(owner)
        .patch(`${rolesUrl(workspace)}/${roles.admin._id}`, {
          permissions: [{ key: 'members.view' }, { key: 'members.assign_admin' }],
        })
        .expect(200);

      expect(res.body.data.role.permissions.map((p) => p.key)).toContain(
        'members.assign_admin'
      );
      expect(res.body.data.role.systemKey).toBe(SYSTEM_ROLES.ADMIN);
    });

    it('keeps systemKey, rank and isSystemRole immutable when editing Admin', async () => {
      const { workspace, roles, owner } = await setupWorkspace();

      await api(owner)
        .patch(`${rolesUrl(workspace)}/${roles.admin._id}`, {
          name: 'Manager',
          systemKey: SYSTEM_ROLES.OWNER,
          isSystemRole: false,
          rank: 100,
        })
        .expect(200);

      const reloaded = await Role.findById(roles.admin._id);
      expect(reloaded.name).toBe('Manager');
      expect(reloaded.systemKey).toBe(SYSTEM_ROLES.ADMIN);
      expect(reloaded.isSystemRole).toBe(true);
      expect(reloaded.rank).toBe(50);
    });

    it.each([['owner'], ['admin'], ['member']])(
      'refuses to delete the %s system role',
      async (which) => {
        const { workspace, roles, owner } = await setupWorkspace();

        const res = await api(owner)
          .delete(`${rolesUrl(workspace)}/${roles[which]._id}`)
          .expect(409);

        expect(res.body.message).toMatch(/system roles cannot be deleted/i);
        expect(await Role.findById(roles[which]._id)).not.toBeNull();
      }
    );
  });

  // ===========================================================================
  // Deletion
  // ===========================================================================
  describe('deleting roles', () => {
    it('deletes an unused custom role', async () => {
      const { workspace, owner } = await setupWorkspace();
      const role = await createRole({ workspace, name: 'Disposable' });

      await api(owner).delete(`${rolesUrl(workspace)}/${role._id}`).expect(204);

      expect(await Role.findById(role._id)).toBeNull();
    });

    it('denies an actor without roles.delete', async () => {
      const { workspace } = await setupWorkspace();
      const role = await createRole({ workspace, name: 'Target' });
      const bare = await createRole({ workspace, name: 'Bare', permissions: [] });
      const actor = await createMember({ workspace, role: bare });

      await api(actor).delete(`${rolesUrl(workspace)}/${role._id}`).expect(403);
    });

    // Members are never silently reassigned or deleted.
    it('refuses to delete a role that members still use', async () => {
      const { workspace, owner } = await setupWorkspace();
      const role = await createRole({ workspace, name: 'In Use' });
      await createMember({ workspace, role });

      const res = await api(owner).delete(`${rolesUrl(workspace)}/${role._id}`).expect(409);

      expect(res.body.message).toMatch(/1 member uses this role/i);
      expect(await Role.findById(role._id)).not.toBeNull();
      expect(
        await WorkspaceMembership.countDocuments({ workspace: workspace._id, role: role._id })
      ).toBe(1);
    });

    it('allows deletion once the members are reassigned', async () => {
      const { workspace, roles, owner } = await setupWorkspace();
      const role = await createRole({ workspace, name: 'Temp' });
      const holder = await createMember({ workspace, role });

      await api(owner).delete(`${rolesUrl(workspace)}/${role._id}`).expect(409);

      await api(owner)
        .patch(
          `/api/v1/workspaces/${workspace._id}/members/${holder.membership._id}/role`,
          { roleId: roles.member._id }
        )
        .expect(200);

      await api(owner).delete(`${rolesUrl(workspace)}/${role._id}`).expect(204);
    });

    it('404s for a foreign role and does not delete it', async () => {
      const first = await setupWorkspace({ name: 'First' });
      const second = await setupWorkspace({ name: 'Second' });
      const foreign = await createRole({ workspace: second.workspace, name: 'Foreign' });

      await api(first.owner)
        .delete(`${rolesUrl(first.workspace)}/${foreign._id}`)
        .expect(404);

      expect(await Role.findById(foreign._id)).not.toBeNull();
    });

    it('404s for a role that does not exist', async () => {
      const { workspace, owner } = await setupWorkspace();

      await api(owner).delete(`${rolesUrl(workspace)}/${anId()}`).expect(404);
    });
  });

  // ===========================================================================
  // Stage 5 / Stage 6 compatibility
  // ===========================================================================
  describe('end-to-end with assignment and authorization', () => {
    it('creates a role, assigns it, and authorization honours its permissions', async () => {
      const { workspace, owner, member } = await setupWorkspace();

      const created = await api(owner)
        .post(rolesUrl(workspace), {
          name: 'Photographer',
          permissions: [
            { key: 'tasks.view', scope: 'assigned' },
            { key: 'tasks.manage_checklists', scope: 'assigned' },
          ],
        })
        .expect(201);

      const roleId = created.body.data.role.roleId;

      await api(owner)
        .patch(
          `/api/v1/workspaces/${workspace._id}/members/${member.membership._id}/role`,
          { roleId }
        )
        .expect(200);

      // The engine, not the role's name, decides what it can do.
      const allowed = await authorization.check({
        userId: member.user._id,
        workspaceId: workspace._id,
        permission: 'tasks.manage_checklists',
        scope: 'assigned',
      });
      expect(allowed.allowed).toBe(true);

      const denied = await authorization.check({
        userId: member.user._id,
        workspaceId: workspace._id,
        permission: 'tasks.delete',
      });
      expect(denied.allowed).toBe(false);
    });

    // A role called "Admin" is still just a custom role.
    it('gives a custom role no power from its display name', async () => {
      const { workspace, owner } = await setupWorkspace();

      const created = await api(owner)
        .post(rolesUrl(workspace), {
          name: 'Administrator',
          permissions: [{ key: 'tasks.view', scope: 'own' }],
        })
        .expect(201);

      const impostor = await createMember({
        workspace,
        role: { _id: created.body.data.role.roleId },
      });

      const result = await authorization.check({
        userId: impostor.user._id,
        workspaceId: workspace._id,
        permission: 'members.remove',
      });

      expect(result.allowed).toBe(false);
    });

    // §66 — no caching anywhere.
    it('reflects an edited role in the very next authorization decision', async () => {
      const { workspace, owner } = await setupWorkspace();

      const created = await api(owner)
        .post(rolesUrl(workspace), { name: 'Grower', permissions: [{ key: 'members.view' }] })
        .expect(201);

      const holder = await createMember({
        workspace,
        role: { _id: created.body.data.role.roleId },
      });

      const before = await authorization.check({
        userId: holder.user._id,
        workspaceId: workspace._id,
        permission: 'roles.view',
      });
      expect(before.allowed).toBe(false);

      await api(owner)
        .patch(`${rolesUrl(workspace)}/${created.body.data.role.roleId}`, {
          permissions: [{ key: 'members.view' }, { key: 'roles.view' }],
        })
        .expect(200);

      const after = await authorization.check({
        userId: holder.user._id,
        workspaceId: workspace._id,
        permission: 'roles.view',
      });
      expect(after.allowed).toBe(true);
    });

    it('makes a deleted role unassignable', async () => {
      const { workspace, owner, member } = await setupWorkspace();
      const role = await createRole({ workspace, name: 'Ephemeral' });

      await api(owner).delete(`${rolesUrl(workspace)}/${role._id}`).expect(204);

      await api(owner)
        .patch(
          `/api/v1/workspaces/${workspace._id}/members/${member.membership._id}/role`,
          { roleId: role._id }
        )
        .expect(404);
    });
  });

  // ===========================================================================
  // Authorization integration
  // ===========================================================================
  describe('authorization integration', () => {
    afterEach(() => jest.restoreAllMocks());

    it('routes every role operation through the Stage 5 engine', async () => {
      const { workspace, owner } = await setupWorkspace();
      const spy = jest.spyOn(authorization, 'authorize');

      await api(owner).get(rolesUrl(workspace)).expect(200);
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ permission: 'roles.view' }));

      spy.mockClear();
      const created = await api(owner)
        .post(rolesUrl(workspace), { name: 'Spied' })
        .expect(201);
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ permission: 'roles.create' }));

      spy.mockClear();
      await api(owner)
        .patch(`${rolesUrl(workspace)}/${created.body.data.role.roleId}`, { name: 'Spied2' })
        .expect(200);
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ permission: 'roles.edit' }));

      spy.mockClear();
      await api(owner)
        .delete(`${rolesUrl(workspace)}/${created.body.data.role.roleId}`)
        .expect(204);
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ permission: 'roles.delete' }));
    });

    // The ceiling must come from Stage 5, not a second implementation.
    it('routes permission grants through checkPermissionGrant', async () => {
      const { workspace, owner } = await setupWorkspace();
      const spy = jest.spyOn(authorization, 'checkPermissionGrant');

      await api(owner)
        .post(rolesUrl(workspace), { name: 'Ceiling', permissions: ['members.view'] })
        .expect(201);

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          permissions: [{ key: 'members.view', scope: 'workspace' }],
        })
      );
    });

    it('protects the service when called directly, bypassing HTTP', async () => {
      const { workspace } = await setupWorkspace();
      const bare = await createRole({ workspace, name: 'Bare', permissions: [] });
      const actor = await createMember({ workspace, role: bare });

      for (const call of [
        () => roleService.listRoles({ workspaceId: workspace._id, actorUserId: actor.user._id }),
        () =>
          roleService.createRole({
            workspaceId: workspace._id,
            actorUserId: actor.user._id,
            name: 'Direct',
          }),
        () =>
          roleService.deleteRole({
            workspaceId: workspace._id,
            actorUserId: actor.user._id,
            roleId: bare._id,
          }),
      ]) {
        await expect(call()).rejects.toMatchObject({ name: 'AuthorizationError' });
      }
    });

    it('requires authentication on every role endpoint', async () => {
      const { workspace, roles } = await setupWorkspace();

      await request(app).get(rolesUrl(workspace)).expect(401);
      await request(app).post(rolesUrl(workspace)).send({ name: 'x' }).expect(401);
      await request(app).patch(`${rolesUrl(workspace)}/${roles.member._id}`).send({}).expect(401);
      await request(app).delete(`${rolesUrl(workspace)}/${roles.member._id}`).expect(401);
    });
  });

  // ===========================================================================
  // Concurrency
  // ===========================================================================
  describe('concurrency', () => {
    it('turns a duplicate-name race into exactly one role', async () => {
      const { workspace, owner } = await setupWorkspace();

      const attempts = await Promise.allSettled(
        Array.from({ length: 4 }, () =>
          roleService.createRole({
            workspaceId: workspace._id,
            actorUserId: owner.user._id,
            name: 'Contested',
          })
        )
      );

      expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
      expect(
        await Role.countDocuments({ workspace: workspace._id, name: 'Contested' })
      ).toBe(1);

      attempts
        .filter((a) => a.status === 'rejected')
        .forEach((a) => {
          expect(a.reason.name).toBe('WorkspaceDomainError');
          expect(a.reason.statusCode).toBe(409);
        });
    });

    // The compensating action: a membership that lands during the delete
    // restores the role rather than being orphaned.
    it('restores a role if a membership appears mid-delete', async () => {
      const { workspace, owner } = await setupWorkspace();
      const role = await createRole({ workspace, name: 'Racy' });

      const original = jest.spyOn(WorkspaceMembership, 'countDocuments');
      let call = 0;
      original.mockImplementation(async (...args) => {
        call += 1;
        // First count (pre-delete) sees nothing; the re-check sees a straggler.
        return call === 1 ? 0 : 1;
      });

      await expect(
        roleService.deleteRole({
          workspaceId: workspace._id,
          actorUserId: owner.user._id,
          roleId: role._id,
        })
      ).rejects.toMatchObject({ code: 'ROLE_IN_USE' });

      original.mockRestore();

      // Restored with the same id, so any membership pointing at it still resolves.
      const restored = await Role.findById(role._id);
      expect(restored).not.toBeNull();
      expect(restored.name).toBe('Racy');
    });
  });
});
