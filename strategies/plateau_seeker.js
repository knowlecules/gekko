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
method.detectMiniPump = function() {
  if (this.candle_history.length < this.settings.mini_pump_candles) {
    return false;
  }

  const recentCandles = this.candle_history.slice(-this.settings.mini_pump_candles);
  const startPrice = recentCandles[0].close;
  const endPrice = recentCandles[recentCandles.length - 1].close;
  const percentChange = ((endPrice - startPrice) / startPrice) * 100;

  return percentChange >= this.settings.mini_pump_percentage;
};

// Detect if price has dropped by mini_dump_percentage over mini_dump_candles
method.detectMiniDump = function() {
  if (this.candle_history.length < this.settings.mini_dump_candles) {
    return false;
  }

  const recentCandles = this.candle_history.slice(-this.settings.mini_dump_candles);
  const startPrice = recentCandles[0].close;
  const endPrice = recentCandles[recentCandles.length - 1].close;
  const percentChange = ((endPrice - startPrice) / startPrice) * 100;

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
    // Reset plateau tracking if price becomes unstable
    if (this.state.plateau_count < this.settings.plateau_candles_count) {
      this.state.plateau_count = 0;
      this.state.plateau_high = currentPrice;
      this.state.plateau_low = currentPrice;
    }
  }
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
  if (this.state.detected_pump && 
      this.state.in_plateau && 
      this.state.sell_limit > 0 &&
      this.state.position !== 'short') {
    
    if (currentPrice >= this.state.sell_limit) {
      log.warn('[Plateau Seeker] SELL signal at', currentPrice.toFixed(2), 
        '(limit:', this.state.sell_limit.toFixed(2), ')');
      
      this.state.position = 'short';
      this.state.detected_pump = false;
      this.state.in_plateau = false;
      this.state.sell_limit = 0;
      
      this.trend = {
        direction: 'short',
        duration: 1,
        persisted: true,
        adviced: false
      };
      
      if (!this.trend.adviced) {
        this.trend.adviced = true;
        this.advice('short');
        return;
      }
    }
  }

  // Check for buy signal (after dump, during plateau)
  if (this.state.detected_dump && 
      this.state.in_plateau && 
      this.state.buy_limit > 0 &&
      this.state.position !== 'long') {
    
    if (currentPrice <= this.state.buy_limit) {
      log.warn('[Plateau Seeker] BUY signal at', currentPrice.toFixed(2), 
        '(limit:', this.state.buy_limit.toFixed(2), ')');
      
      this.state.position = 'long';
      this.state.detected_dump = false;
      this.state.in_plateau = false;
      this.state.buy_limit = 0;
      
      this.trend = {
        direction: 'long',
        duration: 1,
        persisted: true,
        adviced: false
      };
      
      if (!this.trend.adviced) {
        this.trend.adviced = true;
        this.advice('long');
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
  
  log.debug('[Plateau Seeker] Price:', currentPrice.toFixed(2),
    '| Pump:', this.state.detected_pump,
    '| Dump:', this.state.detected_dump,
    '| Plateau:', this.state.in_plateau,
    '| Count:', this.state.plateau_count,
    '| Sell@:', this.state.sell_limit.toFixed(2),
    '| Buy@:', this.state.buy_limit.toFixed(2));
};

module.exports = method;
