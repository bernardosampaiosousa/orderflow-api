import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required to run database migrations`);
  return value;
}

const connection = await mysql.createConnection({
  host: required('DB_HOST'),
  port: Number(process.env.DB_PORT ?? 3306),
  user: required('DB_USER'),
  password: required('DB_PASSWORD'),
  database: required('DB_NAME'),
  multipleStatements: true, // Trusted, checked-in SQL only.
});

try {
  const schema = await readFile(new URL('../database/001_init.sql', import.meta.url), 'utf8');
  await connection.query(schema);
  console.log('Database schema ready');
} finally {
  await connection.end();
}
