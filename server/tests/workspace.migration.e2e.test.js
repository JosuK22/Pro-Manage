const mongoose = require('mongoose');

const User = require('../model/userModel');
const Task = require('../model/taskModel');
const Assignee = require('../model/assigneeModel');
const Workspace = require('../model/workspaceModel');
const Role = require('../model/roleModel');
const WorkspaceMembership = require('../model/workspaceMembershipModel');
const WorkspaceInvitation = require('../model/workspaceInvitationModel');
const { SYSTEM_ROLES } = require('../model/roleModel');

const {
  preflight,
  buildPlan,
  execute,
  validate,
} = require('../services/workspaceMigration');
const { provisionWorkspace } = require('../services/workspaceProvisioning');
const authorization = require('../services/authorization');

const anId = () => new mongoose.Types.ObjectId();

/**
 * Stage 8.2 — controlled migration rehearsal.
 *
 * Runs against the suite's in-memory MongoDB, which is disposable and contains
 * no real data. The configured `MONGODB_URI` — a live Atlas cluster — is never
 * touched by this file.
 *
 * The fixtures below deliberately cover the awkward cases rather than the happy
 * path: a user who already has a workspace, a user who owns extra non-personal
 * workspaces, an assignee who is also the owner, casing duplicates, an
 * unregistered invitee, and a task whose creator no longer exists.
 */

const rawUser = async (name, email) => {
  const user = await User.create({
    name,
    email,
    password: 'a-good-long-password',
    confirmPassword: 'a-good-long-password',
  });
  return user;
};

/** A legacy task written straight to the collection, as production data would be. */
const legacyTask = (createdBy, overrides = {}) =>
  Task.collection.insertOne({
    title: 'Legacy task',
    priority: 'low',
    status: 'todo',
    checklists: [{ title: 'step', checked: false }],
    createdBy: new mongoose.Types.ObjectId(String(createdBy)),
    workspace: null,
    assignee: null,
    assignedTo: null,
    createdAt: new Date(),
    completedAt: null,
    ...overrides,
  });

const snapshot = async () => ({
  users: await User.countDocuments(),
  workspaces: await Workspace.countDocuments(),
  personalWorkspaces: await Workspace.countDocuments({ isPersonal: true }),
  roles: await Role.countDocuments(),
  memberships: await WorkspaceMembership.countDocuments(),
  invitations: await WorkspaceInvitation.countDocuments(),
  assignees: await Assignee.countDocuments(),
  tasks: await Task.countDocuments(),
  tasksWithWorkspace: await Task.countDocuments({ workspace: { $ne: null } }),
  tasksWithoutWorkspace: await Task.countDocuments({ workspace: null }),
});

/**
 * The §25 fixture set.
 *
 * @returns handles the assertions need.
 */
const seedLegacyWorld = async () => {
  // 1. A plain user with no workspace at all.
  const ada = await rawUser('Ada', 'ada@example.com');

  // 2. A user who already has a personal workspace (partially migrated).
  const grace = await rawUser('Grace', 'grace@example.com');
  const graceWorkspace = await provisionWorkspace({
    owner: grace,
    name: "Grace's Workspace",
    isPersonal: true,
  });

  // 3. A user who owns extra *non-personal* workspaces — the case that would
  //    break a "find the workspace they own" resolution strategy.
  const linus = await rawUser('Linus', 'linus@example.com');
  await provisionWorkspace({ owner: linus, name: 'Side Project A' });
  await provisionWorkspace({ owner: linus, name: 'Side Project B' });

  // 4. A user who is an assignee of someone else.
  const mate = await rawUser('Mate', 'mate@example.com');

  // 5. Known assignee → should become a membership.
  await Assignee.create({ email: 'mate@example.com', createdBy: ada._id });

  // 6. Unknown assignee → should become a pending invitation.
  await Assignee.create({ email: 'stranger@example.com', createdBy: ada._id });

  // 7. Casing duplicates → must collapse to one membership.
  await Assignee.collection.insertMany([
    { email: 'MATE@example.com', createdBy: grace._id, createdAt: new Date() },
    { email: 'mate@example.com', createdBy: grace._id, createdAt: new Date() },
  ]);

  // 8. The owner listed as their own assignee → must not duplicate a membership.
  await Assignee.create({ email: 'ada@example.com', createdBy: ada._id });

  // 9. Tasks across several creators.
  await legacyTask(ada._id, { title: 'Ada one' });
  await legacyTask(ada._id, { title: 'Ada two' });
  await legacyTask(grace._id, { title: 'Grace one' });
  await legacyTask(linus._id, { title: 'Linus one' });

  // 10. A task already carrying a workspace — must not be overwritten.
  await legacyTask(ada._id, {
    title: 'Already scoped',
    workspace: graceWorkspace.workspace._id,
  });

  // 11. An orphan: its creator does not exist.
  const ghostId = anId();
  await legacyTask(ghostId, { title: 'Orphan' });

  return { ada, grace, linus, mate, graceWorkspace, ghostId };
};

describe('Stage 8.2 — migration rehearsal on a disposable database', () => {
  // ===========================================================================
  // Preflight
  // ===========================================================================
  describe('preflight', () => {
    it('reports readiness without writing anything', async () => {
      await seedLegacyWorld();
      const before = await snapshot();

      const result = await preflight();

      expect(await snapshot()).toEqual(before);
      expect(result).toHaveProperty('indexes');
      expect(result).toHaveProperty('findings');
    });

    it('confirms every existing workspace has its three system roles', async () => {
      await seedLegacyWorld();

      const result = await preflight();

      expect(result.workspacesMissingRoles).toBe(0);
      expect(result.ready).toBe(true);
    });

    // A workspace missing a system role must be surfaced, not discovered later.
    it('flags a workspace whose system role went missing', async () => {
      const { graceWorkspace } = await seedLegacyWorld();

      await Role.deleteOne({
        workspace: graceWorkspace.workspace._id,
        systemKey: SYSTEM_ROLES.ADMIN,
      });

      const result = await preflight();

      expect(result.ready).toBe(false);
      expect(result.workspacesMissingRoles).toBe(1);
      expect(result.findings.some((f) => /ADMIN/.test(f.reason))).toBe(true);
    });

    it('resolves system roles by systemKey, not display name', async () => {
      const { graceWorkspace } = await seedLegacyWorld();

      await Role.updateOne(
        { workspace: graceWorkspace.workspace._id, systemKey: SYSTEM_ROLES.MEMBER },
        { $set: { name: 'Contributor' } }
      );

      const result = await preflight();

      expect(result.ready).toBe(true);
      expect(result.workspacesMissingRoles).toBe(0);
    });
  });

  // ===========================================================================
  // The full cycle
  // ===========================================================================
  describe('execution', () => {
    it('migrates the whole legacy world and validates clean', async () => {
      const world = await seedLegacyWorld();
      const before = await snapshot();

      const plan = await buildPlan();
      const applied = await execute(plan);
      const validation = await validate();

      // Baseline expectations, from the fixtures above.
      expect(before.users).toBe(4);
      expect(before.tasksWithWorkspace).toBe(1);
      expect(before.tasksWithoutWorkspace).toBe(5);

      expect(applied.errors).toEqual([]);
      expect(validation.failures).toEqual([]);
      expect(validation.passed).toBe(true);

      const after = await snapshot();

      // Ada and Mate needed personal workspaces; Grace already had one; Linus
      // owns two non-personal workspaces but still needed a personal one.
      expect(after.personalWorkspaces).toBe(4);
      expect(after.tasksWithoutWorkspace).toBe(1); // the orphan only
      expect(plan.stats.tasks.orphaned).toBe(1);

      expect(world.ghostId).toBeDefined();
    });

    it('gives every user exactly one personal workspace with an active owner membership', async () => {
      await seedLegacyWorld();

      await execute(await buildPlan());

      const users = await User.find().lean();

      for (const user of users) {
        const personal = await Workspace.find({ owner: user._id, isPersonal: true });
        expect(personal).toHaveLength(1);

        const membership = await WorkspaceMembership.findOne({
          workspace: personal[0]._id,
          user: user._id,
        }).populate('role');

        expect(membership.status).toBe('active');
        expect(membership.role.systemKey).toBe(SYSTEM_ROLES.OWNER);
        expect(String(personal[0].owner)).toBe(String(user._id));
      }
    });

    // The case that would defeat "resolve the workspace they own".
    it('does not mistake a non-personal workspace for the personal one', async () => {
      const { linus } = await seedLegacyWorld();

      await execute(await buildPlan());

      const owned = await Workspace.find({ owner: linus._id });
      const personal = owned.filter((w) => w.isPersonal);

      expect(owned).toHaveLength(3);
      expect(personal).toHaveLength(1);
      expect(personal[0].name).toBe("Linus's Workspace");

      const linusTask = await Task.findOne({ title: 'Linus one' });
      expect(String(linusTask.workspace)).toBe(String(personal[0]._id));
    });

    it('never overwrites a task that already had a workspace', async () => {
      const { graceWorkspace } = await seedLegacyWorld();

      await execute(await buildPlan());

      const task = await Task.findOne({ title: 'Already scoped' });
      expect(String(task.workspace)).toBe(String(graceWorkspace.workspace._id));
    });

    it('leaves the orphan untouched rather than guessing', async () => {
      await seedLegacyWorld();

      await execute(await buildPlan());

      const orphan = await Task.findOne({ title: 'Orphan' });
      expect(orphan).not.toBeNull();
      expect(orphan.workspace).toBeNull();
    });

    it('preserves every legacy record', async () => {
      await seedLegacyWorld();
      const before = await snapshot();

      await execute(await buildPlan());

      const after = await snapshot();
      expect(after.users).toBe(before.users);
      expect(after.tasks).toBe(before.tasks);
      expect(after.assignees).toBe(before.assignees); // Assignee is NOT retired
    });
  });

  // ===========================================================================
  // Assignee conversion
  // ===========================================================================
  describe('assignee conversion', () => {
    it('turns a known assignee into a membership in the creator’s workspace', async () => {
      const { ada, mate } = await seedLegacyWorld();

      await execute(await buildPlan());

      const adaWorkspace = await Workspace.findOne({ owner: ada._id, isPersonal: true });
      const membership = await WorkspaceMembership.findOne({
        workspace: adaWorkspace._id,
        user: mate._id,
      }).populate('role');

      expect(membership.role.systemKey).toBe(SYSTEM_ROLES.MEMBER);
      expect(membership.status).toBe('active');
    });

    it('turns an unknown email into a pending invitation with no token', async () => {
      const { ada } = await seedLegacyWorld();

      await execute(await buildPlan());

      const adaWorkspace = await Workspace.findOne({ owner: ada._id, isPersonal: true });
      const invitation = await WorkspaceInvitation.findOne({
        workspace: adaWorkspace._id,
        email: 'stranger@example.com',
      })
        .select('+tokenHash')
        .populate('role');

      expect(invitation.status).toBe('pending');
      expect(invitation.role.systemKey).toBe(SYSTEM_ROLES.MEMBER);
      // A migrated record is not an invitation anyone was ever sent.
      expect(invitation.tokenHash).toBeNull();
      expect(invitation.expiresAt).toBeNull();
    });

    it('creates no user for an unknown email', async () => {
      await seedLegacyWorld();

      await execute(await buildPlan());

      expect(await User.countDocuments({ email: 'stranger@example.com' })).toBe(0);
      expect(await User.countDocuments()).toBe(4);
    });

    it('collapses casing duplicates into one membership', async () => {
      const { grace, mate } = await seedLegacyWorld();

      const plan = await buildPlan();
      await execute(plan);

      const graceWorkspace = await Workspace.findOne({ owner: grace._id, isPersonal: true });

      expect(
        await WorkspaceMembership.countDocuments({
          workspace: graceWorkspace._id,
          user: mate._id,
        })
      ).toBe(1);
      expect(plan.stats.assignees.collapsed).toBe(1);
    });

    it('does not demote an owner listed as their own assignee', async () => {
      const { ada } = await seedLegacyWorld();

      const plan = await buildPlan();
      await execute(plan);

      const adaWorkspace = await Workspace.findOne({ owner: ada._id, isPersonal: true });
      const membership = await WorkspaceMembership.findOne({
        workspace: adaWorkspace._id,
        user: ada._id,
      }).populate('role');

      expect(membership.role.systemKey).toBe(SYSTEM_ROLES.OWNER);
      expect(plan.stats.assignees.ownerSkipped).toBe(1);
    });
  });

  // ===========================================================================
  // Integrity
  // ===========================================================================
  describe('referential and cross-workspace integrity', () => {
    beforeEach(async () => {
      await seedLegacyWorld();
      await execute(await buildPlan());
    });

    it('has no dangling workspace references anywhere', async () => {
      const workspaceIds = new Set(
        (await Workspace.find().select('_id').lean()).map((w) => String(w._id))
      );

      const checks = [
        ['task', await Task.find({ workspace: { $ne: null } }).lean()],
        ['membership', await WorkspaceMembership.find().lean()],
        ['invitation', await WorkspaceInvitation.find().lean()],
        ['role', await Role.find().lean()],
      ];

      for (const [, docs] of checks) {
        for (const doc of docs) {
          expect(workspaceIds.has(String(doc.workspace))).toBe(true);
        }
      }
    });

    it('has no dangling role references', async () => {
      const roleIds = new Set(
        (await Role.find().select('_id').lean()).map((r) => String(r._id))
      );

      for (const membership of await WorkspaceMembership.find().lean()) {
        expect(roleIds.has(String(membership.role))).toBe(true);
      }
      for (const invitation of await WorkspaceInvitation.find().lean()) {
        expect(roleIds.has(String(invitation.role))).toBe(true);
      }
    });

    it('has no membership or invitation pointing at another workspace’s role', async () => {
      const roles = new Map(
        (await Role.find().select('_id workspace').lean()).map((r) => [
          String(r._id),
          String(r.workspace),
        ])
      );

      for (const membership of await WorkspaceMembership.find().lean()) {
        expect(roles.get(String(membership.role))).toBe(String(membership.workspace));
      }
      for (const invitation of await WorkspaceInvitation.find().lean()) {
        expect(roles.get(String(invitation.role))).toBe(String(invitation.workspace));
      }
    });

    it('has exactly one personal workspace per owner', async () => {
      const personal = await Workspace.find({ isPersonal: true }).lean();
      const owners = personal.map((w) => String(w.owner));

      expect(new Set(owners).size).toBe(owners.length);
    });

    it('has every workspace owner pointing at a real user', async () => {
      const userIds = new Set(
        (await User.find().select('_id').lean()).map((u) => String(u._id))
      );

      for (const workspace of await Workspace.find().lean()) {
        expect(userIds.has(String(workspace.owner))).toBe(true);
      }
    });

    it('has every OWNER membership matching its workspace owner', async () => {
      const ownerRoles = await Role.find({ systemKey: SYSTEM_ROLES.OWNER }).lean();

      for (const role of ownerRoles) {
        const memberships = await WorkspaceMembership.find({ role: role._id }).lean();
        const workspace = await Workspace.findById(role.workspace).lean();

        expect(memberships).toHaveLength(1);
        expect(String(memberships[0].user)).toBe(String(workspace.owner));
      }
    });
  });

  // ===========================================================================
  // Idempotency
  // ===========================================================================
  describe('idempotency', () => {
    it('produces identical counts on a second and third run', async () => {
      await seedLegacyWorld();

      await execute(await buildPlan());
      const afterFirst = await snapshot();
      expect((await validate()).passed).toBe(true);

      const second = await execute(await buildPlan());
      const afterSecond = await snapshot();
      expect((await validate()).passed).toBe(true);

      const third = await execute(await buildPlan());
      const afterThird = await snapshot();

      expect(afterSecond).toEqual(afterFirst);
      expect(afterThird).toEqual(afterFirst);

      for (const applied of [second, third]) {
        expect(applied.workspacesCreated).toBe(0);
        expect(applied.rolesCreated).toBe(0);
        expect(applied.ownerMembershipsCreated).toBe(0);
        expect(applied.membershipsCreated).toBe(0);
        expect(applied.invitationsCreated).toBe(0);
        expect(applied.tasksBackfilled).toBe(0);
        expect(applied.errors).toEqual([]);
      }
    });

    // §24: reset → migrate → validate → reset → migrate again, reliably.
    //
    // A full wipe and re-seed, not a partial cleanup: dropping only the
    // workspaces would also destroy the fixture's *non-personal* ones, which
    // the migration is right not to recreate, and the two runs would then be
    // measuring different worlds.
    it('produces identical results across a full reset-and-repeat cycle', async () => {
      const wipe = () =>
        Promise.all(
          [
            User,
            Task,
            Assignee,
            Workspace,
            Role,
            WorkspaceMembership,
            WorkspaceInvitation,
          ].map((model) => model.deleteMany({}))
        );

      await seedLegacyWorld();
      await execute(await buildPlan());
      expect((await validate()).passed).toBe(true);
      const first = await snapshot();

      await wipe();
      expect((await snapshot()).users).toBe(0);

      await seedLegacyWorld();
      await execute(await buildPlan());
      expect((await validate()).passed).toBe(true);
      const second = await snapshot();

      expect(second).toEqual(first);
    });
  });

  // ===========================================================================
  // Failure paths
  // ===========================================================================
  describe('failure paths', () => {
    it('reports a task whose creator vanished, without inventing a workspace', async () => {
      await legacyTask(anId(), { title: 'No creator' });

      const plan = await buildPlan();
      const applied = await execute(plan);

      expect(plan.stats.tasks.orphaned).toBe(1);
      expect(applied.errors).toEqual([]);
      expect((await Task.findOne({ title: 'No creator' })).workspace).toBeNull();
    });

    it('reports an assignee whose creator vanished', async () => {
      await Assignee.create({ email: 'orphan@example.com', createdBy: anId() });

      const plan = await buildPlan();

      expect(
        plan.anomalies.some((a) => a.type === 'Assignee' && /does not exist/.test(a.reason))
      ).toBe(true);
      expect(plan.stats.invitations.toCreate).toBe(0);
    });

    // Corrupted data must not be laundered into apparently valid data.
    it('fails validation when a membership is pointed at a foreign role', async () => {
      const { ada, grace } = await seedLegacyWorld();
      await execute(await buildPlan());

      const adaWorkspace = await Workspace.findOne({ owner: ada._id, isPersonal: true });
      const graceRole = await Role.findOne({
        workspace: (await Workspace.findOne({ owner: grace._id, isPersonal: true }))._id,
        systemKey: SYSTEM_ROLES.MEMBER,
      });

      await WorkspaceMembership.updateOne(
        { workspace: adaWorkspace._id, user: ada._id },
        { $set: { role: graceRole._id } }
      );

      const validation = await validate();

      expect(validation.passed).toBe(false);
      expect(
        validation.failures.some((f) => /role\.workspace/.test(f.check))
      ).toBe(true);
    });

    it('fails validation on a dangling workspace reference', async () => {
      await seedLegacyWorld();
      await execute(await buildPlan());

      await Task.updateOne({ title: 'Ada one' }, { $set: { workspace: anId() } });

      const validation = await validate();

      expect(validation.passed).toBe(false);
      expect(
        validation.failures.some((f) => /references an existing workspace/.test(f.check))
      ).toBe(true);
    });

    it('fails validation when a system role is deleted after migration', async () => {
      await seedLegacyWorld();
      await execute(await buildPlan());

      await Role.deleteOne({ systemKey: SYSTEM_ROLES.MEMBER });

      const validation = await validate();
      expect(validation.passed).toBe(false);
    });

    it('fails validation when an owner membership is removed', async () => {
      const { ada } = await seedLegacyWorld();
      await execute(await buildPlan());

      const adaWorkspace = await Workspace.findOne({ owner: ada._id, isPersonal: true });
      await WorkspaceMembership.deleteOne({ workspace: adaWorkspace._id, user: ada._id });

      const validation = await validate();

      expect(validation.passed).toBe(false);
      expect(
        validation.failures.some((f) => /exactly one owner membership/.test(f.check))
      ).toBe(true);
    });

    it('reports an un-backfilled task rather than declaring success', async () => {
      const { ada } = await seedLegacyWorld();
      await execute(await buildPlan());

      await legacyTask(ada._id, { title: 'Late arrival' });

      const validation = await validate();

      expect(validation.passed).toBe(false);
      expect(validation.failures.some((f) => f.check === 'task backfilled')).toBe(true);
    });
  });

  // ===========================================================================
  // Authorization smoke tests
  // ===========================================================================
  describe('authorization smoke tests on migrated data', () => {
    it('lets a migrated owner act in their own workspace', async () => {
      const { ada } = await seedLegacyWorld();
      await execute(await buildPlan());

      const workspace = await Workspace.findOne({ owner: ada._id, isPersonal: true });

      const result = await authorization.check({
        userId: ada._id,
        workspaceId: workspace._id,
        permission: 'workspace.delete',
      });

      expect(result.allowed).toBe(true);
      expect(result.isOwner).toBe(true);
    });

    it('gives a migrated assignee the Member role’s capabilities and no more', async () => {
      const { ada, mate } = await seedLegacyWorld();
      await execute(await buildPlan());

      const adaWorkspace = await Workspace.findOne({ owner: ada._id, isPersonal: true });

      const allowed = await authorization.check({
        userId: mate._id,
        workspaceId: adaWorkspace._id,
        permission: 'tasks.view',
        scope: 'assigned',
      });
      expect(allowed.allowed).toBe(true);

      // Member holds no delete permission — the Stage 6 behaviour change.
      const denied = await authorization.check({
        userId: mate._id,
        workspaceId: adaWorkspace._id,
        permission: 'tasks.delete',
      });
      expect(denied.allowed).toBe(false);
    });

    it('refuses a non-member of a migrated workspace', async () => {
      const { ada, linus } = await seedLegacyWorld();
      await execute(await buildPlan());

      const adaWorkspace = await Workspace.findOne({ owner: ada._id, isPersonal: true });

      const result = await authorization.check({
        userId: linus._id,
        workspaceId: adaWorkspace._id,
        permission: 'tasks.view',
      });

      expect(result.allowed).toBe(false);
      expect(result.code).toBe(authorization.DENIAL.NOT_A_MEMBER);
    });

    it('does not carry owner authority between migrated workspaces', async () => {
      const { ada, mate } = await seedLegacyWorld();
      await execute(await buildPlan());

      const adaWorkspace = await Workspace.findOne({ owner: ada._id, isPersonal: true });

      // Mate owns their own workspace and is a member of Ada's.
      const result = await authorization.check({
        userId: mate._id,
        workspaceId: adaWorkspace._id,
        permission: 'workspace.delete',
      });

      expect(result.allowed).toBe(false);
    });

    // The reason Task.workspace cannot be enforced until the real migration runs.
    it('still refuses a task that the migration could not scope', async () => {
      const { ada } = await seedLegacyWorld();
      await execute(await buildPlan());

      const adaWorkspace = await Workspace.findOne({ owner: ada._id, isPersonal: true });
      const orphan = await Task.findOne({ title: 'Orphan' });

      const result = await authorization.check({
        userId: ada._id,
        workspaceId: adaWorkspace._id,
        permission: 'tasks.view',
        resource: orphan,
      });

      expect(result.allowed).toBe(false);
      expect(result.code).toBe(authorization.DENIAL.RESOURCE_OUTSIDE_WORKSPACE);
    });

    it('allows a migrated task through the engine', async () => {
      const { ada } = await seedLegacyWorld();
      await execute(await buildPlan());

      const adaWorkspace = await Workspace.findOne({ owner: ada._id, isPersonal: true });
      const task = await Task.findOne({ title: 'Ada one' });

      const result = await authorization.check({
        userId: ada._id,
        workspaceId: adaWorkspace._id,
        permission: 'tasks.view',
        resource: task,
      });

      expect(result.allowed).toBe(true);
    });
  });
});
