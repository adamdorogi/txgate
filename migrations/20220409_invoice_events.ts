import { Knex } from 'knex';

export async function up(db: Knex): Promise<void> {
  await db.schema.createTable('invoice_events', (table) => {
    table.bigIncrements('id');
    table.uuid('invoice_id').notNullable().references('invoices.id');
    table.text('status').notNullable();
    table.integer('confirmations').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(db.fn.now());
    table.index(['invoice_id', 'id']);
  });
  await db.schema.createTable('chain_reorgs', (table) => {
    table.bigIncrements('id');
    table.text('chain').notNullable().references('chain_state.chain');
    table.bigInteger('from_block').notNullable();
    table.bigInteger('to_block').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(db.fn.now());
    table.index(['chain', 'id']);
  });
}

export async function down(db: Knex): Promise<void> {
  await db.schema.dropTable('chain_reorgs');
  await db.schema.dropTable('invoice_events');
}
