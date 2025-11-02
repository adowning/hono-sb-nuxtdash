/** biome-ignore-all lint/suspicious/noExplicitAny: <> */
import {
  notifyError,
} from "../../shared/notifications.service";
import { getDetailedBalance } from "./balance-management.service";
import {
  BetRequest,
  GameOutcome,
  executeCoreBet,
} from "./core-bet.service";
import { onBetCompleted as onGGR } from "./listeners/ggr.logger";
import { onBetCompleted as onJackpot } from "./listeners/jackpot.processor";
import { onBetCompleted as onNotification } from "./listeners/notification.sender";
import { onBetCompleted as onStats } from "./listeners/stats.updater";
import { onBetCompleted as onTransaction } from "./listeners/transaction.logger";
import { onBetCompleted as onVIP } from "./listeners/vip.processor";

import {
  db,
} from "@/libs/database/db";
import { transactionLogTable } from "@/libs/database/schema";
import { sql } from "drizzle-orm";
import {
  getVIPLevels,
} from "./vip.service";
import { getJackpotPools } from "../jackpots/jackpot.service";

// TODO: Instantiate settings properly

/**
 * Bet processing orchestration service
 * Coordinates all systems for complete bet processing following PRD
 */

export interface BetOutcome {
  userId: string;
  gameId: string;
  wagerAmount: number;
  winAmount: number;
  balanceType: "real" | "bonus" | "mixed";
  newBalance: number;

  // System contributions
  jackpotContribution: number;
  vipPointsEarned: number;
  ggrContribution: number;

  // Status
  success: boolean;
  error?: string;

  // Metadata
  transactionId?: string;
  time: number;
}

/**
 * Process complete bet flow from wager to outcome
 */
export async function processBet(
  betRequest: BetRequest,
  gameOutcome: GameOutcome
): Promise<BetOutcome> {
  const startTime = Date.now();

  try {
    const coreBetResult = await executeCoreBet(betRequest, gameOutcome);

    const payload = {
      ...coreBetResult,
      betRequest,
      gameOutcome,
    };

    const listeners = [
      onGGR,
      onJackpot,
      onNotification,
      onStats,
      onTransaction,
      onVIP,
    ];
    Promise.allSettled(listeners.map((listener) => listener(payload)));

    // Return success response immediately
    return {
      userId: coreBetResult.userId,
      gameId: coreBetResult.gameId,
      wagerAmount: coreBetResult.wagerAmount,
      winAmount: coreBetResult.winAmount,
      balanceType: coreBetResult.balanceType,
      newBalance: coreBetResult.realBalanceAfter + coreBetResult.bonusBalanceAfter,
      jackpotContribution: 0, // These values are now calculated in the listeners
      vipPointsEarned: 0,
      ggrContribution: 0,
      success: true,
      transactionId: undefined, // This is now handled by the transaction logger
      time: Date.now() - startTime,
    };

  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error("Bet processing failed:", error);

    // Send error notification to user
    await notifyError(
      betRequest.userId,
      error instanceof Error ? error.message : "Bet processing failed"
    );

    return {
      userId: betRequest.userId,
      gameId: betRequest.gameId,
      wagerAmount: betRequest.wagerAmount,
      winAmount: 0,
      balanceType: "real",
      newBalance: 0,
      jackpotContribution: 0,
      vipPointsEarned: 0,
      ggrContribution: 0,
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      time: processingTime,
    };
  }
}

/**
 * Process bet outcome (called after game provider returns result)
 */
export async function processBetOutcome(
  betRequest: BetRequest,
  gameOutcome: GameOutcome
): Promise<BetOutcome> {
  return processBet(betRequest, gameOutcome);
}

// services/bet-orchestration.service.ts

/**
 * Get bet processing statistics from the last 24 hours.
 */
export async function getBetProcessingStats(): Promise<{
  totalBets: number;
  averageProcessingTime: number; // Calculated from actual logged processing_time data
  successRate: number;
  totalWagered: number;
  totalGGR: number;
}> {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const results = await db
      .select({
        totalBets: sql`count(CASE WHEN type IN ('BET', 'BONUS') THEN 1 END)`, // Count wager transactionLogTable only
        successfulBets: sql`count(CASE WHEN type IN ('BET', 'BONUS') AND status = 'COMPLETED' THEN 1 END)`, // Completed wagers
        totalWagered: sql`coalesce(sum(CASE WHEN type IN ('BET', 'BONUS') THEN wager_amount ELSE 0 END), 0)`, // Sum wager amounts
        totalWon: sql`coalesce(sum(CASE WHEN type = 'WIN' THEN amount ELSE 0 END), 0)`, // Sum win amounts from WIN transactionLogTable
        averageProcessingTime: sql`coalesce(avg(CASE WHEN processing_time > 0 AND processing_time < 10000 THEN processing_time ELSE NULL END), 0)`, // Filter valid processing times (0-10s range)
      })
      .from(transactionLogTable)
      .where(sql`${transactionLogTable.createdAt} >= ${twentyFourHoursAgo}`);

    const stats = results[0];
    if (!stats) {
      return {
        totalBets: 0,
        averageProcessingTime: 0,
        successRate: 100,
        totalWagered: 0,
        totalGGR: 0,
      };
    }

    const totalBets = Number(stats.totalBets);
    const successfulBets = Number(stats.successfulBets);
    const totalWagered = Number(stats.totalWagered);
    const totalWon = Number(stats.totalWon);
    const averageProcessingTime = Number(stats.averageProcessingTime); // Now from DB

    const successRate =
      totalBets > 0 ? (successfulBets / totalBets) * 100 : 100;
    const totalGGR = totalWagered - totalWon;

    return {
      totalBets,
      averageProcessingTime,
      successRate,
      totalWagered,
      totalGGR,
    };
  } catch (error) {
    console.error("Failed to get bet processing stats:", error);
    return {
      totalBets: 0,
      averageProcessingTime: 0,
      successRate: 100,
      totalWagered: 0,
      totalGGR: 0,
    };
  }
}
/**
 * Health check for bet processing system
 */
export async function healthCheck(): Promise<{
  healthy: boolean;
  checks: Record<string, boolean>;
  responseTime: number;
}> {
  const startTime = Date.now();

  const checks = {
    database: await checkDatabaseConnection(),
    walletService: await checkWalletService(),
    jackpotService: await checkJackpotService(),
    vipService: await checkVIPService(),
  };

  const allHealthy = Object.values(checks).every((check) => check);

  return {
    healthy: allHealthy,
    checks,
    responseTime: Date.now() - startTime,
  };
}

/**
 * Individual health checks
 */
async function checkDatabaseConnection(): Promise<boolean> {
  try {
    // Test database connectivity with a simple query
    await db.execute(sql`SELECT 1`);
    return true;
  } catch (error) {
    console.error("Database connection check failed:", error);
    return false;
  }
}
async function checkWalletService(): Promise<boolean> {
  try {
    const testUserId = "health-check-test-user";
    const userBalance = await getDetailedBalance(testUserId);
    if (!userBalance) {
      console.error(
        "User balance service check failed: No balance returned for test user (possible service or data issue)"
      );
      return false;
    }
    return true;
  } catch (error) {
    console.error(
      "User balance service check failed: Exception during call -",
      error instanceof Error ? error.message : "Unknown error"
    );
    return false;
  }
}
async function checkJackpotService(): Promise<boolean> {
  try {
    const pools = await getJackpotPools();
    if (!pools || typeof pools !== "object") {
      return false;
    }
    const requiredGroups = ["minor", "major", "mega"];
    for (const group of requiredGroups) {
      if (!pools[group as keyof typeof pools]) {
        return false;
      }
    }
    return true;
  } catch (error) {
    console.error("Jackpot service check failed:", error);
    return false;
  }
}

async function checkVIPService(): Promise<boolean> {
  try {
    const levels = getVIPLevels();
    if (!Array.isArray(levels) || levels.length === 0) {
      return false;
    }
    const hasBasicLevels =
      levels.some((level) => level.level === 1) &&
      levels.some((level) => level.level === 2);
    if (!hasBasicLevels) {
      return false;
    }
    return true;
  } catch (error) {
    console.error("VIP service check failed:", error);
    return false;
  }
}
