module.exports = async () => {
  if (global.__MONGO_INSTANCE__) {
    await global.__MONGO_INSTANCE__.stop();
  }
};
