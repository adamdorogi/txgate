import { connect } from '../src/db/connection';
import { runCardano } from './sim-cardano';

async function main() {
  const [command, chain, ...args] = process.argv.slice(2);
  if (!command || chain !== 'cardano') {
    throw new Error('usage: npm run sim:payment -- <payment|mine|rollback> cardano [args]');
  }
  const db = connect(process.env.DATABASE_URL || 'postgres://txgate:txgate@127.0.0.1:5432/txgate');
  const source = connect(
    process.env.SIM_DB_SYNC_DATABASE_URL || 'postgres://txgate:txgate@127.0.0.1:5433/db_sync'
  );
  try {
    const result = await runCardano(command, args, db, source);
    console.log(JSON.stringify(result));
  } finally {
    await Promise.all([db.destroy(), source.destroy()]);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
