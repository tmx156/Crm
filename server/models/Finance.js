// Dummy Finance model for offline mode compatibility
// This file prevents import errors but actual database operations use SQLite

const Finance = {
  // Dummy methods to prevent errors
  findById: () => null,
  findOne: () => null,
  find: () => [],
  create: () => null,
  updateOne: () => null,
  deleteOne: () => null
};

module.exports = Finance; 