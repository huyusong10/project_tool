import { initializeDatabase } from '../../src/server/database';

// Compatibility fixture for tests that configure their isolated paths before importing.
// Importing production services no longer opens or migrates a database.
export const context = await initializeDatabase();
export const { sqlite, db } = context;
