/* eslint-disable @typescript-eslint/no-require-imports */
try {
  require("dotenv").config();
} catch {
  // dotenv is optional
}

import BigNumber from "bignumber.js";
import { initDipCoinPerpSDK, OrderSide, OrderType, type DipCoinPerpSDK } from "@dipcoinlab/perp-client-ts";

type Network = "mainnet" | "testnet";

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
          triggerPrice: "89000",
          orderType: OrderType.LIMIT,
          orderPrice: "90000",
          tpslType: "position",
        },
        sl: {
          triggerPrice: "85000",
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

// Entrypoint: wire up SDK, authenticate, and run demo flows.
async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("❌ PRIVATE_KEY env variable is required. Provide it via .env or shell.");
    process.exit(1);
  }

  const network = (process.env.NETWORK as Network) || "testnet";
  const symbol = stringEnv("DEMO_SYMBOL", "BTC-PERP");

  const sdk = initDipCoinPerpSDK(privateKey, { network });
  console.log("Wallet:", sdk.address);
  console.log("Network:", network);
  console.log("Primary symbol:", symbol);

  const authed = await authenticate(sdk);
  if (!authed) {
    process.exit(1);
  }

  await maybeDeposit(sdk, boolEnv("RUN_DEPOSIT"), numberEnv("DEPOSIT_AMOUNT", 10));
  await maybeWithdraw(sdk, boolEnv("RUN_WITHDRAW"), numberEnv("WITHDRAW_AMOUNT", 5));
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
    process.env.LIMIT_ORDER_PRICE || "85000",
    toOrderSide(process.env.LIMIT_ORDER_SIDE, OrderSide.BUY)
  );

  await maybeCancelFirstOrder(sdk, symbol, boolEnv("RUN_CANCEL_ORDER"));

  await maybeShowMarketData(sdk, symbol, boolEnv("RUN_MARKET_DATA", true));

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
    numberEnv("MARGIN_REMOVE_AMOUNT", 5)
  );

  await maybeRunTpSlFlow(sdk, stringEnv("TPSL_SYMBOL", symbol), perpId);

  printDivider();
  console.log("🎉 Demo complete. Enable additional sections via env flags as needed.");
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Unexpected error in demo:", error);
    process.exit(1);
  });
}
