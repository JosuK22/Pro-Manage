const express = require('express');
const request = require('supertest');
const mongoose = require('mongoose');

const app = require('../app');
const { protect } = require('../controllers/authController');
const globalErrorHandler = require('../controllers/errorController');
const {
  WORKSPACE_HEADER,
  SOURCE,
  requireWorkspaceContext,
  resolveWorkspaceContext,
  getWorkspaceId,
} = require('../middleware/workspaceContext');
const authorization = require('../services/authorization');

const { createUser, createMember, setupWorkspace } = require('./factories');

const anId = () => new mongoose.Types.ObjectId();

/**
 * A minimal app that exercises the real middleware chain.
 *
 * Built here rather than by mounting the middleware on a production route,
 * because Stage 8.1 deliberately opts no existing route in — and a test that
 * changed that would be testing something the stage did not ship.
 */
const buildContextApp = () => {
  const testApp = express();
  testApp.use(express.json());

  // The real `protect`, so authentication behaviour is not simulated.
  testApp.get('/ctx', protect, requireWorkspaceContext, (req, res) => {
    res.status(200).json({
      workspaceId: getWorkspaceId(req),
      source: req.workspaceContext.source,
    });
  });

  // Same, on a route that also carries the workspace in its path.
  testApp.get('/ws/:workspaceId/ctx', protect, requireWorkspaceContext, (req, res) => {
    res.status(200).json({
      workspaceId: getWorkspaceId(req),
      source: req.workspaceContext.source,
    });
  });

  testApp.post('/ctx', protect, requireWorkspaceContext, (req, res) => {
    res.status(200).json({
      workspaceId: getWorkspaceId(req),
      bodyWorkspaceId: req.body?.workspaceId ?? null,
    });
  });

  // Context resolves, then authorization decides — the whole point of the stage.
  testApp.get('/ctx/protected', protect, requireWorkspaceContext, async (req, res, next) => {
    try {
      const result = await authorization.check({
        userId: req.user._id,
        workspaceId: getWorkspaceId(req),
        permission: 'members.view',
      });

      if (!result.allowed) {
        return res.status(result.status).json({ status: 'fail', code: result.code });
      }

      res.status(200).json({ status: 'success', workspaceId: getWorkspaceId(req) });
    } catch (error) {
      next(error);
    }
  });

  // Deliberately missing `protect`, to prove the ordering guard fails closed.
  testApp.get('/ctx/unprotected', requireWorkspaceContext, (req, res) => {
    res.status(200).json({ workspaceId: getWorkspaceId(req) });
  });

  testApp.use(globalErrorHandler);
  return testApp;
};

const ctxApp = buildContextApp();

const asUser = (actor) => (req) => req.set('Authorization', `Bearer ${actor.token}`);

describe('Stage 8.1 — workspace request context', () => {
  // ===========================================================================
  // Header handling
  // ===========================================================================
  describe('X-Workspace-Id', () => {
    it('resolves a valid header', async () => {
      const { workspace, owner } = await setupWorkspace();

      const res = await request(ctxApp)
        .get('/ctx')
        .set('Authorization', `Bearer ${owner.token}`)
        .set(WORKSPACE_HEADER, String(workspace._id))
        .expect(200);

      expect(res.body.workspaceId).toBe(String(workspace._id));
      expect(res.body.source).toBe(SOURCE.HEADER);
    });

    // HTTP header names are case-insensitive; callers must not have to guess.
    it.each([['X-Workspace-Id'], ['x-workspace-id'], ['X-WORKSPACE-ID'], ['x-WoRkSpAcE-iD']])(
      'accepts the header spelled %s',
      async (header) => {
        const { workspace, owner } = await setupWorkspace();

        const res = await request(ctxApp)
          .get('/ctx')
          .set('Authorization', `Bearer ${owner.token}`)
          .set(header, String(workspace._id))
          .expect(200);

        expect(res.body.workspaceId).toBe(String(workspace._id));
      }
    );

    it('trims surrounding whitespace', async () => {
      const { workspace, owner } = await setupWorkspace();

      const res = await request(ctxApp)
        .get('/ctx')
        .set('Authorization', `Bearer ${owner.token}`)
        .set(WORKSPACE_HEADER, `  ${workspace._id}  `)
        .expect(200);

      expect(res.body.workspaceId).toBe(String(workspace._id));
    });

    it('rejects a missing header with 400', async () => {
      const { owner } = await setupWorkspace();

      const res = await request(ctxApp)
        .get('/ctx')
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(400);

      expect(res.body.message).toMatch(/needs a workspace/i);
    });

    // Empty is "you sent nothing", not "you sent something malformed".
    it.each([[''], ['   ']])('treats a %p header as absent', async (value) => {
      const { owner } = await setupWorkspace();

      const res = await request(ctxApp)
        .get('/ctx')
        .set('Authorization', `Bearer ${owner.token}`)
        .set(WORKSPACE_HEADER, value)
        .expect(400);

      expect(res.body.message).toMatch(/needs a workspace/i);
    });

    it('rejects a malformed workspace id with 400', async () => {
      const { owner } = await setupWorkspace();

      const res = await request(ctxApp)
        .get('/ctx')
        .set('Authorization', `Bearer ${owner.token}`)
        .set(WORKSPACE_HEADER, 'abc')
        .expect(400);

      expect(res.body.message).toMatch(/not a valid workspace id/i);
    });

    // A well-formed id for a workspace that does not exist is not this
    // middleware's problem — it validates shape, authorization resolves the row.
    it('accepts a well-formed id for a workspace that does not exist', async () => {
      const { owner } = await setupWorkspace();
      const ghost = anId();

      const res = await request(ctxApp)
        .get('/ctx')
        .set('Authorization', `Bearer ${owner.token}`)
        .set(WORKSPACE_HEADER, String(ghost))
        .expect(200);

      expect(res.body.workspaceId).toBe(String(ghost));
    });

    it('never leaks a database error for a malformed id', async () => {
      const { owner } = await setupWorkspace();

      const res = await request(ctxApp)
        .get('/ctx')
        .set('Authorization', `Bearer ${owner.token}`)
        .set(WORKSPACE_HEADER, "'; drop--")
        .expect(400);

      expect(JSON.stringify(res.body)).not.toMatch(/CastError|mongo|BSON/i);
    });
  });

  // ===========================================================================
  // Authentication
  // ===========================================================================
  describe('authentication', () => {
    it('rejects an anonymous request even with a valid header', async () => {
      const { workspace } = await setupWorkspace();

      await request(ctxApp)
        .get('/ctx')
        .set(WORKSPACE_HEADER, String(workspace._id))
        .expect(401);
    });

    // If someone mounts the middleware without `protect`, it must fail closed
    // rather than quietly building a context for nobody.
    it('fails closed when mounted without authentication', async () => {
      const { workspace } = await setupWorkspace();

      await request(ctxApp)
        .get('/ctx/unprotected')
        .set(WORKSPACE_HEADER, String(workspace._id))
        .expect(401);
    });
  });

  // ===========================================================================
  // The central security property
  // ===========================================================================
  describe('the header identifies, it does not authorize', () => {
    it('resolves a workspace the caller does not belong to, then denies the operation', async () => {
      const a = await setupWorkspace({ name: 'A' });
      const b = await setupWorkspace({ name: 'B' });

      // A's owner is a member of A only.
      const inOwn = await request(ctxApp)
        .get('/ctx/protected')
        .set('Authorization', `Bearer ${a.owner.token}`)
        .set(WORKSPACE_HEADER, String(a.workspace._id))
        .expect(200);

      expect(inOwn.body.workspaceId).toBe(String(a.workspace._id));

      // Pointing the header at B resolves fine — and is then refused.
      const inOther = await request(ctxApp)
        .get('/ctx/protected')
        .set('Authorization', `Bearer ${a.owner.token}`)
        .set(WORKSPACE_HEADER, String(b.workspace._id))
        .expect(404);

      expect(inOther.body.code).toBe(authorization.DENIAL.NOT_A_MEMBER);
    });

    it('gives a member of the target workspace no more than their role allows', async () => {
      const a = await setupWorkspace({ name: 'A' });
      const b = await setupWorkspace({ name: 'B' });

      // A's owner joins B as an ordinary member.
      await createMember({ workspace: b.workspace, role: b.roles.member, actor: a.owner });

      // members.view is granted to the seeded Member role, so this succeeds...
      await request(ctxApp)
        .get('/ctx/protected')
        .set('Authorization', `Bearer ${a.owner.token}`)
        .set(WORKSPACE_HEADER, String(b.workspace._id))
        .expect(200);

      // ...but owner authority did not travel: checked directly against the engine.
      const asOwnerElsewhere = await authorization.check({
        userId: a.owner.user._id,
        workspaceId: b.workspace._id,
        permission: 'workspace.delete',
      });

      expect(asOwnerElsewhere.allowed).toBe(false);
    });

    it('does not grant a stranger anything by supplying a header', async () => {
      const { workspace } = await setupWorkspace();
      const stranger = await createUser();

      const res = await request(ctxApp)
        .get('/ctx/protected')
        .set('Authorization', `Bearer ${stranger.token}`)
        .set(WORKSPACE_HEADER, String(workspace._id))
        .expect(404);

      expect(res.body.code).toBe(authorization.DENIAL.NOT_A_MEMBER);
    });
  });

  // ===========================================================================
  // Route vs header
  // ===========================================================================
  describe('route parameter and header together', () => {
    it('uses the route parameter when only it is present', async () => {
      const { workspace, owner } = await setupWorkspace();

      const res = await request(ctxApp)
        .get(`/ws/${workspace._id}/ctx`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);

      expect(res.body.workspaceId).toBe(String(workspace._id));
      expect(res.body.source).toBe(SOURCE.ROUTE);
    });

    it('accepts a header that agrees with the route', async () => {
      const { workspace, owner } = await setupWorkspace();

      const res = await request(ctxApp)
        .get(`/ws/${workspace._id}/ctx`)
        .set('Authorization', `Bearer ${owner.token}`)
        .set(WORKSPACE_HEADER, String(workspace._id))
        .expect(200);

      expect(res.body.source).toBe(SOURCE.ROUTE);
    });

    // Picking a winner would let a caller aim at one workspace in the URL and
    // another in the header — the confused-deputy setup.
    it('rejects a header that contradicts the route', async () => {
      const a = await setupWorkspace({ name: 'A' });
      const b = await setupWorkspace({ name: 'B' });

      const res = await request(ctxApp)
        .get(`/ws/${a.workspace._id}/ctx`)
        .set('Authorization', `Bearer ${a.owner.token}`)
        .set(WORKSPACE_HEADER, String(b.workspace._id))
        .expect(400);

      expect(res.body.message).toMatch(/does not match/i);
    });
  });

  // ===========================================================================
  // The body is never authoritative
  // ===========================================================================
  describe('request body', () => {
    it('ignores a workspaceId in the body', async () => {
      const a = await setupWorkspace({ name: 'A' });
      const b = await setupWorkspace({ name: 'B' });

      const res = await request(ctxApp)
        .post('/ctx')
        .set('Authorization', `Bearer ${a.owner.token}`)
        .set(WORKSPACE_HEADER, String(a.workspace._id))
        .send({ workspaceId: String(b.workspace._id) })
        .expect(200);

      // The body value arrived, and was simply not used.
      expect(res.body.bodyWorkspaceId).toBe(String(b.workspace._id));
      expect(res.body.workspaceId).toBe(String(a.workspace._id));
    });

    it('does not accept a body workspaceId as a substitute for the header', async () => {
      const { workspace, owner } = await setupWorkspace();

      await request(ctxApp)
        .post('/ctx')
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ workspaceId: String(workspace._id) })
        .expect(400);
    });
  });

  // ===========================================================================
  // Request isolation
  // ===========================================================================
  describe('concurrency', () => {
    it('keeps each concurrent request on its own workspace', async () => {
      const a = await setupWorkspace({ name: 'A' });
      const b = await setupWorkspace({ name: 'B' });
      const c = await setupWorkspace({ name: 'C' });

      const targets = [a, b, c, a, b, c, c, b, a];

      const responses = await Promise.all(
        targets.map((target) =>
          request(ctxApp)
            .get('/ctx')
            .set('Authorization', `Bearer ${target.owner.token}`)
            .set(WORKSPACE_HEADER, String(target.workspace._id))
        )
      );

      responses.forEach((res, index) => {
        expect(res.status).toBe(200);
        expect(res.body.workspaceId).toBe(String(targets[index].workspace._id));
      });
    });

    it('does not leak one request’s workspace into another that omits the header', async () => {
      const a = await setupWorkspace({ name: 'A' });
      const b = await setupWorkspace({ name: 'B' });

      const [withHeader, withoutHeader] = await Promise.all([
        request(ctxApp)
          .get('/ctx')
          .set('Authorization', `Bearer ${a.owner.token}`)
          .set(WORKSPACE_HEADER, String(a.workspace._id)),
        request(ctxApp).get('/ctx').set('Authorization', `Bearer ${b.owner.token}`),
      ]);

      expect(withHeader.status).toBe(200);
      expect(withHeader.body.workspaceId).toBe(String(a.workspace._id));

      // The second request must still be a clean 400, not silently inherit A.
      expect(withoutHeader.status).toBe(400);
      expect(withoutHeader.body.workspaceId).toBeUndefined();
    });

    it('holds no module-level state between calls', () => {
      const first = resolveWorkspaceContext({
        params: {},
        get: () => String(anId()),
      });
      const second = resolveWorkspaceContext({ params: {}, get: () => undefined });

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(false);
    });
  });

  // ===========================================================================
  // Pure resolution
  // ===========================================================================
  describe('resolveWorkspaceContext (pure)', () => {
    const req = ({ param, header }) => ({
      params: param ? { workspaceId: param } : {},
      get: () => header,
    });

    it('reports the source', () => {
      const id = String(anId());

      expect(resolveWorkspaceContext(req({ header: id }))).toMatchObject({
        ok: true,
        source: SOURCE.HEADER,
      });
      expect(resolveWorkspaceContext(req({ param: id }))).toMatchObject({
        ok: true,
        source: SOURCE.ROUTE,
      });
    });

    it('fails on conflict, absence and malformation', () => {
      expect(
        resolveWorkspaceContext(req({ param: String(anId()), header: String(anId()) })).ok
      ).toBe(false);
      expect(resolveWorkspaceContext(req({})).ok).toBe(false);
      expect(resolveWorkspaceContext(req({ header: 'nope' })).ok).toBe(false);
    });

    it('survives a request object with no getter', () => {
      expect(resolveWorkspaceContext({ params: {} }).ok).toBe(false);
    });
  });

  describe('getWorkspaceId', () => {
    it('returns null when no context was attached', () => {
      expect(getWorkspaceId({})).toBeNull();
    });
  });

  // ===========================================================================
  // Nothing else changed
  // ===========================================================================
  describe('existing endpoints are unaffected', () => {
    it('still work without the header', async () => {
      const { workspace, owner } = await setupWorkspace();

      await request(app)
        .get(`/api/v1/workspaces/${workspace._id}/members`)
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);

      await request(app)
        .get('/api/v1/tasks')
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);
    });

    // Stage 6/7 routes take the workspace from the path and do not opt into
    // this middleware, so a stray header must be inert rather than fatal.
    it('ignore a stray or even contradictory header', async () => {
      const a = await setupWorkspace({ name: 'A' });
      const b = await setupWorkspace({ name: 'B' });

      await request(app)
        .get(`/api/v1/workspaces/${a.workspace._id}/members`)
        .set('Authorization', `Bearer ${a.owner.token}`)
        .set(WORKSPACE_HEADER, String(b.workspace._id))
        .expect(200);

      await request(app)
        .get('/api/v1/tasks')
        .set('Authorization', `Bearer ${a.owner.token}`)
        .set(WORKSPACE_HEADER, 'total-nonsense')
        .expect(200);
    });
  });
});
