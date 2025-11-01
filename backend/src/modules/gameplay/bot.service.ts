import { supabase } from "@/libs/supabase/client";
import { and, eq } from "drizzle-orm";
import { getOrCreateBalance } from "./balance-management.service";

import { db } from "@/libs/database/db";
import { gameSessionTable, userTable } from "@/libs/database/schema";
import { v4 as uuidv4 } from 'uuid';
import { type BetRequest, processBet } from "./bet-orchestration.service";
import
{
  initiateDeposit,
  PaymentMethod,
  processDepositConfirmation,
} from "./deposit.service";

// Custom error types for better error handling
export class BotServiceError extends Error
{
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown
  )
  {
    super(message);
    this.name = "BotServiceError";
  }
}

export class BotInitializationError extends BotServiceError
{
  constructor(message: string, cause?: unknown)
  {
    super(message, "BOT_INITIALIZATION_FAILED", cause);
    this.name = "BotInitializationError";
  }
}

export class BotAuthenticationError extends BotServiceError
{
  constructor(message: string, cause?: unknown)
  {
    super(message, "BOT_AUTHENTICATION_FAILED", cause);
    this.name = "BotAuthenticationError";
  }
}

export class BotOperationError extends BotServiceError
{
  constructor(message: string, cause?: unknown)
  {
    super(message, "BOT_OPERATION_FAILED", cause);
    this.name = "BotOperationError";
  }
}

// Interface for bot configuration
export interface BotConfig
{
  betInterval: number; // in milliseconds
  minWager: number; // in cents
  maxWager: number; // in cents
  gameName: string | null;
  depositAmount?: number; // in cents
  maxDepositAttempts?: number;
}

// Interface for bot status
export interface BotStatus
{
  isRunning: boolean;
  userId: string | null;
  sessionToken: string | null;
  config: BotConfig;
  gameId: string | null;
  gameName: string | null;
  lastActivity: Date | null;
}

// Interface for deposit operation result
export interface DepositOperationResult
{
  success: boolean;
  balance?: {
    realBalance: number;
    bonusBalance: number;
    totalBalance: number;
  };
  error?: string;
}

// Interface for bet operation result
export interface BetOperationResult
{
  success: boolean;
  result?: {
    winAmount: number;
    newBalance: number;
    transactionId?: string;
  };
  error?: string;
}

// Interface for bot dependencies (dependency injection)
export interface BotServiceDependencies
{
  supabaseClient: typeof supabase;
  database: typeof db;
  balanceService: {
    getOrCreateBalance: (userId: string) => Promise<any>;
  };
  betService: {
    processBet: (betRequest: BetRequest, gameOutcome: any) => Promise<any>;
  };
  depositService: {
    initiateDeposit: (request: any) => Promise<any>;
    processDepositConfirmation: (confirmation: any) => Promise<any>;
  };
}

const DEFAULT_CONFIG: BotConfig = {
  betInterval: 5000, // 5 seconds
  minWager: 100, // $1.00
  maxWager: 1000, // $10.00
  gameName: null,
  depositAmount: 50000, // $500.00
  maxDepositAttempts: 3,
};

export class BotService
{
  private userId: string | null = null;
  private sessionToken: string | null = null;
  private sessionId: string | null = null;
  private gameSessionId: string | null = null;
  private isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;
  private config: BotConfig;
  private gameName: string | null = null;
  private gameId: string | null = null;
  private lastActivity: Date | null = null;
  private depositAttempts = 0;
  private readonly dependencies: BotServiceDependencies;

  constructor(
    config: Partial<BotConfig> = {},
    dependencies?: Partial<BotServiceDependencies>
  )
  {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize dependencies with fallbacks
    this.dependencies = {
      supabaseClient: dependencies?.supabaseClient ?? supabase,
      database: dependencies?.database ?? db,
      balanceService: dependencies?.balanceService ?? { getOrCreateBalance },
      betService: dependencies?.betService ?? { processBet },
      depositService: dependencies?.depositService ?? {
        initiateDeposit,
        processDepositConfirmation,
      },
    };
  }

  /**
   * Initialize the bot with user authentication and game session setup
   */
  async initialize(): Promise<boolean>
  {
    try {
      const botUsername = "AutomatedBot";
      const botPassword = process.env.BOT_PASSWORD || "secure-bot-password";
      const botEmail = "bot@example.com";

      // Validate configuration
      if (this.config.betInterval < 1000) {
        throw new BotInitializationError(
          "Bet interval must be at least 1000ms"
        );
      }

      // Get available games
      const allGames = await this.dependencies.database.query.gameTable.findMany();

      if (!allGames || allGames.length === 0) {
        throw new BotInitializationError("No games available for bot initialization");
      }

      // Select random game
      const randomIndex = Math.floor(Math.random() * allGames.length);
      const selectedGame = allGames[randomIndex];

      if (!selectedGame || !selectedGame.id || !selectedGame.name) {
        throw new BotInitializationError("Invalid game data received");
      }

      this.gameName = selectedGame.name;
      this.gameId = selectedGame.id;

      // Find or create bot user
      const user = await this.findOrCreateBotUser(botUsername, botEmail, botPassword);

      if (!user || !user.id) {
        throw new BotInitializationError("Failed to find or create bot user");
      }

      this.userId = user.id;



      // Authenticate user
      await this.authenticateBotUser(botEmail, botPassword);

      // Set up game session
      await this.initializeGameSession();


      this.lastActivity = new Date();
      return true;
    } catch (error) {
      if (error instanceof BotServiceError) {
        throw error;
      }
      throw new BotInitializationError(
        "Failed to initialize bot",
        error
      );
    }
  }

  /**
   * Find or create bot user in the system
   */
  private async findOrCreateBotUser(
    username: string,
    email: string,
    password: string
  ): Promise<any>
  {
    // Try to find existing user
    let user = await this.dependencies.database.query.userTable.findFirst({
      where: eq(userTable.username, username),
    });

    if (user) {
      return user;
    }

    // Create new user through Supabase auth
    const signUpResult = await this.dependencies.supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: {
          username,
          name: "AutomatedBot",
        },
      },
    });

    if (signUpResult.error || !signUpResult.data.user) {
      throw new BotInitializationError(
        `Failed to create bot user: ${signUpResult.error?.message}`
      );
    }

    // Fetch complete user record from database
    user = await this.dependencies.database.query.userTable.findFirst({
      where: eq(userTable.id, signUpResult.data.user.id),
    });

    if (!user) {
      throw new BotInitializationError("Failed to retrieve created bot user");
    }

    return user;
  }

  /**
   * Initialize or retrieve game session for the bot
   */
  private async initializeGameSession(): Promise<void>
  {
    if (!this.userId || !this.gameId || !this.gameName) {
      throw new BotInitializationError("Missing required session data");
    }

    const sessionData = {
      id: uuidv4(),
      userId: this.userId,
      authSessionId: this.sessionId,
      status: "ACTIVE" as const,
      gameName: this.gameName,
      gameId: this.gameId,
    };
    this.gameSessionId = sessionData.id
    // Check for existing session
    const existingSession = await this.dependencies.database.query.gameSessionTable.findFirst({
      where: and(
        eq(gameSessionTable.userId, this.userId),
        eq(gameSessionTable.status, "ACTIVE"),
      ),
    });

    if (!existingSession) {
      // Create new session
      await this.dependencies.database.insert(gameSessionTable).values(sessionData);
    } else {
      // Update existing session data
      this.gameId = existingSession.gameId;
      this.gameName = existingSession.gameName;
    }
  }

  /**
   * Authenticate the bot user and store session token
   */
  private async authenticateBotUser(email: string, password: string): Promise<void>
  {
    const signInResult = await this.dependencies.supabaseClient.auth.signInWithPassword({
      email,
      password,
    });

    if (signInResult.error || !signInResult.data.session) {
      throw new BotAuthenticationError(
        `Failed to sign in bot user: ${signInResult.error?.message}`
      );
    }

    this.sessionToken = signInResult.data.session.access_token;
    const { data: { session }, error } = await supabase.auth.getSession();

    if (error) {
      console.error('Error getting session:', error.message);
      throw new BotAuthenticationError(
        `Failed to sign in bot user: ${signInResult.error}`
      );
    }

    if (session && session.access_token) {
      try {
        const sessionTokenParts = session.access_token.split('.');
        if (sessionTokenParts.length >= 2) {
          const tokenPayload = JSON.parse(Buffer.from(sessionTokenParts[1] as string, 'base64').toString('ascii'));
          this.sessionId = tokenPayload.session_id;
        }
      } catch (e) {
        console.error('Error parsing access token:', e);
      }
    }

  }

  /**
   * Make a deposit to ensure sufficient balance for betting
   */
  private async makeDeposit(amount: number): Promise<DepositOperationResult>
  {
    if (!this.userId || !this.sessionToken || !this.gameName) {
      return {
        success: false,
        error: "Bot not initialized or authenticated",
      };
    }

    if (this.depositAttempts >= (this.config.maxDepositAttempts ?? 3)) {
      return {
        success: false,
        error: "Maximum deposit attempts reached",
      };
    }

    try {
      this.depositAttempts++;

      // Get current balance
      const currentBalance = await this.dependencies.balanceService.getOrCreateBalance(this.userId);

      // Initiate deposit
      const depositResult = await this.dependencies.depositService.initiateDeposit({
        userId: this.userId,
        amount,
        bonusAmount: 0,
        paymentMethod: PaymentMethod.CASHAPP,
      });

      if (!depositResult.success || !depositResult.depositId) {
        return {
          success: false,
          error: depositResult.error || "Deposit initiation failed",
        };
      }

      // Process deposit confirmation
      const confirmationResult = await this.dependencies.depositService.processDepositConfirmation({
        transactionId: depositResult.depositId,
        amount,
        senderInfo: "bot",
        timestamp: new Date(),
        userId: this.userId,
      });

      if (!confirmationResult.success) {
        return {
          success: false,
          error: "Deposit confirmation failed",
        };
      }

      // Get updated balance
      const updatedBalance = await this.dependencies.balanceService.getOrCreateBalance(this.userId);

      // Verify sufficient balance
      const totalBalance = updatedBalance.realBalance + updatedBalance.bonusBalance;
      if (totalBalance < this.config.maxWager) {
        return {
          success: false,
          error: "Insufficient balance after deposit",
        };
      }

      this.lastActivity = new Date();
      return {
        success: true,
        balance: {
          realBalance: updatedBalance.realBalance,
          bonusBalance: updatedBalance.bonusBalance,
          totalBalance,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Deposit operation failed",
      };
    }
  }

  /**
   * Place a bet using the configured wager amount
   */
  private async placeBet(): Promise<BetOperationResult>
  {
    if (!this.userId || !this.sessionToken || !this.gameId) {
      return {
        success: false,
        error: "Bot not initialized or authenticated",
      };
    }

    try {
      // Get current balance
      const playerBalance = await this.dependencies.balanceService.getOrCreateBalance(this.userId);

      if (!playerBalance) {
        throw new BotOperationError("No balance found for user");
      }

      // Check if deposit is needed
      const totalBalance = playerBalance.realBalance + playerBalance.bonusBalance;
      let depositResult: DepositOperationResult | null = null;

      if (totalBalance < this.config.maxWager) {
        depositResult = await this.makeDeposit(this.config.depositAmount ?? 50000);

        if (!depositResult.success) {
          return {
            success: false,
            error: `Insufficient balance and deposit failed: ${depositResult.error}`,
          };
        }
      }

      // Calculate wager amount
      const finalBalance = depositResult?.success ? depositResult.balance! : {
        realBalance: playerBalance.realBalance,
        bonusBalance: playerBalance.bonusBalance,
        totalBalance,
      };

      const maxAllowedWager = Math.min(finalBalance.totalBalance, this.config.maxWager);
      const wagerAmount = Math.max(this.config.minWager, Math.min(500, maxAllowedWager));

      // Prepare bet request
      const betRequest: BetRequest = {
        userId: this.userId,
        gameId: this.gameId,
        wagerAmount,
        sessionId: this.gameSessionId as string,
        operatorId: "bot",
      };

      // Simulate game outcome
      const gameOutcome = {
        winAmount: Math.random() > 0.7 ? wagerAmount * 2 : 0,
        gameData: {},
      };

      // Process the bet
      const result = await this.dependencies.betService.processBet(betRequest, gameOutcome);

      this.lastActivity = new Date();
      console.log(result.transactionId[0])
      return {
        success: result.success,
        result: result.success ? {
          winAmount: gameOutcome.winAmount,
          newBalance: result.newBalance,
          transactionId: result.transactionId,
        } : undefined,
        error: result.success ? undefined : result.error,
      };
    } catch (error) {
      // Handle authentication errors by reinitializing
      if (this.isAuthenticationError(error)) {
        await this.reinitialize();
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : "Bet placement failed",
      };
    }
  }

  /**
   * Check if error is related to authentication
   */
  private isAuthenticationError(error: unknown): boolean
  {
    if (!(error instanceof Error)) return false;

    const message = error.message.toLowerCase();
    return (
      message.includes("session expired") ||
      message.includes("not authenticated") ||
      message.includes("unauthorized")
    );
  }

  /**
   * Reinitialize the bot after authentication issues
   */
  private async reinitialize(): Promise<void>
  {
    try {
      this.stop();
      await this.initialize();
    } catch (error) {
      throw new BotOperationError("Failed to reinitialize bot after session expiry", error);
    }
  }

  /**
   * Start the automated betting bot
   */
  async start(): Promise<void>
  {
    if (this.isRunning) {
      return;
    }

    // Ensure bot is initialized
    if (!this.userId) {
      const initialized = await this.initialize();
      if (!initialized) {
        throw new BotOperationError("Failed to initialize bot, cannot start");
      }
    }

    this.isRunning = true;
    this.depositAttempts = 0;

    // Place initial bet
    await this.placeBet();

    // Set up interval for subsequent bets
    this.intervalId = setInterval(async () =>
    {
      if (this.isRunning) {
        try {
          await this.placeBet();
        } catch (error) {
          // Log error but continue operation
          console.error("Scheduled bet failed:", error);
        }
      }
    }, this.config.betInterval);
  }

  /**
   * Stop the automated betting bot
   */
  stop(): void
  {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    this.sessionToken = null;
  }

  /**
   * Update bot configuration
   */
  updateConfig(newConfig: Partial<BotConfig>): void
  {
    this.config = { ...this.config, ...newConfig };

    // Restart interval if running and timing changed
    if (this.isRunning && newConfig.betInterval && newConfig.betInterval !== this.config.betInterval) {
      this.stop();
      this.start().catch(error =>
      {
        console.error("Failed to restart bot with new configuration:", error);
      });
    }
  }

  /**
   * Get current bot status
   */
  getStatus(): BotStatus
  {
    return {
      isRunning: this.isRunning,
      userId: this.userId,
      sessionToken: this.sessionToken ? "active" : null,
      config: this.config,
      gameId: this.gameId,
      gameName: this.gameName,
      lastActivity: this.lastActivity,
    };
  }

  /**
   * Get detailed bot metrics
   */
  getMetrics():
    {
      uptime: number;
      totalBets: number;
      successRate: number;
      totalWagered: number;
      totalWon: number;
    }
  {
    return {
      uptime: this.lastActivity ? Date.now() - this.lastActivity.getTime() : 0,
      totalBets: 0, // TODO: Implement tracking
      successRate: 0, // TODO: Implement tracking
      totalWagered: 0, // TODO: Implement tracking
      totalWon: 0, // TODO: Implement tracking
    };
  }
}

// Singleton instance for backward compatibility
export const botService = new BotService();

/**
 * Start manufactured gameplay with optional configuration
 */
export async function startManufacturedGameplay(
  config: Partial<BotConfig> = {}
): Promise<void>
{
  try {
    const bot = new BotService(config);
    await bot.start();

    // Replace singleton instance
    Object.assign(botService, bot);
  } catch (error) {
    if (error instanceof BotServiceError) {
      throw error;
    }
    throw new BotOperationError("Failed to start manufactured gameplay", error);
  }
}

/**
 * Stop manufactured gameplay
 */
export function stopManufacturedGameplay(): void
{
  botService.stop();
}

/**
 * Get bot service instance (for dependency injection testing)
 */
export function createBotService(
  config: Partial<BotConfig> = {},
  dependencies?: Partial<BotServiceDependencies>
): BotService
{
  return new BotService(config, dependencies);
}
