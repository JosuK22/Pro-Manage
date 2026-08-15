const request = require('supertest');
const mongoose = require('mongoose');

const app = require('../app');
const Role = require('../model/roleModel');
const Workspace = require('../model/workspaceModel');
const WorkspaceMembership = require('../model/workspaceMembershipModel');
const WorkspaceInvitation = require('../model/workspaceInvitationModel');
const { SYSTEM_ROLES } = require('../model/roleModel');

const membershipService = require('../services/workspace/membershipService');
const invitationService = require('../services/workspace/invitationService');
const authorization = require('../services/authorization');

const { createUser, createRole, createMember, setupWorkspace, withAuth } = require('./factories');

const anId = () => new mongoose.Types.ObjectId();

const api = (actor) => ({
  get: (path) => withAuth(request(app).get(path), actor),
  post: (path, body) => withAuth(request(app).post(path), actor).send(body),
  patch: (path, body) => withAuth(request(app).patch(path), actor).send(body ?? {}),
  delete: (path) => withAuth(request(app).delete(path), actor),
});

const membersUrl = (ws) => `/api/v1/workspaces/${ws._id}/members`;
const invitesUrl = (ws) => `/api/v1/workspaces/${ws._id}/invitations`;

describe('Stage 6 — workspace members and invitations', () => {
  // ===========================================================================
  // Listing and viewing
  // ===========================================================================
  describe('listing members', () => {
    it('lets a member with members.view list the workspace roster', async () => {
      const { workspace, admin } = await setupWorkspace();

      const res = await api(admin).get(membersUrl(workspace)).expect(200);

      expect(res.body.status).toBe('success');
      expect(res.body.data.members).toHaveLength(3);
      expect(res.body.data.pagination.total).toBe(3);
    });

    it('denies a non-member with 404 rather than confirming the workspace', async () => {
      const { workspace } = await setupWorkspace();
      const stranger = await createUser();

      await api(stranger).get(membersUrl(workspace)).expect(404);
    });

    it('denies a suspended member immediately', async () => {
      const { workspace, admin } = await setupWorkspace();

      await WorkspaceMembership.updateOne(
        { _id: admin.membership._id },
        { $set: { status: 'suspended' } }
      );

      await api(admin).get(membersUrl(workspace)).expect(403);
    });

    it('denies a role without members.view', async () => {
      const { workspace } = await setupWorkspace();
      const role = await createRole({ workspace, name: 'Blinkered', permissions: [] });
      const actor = await createMember({ workspace, role });

      await api(actor).get(membersUrl(workspace)).expect(403);
    });

    // Never leak credential material through a roster.
    it('exposes no password, hash or token fields', async () => {
      const { workspace, owner } = await setupWorkspace();

      const res = await api(owner).get(membersUrl(workspace)).expect(200);
      const serialised = JSON.stringify(res.body);

      expect(serialised).not.toMatch(/password/i);
      expect(serialised).not.toMatch(/tokenHash/i);
      expect(serialised).not.toMatch(/\$2[aby]\$/);

      const [member] = res.body.data.members;
      expect(Object.keys(member.user).sort()).toEqual(['_id', 'email', 'name']);
    });

    it('paginates in the database', async () => {
      const { workspace, roles, owner } = await setupWorkspace();

      for (let i = 0; i < 5; i += 1) {
        await createMember({ workspace, role: roles.member });
      }

      const res = await api(owner).get(`${membersUrl(workspace)}?page=1&limit=2`).expect(200);

      expect(res.body.data.members).toHaveLength(2);
      expect(res.body.data.pagination).toMatchObject({ page: 1, limit: 2, hasMore: true });
      expect(res.body.data.pagination.total).toBe(8);
    });

    it('rejects a malformed pagination value', async () => {
      const { workspace, owner } = await setupWorkspace();

      await api(owner).get(`${membersUrl(workspace)}?limit=-4`).expect(400);
      await api(owner).get(`${membersUrl(workspace)}?status=exploded`).expect(400);
    });

    it('filters by status', async () => {
      const { workspace, owner, member } = await setupWorkspace();

      await api(owner).patch(`${membersUrl(workspace)}/${member.membership._id}/suspend`).expect(200);

      const res = await api(owner).get(`${membersUrl(workspace)}?status=suspended`).expect(200);

      expect(res.body.data.members).toHaveLength(1);
    });

    // Workspace isolation on a list endpoint.
    it('never returns members of another workspace', async () => {
      const first = await setupWorkspace({ name: 'First' });
      const second = await setupWorkspace({ name: 'Second' });

      const res = await api(first.owner).get(membersUrl(first.workspace)).expect(200);

      const ids = res.body.data.members.map((m) => m.workspaceId);
      expect(new Set(ids)).toEqual(new Set([String(first.workspace._id)]));
      expect(ids).not.toContain(String(second.workspace._id));
    });
  });

  describe('viewing one member', () => {
    it('returns a member of the same workspace', async () => {
      const { workspace, owner, member } = await setupWorkspace();

      const res = await api(owner)
        .get(`${membersUrl(workspace)}/${member.membership._id}`)
        .expect(200);

      expect(res.body.data.member.membershipId).toBe(String(member.membership._id));
    });

    it('404s for a membership belonging to another workspace', async () => {
      const first = await setupWorkspace({ name: 'First' });
      const second = await setupWorkspace({ name: 'Second' });

      await api(first.owner)
        .get(`${membersUrl(first.workspace)}/${second.member.membership._id}`)
        .expect(404);
    });

    it('404s for a membership that does not exist', async () => {
      const { workspace, owner } = await setupWorkspace();

      await api(owner).get(`${membersUrl(workspace)}/${anId()}`).expect(404);
    });

    it('400s on a malformed id', async () => {
      const { workspace, owner } = await setupWorkspace();

      await api(owner).get(`${membersUrl(workspace)}/not-an-id`).expect(400);
    });
  });

  // ===========================================================================
  // Invitations
  // ===========================================================================
  describe('creating invitations', () => {
    it('lets an authorised actor invite someone', async () => {
      const { workspace, roles, owner } = await setupWorkspace();

      const res = await api(owner)
        .post(invitesUrl(workspace), { email: 'newcomer@example.com', roleId: roles.member._id })
        .expect(201);

      expect(res.body.data.invitation.email).toBe('newcomer@example.com');
      expect(res.body.data.invitation.status).toBe('pending');
      expect(res.body.data.token).toEqual(expect.any(String));
    });

    it('denies an actor without members.invite', async () => {
      const { workspace, roles, member } = await setupWorkspace();

      await api(member)
        .post(invitesUrl(workspace), { email: 'x@example.com', roleId: roles.member._id })
        .expect(403);
    });

    it('normalises the email so casing cannot create a duplicate', async () => {
      const { workspace, roles, owner } = await setupWorkspace();

      const res = await api(owner)
        .post(invitesUrl(workspace), { email: '  MiXeD@Example.COM ', roleId: roles.member._id })
        .expect(201);

      expect(res.body.data.invitation.email).toBe('mixed@example.com');

      await api(owner)
        .post(invitesUrl(workspace), { email: 'mixed@example.com', roleId: roles.member._id })
        .expect(409);
    });

    it('invites a registered user without creating a second account', async () => {
      const { workspace, roles, owner } = await setupWorkspace();
      const existing = await createUser({ email: 'known@example.com' });

      await api(owner)
        .post(invitesUrl(workspace), { email: 'known@example.com', roleId: roles.member._id })
        .expect(201);

      const User = require('../model/userModel');
      expect(await User.countDocuments({ email: 'known@example.com' })).toBe(1);
      expect(existing.user.email).toBe('known@example.com');
    });

    it('refuses to invite someone who is already an active member', async () => {
      const { workspace, roles, owner, member } = await setupWorkspace();

      const res = await api(owner)
        .post(invitesUrl(workspace), { email: member.email, roleId: roles.member._id })
        .expect(409);

      expect(res.body.message).toMatch(/already a member/i);
    });

    // An invitation must not become a way around a deliberate suspension.
    it('refuses to re-invite a suspended member', async () => {
      const { workspace, roles, owner, member } = await setupWorkspace();

      await api(owner).patch(`${membersUrl(workspace)}/${member.membership._id}/suspend`).expect(200);

      const res = await api(owner)
        .post(invitesUrl(workspace), { email: member.email, roleId: roles.member._id })
        .expect(409);

      expect(res.body.message).toMatch(/suspended/i);
    });

    it('refuses a second pending invitation for the same address', async () => {
      const { workspace, roles, owner } = await setupWorkspace();

      await api(owner)
        .post(invitesUrl(workspace), { email: 'twice@example.com', roleId: roles.member._id })
        .expect(201);

      await api(owner)
        .post(invitesUrl(workspace), { email: 'twice@example.com', roleId: roles.member._id })
        .expect(409);
    });

    it('allows a new invitation once the previous one is revoked', async () => {
      const { workspace, roles, owner } = await setupWorkspace();

      const first = await api(owner)
        .post(invitesUrl(workspace), { email: 'again@example.com', roleId: roles.member._id })
        .expect(201);

      await api(owner)
        .delete(`${invitesUrl(workspace)}/${first.body.data.invitation.invitationId}`)
        .expect(200);

      await api(owner)
        .post(invitesUrl(workspace), { email: 'again@example.com', roleId: roles.member._id })
        .expect(201);
    });

    it('rejects a role that does not exist', async () => {
      const { workspace, owner } = await setupWorkspace();

      await api(owner)
        .post(invitesUrl(workspace), { email: 'a@example.com', roleId: anId() })
        .expect(404);
    });

    // Cross-tenant escalation path.
    it('rejects a role belonging to another workspace', async () => {
      const first = await setupWorkspace({ name: 'First' });
      const second = await setupWorkspace({ name: 'Second' });

      await api(first.owner)
        .post(invitesUrl(first.workspace), {
          email: 'a@example.com',
          roleId: second.roles.member._id,
        })
        .expect(404);
    });

    // Inviting *as* a role is a role assignment, so delegation rules apply.
    it('stops an admin inviting someone as Admin without members.assign_admin', async () => {
      const { workspace, roles, admin } = await setupWorkspace();

      await api(admin)
        .post(invitesUrl(workspace), { email: 'newadmin@example.com', roleId: roles.admin._id })
        .expect(403);
    });

    it('never allows an invitation with the Owner role', async () => {
      const { workspace, roles, owner } = await setupWorkspace();

      await api(owner)
        .post(invitesUrl(workspace), { email: 'usurper@example.com', roleId: roles.owner._id })
        .expect(403);
    });

    it('validates the email and role fields', async () => {
      const { workspace, roles, owner } = await setupWorkspace();

      await api(owner)
        .post(invitesUrl(workspace), { email: 'nope', roleId: roles.member._id })
        .expect(400);

      await api(owner)
        .post(invitesUrl(workspace), { email: 'ok@example.com', roleId: 'garbage' })
        .expect(400);
    });
  });

  describe('invitation storage', () => {
    it('stores only the hash, never the plaintext token', async () => {
      const { workspace, roles, owner } = await setupWorkspace();

      const res = await api(owner)
        .post(invitesUrl(workspace), { email: 'hash@example.com', roleId: roles.member._id })
        .expect(201);

      const raw = res.body.data.token;
      const stored = await WorkspaceInvitation.findOne({ email: 'hash@example.com' }).select(
        '+tokenHash'
      );

      expect(stored.tokenHash).toBe(WorkspaceInvitation.hashToken(raw));
      expect(stored.tokenHash).not.toBe(raw);

      // The plaintext must not appear anywhere in the persisted document.
      expect(JSON.stringify(stored.toObject())).not.toContain(raw);
    });

    it('never exposes the token or its hash on the listing endpoint', async () => {
      const { workspace, roles, owner } = await setupWorkspace();

      const created = await api(owner)
        .post(invitesUrl(workspace), { email: 'listed@example.com', roleId: roles.member._id })
        .expect(201);

      const res = await api(owner).get(invitesUrl(workspace)).expect(200);
      const serialised = JSON.stringify(res.body);

      expect(serialised).not.toContain(created.body.data.token);
      expect(serialised).not.toMatch(/tokenHash/i);
    });

    it('protects the invitation list with members.view', async () => {
      const { workspace } = await setupWorkspace();
      const role = await createRole({ workspace, name: 'NoView', permissions: [] });
      const actor = await createMember({ workspace, role });

      await api(actor).get(invitesUrl(workspace)).expect(403);
    });
  });

  // ===========================================================================
  // Acceptance
  // ===========================================================================
  describe('accepting invitations', () => {
    const invite = async (setup, email = 'joiner@example.com', roleId) => {
      const res = await api(setup.owner)
        .post(invitesUrl(setup.workspace), {
          email,
          roleId: roleId ?? setup.roles.member._id,
        })
        .expect(201);
      return res.body.data.token;
    };

    it('creates the membership with the invited role', async () => {
      const setup = await setupWorkspace();
      const token = await invite(setup);
      const joiner = await createUser({ email: 'joiner@example.com' });

      const res = await api(joiner)
        .post('/api/v1/invitations/accept', { token })
        .expect(200);

      expect(res.body.data.accepted).toBe(true);

      const membership = await WorkspaceMembership.findOne({
        workspace: setup.workspace._id,
        user: joiner.user._id,
      }).populate('role');

      expect(membership.status).toBe('active');
      expect(membership.role.systemKey).toBe(SYSTEM_ROLES.MEMBER);
    });

    it('marks the invitation accepted', async () => {
      const setup = await setupWorkspace();
      const token = await invite(setup);
      const joiner = await createUser({ email: 'joiner@example.com' });

      await api(joiner).post('/api/v1/invitations/accept', { token }).expect(200);

      const invitation = await WorkspaceInvitation.findOne({ email: 'joiner@example.com' });
      expect(invitation.status).toBe('accepted');
      expect(invitation.acceptedAt).toBeInstanceOf(Date);
      expect(String(invitation.acceptedBy)).toBe(String(joiner.user._id));
    });

    it('rejects an invalid token', async () => {
      const joiner = await createUser();

      await api(joiner)
        .post('/api/v1/invitations/accept', { token: 'a'.repeat(64) })
        .expect(400);
    });

    it('rejects an expired token', async () => {
      const setup = await setupWorkspace();
      const token = await invite(setup);
      const joiner = await createUser({ email: 'joiner@example.com' });

      await WorkspaceInvitation.updateOne(
        { email: 'joiner@example.com' },
        { $set: { expiresAt: new Date(Date.now() - 1000) } }
      );

      await api(joiner).post('/api/v1/invitations/accept', { token }).expect(400);

      expect(
        await WorkspaceMembership.countDocuments({
          workspace: setup.workspace._id,
          user: joiner.user._id,
        })
      ).toBe(0);
    });

    it('rejects a revoked token', async () => {
      const setup = await setupWorkspace();
      const token = await invite(setup);
      const joiner = await createUser({ email: 'joiner@example.com' });

      const listed = await api(setup.owner).get(invitesUrl(setup.workspace)).expect(200);
      await api(setup.owner)
        .delete(`${invitesUrl(setup.workspace)}/${listed.body.data.invitations[0].invitationId}`)
        .expect(200);

      await api(joiner).post('/api/v1/invitations/accept', { token }).expect(400);
    });

    it('rejects a token that was already used', async () => {
      const setup = await setupWorkspace();
      const token = await invite(setup);
      const joiner = await createUser({ email: 'joiner@example.com' });

      await api(joiner).post('/api/v1/invitations/accept', { token }).expect(200);
      await api(joiner).post('/api/v1/invitations/accept', { token }).expect(400);
    });

    // Every failure must look the same, or the endpoint becomes a token oracle.
    it('gives the same response for invalid, expired and revoked tokens', async () => {
      const setup = await setupWorkspace();
      const joiner = await createUser({ email: 'joiner@example.com' });

      const bogus = await api(joiner)
        .post('/api/v1/invitations/accept', { token: 'b'.repeat(64) });

      const token = await invite(setup);
      await WorkspaceInvitation.updateOne(
        { email: 'joiner@example.com' },
        { $set: { expiresAt: new Date(Date.now() - 1000) } }
      );
      const expired = await api(joiner).post('/api/v1/invitations/accept', { token });

      expect(bogus.status).toBe(expired.status);
      expect(bogus.body.message).toBe(expired.body.message);
    });

    // The invitee joined by some other route between invitation and acceptance.
    // Accepting must reconcile to one membership, not add a second.
    it('does not duplicate a membership if the user already belongs', async () => {
      const setup = await setupWorkspace();
      const token = await invite(setup, 'both@example.com');
      const joiner = await createUser({ email: 'both@example.com' });

      await createMember({
        workspace: setup.workspace,
        role: setup.roles.member,
        actor: joiner,
      });

      await api(joiner).post('/api/v1/invitations/accept', { token }).expect(200);

      expect(
        await WorkspaceMembership.countDocuments({
          workspace: setup.workspace._id,
          user: joiner.user._id,
        })
      ).toBe(1);

      // The invitation is still consumed, so the link cannot be replayed.
      const invitation = await WorkspaceInvitation.findOne({ email: 'both@example.com' });
      expect(invitation.status).toBe('accepted');
    });

    it('refuses an invitation whose role was moved to another workspace', async () => {
      const setup = await setupWorkspace();
      const other = await setupWorkspace({ name: 'Other' });
      const token = await invite(setup);
      const joiner = await createUser({ email: 'joiner@example.com' });

      await WorkspaceInvitation.updateOne(
        { email: 'joiner@example.com' },
        { $set: { role: other.roles.member._id } }
      );

      await api(joiner).post('/api/v1/invitations/accept', { token }).expect(400);
    });
  });

  // ===========================================================================
  // Role assignment
  // ===========================================================================
  describe('assigning roles', () => {
    const roleUrl = (ws, membership) => `${membersUrl(ws)}/${membership._id}/role`;

    it('lets the owner give a member a custom role', async () => {
      const { workspace, owner, member } = await setupWorkspace();
      const custom = await createRole({ workspace, name: 'Photographer' });

      const res = await api(owner)
        .patch(roleUrl(workspace, member.membership), { roleId: custom._id })
        .expect(200);

      expect(res.body.data.member.role.name).toBe('Photographer');
    });

    it('lets the owner promote a member to Admin', async () => {
      const { workspace, roles, owner, member } = await setupWorkspace();

      const res = await api(owner)
        .patch(roleUrl(workspace, member.membership), { roleId: roles.admin._id })
        .expect(200);

      expect(res.body.data.member.role.systemKey).toBe(SYSTEM_ROLES.ADMIN);
    });

    it('lets an admin assign a lower-ranked custom role', async () => {
      const { workspace, admin, member } = await setupWorkspace();
      const custom = await createRole({ workspace, name: 'Editor' });

      await api(admin)
        .patch(roleUrl(workspace, member.membership), { roleId: custom._id })
        .expect(200);
    });

    it('stops an admin creating another admin by default', async () => {
      const { workspace, roles, admin, member } = await setupWorkspace();

      await api(admin)
        .patch(roleUrl(workspace, member.membership), { roleId: roles.admin._id })
        .expect(403);
    });

    it('lets an admin assign Admin once granted members.assign_admin', async () => {
      const { workspace, roles, admin, member } = await setupWorkspace();

      await Role.updateOne(
        { _id: roles.admin._id },
        { $push: { permissions: { key: 'members.assign_admin', scope: 'workspace' } } }
      );

      await api(admin)
        .patch(roleUrl(workspace, member.membership), { roleId: roles.admin._id })
        .expect(200);
    });

    it('denies a plain member', async () => {
      const { workspace, roles, member, admin } = await setupWorkspace();

      await api(member)
        .patch(roleUrl(workspace, admin.membership), { roleId: roles.member._id })
        .expect(403);
    });

    it('denies a custom role that holds assign_role but ranks too low for Admin', async () => {
      const { workspace, roles, member } = await setupWorkspace();
      const coordinator = await createRole({
        workspace,
        name: 'Coordinator',
        permissions: [{ key: 'members.assign_role' }, { key: 'members.view' }],
      });
      const actor = await createMember({ workspace, role: coordinator });

      await api(actor)
        .patch(roleUrl(workspace, member.membership), { roleId: roles.admin._id })
        .expect(403);
    });

    // Ownership moves only through a transfer flow, which does not exist yet.
    it('never allows the Owner role to be assigned', async () => {
      const { workspace, roles, owner, member } = await setupWorkspace();

      await api(owner)
        .patch(roleUrl(workspace, member.membership), { roleId: roles.owner._id })
        .expect(403);
    });

    it('rejects a role from another workspace', async () => {
      const first = await setupWorkspace({ name: 'First' });
      const second = await setupWorkspace({ name: 'Second' });

      await api(first.owner)
        .patch(roleUrl(first.workspace, first.member.membership), {
          roleId: second.roles.member._id,
        })
        .expect(404);
    });

    it('rejects a role that does not exist', async () => {
      const { workspace, owner, member } = await setupWorkspace();

      await api(owner)
        .patch(roleUrl(workspace, member.membership), { roleId: anId() })
        .expect(404);
    });

    it('rejects a membership from another workspace', async () => {
      const first = await setupWorkspace({ name: 'First' });
      const second = await setupWorkspace({ name: 'Second' });

      await api(first.owner)
        .patch(roleUrl(first.workspace, second.member.membership), {
          roleId: first.roles.member._id,
        })
        .expect(404);
    });
  });

  // ===========================================================================
  // Suspension
  // ===========================================================================
  describe('suspending members', () => {
    const suspendUrl = (ws, m) => `${membersUrl(ws)}/${m._id}/suspend`;

    it('suspends a member', async () => {
      const { workspace, owner, member } = await setupWorkspace();

      const res = await api(owner).patch(suspendUrl(workspace, member.membership)).expect(200);

      expect(res.body.data.member.status).toBe('suspended');
    });

    it('denies an actor without members.suspend', async () => {
      const { workspace, admin, member } = await setupWorkspace();

      // Admin is not seeded with members.suspend.
      await api(admin).patch(suspendUrl(workspace, member.membership)).expect(403);
    });

    // The suspension must bite on the very next request.
    it('immediately denies the suspended member', async () => {
      const { workspace, owner, admin } = await setupWorkspace();

      await api(admin).get(membersUrl(workspace)).expect(200);
      await api(owner).patch(suspendUrl(workspace, admin.membership)).expect(200);
      await api(admin).get(membersUrl(workspace)).expect(403);
    });

    it('is idempotent-safe: a second suspension conflicts', async () => {
      const { workspace, owner, member } = await setupWorkspace();

      await api(owner).patch(suspendUrl(workspace, member.membership)).expect(200);
      await api(owner).patch(suspendUrl(workspace, member.membership)).expect(409);
    });

    it('reactivates a suspended member', async () => {
      const { workspace, owner, member } = await setupWorkspace();

      await api(owner).patch(suspendUrl(workspace, member.membership)).expect(200);

      const res = await api(owner)
        .patch(`${membersUrl(workspace)}/${member.membership._id}/reactivate`)
        .expect(200);

      expect(res.body.data.member.status).toBe('active');
    });

    it('refuses to reactivate someone who is not suspended', async () => {
      const { workspace, owner, member } = await setupWorkspace();

      await api(owner)
        .patch(`${membersUrl(workspace)}/${member.membership._id}/reactivate`)
        .expect(409);
    });

    it('refuses to suspend yourself', async () => {
      const { workspace, owner } = await setupWorkspace();
      const ownMembership = await WorkspaceMembership.findOne({
        workspace: workspace._id,
        user: owner.user._id,
      });

      await api(owner).patch(suspendUrl(workspace, ownMembership)).expect(409);
    });
  });

  // ===========================================================================
  // Removal
  // ===========================================================================
  describe('removing members', () => {
    it('removes a member', async () => {
      const { workspace, owner, member } = await setupWorkspace();

      await api(owner).delete(`${membersUrl(workspace)}/${member.membership._id}`).expect(204);

      expect(await WorkspaceMembership.findById(member.membership._id)).toBeNull();
    });

    it('denies an actor without members.remove', async () => {
      const { workspace, member, admin } = await setupWorkspace();

      await api(member).delete(`${membersUrl(workspace)}/${admin.membership._id}`).expect(403);
    });

    it('404s for a membership that does not exist', async () => {
      const { workspace, owner } = await setupWorkspace();

      await api(owner).delete(`${membersUrl(workspace)}/${anId()}`).expect(404);
    });

    it('refuses a membership from another workspace', async () => {
      const first = await setupWorkspace({ name: 'First' });
      const second = await setupWorkspace({ name: 'Second' });

      await api(first.owner)
        .delete(`${membersUrl(first.workspace)}/${second.member.membership._id}`)
        .expect(404);

      expect(await WorkspaceMembership.findById(second.member.membership._id)).not.toBeNull();
    });

    it('refuses self-removal', async () => {
      const { workspace, owner } = await setupWorkspace();
      const ownMembership = await WorkspaceMembership.findOne({
        workspace: workspace._id,
        user: owner.user._id,
      });

      await api(owner).delete(`${membersUrl(workspace)}/${ownMembership._id}`).expect(409);
    });
  });

  // ===========================================================================
  // Owner protection
  // ===========================================================================
  describe('owner protection', () => {
    /** An admin with every member permission, to prove the guard is not just missing perms. */
    const empower = async (roles) => {
      await Role.updateOne(
        { _id: roles.admin._id },
        {
          $push: {
            permissions: {
              $each: [
                { key: 'members.suspend', scope: 'workspace' },
                { key: 'members.assign_admin', scope: 'workspace' },
              ],
            },
          },
        }
      );
    };

    it('cannot remove the owner', async () => {
      const { workspace, roles, owner, admin } = await setupWorkspace();
      await empower(roles);

      const ownerMembership = await WorkspaceMembership.findOne({
        workspace: workspace._id,
        user: owner.user._id,
      });

      const res = await api(admin)
        .delete(`${membersUrl(workspace)}/${ownerMembership._id}`)
        .expect(409);

      expect(res.body.message).toMatch(/owner/i);
      expect(await WorkspaceMembership.findById(ownerMembership._id)).not.toBeNull();
    });

    it('cannot suspend the owner', async () => {
      const { workspace, roles, owner, admin } = await setupWorkspace();
      await empower(roles);

      const ownerMembership = await WorkspaceMembership.findOne({
        workspace: workspace._id,
        user: owner.user._id,
      });

      await api(admin)
        .patch(`${membersUrl(workspace)}/${ownerMembership._id}/suspend`)
        .expect(409);

      const reloaded = await WorkspaceMembership.findById(ownerMembership._id);
      expect(reloaded.status).toBe('active');
    });

    it('cannot downgrade the owner to Member or Admin', async () => {
      const { workspace, roles, owner, admin } = await setupWorkspace();
      await empower(roles);

      const ownerMembership = await WorkspaceMembership.findOne({
        workspace: workspace._id,
        user: owner.user._id,
      });

      for (const roleId of [roles.member._id, roles.admin._id]) {
        await api(admin)
          .patch(`${membersUrl(workspace)}/${ownerMembership._id}/role`, { roleId })
          .expect(409);
      }

      const reloaded = await WorkspaceMembership.findById(ownerMembership._id).populate('role');
      expect(reloaded.role.systemKey).toBe(SYSTEM_ROLES.OWNER);
    });

    it('keeps workspace.owner and the Owner membership consistent throughout', async () => {
      const { workspace, owner } = await setupWorkspace();
      const reloaded = await Workspace.findById(workspace._id);

      const ownerMembership = await WorkspaceMembership.findOne({
        workspace: workspace._id,
        user: owner.user._id,
      }).populate('role');

      expect(String(reloaded.owner)).toBe(String(owner.user._id));
      expect(ownerMembership.role.systemKey).toBe(SYSTEM_ROLES.OWNER);
      expect(ownerMembership.status).toBe('active');
    });
  });

  // ===========================================================================
  // Cross-workspace isolation
  // ===========================================================================
  describe('cross-workspace isolation', () => {
    it('does not let owner authority in one workspace act in another', async () => {
      const a = await setupWorkspace({ name: 'A' });
      const b = await setupWorkspace({ name: 'B' });

      // A's owner joins B as an ordinary member.
      await createMember({ workspace: b.workspace, role: b.roles.member, actor: a.owner });

      // Full authority at home...
      await api(a.owner).get(membersUrl(a.workspace)).expect(200);
      await api(a.owner)
        .delete(`${membersUrl(a.workspace)}/${a.member.membership._id}`)
        .expect(204);

      // ...and none of it travels.
      await api(a.owner)
        .delete(`${membersUrl(b.workspace)}/${b.member.membership._id}`)
        .expect(403);

      await api(a.owner)
        .post(invitesUrl(b.workspace), {
          email: 'x@example.com',
          roleId: b.roles.member._id,
        })
        .expect(403);
    });

    it('cannot revoke another workspace’s invitation', async () => {
      const a = await setupWorkspace({ name: 'A' });
      const b = await setupWorkspace({ name: 'B' });

      const created = await api(b.owner)
        .post(invitesUrl(b.workspace), { email: 'target@example.com', roleId: b.roles.member._id })
        .expect(201);

      await api(a.owner)
        .delete(`${invitesUrl(a.workspace)}/${created.body.data.invitation.invitationId}`)
        .expect(404);

      const still = await WorkspaceInvitation.findById(
        created.body.data.invitation.invitationId
      );
      expect(still.status).toBe('pending');
    });
  });

  // ===========================================================================
  // Proof that the engine is actually being used
  // ===========================================================================
  describe('authorization engine integration', () => {
    afterEach(() => jest.restoreAllMocks());

    // Without this, endpoint tests could pass against reimplemented rules.
    it('routes every protected operation through the Stage 5 engine', async () => {
      const { workspace, owner, member, roles } = await setupWorkspace();
      const spy = jest.spyOn(authorization, 'authorize');

      await api(owner).get(membersUrl(workspace)).expect(200);
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ permission: 'members.view' })
      );

      spy.mockClear();
      await api(owner)
        .post(invitesUrl(workspace), { email: 'spy@example.com', roleId: roles.member._id })
        .expect(201);
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ permission: 'members.invite' })
      );

      spy.mockClear();
      await api(owner).patch(`${membersUrl(workspace)}/${member.membership._id}/suspend`).expect(200);
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ permission: 'members.suspend' })
      );
    });

    it('routes role assignment through checkRoleAssignment', async () => {
      const { workspace, owner, member, roles } = await setupWorkspace();
      const spy = jest.spyOn(authorization, 'checkRoleAssignment');

      await api(owner)
        .patch(`${membersUrl(workspace)}/${member.membership._id}/role`, {
          roleId: roles.member._id,
        })
        .expect(200);

      expect(spy).toHaveBeenCalled();
    });

    // The service, not just the controller, is the security boundary.
    it('protects the service even when called directly, bypassing HTTP', async () => {
      const { workspace, roles } = await setupWorkspace();

      // A role with no permissions at all — the seeded Member role does hold
      // members.view, so it would not prove anything here.
      const powerless = await createRole({ workspace, name: 'Powerless', permissions: [] });
      const actor = await createMember({ workspace, role: powerless });

      await expect(
        membershipService.listMembers({
          workspaceId: workspace._id,
          actorUserId: actor.user._id,
        })
      ).rejects.toMatchObject({ name: 'AuthorizationError' });

      await expect(
        invitationService.inviteMember({
          workspaceId: workspace._id,
          actorUserId: actor.user._id,
          email: 'direct@example.com',
          roleId: roles.member._id,
        })
      ).rejects.toMatchObject({ name: 'AuthorizationError' });

      await expect(
        membershipService.removeMember({
          workspaceId: workspace._id,
          actorUserId: actor.user._id,
          membershipId: anId(),
        })
      ).rejects.toMatchObject({ name: 'AuthorizationError' });
    });

    it('requires authentication on every endpoint', async () => {
      const { workspace, member } = await setupWorkspace();

      await request(app).get(membersUrl(workspace)).expect(401);
      await request(app).post(invitesUrl(workspace)).send({}).expect(401);
      await request(app)
        .delete(`${membersUrl(workspace)}/${member.membership._id}`)
        .expect(401);
      await request(app).post('/api/v1/invitations/accept').send({}).expect(401);
    });
  });

  // ===========================================================================
  // Concurrency
  // ===========================================================================
  describe('concurrency', () => {
    it('turns a duplicate-invitation race into exactly one invitation', async () => {
      const { workspace, roles, owner } = await setupWorkspace();

      const attempts = await Promise.allSettled(
        Array.from({ length: 4 }, () =>
          invitationService.inviteMember({
            workspaceId: workspace._id,
            actorUserId: owner.user._id,
            email: 'racer@example.com',
            roleId: roles.member._id,
          })
        )
      );

      const created = attempts.filter((a) => a.status === 'fulfilled');

      expect(created).toHaveLength(1);
      expect(
        await WorkspaceInvitation.countDocuments({
          workspace: workspace._id,
          email: 'racer@example.com',
          status: 'pending',
        })
      ).toBe(1);

      // The losers must fail as a domain conflict, not a raw driver error.
      attempts
        .filter((a) => a.status === 'rejected')
        .forEach((a) => {
          expect(a.reason.name).toBe('WorkspaceDomainError');
          expect(a.reason.statusCode).toBe(409);
        });
    });

    it('turns a concurrent acceptance race into exactly one membership', async () => {
      const setup = await setupWorkspace();
      const joiner = await createUser({ email: 'racer2@example.com' });

      const { token } = await invitationService.inviteMember({
        workspaceId: setup.workspace._id,
        actorUserId: setup.owner.user._id,
        email: 'racer2@example.com',
        roleId: setup.roles.member._id,
      });

      const attempts = await Promise.allSettled(
        Array.from({ length: 3 }, () =>
          invitationService.acceptInvitation({ token, userId: joiner.user._id })
        )
      );

      expect(attempts.some((a) => a.status === 'fulfilled')).toBe(true);
      expect(
        await WorkspaceMembership.countDocuments({
          workspace: setup.workspace._id,
          user: joiner.user._id,
        })
      ).toBe(1);
    });
  });
});
