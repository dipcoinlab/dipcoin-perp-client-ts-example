/* eslint-disable @typescript-eslint/no-require-imports */
try {
  require("dotenv").config();
} catch {
  // dotenv is optional
}

import BigNumber from "bignumber.js";
// NOTE: importing from local source so SDK fixes take effect without rebuilding `dist`.
// Switch back to `"@dipcoinlab/perp-client-ts"` when validating the published package.
import {
  initDipCoinPerpSDK,
  OrderSide,
  OrderType,
  type DipCoinPerpSDK,
} from "@dipcoinlab/perp-client-ts";

type Network = "mainnet" | "testnet";

/** WebSocket base URL aligned with DipCoin frontends (override with `WS_URL`). */
function defaultWsUrl(network: Network): string {
  return network === "mainnet"
    ? "wss://gray-ws.dipcoin.io/stream/ws"
    : "wss://demows.dipcoin.io/stream/ws";
}

// Read a boolean-like env var while allowing friendly defaults.
const boolEnv = (key: string, fallback = false): boolean => {
  const value = process.env[key];
  if (value === undefined) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
};

// Parse env var into a number with validation and fallback.
const numberEnv = (key: string, fallback: number): number => {
  const value = process.env[key];
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

// Return trimmed string env var or fallback.
const stringEnv = (key: string, fallback: string): string => {
  const value = process.env[key];
  return value && value.trim() ? value.trim() : fallback;
};

// Convert env var into OrderSide, defaulting to provided fallback.
const toOrderSide = (value: string | undefined, fallback: OrderSide): OrderSide => {
  if (!value) {
    return fallback;
  }
  return value.toUpperCase() === "SELL" ? OrderSide.SELL : OrderSide.BUY;
};

// Ensure OrderType is MARKET when explicitly requested, otherwise LIMIT.
const parseOrderType = (value: string | undefined, fallback: OrderType): OrderType => {
  if (!value) {
    return fallback;
  }
  return value.toUpperCase() === OrderType.MARKET ? OrderType.MARKET : OrderType.LIMIT;
};

// Pretty-print section headers in the console.
const logSection = (title: string): void => {
  const line = "=".repeat(title.length + 8);
  console.log(`\n${line}`);
  console.log(`=== ${title} ===`);
  console.log(`${line}`);
};

// Convert a wei (18-decimal) string returned by the perp REST APIs back to a
// human-readable string. `getPositions` / `getOpenOrders` etc. transparently
// pass through the backend's wei values; passing them straight into
// `placeOrder` would double-format and trip the per-order size cap.
const weiToNormal = (value: string | number | undefined, decimals = 18): string => {
  if (value === undefined || value === null || value === "") return "0";
  const bn = new BigNumber(value);
  if (!bn.isFinite() || bn.isZero()) return "0";
  return bn.dividedBy(new BigNumber(10).pow(decimals)).toString();
};

// Separate log sections with a visual divider.
const printDivider = (): void => console.log("\n" + "-".repeat(60) + "\n");

// Authenticate once per run and bail if JWT cannot be fetched.
async function authenticate(sdk: DipCoinPerpSDK) {
  logSection("Authenticating");
  const auth = await sdk.authenticate();
  if (auth.status) {
    console.log("✅ Authentication successful");
    console.log("JWT (truncated):", auth.data?.slice(0, 32) + "...");
    return true;
  }
  console.error("❌ Authentication failed:", auth.error);
  return false;
}

// Display current leverage preference and basic margin settings.
async function showPreferredLeverage(sdk: DipCoinPerpSDK, symbol: string) {
  logSection("Current Preferred Leverage");
  const userConfig = await sdk.getUserConfig(symbol);
  if (userConfig.status && userConfig.data) {
    console.log(
      `Leverage: ${userConfig.data.leverage}x | Margin Type: ${
        userConfig.data.marginType ?? "unknown"
      } | Raw: ${userConfig.data.leverageWei}`
    );
  } else {
    console.error("Failed to fetch user config:", userConfig.error);
  }
}

// Optionally send leverage adjustment request if env flag is set.
async function maybeAdjustPreferredLeverage(
  sdk: DipCoinPerpSDK,
  symbol: string,
  enabled: boolean,
  targetLeverage: string,
  marginType: string
) {
  if (!enabled) {
    console.log(
      "ℹ️  Skipping leverage update. Set RUN_ADJUST_LEVERAGE=1 (or RUN_SET_LEVERAGE=1) plus MARGIN_TARGET_LEVERAGE to enable."
    );
    return;
  }

  logSection("Updating Preferred Leverage");
  const response = await sdk.adjustLeverage({
    symbol,
    leverage: targetLeverage,
    marginType,
  });
  if (response.status) {
    console.log("✅ Preferred leverage updated:", response.data?.message ?? "OK");
    const refreshed = await sdk.getUserConfig(symbol);
    if (refreshed.status && refreshed.data) {
      console.log(
        `New leverage: ${refreshed.data.leverage}x (${refreshed.data.marginType ?? "unknown"})`
      );
    }
  } else {
    console.error("❌ Failed to adjust leverage:", response.error);
  }
}

// Show consolidated balances, positions, and pending orders.
async function showAccountSnapshot(sdk: DipCoinPerpSDK, symbol: string) {
  logSection("Account Snapshot");
  const accountInfo = await sdk.getAccountInfo();
  if (accountInfo.status && accountInfo.data) {
    console.log("Wallet Balance:", accountInfo.data.walletBalance);
    console.log("Account Value:", accountInfo.data.accountValue);
    console.log("Free Collateral:", accountInfo.data.freeCollateral);
    console.log("Unrealized PnL:", accountInfo.data.totalUnrealizedProfit);
  } else {
    console.error("Failed to fetch account info:", accountInfo.error);
  }

  const positions = await sdk.getPositions(symbol);
  if (positions.status && positions.data?.length) {
    console.log(`\nOpen positions on ${symbol}:`);
    positions.data.forEach((pos) => {
      console.log(
        `- ${pos.symbol} ${pos.side} qty=${pos.quantity} lev=${pos.leverage} entry=${pos.avgEntryPrice}`
      );
    });
  } else {
    console.log(`\nNo open positions detected for ${symbol}.`);
  }

  const openOrders = await sdk.getOpenOrders(symbol);
  if (openOrders.status && openOrders.data?.length) {
    console.log(`\nOpen orders on ${symbol}:`);
    openOrders.data.forEach((order) => {
      console.log(
        `- ${order.symbol} ${order.side} ${order.orderType} qty=${order.quantity} price=${order.price} hash=${order.hash}`
      );
    });
  } else {
    console.log(`\nNo open orders detected for ${symbol}.`);
  }
}

// Resolve or cache the PerpetualID for the requested symbol.
async function fetchPerpId(
  sdk: DipCoinPerpSDK,
  symbol: string,
  cached?: string
): Promise<string | undefined> {
  if (cached) {
    return cached;
  }
  const perpId = await sdk.getPerpetualID(symbol);
  if (!perpId) {
    console.error(`❌ Unable to find PerpetualID for ${symbol}`);
    return undefined;
  }
  console.log(`PerpetualID for ${symbol}: ${perpId}`);
  return perpId;
}

// Conditionally execute a deposit flow for demo purposes.
async function maybeDeposit(sdk: DipCoinPerpSDK, enabled: boolean, amount: number) {
  if (!enabled) {
    console.log("ℹ️  Deposit step skipped (set RUN_DEPOSIT=1 to enable).");
    return;
  }
  logSection("Deposit");
  console.log(`Depositing ${amount} USDC to bank...`);
  const tx = await sdk.depositToBank(amount);
  console.log("✅ Deposit submitted. Tx digest:", tx?.digest ?? JSON.stringify(tx));
}

// Conditionally execute a withdraw flow for demo purposes.
async function maybeWithdraw(sdk: DipCoinPerpSDK, enabled: boolean, amount: number) {
  if (!enabled) {
    console.log("ℹ️  Withdraw step skipped (set RUN_WITHDRAW=1 to enable).");
    return;
  }
  logSection("Withdraw");
  console.log(`Withdrawing ${amount} USDC from bank...`);
  const tx = await sdk.withdrawFromBank(amount);
  console.log("✅ Withdraw submitted. Tx digest:", tx?.digest ?? JSON.stringify(tx));
}

// Place a MARKET order when explicitly requested.
async function maybePlaceMarketOrder(
  sdk: DipCoinPerpSDK,
  symbol: string,
  perpId: string | undefined,
  enabled: boolean,
  quantity: string,
  leverage: string,
  side: OrderSide
) {
  if (!enabled) {
    console.log("ℹ️  Market order step skipped (set RUN_MARKET_ORDER=1 to enable).");
    return;
  }
  if (!perpId) {
    console.log("❌ Missing PerpetualID, cannot place market order.");
    return;
  }
  logSection("Placing Market Order");
  console.log(`Submitting ${side} MARKET order on ${symbol} qty=${quantity} leverage=${leverage}`);
  const result = await sdk.placeOrder({
    symbol,
    market: perpId,
    side,
    orderType: OrderType.MARKET,
    quantity,
    leverage,
  });

  if (result.status && result.data) {
    console.log("✅ Market order placed:", result.data.message ?? "OK");
    if (result.data.data) {
      console.log("Order response:", JSON.stringify(result.data.data, null, 2));
    }
  } else {
    console.error("❌ Failed to place market order:", result.error);
  }
}

// Place a LIMIT order when explicitly requested.
async function maybePlaceLimitOrder(
  sdk: DipCoinPerpSDK,
  symbol: string,
  perpId: string | undefined,
  enabled: boolean,
  quantity: string,
  leverage: string,
  price: string,
  side: OrderSide
) {
  if (!enabled) {
    console.log("ℹ️  Limit order step skipped (set RUN_LIMIT_ORDER=1 to enable).");
    return;
  }
  if (!perpId) {
    console.log("❌ Missing PerpetualID, cannot place limit order.");
    return;
  }
  logSection("Placing Limit Order");
  console.log(
    `Submitting ${side} LIMIT order on ${symbol} qty=${quantity} price=${price} leverage=${leverage}`
  );

  const result = await sdk.placeOrder({
    symbol,
    market: perpId,
    side,
    orderType: OrderType.LIMIT,
    price,
    quantity,
    leverage,
  });

  if (result.status && result.data) {
    console.log("✅ Limit order placed:", result.data.message ?? "OK");
    if (result.data.data) {
      console.log("Order response:", JSON.stringify(result.data.data, null, 2));
    }
  } else {
    console.error("❌ Failed to place limit order:", result.error);
  }
}

// Cancel the first pending order to demo cancellation API.
async function maybeCancelFirstOrder(sdk: DipCoinPerpSDK, symbol: string, enabled: boolean) {
  if (!enabled) {
    console.log("ℹ️  Cancellation step skipped (set RUN_CANCEL_ORDER=1 to enable).");
    return;
  }
  logSection("Cancelling First Open Order");
  const openOrders = await sdk.getOpenOrders(symbol);
  if (!openOrders.status || !openOrders.data?.length) {
    console.log("No open orders available to cancel.");
    return;
  }
  const target = openOrders.data[0];
  console.log(`Cancelling order ${target.hash} (${target.side} ${target.orderType})`);
  const result = await sdk.cancelOrder({
    symbol: target.symbol,
    orderHashes: [target.hash],
  });
  if (result.status) {
    console.log("✅ Order cancelled.");
  } else {
    console.error("❌ Failed to cancel order:", result.error);
  }
}

// Fetch orderbook + ticker snapshots when toggled on.
async function maybeShowMarketData(sdk: DipCoinPerpSDK, symbol: string, enabled: boolean) {
  if (!enabled) {
    console.log("ℹ️  Market data section skipped (set RUN_MARKET_DATA=1 to enable).");
    return;
  }
  logSection("Order Book Snapshot");
  const orderBookResult = await sdk.getOrderBook(symbol);
  if (orderBookResult.status && orderBookResult.data) {
    const ob = orderBookResult.data;
    console.log(`Top bids (${symbol}):`, ob.bids.slice(0, 3));
    console.log(`Top asks (${symbol}):`, ob.asks.slice(0, 3));
    if (ob.bids.length && ob.asks.length) {
      const bestBid = new BigNumber(ob.bids[0].price);
      const bestAsk = new BigNumber(ob.asks[0].price);
      const spread = bestAsk.minus(bestBid);
      console.log(`Best Bid: ${bestBid.toString()} | Best Ask: ${bestAsk.toString()}`);
      console.log(
        `Spread: ${spread.toString()} (${
          bestBid.isZero() ? "0" : spread.div(bestBid).multipliedBy(100).toFixed(4)
        }%)`
      );
    }
  } else {
    console.error("❌ Failed to fetch order book:", orderBookResult.error);
  }

  logSection("Ticker Snapshot");
  const tickerResult = await sdk.getTicker(symbol);
  if (tickerResult.status && tickerResult.data) {
    const ticker = tickerResult.data;
    console.log(`Last Price: ${ticker.lastPrice}`);
    console.log(`Mark Price: ${ticker.markPrice}`);
    console.log(`24h Change: ${ticker.change24h} (${ticker.rate24h})`);
    console.log(`24h Volume: ${ticker.volume24h}`);
    console.log(`Open Interest: ${ticker.openInterest}`);
  } else {
    console.error("❌ Failed to fetch ticker:", tickerResult.error);
  }
}

// Handle add/remove margin helper utilities behind env flags.
async function maybeRunMarginFlow(
  sdk: DipCoinPerpSDK,
  symbol: string,
  addFlag: boolean,
  removeFlag: boolean,
  addAmount: number,
  removeAmount: number
) {
  if (!addFlag && !removeFlag) {
    console.log("ℹ️  Margin utilities skipped (set RUN_MARGIN_ADD / RUN_MARGIN_REMOVE to enable).");
    return;
  }
  logSection("Margin Utilities");

  if (addFlag) {
    console.log(`Adding ${addAmount} margin to ${symbol}`);
    const tx = await sdk.addMargin({ symbol, amount: addAmount });
    console.log("✅ Margin added. Tx digest:", tx?.digest ?? JSON.stringify(tx));
  }

  // Sleep 10s before the matching remove call so the chain has time to index
  // the freshly-added margin (avoids "stale object version" failures).
  await new Promise((resolve) => setTimeout(resolve, 10000));

  if (removeFlag) {
    console.log(`Removing ${removeAmount} margin from ${symbol}`);
    const tx = await sdk.removeMargin({ symbol, amount: removeAmount });
    console.log("✅ Margin removed. Tx digest:", tx?.digest ?? JSON.stringify(tx));
  }
}

// Demonstrate TP/SL placement, editing, and cancellation workflows.
async function maybeRunTpSlFlow(sdk: DipCoinPerpSDK, symbol: string, perpId: string | undefined) {
  const runDemo = boolEnv("RUN_TPSL_DEMO");
  const runEdit = boolEnv("RUN_TPSL_EDIT");
  const positionsResponse = await sdk.getPositions(symbol);
  const positionId =
    positionsResponse.status && positionsResponse.data && positionsResponse.data.length
      ? positionsResponse.data.find((pos) => pos.symbol === symbol)?.id ||
        positionsResponse.data[0].id
      : process.env.POSITION_ID;
  const shouldRun = runDemo || runEdit || Boolean(positionId);

  if (!shouldRun) {
    console.log("ℹ️  TP/SL utilities skipped (set RUN_TPSL_DEMO=1 or provide POSITION_ID).");
    return;
  }

  logSection("TP/SL Utilities");
  if (runDemo) {
    if (!perpId) {
      console.log("❌ Missing PerpetualID, cannot place TP/SL orders.");
    } else {
      console.log("Placing TP/SL orders (demo)...");
      const response = await sdk.placePositionTpSlOrders({
        symbol,
        market: perpId,
        side: OrderSide.SELL, // Close long position example
        isLong: false,
        leverage: "5",
        quantity: "0.01",
        tp: {
          triggerPrice: "79000",
          orderType: OrderType.LIMIT,
          orderPrice: "80000",
          tpslType: "position",
        },
        sl: {
          triggerPrice: "75000",
          orderType: OrderType.MARKET,
          tpslType: "position",
        },
      });
      if (response.status) {
        console.log("✅ TP/SL request sent:", response.data);
      } else {
        console.error("❌ Failed to place TP/SL orders:", response.error);
      }
    }
  } else {
    console.log("\nℹ️ Skipping TP/SL placement. Set RUN_TPSL_DEMO=1 to place TP/SL orders.");
  }

  let tpSlListArr: any = [];
  if (positionId) {
    console.log(`\nFetching TP/SL orders for position ${positionId}`);
    const tpSlList = await sdk.getPositionTpSl(positionId, "position");
    if (tpSlList.status && tpSlList.data) {
      tpSlListArr = tpSlList.data;
      console.log(`Found ${tpSlList.data.length} TP/SL orders:`);
      tpSlList.data.forEach((order) => {
        console.log(
          `- ${order.planOrderType}: trigger=${order.triggerPrice} price=${order.price} hash=${order.hash}`
        );
      });
    } else {
      console.error("Failed to fetch TP/SL orders:", tpSlList.error);
    }
  } else {
    console.log("\nℹ️ Set POSITION_ID to fetch TP/SL orders for a specific position.");
  }

  const tmpEditTpPlan = tpSlListArr?.find((i: any) => i.planOrderType === "takeProfit");
  const tmpEditSlPlan = tpSlListArr?.find((i: any) => i.planOrderType === "stopLoss");

  const editTpPlanId = process.env.TPSL_EDIT_TP_PLAN_ID || tmpEditTpPlan?.id;
  const editSlPlanId = process.env.TPSL_EDIT_SL_PLAN_ID || tmpEditSlPlan?.id;

  if (runEdit && (editTpPlanId || editSlPlanId)) {
    if (!perpId) {
      console.log("❌ Missing PerpetualID, cannot edit TP/SL orders.");
    } else {
      console.log("\nEditing TP/SL orders...");
      const response = await sdk.placePositionTpSlOrders({
        symbol,
        market: perpId,
        side: OrderSide.SELL,
        isLong: false,
        leverage: "5",
        quantity: "0.01",
        tp: editTpPlanId
          ? {
              planId: editTpPlanId,
              triggerPrice: "91000",
              orderType: OrderType.LIMIT,
              orderPrice: "91000",
              tpslType: "position",
            }
          : undefined,
        sl: editSlPlanId
          ? {
              planId: editSlPlanId,
              triggerPrice: "85000",
              orderType: OrderType.MARKET,
              tpslType: "position",
            }
          : undefined,
      });
      if (response.status) {
        console.log("✅ TP/SL edit request sent:", response.data);
      } else {
        console.error("❌ Failed to edit TP/SL orders:", response.error);
      }
    }
  } else if (runEdit) {
    console.log(
      "\nℹ️ To edit TP/SL orders set TPSL_EDIT_TP_PLAN_ID and/or TPSL_EDIT_SL_PLAN_ID along with RUN_TPSL_EDIT=1."
    );
  }

  let cancelHash = process.env.TPSL_CANCEL_HASH;
  if (!cancelHash) {
    const tpSlList = await sdk.getPositionTpSl(positionId as string, "position");
    if (tpSlList.status && tpSlList.data) {
      cancelHash = tpSlList.data?.find((i: any) => i.planOrderType === "takeProfit")?.hash;
    }
  }

  if (cancelHash) {
    console.log(`\nCancelling TP/SL order ${cancelHash}`);
    const response = await sdk.cancelTpSlOrders({
      symbol,
      orderHashes: [cancelHash],
    });
    if (response.status) {
      console.log("✅ TP/SL order cancelled:", response.data);
    } else {
      console.error("❌ Failed to cancel TP/SL order:", response.error);
    }
  } else {
    console.log("\nℹ️ Set TPSL_CANCEL_HASH to cancel a specific TP/SL order by hash.");
  }
}

// Global config, volumes, funding, kline, announcements, oracle & signed price feed.
async function maybeExtendedPublicData(sdk: DipCoinPerpSDK, symbol: string, enabled: boolean) {
  if (!enabled) {
    console.log("ℹ️  Extended public REST demo skipped (set RUN_EXTENDED_PUBLIC=1 to enable).");
    return;
  }
  logSection("Extended public market data (REST)");

  const gc = await sdk.getGlobalConfig();
  console.log("Global config:", gc.status ? JSON.stringify(gc.data).slice(0, 500) : gc.error);

  const vol = await sdk.getVolumes();
  console.log("24h volumes summary:", vol.status ? vol.data : vol.error);

  const funding = await sdk.getFundingRateDetail(symbol);
  console.log(`Funding (${symbol}):`, funding.status ? funding.data : funding.error);

  const now = Math.floor(Date.now() / 1000);
  const kl = await sdk.getKlineHistory({
    symbol,
    interval: stringEnv("KLINE_INTERVAL", "1h"),
    from: now - 86400 * 3,
    to: now,
    countback: numberEnv("KLINE_COUNT", 5),
  });
  if (kl.status && kl.data?.length) {
    console.log(`Kline (last ${kl.data.length} bars):`, kl.data);
  } else {
    console.log("Kline:", kl.error ?? "no data");
  }

  const ann = await sdk.getAnnouncements();
  console.log("Announcements (count):", ann.status ? ann.data?.length : ann.error);

  const notice = await sdk.getNotice();
  console.log("Notice (count):", notice.status ? notice.data?.length : notice.error);

  const signed = await sdk.getLatestSignedPriceFeed();
  if (signed.status && signed.data) {
    console.log("Latest signed price feed:", {
      hasPayload: Boolean(signed.data.payload),
      hasSignature: Boolean(signed.data.signature),
      publicKey: signed.data.publicKey?.slice?.(0, 16),
    });
  } else {
    console.log("Latest signed price feed:", signed.error);
  }

  const oracle = await sdk.getOraclePrice(symbol);
  console.log(`Oracle price (${symbol}):`, oracle.status ? oracle.data : oracle.error);
}

// On-chain SUI / USDC / bank balances via SDK helper.
async function maybeChainBalances(sdk: DipCoinPerpSDK, enabled: boolean) {
  if (!enabled) {
    console.log("ℹ️  Chain balances skipped (set RUN_CHAIN_BALANCES=1 to enable).");
    return;
  }
  logSection("On-chain balances");
  const res = await sdk.getChainBalances();
  if (res.status && res.data) {
    console.log(JSON.stringify(res.data, null, 2));
  } else {
    console.error("❌ getChainBalances:", res.error);
  }
}

// =====================================================================
//  Vault demos
//
//  Mirrors the flows under `ts-frontend/src/pages/vault`:
//   - REST snapshot (overview / config / list / my-holdings / detail)
//   - Creator: createVault, setDepositStatus / setMaxCap / setMinDeposit
//              / setFollowerMaxCap / setAutoCloseOnWithdraw / setTrader,
//              updateVaultDescription, closeVault, removeVault
//   - Follower: depositToVault, requestWithdrawFromVault, claimClosedVaultFunds
//
//  Each block is gated by a dedicated `RUN_VAULT_*` env flag so the
//  script remains safe to re-run without performing real on-chain mutations
//  unless the operator opts in explicitly.
// =====================================================================

// Resolve the vault id to operate on. Priority:
//   1. `VAULT_ID` env var
//   2. First entry returned by `getVaultsByCreator` for the active wallet
//   3. First entry of `getVaultMyHoldings`
//   4. First entry of `getVaultList`
async function resolveVaultId(sdk: DipCoinPerpSDK): Promise<string | undefined> {
  const fromEnv = process.env.VAULT_ID?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  const mine = await sdk.getVaultsByCreator();
  if (mine.status && Array.isArray(mine.data) && mine.data.length) {
    const vid = mine.data[0]?.vaultId ?? mine.data[0]?.id;
    if (vid) return vid;
  }

  const holdings = await sdk.getVaultMyHoldings();
  if (holdings.status && holdings.data?.list?.length) {
    const vid = holdings.data.list[0]?.vaultId;
    if (vid) return vid;
  }

  const list = await sdk.getVaultList();
  if (list.status && list.data?.length) {
    const vid = list.data[0]?.vaultId;
    if (vid) return vid;
  }
  return undefined;
}

// Format Sui transaction outputs in a uniform way.
function logTx(label: string, tx: any) {
  console.log(`✅ ${label} -> digest:`, tx?.digest ?? JSON.stringify(tx));
}

// REST: overview / config / list / detail / performance / my-holdings.
async function maybeVaultRestDemo(sdk: DipCoinPerpSDK, enabled: boolean) {
  if (!enabled) {
    console.log("ℹ️  Vault REST demo skipped (set RUN_VAULT_REST=1 to enable).");
    return;
  }
  logSection("Vault (REST snapshot)");

  const ov = await sdk.getVaultOverview();
  console.log("Overview:", ov.status ? ov.data : ov.error);

  const cfg = await sdk.getVaultConfig();
  console.log("Config:", cfg.status ? cfg.data : cfg.error);

  const list = await sdk.getVaultList();
  if (list.status && list.data?.length) {
    console.log(`Vault list (first 3 of ${list.data.length}):`);
    list.data.slice(0, 3).forEach((v: any) =>
      console.log(`- ${v.vaultId ?? v.id} | ${v.name ?? "<unnamed>"} | tvl=${v.tvl} apr=${v.apr}`)
    );
  } else {
    console.log("Vault list:", list.error ?? "empty");
  }

  const mineCreated = await sdk.getVaultsByCreator();
  if (mineCreated.status && Array.isArray(mineCreated.data) && mineCreated.data.length) {
    console.log(`Vaults created by me: ${mineCreated.data.length}`);
    mineCreated.data
      .slice(0, 3)
      .forEach((v: any) => console.log(`- ${v.vaultId ?? v.id} | ${v.name ?? "<unnamed>"}`));
  } else {
    console.log("Vaults created by me:", mineCreated.error ?? "none");
  }

  const holdings = await sdk.getVaultMyHoldings();
  console.log("My vault holdings:", holdings.status ? holdings.data : holdings.error);

  const vaultId = await resolveVaultId(sdk);
  if (!vaultId) {
    console.log("ℹ️  No VAULT_ID resolved – skipping per-vault drilldown.");
    return;
  }
  console.log(`\nUsing VAULT_ID=${vaultId} for drilldown sections`);

  const detail = await sdk.getVaultDetail(vaultId);
  console.log("Detail:", detail.status ? detail.data : detail.error);

  const perf = await sdk.getVaultPerformance(vaultId);
  console.log("Performance:", perf.status ? perf.data : perf.error);

  const account = await sdk.getVaultAccount(vaultId);
  console.log("Account:", account.status ? account.data : account.error);

  const myPerf = await sdk.getVaultMyPerformance(vaultId);
  console.log("My performance in this vault:", myPerf.status ? myPerf.data : myPerf.error);
}

// Creator: create a fresh vault. Mirrors `CreateVaultLayer` parameters.
async function maybeVaultCreate(sdk: DipCoinPerpSDK, enabled: boolean) {
  if (!enabled) {
    console.log("ℹ️  Vault creation skipped (set RUN_VAULT_CREATE=1 to enable).");
    return;
  }
  logSection("Vault create");

  const name = stringEnv("VAULT_NAME", `demo-vault-${Date.now()}`);
  const trader = stringEnv("VAULT_TRADER", sdk.address);
  const maxCap = stringEnv("VAULT_MAX_CAP", "100000");
  const minDepositAmount = stringEnv("VAULT_MIN_DEPOSIT", "10");
  const profitShare = stringEnv("VAULT_PROFIT_SHARE", "0.2");
  const creatorMinimumShareRatio = stringEnv("VAULT_CREATOR_MIN_RATIO", "0.05");
  const initialAmount = stringEnv("VAULT_INITIAL_DEPOSIT", "100");

  console.log(
    `Creating vault "${name}" trader=${trader} initial=${initialAmount} USDC maxCap=${maxCap}`
  );
  try {
    const tx = await sdk.createVault({
      name,
      trader,
      maxCap,
      minDepositAmount,
      creatorProfitShareRatio: profitShare,
      creatorMinimumShareRatio,
      initialAmount,
    });
    logTx("Vault created", tx);
  } catch (e: any) {
    console.error("❌ createVault failed:", e?.message ?? e);
  }
}

// Creator: apply per-setting toggles. Each is independently gated.
async function maybeVaultCreatorAdmin(sdk: DipCoinPerpSDK) {
  const flags = {
    setDepositStatus: boolEnv("RUN_VAULT_SET_DEPOSIT_STATUS"),
    setMaxCap: boolEnv("RUN_VAULT_SET_MAX_CAP"),
    setMinDeposit: boolEnv("RUN_VAULT_SET_MIN_DEPOSIT"),
    setFollowerMaxCap: boolEnv("RUN_VAULT_SET_FOLLOWER_MAX_CAP"),
    setAutoClose: boolEnv("RUN_VAULT_SET_AUTO_CLOSE"),
    setTrader: boolEnv("RUN_VAULT_SET_TRADER"),
    updateDescription: boolEnv("RUN_VAULT_UPDATE_DESCRIPTION"),
  };
  const anyEnabled = Object.values(flags).some(Boolean);
  if (!anyEnabled) {
    console.log("ℹ️  Vault creator admin skipped (set any RUN_VAULT_SET_* / RUN_VAULT_UPDATE_DESCRIPTION).");
    return;
  }

  const vaultId = await resolveVaultId(sdk);
  if (!vaultId) {
    console.error("❌ Cannot run creator admin demo: VAULT_ID not set and no creator vault found.");
    return;
  }

  logSection(`Vault creator admin (${vaultId})`);

  if (flags.setDepositStatus) {
    const status = boolEnv("VAULT_DEPOSIT_STATUS", true);
    console.log(`Setting deposit status -> ${status}`);
    try {
      const tx = await sdk.setVaultDepositStatus({ vaultId, status });
      logTx("setVaultDepositStatus", tx);
    } catch (e: any) {
      console.error("❌ setVaultDepositStatus failed:", e?.message ?? e);
    }
  }

  // NB: contract enforces follower_max_cap <= vault.max_cap, so always update
  // max cap before follower max cap (matches `ModifyMinDepositLayer` ordering).
  if (flags.setMaxCap) {
    const maxCap = stringEnv("VAULT_MAX_CAP", "200000");
    console.log(`Setting max cap -> ${maxCap}`);
    try {
      const tx = await sdk.setVaultMaxCap({ vaultId, maxCap });
      logTx("setVaultMaxCap", tx);
    } catch (e: any) {
      console.error("❌ setVaultMaxCap failed:", e?.message ?? e);
    }
  }

  if (flags.setMinDeposit) {
    const minDepositAmount = stringEnv("VAULT_MIN_DEPOSIT", "10");
    console.log(`Setting min deposit -> ${minDepositAmount}`);
    try {
      const tx = await sdk.setVaultMinDepositAmount({ vaultId, minDepositAmount });
      logTx("setVaultMinDepositAmount", tx);
    } catch (e: any) {
      console.error("❌ setVaultMinDepositAmount failed:", e?.message ?? e);
    }
  }

  if (flags.setFollowerMaxCap) {
    const followerMaxCap = stringEnv("VAULT_FOLLOWER_MAX_CAP", "10000");
    console.log(`Setting follower max cap -> ${followerMaxCap}`);
    try {
      const tx = await sdk.setVaultFollowerMaxCap({ vaultId, followerMaxCap });
      logTx("setVaultFollowerMaxCap", tx);
    } catch (e: any) {
      console.error("❌ setVaultFollowerMaxCap failed:", e?.message ?? e);
    }
  }

  if (flags.setAutoClose) {
    const autoCloseOnWithdraw = boolEnv("VAULT_AUTO_CLOSE_ON_WITHDRAW", false);
    console.log(`Setting auto-close-on-withdraw -> ${autoCloseOnWithdraw}`);
    try {
      const tx = await sdk.setVaultAutoCloseOnWithdraw({ vaultId, autoCloseOnWithdraw });
      logTx("setVaultAutoCloseOnWithdraw", tx);
    } catch (e: any) {
      console.error("❌ setVaultAutoCloseOnWithdraw failed:", e?.message ?? e);
    }
  }

  if (flags.setTrader) {
    const newTrader = stringEnv("VAULT_NEW_TRADER", sdk.address);
    console.log(`Setting trader -> ${newTrader}`);
    try {
      const tx = await sdk.setVaultTrader({ vaultId, newTrader });
      logTx("setVaultTrader", tx);
    } catch (e: any) {
      console.error("❌ setVaultTrader failed:", e?.message ?? e);
    }
  }

  if (flags.updateDescription) {
    const description = stringEnv("VAULT_DESCRIPTION", "Updated via SDK demo");
    console.log(`Updating description on vault ${vaultId}`);
    const res = await sdk.updateVaultDescription({ vaultId, description });
    if (res.status) {
      console.log("✅ updateVaultDescription:", res.data ?? "OK");
    } else {
      console.error("❌ updateVaultDescription:", res.error);
    }
  }
}

// Follower: deposit USDC into a vault.
async function maybeVaultDeposit(sdk: DipCoinPerpSDK, enabled: boolean) {
  if (!enabled) {
    console.log("ℹ️  Vault deposit skipped (set RUN_VAULT_DEPOSIT=1 to enable).");
    return;
  }
  const vaultId = await resolveVaultId(sdk);
  if (!vaultId) {
    console.error("❌ Cannot deposit: no VAULT_ID resolved.");
    return;
  }
  const amount = stringEnv("VAULT_DEPOSIT_AMOUNT", "10");
  logSection(`Vault deposit (${vaultId})`);
  console.log(`Depositing ${amount} USDC into vault ${vaultId}`);
  try {
    const tx = await sdk.depositToVault({ vaultId, amount });
    logTx("depositToVault", tx);
  } catch (e: any) {
    console.error("❌ depositToVault failed:", e?.message ?? e);
  }
}

// Follower: request withdrawal of vault shares.
//
// The vault contract redeems by share count (not USDC amount). We mirror
// `WithdrawFromVaultLayer` and convert the env-provided USDC amount to
// shares via `navps`. Set `VAULT_WITHDRAW_MAX=1` to redeem the full balance.
async function maybeVaultWithdraw(sdk: DipCoinPerpSDK, enabled: boolean) {
  if (!enabled) {
    console.log("ℹ️  Vault withdraw skipped (set RUN_VAULT_WITHDRAW=1 to enable).");
    return;
  }
  const vaultId = await resolveVaultId(sdk);
  if (!vaultId) {
    console.error("❌ Cannot withdraw: no VAULT_ID resolved.");
    return;
  }

  logSection(`Vault withdraw (${vaultId})`);
  const [myPerf, vaultCfg] = await Promise.all([
    sdk.getVaultMyPerformance(vaultId),
    sdk.getVaultConfig(),
  ]);
  if (!myPerf.status || !myPerf.data) {
    console.error("❌ Cannot read my vault performance:", myPerf.error);
    return;
  }
  const { shares: ownedShares, navps, myBalance, lastDepositTimeMs } = myPerf.data;
  console.log(`My balance: ${myBalance} USDC | shares: ${ownedShares} | navps: ${navps}`);

  // Mirror frontend `WithdrawFromVaultLayer` lock-period warning. Avoids
  // burning gas on the inevitable MoveAbort 2038 when called too eagerly.
  const lockPeriodMs = Number(vaultCfg.data?.lockPeriodMs ?? 0);
  const lastDeposit = Number(lastDepositTimeMs ?? 0);
  if (lockPeriodMs && lastDeposit) {
    const elapsed = Date.now() - lastDeposit;
    if (elapsed < lockPeriodMs) {
      const unlockAt = new Date(lastDeposit + lockPeriodMs);
      const remainingSec = Math.ceil((lockPeriodMs - elapsed) / 1000);
      console.log(
        `⏳ Withdrawal is still locked. Last deposit ${new Date(
          lastDeposit
        ).toISOString()}, unlocks at ${unlockAt.toISOString()} (~${remainingSec}s left).`
      );
      console.log(
        "   Set VAULT_WITHDRAW_SKIP_LOCK=1 to attempt the call anyway (will hit MoveAbort 2038)."
      );
      if (!boolEnv("VAULT_WITHDRAW_SKIP_LOCK")) {
        return;
      }
    }
  }

  let shares: string;
  if (boolEnv("VAULT_WITHDRAW_MAX")) {
    shares = ownedShares;
  } else {
    const amount = stringEnv("VAULT_WITHDRAW_AMOUNT", "1");
    const navpsBn = new BigNumber(navps || "0");
    if (navpsBn.isZero()) {
      console.error("❌ navps is zero – cannot convert USDC -> shares.");
      return;
    }
    shares = new BigNumber(amount).dividedBy(navpsBn).toString(10);
    console.log(`Converted ${amount} USDC -> ${shares} shares (navps=${navps})`);
  }

  if (!shares || new BigNumber(shares).isZero()) {
    console.log("ℹ️  No shares to redeem; skipping.");
    return;
  }

  try {
    const tx = await sdk.requestWithdrawFromVault({
      vaultId,
      shares,
      skipLockCheck: boolEnv("VAULT_WITHDRAW_SKIP_LOCK"),
    });
    logTx("requestWithdrawFromVault", tx);
  } catch (e: any) {
    console.error("❌ requestWithdrawFromVault failed:", e?.message ?? e);
  }
}

// Follower: claim USDC after the vault is closed.
async function maybeVaultClaimClosed(sdk: DipCoinPerpSDK, enabled: boolean) {
  if (!enabled) {
    console.log("ℹ️  Vault claim-closed skipped (set RUN_VAULT_CLAIM_CLOSED=1 to enable).");
    return;
  }
  const vaultId = await resolveVaultId(sdk);
  if (!vaultId) {
    console.error("❌ Cannot claim: no VAULT_ID resolved.");
    return;
  }
  logSection(`Vault claim closed funds (${vaultId})`);
  try {
    const tx = await sdk.claimClosedVaultFunds({ vaultId });
    logTx("claimClosedVaultFunds", tx);
  } catch (e: any) {
    console.error("❌ claimClosedVaultFunds failed:", e?.message ?? e);
  }
}

// Operator / creator: settle outstanding withdrawal requests after NAV update.
async function maybeVaultFillWithdrawals(sdk: DipCoinPerpSDK, enabled: boolean) {
  if (!enabled) {
    console.log("ℹ️  Vault fill-withdrawals skipped (set RUN_VAULT_FILL_WITHDRAW=1 to enable).");
    return;
  }
  const vaultId = await resolveVaultId(sdk);
  if (!vaultId) {
    console.error("❌ Cannot fill withdrawals: no VAULT_ID resolved.");
    return;
  }
  const ids = stringEnv("VAULT_WITHDRAW_REQUEST_IDS", "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!ids.length) {
    console.error("❌ Set VAULT_WITHDRAW_REQUEST_IDS=<comma-separated request IDs> to fill.");
    return;
  }
  logSection(`Vault fill withdrawal requests (${vaultId})`);
  try {
    const tx = await sdk.fillVaultWithdrawalRequests({
      vaultId,
      withdrawalRequestIds: ids,
    });
    logTx("fillVaultWithdrawalRequests", tx);
  } catch (e: any) {
    console.error("❌ fillVaultWithdrawalRequests failed:", e?.message ?? e);
  }
}

// Creator: close a vault. Destructive – requires explicit opt-in.
async function maybeVaultClose(sdk: DipCoinPerpSDK, enabled: boolean) {
  if (!enabled) {
    console.log("ℹ️  Vault close skipped (set RUN_VAULT_CLOSE=1 to enable).");
    return;
  }
  const vaultId = await resolveVaultId(sdk);
  if (!vaultId) {
    console.error("❌ Cannot close: no VAULT_ID resolved.");
    return;
  }
  logSection(`Vault close (${vaultId})`);
  try {
    const tx = await sdk.closeVault({ vaultId });
    logTx("closeVault", tx);
  } catch (e: any) {
    console.error("❌ closeVault failed:", e?.message ?? e);
  }
}

// Creator: remove a vault record after it has been closed and drained.
async function maybeVaultRemove(sdk: DipCoinPerpSDK, enabled: boolean) {
  if (!enabled) {
    console.log("ℹ️  Vault remove skipped (set RUN_VAULT_REMOVE=1 to enable).");
    return;
  }
  const vaultId = await resolveVaultId(sdk);
  if (!vaultId) {
    console.error("❌ Cannot remove: no VAULT_ID resolved.");
    return;
  }
  logSection(`Vault remove (${vaultId})`);
  try {
    const tx = await sdk.removeVault({ vaultId });
    logTx("removeVault", tx);
  } catch (e: any) {
    console.error("❌ removeVault failed:", e?.message ?? e);
  }
}

// =====================================================================
//  Vault perp trading (creator / trader acts on behalf of a vault)
//
//  Mirrors `ts-frontend/src/pages/perp` flows when `selectedAccount` is
//  the vault: every trading call accepts `parentAddress = <vaultId>`.
// =====================================================================
async function maybeVaultPerpTrading(sdk: DipCoinPerpSDK) {
  const flags = {
    snapshot: boolEnv("RUN_VAULT_PERP_SNAPSHOT"),
    setLeverage: boolEnv("RUN_VAULT_PERP_SET_LEVERAGE"),
    market: boolEnv("RUN_VAULT_PERP_MARKET_ORDER"),
    limit: boolEnv("RUN_VAULT_PERP_LIMIT_ORDER"),
    cancel: boolEnv("RUN_VAULT_PERP_CANCEL"),
    addMargin: boolEnv("RUN_VAULT_PERP_ADD_MARGIN"),
    removeMargin: boolEnv("RUN_VAULT_PERP_REMOVE_MARGIN"),
    closePosition: boolEnv("RUN_VAULT_PERP_CLOSE_POSITION"),
  };
  if (!Object.values(flags).some(Boolean)) {
    console.log(
      "ℹ️  Vault perp trading skipped (set any RUN_VAULT_PERP_* flag to enable)."
    );
    return;
  }

  const vaultId = await resolveVaultId(sdk);
  if (!vaultId) {
    console.error("❌ Cannot run vault perp demo: no VAULT_ID resolved.");
    return;
  }
  logSection(`Vault perp trading (parentAddress=${vaultId})`);

  const symbol = stringEnv("VAULT_PERP_SYMBOL", stringEnv("DEMO_SYMBOL", "BTC-PERP"));
  const perpId = await sdk.getPerpetualID(symbol);
  if (!perpId) {
    console.error(`❌ Cannot resolve PerpetualID for ${symbol}; aborting.`);
    return;
  }

  if (flags.snapshot) {
    const [accountInfo, positions, openOrders] = await Promise.all([
      sdk.getAccountInfo(vaultId),
      sdk.getPositions(symbol, vaultId),
      sdk.getOpenOrders(symbol, vaultId),
    ]);
    console.log("Vault account info:", accountInfo.status ? accountInfo.data : accountInfo.error);
    if (positions.status && positions.data?.length) {
      positions.data.forEach((p) =>
        console.log(
          `- pos ${p.symbol} ${p.side} qty=${weiToNormal(p.quantity)} entry=${weiToNormal(p.avgEntryPrice)} lev=${weiToNormal(p.leverage)}`
        )
      );
    } else {
      console.log("Vault positions:", positions.error ?? "none");
    }
    if (openOrders.status && openOrders.data?.length) {
      openOrders.data.forEach((o) =>
        console.log(
          `- open ${o.symbol} ${o.side} ${o.orderType} qty=${weiToNormal(o.quantity)} px=${weiToNormal(o.price)} hash=${o.hash}`
        )
      );
    } else {
      console.log("Vault open orders:", openOrders.error ?? "none");
    }
  }

  if (flags.setLeverage) {
    const leverage = stringEnv("VAULT_PERP_TARGET_LEVERAGE", "10");
    console.log(`Setting vault leverage on ${symbol} -> ${leverage}x`);
    const res = await sdk.adjustLeverage({
      symbol,
      leverage,
      marginType: stringEnv("VAULT_PERP_MARGIN_TYPE", "ISOLATED"),
      parentAddress: vaultId,
    });
    if (res.status) {
      console.log("✅ adjustLeverage:", res.data?.message ?? "OK");
    } else {
      console.error("❌ adjustLeverage:", res.error);
    }
  }

  if (flags.market) {
    const qty = stringEnv("VAULT_PERP_MARKET_QTY", "0.01");
    const lev = stringEnv("VAULT_PERP_MARKET_LEVERAGE", "10");
    const side = toOrderSide(process.env.VAULT_PERP_MARKET_SIDE, OrderSide.BUY);
    console.log(`Vault MARKET ${side} qty=${qty} lev=${lev} on ${symbol}`);
    const res = await sdk.placeOrder({
      symbol,
      market: perpId,
      orderType: OrderType.MARKET,
      side,
      quantity: qty,
      leverage: lev,
      parentAddress: vaultId,
    });
    if (res.status) {
      console.log("✅ Vault market order:", res.data?.message ?? "OK");
    } else {
      console.error("❌ Vault market order:", res.error);
    }
  }

  if (flags.limit) {
    const qty = stringEnv("VAULT_PERP_LIMIT_QTY", "0.01");
    const lev = stringEnv("VAULT_PERP_LIMIT_LEVERAGE", "10");
    const price = stringEnv("VAULT_PERP_LIMIT_PRICE", "75000");
    const side = toOrderSide(process.env.VAULT_PERP_LIMIT_SIDE, OrderSide.BUY);
    console.log(`Vault LIMIT ${side} qty=${qty} px=${price} lev=${lev} on ${symbol}`);
    const res = await sdk.placeOrder({
      symbol,
      market: perpId,
      orderType: OrderType.LIMIT,
      side,
      quantity: qty,
      price,
      leverage: lev,
      parentAddress: vaultId,
    });
    if (res.status) {
      console.log("✅ Vault limit order:", res.data?.message ?? "OK");
    } else {
      console.error("❌ Vault limit order:", res.error);
    }
  }

  if (flags.cancel) {
    const openOrders = await sdk.getOpenOrders(symbol, vaultId);
    const target = openOrders.status ? openOrders.data?.[0] : undefined;
    if (!target) {
      console.log("ℹ️  Vault has no open orders to cancel.");
    } else {
      console.log(
        `Cancelling vault order ${target.hash} (${target.side} ${target.orderType} qty=${weiToNormal(target.quantity)})`
      );
      const res = await sdk.cancelOrder({
        symbol,
        orderHashes: [target.hash!],
        parentAddress: vaultId,
      });
      if (res.status) {
        console.log("✅ Vault order cancelled.");
      } else {
        console.error("❌ Vault cancelOrder:", res.error);
      }
    }
  }

  if (flags.addMargin) {
    const amount = numberEnv("VAULT_PERP_MARGIN_ADD", 1);
    console.log(`Adding ${amount} USDC margin to vault position on ${symbol}`);
    try {
      const tx = await sdk.addMargin({ symbol, amount, parentAddress: vaultId });
      logTx("vault addMargin", tx);
    } catch (e: any) {
      console.error("❌ vault addMargin:", e?.message ?? e);
    }
  }

  if (flags.removeMargin) {
    const amount = numberEnv("VAULT_PERP_MARGIN_REMOVE", 1);
    console.log(`Removing ${amount} USDC margin from vault position on ${symbol}`);
    try {
      const tx = await sdk.removeMargin({ symbol, amount, parentAddress: vaultId });
      logTx("vault removeMargin", tx);
    } catch (e: any) {
      console.error("❌ vault removeMargin:", e?.message ?? e);
    }
  }

  if (flags.closePosition) {
    const positions = await sdk.getPositions(symbol, vaultId);
    const target = positions.status ? positions.data?.[0] : undefined;
    if (!target) {
      console.log("ℹ️  Vault has no positions to close.");
    } else {
      // `Position.quantity` / `Position.leverage` are wei strings (18 decimals)
      // straight from the REST API – `placeOrder` will re-`formatNormalToWei`
      // them, so feed in the normal-unit version. Without this the backend
      // sees ~1e15 BTC and rejects with the per-order size cap.
      const positionQty = weiToNormal(target.quantity);
      const positionLeverage = weiToNormal(target.leverage) || "10";
      const closeQty = stringEnv("VAULT_PERP_CLOSE_QTY", positionQty);
      // reduceOnly + opposite side closes the position. Mirrors `ClosePositionModal`.
      const closeSide = target.side === "BUY" ? OrderSide.SELL : OrderSide.BUY;
      console.log(
        `Closing vault position on ${symbol} (current ${target.side} qty=${positionQty} lev=${positionLeverage}) closing qty=${closeQty}`
      );
      const res = await sdk.placeOrder({
        symbol,
        market: perpId,
        orderType: OrderType.MARKET,
        side: closeSide,
        quantity: closeQty,
        leverage: positionLeverage,
        reduceOnly: true,
        parentAddress: vaultId,
      });
      if (res.status) {
        console.log("✅ Vault closePosition:", res.data?.message ?? "OK");
      } else {
        console.error("❌ Vault closePosition:", res.error);
      }
    }
  }
}



// Recent history orders (requires auth).
async function maybeHistoryOrders(sdk: DipCoinPerpSDK, symbol: string, enabled: boolean) {
  if (!enabled) {
    console.log("ℹ️  History orders skipped (set RUN_HISTORY_ORDERS=1 to enable).");
    return;
  }
  logSection("Order history (first page)");
  const res = await sdk.getHistoryOrders({
    pageNum: 1,
    pageSize: numberEnv("HISTORY_PAGE_SIZE", 5),
    symbol,
  });
  if (res.status && res.data) {
    console.log(`Total ~${res.data.total}, items:`, res.data.items?.length ?? 0);
    res.data.items?.slice(0, 5).forEach((o: any) => console.log("-", o.hash ?? o.orderHash, o.side, o.status));
  } else {
    console.error("❌ getHistoryOrders:", res.error);
  }
}

// Short-lived WebSocket: order book + ticker. Requires `ws` on Node < 22.
async function maybeWsDemo(sdk: DipCoinPerpSDK, symbol: string, network: Network, enabled: boolean) {
  if (!enabled) {
    console.log("ℹ️  WebSocket demo skipped (set RUN_WS=1 to enable).");
    return;
  }
  const wsUrl = stringEnv("WS_URL", defaultWsUrl(network));
  logSection("WebSocket sample");
  console.log("URL:", wsUrl, "| symbol:", symbol);

  const client = sdk.createWsClient({ url: wsUrl });
  let n = 0;
  const max = numberEnv("WS_MAX_MESSAGES", 8);
  const stopListening = client.onMessage((msg: unknown) => {
    n += 1;
    const text =
      typeof msg === "object" && msg !== null ? JSON.stringify(msg).slice(0, 280) : String(msg);
    console.log(`[ws ${n}/${max}]`, text);
  });

  try {
    await client.connect();
    client.subscribe({ channel: "orderBook", symbol });
    client.subscribe({ channel: "ticker", symbol });

    const deadline = numberEnv("WS_WAIT_MS", 6000);
    const started = Date.now();
    while (n < max && Date.now() - started < deadline) {
      await new Promise((r) => setTimeout(r, 400));
    }
  } catch (e) {
    console.error("❌ WebSocket:", e);
  } finally {
    stopListening();
    client.close();
    console.log("WebSocket closed.");
  }
}

// Entrypoint: wire up SDK, authenticate, and run demo flows.
async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("❌ PRIVATE_KEY env variable is required. Provide it via .env or shell.");
    process.exit(1);
  }

  const network = (process.env.NETWORK as Network) || "testnet";
  const symbol = stringEnv("DEMO_SYMBOL", "BTC-PERP");

  const sdk = initDipCoinPerpSDK(privateKey, {
    network,
    ...(process.env.API_BASE_URL?.trim()
      ? { apiBaseUrl: process.env.API_BASE_URL.trim() }
      : {}),
    ...(process.env.CUSTOM_RPC?.trim() ? { customRpc: process.env.CUSTOM_RPC.trim() } : {}),
  });
  console.log("Wallet:", sdk.address);
  console.log("Network:", network);
  console.log("Primary symbol:", symbol);

  const authed = await authenticate(sdk);
  if (!authed) {
    process.exit(1);
  }

  // Wallet snapshot + perpId resolution first; these provide context for
  // every flag-gated section below.
  await showAccountSnapshot(sdk, symbol);
  printDivider();

  const tradingPairsResult = await sdk.getTradingPairs();
  let perpId: string | undefined;
  if (tradingPairsResult.status && tradingPairsResult.data) {
    console.log(`Found ${tradingPairsResult.data.length} trading pairs (showing first 10):`);
    tradingPairsResult.data.slice(0, 10).forEach((pair) => {
      console.log(`- ${pair.symbol} -> ${pair.perpId}`);
    });
    perpId = tradingPairsResult.data.find((pair) => pair.symbol === symbol)?.perpId;
  } else {
    console.error("Failed to fetch trading pairs:", tradingPairsResult.error);
  }

  perpId = await fetchPerpId(sdk, symbol, perpId);

  // The following sections mirror the order of the matching RUN_* flags in
  // `.env` so the demo executes top-to-bottom in the same shape as the file.

  // ---- Bank / orders / margin ----
  await maybeDeposit(sdk, boolEnv("RUN_DEPOSIT"), numberEnv("DEPOSIT_AMOUNT", 10));
  await maybeWithdraw(sdk, boolEnv("RUN_WITHDRAW"), numberEnv("WITHDRAW_AMOUNT", 5));

  await maybePlaceMarketOrder(
    sdk,
    symbol,
    perpId,
    boolEnv("RUN_MARKET_ORDER"),
    process.env.MARKET_ORDER_QTY || "0.01",
    process.env.MARKET_ORDER_LEVERAGE || "20",
    toOrderSide(process.env.MARKET_ORDER_SIDE, OrderSide.BUY)
  );

  await maybePlaceLimitOrder(
    sdk,
    symbol,
    perpId,
    boolEnv("RUN_LIMIT_ORDER"),
    process.env.LIMIT_ORDER_QTY || "0.01",
    process.env.LIMIT_ORDER_LEVERAGE || "20",
    process.env.LIMIT_ORDER_PRICE || "75000",
    toOrderSide(process.env.LIMIT_ORDER_SIDE, OrderSide.BUY)
  );

  await maybeCancelFirstOrder(sdk, symbol, boolEnv("RUN_CANCEL_ORDER"));

  const marginSymbol = stringEnv("MARGIN_SYMBOL", symbol);
  await showPreferredLeverage(sdk, marginSymbol);
  await maybeAdjustPreferredLeverage(
    sdk,
    marginSymbol,
    boolEnv("RUN_ADJUST_LEVERAGE"),
    process.env.MARGIN_TARGET_LEVERAGE || "20",
    process.env.MARGIN_TYPE || "ISOLATED"
  );
  await maybeRunMarginFlow(
    sdk,
    marginSymbol,
    boolEnv("RUN_MARGIN_ADD"),
    boolEnv("RUN_MARGIN_REMOVE"),
    numberEnv("MARGIN_ADD_AMOUNT", 10),
    numberEnv("MARGIN_REMOVE_AMOUNT", 1)
  );

  await maybeRunTpSlFlow(sdk, stringEnv("TPSL_SYMBOL", symbol), perpId);

  // ---- Auxiliary data sections (not enumerated in `.env`) ----
  await maybeShowMarketData(sdk, symbol, boolEnv("RUN_MARKET_DATA", true));
  await maybeExtendedPublicData(sdk, symbol, boolEnv("RUN_EXTENDED_PUBLIC"));
  await maybeChainBalances(sdk, boolEnv("RUN_CHAIN_BALANCES"));
  await maybeHistoryOrders(sdk, symbol, boolEnv("RUN_HISTORY_ORDERS"));
  await maybeWsDemo(sdk, symbol, network, boolEnv("RUN_WS"));

  // ---- Vault: REST snapshot ----
  await maybeVaultRestDemo(sdk, boolEnv("RUN_VAULT_REST"));

  // ---- Vault: creator lifecycle ----
  await maybeVaultCreate(sdk, boolEnv("RUN_VAULT_CREATE"));

  // ---- Vault: creator settings ----
  await maybeVaultCreatorAdmin(sdk);

  // ---- Vault: follower flows ----
  await maybeVaultDeposit(sdk, boolEnv("RUN_VAULT_DEPOSIT"));
  await maybeVaultWithdraw(sdk, boolEnv("RUN_VAULT_WITHDRAW"));
  await maybeVaultClaimClosed(sdk, boolEnv("RUN_VAULT_CLAIM_CLOSED"));

  // ---- Vault: operator / destructive ----
  await maybeVaultFillWithdrawals(sdk, boolEnv("RUN_VAULT_FILL_WITHDRAW"));
  await maybeVaultClose(sdk, boolEnv("RUN_VAULT_CLOSE"));
  await maybeVaultRemove(sdk, boolEnv("RUN_VAULT_REMOVE"));

  // ---- Vault: creator/trader trades on behalf of the vault (parentAddress) ----
  await maybeVaultPerpTrading(sdk);

  printDivider();
  console.log("🎉 Demo complete. Enable additional sections via env flags as needed.");
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Unexpected error in demo:", error);
    process.exit(1);
  });
}
