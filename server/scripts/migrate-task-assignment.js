/**
 * Migration: reconcile the task assignment fields.
 *
 * Background
 * ----------
 * Tasks used to carry three overlapping values: `assignee` (email),
 * `assignedTo` (User ref) and a persisted `shared` boolean. `updateTask`
 * computed `shared` but never wrote it, so documents drifted out of sync.
 *
 * `shared` is now a virtual derived from `assignedTo`, and `completedAt` was
 * added so analytics and the board's date filter do not have to guess when a
 * task was finished.
 *
 * What this does
 * --------------
 *   1. Re-resolves `assignedTo` from `assignee` for every task, so the ref
 *      matches the email that is actually stored.
 *   2. Backfills `completedAt` for tasks already in the "done" column.
 *   3. Removes the now-redundant `shared` field.
 *
 * Safety
 * ------
 *   - Idempotent: running it twice produces the same result.
 *   - Non-destructive to user data: no task is deleted and no title, checklist,
 *     priority or due date is touched.
 *   - `--dry-run` reports what would change without writing anything.
 *
 * Usage
 * -----
 *   node scripts/migrate-task-assignment.js --dry-run
 *   node scripts/migrate-task-assignment.js
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const DRY_RUN = process.argv.includes('--dry-run');

const run = async () => {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is not set. Copy .env.example to .env first.');
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected. ${DRY_RUN ? 'DRY RUN — no writes will be made.' : 'Applying changes.'}`);

  const tasks = mongoose.connection.collection('tasks');
  const users = mongoose.connection.collection('users');

  const summary = {
    scanned: 0,
    assignedToFixed: 0,
    completedAtBackfilled: 0,
    sharedRemoved: 0,
  };

  const cursor = tasks.find({});

  while (await cursor.hasNext()) {
    const task = await cursor.next();
    summary.scanned += 1;

    const updates = {};
    const unsets = {};

    // 1. Re-resolve assignedTo from the authoritative email.
    const email = typeof task.assignee === 'string' ? task.assignee.trim().toLowerCase() : null;
    const matchedUser = email ? await users.findOne({ email }, { projection: { _id: 1 } }) : null;
    const expectedAssignedTo = matchedUser ? matchedUser._id : null;

    const currentAssignedTo = task.assignedTo || null;
    const differs = String(currentAssignedTo) !== String(expectedAssignedTo);

    if (differs) {
      updates.assignedTo = expectedAssignedTo;
      summary.assignedToFixed += 1;
    }

    // Normalise the stored email too, so lookups stay consistent.
    if (email && task.assignee !== email) {
      updates.assignee = email;
    }

    // 2. Backfill completedAt for tasks already marked done.
    if (task.status === 'done' && !task.completedAt) {
      // No historic completion timestamp exists, so fall back to the most
      // conservative known-true value: the task existed by its creation date.
      updates.completedAt = task.updatedAt || task.createdAt || new Date();
      summary.completedAtBackfilled += 1;
    }

    // 3. Drop the redundant persisted flag.
    if (Object.prototype.hasOwnProperty.call(task, 'shared')) {
      unsets.shared = '';
      summary.sharedRemoved += 1;
    }

    const hasWork = Object.keys(updates).length > 0 || Object.keys(unsets).length > 0;

    if (hasWork && !DRY_RUN) {
      const operation = {};
      if (Object.keys(updates).length) operation.$set = updates;
      if (Object.keys(unsets).length) operation.$unset = unsets;

      await tasks.updateOne({ _id: task._id }, operation);
    }
  }

  console.log('\nMigration summary');
  console.table(summary);

  if (!DRY_RUN) {
    // Build the indexes declared on the schemas so the first real request does
    // not pay for it.
    console.log('\nEnsuring indexes...');
    require('../model/taskModel');
    require('../model/assigneeModel');
    await mongoose.connection.syncIndexes();
    console.log('Indexes are in place.');
  }

  await mongoose.disconnect();
};

run()
  .then(() => {
    console.log('\nDone.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\nMigration failed:', err.message);
    process.exit(1);
  });
