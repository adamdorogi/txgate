import { Knex } from 'knex';

export async function up(db: Knex): Promise<void> {
  await db.schema.createTable('session', (table) => {
    table.string('sid').primary();
    table.json('sess').notNullable();
    table.timestamp('expire', { useTz: false, precision: 6 }).notNullable().index();
  });
}

export async function down(db: Knex): Promise<void> {
  await db.schema.dropTable('session');
}
