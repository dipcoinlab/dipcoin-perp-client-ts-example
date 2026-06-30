# DipCoin Perp Client — Example project

This repository demonstrates how to use [`@dipcoinlab/perp-client-ts`](https://www.npmjs.com/package/@dipcoinlab/perp-client-ts) from Node.js: authentication, market data, order placement (opt-in), on-chain balances, Vault REST, `WebSocket`, etc.

## Requirements

- Node.js **18+** (**22+** recommended for the built-in `WebSocket`; older versions fall back to the bundled `ws` dependency)
- Yarn 1.x or npm

## Installation

```bash
cd dipcoin-perp-client-ts-example
yarn install
# or: npm install
```

By default this project resolves `@dipcoinlab/perp-client-ts` to the **sibling local package** `file:../dipcoin-perp-client-ts` (matching the monorepo layout). **Build the SDK first** before running the demo:

```bash
cd ../dipcoin-perp-client-ts && yarn install --ignore-engines && yarn build
cd ../dipcoin-perp-client-ts-example && yarn install --ignore-engines
```

If you only cloned this example repo without the SDK source, point the dependency back to the published version, e.g. `"@dipcoinlab/perp-client-ts": "^0.5.0"`, and make sure the published version exposes everything you need (Vault, `createWsClient`, extended market data, etc.).

> If Yarn refuses to install because of upstream `engines` constraints, this repository's `.yarnrc` already sets `ignore-engines true` (matching the SDK repo). Pin a Node version in production according to your team policy.

## Configuration

Copy the environment template and fill in the private key:

```bash
cp .env.example .env
# Edit .env and set at least PRIVATE_KEY
```

Optional:

- `API_BASE_URL`: override the default mainnet/testnet REST base URL
- `CUSTOM_RPC`: custom Sui gRPC endpoint (Sui has migrated off JSON-RPC; defaults to the SDK's per-network gRPC fullnode)

See `.env.example` and the table below for the full set of toggles.

> **Local source resolution:** `tsconfig.json` maps `@dipcoinlab/perp-client-ts`
> to the sibling SDK source (`../dipcoin-perp-client-ts/src/index.ts`) so SDK
> changes take effect via `tsx` / `tsc` without rebuilding `dist`. Remove the
> `paths` entry to validate the published package instead.

## Solana (CCTP) support

The SDK can sign for a **Solana** wallet. Because Solana wallets cannot pay Sui
gas, deposits bridge USDC through **Circle CCTP** and withdrawals are submitted
to the DipCoin **relayer**; trading/order payloads are signed with the Solana
Ed25519 key. Enable it via `CHAIN=solana`:

```bash
CHAIN=solana
SOLANA_PRIVATE_KEY=...        # base58 / hex / JSON byte array (Phantom export works)
# SOLANA_RPC_URL=...          # optional RPC override
RUN_SOLANA_DEPOSIT=0          # bridge USDC: Solana -> Sui Bank (CCTP)
SOLANA_DEPOSIT_AMOUNT=10
RUN_SOLANA_WITHDRAW=0         # withdraw: Sui Bank -> Solana wallet (relayer)
SOLANA_WITHDRAW_AMOUNT=5
```

With `CHAIN=solana` the demo prints balances (SOL + Solana USDC + Sui Bank),
runs the opt-in CCTP deposit / relayer withdraw, and reuses the same `RUN_*`
flags as the Sui flow:

- **Orders / cancel** (`RUN_MARKET_ORDER`, `RUN_LIMIT_ORDER`, `RUN_CANCEL_ORDER`) —
  payloads signed with the Solana key (`creator = "Solana:<base58>"`).
- **Margin** (`RUN_MARGIN_ADD`, `RUN_MARGIN_REMOVE`) — signed payload dispatched
  to the **relayer** (a Solana wallet cannot pay Sui gas / build a PTB).
- **TP/SL** (`RUN_TPSL_DEMO`, `RUN_TPSL_EDIT`) — order API, no relayer needed.
- **Vault** (`RUN_VAULT_REST`, `RUN_VAULT_DEPOSIT`, `RUN_VAULT_WITHDRAW`) —
  on-chain deposit & withdraw request go through the **relayer**.

Programmatic entry points:

```ts
const sdk = initDipCoinPerpSDK(SOLANA_PRIVATE_KEY, { chain: "solana", network: "testnet" });
await sdk.authenticate();
await sdk.depositToBankFromSolana({ amount: 10 });   // CCTP deposit
await sdk.withdrawFromBankToSolana({ amount: 5 });   // relayer withdraw
await sdk.addMargin({ symbol: "BTC-PERP", amount: 10 });          // relayer
await sdk.depositToVault({ vaultId, amount: "10" });             // relayer
```

## Run

```bash
yarn start
# or: yarn dev
```

The default run **authenticates**, prints the account / positions / open orders snapshot, and (when `RUN_MARKET_DATA=1`) pulls the order book and ticker. **High-risk actions** (deposit, withdraw, order placement, leverage adjustment, margin add/remove, TP/SL, etc.) are **disabled by default** in `.env` — opt in by flipping the relevant `RUN_*` flag.

Type-check the example (no JS emitted; requires the SDK's `dist/*.d.ts`):

```bash
yarn typecheck
```

## Environment variables (summary)

| Variable | Description | Default |
| --- | --- | --- |
| `PRIVATE_KEY` | Wallet private key (**required** for `CHAIN=sui`) | — |
| `CHAIN` | `sui` / `solana` | `sui` |
| `SOLANA_PRIVATE_KEY` | Solana key (required for `CHAIN=solana`; falls back to `PRIVATE_KEY`) | — |
| `SOLANA_RPC_URL` | Optional Solana RPC override | SDK default |
| `RUN_SOLANA_DEPOSIT` / `SOLANA_DEPOSIT_AMOUNT` | CCTP deposit Solana → Sui Bank | `0` / `10` |
| `RUN_SOLANA_WITHDRAW` / `SOLANA_WITHDRAW_AMOUNT` | Relayer withdraw Sui Bank → Solana | `0` / `5` |
| `NETWORK` | `mainnet` / `testnet` | `testnet` |
| `DEMO_SYMBOL` | Primary trading symbol, e.g. `BTC-PERP` | `BTC-PERP` |
| `API_BASE_URL` / `CUSTOM_RPC` | Optional REST / Sui gRPC overrides | SDK defaults |
| `RUN_MARKET_DATA` | Order book + ticker snapshot | `1` (the demo opts in by default) |
| `RUN_EXTENDED_PUBLIC` | Global config, volume, funding, klines, announcements, oracle / signed price feeds | `0` |
| `RUN_CHAIN_BALANCES` | `getChainBalances()` | `0` |
| `RUN_VAULT_REST` | Vault overview / list / my holdings REST snapshot | `0` |
| `RUN_HISTORY_ORDERS` | First page of history orders | `0` |
| `RUN_WS` | Short-lived `orderBook` + `ticker` subscription | `0` |
| `WS_URL` | WebSocket URL; falls back to the network's frontend default when unset | testnet: `wss://demows.dipcoin.io/stream/ws`, mainnet: `wss://gray-ws.dipcoin.io/stream/ws` |

On-chain / trading flags (`RUN_DEPOSIT`, `RUN_MARKET_ORDER`, `RUN_LIMIT_ORDER`, etc.) are documented inline in `.env.example`. **Only enable them on testnet after you have verified the funded account and accepted the risk.**

## License

Apache-2.0 (same as the DipCoin SDK).
