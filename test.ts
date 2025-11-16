import "dotenv/config";
import {
  initDipCoinPerpSDK,
  OrderSide,
  OrderType,
} from "@dipcoinlab/perp-client-ts";

async function main() {
  // Initialize SDK with private key
  // WARNING: Never expose your private key in production code
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("❌ Error: PRIVATE_KEY environment variable is not set");
    console.error("\nPlease set it in one of the following ways:");
    console.error("  1. Create a .env file with: PRIVATE_KEY=your-private-key");
    console.error("  2. Export it: export PRIVATE_KEY=your-private-key");
    console.error("  3. Inline: PRIVATE_KEY=your-key npm run example");
    console.error("\nExample .env file:");
    console.error("  PRIVATE_KEY=suiprivkey1...");
    return;
  }

  const sdk = initDipCoinPerpSDK(privateKey, {
    network: "testnet", // or "mainnet"
  });

  console.log("Wallet Address:", sdk.address);

  try {
    // 0. Authenticate first (onboarding)
    console.log("\n=== Authenticating (Onboarding) ===");
    const authResult = await sdk.authenticate();
    if (authResult.status) {
      console.log("✅ Authentication successful!");
      console.log("JWT Token:", authResult.data?.substring(0, 20) + "...");
    } else {
      console.error("❌ Authentication failed:", authResult.error);
      return;
    }

    // 1. Deposit to bank
    console.log("\n=== Deposit ===");
    await sdk.depositToBank(10);
    console.log("Deposit to bank success!");

    // 2. Withdraw from bank
    console.log("\n=== Withdraw ===");
    await sdk.withdrawFromBank(5);
    console.log("Withdraw from bank success!");

    // 3. Get account information
    console.log("\n=== Getting Account Info ===");
    const accountInfo = await sdk.getAccountInfo();
    if (accountInfo.status && accountInfo.data) {
      console.log("Wallet Balance:", accountInfo.data.walletBalance);
      console.log("Account Value:", accountInfo.data.accountValue);
      console.log("Free Collateral:", accountInfo.data.freeCollateral);
      console.log("Unrealized PnL:", accountInfo.data.totalUnrealizedProfit);
    } else {
      console.error("Failed to get account info:", accountInfo.error);
    }

    // 4. Get positions
    console.log("\n=== Getting Positions ===");
    const positions = await sdk.getPositions();
    if (positions.status && positions.data) {
      console.log(`Found ${positions.data.length} positions`);
      positions.data.forEach((pos) => {
        console.log(
          `- ${pos.symbol}: ${pos.side} ${pos.quantity} @ ${pos.avgEntryPrice}`
        );
      });
    } else {
      console.error("Failed to get positions:", positions.error);
    }

    // 5. Get open orders
    console.log("\n=== Getting Open Orders ===");
    const openOrders = await sdk.getOpenOrders();
    if (openOrders.status && openOrders.data) {
      console.log(`Found ${openOrders.data.length} open orders`);
      openOrders.data.forEach((order) => {
        console.log(
          `- ${order.symbol}: ${order.side} ${order.orderType} ${order.quantity} @ ${order.price}`
        );
      });
    } else {
      console.error("Failed to get open orders:", openOrders.error);
    }

    // 6. Get trading pairs and PerpetualID
    console.log("\n=== Getting Trading Pairs ===");
    const tradingPairsResult = await sdk.getTradingPairs();
    if (tradingPairsResult.status && tradingPairsResult.data) {
      console.log(`✅ Found ${tradingPairsResult.data.length} trading pairs`);
      console.log("\nAvailable trading pairs:");
      tradingPairsResult.data.slice(0, 10).forEach((pair) => {
        console.log(`  - ${pair.symbol}: PerpetualID = ${pair.perpId}`);
      });
      if (tradingPairsResult.data.length > 10) {
        console.log(`  ... and ${tradingPairsResult.data.length - 10} more`);
      }
    } else {
      console.error(
        "❌ Failed to get trading pairs:",
        tradingPairsResult.error
      );
      console.error("Cannot proceed with placing order without PerpetualID");
      return;
    }

    // 7. Get PerpetualID for BTC-PERP
    const symbolToTrade = "BTC-PERP";
    console.log(`\n=== Getting PerpetualID for ${symbolToTrade} ===`);
    const perpetualId = await sdk.getPerpetualID(symbolToTrade);

    if (!perpetualId) {
      console.error(
        `❌ Error: Could not find PerpetualID for ${symbolToTrade}`
      );
      console.error("Available symbols:");
      if (tradingPairsResult.status && tradingPairsResult.data) {
        tradingPairsResult.data.forEach((pair) => {
          console.error(`  - ${pair.symbol}`);
        });
      }
      return;
    }

    console.log(`✅ Found PerpetualID for ${symbolToTrade}: ${perpetualId}`);

    // 8. Place a market order
    console.log("\n=== Placing Market Order ===");
    const orderResult = await sdk.placeOrder({
      symbol: symbolToTrade,
      market: perpetualId, // REQUIRED: PerpetualID for the trading pair
      side: OrderSide.BUY,
      orderType: OrderType.MARKET,
      quantity: "0.01",
      leverage: "20",
    });

    if (orderResult.status && orderResult.data) {
      console.log("✅ Order placed successfully!");
      console.log("Response Code:", orderResult.data.code);
      console.log("Response Message:", orderResult.data.message || "N/A");
      if (orderResult.data.data) {
        console.log(
          "Order Data:",
          JSON.stringify(orderResult.data.data, null, 2)
        );
      }
    } else {
      console.error("❌ Failed to place order:", orderResult.error);
      if (orderResult.data) {
        console.error("Response Code:", orderResult.data.code);
        console.error("Response Message:", orderResult.data.message || "N/A");
        console.error(
          "Full Response:",
          JSON.stringify(orderResult.data, null, 2)
        );
      }
    }

    // 9. Get updated open orders after placing order
    console.log("\n=== Getting Updated Open Orders ===");
    const updatedOrders = await sdk.getOpenOrders();
    if (updatedOrders.status && updatedOrders.data) {
      console.log(`Found ${updatedOrders.data.length} open orders`);
      updatedOrders.data.forEach((order) => {
        console.log(
          `- ${order.symbol}: ${order.side} ${order.orderType} ${order.quantity} @ ${order.price} (Hash: ${order.hash})`
        );
      });

      // 10. Cancel an order if there are any open orders
      if (updatedOrders.data.length > 0) {
        console.log("\n=== Cancelling Order ===");
        const orderToCancel = updatedOrders.data[0];
        console.log(
          `Attempting to cancel order: ${orderToCancel.symbol} - Hash: ${orderToCancel.hash}`
        );

        const cancelResult = await sdk.cancelOrder({
          symbol: orderToCancel.symbol,
          orderHashes: [orderToCancel.hash],
        });

        if (cancelResult.status && cancelResult.data) {
          console.log("✅ Order cancelled successfully!");
          console.log("Response Code:", cancelResult.data.code);
          console.log("Response Message:", cancelResult.data.message || "N/A");
          console.log("Cancelled Order Hash:", orderToCancel.hash);
          if (cancelResult.data.data) {
            console.log(
              "Cancel Response Data:",
              JSON.stringify(cancelResult.data.data, null, 2)
            );
          }
        } else {
          console.error("❌ Failed to cancel order:", cancelResult.error);
          if (cancelResult.data) {
            console.error("Response Code:", cancelResult.data.code);
            console.error(
              "Response Message:",
              cancelResult.data.message || "N/A"
            );
            console.error(
              "Full Response:",
              JSON.stringify(cancelResult.data, null, 2)
            );
          }
        }
      } else {
        console.log("No open orders to cancel");
      }

      // 11. Get OrderBook
      console.log("\n=== Getting OrderBook ===");
      const orderBook = await sdk.getOrderBook(symbolToTrade);
      if (orderBook.status && orderBook.data) {
        console.log("OrderBook:", orderBook.data);
      } else {
        console.error("Failed to get order book:", orderBook.error);
      }

      // 12. Get Ticker
      console.log("\n=== Getting Ticker ===");
      const ticker = await sdk.getTicker(symbolToTrade);
      if (ticker.status && ticker.data) {
        console.log("Ticker:", ticker.data);
      } else {
        console.error("Failed to get ticker:", ticker.error);
      }
    } else {
      console.error("Failed to get updated open orders:", updatedOrders.error);
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

// Run the example
// eslint-disable-next-line @typescript-eslint/no-require-imports
if (require.main === module) {
  main().catch(console.error);
}
