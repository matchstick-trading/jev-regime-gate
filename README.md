# jev-regime-gate

Jev-powered regime gate for trading strategy backtests. Uses TypeSafe's [Jev](https://typesafe.ai) decision model to classify market regimes on daily bars, then gates a strategy by regime compatibility and confidence.

**Research experiment, not investment advice.**

## Pipeline

1. **Encode** — daily OHLCV → pre-bucketed feature summary (no raw prices to Jev)
2. **Classify** — one POST to Jev with three typed questions: `regime_type`, `regime_change_likely`, `strategy_viable`
3. **Gate** — trade / stand down / scale size based on regime fit + confidence
4. **Compare** — same strategy, same period: gated vs ungated equity curves

Results are stored per bar in [OpenCandle](https://github.com/matchstick-trading/opencandle) `meta` fields.

## Usage

```bash
cp .env.example .env  # add your OpenRouter API key
npm install
npm run fetch-data    # pull daily bars
npm start             # run backtest
```

## Schema

Each bar's `meta.jev` contains:

```json
{
  "regime_type": "trend_up",
  "regime_max_p": 0.82,
  "regime_change_likely": 0.23,
  "strategy_viable": 0.91,
  "gate_decision": "trade",
  "size_factor": 1.0
}
```

## License

MIT — [Matchstick Trading](https://github.com/matchstick-trading)
