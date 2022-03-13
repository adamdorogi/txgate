import { Knex } from 'knex';

export async function up(db: Knex): Promise<void> {
  await db.schema.createTable('observed_transfers', (table) => {
    table.uuid('invoice_id').notNullable().references('invoices.id');
    table.text('chain').notNullable();
    table.text('tx_id').notNullable();
    table.integer('output_index').notNullable();
    table.bigInteger('block_height').notNullable();
    table.text('block_hash').notNullable();
    table.timestamp('block_time', { useTz: true }).notNullable();
    table.specificType('amount', 'numeric').notNullable();
    table.jsonb('detail').notNullable().defaultTo('{}');
    table.boolean('orphaned').notNullable().defaultTo(false);
    table.primary(['invoice_id', 'tx_id', 'output_index', 'block_hash']);
    table.index(['chain', 'block_height', 'orphaned']);
    table.index(['invoice_id', 'orphaned', 'block_height']);
  });
}

export async function down(db: Knex): Promise<void> {
  await db.schema.dropTable('observed_transfers');
}
