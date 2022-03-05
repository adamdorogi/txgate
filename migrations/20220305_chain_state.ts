import { Knex } from 'knex';

export async function up(db: Knex): Promise<void> {
  await db.schema.createTable('chain_state', (table) => {
    table.text('chain').primary();
    table.bigInteger('height');
    table.text('hash');
    table.timestamp('block_time', { useTz: true });
    table.bigInteger('scan_start');
  });
}

export async function down(db: Knex): Promise<void> {
  await db.schema.dropTable('chain_state');
}
