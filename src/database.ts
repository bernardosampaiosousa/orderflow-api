import mysql, { type Pool } from 'mysql2/promise';
import type { AppConfig } from './config.js';

export function createDatabase(config: AppConfig): Pool {
  return mysql.createPool({
    host: config.DB_HOST,
    port: config.DB_PORT,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    database: config.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    decimalNumbers: false,
    timezone: 'Z',
  });
}
