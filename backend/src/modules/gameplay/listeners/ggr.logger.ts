import { logGGRContribution } from "../../../shared/ggr.service";

export async function onBetCompleted(payload: any) {
  const { betRequest, gameOutcome } = payload;
  const { userId, affiliateName, operatorId, gameId, wagerAmount } = betRequest;
  const { winAmount } = gameOutcome;

  try {
    await logGGRContribution({
      betId: `bet_${Date.now()}`,
      userId,
      affiliateName: affiliateName || "adminuser",
      operatorId: operatorId || "house",
      gameId,
      wagerAmount,
      winAmount,
      currency: "USD",
    });
  } catch (error) {
    console.error("GGR contribution logging failed, continuing:", error);
  }
}
