/**
 * Jackpot contribution system with 3 groups: minor, major, mega
 * Admin-configurable rates and game group assignments
 */

import type { Jackpot } from "@/libs/database/schema";
import { jackpotGroupEnum } from "@/libs/database/schema";
import { configurationManager } from "@/shared/config";

export type JackpotGroup = (typeof jackpotGroupEnum.enumValues)[number];

// export type JackpotGroup = 'minor' | 'major' | 'mega';

export interface JackpotConfig {
  minor: {
    rate: number; // Contribution rate (e.g., 0.02 for 2%)
    seedAmount: number; // Reset amount when won
    maxAmount?: number; // Optional maximum cap
  };
  major: {
    rate: number;
    seedAmount: number;
    maxAmount?: number;
  };
  mega: {
    rate: number;
    seedAmount: number;
    maxAmount?: number;
  };
}

export interface JackpotPool {
  group: JackpotGroup;
  currentAmount: number;
  totalContributions: number;
  totalWins: number;
  lastWinDate?: Date;
  lastWinAmount?: number;
}

export interface JackpotContribution {
  gameId: string;
  wagerAmount: number; // Amount in cents
  contributions: {
    minor: number;
    major: number;
    mega: number;
  };
  timestamp: Date;
}

export interface JackpotWin {
  group: JackpotGroup;
  gameId: string;
  userId: string;
  winAmount: number;
  timestamp: Date;
}

/**
 * Default jackpot configuration - should be admin configurable
 */
const DEFAULT_JACKPOT_CONFIG: JackpotConfig = {
  minor: {
    rate: 0.02, // 2%
    seedAmount: 100000, // $1,000
    maxAmount: 1000000, // $10,000 cap
  },
  major: {
    rate: 0.01, // 1%
    seedAmount: 1000000, // $10,000
    maxAmount: 10000000, // $100,000 cap
  },
  mega: {
    rate: 0.005, // 0.5%
    seedAmount: 10000000, // $100,000
    maxAmount: 100000000, // $1,000,000 cap
  },
};

/**
 * In-memory jackpot pools - in production, this should be in Redis/database
 * For now, using simple in-memory storage with file persistence potential
 */
class JackpotManager {
  private pools: Map<JackpotGroup, JackpotPool> = new Map();
  private contributions: JackpotContribution[] = [];
  private config: JackpotConfig;

  constructor() {
    const settings = configurationManager.getConfiguration();

    this.config = settings.jackpotConfig;
    this.initializePools();
  }

  private initializePools() {
    // const now = new Date();
    this.pools.set("minor", {
      group: "minor",
      currentAmount: this.config.minor.seedAmount,
      totalContributions: 0,
      totalWins: 0,
    });

    this.pools.set("major", {
      group: "major",
      currentAmount: this.config.major.seedAmount,
      totalContributions: 0,
      totalWins: 0,
    });

    this.pools.set("mega", {
      group: "mega",
      currentAmount: this.config.mega.seedAmount,
      totalContributions: 0,
      totalWins: 0,
    });
  }

  /**
   * Get current jackpot configuration
   */
  getConfig(): JackpotConfig {
    return { ...this.config };
  }

  /**
   * Update jackpot configuration (admin function)
   */
  updateConfig(newConfig: Partial<JackpotConfig>) {
    this.config = { ...this.config, ...newConfig };

    // Reset pools with new seed amounts if changed
    for (const [group, pool] of this.pools) {
      if (newConfig[group]?.seedAmount !== undefined) {
        const seedAmount = newConfig[group]?.seedAmount;
        if (seedAmount !== undefined) {
          pool.currentAmount = seedAmount;
        }
      }
    }
  }

  /**
   * Get current jackpot pool for a group
   */
  getPool(group: JackpotGroup): JackpotPool {
    const pool = this.pools.get(group);
    if (!pool) {
      throw new Error(`Jackpot pool not found for group: ${group}`);
    }
    return { ...pool };
  }

  /**
   * Get all jackpot pools
   */
  getAllPools(): Record<JackpotGroup, JackpotPool> {
    return {
      minor: this.getPool("minor"),
      major: this.getPool("major"),
      mega: this.getPool("mega"),
    };
  }

  /**
   * Process jackpot contribution from a bet
   */
  contribute(
    gameId: string,
    wagerAmount: number
  ): {
    contributions: Record<JackpotGroup, number>;
    totalContribution: number;
  } {
    // Determine which jackpot group(s) this game contributes to
    const gameJackpotGroups = this.getGameJackpotGroups(gameId);

    if (gameJackpotGroups.length === 0) {
      return {
        contributions: { minor: 0, major: 0, mega: 0 },
        totalContribution: 0,
      };
    }

    const contributions: Record<JackpotGroup, number> = {
      minor: 0,
      major: 0,
      mega: 0,
    };

    let totalContribution = 0;

    // Calculate contributions for each applicable group
    for (const group of gameJackpotGroups) {
      const rate = this.config[group].rate;
      const contribution = Math.floor(wagerAmount * rate);

      if (contribution > 0) {
        contributions[group] = contribution;
        totalContribution += contribution;

        // Update pool
        const pool = this.pools.get(group);
        if (!pool) {
          continue; // Skip if pool doesn't exist
        }
        const maxAmount = this.config[group].maxAmount;

        // Check if adding contribution would exceed max
        if (maxAmount && pool.currentAmount + contribution > maxAmount) {
          // Cap at maximum and log overflow
          const actualContribution = maxAmount - pool.currentAmount;
          pool.currentAmount = maxAmount;
          pool.totalContributions += actualContribution;
          contributions[group] = actualContribution;
          totalContribution =
            totalContribution - contribution + actualContribution;
        } else {
          pool.currentAmount += contribution;
          pool.totalContributions += contribution;
        }
      }
    }

    // Log contribution for tracking
    if (totalContribution > 0) {
      this.logContribution(gameId, wagerAmount, contributions);
    }

    return { contributions, totalContribution };
  }

  /**
   * Process jackpot win
   */
  processWin(
    group: JackpotGroup,
    gameId: string,
    userId: string,
    winAmount?: number
  ): { success: boolean; actualWinAmount: number; error?: string } {
    const pool = this.pools.get(group);
    if (!pool) {
      return {
        success: false,
        actualWinAmount: 0,
        error: "Invalid jackpot group",
      };
    }

    // Use provided win amount or current pool amount
    const actualWinAmount = winAmount || pool.currentAmount;

    if (actualWinAmount <= 0) {
      return {
        success: false,
        actualWinAmount: 0,
        error: "Invalid win amount",
      };
    }

    // Update pool
    pool.currentAmount -= actualWinAmount;
    pool.totalWins += actualWinAmount;
    pool.lastWinDate = new Date();
    pool.lastWinAmount = actualWinAmount;

    // Reset to seed amount if pool goes negative
    if (pool.currentAmount < 0) {
      pool.currentAmount = this.config[group].seedAmount;
    }

    // Log win
    this.logWin(group, gameId, userId, actualWinAmount);

    return { success: true, actualWinAmount };
  }

  /**
   * Get jackpot groups for a specific game (admin-configurable)
   */
  getGameJackpotGroups(_gameId: string): JackpotGroup[] {
    // This should be configurable per game by admin
    // For now, using a simple mapping based on game type/category
    // In production, this should come from a game_jackpot_groups table

    // This is a placeholder - in reality, you'd query a game configuration
    // For now, returning minor for all games
    return ["minor"];
  }

  /**
   * Log jackpot contribution for tracking
   */
  private logContribution(
    gameId: string,
    wagerAmount: number,
    contributions: Record<JackpotGroup, number>
  ) {
    const contribution: JackpotContribution = {
      gameId,
      wagerAmount,
      contributions,
      timestamp: new Date(),
    };

    this.contributions.push(contribution);

    // Keep only last 1000 contributions in memory
    if (this.contributions.length > 1000) {
      this.contributions = this.contributions.slice(-1000);
    }
  }

  /**
   * Log jackpot win for tracking
   */
  private logWin(
    group: JackpotGroup,
    gameId: string,
    userId: string,
    amount: number
  ) {
    const win: JackpotWin = {
      group,
      gameId,
      userId,
      winAmount: amount,
      timestamp: new Date(),
    };

    // In production, this should be stored in database
    console.log("Jackpot win logged:", win);
  }

  /**
   * Get recent contributions for a game
   */
  getGameContributions(
    gameId: string,
    limit: number = 10
  ): JackpotContribution[] {
    return this.contributions.filter((c) => c.gameId === gameId).slice(-limit);
  }

  /**
   * Get statistics for all jackpot groups
   */
  getStatistics(): {
    pools: Record<JackpotGroup, JackpotPool>;
    totalContributions: number;
    totalWins: number;
    totalGamesContributing: number;
  } {
    const pools = this.getAllPools();
    const totalContributions = Array.from(this.pools.values()).reduce(
      (sum, pool) => sum + pool.totalContributions,
      0
    );
    const totalWins = Array.from(this.pools.values()).reduce(
      (sum, pool) => sum + pool.totalWins,
      0
    );

    // Count unique games that have contributed
    const contributingGames = new Set(this.contributions.map((c) => c.gameId));
    const totalGamesContributing = contributingGames.size;

    return {
      pools,
      totalContributions,
      totalWins,
      totalGamesContributing,
    };
  }
}

// Global jackpot manager instance
export const jackpotManager = new JackpotManager();

/**
 * Process jackpot contribution for a bet
 */
export async function processJackpotContribution(
  gameId: string,
  wagerAmount: number
): Promise<{
  contributions: Record<JackpotGroup, number>;
  totalContribution: number;
}> {
  return jackpotManager.contribute(gameId, wagerAmount);
}

/**
 * Process jackpot win
 */
export async function processJackpotWin(
  group: JackpotGroup,
  gameId: string,
  userId: string,
  winAmount?: number
): Promise<{ success: boolean; actualWinAmount: number; error?: string }> {
  return jackpotManager.processWin(group, gameId, userId, winAmount);
}

/**
 * Get current jackpot pools
 */
export async function getJackpotPools(): Promise<Record<JackpotGroup, JackpotPool>> {
  return jackpotManager.getAllPools();
}

/**
 * Get jackpot pool for specific group
 */
export async function getJackpotPool(group: JackpotGroup): Promise<JackpotPool> {
  return jackpotManager.getPool(group);
}

/**
 * Update jackpot configuration (admin function)
 */
export async function updateJackpotConfig(
  config: Partial<JackpotConfig>
): Promise<void> {
  jackpotManager.updateConfig(config);
}

/**
 * Get jackpot statistics
 */
export async function getJackpotStatistics() {
  return jackpotManager.getStatistics();
}

/**
 * Check if game contributes to any jackpot
 */
export async function doesGameHaveJackpot(gameId: string): Promise<boolean> {
  const groups = jackpotManager.getGameJackpotGroups(gameId);
  return groups.length > 0;
}

/**
 * Get contribution rate for a specific game and jackpot group
 */
export async function getGameContributionRate(
  gameId: string,
  group: JackpotGroup
): Promise<number> {
  const groups = jackpotManager.getGameJackpotGroups(gameId);
  return groups.includes(group) ? jackpotManager.getConfig()[group].rate : 0;
}
