const request = require('supertest');

const app = require('../app');
const Task = require('../model/taskModel');

// Shared fixtures — see tests/factories.js. Previously duplicated verbatim
// between this suite and stage2.security.test.js.
const { createUser: registerUser, createTask } = require('./factories');

/** Move a task's createdAt into the past, bypassing the immutable guard. */
const backdate = (taskId, days) =>
  Task.collection.updateOne(
    { _id: new (require('mongoose').Types.ObjectId)(String(taskId)) },
    { $set: { createdAt: new Date(Date.now() - days * 24 * 60 * 60 * 1000) } }
  );

describe('Stage 3 — data model and API', () => {
  describe('derived assignment fields', () => {
    it('resolves assignedTo when the assignee is a registered user', async () => {
      const owner = await registerUser({ email: 'owner@example.com' });
      const mate = await registerUser({ email: 'mate@example.com' });

      const res = await createTask(owner.token, { assignee: 'mate@example.com' }).expect(201);

      const stored = await Task.findById(res.body.data.task._id);
      expect(String(stored.assignedTo)).toBe(String(mate.user._id));
      expect(stored.shared).toBe(true);
    });

    it('keeps the email but leaves assignedTo null for an unregistered assignee', async () => {
      const owner = await registerUser({ email: 'owner@example.com' });

      const res = await createTask(owner.token, {
        assignee: 'not-registered@example.com',
      }).expect(201);

      const stored = await Task.findById(res.body.data.task._id);
      expect(stored.assignee).toBe('not-registered@example.com');
      expect(stored.assignedTo).toBeNull();
      expect(stored.shared).toBe(false);
    });

    it('clears assignedTo when the assignee is removed', async () => {
      const owner = await registerUser({ email: 'owner@example.com' });
      await registerUser({ email: 'mate@example.com' });

      const created = await createTask(owner.token, {
        assignee: 'mate@example.com',
      }).expect(201);

      await request(app)
        .patch(`/api/v1/tasks/${created.body.data.task._id}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ assignee: null })
        .expect(200);

      const stored = await Task.findById(created.body.data.task._id);
      expect(stored.assignedTo).toBeNull();
      expect(stored.shared).toBe(false);
    });

    it('makes an assigned task visible on the assignee’s board', async () => {
      const owner = await registerUser({ email: 'owner@example.com' });
      const mate = await registerUser({ email: 'mate@example.com' });

      await createTask(owner.token, {
        title: 'Shared work',
        assignee: 'mate@example.com',
      }).expect(201);

      const res = await request(app)
        .get('/api/v1/tasks')
        .set('Authorization', `Bearer ${mate.token}`)
        .expect(200);

      expect(res.body.data.tasks).toHaveLength(1);
      expect(res.body.data.tasks[0].title).toBe('Shared work');
    });
  });

  describe('server-owned timestamps', () => {
    it('ignores a client-supplied createdAt', async () => {
      const { token } = await registerUser();
      const backdated = new Date('2001-01-01').toISOString();

      const res = await createTask(token, { createdAt: backdated }).expect(201);

      expect(new Date(res.body.data.task.createdAt).getFullYear()).toBe(
        new Date().getFullYear()
      );
    });

    it('stamps completedAt when a task reaches done, and clears it when reopened', async () => {
      const { token } = await registerUser();
      const created = await createTask(token).expect(201);
      const id = created.body.data.task._id;

      await request(app)
        .patch(`/api/v1/tasks/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'done' })
        .expect(200);

      expect((await Task.findById(id)).completedAt).toBeInstanceOf(Date);

      await request(app)
        .patch(`/api/v1/tasks/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'todo' })
        .expect(200);

      expect((await Task.findById(id)).completedAt).toBeNull();
    });
  });

  describe('date range never hides unfinished work', () => {
    it('keeps an old, still-open task visible under the "today" filter', async () => {
      const { token } = await registerUser();

      const created = await createTask(token, { title: 'Old but unfinished' }).expect(201);
      await backdate(created.body.data.task._id, 60);

      const res = await request(app)
        .get('/api/v1/tasks?range=today')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const titles = res.body.data.tasks.map((task) => task.title);
      expect(titles).toContain('Old but unfinished');
    });

    it('does filter out work completed outside the range', async () => {
      const { token } = await registerUser();

      const created = await createTask(token, { title: 'Finished long ago' }).expect(201);
      const id = created.body.data.task._id;

      await request(app)
        .patch(`/api/v1/tasks/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'done' })
        .expect(200);

      // Push the completion date well outside the "today" window.
      await Task.collection.updateOne(
        { _id: new (require('mongoose').Types.ObjectId)(String(id)) },
        { $set: { completedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) } }
      );

      const res = await request(app)
        .get('/api/v1/tasks?range=today')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.data.tasks.map((t) => t.title)).not.toContain('Finished long ago');
    });

    it('range=all returns everything', async () => {
      const { token } = await registerUser();
      const created = await createTask(token, { title: 'Ancient' }).expect(201);
      await backdate(created.body.data.task._id, 400);

      const res = await request(app)
        .get('/api/v1/tasks?range=all')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.data.tasks.map((t) => t.title)).toContain('Ancient');
    });
  });

  describe('pagination', () => {
    it('caps and reports the page window', async () => {
      const { token } = await registerUser();

      for (let i = 0; i < 5; i += 1) {
        await createTask(token, { title: `Task ${i}` }).expect(201);
      }

      const res = await request(app)
        .get('/api/v1/tasks?limit=2&page=1')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.data.tasks).toHaveLength(2);
      expect(res.body.data.pagination).toMatchObject({
        page: 1,
        limit: 2,
        total: 5,
        hasMore: true,
      });
    });
  });

  describe('analytics', () => {
    it('counts a self-assigned task exactly once', async () => {
      const { token, user } = await registerUser({ email: 'solo@example.com' });

      // Assigning a task to yourself matches both createdBy and assignedTo —
      // the old two-query implementation counted it twice.
      await createTask(token, { assignee: user.email, priority: 'high' }).expect(201);

      const res = await request(app)
        .get('/api/v1/tasks/analytics')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.data.total).toBe(1);
      expect(res.body.data.status.todo).toBe(1);
      expect(res.body.data.priorities.high).toBe(1);
    });

    it('does not count a completed task as overdue', async () => {
      const { token } = await registerUser();

      const created = await createTask(token, {
        dueDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      }).expect(201);

      const beforeDone = await request(app)
        .get('/api/v1/tasks/analytics')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(beforeDone.body.data.priorities.due).toBe(1);

      await request(app)
        .patch(`/api/v1/tasks/${created.body.data.task._id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'done' })
        .expect(200);

      const afterDone = await request(app)
        .get('/api/v1/tasks/analytics')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(afterDone.body.data.priorities.due).toBe(0);
    });

    it('returns a full zeroed shape for a user with no tasks', async () => {
      const { token } = await registerUser();

      const res = await request(app)
        .get('/api/v1/tasks/analytics')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.data).toEqual({
        status: { backlog: 0, todo: 0, inProgress: 0, done: 0 },
        priorities: { low: 0, moderate: 0, high: 0, due: 0 },
        total: 0,
      });
    });
  });

  describe('assignees', () => {
    it('rejects the same member twice on one board', async () => {
      const { token } = await registerUser();

      await request(app)
        .post('/api/v1/assignees')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'mate@example.com' })
        .expect(201);

      await request(app)
        .post('/api/v1/assignees')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'mate@example.com' })
        .expect(409);
    });

    it('allows the same email on two different boards', async () => {
      const first = await registerUser({ email: 'first@example.com' });
      const second = await registerUser({ email: 'second@example.com' });

      await request(app)
        .post('/api/v1/assignees')
        .set('Authorization', `Bearer ${first.token}`)
        .send({ email: 'shared@example.com' })
        .expect(201);

      await request(app)
        .post('/api/v1/assignees')
        .set('Authorization', `Bearer ${second.token}`)
        .send({ email: 'shared@example.com' })
        .expect(201);
    });

    it('scopes the assignee list to the requesting user', async () => {
      const first = await registerUser({ email: 'first@example.com' });
      const second = await registerUser({ email: 'second@example.com' });

      await request(app)
        .post('/api/v1/assignees')
        .set('Authorization', `Bearer ${first.token}`)
        .send({ email: 'only-mine@example.com' })
        .expect(201);

      const res = await request(app)
        .get('/api/v1/assignees')
        .set('Authorization', `Bearer ${second.token}`)
        .expect(200);

      expect(res.body.data.assignees).toHaveLength(0);
    });
  });
});
