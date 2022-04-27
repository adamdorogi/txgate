import { Knex } from 'knex';

export async function up(db: Knex): Promise<void> {
  await db.schema.createTable('webhook_deliveries', (table) => {
    table.uuid('id').primary();
    table.uuid('invoice_id').notNullable().references('invoices.id');
    table.text('event').notNullable();
    table.jsonb('payload').notNullable();
    table.integer('attempts').notNullable().defaultTo(0);
    table.timestamp('next_attempt_at', { useTz: true }).notNullable().defaultTo(db.fn.now());
    table.timestamp('delivered_at', { useTz: true });
    table.uuid('lease_token');
    table.timestamp('leased_until', { useTz: true });
    table.text('last_error');
    table.index(['invoice_id', 'next_attempt_at']);
  });
  await db.raw('CREATE INDEX webhook_pending ON webhook_deliveries (next_attempt_at) WHERE delivered_at IS NULL');
}

export async function down(db: Knex): Promise<void> {
  await db.schema.dropTable('webhook_deliveries');
}
