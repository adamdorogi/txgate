import knex, { Knex } from 'knex';

export function connect(connection: string, readonly = false): Knex {
  const url = new URL(connection);
  if (readonly) {
    const options = [url.searchParams.get('options'), '-c default_transaction_read_only=on'].filter(Boolean);
    url.searchParams.set('options', options.join(' '));
  }
  return knex({
    client: 'pg',
    connection: url.toString(),
    pool: { min: 0, max: 8 },
    acquireConnectionTimeout: 10000
  });
}
