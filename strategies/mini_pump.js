// This is a basic example strategy for Gekko.
// For more information on everything please refer
// to this document:
//
// https://gekko.wizb.it/docs/strategies/creating_a_strategy.html
//
// The example below is pretty bad investment advice: on every new candle there is
// a 10% chance it will recommend to change your position (to either
// long or short).

const { should } = require('chai');
var log = require('../core/log');

const Broker = require('../exchange/GekkoBroker');
const states = require('../exchange/orders/states');
const { tradeAccounts } = require("../SECRET-api-keys.json");


// Let's create our own strat
var strat = {};
let traders = [];
let tradePairs = {};

// Prepare everything our method needs
strat.init = function () {
  this.input = 'candle';
  this.currentTrend = 'long';
  this.buyAt = 0;
  this.sellAt = 0;
  this.requiredHistory = 1;
  this.trend = {};
  const { currency, exchange, asset } = this.settings;

  if (!exchange) {
    this.pumpState = '';
    this.shouldSell = false;
    this.shouldBuy = false;
    this.buyOnInit = true;
    return;
  }
  const account = tradeAccounts[Object.keys(tradeAccounts)[0]]
  const { key, secret } = account;

  let trader = new Broker({
    currency,
    asset,
    exchange,
    private: true,
    key,
    secret,
    passphrase: 'z',
    customInterval: 100
  });
  traders.push(trader);
  trader.sync(console.log);
}

// what happens on every new candle?
/* {'start':'2023-05-10T14:35:00.000Z',
  'open':28213.48,
  'high':28223.9,
  'low':28213.48,
  'close':28223.9,
  'vwp':28222.241765275594,
  'volume':2.488280000000002,
  'trades':202}"
*/
let pumpInit = 0;
let dumpInit = 0;
let tradeMode = 'short';
let plateauRange = 0;
let hasPlateaud = false;
let longTrades = [];
strat.update = function (candle) {

  this.candle = candle;
  const { close, open, low, high } = candle;
  const { riseReq, dropReq, riseTrigger, trendFlip, plateauCandles, plateauMargin, bearFactor, trailingHistoryCount, dipFactor } = this.settings;
  let isDumping = getDumpState(candle, bearFactor, trailingHistoryCount);

  if (this.buyOnInit) {
    this.buyOnInit = false;
    this.shouldBuy = true;
    this.sellAt = (1 + riseReq) * close;
    this.close = close
    this.buyAt = close
    this.lastBuyAt = close
    storeLongTrades(candle);
    return;
  }

  this.rise = (close - open) / close;

  this.shouldBuy = false;
  this.shouldSell = false;
  this.pumpState = '';

  // A sell watch is triggered on tall(ish) bull candles 
  if (!pumpInit && this.rise >= riseTrigger) {
    this.pumpState = 'pumped';

    // Track open value to enable historical candle metrics. Do not overwrite until sell
    if (!pumpInit) {
      pumpInit = close;
    }
    plateauRange = 0;
  } else if (this.rise <= -riseTrigger) {
    // A buy watch is triggered on tall bear candles 
    this.pumpState = 'dumped';
    if (!dumpInit || open > dumpInit) {
      dumpInit = open;
    }
    pumpInit = 0;
  }

  if (Math.abs(this.rise) < plateauMargin) {
    ++plateauRange;
  } else {
    plateauRange = 0;
  }
  hasPlateaud = plateauRange >= plateauCandles;

  if (this.pumpState) {
    // log.warn(this.pumpState);
  }

  if (hasPlateaud) {
    // Only sell if a large pump (risereq) is apparent across a few candles and a sell-off happened
    this.close = close;
    if ((close >= this.sellAt || pumpInit) && this.rise < -trendFlip && !this.buyAt) {
      let interrise = (close - pumpInit) / close;
      let isDipPump = isDip(candle, dipFactor);
      // Make sure a minimum rise has been reached and dont make losing sale in a dip
      this.shouldSell = (interrise > riseReq) && !isDipPump;
      if (this.shouldSell) {
        pumpInit = 0;
        hasPlateaud = false;
        // Set future buys so that we don't lose money
        this.buyAt = (1 - dropReq) * close;
      }
    } else if ((close <= this.buyAt) && this.rise > trendFlip && !this.sellAt) {
      // After dumping we still have to wait for a candle so we can buy low. (Then sell high)
      let interrise = (close - dumpInit) / close;
      // Make sure a minimum drop has been reached
      this.shouldBuy = (interrise <= -dropReq) && !isDumping;
      if (this.shouldBuy) {
        hasPlateaud = false;
        dumpInit = 0;
        this.lastBuyAt = close;
        this.sellAt = (1 + riseReq) * close;
        storeLongTrades(candle, 5);
      }
    }
  }
}

function storeLongTrades(candle, queueCount) {
  if (longTrades.length > queueCount) {
    longTrades.shift()
  }
  longTrades.push(candle);
}

function isDip(candle, dipFactor) {
  if (longTrades.length < 1 || dipFactor == 1) {
    return false;
  }
  const {close} = candle;
  const lastBuy = longTrades.slice(-1)[0].close;
  const average = longTrades.slice(0,-1).reduce((total, next) => total + next.close, 0) / (longTrades.length-1);
  let lowAvg =  average * dipFactor;
  // If the last buy was in a dip wait till the close reaches the average
  const inDip = lastBuy < lowAvg && close < lowAvg
  return inDip;
}

let trailingCandles = [];
function getDumpState(candle, bearFactor, trailingCandleCount) {
  if (bearFactor == 1) {
    return false;
  }
  if (trailingCandles.length > trailingCandleCount) {
    trailingCandles.shift()
  }
  trailingCandles.push(candle);
  const max = trailingCandles.reduce((prev, current) => (prev.close > current.close) ? prev : current);
  let isDumping = candle.close * bearFactor < max.close
  return isDumping;
}

strat.check = function () {
  if (this.pumpState == 'pumped') {
    // new trend detected
    if (this.trend.direction !== 'high') {
      this.trend = {
        duration: 0,
        persisted: false,
        direction: 'high',
        adviced: false
      };
    }

    this.trend.duration++;
  } else if (this.pumpState == 'dumped') {

    // new trend detected
    if (this.trend.direction !== 'low') {
      this.trend = {
        duration: 0,
        persisted: false,
        direction: 'low',
        adviced: false
      };
    }

    this.trend.duration++;

  } else {
    // trends must be on consecutive candles
    this.trend.duration = 0;
    // log.debug('In no trend');

    this.advice();
  }


  if (this.shouldBuy && this.buyAt) {
    log.warn(`buy ${this.close.toFixed(4)}, next sale ${this.sellAt.toFixed(4)}`);
    this.trend.adviced = true;
    this.buyAt = 0;
    tradeMode = 'long';
    this.advice('long');
    pumpInit = 0;
  } else if (this.shouldSell && this.sellAt) {
    log.warn(`sell ${this.close.toFixed(4)}, next buy ${this.buyAt.toFixed(4)}, previous buy ${this.lastBuyAt.toFixed(4)}`);
    this.trend.adviced = true;
    this.sellAt = 0;
    tradeMode = 'short';
    this.advice('short');
  } else {
    this.advice();
  }

}


// for debugging purposes log the last
// calculated parameters.
var lastSellAt = 0;
strat.log = function () {
  var digits = 4;
  log.debug(`${tradeMode}, Sell=${this.shouldSell}:${this.sellAt.toFixed(digits)},Buy=${this.shouldBuy}:${this.buyAt.toFixed(digits)}, \tclose:${this.candle.close}, rise:${(this.rise || 0).toFixed(digits)} pumpInit:${pumpInit}, dumpInit:${dumpInit}, Plateau:${plateauRange}`)
  /*
    log.debug('calculated mini_pump properties for candle:');
    log.debug('\t', 'candle:', JSON.stringify(this.candle));
    log.debug("mini-pump buyAt:\t\t" + this.buyAt.toFixed(digits));
    log.debug("mini-pump sellAt:\t\t" + this.sellAt.toFixed(digits));
    log.debug("mini-pump pump:\t\t" + this.pumpState);
    log.debug("mini-pump sell:\t\t" + this.shouldSell);
    log.debug("mini-pump buy:\t\t" + this.shouldBuy);
    log.debug("mini-pump pumpInit:\t\t" + pumpInit);
    log.debug("mini-pump trend:\t\t" + JSON.stringify(this.trend));
  */
}
module.exports = strat;
