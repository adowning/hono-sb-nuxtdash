import { processJackpotContribution } from "../../jackpots/jackpot.service";

export async function onBetCompleted(payload: any) {
  const { gameId, wagerAmount } = payload.betRequest;
  try {
    await processJackpotContribution(gameId, wagerAmount);
  } catch (error) {
    console.error(
      "Jackpot contribution failed, continuing with zero contribution:",
      error
    );
  }
}
