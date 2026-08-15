/**
 * Role management endpoints.
 *
 * Thin, like Stage 6's member controller. The permission ceiling, system-role
 * protection and role-in-use guard all live in `roleService`, so a caller that
 * never goes through HTTP is protected identically.
 */

const catchAsync = require('../utils/catchAsync');
const roleService = require('../services/workspace/roleService');

exports.listRoles = catchAsync(async (req, res) => {
  const result = await roleService.listRoles({
    workspaceId: req.params.workspaceId,
    actorUserId: req.user._id,
    pagination: { page: req.query.page, limit: req.query.limit },
  });

  res.status(200).json({
    status: 'success',
    results: result.roles.length,
    data: result,
  });
});

exports.getRole = catchAsync(async (req, res) => {
  const role = await roleService.getRole({
    workspaceId: req.params.workspaceId,
    actorUserId: req.user._id,
    roleId: req.params.roleId,
  });

  res.status(200).json({ status: 'success', data: { role } });
});

/** The catalogue a role editor renders its checkboxes from. */
exports.listPermissions = catchAsync(async (req, res) => {
  const permissions = await roleService.listAvailablePermissions({
    workspaceId: req.params.workspaceId,
    actorUserId: req.user._id,
  });

  res.status(200).json({
    status: 'success',
    results: permissions.length,
    data: { permissions },
  });
});

exports.createRole = catchAsync(async (req, res) => {
  // Only these three fields are read. `systemKey`, `isSystemRole`, `rank` and
  // `workspace` are never taken from the body — the workspace comes from the
  // route, and the rest are the server's to decide.
  const role = await roleService.createRole({
    workspaceId: req.params.workspaceId,
    actorUserId: req.user._id,
    name: req.body.name,
    description: req.body.description,
    permissions: req.body.permissions,
  });

  res.status(201).json({ status: 'success', data: { role } });
});

exports.updateRole = catchAsync(async (req, res) => {
  const role = await roleService.updateRole({
    workspaceId: req.params.workspaceId,
    actorUserId: req.user._id,
    roleId: req.params.roleId,
    name: req.body.name,
    description: req.body.description,
    permissions: req.body.permissions,
  });

  res.status(200).json({ status: 'success', data: { role } });
});

exports.deleteRole = catchAsync(async (req, res) => {
  await roleService.deleteRole({
    workspaceId: req.params.workspaceId,
    actorUserId: req.user._id,
    roleId: req.params.roleId,
  });

  res.status(204).send();
});
