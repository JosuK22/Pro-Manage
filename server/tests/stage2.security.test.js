const request = require('supertest');
const jwt = require('jsonwebtoken');

const app = require('../app');
const Task = require('../model/taskModel');

const registerUser = async (overrides = {}) => {
  const payload = {
    name: 'Test User',
    email: 'user@example.com',
    password: 'a-good-long-password',
    confirmPassword: 'a-good-long-password',
    ...overrides,
  };

  const res = await request(app).post('/api/v1/auth/register').send(payload).expect(201);

  return { token: res.body.data.token, user: res.body.data.info };
};

const createTask = (token, overrides = {}) =>
  request(app)
    .post('/api/v1/tasks')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: 'A task',
      priority: 'low',
      checklists: [{ title: 'step', checked: false }],
      ...overrides,
    });

describe('Stage 2 — security hardening', () => {
  describe('security headers', () => {
    it('sets Helmet headers and hides the Express fingerprint', async () => {
      const res = await request(app).get('/api/v1/health').expect(200);

      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-dns-prefetch-control']).toBeDefined();
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('CORS allowlist', () => {
    it('allows the configured client origin', async () => {
      const res = await request(app)
        .get('/api/v1/health')
        .set('Origin', 'http://localhost:5173')
        .expect(200);

      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    });

    it('refuses an origin that is not on the allowlist', async () => {
      const res = await request(app)
        .get('/api/v1/health')
        .set('Origin', 'https://evil.example.com');

      // Either the request is rejected, or — at minimum — the browser is never
      // told it may read the response.
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('authentication', () => {
    it('rejects a missing token', async () => {
      await request(app).get('/api/v1/tasks').expect(401);
    });

    it('rejects a malformed token', async () => {
      await request(app)
        .get('/api/v1/tasks')
        .set('Authorization', 'Bearer not-a-jwt')
        .expect(401);
    });

    it('rejects a token signed with the wrong secret', async () => {
      const forged = jwt.sign({ id: '507f1f77bcf86cd799439011' }, 'the-wrong-secret');

      await request(app)
        .get('/api/v1/tasks')
        .set('Authorization', `Bearer ${forged}`)
        .expect(401);
    });

    it('rejects an expired token', async () => {
      const { user } = await registerUser();
      const expired = jwt.sign({ id: user._id }, process.env.JWT_SECRET_KEY, {
        expiresIn: '-1s',
      });

      const res = await request(app)
        .get('/api/v1/tasks')
        .set('Authorization', `Bearer ${expired}`)
        .expect(401);

      expect(res.body.message).toMatch(/expired/i);
    });

    it('rejects an Authorization header without the Bearer scheme', async () => {
      const { token } = await registerUser();

      await request(app).get('/api/v1/tasks').set('Authorization', token).expect(401);
    });
  });

  describe('password policy', () => {
    it('rejects a password shorter than 8 characters', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Shorty',
          email: 'short@example.com',
          password: 'abc123',
          confirmPassword: 'abc123',
        })
        .expect(400);

      expect(res.body.errors.password).toMatch(/8 characters/);
    });

    it('rejects mismatched confirmation', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Mismatch',
          email: 'mismatch@example.com',
          password: 'a-good-long-password',
          confirmPassword: 'a-different-password',
        })
        .expect(400);

      expect(res.body.errors.confirmPassword).toBeDefined();
    });
  });

  describe('NoSQL injection', () => {
    it('does not let an operator object stand in for an email', async () => {
      await registerUser();

      // Without sanitisation this is `find({ email: { $gt: '' } })`, which
      // matches the first user in the collection and logs the attacker in.
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: { $gt: '' }, password: { $gt: '' } });

      expect(res.status).toBe(401);
      expect(res.body.data).toBeUndefined();
    });
  });

  describe('mass assignment', () => {
    it('ignores client-supplied createdBy on create', async () => {
      const victim = await registerUser({ email: 'victim@example.com' });
      const attacker = await registerUser({ email: 'attacker@example.com' });

      const res = await createTask(attacker.token, {
        createdBy: victim.user._id,
        shared: true,
      }).expect(201);

      const stored = await Task.findById(res.body.data.task._id);

      expect(String(stored.createdBy)).toBe(String(attacker.user._id));
      expect(String(stored.createdBy)).not.toBe(String(victim.user._id));
    });

    it('ignores client-supplied shared / assignedTo on update', async () => {
      const owner = await registerUser({ email: 'owner@example.com' });
      const other = await registerUser({ email: 'other@example.com' });

      const created = await createTask(owner.token).expect(201);

      await request(app)
        .patch(`/api/v1/tasks/${created.body.data.task._id}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ title: 'Renamed', assignedTo: other.user._id, shared: true })
        .expect(200);

      const stored = await Task.findById(created.body.data.task._id);

      expect(stored.title).toBe('Renamed');
      expect(stored.assignedTo).toBeFalsy();
      expect(stored.shared).toBe(false);
    });

    it('ignores an attempt to change a task id', async () => {
      const { token } = await registerUser();
      const created = await createTask(token).expect(201);
      const originalId = created.body.data.task._id;

      await request(app)
        .patch(`/api/v1/tasks/${originalId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ _id: '507f1f77bcf86cd799439011', title: 'Renamed' })
        .expect(200);

      expect(await Task.findById(originalId)).not.toBeNull();
    });
  });

  describe('ownership enforcement (IDOR)', () => {
    it('will not let one user read another user’s tasks on the board', async () => {
      const owner = await registerUser({ email: 'owner@example.com' });
      const attacker = await registerUser({ email: 'attacker@example.com' });

      await createTask(owner.token, { title: 'Private task' }).expect(201);

      const res = await request(app)
        .get('/api/v1/tasks')
        .set('Authorization', `Bearer ${attacker.token}`)
        .expect(200);

      expect(res.body.data.tasks).toHaveLength(0);
    });

    it('will not let one user update another user’s task', async () => {
      const owner = await registerUser({ email: 'owner@example.com' });
      const attacker = await registerUser({ email: 'attacker@example.com' });

      const created = await createTask(owner.token).expect(201);

      await request(app)
        .patch(`/api/v1/tasks/${created.body.data.task._id}`)
        .set('Authorization', `Bearer ${attacker.token}`)
        .send({ title: 'Hijacked' })
        .expect(404);

      const stored = await Task.findById(created.body.data.task._id);
      expect(stored.title).not.toBe('Hijacked');
    });

    it('will not let one user delete another user’s task', async () => {
      const owner = await registerUser({ email: 'owner@example.com' });
      const attacker = await registerUser({ email: 'attacker@example.com' });

      const created = await createTask(owner.token).expect(201);

      await request(app)
        .delete(`/api/v1/tasks/${created.body.data.task._id}`)
        .set('Authorization', `Bearer ${attacker.token}`)
        .expect(404);

      expect(await Task.findById(created.body.data.task._id)).not.toBeNull();
    });
  });

  describe('input validation', () => {
    it('rejects an unknown priority', async () => {
      const { token } = await registerUser();

      const res = await createTask(token, { priority: 'catastrophic' }).expect(400);

      expect(res.body.errors.priority).toBeDefined();
    });

    it('rejects an unknown status', async () => {
      const { token } = await registerUser();

      await createTask(token, { status: 'almost-done' }).expect(400);
    });

    it('rejects an empty checklist', async () => {
      const { token } = await registerUser();

      await createTask(token, { checklists: [] }).expect(400);
    });

    it('rejects an unparseable due date', async () => {
      const { token } = await registerUser();

      await createTask(token, { dueDate: 'next thursday-ish' }).expect(400);
    });

    it('rejects an invalid range query value', async () => {
      const { token } = await registerUser();

      await request(app)
        .get('/api/v1/tasks?range=99999')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('rejects a malformed id on every route that takes one', async () => {
      const { token } = await registerUser();

      await request(app)
        .patch('/api/v1/tasks/not-an-id')
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'x' })
        .expect(400);

      await request(app)
        .delete('/api/v1/tasks/not-an-id')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);

      await request(app)
        .get('/api/v1/assignees/not-an-id')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });
  });

  describe('request body limits', () => {
    it('rejects an oversized body instead of buffering it', async () => {
      const { token } = await registerUser();

      const res = await createTask(token, { title: 'x'.repeat(200 * 1024) });

      expect([400, 413]).toContain(res.status);
    });
  });

  describe('rate limiting', () => {
    beforeEach(() => {
      process.env.DISABLE_RATE_LIMIT = 'false';
    });

    afterEach(() => {
      process.env.DISABLE_RATE_LIMIT = 'true';
    });

    it('returns a clean 429 after repeated failed logins', async () => {
      const attempts = [];
      for (let i = 0; i < 12; i += 1) {
        attempts.push(
          await request(app)
            .post('/api/v1/auth/login')
            .send({ email: 'nobody@example.com', password: 'wrong-password-here' })
        );
      }

      const limited = attempts.filter((res) => res.status === 429);

      expect(limited.length).toBeGreaterThan(0);
      expect(limited[0].body.status).toBe('fail');
      expect(limited[0].body.message).toMatch(/too many/i);
    });
  });
});
