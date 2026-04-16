/**
 * TypeScript types mirroring regime-trader's state.json structure.
 * These are read-only -- ClaudeClaw never writes trading state.
 */

export type RegimeLabel =
  | 'CRASH'
  | 'STRONG_BEAR'
  | 'WEAK_BEAR'
  | 'NEUTRAL'
  | 'WEAK_BULL'
  | 'STRONG_BULL'
  | 'EUPHORIA';

export interface RegimeState {
  bar: number;
  date: string;
  regime: RegimeLabel;
  confidence: number;
  vol_rank: number;
  target_allocation: number;
}

export interface RegimeInfo {
  state_id: number;
  label: RegimeLabel;
  mean_return: number;
  expected_volatility: number;
  stationary_probability: number;
}

export interface PositionState {
  symbol: string;
  qty: number;
  entry_price: number;
  current_price: number;
  unrealized_pnl: number;
}

export interface RiskState {
  daily_dd_pct: number;
  peak_dd_pct: number;
  leverage: number;
  circuit_breakers: Record<string, boolean>;
}

export interface RecentSignal {
  bar: number;
  date: string;
  regime: string;
  confidence: number;
  vol_rank: number;
  target_allocation: number;
}

export interface InstanceState {
  mode: 'paper' | 'live' | 'backtest';
  market_open: boolean;
  equity: number;
  cash: number;
  buying_power: number;
  regime: RegimeState;
  risk: RiskState;
  positions: PositionState[];
  regime_infos: RegimeInfo[];
  recent_signals: RecentSignal[];
}

export interface TradingAlert {
  type: 'regime_change' | 'circuit_breaker' | 'instance_down' | 'instance_halted' | 'instance_stale';
  instance: string;
  message: string;
  timestamp: number;
}

/** Regime label → display color (matches regime-trader dashboard) */
export const REGIME_COLORS: Record<RegimeLabel, string> = {
  CRASH: '#DC2626',
  STRONG_BEAR: '#EF4444',
  WEAK_BEAR: '#FB923C',
  NEUTRAL: '#A3A3A3',
  WEAK_BULL: '#86EFAC',
  STRONG_BULL: '#22C55E',
  EUPHORIA: '#059669',
};
