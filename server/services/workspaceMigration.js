/**
 * Stage 4 — workspace migration.
 *
 * Moves the legacy single-user data into the workspace architecture:
 *
 *   every User            → a personal Workspace + OWNER/ADMIN/MEMBER roles
 *                           + an owner membership
 *   Assignee (registered) → a MEMBER membership in the creator's workspace
 *   Assignee (unknown)    → a pending WorkspaceInvitation
 *   Task.workspace: null  → the creator's personal workspace
 *
 * Structure
 * ---------
 * `buildPlan()` reads and resolves everything without writing. `execute()`
 * applies a plan. `validate()` checks integrity afterwards. Splitting them is
 * what makes `--dry-run` trustworthy: the dry run executes the *same* planning
 * code the real run does, rather than returning early from a half-built path.
 *
 * Safety
 * ------
 *   - Additive only. Nothing is deleted, and no existing field is overwritten.
 *   - Idempotent. Re-running reuses what exists and reports zero creations.
 *   - Resumable. Because every step resolves-then-creates, a run interrupted
 *     halfway is repaired by the next one.
 *
 * Transactions are deliberately not used. They require a replica set, which
 * `mongodb-memory-server` does not provide by default, so a transactional
 * migration could not be tested — and an untested transaction is worse than
 * idempotent upserts. Per-user granularity means a crash leaves at most one
 * user partially provisioned, which the next run reconciles.
 */

const User = require('../model/userModel');
const Task = require('../model/taskModel');
const Assignee = require('../model/assigneeModel');
const Workspace = require('../model/workspaceModel');
const Role = require('../model/roleModel');
const WorkspaceMembership = require('../model/workspaceMembershipModel');
const WorkspaceInvitation = require('../model/workspaceInvitationModel');
const { SYSTEM_ROLES } = require('../model/roleModel');
const {
  personalWorkspaceName,
  ensurePersonalWorkspace,
  ensureSystemRoles,
  ensureMembership,
} = require('./workspaceProvisioning');

const id = (value) => String(value);

const emptyStats = () => ({
  users: { inspected: 0, eligible: 0, skipped: 0 },
  workspaces: { toCreate: 0, reused: 0 },
  roles: { toCreate: 0, reused: 0 },
  ownerMemberships: { toCreate: 0, reused: 0 },
  assignees: {
    inspected: 0,
    registered: 0,
    unregistered: 0,
    collapsed: 0,
    ownerSkipped: 0,
  },
  memberships: { toCreate: 0, reused: 0 },
  invitations: { toCreate: 0, reused: 0 },
  tasks: { inspected: 0, toBackfill: 0, alreadyAssigned: 0, orphaned: 0 },
});

/**
 * Readiness checks that have to pass before a migration is worth attempting.
 *
 * Separate from `buildPlan` because these are about the *shape* of the
 * database rather than the data in it: are the indexes the earlier stages
 * designed actually present, and does every already-provisioned workspace
 * still have its three system roles?
 *
 * Reads only. Returns findings rather than throwing, so a preflight can report
 * everything wrong at once instead of the first thing.
 */
const preflight = async () => {
  const findings = [];

  // Indexes the previous stages designed. A missing one is not fatal — Mongo
  // will still accept the writes — but it means a uniqueness guarantee the
  // migration relies on is absent, which is worth knowing before starting.
  const REQUIRED_INDEXES = [
    { model: Workspace, name: 'workspaces', keys: ['owner_1_isPersonal_1'] },
    { model: Role, name: 'roles', keys: ['workspace_1_name_1', 'workspace_1_systemKey_1'] },
    {
      model: WorkspaceMembership,
      name: 'workspacememberships',
      keys: ['workspace_1_user_1', 'workspace_1_role_1'],
    },
    { model: WorkspaceInvitation, name: 'workspaceinvitations', keys: ['workspace_1_email_1'] },
  ];

  const indexes = {};

  for (const entry of REQUIRED_INDEXES) {
    let present = [];

    try {
      const existing = await entry.model.collection.indexes();
      present = existing.map((index) => index.name);
    } catch {
      // The collection does not exist yet — expected on a first migration,
      // since indexes are built after a successful run.
      present = [];
    }

    const missing = entry.keys.filter((key) => !present.includes(key));
    indexes[entry.name] = { present: present.length, missing };

    if (missing.length) {
      findings.push({
        type: 'Index',
        id: entry.name,
        operation: 'preflight',
        reason: `missing ${missing.join(', ')} (built after a successful run)`,
      });
    }
  }

  // Every workspace that already exists must still have all three system
  // roles, resolved by systemKey and never by display name.
  const workspaces = await Workspace.find().select('_id name').lean();
  const roles = await Role.find({ isSystemRole: true }).select('workspace systemKey').lean();

  const byWorkspace = new Map();
  for (const role of roles) {
    const key = id(role.workspace);
    if (!byWorkspace.has(key)) byWorkspace.set(key, new Set());
    byWorkspace.get(key).add(role.systemKey);
  }

  let workspacesMissingRoles = 0;

  for (const workspace of workspaces) {
    const present = byWorkspace.get(id(workspace._id)) ?? new Set();
    const missing = Object.values(SYSTEM_ROLES).filter((key) => !present.has(key));

    if (missing.length) {
      workspacesMissingRoles += 1;
      findings.push({
        type: 'Workspace',
        id: id(workspace._id),
        operation: 'preflight',
        reason: `missing system role(s): ${missing.join(', ')}`,
      });
    }
  }

  return {
    ready: findings.filter((f) => f.type !== 'Index').length === 0,
    indexes,
    workspacesInspected: workspaces.length,
    workspacesMissingRoles,
    findings,
  };
};

/**
 * Read the database and work out everything that would change.
 *
 * Writes nothing. Returns a plan keyed by *user id* rather than workspace id,
 * because in a dry run the workspaces do not exist yet and have no ids.
 */
const buildPlan = async () => {
  const stats = emptyStats();
  const anomalies = [];

  // --- Users --------------------------------------------------------------
  // Every user gets a personal workspace, not only those who own data. A user
  // with no workspace would have no board to land on after the migration, and
  // the product model says everyone has a personal space.
  const users = await User.find().select('_id name email').lean();
  stats.users.inspected = users.length;
  stats.users.eligible = users.length;

  const usersById = new Map(users.map((user) => [id(user._id), user]));

  const existingWorkspaces = await Workspace.find({ isPersonal: true })
    .select('_id owner')
    .lean();
  const personalWorkspaceByOwner = new Map(
    existingWorkspaces.map((workspace) => [id(workspace.owner), workspace])
  );

  const workspacePlan = [];

  for (const user of users) {
    const existing = personalWorkspaceByOwner.get(id(user._id));

    if (existing) {
      stats.workspaces.reused += 1;
    } else {
      stats.workspaces.toCreate += 1;
    }

    workspacePlan.push({
      userId: id(user._id),
      name: personalWorkspaceName(user),
      existingWorkspaceId: existing ? id(existing._id) : null,
    });
  }

  // --- Roles and owner memberships ----------------------------------------
  // Only workspaces that already exist can be inspected; anything still to be
  // created needs all three roles and one owner membership.
  const existingIds = existingWorkspaces.map((workspace) => workspace._id);

  const existingRoles = existingIds.length
    ? await Role.find({ workspace: { $in: existingIds }, isSystemRole: true })
        .select('workspace systemKey')
        .lean()
    : [];

  const rolesByWorkspace = new Map();
  for (const role of existingRoles) {
    const key = id(role.workspace);
    if (!rolesByWorkspace.has(key)) rolesByWorkspace.set(key, new Set());
    rolesByWorkspace.get(key).add(role.systemKey);
  }

  const existingOwnerMemberships = existingIds.length
    ? await WorkspaceMembership.find({ workspace: { $in: existingIds } })
        .select('workspace user')
        .lean()
    : [];

  const ownerMembershipKeys = new Set(
    existingOwnerMemberships.map((m) => `${id(m.workspace)}:${id(m.user)}`)
  );

  for (const entry of workspacePlan) {
    if (!entry.existingWorkspaceId) {
      stats.roles.toCreate += 3;
      stats.ownerMemberships.toCreate += 1;
      continue;
    }

    const present = rolesByWorkspace.get(entry.existingWorkspaceId) ?? new Set();
    for (const systemKey of Object.values(SYSTEM_ROLES)) {
      if (present.has(systemKey)) stats.roles.reused += 1;
      else stats.roles.toCreate += 1;
    }

    const key = `${entry.existingWorkspaceId}:${entry.userId}`;
    if (ownerMembershipKeys.has(key)) stats.ownerMemberships.reused += 1;
    else stats.ownerMemberships.toCreate += 1;
  }

  // --- Assignees ----------------------------------------------------------
  const assignees = await Assignee.find().select('_id email createdBy').lean();
  stats.assignees.inspected = assignees.length;

  // Emails are already normalised by the Assignee schema, but the migration
  // normalises again rather than trusting historic rows written before that
  // setter existed.
  const normalise = (email) => String(email ?? '').trim().toLowerCase();

  const emails = [...new Set(assignees.map((a) => normalise(a.email)))];
  const registeredUsers = emails.length
    ? await User.find({ email: { $in: emails } }).select('_id email').lean()
    : [];
  const userByEmail = new Map(registeredUsers.map((u) => [normalise(u.email), u]));

  const existingMemberships = await WorkspaceMembership.find()
    .select('workspace user')
    .lean();
  const membershipKeys = new Set(
    existingMemberships.map((m) => `${id(m.workspace)}:${id(m.user)}`)
  );

  const existingInvitations = await WorkspaceInvitation.find({ status: 'pending' })
    .select('workspace email')
    .lean();
  const invitationKeys = new Set(
    existingInvitations.map((i) => `${id(i.workspace)}:${normalise(i.email)}`)
  );

  const membershipPlan = [];
  const invitationPlan = [];

  // Within one run, several legacy rows can resolve to the same membership —
  // the old index allowed one row per (createdBy, email) but casing differed.
  const plannedMemberships = new Set();
  const plannedInvitations = new Set();

  for (const assignee of assignees) {
    const ownerId = id(assignee.createdBy);
    const email = normalise(assignee.email);
    const creator = usersById.get(ownerId);

    if (!creator) {
      // The board this assignee belonged to has no owner any more.
      anomalies.push({
        type: 'Assignee',
        id: id(assignee._id),
        operation: 'resolve creator',
        reason: 'createdBy user does not exist',
      });
      continue;
    }

    const registered = userByEmail.get(email);

    if (registered) {
      stats.assignees.registered += 1;

      // The owner is already a member of their own workspace with the OWNER
      // role — do not add a second, lesser membership.
      if (id(registered._id) === ownerId) {
        stats.assignees.ownerSkipped += 1;
        continue;
      }

      const planKey = `${ownerId}:${id(registered._id)}`;

      if (plannedMemberships.has(planKey)) {
        stats.assignees.collapsed += 1;
        continue;
      }
      plannedMemberships.add(planKey);

      const workspaceId = personalWorkspaceByOwner.get(ownerId)?._id;
      const liveKey = workspaceId ? `${id(workspaceId)}:${id(registered._id)}` : null;

      if (liveKey && membershipKeys.has(liveKey)) {
        stats.memberships.reused += 1;
      } else {
        stats.memberships.toCreate += 1;
        membershipPlan.push({
          ownerUserId: ownerId,
          userId: id(registered._id),
          email,
        });
      }
    } else {
      stats.assignees.unregistered += 1;

      const planKey = `${ownerId}:${email}`;

      if (plannedInvitations.has(planKey)) {
        stats.assignees.collapsed += 1;
        continue;
      }
      plannedInvitations.add(planKey);

      const workspaceId = personalWorkspaceByOwner.get(ownerId)?._id;
      const liveKey = workspaceId ? `${id(workspaceId)}:${email}` : null;

      if (liveKey && invitationKeys.has(liveKey)) {
        stats.invitations.reused += 1;
      } else {
        stats.invitations.toCreate += 1;
        invitationPlan.push({ ownerUserId: ownerId, email });
      }
    }
  }

  // --- Tasks --------------------------------------------------------------
  const tasks = await Task.find().select('_id createdBy workspace').lean();
  stats.tasks.inspected = tasks.length;

  const taskPlan = [];

  for (const task of tasks) {
    if (task.workspace) {
      stats.tasks.alreadyAssigned += 1;
      continue;
    }

    const ownerId = id(task.createdBy);

    if (!usersById.has(ownerId)) {
      // Deliberately not deleted, not reassigned, not invented. Recorded and
      // counted so a human can decide.
      stats.tasks.orphaned += 1;
      anomalies.push({
        type: 'Task',
        id: id(task._id),
        operation: 'workspace backfill',
        reason: `createdBy user ${ownerId} does not exist`,
      });
      continue;
    }

    stats.tasks.toBackfill += 1;
    taskPlan.push({ taskId: id(task._id), ownerUserId: ownerId });
  }

  return { stats, anomalies, workspacePlan, membershipPlan, invitationPlan, taskPlan };
};

/**
 * Apply a plan.
 *
 * Ordered so a target always exists before something points at it: workspaces
 * and roles first, then memberships and invitations, then tasks.
 */
const execute = async (plan) => {
  const applied = {
    workspacesCreated: 0,
    rolesCreated: 0,
    ownerMembershipsCreated: 0,
    membershipsCreated: 0,
    invitationsCreated: 0,
    tasksBackfilled: 0,
    errors: [],
  };

  /** userId → { workspace, roles } for everything provisioned in this run. */
  const provisioned = new Map();

  // --- 1. Workspaces, roles, owner memberships ----------------------------
  for (const entry of plan.workspacePlan) {
    try {
      const user = await User.findById(entry.userId).select('_id name email');
      if (!user) {
        applied.errors.push({
          type: 'User',
          id: entry.userId,
          operation: 'provision personal workspace',
          reason: 'user disappeared between planning and execution',
        });
        continue;
      }

      const { workspace, created } = await ensurePersonalWorkspace(user);
      if (created) applied.workspacesCreated += 1;

      const { roles, created: rolesCreated } = await ensureSystemRoles(workspace._id);
      applied.rolesCreated += rolesCreated;

      const { created: membershipCreated } = await ensureMembership({
        workspace,
        user: user._id,
        role: roles.owner,
      });
      if (membershipCreated) applied.ownerMembershipsCreated += 1;

      provisioned.set(entry.userId, { workspace, roles });
    } catch (error) {
      applied.errors.push({
        type: 'User',
        id: entry.userId,
        operation: 'provision personal workspace',
        reason: error.message,
      });
    }
  }

  /** Resolve a workspace + roles for an owner, falling back to a live read. */
  const resolve = async (ownerUserId) => {
    if (provisioned.has(ownerUserId)) return provisioned.get(ownerUserId);

    const workspace = await Workspace.findOne({ owner: ownerUserId, isPersonal: true });
    if (!workspace) return null;

    const { roles } = await ensureSystemRoles(workspace._id);
    const entry = { workspace, roles };
    provisioned.set(ownerUserId, entry);
    return entry;
  };

  // --- 2. Registered assignees → memberships ------------------------------
  for (const entry of plan.membershipPlan) {
    try {
      const target = await resolve(entry.ownerUserId);
      if (!target) {
        applied.errors.push({
          type: 'Assignee',
          id: `${entry.ownerUserId}:${entry.email}`,
          operation: 'create membership',
          reason: 'owner has no personal workspace',
        });
        continue;
      }

      const { created } = await ensureMembership({
        workspace: target.workspace,
        user: entry.userId,
        role: target.roles.member,
        invitedBy: entry.ownerUserId,
      });

      if (created) applied.membershipsCreated += 1;
    } catch (error) {
      applied.errors.push({
        type: 'Assignee',
        id: `${entry.ownerUserId}:${entry.email}`,
        operation: 'create membership',
        reason: error.message,
      });
    }
  }

  // --- 3. Unregistered assignees → invitations ----------------------------
  for (const entry of plan.invitationPlan) {
    try {
      const target = await resolve(entry.ownerUserId);
      if (!target) {
        applied.errors.push({
          type: 'Assignee',
          id: `${entry.ownerUserId}:${entry.email}`,
          operation: 'create invitation',
          reason: 'owner has no personal workspace',
        });
        continue;
      }

      const existing = await WorkspaceInvitation.findOne({
        workspace: target.workspace._id,
        email: entry.email,
        status: 'pending',
      });

      if (existing) continue;

      // No token and no expiry.
      //
      // These are historical board members, not people who were sent a link.
      // Minting a token would fabricate an invitation that was never issued,
      // and `tokenHash` is nullable precisely so a migrated record can be
      // honest about that. The invite flow will mint a real token when someone
      // actually re-sends it.
      await WorkspaceInvitation.create({
        workspace: target.workspace._id,
        email: entry.email,
        role: target.roles.member._id,
        invitedBy: entry.ownerUserId,
        status: 'pending',
        tokenHash: null,
        expiresAt: null,
      });

      applied.invitationsCreated += 1;
    } catch (error) {
      applied.errors.push({
        type: 'Assignee',
        id: `${entry.ownerUserId}:${entry.email}`,
        operation: 'create invitation',
        reason: error.message,
      });
    }
  }

  // --- 4. Task backfill ---------------------------------------------------
  for (const entry of plan.taskPlan) {
    try {
      const target = await resolve(entry.ownerUserId);
      if (!target) {
        applied.errors.push({
          type: 'Task',
          id: entry.taskId,
          operation: 'workspace backfill',
          reason: 'creator has no personal workspace',
        });
        continue;
      }

      // `workspace: null` in the filter is what makes this non-destructive: a
      // task that already has a workspace is never touched, even if the plan
      // is stale.
      const result = await Task.updateOne(
        { _id: entry.taskId, workspace: null },
        { $set: { workspace: target.workspace._id } }
      );

      if (result.modifiedCount > 0) applied.tasksBackfilled += 1;
    } catch (error) {
      applied.errors.push({
        type: 'Task',
        id: entry.taskId,
        operation: 'workspace backfill',
        reason: error.message,
      });
    }
  }

  return applied;
};

/**
 * Post-migration integrity checks.
 *
 * Reads only. Returns a list of failures rather than throwing, so the caller
 * can print all of them instead of only the first.
 */
const validate = async () => {
  const failures = [];

  const workspaces = await Workspace.find({ isPersonal: true }).lean();
  const userIds = await User.find().distinct('_id');
  const knownUsers = new Set(userIds.map(id));

  for (const workspace of workspaces) {
    if (!knownUsers.has(id(workspace.owner))) {
      failures.push({
        check: 'workspace.owner exists',
        workspace: id(workspace._id),
        reason: `owner ${id(workspace.owner)} is not a user`,
      });
    }

    const roles = await Role.find({ workspace: workspace._id, isSystemRole: true }).lean();
    const keys = new Set(roles.map((role) => role.systemKey));

    for (const systemKey of Object.values(SYSTEM_ROLES)) {
      if (!keys.has(systemKey)) {
        failures.push({
          check: 'system roles present',
          workspace: id(workspace._id),
          reason: `missing ${systemKey} role`,
        });
      }
    }

    const ownerRole = roles.find((role) => role.systemKey === SYSTEM_ROLES.OWNER);

    if (ownerRole) {
      const ownerMemberships = await WorkspaceMembership.find({
        workspace: workspace._id,
        role: ownerRole._id,
      }).lean();

      if (ownerMemberships.length !== 1) {
        failures.push({
          check: 'exactly one owner membership',
          workspace: id(workspace._id),
          reason: `found ${ownerMemberships.length}`,
        });
      } else if (id(ownerMemberships[0].user) !== id(workspace.owner)) {
        failures.push({
          check: 'owner membership matches workspace.owner',
          workspace: id(workspace._id),
          reason: 'membership user differs from workspace owner',
        });
      } else if (ownerMemberships[0].status !== 'active') {
        failures.push({
          check: 'owner membership is active',
          workspace: id(workspace._id),
          reason: `status is ${ownerMemberships[0].status}`,
        });
      }
    }
  }

  // Cross-workspace integrity: a membership or invitation must never point at
  // a role from a different workspace. Document middleware enforces this on
  // save, but a raw update would bypass it, so it is re-checked here.
  const memberships = await WorkspaceMembership.find().populate('role', 'workspace').lean();
  for (const membership of memberships) {
    if (!membership.role) {
      failures.push({
        check: 'membership role exists',
        membership: id(membership._id),
        reason: 'role reference is dangling',
      });
    } else if (id(membership.role.workspace) !== id(membership.workspace)) {
      failures.push({
        check: 'membership.workspace === role.workspace',
        membership: id(membership._id),
        reason: 'role belongs to another workspace',
      });
    }
  }

  const invitations = await WorkspaceInvitation.find().populate('role', 'workspace').lean();
  for (const invitation of invitations) {
    if (!invitation.role) {
      failures.push({
        check: 'invitation role exists',
        invitation: id(invitation._id),
        reason: 'role reference is dangling',
      });
    } else if (id(invitation.role.workspace) !== id(invitation.workspace)) {
      failures.push({
        check: 'invitation.workspace === role.workspace',
        invitation: id(invitation._id),
        reason: 'role belongs to another workspace',
      });
    }
  }

  // Every task with a resolvable creator should now have a workspace.
  const unresolved = await Task.find({ workspace: null }).select('_id createdBy').lean();
  for (const task of unresolved) {
    if (knownUsers.has(id(task.createdBy))) {
      failures.push({
        check: 'task backfilled',
        task: id(task._id),
        reason: 'creator exists but workspace is still null',
      });
    }
  }

  // --- Referential integrity ----------------------------------------------
  // The checks above prove that *related* references agree with each other.
  // These prove the references resolve at all: MongoDB has no foreign keys, so
  // a document can point at a workspace that was never created or has since
  // been removed, and every consistency check above would still pass.
  const allWorkspaceIds = new Set(
    (await Workspace.find().select('_id').lean()).map((w) => id(w._id))
  );
  const allRoleIds = new Set((await Role.find().select('_id').lean()).map((r) => id(r._id)));

  const danglingWorkspace = (label, docs, field = 'workspace') => {
    for (const doc of docs) {
      const target = doc[field];
      if (!target) continue;

      if (!allWorkspaceIds.has(id(target))) {
        failures.push({
          check: `${label}.${field} references an existing workspace`,
          [label]: id(doc._id),
          reason: `workspace ${id(target)} does not exist`,
        });
      }
    }
  };

  danglingWorkspace('task', await Task.find({ workspace: { $ne: null } }).select('_id workspace').lean());
  danglingWorkspace('membership', await WorkspaceMembership.find().select('_id workspace').lean());
  danglingWorkspace('invitation', await WorkspaceInvitation.find().select('_id workspace').lean());
  danglingWorkspace('role', await Role.find().select('_id workspace').lean());

  // Role references, from both directions.
  for (const membership of await WorkspaceMembership.find().select('_id role').lean()) {
    if (membership.role && !allRoleIds.has(id(membership.role))) {
      failures.push({
        check: 'membership.role references an existing role',
        membership: id(membership._id),
        reason: `role ${id(membership.role)} does not exist`,
      });
    }
  }

  for (const invitation of await WorkspaceInvitation.find().select('_id role').lean()) {
    if (invitation.role && !allRoleIds.has(id(invitation.role))) {
      failures.push({
        check: 'invitation.role references an existing role',
        invitation: id(invitation._id),
        reason: `role ${id(invitation.role)} does not exist`,
      });
    }
  }

  // At most one personal workspace per owner. The partial unique index makes
  // this impossible, which is exactly why it is worth asserting — an index
  // that silently failed to build would show up here.
  const personalByOwner = new Map();
  for (const workspace of workspaces) {
    const owner = id(workspace.owner);
    personalByOwner.set(owner, (personalByOwner.get(owner) ?? 0) + 1);
  }

  for (const [owner, count] of personalByOwner) {
    if (count > 1) {
      failures.push({
        check: 'one personal workspace per owner',
        owner,
        reason: `found ${count}`,
      });
    }
  }

  return { passed: failures.length === 0, failures };
};

/** Render the report. Never prints token material. */
const formatReport = ({ mode, plan, applied, validation }) => {
  const { stats, anomalies } = plan;
  const lines = [];
  const row = (label, value) => lines.push(`  ${String(label).padEnd(34)}${value}`);

  lines.push('=== Workspace Migration ===');
  lines.push('');
  lines.push(`Mode: ${mode}`);
  lines.push('');

  lines.push('Users:');
  row('inspected', stats.users.inspected);
  row('eligible', stats.users.eligible);
  row('skipped', stats.users.skipped);
  lines.push('');

  lines.push('Workspaces:');
  row(applied ? 'created' : 'to create', applied ? applied.workspacesCreated : stats.workspaces.toCreate);
  row('reused', stats.workspaces.reused);
  lines.push('');

  lines.push('Roles:');
  row(applied ? 'created' : 'to create', applied ? applied.rolesCreated : stats.roles.toCreate);
  row('reused', stats.roles.reused);
  lines.push('');

  lines.push('Owner memberships:');
  row(
    applied ? 'created' : 'to create',
    applied ? applied.ownerMembershipsCreated : stats.ownerMemberships.toCreate
  );
  row('reused', stats.ownerMemberships.reused);
  lines.push('');

  lines.push('Assignees:');
  row('inspected', stats.assignees.inspected);
  row('registered', stats.assignees.registered);
  row('unregistered', stats.assignees.unregistered);
  row('duplicates collapsed', stats.assignees.collapsed);
  row('owner already member', stats.assignees.ownerSkipped);
  lines.push('');

  lines.push('Memberships:');
  row(applied ? 'created' : 'to create', applied ? applied.membershipsCreated : stats.memberships.toCreate);
  row('reused', stats.memberships.reused);
  lines.push('');

  lines.push('Invitations:');
  row(applied ? 'created' : 'to create', applied ? applied.invitationsCreated : stats.invitations.toCreate);
  row('reused', stats.invitations.reused);
  lines.push('');

  lines.push('Tasks:');
  row('inspected', stats.tasks.inspected);
  row(applied ? 'backfilled' : 'to backfill', applied ? applied.tasksBackfilled : stats.tasks.toBackfill);
  row('already assigned', stats.tasks.alreadyAssigned);
  row('orphaned / unresolved', stats.tasks.orphaned);
  lines.push('');

  if (validation) {
    lines.push('Validation:');
    row('result', validation.passed ? 'PASSED' : 'FAILED');
    row('failures', validation.failures.length);
    validation.failures.slice(0, 20).forEach((failure) => {
      lines.push(`    - ${failure.check}: ${failure.reason}`);
    });
    lines.push('');
  }

  const errors = applied?.errors ?? [];
  lines.push('Errors:');
  row('count', errors.length + anomalies.length);

  [...anomalies, ...errors].slice(0, 30).forEach((item) => {
    lines.push(`    - ${item.type} ${item.id}`);
    lines.push(`      operation: ${item.operation}`);
    lines.push(`      reason:    ${item.reason}`);
  });

  lines.push('');

  if (mode === 'DRY RUN') {
    lines.push('DRY RUN — NO DATA WAS MODIFIED');
  }

  return lines.join('\n');
};

module.exports = { preflight, buildPlan, execute, validate, formatReport, emptyStats };
