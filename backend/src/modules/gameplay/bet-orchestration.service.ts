/** biome-ignore-all lint/suspicious/noExplicitAny: <> */
import { z } from "zod";
import { logGGRContribution } from "../../shared/ggr.service";
import {
  notifyError,
  sendPostBetNotifications,
} from "../../shared/notifications.service";
import { logTransaction } from "../../shared/transaction.service";
import { getJackpotPools, processJackpotContribution } from "../jackpots/jackpot.service";
import { getDetailedBalance } from "./balance-management.service";
import {
  BetRequest,
  GameOutcome,
  betRequestSchema,
  executeCoreBet,
  gameOutcomeSchema,
} from "./core-bet.service";

import {
  db,
  findFirstGameNative,
  updateGameNative,
} from "@/libs/database/db";
import { transactionLogTable } from "@/libs/database/schema";
import { sql } from "drizzle-orm";
import {
  addXpToUser,
  calculateXpForWagerAndWins,
  getVIPLevels,
} from "./vip.service";

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

    // Destructure for clarity
    const {
      userId,
      gameId,
      wagerAmount,
      winAmount,
      realBalanceBefore,
      bonusBalanceBefore,
      realBalanceAfter,
      bonusBalanceAfter,
      balanceType,
    } = coreBetResult;

    // --- Side Effects Orchestration ---
    const sideEffectPromises = [];

    // 3. Jackpot Contribution
    const jackpotPromise = processJackpotContribution(gameId, wagerAmount)
      .catch(error => {
        console.error("Jackpot contribution failed, continuing with zero contribution:", error);
        return { totalContribution: 0 };
      });
    sideEffectPromises.push(jackpotPromise);

    // 7. VIP Points Calculation & Update
    const vipCalculation = calculateXpForWagerAndWins(wagerAmount);
    const vipUpdatePromise = addXpToUser(userId, vipCalculation.totalPoints)
      .catch(error => {
        console.error("VIP update failed, continuing:", error);
        return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
      });
    sideEffectPromises.push(vipUpdatePromise);

    // 10. GGR Contribution Logging
    const ggrPromise = logGGRContribution({
      betId: `bet_${Date.now()}`,
      userId,
      affiliateName: betRequest.affiliateName || "adminuser",
      operatorId: betRequest.operatorId || "house",
      gameId,
      wagerAmount,
      winAmount,
      currency: "USD",
    }).catch(error => {
      console.error("GGR contribution logging failed, continuing with zero GGR:", error);
      return { ggrAmount: 0 };
    });
    sideEffectPromises.push(ggrPromise);

    // Execute all side effects in parallel
    const [jackpotResult, vipUpdate, ggrResult] = await Promise.allSettled(sideEffectPromises);

    const totalJackpotContribution = jackpotResult.status === 'fulfilled' ? jackpotResult.value.totalContribution : 0;
    const ggrContribution = ggrResult.status === 'fulfilled' ? ggrResult.value.ggrAmount : 0;

    const processingTime = Date.now() - startTime;
    // 11. Log Comprehensive Transaction
    const transactionId = await logTransaction({
      userId,
      gameId,
      operatorId: "79032f3f-7c4e-4575-abf9-4298ad3e9d1a",
      wagerAmount,
      winAmount,
      type: "BET",
      realBalanceBefore,
      realBalanceAfter,
      bonusBalanceBefore,
      bonusBalanceAfter,
      processingTime,
      ggrContribution,
      jackpotContribution: totalJackpotContribution,
      vipPointsAdded: vipCalculation.totalPoints,
      sessionId: betRequest.sessionId,
      status: "COMPLETED",
    });

    // 12. Send Realtime Notifications (fire and forget)
    sendPostBetNotifications(userId, JSON.stringify({
      balanceChange: {
        realBalance: realBalanceAfter - realBalanceBefore,
        bonusBalance: bonusBalanceAfter - bonusBalanceBefore,
        totalBalance: realBalanceAfter + bonusBalanceAfter,
        changeAmount: (winAmount - wagerAmount).toString(),
        changeType: winAmount > 0 ? "win" : "bet",
      },
      vipUpdate: vipUpdate.status === 'fulfilled' && vipUpdate.value.success,
      jackpotContribution: totalJackpotContribution,
    })).catch(error => console.error("Realtime notifications failed:", error));

    // 13. Update Game Statistics (fire and forget)
    updateGameStatistics(gameId, userId, wagerAmount, winAmount)
      .catch(error => console.error(`Failed to update game ${gameId} statistics:`, error));

    // Return success response immediately
    return {
      userId,
      gameId,
      wagerAmount,
      winAmount,
      balanceType,
      newBalance: realBalanceAfter + bonusBalanceAfter,
      jackpotContribution: totalJackpotContribution,
      vipPointsEarned: vipCalculation.totalPoints,
      ggrContribution: ggrContribution,
      success: true,
      transactionId,
      time: processingTime,
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

async function updateGameStatistics(gameId: string, userId: string, wagerAmount: number, winAmount: number) {
  const game = await findFirstGameNative(gameId);
  if (!game) {
    console.warn(`Game ${gameId} not found for statistics update.`);
    return;
  }

  let currentPlayers: string[] = [];
    try {
      if (game.distinctPlayers !== null && game.distinctPlayers !== undefined) {
        const parsedPlayers = Array.isArray(game.distinctPlayers)
          ? game.distinctPlayers
          : JSON.parse(JSON.stringify(game.distinctPlayers));
        currentPlayers = Array.isArray(parsedPlayers) ? parsedPlayers.filter(p => typeof p === 'string') : [];
      }
    } catch (error) {
      console.warn('Failed to parse distinctPlayers, using empty array:', error);
      currentPlayers = [];
    }

  const isNewPlayer = !currentPlayers.includes(userId);
  const newPlayersList = isNewPlayer ? [...currentPlayers, userId] : currentPlayers;

  const newTotalBets = (game.totalBets || 0) + 1;
  const newTotalWins = (game.totalWins || 0) + (winAmount > 0 ? 1 : 0);
  const newHitPercentage = newTotalBets > 0 ? (newTotalWins / newTotalBets) * 100 : 0;

  const newTotalBetAmount = (game.totalBetAmount || 0) + wagerAmount;
  const newTotalWonAmount = (game.totalWonAmount || 0) + winAmount;
  const newCurrentRtp = newTotalBetAmount > 0 ? (newTotalWonAmount / newTotalBetAmount) * 100 : 0;

  let totalMinutesPlayed: number;
    if (game.startedAt) {
      const startedAt = new Date(game.startedAt);
      const now = new Date();
      const timeDiffMs = now.getTime() - startedAt.getTime();
      totalMinutesPlayed = Math.max(0, Math.floor(timeDiffMs / (1000 * 60)));
      if (timeDiffMs < 0) {
        console.warn(`[totalMinutesPlayed] Game ${gameId} has startedAt in the future: ${startedAt.toISOString()}`);
      }
    } else {
      console.warn(`[totalMinutesPlayed] Game ${gameId} has null startedAt, using createdAt as fallback`);
      const fallbackStartedAt = game.createdAt ? new Date(game.createdAt) : new Date();
      const now = new Date();
      const timeDiffMs = now.getTime() - fallbackStartedAt.getTime();
      totalMinutesPlayed = Math.max(0, Math.floor(timeDiffMs / (1000 * 60)));
    }

  await updateGameNative(gameId, {
    totalBets: newTotalBets,
    totalWins: newTotalWins,
    hitPercentage: newHitPercentage,
    distinctPlayers: newPlayersList,
    totalPlayers: newPlayersList.length,
    totalBetAmount: newTotalBetAmount,
    totalWonAmount: newTotalWonAmount,
    currentRtp: newCurrentRtp,
    totalMinutesPlayed: totalMinutesPlayed,
  });
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
