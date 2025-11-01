// Unit tests for the refactored BotService
import { describe, expect, it, vi } from 'vitest';
import
{
    BotAuthenticationError,
    BotInitializationError,
    BotOperationError,
    BotService,
    BotServiceError,
    createBotService
} from './bot.service';

// Mock dependencies
const mockSupabase = {
    auth: {
        signUp: vi.fn(),
        signInWithPassword: vi.fn(),
    },
};

const mockDb = {
    query: {
        gameTable: {
            findMany: vi.fn(),
        },
        userTable: {
            findFirst: vi.fn(),
        },
        gameSessionTable: {
            findFirst: vi.fn(),
        },
    },
    insert: vi.fn(),
};

const mockBalanceService = {
    getOrCreateBalance: vi.fn(),
};

const mockBetService = {
    processBet: vi.fn(),
};

const mockDepositService = {
    initiateDeposit: vi.fn(),
    processDepositConfirmation: vi.fn(),
};

describe('BotService', () =>
{
    let botService: BotService;

    beforeEach(() =>
    {
        vi.clearAllMocks();

        const dependencies = {
            supabaseClient: mockSupabase,
            database: mockDb,
            balanceService: mockBalanceService,
            betService: mockBetService,
            depositService: mockDepositService,
        };

        botService = createBotService(
            {
                betInterval: 1000,
                minWager: 100,
                maxWager: 1000,
                gameName: null,
            },
            dependencies
        );
    });

    describe('Error Classes', () =>
    {
        it('should create BotServiceError with correct properties', () =>
        {
            const error = new BotServiceError('Test error', 'TEST_CODE', 'test cause');

            expect(error.message).toBe('Test error');
            expect(error.code).toBe('TEST_CODE');
            expect(error.cause).toBe('test cause');
            expect(error.name).toBe('BotServiceError');
        });

        it('should create BotInitializationError with correct code', () =>
        {
            const error = new BotInitializationError('Init failed', 'test cause');

            expect(error.code).toBe('BOT_INITIALIZATION_FAILED');
            expect(error.name).toBe('BotInitializationError');
        });

        it('should create BotAuthenticationError with correct code', () =>
        {
            const error = new BotAuthenticationError('Auth failed', 'test cause');

            expect(error.code).toBe('BOT_AUTHENTICATION_FAILED');
            expect(error.name).toBe('BotAuthenticationError');
        });

        it('should create BotOperationError with correct code', () =>
        {
            const error = new BotOperationError('Operation failed', 'test cause');

            expect(error.code).toBe('BOT_OPERATION_FAILED');
            expect(error.name).toBe('BotOperationError');
        });
    });

    describe('Configuration', () =>
    {
        it('should use default configuration when no config provided', () =>
        {
            const defaultBot = new BotService();
            const status = defaultBot.getStatus();

            expect(status.config.betInterval).toBe(5000);
            expect(status.config.minWager).toBe(100);
            expect(status.config.maxWager).toBe(1000);
            expect(status.config.gameName).toBeNull();
        });

        it('should merge custom configuration with defaults', () =>
        {
            const customBot = new BotService({
                betInterval: 2000,
                maxWager: 2000,
            });

            const status = customBot.getStatus();

            expect(status.config.betInterval).toBe(2000);
            expect(status.config.maxWager).toBe(2000);
            expect(status.config.minWager).toBe(100); // default
            expect(status.config.gameName).toBeNull(); // default
        });

        it('should update configuration at runtime', () =>
        {
            botService.updateConfig({
                betInterval: 3000,
                minWager: 200,
            });

            const status = botService.getStatus();

            expect(status.config.betInterval).toBe(3000);
            expect(status.config.minWager).toBe(200);
            expect(status.config.maxWager).toBe(1000); // unchanged
        });
    });

    describe('Status and Metrics', () =>
    {
        it('should return correct initial status', () =>
        {
            const status = botService.getStatus();

            expect(status.isRunning).toBe(false);
            expect(status.userId).toBeNull();
            expect(status.sessionToken).toBeNull();
            expect(status.gameId).toBeNull();
            expect(status.gameName).toBeNull();
            expect(status.lastActivity).toBeNull();
        });

        it('should return zero metrics initially', () =>
        {
            const metrics = botService.getMetrics();

            expect(metrics.uptime).toBe(0);
            expect(metrics.totalBets).toBe(0);
            expect(metrics.successRate).toBe(0);
            expect(metrics.totalWagered).toBe(0);
            expect(metrics.totalWon).toBe(0);
        });
    });

    describe('Service Lifecycle', () =>
    {
        it('should not start when already running', async () =>
        {
            // First set it as running
            Object.defineProperty(botService, 'isRunning', { value: true });

            await expect(botService.start()).resolves.not.toThrow();
        });

        it('should stop correctly', () =>
        {
            // Set some state
            Object.defineProperty(botService, 'isRunning', { value: true });
            Object.defineProperty(botService, 'sessionToken', { value: 'test-token' });

            botService.stop();

            const status = botService.getStatus();

            expect(status.isRunning).toBe(false);
            expect(status.sessionToken).toBeNull();
        });
    });

    describe('Dependency Injection', () =>
    {
        it('should use provided dependencies', () =>
        {
            const customDeps = {
                supabaseClient: mockSupabase,
                database: mockDb,
                balanceService: mockBalanceService,
                betService: mockBetService,
                depositService: mockDepositService,
            };

            const service = createBotService({}, customDeps);

            expect(service).toBeInstanceOf(BotService);
        });

        it('should fall back to default dependencies when not provided', () =>
        {
            const service = createBotService();

            expect(service).toBeInstanceOf(BotService);
        });
    });
});

describe('Bot Service Factory Functions', () =>
{
    it('should create bot service with factory function', () =>
    {
        const service = createBotService({
            betInterval: 1000,
        });

        expect(service).toBeInstanceOf(BotService);

        const status = service.getStatus();
        expect(status.config.betInterval).toBe(1000);
    });
});