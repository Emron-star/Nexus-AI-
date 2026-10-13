import { describe, expect, it } from 'vitest';
import { evaluateStrategy, getDigitCounts, getLastDigit, type TickPoint, type StrategyConfig } from '../server/trading/strategy';
import { getSessionMetrics, validateRisk } from '../server/trading/risk';

const cfg = (overrides: Partial<StrategyConfig> = {}): StrategyConfig => ({
  strategy: 'matches', window: 20, minConfidence: 0.18, durationTicks: 1,
  momentumThreshold: 0.62, digitPolicy: 'most-frequent', matchesMode: 'matches', overBarrier: 8, overUnderMode: 'over', evenOddPolicy: 'majority',
  ...overrides,
});
const ticks = (digits: number[]): TickPoint[] => digits.map((digit, index) => ({
  quote: 100 + index / 100 + digit / 10000, epoch: 1_700_000_000 + index, digit,
}));

describe('strategy engine', () => {
  it('extracts the last digit using configured quote precision', () => {
    expect(getLastDigit(123.47, 2)).toBe(7);
    expect(getLastDigit(123.4, 2)).toBe(0);
  });
  it('derives displayed precision from Deriv pip-size increments', () => {
    expect(getLastDigit(123.4567, 0.0001)).toBe(7);
    expect(getLastDigit(123.456, 0.001)).toBe(6);
  });
  it('counts only valid digits', () => {
    expect(getDigitCounts(ticks([1, 1, 9, 9, 9]).concat([{ quote: 1, epoch: 9, digit: 20 } as TickPoint]))[9]).toBe(3);
  });
  it('does not emit a signal before the window is full', () => {
    expect(evaluateStrategy(ticks([1, 1, 1]), cfg()).eligible).toBe(false);
  });
  it('selects a dominant digit when a clear margin exists', () => {
    const data = Array.from({ length: 20 }, (_, i) => i < 11 ? 7 : i % 9);
    const result = evaluateStrategy(ticks(data), cfg());
    expect(result.eligible).toBe(true);
    expect(result.contractType).toBe('DIGITMATCH');
    expect(result.barrier).toBe('7');
    expect(result.confidence).toBeCloseTo(12 / 20);
  });
  it('can select the least frequent digit with an appropriate low-frequency threshold', () => {
    const data = [0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9];
    const result = evaluateStrategy(ticks(data), cfg({ digitPolicy: 'least-frequent', minConfidence: 0.04 }));
    expect(result.eligible).toBe(true);
    expect(result.predictedDigit).toBe(9);
    expect(result.confidence).toBeCloseTo(0.05);
  });
  it('returns a valid no-signal metric for Over/Under when the baseline is not exceeded', () => {
    const data = Array.from({ length: 20 }, (_, index) => index % 10);
    const result = evaluateStrategy(ticks(data), cfg({ strategy: 'overunder', overBarrier: 8, overUnderMode: 'over' }));
    expect(result.eligible).toBe(false);
    expect(result.metric).toBeDefined();
    expect(Number.isFinite(result.metric)).toBe(true);
  });
  it('supports an explicitly configured Under digit contract', () => {
    const data = Array.from({ length: 20 }, (_, index) => index === 19 ? 9 : index % 8);
    const result = evaluateStrategy(ticks(data), cfg({ strategy: 'overunder', overBarrier: 8, overUnderMode: 'under' }));
    expect(result.eligible).toBe(true);
    expect(result.contractType).toBe('DIGITUNDER');
    expect(result.barrier).toBe('8');
    expect(result.confidence).toBeCloseTo(19 / 20);
  });
  it('selects the majority even/odd side only when the observed split clears the baseline screen', () => {
    const data = Array.from({ length: 20 }, (_, index) => index < 13 ? 2 : 1);
    const result = evaluateStrategy(ticks(data), cfg({ strategy: 'evenodd', evenOddPolicy: 'majority' }));
    expect(result.eligible).toBe(true);
    expect(result.contractType).toBe('DIGITEVEN');
    expect(result.barrier).toBeUndefined();
    expect(result.confidence).toBeCloseTo(13 / 20);
  });
  it('supports an explicitly configured odd contract without a digit barrier', () => {
    const data = Array.from({ length: 20 }, (_, index) => index < 14 ? 3 : 2);
    const result = evaluateStrategy(ticks(data), cfg({ strategy: 'evenodd', evenOddPolicy: 'odd' }));
    expect(result.eligible).toBe(true);
    expect(result.contractType).toBe('DIGITODD');
    expect(result.barrier).toBeUndefined();
  });
  it('does not emit an even/odd signal at the 50/50 baseline', () => {
    const data = Array.from({ length: 20 }, (_, index) => index % 2);
    const result = evaluateStrategy(ticks(data), cfg({ strategy: 'evenodd', evenOddPolicy: 'majority' }));
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('uniform baseline 50%');
  });
  it('checks availability of Even/Odd contracts', () => {
    const data = Array.from({ length: 20 }, (_, index) => index < 14 ? 2 : 1);
    const result = evaluateStrategy(ticks(data), cfg({ strategy: 'evenodd' }), () => false);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain('DIGITEVEN');
  });
  it('rejects an unavailable contract type', () => {
    const data = Array.from({ length: 20 }, (_, i) => i < 11 ? 7 : i % 9);
    expect(evaluateStrategy(ticks(data), cfg(), () => false).reason).toContain('not an available contract');
  });
  it('identifies upward tick momentum transparently', () => {
    const data = Array.from({ length: 20 }, (_, i) => ({ quote: 100 + i, epoch: i, digit: i % 10 }));
    const result = evaluateStrategy(data, cfg({ strategy: 'risefall', minConfidence: 0.18 }));
    expect(result.eligible).toBe(true);
    expect(result.contractType).toBe('CALL');
  });
});

describe('risk and accounting', () => {
  const base = { stake: 1, profitTarget: 10, maxLoss: 5, maxDailyLoss: 20, dailyNetProfit: 0, maxTrades: 10, maxConcurrent: 1,
    maxConsecutiveLosses: 3, cooldownSeconds: 0, balance: 100, consecutiveLosses: 0,
    settledCount: 0, enteredCount: 0, openCount: 0, sessionNetProfit: 0, lastTradeAt: null, now: 1000 };
  it('allows a trade when all limits pass', () => expect(validateRisk(base).allowed).toBe(true));
  it('blocks when balance is too small', () => expect(validateRisk({ ...base, balance: 0.5 }).reason).toContain('Insufficient'));
  it('blocks at the maximum loss', () => expect(validateRisk({ ...base, sessionNetProfit: -5 }).reason).toContain('maximum loss'));
  it('rejects invalid daily loss configuration', () => expect(validateRisk({ ...base, maxDailyLoss: 0 }).reason).toContain('daily loss must be greater than zero'));
  it('blocks at the profit target', () => expect(validateRisk({ ...base, sessionNetProfit: 10 }).reason).toContain('profit target'));
  it('blocks at the daily loss limit', () => expect(validateRisk({ ...base, dailyNetProfit: -20 }).reason).toContain('Daily maximum loss'));
  it('blocks before another entry would exceed the total trade cap, even while the first contract is open', () => expect(validateRisk({ ...base, maxTrades: 1, enteredCount: 1, openCount: 1 }).reason).toContain('Maximum number of session trades'));
  it('blocks during the entry cooldown', () => expect(validateRisk({ ...base, lastTradeAt: 900, cooldownSeconds: 1 }).allowed).toBe(false));
  it('does not count pending trades as settled wins or payouts', () => {
    const result = getSessionMetrics([
      { stake: 1, payout: 0, profit: -1, status: 'lost' },
      { stake: 1, payout: null, profit: null, status: 'open' },
      { stake: 2, payout: 3.7, profit: 1.7, status: 'won' },
      { stake: 7, payout: null, profit: null, status: 'pending' },
    ]);
    expect(result.totalStake).toBe(4);
    expect(result.totalPayout).toBe(3.7);
    expect(result.contractsWon).toBe(1);
    expect(result.contractsLost).toBe(1);
    expect(result.totalProfitLoss).toBeCloseTo(0.7);
  });
});

