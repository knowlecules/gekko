/*
  Plateau Seeker Strategy
  
  This strategy identifies market pumps and dumps, then waits for the market
  to plateau (stabilize) before executing trades at optimal limit prices.
  
  Strategy Logic:
  1. Detect mini_pump: Price rises by mini_pump_percentage over mini_pump_candles
  2. Wait for plateau: Price stabilizes for plateau_candles_count
  3. Set sell limit close to upper plateau boundary
  4. Detect mini_dump: Price drops by mini_dump_percentage over mini_dump_candles
  5. Wait for plateau: Price stabilizes for plateau_candles_count
  6. Set buy limit close to lower plateau boundary
  
  Uses tranches (trade_amount_percentage) to allow multiple consecutive trades.
*/

var log = require('../core/log.js');
var _ = require('lodash');

var method = {};

// Initialize the strategy
method.init = function() {
  // Strategy settings with defaults
  this.settings = _.defaults(this.settings, {
    investment: 10000,
    trade_amount_percentage: 10,
    initial_trade_percentage: 50,  // Initial trade is 50% of investment
    plateau_candles_count: 6,
    mini_dump_candles: 12,
    mini_dump_percentage: 2.0,
    mini_pump_candles: 12,
    mini_pump_percentage: 2.5,
    sell_plateau_percentage: 90,
    buy_plateau_percentage: 90,
    plateau_threshold: 0.3  // Max % change per candle to be considered "stable"
  });

  // State tracking
  this.trend = {
    direction: 'none',
    duration: 0,
    persisted: false,
    adviced: false
  };

  // Market state
  this.state = {
    detected_pump: false,
    detected_dump: false,
    in_plateau: false,
    plateau_count: 0,
    pump_high: 0,
    dump_low: 0,
    plateau_high: 0,
    plateau_low: 0,
    sell_limit: 0,
    buy_limit: 0,
    position: 'flat'  // 'long', 'short', or 'flat'
  };

  // Tranche tracking for position sizing
  // Initial trade uses 50% of investment, remaining 50% split into 10% tranches = 5 subsequent trades
  const initialTradeSize = (this.settings.investment * this.settings.initial_trade_percentage) / 100;
  const subsequentTradeSize = (this.settings.investment * this.settings.trade_amount_percentage) / 100;
  const remainingAfterInitial = this.settings.investment - initialTradeSize;
  const maxSubsequentTrades = Math.floor(remainingAfterInitial / subsequentTradeSize);
  
  this.tranches = {
    total_investment: this.settings.investment,
    initial_trade_size: initialTradeSize,      // First trade is 50% of investment
    tranche_size: subsequentTradeSize,         // Subsequent trades are 10% each
    is_first_trade: true,                      // Track if this is the first trade
    capital_used: 0,                           // Track total capital committed
    long_tranches: 0,                          // Number of buy tranches executed in current cycle
    short_tranches: 0,                         // Number of sell tranches executed in current cycle
    max_subsequent_trades: maxSubsequentTrades, // Max 5 subsequent trades (50% / 10% = 5)
    total_buy_tranches: 0,                     // Total buys across all cycles
    total_sell_tranches: 0,                    // Total sells across all cycles
    total_initial_trades: 0,                   // Track initial trades executed
    total_subsequent_trades: 0                 // Track subsequent trades executed
  };

  log.info('[Plateau Seeker] Tranche configuration:');
  log.info('  - Total investment:', this.tranches.total_investment);
  log.info('  - Initial trade amount:', this.tranches.initial_trade_size, '(' + this.settings.initial_trade_percentage + '% of investment)');
  log.info('  - Subsequent trade amount:', this.tranches.tranche_size, '(' + this.settings.trade_amount_percentage + '% of investment)');
  log.info('  - Max subsequent trades after initial:', this.tranches.max_subsequent_trades);

  // Rolling window of candles for analysis
  this.candle_history = [];
  this.max_history = Math.max(
    this.settings.mini_pump_candles,
    this.settings.mini_dump_candles,
    this.settings.plateau_candles_count
  ) + 5;

  this.requiredHistory = this.tradingAdvisor.historySize;

  log.info('[Plateau Seeker] Strategy initialized');
  log.info('[Plateau Seeker] Settings:', JSON.stringify(this.settings, null, 2));
};

// Called on every new candle
method.update = function(candle) {
  // Add candle to history
  this.candle_history.push({
    close: candle.close,
    high: candle.high,
    low: candle.low,
    open: candle.open,
    start: candle.start
  });

  // Maintain rolling window
  if (this.candle_history.length > this.max_history) {
    this.candle_history.shift();
  }

  // Only proceed if we have enough history
  if (this.candle_history.length < this.settings.mini_pump_candles) {
    return;
  }

  // Current price
  const currentPrice = candle.close;
  const previousCandle = this.candle_history[this.candle_history.length - 2];
  const priceChange = previousCandle ? ((currentPrice - previousCandle.close) / previousCandle.close) * 100 : 0;

  // Detect mini pump
  const pumpDetected = this.detectMiniPump();
  if (pumpDetected && !this.state.detected_pump) {
    // Reset tranche counters for new pump cycle
    this.tranches.short_tranches = 0;
    
    this.state.detected_pump = true;
    this.state.detected_dump = false;
    this.state.pump_high = currentPrice;
    this.state.plateau_count = 0;
    this.state.in_plateau = false;
    log.info('[Plateau Seeker] Mini PUMP detected at price:', currentPrice.toFixed(2));
  }

  // Detect mini dump
  const dumpDetected = this.detectMiniDump();
  if (dumpDetected && !this.state.detected_dump) {
    // Reset tranche counters for new dump cycle
    this.tranches.long_tranches = 0;
    
    this.state.detected_dump = true;
    this.state.detected_pump = false;
    this.state.dump_low = currentPrice;
    this.state.plateau_count = 0;
    this.state.in_plateau = false;
    log.info('[Plateau Seeker] Mini DUMP detected at price:', currentPrice.toFixed(2));
  }

  // Update plateau tracking
  if (this.state.detected_pump || this.state.detected_dump) {
    this.updatePlateauTracking(currentPrice, priceChange);
  }
};

// Detect if price has risen by mini_pump_percentage over mini_pump_candles
// Must find low BEFORE high to ensure upward movement (not just volatility)
method.detectMiniPump = function() {
  if (this.candle_history.length < this.settings.mini_pump_candles) {
    return false;
  }

  const recentCandles = this.candle_history.slice(-this.settings.mini_pump_candles);
  
  // Find the lowest low and its index
  let lowestLow = Infinity;
  let lowestIndex = -1;
  for (let i = 0; i < recentCandles.length; i++) {
    if (recentCandles[i].low < lowestLow) {
      lowestLow = recentCandles[i].low;
      lowestIndex = i;
    }
  }
  
  // Find the highest high AFTER the lowest low
  let highestHigh = -Infinity;
  for (let i = lowestIndex; i < recentCandles.length; i++) {
    if (recentCandles[i].high > highestHigh) {
      highestHigh = recentCandles[i].high;
    }
  }
  
  // Calculate rise from low to subsequent high
  const percentChange = ((highestHigh - lowestLow) / lowestLow) * 100;

  return percentChange >= this.settings.mini_pump_percentage;
};

// Detect if price has dropped by mini_dump_percentage over mini_dump_candles
// Must find high BEFORE low to ensure downward movement (not just volatility)
method.detectMiniDump = function() {
  if (this.candle_history.length < this.settings.mini_dump_candles) {
    return false;
  }

  const recentCandles = this.candle_history.slice(-this.settings.mini_dump_candles);
  
  // Find the highest high and its index
  let highestHigh = -Infinity;
  let highestIndex = -1;
  for (let i = 0; i < recentCandles.length; i++) {
    if (recentCandles[i].high > highestHigh) {
      highestHigh = recentCandles[i].high;
      highestIndex = i;
    }
  }
  
  // Find the lowest low AFTER the highest high
  let lowestLow = Infinity;
  for (let i = highestIndex; i < recentCandles.length; i++) {
    if (recentCandles[i].low < lowestLow) {
      lowestLow = recentCandles[i].low;
    }
  }
  
  // Calculate drop from high to subsequent low
  const percentChange = ((lowestLow - highestHigh) / highestHigh) * 100;

  return percentChange <= -this.settings.mini_dump_percentage;
};

// Track plateau formation and set limits
method.updatePlateauTracking = function(currentPrice, priceChange) {
  const isStable = Math.abs(priceChange) <= this.settings.plateau_threshold;

  if (isStable) {
    this.state.plateau_count++;
    
    // Update plateau boundaries
    if (this.state.plateau_count === 1) {
      this.state.plateau_high = currentPrice;
      this.state.plateau_low = currentPrice;
    } else {
      this.state.plateau_high = Math.max(this.state.plateau_high, currentPrice);
      this.state.plateau_low = Math.min(this.state.plateau_low, currentPrice);
    }

    // Check if we've reached plateau
    if (this.state.plateau_count >= this.settings.plateau_candles_count && !this.state.in_plateau) {
      this.state.in_plateau = true;
      this.setTradeLimits();
    }
  } else {
    // Reset ALL plateau state if price becomes unstable before confirmation
    // This prevents stale limits from executing
    if (this.state.plateau_count < this.settings.plateau_candles_count) {
      this.resetPlateauState();
    } else if (this.state.in_plateau) {
      // If already in confirmed plateau but volatility returns, invalidate everything
      this.resetPlateauState();
    }
  }
};

// Reset all plateau-related state to prevent stale orders
method.resetPlateauState = function() {
  this.state.detected_pump = false;
  this.state.detected_dump = false;
  this.state.in_plateau = false;
  this.state.plateau_count = 0;
  this.state.plateau_high = 0;
  this.state.plateau_low = 0;
  this.state.sell_limit = 0;
  this.state.buy_limit = 0;
  
  // Reset cycle-specific tranche counters (allows new cycle to execute max_tranches)
  this.tranches.long_tranches = 0;
  this.tranches.short_tranches = 0;
};

// Set buy/sell limits based on plateau boundaries
method.setTradeLimits = function() {
  if (this.state.detected_pump && this.state.in_plateau) {
    // After pump, set sell limit near upper plateau boundary
    const plateauRange = this.state.plateau_high - this.state.plateau_low;
    const targetFromLow = plateauRange * (this.settings.sell_plateau_percentage / 100);
    this.state.sell_limit = this.state.plateau_low + targetFromLow;
    
    log.info('[Plateau Seeker] SELL limit set:', this.state.sell_limit.toFixed(2),
      'Plateau range:', this.state.plateau_low.toFixed(2), '-', this.state.plateau_high.toFixed(2));
  }

  if (this.state.detected_dump && this.state.in_plateau) {
    // After dump, set buy limit near lower plateau boundary
    const plateauRange = this.state.plateau_high - this.state.plateau_low;
    const targetFromHigh = plateauRange * (this.settings.buy_plateau_percentage / 100);
    this.state.buy_limit = this.state.plateau_high - targetFromHigh;
    
    log.info('[Plateau Seeker] BUY limit set:', this.state.buy_limit.toFixed(2),
      'Plateau range:', this.state.plateau_low.toFixed(2), '-', this.state.plateau_high.toFixed(2));
  }
};

// Main decision logic
method.check = function() {
  if (this.candle_history.length === 0) {
    this.advice();
    return;
  }

  const currentPrice = this.candle_history[this.candle_history.length - 1].close;

  // Check for sell signal (after pump, during plateau)
  // Can execute multiple sell tranches if limit continues to be met
  if (this.state.detected_pump && 
      this.state.in_plateau && 
      this.state.sell_limit > 0) {
    
    // Check if we can still trade (either first trade or have remaining subsequent capacity)
    const canTrade = this.tranches.is_first_trade || 
                     (this.tranches.total_subsequent_trades < this.tranches.max_subsequent_trades);
    
    if (currentPrice >= this.state.sell_limit && canTrade) {
      
      // Determine trade amount: first trade is 50%, subsequent are 10%
      const isFirstTrade = this.tranches.is_first_trade;
      const currentTradeSize = isFirstTrade ? 
        this.tranches.initial_trade_size : this.tranches.tranche_size;
      const currentPercentage = isFirstTrade ?
        this.settings.initial_trade_percentage : this.settings.trade_amount_percentage;
      
      // Update capital tracking
      this.tranches.capital_used += currentTradeSize;
      
      if (isFirstTrade) {
        this.tranches.is_first_trade = false;
        this.tranches.total_initial_trades++;
      } else {
        this.tranches.total_subsequent_trades++;
      }
      
      this.tranches.short_tranches++;
      this.tranches.total_sell_tranches++;
      const remainingCapacity = this.tranches.max_subsequent_trades - this.tranches.total_subsequent_trades;
      
      log.warn('[Plateau Seeker] SELL signal', isFirstTrade ? '(INITIAL TRADE - 50%)' : '(subsequent trade)',
        'at', currentPrice.toFixed(2), 
        '(limit:', this.state.sell_limit.toFixed(2), ')',
        'Amount:', currentTradeSize.toFixed(2),
        '(' + currentPercentage + '% of investment)',
        '| Capital used:', this.tranches.capital_used.toFixed(2),
        '| Remaining subsequent capacity:', remainingCapacity);
      
      this.state.position = 'short';
      
      this.trend = {
        direction: 'short',
        duration: 1,
        persisted: true,
        adviced: false
      };
      
      if (!this.trend.adviced) {
        this.trend.adviced = true;
        
        // Include strategy state info for chart tooltips
        this.advice({
          direction: 'short',
          trigger: {
            type: 'trailingStop',
            trailPercentage: currentPercentage
          },
          strategyState: {
            trigger: 'SELL after pump plateau',
            isInitialTrade: isFirstTrade,
            tradePercentage: currentPercentage,
            tradeAmount: currentTradeSize,
            capitalUsed: this.tranches.capital_used,
            detected_pump: this.state.detected_pump,
            detected_dump: this.state.detected_dump,
            in_plateau: this.state.in_plateau,
            plateau_count: this.state.plateau_count,
            sell_limit: this.state.sell_limit,
            buy_limit: this.state.buy_limit,
            plateau_high: this.state.plateau_high,
            plateau_low: this.state.plateau_low
          }
        });
        return;
      }
    }
  }

  // Check for buy signal (after dump, during plateau)
  // Can execute multiple buy tranches if limit continues to be met
  if (this.state.detected_dump && 
      this.state.in_plateau && 
      this.state.buy_limit > 0) {
    
    // Check if we can still trade (either first trade or have remaining subsequent capacity)
    const canTrade = this.tranches.is_first_trade || 
                     (this.tranches.total_subsequent_trades < this.tranches.max_subsequent_trades);
    
    if (currentPrice <= this.state.buy_limit && canTrade) {
      
      // Determine trade amount: first trade is 50%, subsequent are 10%
      const isFirstTrade = this.tranches.is_first_trade;
      const currentTradeSize = isFirstTrade ? 
        this.tranches.initial_trade_size : this.tranches.tranche_size;
      const currentPercentage = isFirstTrade ?
        this.settings.initial_trade_percentage : this.settings.trade_amount_percentage;
      
      // Update capital tracking
      this.tranches.capital_used += currentTradeSize;
      
      if (isFirstTrade) {
        this.tranches.is_first_trade = false;
        this.tranches.total_initial_trades++;
      } else {
        this.tranches.total_subsequent_trades++;
      }
      
      this.tranches.long_tranches++;
      this.tranches.total_buy_tranches++;
      const remainingCapacity = this.tranches.max_subsequent_trades - this.tranches.total_subsequent_trades;
      
      log.warn('[Plateau Seeker] BUY signal', isFirstTrade ? '(INITIAL TRADE - 50%)' : '(subsequent trade)',
        'at', currentPrice.toFixed(2), 
        '(limit:', this.state.buy_limit.toFixed(2), ')',
        'Amount:', currentTradeSize.toFixed(2),
        '(' + currentPercentage + '% of investment)',
        '| Capital used:', this.tranches.capital_used.toFixed(2),
        '| Remaining subsequent capacity:', remainingCapacity);
      
      this.state.position = 'long';
      
      this.trend = {
        direction: 'long',
        duration: 1,
        persisted: true,
        adviced: false
      };
      
      if (!this.trend.adviced) {
        this.trend.adviced = true;
        
        // Include strategy state info for chart tooltips
        this.advice({
          direction: 'long',
          trigger: {
            type: 'trailingStop',
            trailPercentage: currentPercentage
          },
          strategyState: {
            trigger: 'BUY after dump plateau',
            isInitialTrade: isFirstTrade,
            tradePercentage: currentPercentage,
            tradeAmount: currentTradeSize,
            capitalUsed: this.tranches.capital_used,
            detected_pump: this.state.detected_pump,
            detected_dump: this.state.detected_dump,
            in_plateau: this.state.in_plateau,
            plateau_count: this.state.plateau_count,
            sell_limit: this.state.sell_limit,
            buy_limit: this.state.buy_limit,
            plateau_high: this.state.plateau_high,
            plateau_low: this.state.plateau_low
          }
        });
        return;
      }
    }
  }

  this.advice();
};

// Debug logging
method.log = function() {
  if (this.candle_history.length === 0) return;

  const currentPrice = this.candle_history[this.candle_history.length - 1].close;
  const totalTrades = this.tranches.total_initial_trades + this.tranches.total_subsequent_trades;
  
  log.debug('[Plateau Seeker] Price:', currentPrice.toFixed(2),
    '| Pump:', this.state.detected_pump,
    '| Dump:', this.state.detected_dump,
    '| Plateau:', this.state.in_plateau,
    '| Count:', this.state.plateau_count,
    '| Sell@:', this.state.sell_limit.toFixed(2),
    '| Buy@:', this.state.buy_limit.toFixed(2),
    '| Capital used:', this.tranches.capital_used.toFixed(2),
    '| Total trades:', totalTrades);
};

// End of backtest summary
method.end = function() {
  const totalTrades = this.tranches.total_buy_tranches + this.tranches.total_sell_tranches;
  
  log.info('[Plateau Seeker] ========== BACKTEST SUMMARY ==========');
  log.info('  - Total Investment:', this.tranches.total_investment.toFixed(2));
  log.info('  - Initial Trade Size:', this.tranches.initial_trade_size.toFixed(2),
    '(' + this.settings.initial_trade_percentage + '% of investment)');
  log.info('  - Subsequent Trade Size:', this.tranches.tranche_size.toFixed(2),
    '(' + this.settings.trade_amount_percentage + '% of investment)');
  log.info('  - Max Subsequent Trades:', this.tranches.max_subsequent_trades);
  log.info('  - Initial Trades Executed:', this.tranches.total_initial_trades);
  log.info('  - Subsequent Trades Executed:', this.tranches.total_subsequent_trades);
  log.info('  - Total Trades:', totalTrades, 
    '(Buys:', this.tranches.total_buy_tranches, '| Sells:', this.tranches.total_sell_tranches + ')');
  log.info('  - Total Capital Used:', this.tranches.capital_used.toFixed(2),
    '(' + ((this.tranches.capital_used / this.tranches.total_investment) * 100).toFixed(1) + '% of investment)');
  log.info('[Plateau Seeker] =======================================');
};

module.exports = method;
