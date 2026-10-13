export interface RiskConfig {
  stake: number;
  profitTarget: number;
  maxLoss: number;
  maxDailyLoss: number;
  dailyNetProfit: number;
  maxTrades: number;
  maxConcurrent: number;
  maxConsecutiveLosses: number;
  cooldownSeconds: number;
  balance: number;
  consecutiveLosses: number;
  settledCount: number;
  enteredCount: number;
  openCount: number;
  sessionNetProfit: number;
  lastTradeAt: number | null;
  now?: number;
}

export interface RiskDecision {
  allowed: boolean;
  reason: string;
}

export function validateRisk(config: RiskConfig): RiskDecision {
  const now = config.now ?? Date.now();
  if (!Number.isFinite(config.stake) || config.stake <= 0) return { allowed: false, reason: 'Stake must be a positive number.' };
  if (!Number.isFinite(config.maxLoss) || config.maxLoss <= 0) return { allowed: false, reason: 'Maximum loss must be greater than zero.' };
  if (!Number.isFinite(config.maxDailyLoss) || config.maxDailyLoss <= 0) return { allowed: false, reason: 'Maximum daily loss must be greater than zero.' };
  if (!Number.isFinite(config.profitTarget) || config.profitTarget <= 0) return { allowed: false, reason: 'Profit target must be greater than zero.' };
  if (!Number.isFinite(config.balance) || config.balance < config.stake) return { allowed: false, reason: 'Insufficient available balance for the configured stake.' };
  if (config.enteredCount >= config.maxTrades) return { allowed: false, reason: 'Maximum number of session trades reached.' };
  if (config.openCount >= config.maxConcurrent) return { allowed: false, reason: 'Maximum concurrent open contracts reached.' };
  if (config.consecutiveLosses >= config.maxConsecutiveLosses) return { allowed: false, reason: 'Consecutive-loss safety limit reached.' };
  if (config.sessionNetProfit >= config.profitTarget) return { allowed: false, reason: 'Session profit target reached.' };
  if (config.sessionNetProfit <= -config.maxLoss) return { allowed: false, reason: 'Session maximum loss reached.' };
  if (config.dailyNetProfit <= -config.maxDailyLoss) return { allowed: false, reason: 'Daily maximum loss reached.' };
  if (config.lastTradeAt !== null && now - config.lastTradeAt < config.cooldownSeconds * 1000) {
    const remaining = Math.ceil((config.cooldownSeconds * 1000 - (now - config.lastTradeAt)) / 1000);
    return { allowed: false, reason: `Entry cooldown active for ${remaining}s.` };
  }
  return { allowed: true, reason: 'Risk checks passed.' };
}

export function getSessionMetrics(trades: Array<{ stake: number; payout: number | null; profit: number | null; status: string }>) {
  const settled = trades.filter((trade) => trade.status === 'won' || trade.status === 'lost');
  return {
    totalStake: trades.filter((trade) => ['open', 'won', 'lost'].includes(trade.status)).reduce((sum, trade) => sum + (Number.isFinite(trade.stake) ? trade.stake : 0), 0),
    totalPayout: settled.reduce((sum, trade) => sum + (trade.payout ?? 0), 0),
    contractsWon: settled.filter((trade) => trade.status === 'won').length,
    contractsLost: settled.filter((trade) => trade.status === 'lost').length,
    settledTrades: settled.length,
    totalProfitLoss: settled.reduce((sum, trade) => sum + (trade.profit ?? 0), 0),
  };
}
