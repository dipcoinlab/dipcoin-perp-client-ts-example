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
- `CUSTOM_RPC`: custom Sui JSON-RPC (defaults to the SDK's per-network endpoint)

See `.env.example` and the table below for the full set of toggles.

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
| `PRIVATE_KEY` | Wallet private key (**required**) | — |
| `NETWORK` | `mainnet` / `testnet` | `testnet` |
| `DEMO_SYMBOL` | Primary trading symbol, e.g. `BTC-PERP` | `BTC-PERP` |
| `API_BASE_URL` / `CUSTOM_RPC` | Optional REST / RPC overrides | SDK defaults |
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
