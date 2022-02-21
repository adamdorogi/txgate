import type { Knex } from 'knex';
import { extname, resolve } from 'path';

const config: Knex.Config = {
  client: 'pg',
  connection: process.env.DATABASE_URL || 'postgres://txgate:txgate@127.0.0.1:5432/txgate',
  migrations: { directory: resolve(__dirname, 'migrations'), loadExtensions: [extname(__filename)] }
};

export default config;
