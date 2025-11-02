import {
  addXpToUser,
  calculateXpForWagerAndWins,
} from "../vip.service";

export async function onBetCompleted(payload: any) {
  const { userId, wagerAmount } = payload;
  const vipCalculation = calculateXpForWagerAndWins(wagerAmount);
  try {
    await addXpToUser(userId, vipCalculation.totalPoints);
  } catch (error) {
    console.error("VIP update failed, continuing:", error);
  }
}
