/** biome-ignore-all lint/suspicious/noExplicitAny: <> */
import {
  notifyError,
} from "../../shared/notifications.service";
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
