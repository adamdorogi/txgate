import { Knex } from 'knex';

export async function up(db: Knex): Promise<void> {
  await db.schema.createTable('invoices', (table) => {
    table.uuid('id').primary();
    table.text('chain').notNullable();
    table.text('asset_id').notNullable();
    table.text('asset_symbol').notNullable();
    table.smallint('decimals').notNullable();
    table.text('address').notNullable();
    table.specificType('amount', 'numeric').notNullable();
    table.specificType('paid', 'numeric').notNullable().defaultTo(0);
    table.text('status').notNullable().defaultTo('NEW');
    table.integer('confirmations').notNullable().defaultTo(0);
    table.integer('target_confirmations').notNullable();
    table.timestamp('expires_at', { useTz: true }).notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable();
    table.unique(['chain', 'address']);
    table.index(['chain', 'asset_id', 'status']);
  });
}

export async function down(db: Knex): Promise<void> {
  await db.schema.dropTable('invoices');
}
