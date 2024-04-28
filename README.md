# txgate

Self-hosted, non-custodial payment daemon for Cardano (ADA and native tokens
via cardano-db-sync) and EVM (native transfers and ERC-20 via CREATE2).
Invoices use watch-only addresses. Settlement exports unsigned CBOR or
calldata for offline signing. The server holds no wallet signing keys.

## invoice lifecycle

NEW -> DETECTED -> CONFIRMING -> SETTLED
UNDERPAID shows the remaining balance. OVERPAID records the excess.
EXPIRED means no funds. LATE_PAYMENT means the balance arrived after expiry.
A block hash or parent mismatch rewinds orphaned transfers and records
REORGED. Totals, confirmations and webhook entries commit together.

## local dev (simulated chains)

```sh
docker compose up -d
npm install
cp .env.example .env
set -a; . ./.env; set +a
npm run migrate
npm run dev
```

The console is at /admin. Use the password in .env and create an invoice.
The dev db-sync database starts empty. Payments add ADA alongside any native
asset you configure. Amount arguments are optional and use minor units.

```sh
npm run sim:payment -- payment cardano "$INVOICE_ID" 125000000
npm run sim:payment -- mine cardano 1
npm run sim:payment -- rollback cardano 2
npx hardhat compile
npm run sim:payment -- init evm
```

Copy the printed EVM settings into .env, as KEY=value lines. Keep EVM_TOKENS
as quoted JSON. Restart txgate, then create a local ETH or USDC invoice.
The EVM simulator supports payment, mine, snapshot and revert <snapshot-id>.

## api quick ref

```sh
curl -fsS http://localhost:3000/v1/invoices \
  -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
  -d '{"chain":"cardano","assetId":"ADA","amount":"125000000","ttlSeconds":900}'
curl -fsS http://localhost:3000/v1/invoices \
  -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
  -d "{\"chain\":\"local\",\"assetId\":\"$USDC_ADDRESS\",\"amount\":\"50000000\"}"
```

Verify X-Txgate-Signature against the raw HTTP body. Deduplicate by event id.
```js
const {createHmac, timingSafeEqual} = require('node:crypto')
const m = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(signature)
const now = Math.floor(Date.now() / 1000)
const valid = m && Math.abs(now - Number(m[1])) <= 300 &&
  timingSafeEqual(Buffer.from(m[2], 'hex'),
    createHmac('sha256', secret).update(m[1] + '.').update(rawBody).digest())
```

## settings

| name | value |
| --- | --- |
| DATABASE_URL | App Postgres URL. Prod Compose uses TXGATE_DATABASE_URL. |
| DB_SYNC_DATABASE_URL | Read-only db-sync URL. Omit for EVM-only use. |
| CARDANO_ACCOUNT_XPUB | CIP-1852 Bech32 acct_xpub or 64-byte hex. |
| CARDANO_STAKE_KEY_HASH | Optional 28-byte stake key hash. |
| CARDANO_NETWORK_ID | 0 testnet, 1 mainnet. |
| CARDANO_ASSETS | JSON [{id,symbol,decimals}], id is policy.hexname. |
| EVM_RPC_URL | Single chain RPC. Set EVM_CHAIN and factory, treasury and init hash. |
| EVM_NETWORKS | JSON array for multiple RPCs. See .env.example. |
| EVM_TOKENS | JSON [{id,symbol,decimals}], id is the ERC-20 address. |
| API_KEY, ADMIN_PASSWORD, SESSION_SECRET | Set independent secrets. |
| WEBHOOK_URL, WEBHOOK_SECRET | Configure together to enable delivery. |
| SKU_SUPPLY | JSON SKU to maximum supply. Expired empty slots release after the chain passes expiry. |

## running in prod

- Use a read-only role and ordinary tx_out layout in db-sync. Check the index on tx_out(address).
- Set CARDANO_START_BLOCK and EVM_START_BLOCK when backfilling. The default starts near the indexed tip.
- Deploy each factory with npx hardhat run scripts/deploy-factory.ts --network base.
  Copy EVM_SWEEP_FACTORY_ADDRESS, EVM_TREASURY_ADDRESS and EVM_INIT_CODE_HASH into the config.
- Use a sticky RPC, EVM_LOG_CHUNK_SIZE=1000, and chain-specific confirmation targets.
  Native EVM payments must be direct transactions. Polygon's native asset is MATIC.
- Run Node 20. Set fresh secrets, SECURE_COOKIES=true, POSTGRES_PASSWORD and TXGATE_DATABASE_URL.
  Run docker compose -f docker-compose.prod.yml up -d --build behind a TLS proxy.
- Keep address derivation settings stable while invoices are live. Check protocol parameters before exporting Cardano batches.
- Inspect exports before signing with cardano-cli, Safe or Ledger. EVM refunds use the original sender. Verify the Cardano refund address independently.
