// Dummy User model for offline mode compatibility
// This file prevents import errors but actual database operations use SQLite

const User = {
  // Dummy methods to prevent errors
  findById: () => null,
  findOne: () => null,
  find: () => [],
  create: () => null,
  updateOne: () => null,
  deleteOne: () => null
};

module.exports = User; 