import { Knex } from 'knex';

export async function up(db: Knex): Promise<void> {
  await db.schema.createTable('chain_tips', (table) => {
    table.text('chain').notNullable().references('chain_state.chain');
    table.bigInteger('block_no').notNullable();
    table.text('block_hash').notNullable();
    table.text('prev_hash');
    table.timestamp('block_time', { useTz: true }).notNullable();
    table.primary(['chain', 'block_no']);
  });
}

export async function down(db: Knex): Promise<void> {
  await db.schema.dropTable('chain_tips');
}
