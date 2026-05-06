# DipCoin Perp Client — 示例工程

本仓库演示如何在 Node.js 下使用 [`@dipcoinlab/perp-client-ts`](https://www.npmjs.com/package/@dipcoinlab/perp-client-ts)：认证、行情、下单（可选）、链上余额、Vault REST、`WebSocket` 等。

## 环境要求

- Node.js **18+**（推荐 **22+**：内置 `WebSocket`；更低版本依赖本示例已声明的 `ws` 包）
- Yarn 1.x 或 npm

## 安装

```bash
cd dipcoin-perp-client-ts-example
yarn install
# 或: npm install
```

本仓库默认将 `@dipcoinlab/perp-client-ts` 指向 **同级的本地包** `file:../dipcoin-perp-client-ts`（与 monorepo 中主工程对齐）。**首次使用前**请在 SDK 目录构建产物：

```bash
cd ../dipcoin-perp-client-ts && yarn install --ignore-engines && yarn build
cd ../dipcoin-perp-client-ts-example && yarn install --ignore-engines
```

若你**只克隆了本 example 仓库**、没有本地 SDK，请把 `package.json` 里的依赖改回 npm 版本，例如 `"@dipcoinlab/perp-client-ts": "^0.5.0"`，并确保发布的版本已包含你需要的 API（Vault、`createWsClient`、扩展行情等需使用较新 SDK）。

> 若 Yarn 因上游 `engines` 拒绝安装，本仓库 `.yarnrc` 已设置 `ignore-engines true`（与主 SDK 仓库策略一致）。生产环境请按团队要求固定 Node 版本。

## 配置

复制环境变量模板并填写私钥：

```bash
cp .env.example .env
# 编辑 .env，至少设置 PRIVATE_KEY
```

可选：

- `API_BASE_URL`：覆盖默认的 mainnet/testnet REST 基地址
- `CUSTOM_RPC`：自定义 Sui JSON-RPC（否则使用 SDK 内置网络默认节点）

完整开关说明见下方「环境变量」与仓库内 `.env.example`。

## 运行

```bash
yarn start
# 或: yarn dev
```

默认会：**鉴权**、打印账户/持仓/挂单快照、`RUN_MARKET_DATA=1` 时拉取订单簿与 ticker。所有**入金、出金、下单、改杠杆、加减保证金、TP/SL**等高风险操作均在 `.env` 中**默认关闭**，需显式打开对应 `RUN_*` 开关。

类型检查（不产出 JS；需已构建本地 SDK 的 `dist/*.d.ts`）：

```bash
yarn typecheck
```

## 环境变量摘要

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `PRIVATE_KEY` | 钱包私钥（**必填**） | — |
| `NETWORK` | `mainnet` / `testnet` | `testnet` |
| `DEMO_SYMBOL` | 主交易对，如 `BTC-PERP` | `BTC-PERP` |
| `API_BASE_URL` / `CUSTOM_RPC` | 可选覆盖 API 与 RPC | SDK 默认 |
| `RUN_MARKET_DATA` | 订单簿 + ticker | `1`（示例脚本默认 true） |
| `RUN_EXTENDED_PUBLIC` | 全局配置、成交量、funding、k线、公告、预言机价、签名喂价 | `0` |
| `RUN_CHAIN_BALANCES` | `getChainBalances()` | `0` |
| `RUN_VAULT_REST` | Vault 概览/列表/我的持仓等 REST | `0` |
| `RUN_HISTORY_ORDERS` | 历史订单第一页 | `0` |
| `RUN_WS` | 短时间订阅 `orderBook` + `ticker` | `0` |
| `WS_URL` | WebSocket 地址；不填则按网络使用与前端一致的默认 | testnet: `wss://demows.dipcoin.io/stream/ws`，mainnet: `wss://gray-ws.dipcoin.io/stream/ws` |

与**链上/交易**相关的 `RUN_DEPOSIT`、`RUN_MARKET_ORDER`、`RUN_LIMIT_ORDER` 等见 `.env.example` 注释；**仅在测试环境、确认资金与风险后再开启**。

## 许可

Apache-2.0（与 DipCoin SDK 保持一致）。
