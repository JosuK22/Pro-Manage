/**
 * Execution safety for the workspace migration.
 *
 * Why this exists
 * ---------------
 * Stage 4 gated real execution on `NODE_ENV !== 'production'`. That is not a
 * safety mechanism, it is a label: this repository runs with
 * `NODE_ENV=development` while `MONGODB_URI` points at a live cluster holding
 * real data, so the guard would happily let a real migration run against it.
 *
 * The gate is now a positive identity match — the operator must name the
 * database they intend to write to, and it must equal the database the
 * connection actually opened. A mislabelled environment can no longer authorise
 * anything.
 *
 * Kept separate from `workspaceMigration.js` so the migration logic itself is
 * untouched, and so these rules can be tested without a database.
 */

const CONFIRM_FLAG = '--confirm-database=';

/** Reasons execution can be refused. Exported so tests assert on codes, not prose. */
const REFUSAL = {
  UNKNOWN_DATABASE: 'UNKNOWN_DATABASE',
  CONFIRMATION_REQUIRED: 'CONFIRMATION_REQUIRED',
  DATABASE_MISMATCH: 'DATABASE_MISMATCH',
  PRODUCTION_BLOCKED: 'PRODUCTION_BLOCKED',
};

const USAGE = `
Usage:

  Dry run (read-only, no confirmation needed):
    node scripts/migrate-to-workspaces.js --dry-run

  Real migration (requires explicit database confirmation):
    node scripts/migrate-to-workspaces.js --confirm-database=<database-name>

Options:

  --dry-run
      Read-only planning and validation. Writes nothing, creates no
      collections and builds no indexes.

  --confirm-database=<name>
      Required for real execution. Must exactly match the name of the
      database the connection actually opens. This is the primary safety
      mechanism — NODE_ENV is not.

  --allow-production
      Secondary guard. Additionally required when NODE_ENV=production.
      It does not replace --confirm-database.
`.trim();

/** Parse the flags this script understands. Unknown flags are ignored. */
const parseArgs = (argv = []) => {
  const confirmArg = argv.find((arg) => arg.startsWith(CONFIRM_FLAG));

  const raw = confirmArg ? confirmArg.slice(CONFIRM_FLAG.length).trim() : null;

  return {
    dryRun: argv.includes('--dry-run'),
    // An empty `--confirm-database=` is not a confirmation.
    confirmDatabase: raw || null,
    allowProduction: argv.includes('--allow-production'),
    help: argv.includes('--help') || argv.includes('-h'),
  };
};

/**
 * The name of the database the connection actually opened.
 *
 * Taken from the live connection, never parsed out of the URI: the URI can
 * omit the database entirely (in which case the driver picks a default), carry
 * credentials, or carry query parameters that shift the target. The connected
 * database object is the only authority on what is really being written to.
 *
 * Returns null when it cannot be established, which callers must treat as
 * "refuse", never as "probably fine".
 */
const resolveDatabaseName = (connection) => {
  const name = connection?.db?.databaseName ?? connection?.name ?? null;

  if (typeof name !== 'string') return null;

  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * May this run write?
 *
 * @returns {{ allowed: boolean, code?: string, message?: string }}
 */
const checkExecutionSafety = ({
  dryRun = false,
  databaseName = null,
  confirmDatabase = null,
  env = 'development',
  allowProduction = false,
} = {}) => {
  // A dry run writes nothing, so there is nothing to authorise. Requiring
  // confirmation here would only train people to type it out of habit.
  if (dryRun) return { allowed: true };

  if (!databaseName) {
    return {
      allowed: false,
      code: REFUSAL.UNKNOWN_DATABASE,
      message: [
        'ERROR: Unable to positively identify the connected MongoDB database.',
        'Refusing to execute migration.',
        'No data was modified.',
      ].join('\n'),
    };
  }

  if (!confirmDatabase) {
    return {
      allowed: false,
      code: REFUSAL.CONFIRMATION_REQUIRED,
      message: [
        'ERROR: Refusing to execute workspace migration.',
        '',
        'A real migration requires explicit database confirmation.',
        '',
        'Use:',
        `  node scripts/migrate-to-workspaces.js --confirm-database=${databaseName}`,
        '',
        'Use --dry-run for a read-only migration plan.',
        '',
        'No data was modified.',
      ].join('\n'),
    };
  }

  // Exact match. MongoDB database names are case-sensitive, so folding case
  // here would accept a name the server would treat as a different database.
  if (confirmDatabase !== databaseName) {
    return {
      allowed: false,
      code: REFUSAL.DATABASE_MISMATCH,
      message: [
        'ERROR: Database confirmation failed.',
        '',
        `Connected database: ${databaseName}`,
        `Confirmed database: ${confirmDatabase}`,
        '',
        'No data was modified.',
      ].join('\n'),
    };
  }

  // Secondary layer, retained from Stage 4. Deliberately checked *after* the
  // identity match so it can never be mistaken for the primary gate.
  if (String(env).trim().toLowerCase() === 'production' && !allowProduction) {
    return {
      allowed: false,
      code: REFUSAL.PRODUCTION_BLOCKED,
      message: [
        'ERROR: Refusing to run the workspace migration against production.',
        '',
        'Take a database backup first, then re-run with --allow-production',
        'if this is explicitly authorised.',
        '',
        'No data was modified.',
      ].join('\n'),
    };
  }

  return { allowed: true };
};

/**
 * The identity banner.
 *
 * Deliberately built from the resolved database name and NODE_ENV only — the
 * connection string is never rendered, so host, username, password and query
 * parameters cannot reach a log, a terminal history or a CI transcript.
 */
const formatIdentity = ({ dryRun, env, databaseName, confirmDatabase }) => {
  const lines = [
    'Workspace Migration',
    '',
    `Mode:         ${dryRun ? 'DRY RUN' : 'EXECUTION'}`,
    `Environment:  ${env}`,
    `Database:     ${databaseName ?? '(could not be determined)'}`,
  ];

  if (!dryRun && confirmDatabase) {
    lines.push(`Confirmation: ${confirmDatabase}`);
  }

  return lines.join('\n');
};

/** Shown before a real run. The CLI does not take backups; it only reminds. */
const backupWarning = (databaseName) =>
  [
    'WARNING:',
    'This command will modify the connected MongoDB database.',
    '',
    `Database: ${databaseName}`,
    '',
    'Ensure a database backup exists before proceeding.',
    'This command does not create one.',
  ].join('\n');

module.exports = {
  CONFIRM_FLAG,
  REFUSAL,
  USAGE,
  parseArgs,
  resolveDatabaseName,
  checkExecutionSafety,
  formatIdentity,
  backupWarning,
};
