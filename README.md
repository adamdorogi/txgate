# txgate

Self-hosted Cardano payment daemon. Watches ADA and native tokens through
cardano-db-sync. Invoices derive deposit addresses from an account xpub.
Export unsigned CBOR to sweep the funds with an offline wallet.

## invoice lifecycle

NEW -> DETECTED -> CONFIRMING -> SETTLED
UNDERPAID shows the remainder. OVERPAID records the extra amount.
EXPIRED means no funds arrived. LATE_PAYMENT needs a merchant refund.
The watcher checks recent block hashes on each poll. A rollback marks orphaned
transfers, recalculates totals and queues an invoice.reorged webhook.

## local dev

```sh
docker compose up -d
npm install
cp .env.example .env
set -a; . ./.env; set +a
npm run migrate
npm run dev
```

Open /admin and sign in with ADMIN_PASSWORD. Create a test invoice, then use
its id below. The checkout link is /pay/<invoice-id>.

The dev db-sync schema starts empty. A payment command adds one block and
one output. Native asset payments include ADA for the output.

```sh
npm run sim:payment -- payment cardano "$INVOICE_ID" 125000000
npm run sim:payment -- mine cardano 1
npm run sim:payment -- rollback cardano 2
```

## api quick ref

Amounts are integer strings in minor units. For ADA, 125 ADA is 125000000.

```sh
curl -fsS http://localhost:3000/v1/invoices \
  -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
  -d '{"chain":"cardano","assetId":"ADA","amount":"125000000","ttlSeconds":900}'
curl -fsS "http://localhost:3000/v1/invoices/$INVOICE_ID" \
  -H "Authorization: Bearer $API_KEY"
```

Verify X-Txgate-Signature against the raw body. Deduplicate by event id.

```js
const {createHmac, timingSafeEqual} = require('crypto')
const m = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(signature)
const now = Math.floor(Date.now() / 1000)
const valid = m && Math.abs(now - Number(m[1])) <= 300 &&
  timingSafeEqual(Buffer.from(m[2], 'hex'),
    createHmac('sha256', secret).update(m[1] + '.').update(rawBody).digest())
```

## settings

| name | value |
| --- | --- |
| DATABASE_URL | App Postgres URL. |
| DB_SYNC_DATABASE_URL | Separate read-only db-sync URL. |
| CARDANO_ACCOUNT_XPUB | CIP-1852 account xpub in Bech32 or 64-byte hex. |
| CARDANO_STAKE_KEY_HASH | Optional 28-byte stake key hash. |
| CARDANO_NETWORK_ID | 0 testnet, 1 mainnet. |
| CARDANO_ASSETS | JSON [{id,symbol,decimals}], id is policy.hexname. |
| CARDANO_CONFIRMATIONS | Target confirmation count. Default is 15. |
| API_KEY, ADMIN_PASSWORD, SESSION_SECRET | Separate secrets for API and console. |
| WEBHOOK_URL, WEBHOOK_SECRET | Set both to enable delivery. |
| SKU_SUPPLY | JSON map of SKU to maximum supply. |

## running in prod

- Use Node 16 and a read-only role for db-sync.
- Check the index on tx_out(address). Older db-sync setups can be slow here.
- Set fresh secrets, SECURE_COOKIES=true, POSTGRES_PASSWORD and TXGATE_DATABASE_URL.
- Run docker compose -f docker-compose.prod.yml up -d --build behind a TLS proxy.
- Keep the xpub and stake settings stable. Sign exports offline with cardano-cli.
- Check min-ADA and fee parameters before building a batch. Set the testnet magic
  for the target testnet when exporting signing instructions.
