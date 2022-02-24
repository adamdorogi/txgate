import { Knex } from 'knex';

export async function up(db: Knex): Promise<void> {
  await db.raw('CREATE SEQUENCE invoice_derivation_index AS integer MINVALUE 0 START WITH 0 NO CYCLE');
  await db.schema.alterTable('invoices', (table) => {
    table.integer('derivation_index')
      .notNullable().unique().defaultTo(db.raw("nextval('invoice_derivation_index')"));
  });
  await db.raw('ALTER SEQUENCE invoice_derivation_index OWNED BY invoices.derivation_index');
}

export async function down(db: Knex): Promise<void> {
  await db.schema.alterTable('invoices', (table) => table.dropColumn('derivation_index'));
}
