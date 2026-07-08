export interface PaperLimitConfig {
  paperCapitalUsd: number;
  maxTradeUsd: number;
  maxOpenPositions: number;
  maxDeployedPct: number;
}

export interface PaperLimitSummary extends PaperLimitConfig {
  openSlotsRemaining: number;
  maxDeployedUsd: number;
  deployedPct: number | null;
  deployedRemainingUsd: number;
}

export function buildPaperLimitSummary(args: {
  openTradeCount: number;
  openExposureUsd: number;
  config: PaperLimitConfig;
}): PaperLimitSummary {
  const maxDeployedUsd = args.config.paperCapitalUsd * args.config.maxDeployedPct;
  return {
    ...args.config,
    openSlotsRemaining: Math.max(0, args.config.maxOpenPositions - args.openTradeCount),
    maxDeployedUsd,
    deployedPct: args.config.paperCapitalUsd > 0 ? args.openExposureUsd / args.config.paperCapitalUsd : null,
    deployedRemainingUsd: Math.max(0, maxDeployedUsd - args.openExposureUsd),
  };
}
