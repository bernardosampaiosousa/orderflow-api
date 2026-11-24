import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';
import { loadConfig } from '../src/config.js';

const cfg = loadConfig();
const connection = await mysql.createConnection({
  host: cfg.DB_HOST, port: cfg.DB_PORT, user: cfg.DB_USER,
  password: cfg.DB_PASSWORD, database: cfg.DB_NAME,
  multipleStatements: true, // Used only to run a trusted local migration file.
});
try {
  const schema = await readFile(new URL('../database/001_init.sql', import.meta.url), 'utf8');
  await connection.query(schema);
  console.log('Database schema ready');
} finally {
  await connection.end();
}
