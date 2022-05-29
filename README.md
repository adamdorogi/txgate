# txgate

watch-only Cardano invoice watcher on top of cardano-db-sync.
use an account public key for receiving addresses.

## run

Node 16 and two Postgres databases. Use a read-only role on db-sync.
Set DATABASE_URL, DB_SYNC_DATABASE_URL and CARDANO_ACCOUNT_XPUB.

```sh
npm install
npm run migrate
npm run build
npm start -- invoice 125000000
npm start
```

CARDANO_NETWORK_ID defaults to 0. CARDANO_START_BLOCK sets the first block.
Set WEBHOOK_URL and WEBHOOK_SECRET together to deliver status changes.
Supply unsigned outputs to the signing machine. The daemon has no wallet key.

For an empty local db-sync database, load migrations/db-sync/001_schema.sql.
Use npm run sim:payment -- payment cardano <invoice-id> to credit an invoice.
