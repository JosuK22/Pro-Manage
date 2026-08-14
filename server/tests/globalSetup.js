const { MongoMemoryServer } = require('mongodb-memory-server');

/**
 * Boot one in-memory MongoDB for the whole test run.
 *
 * Tests must never touch a real cluster: they create, mutate and delete users
 * and tasks freely, and they assert on exact collection contents.
 */
module.exports = async () => {
  const instance = await MongoMemoryServer.create();

  global.__MONGO_INSTANCE__ = instance;
  process.env.MONGO_URI_TEST = instance.getUri();
};
