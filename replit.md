# Gekko Trading Bot - Replit Edition

## Project Overview
This is a Bitcoin/cryptocurrency trading bot built with Node.js that connects to various exchanges for automated trading and backtesting. The repository was imported from https://github.com/knowlecules/gekko.git

## Key Features
- Automated cryptocurrency trading strategies
- Paper trading mode for safe testing
- Backtesting capabilities on historical data
- Web-based UI built with Vue.js
- Multiple custom trading strategies
- Support for various cryptocurrency exchanges (Binance, Bitfinex, etc.)

## Project Structure
- `/core` - Core trading engine and bot logic
- `/strategies` - Trading strategy implementations
- `/exchange` - Exchange API integrations
- `/plugins` - Additional plugins for notifications, performance tracking, etc.
- `/web` - Web interface (Koa server + Vue.js frontend)
- `/config` - Configuration files for exchanges and strategies
- `/test` - Test suite

## Custom Strategies
This fork includes custom trading strategies:
- Time graduated acceptable buy and sell
- Pre-crash fix optimized for SOL
- Sell after pump / Buy below sell logic

## Development Environment
- Node.js version: >= 8.11.2 (required)
- Main dependencies: Koa, Vue.js, SQLite, WebSockets
- Package manager: npm

## Running the Bot

### Start with Web UI
```bash
node gekko.js --ui
```
or
```bash
npm start
```

### Start with a specific config
```bash
node gekko.js --config config.js
```

### Backtest a strategy
```bash
node gekko.js --config config.js --backtest
```

## Configuration
- Main config: `sample-config.js` (copy and customize)
- Exchange-specific configs available in `/config` directory
- Strategy parameters can be configured in the web UI or config files

## Important Notes
- ⚠️ **USE AT YOUR OWN RISK** - This is a trading bot that can use real money
- Always test strategies with paper trading first
- Review and understand the code before using with real funds
- The bot automates YOUR trading strategies - make sure you understand what it will do

## Web Interface
When started with `--ui` flag, Gekko launches a web server (default port 3000) where you can:
- Configure trading strategies
- Run backtests
- Monitor live trading
- View performance metrics
- Manage multiple exchange configurations

## Recent Changes (from fork)
- Jun 16, 2023: Time graduated acceptable buy and sell strategy
- May 23, 2023: Pre-crash fix working well with SOL
- May 16, 2023: Sell after pump, buy below sell strategy
- Dec 8, 2018: Multiple API key support for different exchange accounts

## User Preferences
- Development mode: Edit and test trading strategies safely
- Preferred workflow: Start with paper trading, backtest, then optionally use live trading
