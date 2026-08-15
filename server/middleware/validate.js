const mongoose = require('mongoose');

const AppError = require('../utils/AppError');
const {
  TASK_STATUSES,
  TASK_PRIORITIES,
  DATE_RANGES,
  MAX_TITLE_LENGTH,
  MAX_CHECKLISTS,
  MIN_PASSWORD_LENGTH,
} = require('../constants');

const EMAIL_REGEX = /^[\w-.]+@([\w-]+\.)+[\w-]{2,}$/;

/** Throw a 400 carrying a field->message map the client can render inline. */
const fail = (errors, message = 'Some of the values you entered are not valid.') => {
  const error = new AppError(message, 400);
  error.errors = errors;
  throw error;
};

/**
 * Validate an :id style route parameter before it reaches Mongoose.
 *
 * Relying on Mongoose casting alone means every malformed id becomes a
 * CastError deep inside a query; validating up front keeps the failure local
 * and the message honest.
 */
const validateObjectIdParam = (paramName) => (req, res, next) => {
  const value = req.params[paramName];

  if (!mongoose.Types.ObjectId.isValid(value)) {
    return next(new AppError(`'${value}' is not a valid id.`, 400));
  }

  next();
};

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Normalise and validate a checklist array.
 * Returns the sanitised array — callers must persist *this*, not the raw input.
 */
const parseChecklists = (checklists, errors) => {
  if (!Array.isArray(checklists)) {
    errors.checklists = 'Checklists must be a list.';
    return null;
  }

  if (checklists.length === 0) {
    errors.checklists = 'Add at least one checklist item.';
    return null;
  }

  if (checklists.length > MAX_CHECKLISTS) {
    errors.checklists = `A task cannot have more than ${MAX_CHECKLISTS} checklist items.`;
    return null;
  }

  const invalid = checklists.some((item) => !isPlainObject(item));
  if (invalid) {
    errors.checklists = 'Each checklist item must be an object.';
    return null;
  }

  // Explicit field picking: a client cannot inject extra subdocument fields.
  return checklists.map((item) => ({
    title: typeof item.title === 'string' ? item.title.trim().slice(0, MAX_TITLE_LENGTH) : '',
    checked: Boolean(item.checked),
  }));
};

const parseTaskFields = (body, { partial }) => {
  const errors = {};
  const clean = {};

  const has = (key) => body[key] !== undefined;

  if (has('title') || !partial) {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) errors.title = 'Title is required.';
    else if (title.length > MAX_TITLE_LENGTH)
      errors.title = `Title cannot be longer than ${MAX_TITLE_LENGTH} characters.`;
    else clean.title = title;
  }

  if (has('priority') || !partial) {
    if (!TASK_PRIORITIES.includes(body.priority)) {
      errors.priority = `Priority must be one of: ${TASK_PRIORITIES.join(', ')}.`;
    } else {
      clean.priority = body.priority;
    }
  }

  if (has('status')) {
    if (!TASK_STATUSES.includes(body.status)) {
      errors.status = `Status must be one of: ${TASK_STATUSES.join(', ')}.`;
    } else {
      clean.status = body.status;
    }
  }

  if (has('checklists') || !partial) {
    const parsed = parseChecklists(body.checklists, errors);
    if (parsed) clean.checklists = parsed;
  }

  if (has('dueDate')) {
    if (body.dueDate === null || body.dueDate === '') {
      clean.dueDate = null;
    } else {
      const date = new Date(body.dueDate);
      if (Number.isNaN(date.getTime())) errors.dueDate = 'Due date is not a valid date.';
      else clean.dueDate = date;
    }
  }

  if (has('assignee')) {
    if (body.assignee === null || body.assignee === '') {
      clean.assignee = null;
    } else if (typeof body.assignee !== 'string' || !EMAIL_REGEX.test(body.assignee.trim())) {
      errors.assignee = 'Assignee must be a valid email address.';
    } else {
      clean.assignee = body.assignee.trim().toLowerCase();
    }
  }

  if (Object.keys(errors).length) fail(errors);

  return clean;
};

/**
 * Build the create/update payload from an allowlist.
 *
 * `req.validated` is what controllers persist. The raw body is never spread
 * into a query, so `createdBy`, `shared`, `assignedTo`, `_id` and friends
 * cannot be set by a client.
 */
const validateTaskCreate = (req, res, next) => {
  try {
    req.validated = parseTaskFields(req.body, { partial: false });
    next();
  } catch (err) {
    next(err);
  }
};

const validateTaskUpdate = (req, res, next) => {
  try {
    const validated = parseTaskFields(req.body, { partial: true });

    if (Object.keys(validated).length === 0) {
      return next(new AppError('No updatable fields were provided.', 400));
    }

    req.validated = validated;
    next();
  } catch (err) {
    next(err);
  }
};

const validateTaskQuery = (req, res, next) => {
  const { range, status, priority } = req.query;

  if (range !== undefined && !DATE_RANGES.includes(range)) {
    return next(
      new AppError(`Range must be one of: ${DATE_RANGES.join(', ')}.`, 400)
    );
  }

  if (status !== undefined && !TASK_STATUSES.includes(status)) {
    return next(new AppError('Unknown status filter.', 400));
  }

  if (priority !== undefined && !TASK_PRIORITIES.includes(priority)) {
    return next(new AppError('Unknown priority filter.', 400));
  }

  next();
};

const validateRegister = (req, res, next) => {
  const errors = {};
  const { name, email, password, confirmPassword } = req.body;

  if (typeof name !== 'string' || !name.trim()) errors.name = 'Name is required.';

  if (typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
    errors.email = 'Please enter a valid email address.';
  }

  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`;
  }

  if (password !== confirmPassword) {
    errors.confirmPassword = 'Passwords do not match.';
  }

  if (Object.keys(errors).length) {
    const error = new AppError('Some of the values you entered are not valid.', 400);
    error.errors = errors;
    return next(error);
  }

  next();
};

const validateUserUpdate = (req, res, next) => {
  const errors = {};
  const { name, email, newPassword } = req.body;

  if (email !== undefined && (typeof email !== 'string' || !EMAIL_REGEX.test(email.trim()))) {
    errors.email = 'Please enter a valid email address.';
  }

  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    errors.name = 'Name cannot be empty.';
  }

  if (
    newPassword !== undefined &&
    newPassword !== '' &&
    (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH)
  ) {
    errors.newPassword = `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`;
  }

  if (Object.keys(errors).length) {
    const error = new AppError('Some of the values you entered are not valid.', 400);
    error.errors = errors;
    return next(error);
  }

  next();
};

const validateAssignee = (req, res, next) => {
  const { email } = req.body;

  if (typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
    const error = new AppError('Please enter a valid email address.', 400);
    error.errors = { email: 'Please enter a valid email address.' };
    return next(error);
  }

  req.body.email = email.trim().toLowerCase();
  next();
};

/**
 * Build a field-error AppError and hand it to `next()`.
 *
 * The `fail` helper above throws, which suits the parse functions it is used
 * from; middleware needs to pass the error along instead.
 */
const failWith = (errors, next) => {
  const error = new AppError('Some of the values you entered are not valid.', 400);
  error.errors = errors;
  return next(error);
};

/** Invitation creation: an email and the role being offered. */
const validateInvitation = (req, res, next) => {
  const errors = {};
  const { email, roleId } = req.body;

  if (typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
    errors.email = 'Please enter a valid email address.';
  }

  if (!mongoose.Types.ObjectId.isValid(String(roleId))) {
    errors.roleId = 'Please choose a role.';
  }

  if (Object.keys(errors).length) return failWith(errors, next);

  next();
};

/** Role assignment: only the role id is accepted from the body. */
const validateRoleAssignment = (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(String(req.body.roleId))) {
    return failWith({ roleId: 'Please choose a role.' }, next);
  }

  next();
};

/**
 * Invitation acceptance.
 *
 * Only shape is checked here. Whether the token is real, current or already
 * used is decided by the service, which answers every failure identically so
 * the endpoint cannot be used to probe which tokens existed.
 */
const validateInvitationToken = (req, res, next) => {
  const { token } = req.body;

  if (typeof token !== 'string' || token.trim().length < 16) {
    return failWith({ token: 'This invitation link is not valid.' }, next);
  }

  next();
};

/** Member/invitation list filters. */
const validateMemberQuery = (req, res, next) => {
  const { status, page, limit } = req.query;

  const allowed = ['active', 'suspended', 'pending', 'accepted', 'expired', 'revoked'];

  if (status !== undefined && !allowed.includes(status)) {
    return next(new AppError('Unknown status filter.', 400));
  }

  for (const [name, value] of [['page', page], ['limit', limit]]) {
    if (value !== undefined && (!/^\d+$/.test(String(value)) || Number(value) < 1)) {
      return next(new AppError(`'${name}' must be a positive whole number.`, 400));
    }
  }

  next();
};

/**
 * Shape checks for a submitted permission list.
 *
 * Deliberately shallow: whether a key exists in the catalogue, whether its
 * scope is supported, and whether the actor may grant it are all decided by the
 * role service and the authorization engine. This only rejects submissions that
 * are not the right *shape* to reason about.
 */
const validatePermissionsShape = (permissions, errors) => {
  if (!Array.isArray(permissions)) {
    errors.permissions = 'Permissions must be a list.';
    return;
  }

  const malformed = permissions.some(
    (entry) =>
      typeof entry !== 'string' &&
      (!isPlainObject(entry) || typeof entry.key !== 'string')
  );

  if (malformed) {
    errors.permissions = 'Each permission must be a key, or an object with a key.';
  }
};

const validateRoleCreate = (req, res, next) => {
  const errors = {};
  const { name, description, permissions } = req.body;

  if (typeof name !== 'string' || !name.trim()) {
    errors.name = 'A role name is required.';
  }

  if (description !== undefined && typeof description !== 'string') {
    errors.description = 'Description must be text.';
  }

  if (permissions !== undefined) validatePermissionsShape(permissions, errors);

  if (Object.keys(errors).length) return failWith(errors, next);

  next();
};

const validateRoleUpdate = (req, res, next) => {
  const errors = {};
  const { name, description, permissions } = req.body;

  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    errors.name = 'A role name cannot be empty.';
  }

  if (description !== undefined && typeof description !== 'string') {
    errors.description = 'Description must be text.';
  }

  if (permissions !== undefined) validatePermissionsShape(permissions, errors);

  if (name === undefined && description === undefined && permissions === undefined) {
    return next(new AppError('No updatable fields were provided.', 400));
  }

  if (Object.keys(errors).length) return failWith(errors, next);

  next();
};

module.exports = {
  EMAIL_REGEX,
  validateObjectIdParam,
  validateRoleCreate,
  validateRoleUpdate,
  validateInvitation,
  validateRoleAssignment,
  validateInvitationToken,
  validateMemberQuery,
  validateTaskCreate,
  validateTaskUpdate,
  validateTaskQuery,
  validateRegister,
  validateUserUpdate,
  validateAssignee,
};
