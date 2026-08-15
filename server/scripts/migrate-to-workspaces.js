/**
 * Migration: move legacy single-user data into the workspace architecture.
 *
 * What this does
 * --------------
 *   1. Gives every existing user a personal Workspace, owned by them.
 *   2. Seeds OWNER / ADMIN / MEMBER roles in each one.
 *   3. Creates the owner's membership.
 *   4. Converts Assignee rows:
 *        registered email   → a MEMBER membership in the creator's workspace
 *        unregistered email → a pending WorkspaceInvitation
 *   5. Backfills `Task.workspace` from the task creator's personal workspace.
 *
 * Safety
 * ------
 *   - Additive. Nothing is deleted; no existing value is overwritten.
 *   - Idempotent. A second run creates nothing and reports zeros.
 *   - Resumable. Every step resolves before it creates, so an interrupted run
 *     is repaired by the next one.
 *   - A real run requires `--confirm-database=<name>` matching the database the
 *     connection actually opened. `NODE_ENV` authorises nothing.
 *   - `--dry-run` writes nothing at all: no documents, no collections, no
 *     indexes.
 *
 * The legacy `Assignee` collection is NOT deleted. Retiring it is a later
 * stage, once the members UI has shipped and been verified.
 *
 * Usage
 * -----
 *   node scripts/migrate-to-workspaces.js --dry-run
 *   node scripts/migrate-to-workspaces.js --confirm-database=<database-name>
 *
 *   node scripts/migrate-to-workspaces.js --help
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const {
  buildPlan,
  execute,
  validate,
  formatReport,
} = require('../services/workspaceMigration');

const {
  USAGE,
  parseArgs,
  resolveDatabaseName,
  checkExecutionSafety,
  formatIdentity,
  backupWarning,
} = require('../services/migrationSafety');

const args = parseArgs(process.argv.slice(2));
const env = String(process.env.NODE_ENV || 'development').trim().toLowerCase();

const run = async () => {
  if (args.help) {
    console.log(USAGE);
    return;
  }

  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is not set. Copy .env.example to .env first.');
  }

  // Index building is disabled for *every* run, not only dry runs.
  //
  // Mongoose builds each model's indexes when the connection opens, which
  // implicitly creates the collections. That would be a write before the safety
  // gate has decided anything — so indexes are built explicitly, after a run
  // has both passed confirmation and succeeded.
  //
  // Two separate options are needed, and both must be *connection* options:
  //
  //   autoIndex  — builds each model's indexes on connect
  //   autoCreate — calls createCollection() for each model, independently of
  //                autoIndex, and is what actually produced the empty
  //                collections a dry run was leaving behind
  //
  // `mongoose.set(...)` would not have worked either way: it only affects
  // models compiled after the call, and every model here is already compiled
  // by the requires above.
  await mongoose.connect(process.env.MONGODB_URI, {
    autoIndex: false,
    autoCreate: false,
  });

  // The connected database is the authority on what is about to be written to.
  // The URI is never printed: it can carry credentials.
  const databaseName = resolveDatabaseName(mongoose.connection);

  console.log('');
  console.log(
    formatIdentity({
      dryRun: args.dryRun,
      env,
      databaseName,
      confirmDatabase: args.confirmDatabase,
    })
  );
  console.log('');

  const safety = checkExecutionSafety({
    dryRun: args.dryRun,
    databaseName,
    confirmDatabase: args.confirmDatabase,
    env,
    allowProduction: args.allowProduction,
  });

  if (!safety.allowed) {
    console.error(safety.message);
    console.error('');
    process.exitCode = 1;
    await mongoose.disconnect();
    return;
  }

  // The dry run and the real run share this planning pass. That is what makes
  // the preview trustworthy: it is not a separate code path.
  const plan = await buildPlan();

  if (args.dryRun) {
    console.log(formatReport({ mode: 'DRY RUN', plan }));
    await mongoose.disconnect();
    return;
  }

  console.log(backupWarning(databaseName));
  console.log('');

  const applied = await execute(plan);
  const validation = await validate();

  console.log(formatReport({ mode: 'EXECUTION', plan, applied, validation }));

  if (!validation.passed || applied.errors.length > 0) {
    console.error('');
    console.error('Migration finished with unresolved problems — see above.');
    process.exitCode = 1;
  } else {
    console.log('');
    console.log('Ensuring indexes...');
    await Promise.all([
      require('../model/workspaceModel').syncIndexes(),
      require('../model/roleModel').syncIndexes(),
      require('../model/workspaceMembershipModel').syncIndexes(),
      require('../model/workspaceInvitationModel').syncIndexes(),
    ]);
    console.log('Indexes are in place.');
    console.log('');
    console.log('Done.');
  }

  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error('');
  console.error('Migration failed:', error.message);
  console.error(error.stack);
  process.exitCode = 1;

  try {
    await mongoose.disconnect();
  } catch {
    // Already disconnected; nothing useful to do.
  }
});
