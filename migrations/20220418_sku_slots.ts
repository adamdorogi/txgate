import { Knex } from 'knex';

export async function up(db: Knex): Promise<void> {
  await db.schema.createTable('sku_slots', (table) => {
    table.text('sku').primary();
    table.integer('max_supply').notNullable();
    table.integer('reserved_count').notNullable().defaultTo(0);
  });
  await db.raw('ALTER TABLE sku_slots ADD CHECK (reserved_count >= 0 AND reserved_count <= max_supply)');
  await db.schema.alterTable('invoices', (table) => {
    table.text('sku').references('sku_slots.sku');
    table.boolean('reserved').notNullable().defaultTo(false);
  });
}

export async function down(db: Knex): Promise<void> {
  await db.schema.alterTable('invoices', (table) => {
    table.dropColumn('sku');
    table.dropColumn('reserved');
  });
  await db.schema.dropTable('sku_slots');
}
