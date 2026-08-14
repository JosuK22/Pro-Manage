const mongoose = require('mongoose');

// Deterministic auth config for the whole suite. Set before any module that
// reads these at require-time is loaded.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET_KEY = 'test-secret-key-that-is-sufficiently-long';
process.env.JWT_EXPIRES_IN = '1h';
process.env.CLIENT_URL = 'http://localhost:5173';
// Off by default so limits never leak between test cases; the rate-limit
// suite re-enables it explicitly for the cases that assert throttling.
process.env.DISABLE_RATE_LIMIT = 'true';

beforeAll(async () => {
  await mongoose.connect(process.env.MONGO_URI_TEST);
});

afterEach(async () => {
  // Wipe between tests so ordering never matters.
  const { collections } = mongoose.connection;
  await Promise.all(
    Object.values(collections).map((collection) => collection.deleteMany({}))
  );
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
});
