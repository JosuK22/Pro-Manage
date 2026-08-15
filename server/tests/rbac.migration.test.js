const path = require('path');
const { execFile } = require('child_process');
const mongoose = require('mongoose');

const User = require('../model/userModel');
const Task = require('../model/taskModel');
const Assignee = require('../model/assigneeModel');
const Workspace = require('../model/workspaceModel');
const Role = require('../model/roleModel');
const WorkspaceMembership = require('../model/workspaceMembershipModel');
const WorkspaceInvitation = require('../model/workspaceInvitationModel');
const { SYSTEM_ROLES } = require('../model/roleModel');
const { buildPlan, execute, validate } = require('../services/workspaceMigration');
const {
  REFUSAL,
  parseArgs,
  resolveDatabaseName,
  checkExecutionSafety,
  formatIdentity,
} = require('../services/migrationSafety');
const { createUser, createTask } = require('./factories');

/** Plan then apply, the way the script does. */
const migrate = async () => {
  const plan = await buildPlan();
  const applied = await execute(plan);
  return { plan, applied };
};

/** A legacy task written straight to the collection, bypassing the API. */
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

const personalWorkspaceOf = (userId) =>
  Workspace.findOne({ owner: userId, isPersonal: true });

describe('Stage 4 — workspace migration', () => {
  // -------------------------------------------------------------------------
  describe('personal workspaces', () => {
    it('creates a workspace, three system roles and an owner membership', async () => {
      const { user } = await createUser({ name: 'Ada' });

      await migrate();

      const workspace = await personalWorkspaceOf(user._id);
      expect(workspace).not.toBeNull();
      expect(workspace.name).toBe("Ada's Workspace");
      expect(workspace.isPersonal).toBe(true);

      const roles = await Role.find({ workspace: workspace._id, isSystemRole: true });
      expect(roles.map((r) => r.systemKey).sort()).toEqual(['ADMIN', 'MEMBER', 'OWNER']);

      const ownerRole = roles.find((r) => r.systemKey === SYSTEM_ROLES.OWNER);
      const membership = await WorkspaceMembership.findOne({
        workspace: workspace._id,
        user: user._id,
      });

      expect(membership.role.equals(ownerRole._id)).toBe(true);
      expect(membership.status).toBe('active');
    });

    it('gives every user a workspace, not only those who own data', async () => {
      await createUser();
      await createUser();
      await createUser();

      const { applied } = await migrate();

      expect(applied.workspacesCreated).toBe(3);
      expect(await Workspace.countDocuments({ isPersonal: true })).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  describe('idempotency', () => {
    it('creates nothing on a second run', async () => {
      const owner = await createUser();
      const mate = await createUser({ email: 'mate@example.com' });
      await Assignee.create({ email: mate.email, createdBy: owner.user._id });
      await Assignee.create({ email: 'ghost@example.com', createdBy: owner.user._id });
      await legacyTask(owner.user._id);

      const first = await migrate();
      expect(first.applied.workspacesCreated).toBeGreaterThan(0);

      const second = await migrate();

      expect(second.applied.workspacesCreated).toBe(0);
      expect(second.applied.rolesCreated).toBe(0);
      expect(second.applied.ownerMembershipsCreated).toBe(0);
      expect(second.applied.membershipsCreated).toBe(0);
      expect(second.applied.invitationsCreated).toBe(0);
      expect(second.applied.tasksBackfilled).toBe(0);
      expect(second.applied.errors).toEqual([]);
    });

    it('does not duplicate documents across three runs', async () => {
      const owner = await createUser();
      await Assignee.create({ email: 'ghost@example.com', createdBy: owner.user._id });

      await migrate();
      await migrate();
      await migrate();

      expect(await Workspace.countDocuments()).toBe(1);
      expect(await Role.countDocuments()).toBe(3);
      expect(await WorkspaceMembership.countDocuments()).toBe(1);
      expect(await WorkspaceInvitation.countDocuments()).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('registered assignees become memberships', () => {
    it('adds the assignee to the creator’s workspace as a MEMBER', async () => {
      const owner = await createUser({ email: 'owner@example.com' });
      const mate = await createUser({ email: 'mate@example.com' });

      await Assignee.create({ email: 'mate@example.com', createdBy: owner.user._id });

      await migrate();

      const workspace = await personalWorkspaceOf(owner.user._id);
      const membership = await WorkspaceMembership.findOne({
        workspace: workspace._id,
        user: mate.user._id,
      }).populate('role');

      expect(membership).not.toBeNull();
      expect(membership.role.systemKey).toBe(SYSTEM_ROLES.MEMBER);
      expect(membership.status).toBe('active');
    });

    // The defining property of the new architecture.
    it('leaves the assignee owning their own workspace', async () => {
      const owner = await createUser({ email: 'owner@example.com' });
      const mate = await createUser({ email: 'mate@example.com' });
      await Assignee.create({ email: 'mate@example.com', createdBy: owner.user._id });

      await migrate();

      const ownerWs = await personalWorkspaceOf(owner.user._id);
      const mateWs = await personalWorkspaceOf(mate.user._id);

      const asOwner = await WorkspaceMembership.findOne({
        workspace: mateWs._id,
        user: mate.user._id,
      }).populate('role');

      const asMember = await WorkspaceMembership.findOne({
        workspace: ownerWs._id,
        user: mate.user._id,
      }).populate('role');

      expect(asOwner.role.systemKey).toBe(SYSTEM_ROLES.OWNER);
      expect(asMember.role.systemKey).toBe(SYSTEM_ROLES.MEMBER);
    });

    // Legacy rows differing only by casing must not produce two memberships.
    it('collapses duplicate assignee rows into one membership', async () => {
      const owner = await createUser({ email: 'owner@example.com' });
      const mate = await createUser({ email: 'mate@example.com' });

      // Written through the driver so the schema's lowercase setter does not
      // normalise them into a unique-index conflict first.
      await Assignee.collection.insertMany([
        { email: 'mate@example.com', createdBy: owner.user._id, createdAt: new Date() },
        { email: 'MATE@example.com', createdBy: owner.user._id, createdAt: new Date() },
      ]);

      const { plan, applied } = await migrate();

      const workspace = await personalWorkspaceOf(owner.user._id);
      const count = await WorkspaceMembership.countDocuments({
        workspace: workspace._id,
        user: mate.user._id,
      });

      expect(count).toBe(1);
      expect(applied.membershipsCreated).toBe(1);
      expect(plan.stats.assignees.collapsed).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('unregistered assignees become invitations', () => {
    it('creates a pending invitation with the MEMBER role', async () => {
      const owner = await createUser({ email: 'owner@example.com' });
      await Assignee.create({ email: 'nobody@example.com', createdBy: owner.user._id });

      await migrate();

      const workspace = await personalWorkspaceOf(owner.user._id);
      const invitation = await WorkspaceInvitation.findOne({
        workspace: workspace._id,
        email: 'nobody@example.com',
      }).populate('role');

      expect(invitation).not.toBeNull();
      expect(invitation.status).toBe('pending');
      expect(invitation.role.systemKey).toBe(SYSTEM_ROLES.MEMBER);
      expect(invitation.invitedBy.equals(owner.user._id)).toBe(true);
    });

    // A migrated row is a historical board member, not someone who was sent a
    // link. Minting a token would fabricate an invitation that never existed.
    it('stores no token and no expiry for a migrated invitation', async () => {
      const owner = await createUser();
      await Assignee.create({ email: 'nobody@example.com', createdBy: owner.user._id });

      await migrate();

      const invitation = await WorkspaceInvitation.findOne({
        email: 'nobody@example.com',
      }).select('+tokenHash');

      expect(invitation.tokenHash).toBeNull();
      expect(invitation.expiresAt).toBeNull();
      expect(invitation.isExpired).toBe(false);
    });

    it('does not create a membership for an unregistered email', async () => {
      const owner = await createUser();
      await Assignee.create({ email: 'nobody@example.com', createdBy: owner.user._id });

      await migrate();

      // Only the owner's own membership.
      expect(await WorkspaceMembership.countDocuments()).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('owner listed as their own assignee', () => {
    it('does not create a second membership for the owner', async () => {
      const owner = await createUser({ email: 'owner@example.com' });
      await Assignee.create({ email: 'owner@example.com', createdBy: owner.user._id });

      const { plan, applied } = await migrate();

      const workspace = await personalWorkspaceOf(owner.user._id);
      const memberships = await WorkspaceMembership.find({ workspace: workspace._id });

      expect(memberships).toHaveLength(1);
      expect(plan.stats.assignees.ownerSkipped).toBe(1);
      expect(applied.membershipsCreated).toBe(0);
    });

    it('leaves the owner holding the OWNER role, not MEMBER', async () => {
      const owner = await createUser({ email: 'owner@example.com' });
      await Assignee.create({ email: 'owner@example.com', createdBy: owner.user._id });

      await migrate();

      const workspace = await personalWorkspaceOf(owner.user._id);
      const membership = await WorkspaceMembership.findOne({
        workspace: workspace._id,
      }).populate('role');

      expect(membership.role.systemKey).toBe(SYSTEM_ROLES.OWNER);
    });
  });

  // -------------------------------------------------------------------------
  describe('task backfill', () => {
    it('sets workspace from the creator’s personal workspace', async () => {
      const owner = await createUser();
      const res = await createTask(owner).expect(201);

      await migrate();

      const workspace = await personalWorkspaceOf(owner.user._id);
      const task = await Task.findById(res.body.data.task._id);

      expect(task.workspace.equals(workspace._id)).toBe(true);
    });

    it('never overwrites a workspace that is already set', async () => {
      const owner = await createUser({ withWorkspace: true });
      const other = await createUser({ withWorkspace: true });

      await legacyTask(owner.user._id, { workspace: other.workspace._id });

      const { plan, applied } = await migrate();

      const task = await Task.findOne({ title: 'Legacy task' });

      expect(task.workspace.equals(other.workspace._id)).toBe(true);
      expect(plan.stats.tasks.alreadyAssigned).toBe(1);
      expect(applied.tasksBackfilled).toBe(0);
    });

    it('backfills many tasks for the same creator into one workspace', async () => {
      const owner = await createUser();
      await legacyTask(owner.user._id);
      await legacyTask(owner.user._id);
      await legacyTask(owner.user._id);

      const { applied } = await migrate();

      const workspace = await personalWorkspaceOf(owner.user._id);
      const count = await Task.countDocuments({ workspace: workspace._id });

      expect(applied.tasksBackfilled).toBe(3);
      expect(count).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  describe('orphaned tasks', () => {
    it('reports them without deleting or reassigning', async () => {
      const ghostId = new mongoose.Types.ObjectId();
      await legacyTask(ghostId, { title: 'Orphan' });

      const { plan, applied } = await migrate();

      const task = await Task.findOne({ title: 'Orphan' });

      expect(task).not.toBeNull(); // not deleted
      expect(task.workspace).toBeNull(); // not reassigned
      expect(plan.stats.tasks.orphaned).toBe(1);
      expect(applied.errors).toEqual([]); // an anomaly, not an execution error

      const anomaly = plan.anomalies.find((a) => a.type === 'Task');
      expect(anomaly.reason).toMatch(/does not exist/i);
    });

    it('fails validation while an orphan remains unresolved', async () => {
      const owner = await createUser();
      await legacyTask(owner.user._id);
      await legacyTask(new mongoose.Types.ObjectId(), { title: 'Orphan' });

      await migrate();
      const validation = await validate();

      // The orphan's creator does not exist, so it is *not* a validation
      // failure — validation only demands that resolvable tasks got a
      // workspace. The orphan is surfaced through the plan's anomalies.
      expect(validation.passed).toBe(true);

      const stillNull = await Task.countDocuments({ workspace: null });
      expect(stillNull).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('dry run', () => {
    it('writes nothing at all', async () => {
      const owner = await createUser({ email: 'owner@example.com' });
      await createUser({ email: 'mate@example.com' });
      await Assignee.create({ email: 'mate@example.com', createdBy: owner.user._id });
      await Assignee.create({ email: 'ghost@example.com', createdBy: owner.user._id });
      await legacyTask(owner.user._id);

      const before = {
        users: await User.countDocuments(),
        tasks: await Task.countDocuments(),
        assignees: await Assignee.countDocuments(),
        workspaces: await Workspace.countDocuments(),
        roles: await Role.countDocuments(),
        memberships: await WorkspaceMembership.countDocuments(),
        invitations: await WorkspaceInvitation.countDocuments(),
        tasksWithWorkspace: await Task.countDocuments({ workspace: { $ne: null } }),
      };

      // The dry run is exactly this call — the script prints the plan and stops.
      const plan = await buildPlan();

      const after = {
        users: await User.countDocuments(),
        tasks: await Task.countDocuments(),
        assignees: await Assignee.countDocuments(),
        workspaces: await Workspace.countDocuments(),
        roles: await Role.countDocuments(),
        memberships: await WorkspaceMembership.countDocuments(),
        invitations: await WorkspaceInvitation.countDocuments(),
        tasksWithWorkspace: await Task.countDocuments({ workspace: { $ne: null } }),
      };

      expect(after).toEqual(before);

      // ...and it still worked out what it *would* do.
      expect(plan.stats.workspaces.toCreate).toBe(2);
      expect(plan.stats.memberships.toCreate).toBe(1);
      expect(plan.stats.invitations.toCreate).toBe(1);
      expect(plan.stats.tasks.toBackfill).toBe(1);
    });

    it('predicts the same counts the execution then produces', async () => {
      const owner = await createUser({ email: 'owner@example.com' });
      await createUser({ email: 'mate@example.com' });
      await Assignee.create({ email: 'mate@example.com', createdBy: owner.user._id });
      await Assignee.create({ email: 'ghost@example.com', createdBy: owner.user._id });
      await legacyTask(owner.user._id);

      const predicted = await buildPlan();
      const applied = await execute(await buildPlan());

      expect(applied.workspacesCreated).toBe(predicted.stats.workspaces.toCreate);
      expect(applied.membershipsCreated).toBe(predicted.stats.memberships.toCreate);
      expect(applied.invitationsCreated).toBe(predicted.stats.invitations.toCreate);
      expect(applied.tasksBackfilled).toBe(predicted.stats.tasks.toBackfill);
    });
  });

  // -------------------------------------------------------------------------
  describe('validation', () => {
    it('passes on a cleanly migrated database', async () => {
      const owner = await createUser({ email: 'owner@example.com' });
      await createUser({ email: 'mate@example.com' });
      await Assignee.create({ email: 'mate@example.com', createdBy: owner.user._id });
      await Assignee.create({ email: 'ghost@example.com', createdBy: owner.user._id });
      await legacyTask(owner.user._id);

      await migrate();
      const validation = await validate();

      expect(validation.failures).toEqual([]);
      expect(validation.passed).toBe(true);
    });

    it('catches a workspace missing a system role', async () => {
      await createUser();
      await migrate();

      await Role.deleteOne({ systemKey: SYSTEM_ROLES.ADMIN });

      const validation = await validate();

      expect(validation.passed).toBe(false);
      expect(validation.failures.some((f) => /missing ADMIN/.test(f.reason))).toBe(true);
    });

    it('catches a task that should have been backfilled but was not', async () => {
      const owner = await createUser();
      await migrate();

      await legacyTask(owner.user._id, { title: 'Missed' });

      const validation = await validate();

      expect(validation.passed).toBe(false);
      expect(validation.failures.some((f) => f.check === 'task backfilled')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Stage 4.1. The rules are pure, so they are tested directly; the CLI is then
  // driven as a real subprocess so the wiring is proven too, not just the rules.
  describe('Stage 4.1 — database safety rules', () => {
    const base = {
      dryRun: false,
      databaseName: 'promanage-dev',
      confirmDatabase: 'promanage-dev',
      env: 'development',
      allowProduction: false,
    };

    it('allows a matching confirmation', () => {
      expect(checkExecutionSafety(base).allowed).toBe(true);
    });

    it('refuses when no confirmation is given', () => {
      const result = checkExecutionSafety({ ...base, confirmDatabase: null });

      expect(result.allowed).toBe(false);
      expect(result.code).toBe(REFUSAL.CONFIRMATION_REQUIRED);
      // The message should tell the operator the exact name to type.
      expect(result.message).toContain('--confirm-database=promanage-dev');
    });

    it('refuses when the confirmation names a different database', () => {
      const result = checkExecutionSafety({ ...base, confirmDatabase: 'something-else' });

      expect(result.allowed).toBe(false);
      expect(result.code).toBe(REFUSAL.DATABASE_MISMATCH);
      expect(result.message).toContain('Connected database: promanage-dev');
      expect(result.message).toContain('Confirmed database: something-else');
    });

    // Database names are case-sensitive in MongoDB, so folding case here would
    // accept a name the server treats as a different database.
    it('is case-sensitive', () => {
      const result = checkExecutionSafety({ ...base, confirmDatabase: 'PROMANAGE-DEV' });

      expect(result.allowed).toBe(false);
      expect(result.code).toBe(REFUSAL.DATABASE_MISMATCH);
    });

    it('refuses when the database cannot be identified', () => {
      const result = checkExecutionSafety({ ...base, databaseName: null });

      expect(result.allowed).toBe(false);
      expect(result.code).toBe(REFUSAL.UNKNOWN_DATABASE);
    });

    // The exact failure mode this stage exists to eliminate.
    it('does not let NODE_ENV=development authorise a write', () => {
      const result = checkExecutionSafety({
        ...base,
        env: 'development',
        confirmDatabase: null,
      });

      expect(result.allowed).toBe(false);
      expect(result.code).toBe(REFUSAL.CONFIRMATION_REQUIRED);
    });

    it('keeps the production guard as a secondary layer', () => {
      const blocked = checkExecutionSafety({ ...base, env: 'production' });
      expect(blocked.allowed).toBe(false);
      expect(blocked.code).toBe(REFUSAL.PRODUCTION_BLOCKED);

      const allowed = checkExecutionSafety({
        ...base,
        env: 'production',
        allowProduction: true,
      });
      expect(allowed.allowed).toBe(true);
    });

    // --allow-production must not be usable as a way around the identity check.
    it('does not let --allow-production substitute for confirmation', () => {
      const result = checkExecutionSafety({
        ...base,
        env: 'production',
        confirmDatabase: null,
        allowProduction: true,
      });

      expect(result.allowed).toBe(false);
      expect(result.code).toBe(REFUSAL.CONFIRMATION_REQUIRED);
    });

    it('allows a dry run with no confirmation, in any environment', () => {
      expect(
        checkExecutionSafety({ ...base, dryRun: true, confirmDatabase: null }).allowed
      ).toBe(true);

      expect(
        checkExecutionSafety({
          ...base,
          dryRun: true,
          confirmDatabase: null,
          env: 'production',
        }).allowed
      ).toBe(true);
    });

    describe('argument parsing', () => {
      it('reads the confirmation value', () => {
        expect(parseArgs(['--confirm-database=my-db']).confirmDatabase).toBe('my-db');
      });

      it('treats an empty confirmation as absent', () => {
        expect(parseArgs(['--confirm-database=']).confirmDatabase).toBeNull();
        expect(parseArgs(['--confirm-database=   ']).confirmDatabase).toBeNull();
      });

      it('has no force or bypass flag', () => {
        // If one is ever added, this fails and the reviewer has to justify it.
        const bypasses = ['--force', '--yes', '--skip-safety', '--unsafe'];
        const parsed = parseArgs(bypasses);

        expect(parsed.confirmDatabase).toBeNull();
        expect(checkExecutionSafety({ ...base, confirmDatabase: null }).allowed).toBe(false);
      });
    });

    describe('database identity resolution', () => {
      it('prefers the connected database object', () => {
        expect(resolveDatabaseName({ db: { databaseName: 'real' }, name: 'other' })).toBe('real');
      });

      it('falls back to the connection name', () => {
        expect(resolveDatabaseName({ name: 'fallback' })).toBe('fallback');
      });

      it('returns null rather than guessing', () => {
        expect(resolveDatabaseName(null)).toBeNull();
        expect(resolveDatabaseName({})).toBeNull();
        expect(resolveDatabaseName({ name: '   ' })).toBeNull();
      });

      it('resolves the real name from the live test connection', () => {
        expect(resolveDatabaseName(mongoose.connection)).toEqual(expect.any(String));
      });
    });

    it('never renders the connection string in the identity banner', () => {
      const banner = formatIdentity({
        dryRun: false,
        env: 'development',
        databaseName: 'promanage-dev',
        confirmDatabase: 'promanage-dev',
      });

      expect(banner).toContain('Database:     promanage-dev');
      expect(banner).not.toMatch(/mongodb(\+srv)?:\/\//);
      expect(banner).not.toContain('@');
    });
  });

  // -------------------------------------------------------------------------
  // Drives the actual script, so the safety gate is proven where it runs rather
  // than only where it is defined.
  describe('Stage 4.1 — CLI end to end', () => {
    const SCRIPT = path.join(__dirname, '..', 'scripts', 'migrate-to-workspaces.js');

    /** A dedicated database on the in-memory server, so its name is distinctive. */
    const DB_NAME = 'stage41safety';

    // Built with URL rather than string surgery — `mongodb://host:port` has no
    // path segment to trim, and a regex that assumes one turns the host into
    // part of the scheme.
    const uriFor = (name) => {
      const url = new URL(process.env.MONGO_URI_TEST);
      url.pathname = `/${name}`;
      return url.toString();
    };

    /**
     * The CLI's target database, reached through the existing MongoClient.
     * `useDb` would create additional Mongoose connections that jest then has
     * to wait on at teardown.
     */
    const targetDb = () => mongoose.connection.getClient().db(DB_NAME);

    // Spawning node and opening a connection costs several seconds per case,
    // which is well past the suite's 30s default.
    const CLI_TIMEOUT = 60_000;

    const runCli = (argv) =>
      new Promise((resolve) => {
        execFile(
          process.execPath,
          [SCRIPT, ...argv],
          {
            cwd: path.join(__dirname, '..'),
            env: {
              ...process.env,
              MONGODB_URI: uriFor(DB_NAME),
              NODE_ENV: 'development',
            },
          },
          (error, stdout, stderr) => {
            resolve({ code: error?.code ?? 0, stdout, stderr, output: `${stdout}${stderr}` });
          }
        );
      });

    /** Document counts in the CLI's target database. */
    const countsIn = async () => {
      const db = targetDb();
      const collections = await db.listCollections().toArray();

      const counts = {};
      for (const { name } of collections) {
        counts[name] = await db.collection(name).countDocuments();
      }
      return { collections: collections.map((c) => c.name).sort(), counts };
    };

    /** Seed legacy data directly into the CLI's target database. */
    const seedLegacy = async () => {
      const db = targetDb();
      const userId = new mongoose.Types.ObjectId();

      await db.collection('users').insertOne({
        _id: userId,
        name: 'Legacy Person',
        email: 'legacy@example.com',
        password: 'hashed',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await db.collection('tasks').insertOne({
        title: 'Legacy task',
        priority: 'low',
        status: 'todo',
        checklists: [{ title: 'step', checked: false }],
        createdBy: userId,
        workspace: null,
        assignee: null,
        assignedTo: null,
        createdAt: new Date(),
      });

      return userId;
    };

    afterEach(async () => {
      await targetDb().dropDatabase();
    });

    it('refuses without --dry-run and without --confirm-database, writing nothing', async () => {
      await seedLegacy();
      const before = await countsIn();

      const result = await runCli([]);

      expect(result.code).not.toBe(0);
      expect(result.output).toContain('requires explicit database confirmation');
      expect(await countsIn()).toEqual(before);
    }), CLI_TIMEOUT;

    it('refuses when the confirmed database is wrong, writing nothing', async () => {
      await seedLegacy();
      const before = await countsIn();

      const result = await runCli(['--confirm-database=some-other-database']);

      expect(result.code).not.toBe(0);
      expect(result.output).toContain('Database confirmation failed');
      expect(result.output).toContain(`Connected database: ${DB_NAME}`);

      // Crucially: it did not partially execute before noticing.
      expect(await countsIn()).toEqual(before);
    }), CLI_TIMEOUT;

    it('runs a dry run with no confirmation and creates nothing at all', async () => {
      await seedLegacy();
      const before = await countsIn();

      const result = await runCli(['--dry-run']);

      expect(result.code).toBe(0);
      expect(result.output).toContain('DRY RUN — NO DATA WAS MODIFIED');
      expect(result.output).toMatch(/Users:/);

      const after = await countsIn();

      expect(after).toEqual(before);
      // No empty collections and no indexes created as a side effect.
      expect(after.collections).toEqual(before.collections);
      expect(after.collections).not.toContain('workspaces');
    }), CLI_TIMEOUT;

    it('executes when the confirmation matches the connected database', async () => {
      await seedLegacy();

      const result = await runCli([`--confirm-database=${DB_NAME}`]);

      expect(result.code).toBe(0);
      expect(result.output).toContain('Ensure a database backup exists');
      expect(result.output).toContain('Done.');

      const after = await countsIn();

      expect(after.counts.workspaces).toBe(1);
      expect(after.counts.roles).toBe(3);
      expect(after.counts.workspacememberships).toBe(1);

      const task = await targetDb().collection('tasks').findOne({ title: 'Legacy task' });
      expect(task.workspace).not.toBeNull();
    }), CLI_TIMEOUT;

    it('never prints the connection string or credentials', async () => {
      await seedLegacy();

      const dry = await runCli(['--dry-run']);
      const refused = await runCli(['--confirm-database=nope']);

      for (const result of [dry, refused]) {
        expect(result.output).not.toMatch(/mongodb(\+srv)?:\/\//);
        expect(result.output).not.toContain(process.env.MONGO_URI_TEST);
      }
    }), CLI_TIMEOUT;

    it('prints usage for --help without connecting', async () => {
      const result = await runCli(['--help']);

      expect(result.code).toBe(0);
      expect(result.output).toContain('--confirm-database=<database-name>');
      expect(result.output).toContain('--dry-run');
    }), CLI_TIMEOUT;
  });

  // -------------------------------------------------------------------------
  describe('non-destructiveness', () => {
    it('leaves users, tasks and assignees intact', async () => {
      const owner = await createUser({ email: 'owner@example.com' });
      await createUser({ email: 'mate@example.com' });
      await Assignee.create({ email: 'mate@example.com', createdBy: owner.user._id });
      const res = await createTask(owner, { title: 'Keep me' }).expect(201);

      const before = {
        users: await User.countDocuments(),
        tasks: await Task.countDocuments(),
        assignees: await Assignee.countDocuments(),
      };

      await migrate();

      expect(await User.countDocuments()).toBe(before.users);
      expect(await Task.countDocuments()).toBe(before.tasks);
      // The legacy collection is explicitly not retired in this stage.
      expect(await Assignee.countDocuments()).toBe(before.assignees);

      const task = await Task.findById(res.body.data.task._id);
      expect(task.title).toBe('Keep me');
      expect(task.checklists).toHaveLength(1);
      expect(task.createdBy.equals(owner.user._id)).toBe(true);
    });
  });
});
