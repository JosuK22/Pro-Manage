const request = require('supertest');
const bcrypt = require('bcrypt');

const app = require('../app');
const User = require('../model/userModel');
const { createUser, createTask } = require('./factories');

const VALID_USER = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  password: 'correct-horse-battery',
  confirmPassword: 'correct-horse-battery',
};

describe('Stage 1 — critical production defects', () => {
  describe('registration never leaks credential material', () => {
    it('returns only public user fields plus a token', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send(VALID_USER)
        .expect(201);

      expect(res.body.status).toBe('success');
      expect(res.body.data.info).toEqual({
        _id: expect.any(String),
        name: VALID_USER.name,
        email: VALID_USER.email,
      });
      expect(res.body.data.token).toEqual(expect.any(String));
    });

    it('never includes a password, hash or confirmPassword anywhere in the body', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send(VALID_USER)
        .expect(201);

      const serialised = JSON.stringify(res.body);

      expect(serialised).not.toContain(VALID_USER.password);
      expect(serialised).not.toContain('password');
      expect(serialised).not.toMatch(/\$2[aby]\$/); // bcrypt hash prefix
    });

    it('stores the password hashed, not in plaintext', async () => {
      await request(app).post('/api/v1/auth/register').send(VALID_USER).expect(201);

      const stored = await User.findOne({ email: VALID_USER.email }).select(
        '+password +confirmPassword'
      );

      expect(stored.password).not.toBe(VALID_USER.password);
      expect(await bcrypt.compare(VALID_USER.password, stored.password)).toBe(true);
      // The confirmation is transport-only and must never be persisted.
      expect(stored.confirmPassword).toBeUndefined();
    });
  });

  describe('password hashing is idempotent across saves', () => {
    it('does not re-hash an unchanged password when another field is saved', async () => {
      await request(app).post('/api/v1/auth/register').send(VALID_USER).expect(201);

      const user = await User.findOne({ email: VALID_USER.email }).select('+password');
      const originalHash = user.password;

      user.name = 'Ada L.';
      await user.save();

      const reloaded = await User.findOne({ email: VALID_USER.email }).select('+password');

      expect(reloaded.password).toBe(originalHash);
      // The credentials still work — the regression this guards against
      // silently locked users out after any profile save.
      expect(await bcrypt.compare(VALID_USER.password, reloaded.password)).toBe(true);
    });
  });

  describe('the global error handler cannot itself crash', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it('returns clean JSON for a malformed ObjectId instead of a 500', async () => {
      const res = await request(app).get('/api/v1/tasks/not-an-object-id').expect(400);

      expect(res.body.status).toBe('fail');
      expect(res.body.message).toEqual(expect.any(String));
    });

    it('survives NODE_ENV being undefined', async () => {
      delete process.env.NODE_ENV;

      const res = await request(app).get('/api/v1/tasks/not-an-object-id').expect(400);

      expect(res.body.message).toEqual(expect.any(String));
    });

    it('hides stack traces in production but keeps them in development', async () => {
      process.env.NODE_ENV = 'production';
      const prod = await request(app).get('/api/v1/tasks/not-an-object-id').expect(400);
      expect(prod.body.stack).toBeUndefined();

      process.env.NODE_ENV = 'development';
      const dev = await request(app).get('/api/v1/tasks/not-an-object-id').expect(400);
      expect(dev.body.stack).toEqual(expect.any(String));
    });

    it('returns a 404 envelope for unknown routes', async () => {
      const res = await request(app).get('/api/v1/does-not-exist').expect(404);

      expect(res.body.status).toBe('fail');
    });
  });

  describe('login', () => {
    beforeEach(async () => {
      await request(app).post('/api/v1/auth/register').send(VALID_USER).expect(201);
    });

    it('issues a token for correct credentials without leaking the hash', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: VALID_USER.email, password: VALID_USER.password })
        .expect(200);

      expect(res.body.data.token).toEqual(expect.any(String));
      expect(JSON.stringify(res.body)).not.toMatch(/\$2[aby]\$/);
    });

    it('rejects a wrong password with 401', async () => {
      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: VALID_USER.email, password: 'wrong-password' })
        .expect(401);
    });

    it('gives the same answer for an unknown email as for a wrong password', async () => {
      const unknown = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@example.com', password: 'whatever-password' });

      const wrongPassword = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: VALID_USER.email, password: 'whatever-password' });

      // Divergent responses here would let an attacker enumerate accounts.
      expect(unknown.status).toBe(wrongPassword.status);
      expect(unknown.body.message).toBe(wrongPassword.body.message);
    });
  });

  // These use the shared factories: what is under test is the *public
  // projection*, not registration, so the setup should not be spelled out.
  describe('public task view', () => {
    it('renders an unassigned task as assignee: null rather than crashing', async () => {
      const owner = await createUser();

      const created = await createTask(owner, {
        title: 'Task with nobody assigned',
      }).expect(201);

      const res = await request(app)
        .get(`/api/v1/tasks/${created.body.data.task._id}`)
        .expect(200);

      expect(res.body.data.task.assignee).toBeNull();
    });

    it('does not expose ownership fields to anonymous viewers', async () => {
      const owner = await createUser();

      const created = await createTask(owner, {
        title: 'Shared task',
        priority: 'high',
      }).expect(201);

      const res = await request(app)
        .get(`/api/v1/tasks/${created.body.data.task._id}`)
        .expect(200);

      expect(res.body.data.task.createdBy).toBeUndefined();
      expect(res.body.data.task.assignedTo).toBeUndefined();
    });

    it('returns 404 for a well-formed id that does not exist', async () => {
      await request(app)
        .get('/api/v1/tasks/507f1f77bcf86cd799439011')
        .expect(404);
    });
  });
});
