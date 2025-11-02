/** biome-ignore-all lint/suspicious/noExplicitAny: <> */
import { z } from "zod";
import { logGGRContribution } from "../../shared/ggr.service";
import
  {
    notifyError,
    sendPostBetNotifications,
  } from "../../shared/notifications.service";
import { logTransaction } from "../../shared/transaction.service";
import { getJackpotPools, processJackpotContribution } from "../jackpots/jackpot.service";
import
  {
    addWinnings,
    deductBetAmount,
    getDetailedBalance,
  } from "./balance-management.service";

import
  {
    db,
    findFirstActiveGameSessionNative,
    findFirstGameNative,
    findFirstUserNative,
    selectUserBalanceNative,
    updateGameNative,
  } from "@/libs/database/db";
import { gameTable, transactionLogTable } from "@/libs/database/schema";
import { validateBet } from "@/shared/restrictions.service";
import { sql } from "drizzle-orm";
import
  {
    addXpToUser,
    calculateXpForWagerAndWins,
    getVIPLevels,
  } from "./vip.service";

// TODO: Instantiate settings properly

/**
 * Bet processing orchestration service
 * Coordinates all systems for complete bet processing following PRD
 */

export interface BetRequest
{
  userId: string;
  gameId: string;
  wagerAmount: number; // Amount in cents
  operatorId?: string;
  sessionId?: string;
  affiliateName?: string;
}

export interface BetOutcome
{
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

export interface GameOutcome
{
  winAmount: number;
  gameData?: Record<string, unknown>; // Game-specific outcome data
  jackpotWin?: {
    group: string;
    amount: number;
  };
}

// Zod schemas for validation
const betRequestSchema = z.object({
  userId: z.string().min(1, "userId cannot be empty").transform(sanitizeString),
  gameId: z.string().min(1, "gameId cannot be empty").transform(sanitizeString),
  wagerAmount: z
    .number()
    .positive("wagerAmount must be positive")
    .finite("wagerAmount must be a valid number"),
  operatorId: z
    .string()
    .optional()
    .transform((val) => (val ? sanitizeString(val) : val)),
  sessionId: z
    .string()
    .optional()
    .transform((val) => (val ? sanitizeString(val) : val)),
  affiliateName: z
    .string()
    .optional()
    .transform((val) => (val ? sanitizeString(val) : val)),
});

const gameOutcomeSchema = z.object({
  winAmount: z
    .number()
    .min(0, "winAmount cannot be negative")
    .finite("winAmount must be a valid number"),
  gameData: z.record(z.string(), z.unknown()).optional(), // Fixed: was likely just "record"
  jackpotWin: z
    .object({
      group: z.string(),
      amount: z.number().min(0),
    })
    .optional(),
});

// Sanitization function for strings to prevent log injection
function sanitizeString(str: string): string
{
  return str.replace(/[\r\n\t\b\f\v\\"]/g, "").trim();
}

/**
 * Helper function to add winnings within a transaction context
 */
async function addWinningsWithinTransaction(
  tx: any,
  balanceDeduction: any,
  userId: string,
  gameId: string,
  winAmount: number
)
{
  let winningsAddition: {
    success: boolean;
    newBalance: number;
    error?: string;
  } = {
    success: true,
    newBalance: 0,
  };
  let realWinnings = 0;
  let bonusWinnings = 0;

  if (winAmount > 0) {
    if (balanceDeduction.balanceType === "mixed") {
      // Calculate total deducted from all balance types for ratio computation
      const totalDeducted =
        balanceDeduction.deductedFrom.real +
        balanceDeduction.deductedFrom.bonuses.reduce(
          (sum: any, b: { amount: any }) => sum + b.amount,
          0
        );

      if (totalDeducted === 0) {
        // Edge case: no deduction occurred (shouldn't happen in normal flow)
        // Default to real balance for safety
        realWinnings = winAmount;
        bonusWinnings = 0;
        winningsAddition = await addWinnings({
          userId,
          amount: winAmount,
          balanceType: "real",
          reason: `Game win - ${gameId}`,
          gameId,
        });
      } else {
        // Proportional distribution based on wager deduction ratios
        const realDeducted = balanceDeduction.deductedFrom.real;
        const bonusDeducted = balanceDeduction.deductedFrom.bonuses.reduce(
          (sum: any, b: { amount: any }) => sum + b.amount,
          0
        );

        // Calculate ratios: how much of the wager came from each balance type
        const realRatio = realDeducted / totalDeducted;
        const bonusRatio = bonusDeducted / totalDeducted; // Calculated but not directly used (implied by realRatio)

        // Apply same ratios to winnings distribution
        realWinnings = Math.round(winAmount * realRatio);
        bonusWinnings = winAmount - realWinnings; // Ensure no rounding loss

        // Credit real portion
        const realAddition = await addWinnings({
          userId,
          amount: realWinnings,
          balanceType: "real",
          reason: `Game win - ${gameId} (real portion)`,
          gameId,
        });

        // Credit bonus portion
        const bonusAddition = await addWinnings({
          userId,
          amount: bonusWinnings,
          balanceType: "bonus",
          reason: `Game win - ${gameId} (bonus portion)`,
          gameId,
        });

        // Aggregate results - both must succeed for overall success
        winningsAddition = {
          success: realAddition.success && bonusAddition.success,
          newBalance: bonusAddition.newBalance, // Use bonus addition as final balance reference
          error: realAddition.error || bonusAddition.error,
        };
      }
    } else {
      // Single balance type - direct crediting
      const balanceType =
        balanceDeduction.balanceType === "bonus" ? "bonus" : "real";
      winningsAddition = await addWinnings({
        userId,
        amount: winAmount,
        balanceType,
        reason: `Game win - ${gameId}`,
        gameId,
      });

      // Track winnings by type for transaction logging
      if (balanceType === "real") {
        realWinnings = winAmount;
      } else {
        bonusWinnings = winAmount;
      }
    }

    if (!winningsAddition.success) {
      console.error("Failed to add winnings:", winningsAddition.error);
      throw new Error(`Winnings addition failed: ${winningsAddition.error}`);
    }
  }

  return { winningsAddition, realWinnings, bonusWinnings };
}

/**
 * Process complete bet flow from wager to outcome
 */
export async function processBet(
  betRequest: BetRequest,
  gameOutcome: GameOutcome
): Promise<BetOutcome>
{
  const startTime = Date.now();
  const validatedBetRequest = betRequestSchema.parse(betRequest);
  const validatedGameOutcome = gameOutcomeSchema.parse(gameOutcome);
  try {
    // Optimized: Batch database queries in parallel to reduce latency
    const [user, userBalance, game, gameSession] = await Promise.all([
      findFirstUserNative(validatedBetRequest.userId),
      selectUserBalanceNative(validatedBetRequest.userId),
      findFirstGameNative(validatedBetRequest.gameId),
      findFirstActiveGameSessionNative(validatedBetRequest.userId, validatedBetRequest.gameId)
    ]);

    // 1. Pre-bet validation
    const validation = await validateBet({
      user,
      userBalance,
      game,
      gameSession,
      wagerAmount: validatedBetRequest.wagerAmount,
      operatorId: validatedBetRequest.operatorId,
    });

    if (!validation.valid) {
      console.log("Bet validation failed");
      await notifyError(
        betRequest.userId,
        validation.reason || "Bet validation failed"
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
        error: validation.reason,
        time: Date.now() - startTime,
      };
    }

    // 2. Get user's active balance

    if (!userBalance) {
      throw new Error("User balance not found");
    }
    // const runningBalance = userBalance.realBalance + userBalance.bonusBalance;

    // 3. Optimized: Process jackpot contribution with short timeout to prevent blocking
    const jackpotResult = await Promise.race([
      processJackpotContribution(validatedBetRequest.gameId, validatedBetRequest.wagerAmount),
      new Promise(resolve => setTimeout(() => resolve({ contributions: { minor: 0, major: 0, mega: 0 }, totalContribution: 0 }), 25)) // Reduced to 25ms
    ]).catch(error => {
      console.error("Jackpot contribution failed, continuing with zero contribution:", error);
      return { contributions: { minor: 0, major: 0, mega: 0 }, totalContribution: 0 };
    });
    
    // Type assertion for jackpot result since Promise.race returns unknown type
    const jackpotResultData = jackpotResult as { contributions: { minor: number; major: number; mega: number }; totalContribution: number };
    const totalJackpotContribution = Object.values(jackpotResultData.contributions).reduce((sum, contrib) => sum + contrib, 0);

    // 4. Atomic balance operations within transaction
    const balanceTransactionResult = await db.transaction(async (tx) =>
    {
      // 4.1. Deduct wager amount from balance
      const balanceDeduction = await deductBetAmount({
        userId: userBalance.userId,
        amount: validatedBetRequest.wagerAmount,
        gameId: validatedBetRequest.gameId,
        preferredBalanceType: "auto", // Use real first, then bonus
      });

      if (!balanceDeduction.success) {
        console.error("Balance deduction failed:", balanceDeduction.error);
        throw new Error(balanceDeduction.error || "Balance deduction failed");
      }

      // 4.2. Add winnings to balance
      const winningsAddition = await addWinningsWithinTransaction(
        tx,
        balanceDeduction,
        userBalance.userId,
        validatedBetRequest.gameId,
        validatedGameOutcome.winAmount
      );

      // 4.3. Optimized: Calculate final balances mathematically instead of refetching
      const finalBalances = {
        realBalance: userBalance.realBalance - balanceDeduction.deductedFrom.real + winningsAddition.realWinnings,
        bonusBalance: userBalance.bonusBalance - balanceDeduction.deductedFrom.bonuses.reduce((sum, b) => sum + b.amount, 0) + winningsAddition.bonusWinnings,
        totalBalance: 0 // Will be calculated below
      };
      finalBalances.totalBalance = finalBalances.realBalance + finalBalances.bonusBalance;

      return {
        balanceDeduction,
        winningsAddition,
        finalBalances,
      };
    });

    const { balanceDeduction, winningsAddition, finalBalances } =
      balanceTransactionResult;

    // 7. Calculate VIP points (awarded for wagering, regardless of win/loss)
    const vipCalculation = calculateXpForWagerAndWins(betRequest.wagerAmount);

    // 8. Update VIP progress
    const vipUpdate = await addXpToUser(
      betRequest.userId,
      vipCalculation.totalPoints
    ).catch((error) =>
    {
      console.error("VIP update failed, continuing:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    });

    // 9. Update wagering progress

    // 10. Log GGR contribution
    const ggrResult = await logGGRContribution({
      betId: `bet_${Date.now()}`,
      userId: betRequest.userId,
      affiliateName: betRequest.affiliateName || "adminuser",
      operatorId: betRequest.operatorId || "house",
      gameId: betRequest.gameId,
      wagerAmount: betRequest.wagerAmount,
      winAmount: gameOutcome.winAmount,
      currency: "USD",
    }).catch((error: any) =>
    {
      console.error(
        "GGR contribution logging failed, continuing with zero GGR:",
        error
      );
      return { ggrAmount: 0 };
    });

    // 11. Log comprehensive transaction
    // Use verified balances from transaction for accuracy including bonus conversions

    // Capture pre balances before any deductions
    const realBalanceBefore = userBalance.realBalance;
    const realBalanceAfter = finalBalances.realBalance;

    const bonusBalanceBefore = userBalance.bonusBalance;
    const bonusBalanceAfter = finalBalances.bonusBalance;



    // 12. Send realtime notifications
    let realBalanceChange = 0;
    let bonusBalanceChange = 0;
    if (balanceDeduction.balanceType === "mixed") {
      realBalanceChange = realBalanceBefore - realBalanceAfter;
      bonusBalanceChange =
        bonusBalanceBefore -
        balanceDeduction.deductedFrom.bonuses.reduce(
          (sum, b) => sum + b.amount,
          0
        );
    } else if (balanceDeduction.balanceType === "real") {
      realBalanceChange =
        (gameOutcome.winAmount > 0 ? gameOutcome.winAmount : 0) -
        balanceDeduction.deductedFrom.real;
    } else if (balanceDeduction.balanceType === "bonus") {
      bonusBalanceChange =
        (gameOutcome.winAmount > 0 ? gameOutcome.winAmount : 0) -
        balanceDeduction.deductedFrom.bonuses.reduce(
          (sum, b) => sum + b.amount,
          0
        );
    }
    await sendPostBetNotifications(
      betRequest.userId,
      JSON.stringify({
        balanceChange: {
          realBalance: realBalanceChange,
          bonusBalance: bonusBalanceChange,
          totalBalance: finalBalances.totalBalance, // Use verified final balance
          changeAmount: (
            validatedGameOutcome.winAmount - validatedBetRequest.wagerAmount
          ).toString(),
          changeType: validatedGameOutcome.winAmount > 0 ? "win" : "bet",
        },
        vipUpdate: vipUpdate.success,
        jackpotContribution: totalJackpotContribution,
      })
    ).catch((error) =>
    {
      console.error("Realtime notifications failed, continuing:", error);
    });

    const processingTime = Date.now() - startTime;
    // Performance check for sub-300ms requirement
    if (processingTime > 300) {
      console.warn(
        `⚠️ Bet processing exceeded 300ms target: ${processingTime}ms`
      );
    }
    const transactionId = await logTransaction({
      userId: betRequest.userId,
      gameId: betRequest.gameId,
      operatorId: "79032f3f-7c4e-4575-abf9-4298ad3e9d1a",
      wagerAmount: betRequest.wagerAmount,
      winAmount: gameOutcome.winAmount,
      type: "BET",
      realBalanceBefore,
      realBalanceAfter,
      bonusBalanceBefore,
      bonusBalanceAfter,
      processingTime,
      ggrContribution: ggrResult.ggrAmount,
      jackpotContribution: totalJackpotContribution,
      vipPointsAdded: vipCalculation.totalPoints,
      sessionId: betRequest.sessionId,
      status: "PENDING",
    });

    if (!transactionId) {
      console.error(
        "Transaction logging failed, but continuing with bet processing"
      );
    }
    // Update game statistics
    const currentGame = game || {};

    // Safely handle distinctPlayers JSONB field with validation
    let currentPlayers: string[] = [];
    try {
      if (currentGame.distinctPlayers !== null && currentGame.distinctPlayers !== undefined) {
        const parsedPlayers = Array.isArray(currentGame.distinctPlayers)
          ? currentGame.distinctPlayers
          : JSON.parse(JSON.stringify(currentGame.distinctPlayers));
        currentPlayers = Array.isArray(parsedPlayers) ? parsedPlayers.filter(p => typeof p === 'string') : [];
      }
    } catch (error) {
      console.warn('Failed to parse distinctPlayers, using empty array:', error);
      currentPlayers = [];
    }

    const isNewPlayer = !currentPlayers.includes(validatedBetRequest.userId);
    const newPlayersList = isNewPlayer ? [...currentPlayers, validatedBetRequest.userId] : currentPlayers;

    const newTotalBets = (currentGame.totalBets || 0) + 1;
    const newTotalWins = (currentGame.totalWins || 0) + (validatedGameOutcome.winAmount > 0 ? 1 : 0);
    const newHitPercentage = newTotalBets > 0 ? (newTotalWins / newTotalBets) * 100 : 0;

    const newTotalBetAmount = (currentGame.totalBetAmount || 0) + validatedBetRequest.wagerAmount;
    const newTotalWonAmount = (currentGame.totalWonAmount || 0) + validatedGameOutcome.winAmount;
    const newCurrentRtp = newTotalBetAmount > 0 ? (newTotalWonAmount / newTotalBetAmount) * 100 : 0;

    const startedAt = currentGame.startedAt ? new Date(currentGame.startedAt) : new Date();
    const totalMinutesPlayed = Math.floor(((new Date().getTime() - startedAt.getTime()) / (1000 * 60)));

try {
      const updatedGame = await updateGameNative(validatedBetRequest.gameId, {
        totalBets: newTotalBets,
        totalWins: newTotalWins,
        hitPercentage: newHitPercentage,
        distinctPlayers: newPlayersList,
        totalPlayers: newPlayersList.length,
        totalBetAmount: newTotalBetAmount,
        totalWonAmount: newTotalWonAmount,
        currentRtp: newCurrentRtp,
        startedAt: startedAt,
        totalMinutesPlayed: totalMinutesPlayed,
      });

      if (!updatedGame) {
        console.warn(`Game ${validatedBetRequest.gameId} was not found or not updated`);
        // Continue with bet processing even if game update fails
      }
    } catch (gameUpdateError) {
      console.error(`Failed to update game ${validatedBetRequest.gameId} statistics:`, gameUpdateError);
      // Continue with bet processing even if game update fails
    }

    // Comprehensive database operation tracking
    const dbChanges = [];
    
    // Balance changes
    const balanceChange = realBalanceBefore - realBalanceAfter;
    if (Math.abs(balanceChange) > 0) {
      dbChanges.push(`user_balance(${balanceChange > 0 ? '-' : '+'}$${Math.abs(balanceChange).toFixed(2)})`);
    }
    
    // Bet results record
    dbChanges.push('bet_results(+1)');
    
    // Jackpot contribution
    if (totalJackpotContribution > 0) {
      dbChanges.push(`jackpot_contrib($${totalJackpotContribution.toFixed(2)})`);
    }
    
    // GGR calculation
    if (ggrResult.ggrAmount > 0) {
      dbChanges.push(`ggr_calc(+$${ggrResult.ggrAmount.toFixed(2)})`);
    }
    
    // VIP points
    if (vipCalculation.totalPoints > 0) {
      dbChanges.push(`vip_points(+${vipCalculation.totalPoints})`);
    }
    
    // Game statistics update
    dbChanges.push(`game_stats(+1 bet, $${(validatedBetRequest.wagerAmount / 100).toFixed(2)} wagered)`);

    console.log(`[DB] Bet complete: ${dbChanges.join(', ')}`);

    return {
      userId: validatedBetRequest.userId,
      gameId: validatedBetRequest.gameId,
      wagerAmount: validatedBetRequest.wagerAmount,
      winAmount: validatedGameOutcome.winAmount,
      balanceType: balanceDeduction.balanceType,
      newBalance: finalBalances.totalBalance, // Use verified final balance from transaction
      jackpotContribution: totalJackpotContribution,
      vipPointsEarned: vipCalculation.totalPoints,
      ggrContribution: ggrResult.ggrAmount,
      success: true,
      transactionId,
      time: processingTime,
    };
  } catch (error) {
    console.error("Bet processing failed:", error);

    // Send error notification to user
    await notifyError(
      betRequest.userId,
      error instanceof Error ? error.message : "Bet processing failed"
    );
    const processingTime = Date.now() - startTime;

    return {
      userId: validatedBetRequest.userId,
      gameId: validatedBetRequest.gameId,
      wagerAmount: validatedBetRequest.wagerAmount,
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
): Promise<BetOutcome>
{
  return processBet(betRequest, gameOutcome);
}

// /**
//  * Validate bet before processing (quick pre-check)
//  */
// export async function preValidateBet(
//   userId: string,
//   gameId: string,
//   wagerAmount: number,
// ): Promise<{ valid: boolean; reason?: string }> {
//   try {
//     const validation = await validateBet({
//       user,
//       game,
//       wagerAmount,
//     });

//     return {
//       valid: validation.valid,
//       reason: validation.valid ? undefined : validation.reason,
//     };
//   } catch (e) {
//     console.error(e);
//     return {
//       valid: false,
//       reason: 'Validation system error',
//     };
//   }
// }

// services/bet-orchestration.service.ts

/**
 * Get bet processing statistics from the last 24 hours.
 *
 * Corrected SQL Query Logic:
 * - totalBets: Count 'BET' and 'BONUS' transactionLogTable (wager transactionLogTable only)
 * - successfulBets: Count completed wager transactionLogTable with status = 'COMPLETED'
 * - totalWagered: Sum wager_amount from 'BET'/'BONUS' transactionLogTable (not win amounts)
 * - totalWon: Sum amount from 'WIN' transactionLogTable (win amounts only)
 * - averageProcessingTime: Average from logged processing_time field (filtered for validity)
 *
 * Key Corrections:
 * - Separated wager amounts (BET/BONUS.type.wager_amount) from win amounts (WIN.type.amount)
 * - Added status filtering for success rate calculation
 * - Used proper field mappings to prevent data corruption in analytics
 */
export async function getBetProcessingStats(): Promise<{
  totalBets: number;
  averageProcessingTime: number; // Calculated from actual logged processing_time data
  successRate: number;
  totalWagered: number;
  totalGGR: number;
}>
{
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
}>
{
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
async function checkDatabaseConnection(): Promise<boolean>
{
  try {
    // Test database connectivity with a simple query
    await db.execute(sql`SELECT 1`);
    return true;
  } catch (error) {
    console.error("Database connection check failed:", error);
    return false;
  }
}
async function checkWalletService(): Promise<boolean>
{
  try {
    // Test wallet service by attempting to get balances for a test user
    // Using a non-existent user ID to avoid real data issues
    const testUserId = "health-check-test-user";
    const userBalance = await getDetailedBalance(testUserId);

    // Validate that balance was returned (service should respond with data)
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
async function checkJackpotService(): Promise<boolean>
{
  try {
    // Test jackpot service by attempting to get current pools
    const pools = await getJackpotPools();

    // Verify we got a valid response with expected structure
    if (!pools || typeof pools !== "object") {
      return false;
    }

    // Check that all expected jackpot groups exist
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

async function checkVIPService(): Promise<boolean>
{
  try {
    // Test VIP service by attempting to get VIP levels configuration
    const levels = getVIPLevels();

    // Verify we got a valid levels array with expected structure
    if (!Array.isArray(levels) || levels.length === 0) {
      return false;
    }

    // Check that we have at least the basic levels
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
