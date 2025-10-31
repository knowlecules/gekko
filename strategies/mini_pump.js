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

// GekkoBroker is only needed for live trading, not backtesting
// const Broker = require('../exchange/GekkoBroker');
// const states = require('../exchange/orders/states');
// const { tradeAccounts } = require("../SECRET-api-keys.json");


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

  // Live trading setup disabled for backtesting
  // if (!exchange) {
    this.pumpState = '';
    this.shouldSell = false;
    this.shouldBuy = false;
    this.buyOnInit = true;
  //   return;
  // }
  // const account = tradeAccounts[Object.keys(tradeAccounts)[0]]
  // const { key, secret } = account;

  // let trader = new Broker({
  //   currency,
  //   asset,
  //   exchange,
  //   private: true,
  //   key,
  //   secret,
  //   passphrase: 'z',
  //   customInterval: 100
  // });
  // traders.push(trader);
  // trader.sync(console.log);
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
let dayMillis = (24 * 60 * 60 * 1000);
let pumpInit = 0;
let dumpInit = 0;
let tradeMode = 'short';
let plateauRange = 0;
let hasPlateaud = false;
let hasReallyPlateaud = false;
let longTrades = [];
let shortTrades = [];
let sellPriceAdjust = false;
let buyPriceAdjust = false;
const tradeStack = 20;
let maxLoss = 0.06;
let lastBuy = null;
let lastSell = null;
let isInDip = false;
let isInBump = false;
let acceptableSell = false;
let acceptableBuy = false;
let previousClose = 0;

strat.update = function (candle) {

  this.candle = candle;
  const { close, open, low, high, start } = candle;
  const { riseReq, dropReq, riseTrigger, trendFlip, plateauCandles, plateauMargin, bullFactor, bearFactor, trailingHistoryCount, dipFactor, bumpFactor, panicSellDays=0, maxLoss } = this.settings;
  let {isDumping, isPumping, lowest, highest} = getTrendState({candle, bearFactor, trailingHistoryCount, bullFactor});

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

  this.rise = (close - (previousClose || close)) / close;
  previousClose = this.candle.close;

  this.shouldBuy = false;
  this.shouldSell = false;
  this.pumpState = '';

  if (Math.abs(this.rise) < plateauMargin) {
    ++plateauRange;
  } else {
    plateauRange = 0;
  }
  hasPlateaud = plateauRange >= plateauCandles;
  hasReallyPlateaud = plateauRange >= plateauCandles * 2.5;
  acceptableSell = false, acceptableBuy = false, profit = 0;

  // Only sell if a large pump (risereq) is apparent across a few candles and a sell-off happened
  this.close = close;

  // When we are ready to sell we should check length of exposure 
  if (longTrades.length && shortTrades.length < longTrades.length) {
  
    // A sell watch is triggered on tall(ish) bull candles 
    if (!pumpInit && this.rise >= riseTrigger) {
      this.pumpState = 'pumped';
  
      // Track open value to enable historical candle metrics. Do not overwrite until sell
      if (!pumpInit) {
        pumpInit = open;
      }
      plateauRange = 0;
    } 
    
    lastBuy = longTrades.slice(-1)[0]
    const candleDate = Date.parse(start)/dayMillis;
    const lastBuyDate = Date.parse(lastBuy.start)/dayMillis;
    
    if (panicSellDays && !sellPriceAdjust && candleDate - lastBuyDate > panicSellDays) {
      // We have been exposed too long
      // Probably in a dip. We need to reset the sellAt
      this.sellAt = close;
      sellPriceAdjust = true;
    }  

    profit = (close - lastBuy.close)/lastBuy.close;
    acceptableSell = (hasReallyPlateaud && sellPriceAdjust && profit > -maxLoss) 
                      || profit > 3*riseReq
                      || (profit > riseReq && candleDate - lastBuyDate > 0.6)
                      || (profit > riseReq/2 && candleDate - lastBuyDate > 1.2);
  
      // log.debug(`hasPlateaud=${hasPlateaud} && ( close:${(close || 0).toFixed(4)} >= sellAt:${(this.sellAt || 0).toFixed(4)} || pumpInit:${pumpInit} ) && rise:${(this.rise || 0).toFixed(4)} <= -trendFlip:${-trendFlip} && !buyAt:${(this.buyAt || 0).toFixed(4)}`)
    if (hasPlateaud && (close >= this.sellAt || pumpInit) && !this.buyAt ||  acceptableSell) {
      let interrise = (close - pumpInit) / close;
      isInDip = isDip(candle, dipFactor);
      let isDipOrPump = (isInDip || isPumping);
    
      // Make sure a minimum rise has been reached and dont make losing sale in a dip
      this.shouldSell = ((close >= this.sellAt || interrise > riseReq)  && !isDipOrPump) || acceptableSell ;
  //    this.shouldSell = (interrise > riseReq) && !isDipOrPump || acceptableSell || hasReallyPlateaud;
      if (this.shouldSell) {
        pumpInit = 0;
        hasPlateaud = false;
        hasReallyPlateaud = false;
        sellPriceAdjust = false;
        // Set future buys so that we don't lose money
        this.buyAt = (1 - dropReq) * close;
        storeShortTrades(candle, tradeStack);
      }
    }
  } else if (shortTrades.length && shortTrades.length == longTrades.length) {
    if (this.rise <= -riseTrigger) {
      // A buy watch is triggered on tall bear candles 
      this.pumpState = 'dumped';
      if (!dumpInit || open > dumpInit) {
        dumpInit = open;
      }
      pumpInit = 0;
    }
  
    lastSell = shortTrades.slice(-1)[0]
    const candleDate = Date.parse(start)/dayMillis;
    const lastSellDate = Date.parse(lastSell.start)/dayMillis;
    
    if (panicSellDays && !buyPriceAdjust && candleDate - lastSellDate > panicSellDays) {
      // We have been exposed too long
      // Probably in a dip. We need to reset the sellAt
      this.buyAt = (1 + riseReq) * lastSell.close;
      buyPriceAdjust = true;
    }
    profit = (close - lastSell.close)/lastSell.close;
    acceptableBuy = hasReallyPlateaud && buyPriceAdjust && profit > -maxLoss 
                    || profit < -2*dropReq 
                    || (profit < -0.85*dropReq && candleDate - lastSellDate > 0.75) 
                    || (profit < -dropReq/2 && candleDate - lastSellDate > 1.5);
    
    if ((close <= this.buyAt) && !this.sellAt || acceptableBuy) { //&& this.rise > trendFlip 
      // After dumping we still have to wait for a candle so we can buy low. (Then sell high)
      let interrise = (close - dumpInit) / close;
      isInBump = isBump(candle, bumpFactor)
      let isBumpOrDump =  (isInBump || isDumping);// && !hasReallyPlateaud;

      // Make sure a minimum drop has been reached or make a timely buy back in a bull market 
      this.shouldBuy = ((close <= this.buyAt || interrise <= -dropReq) && !isBumpOrDump || acceptableBuy);
      if (this.shouldBuy) {
        dumpInit = 0;
        hasPlateaud = false;
        hasReallyPlateaud = false;
        buyPriceAdjust = false;
        this.lastBuyAt = close;
        this.sellAt = (1 + riseReq) * close;
        storeLongTrades(candle, tradeStack);
      }
    }
  }
}

function storeShortTrades(candle, queueCount) {
  shortTrades.push(candle);
}

function storeLongTrades(candle, queueCount) {
  if (longTrades.length > queueCount) {
    longTrades.shift();
    shortTrades.shift();
  }
  longTrades.push(candle);
}

// Dont sell in a dip
// Check whether in a dip to avoid a sale till the market corrects back up
function isDip(candle, dipFactor=1) {
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


// Dont buy on a bump
// Check whether on a bump to avoid a buy till the market corrects back down
function isBump(candle, bumpFactor=1) {
  if (shortTrades.length < 1 || bumpFactor == 1) {
    return false;
  }
  const {close} = candle;
  const lastSell = shortTrades.slice(-1)[0].close;
  const average = shortTrades.slice(0,-1).reduce((total, next) => total + next.close, 0) / (shortTrades.length-1);
  let highAvg =  average * bumpFactor;
  // If the last sell was on a bump wait till the close drops to the average
  const inBump = lastSell > highAvg && close > highAvg
  return inBump;
}

let trailingCandles = [];
function getTrendState({candle, bearFactor, bullFactor, trailingHistoryCount}) {
  if (bearFactor == 1) {
    return {isDumping:false, isPumping:false};
  }
  if (trailingCandles.length >= trailingHistoryCount) {
    trailingCandles.shift()
  }
  trailingCandles.push(candle);
  const highest = trailingCandles.reduce((prev, current) => (prev.close > current.close) ? prev : current);
  let isDumping = candle.low * bearFactor < highest.close
  const lowest = trailingCandles.reduce((prev, current) => (prev.close < current.close) ? prev : current);
  let isPumping = candle.high / bullFactor > lowest.close ;
  return {isDumping, isPumping, lowest, highest};
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
    log.warn(`buy [${this.candle.start.toString().split(" GMT")[0]}] at ${this.close.toFixed(4)}, next sale ${this.sellAt.toFixed(4)}${hasReallyPlateaud? ", really plateaud" : ""}${isInDip? ", in dip" : ""}${acceptableBuy? ", acceptable buy" : ""}${isInBump? ", in bump" : ""}`);
    this.trend.adviced = true;
    this.buyAt = 0;
    tradeMode = 'long';
    this.advice('long');
    pumpInit = 0;
  } else if (this.shouldSell && this.sellAt) {
    log.warn(`sell [${this.candle.start.toString().split(" GMT")[0]}] at ${this.close.toFixed(4)}, next buy ${this.buyAt.toFixed(4)}, previous buy ${this.lastBuyAt.toFixed(4)}${sellPriceAdjust? ", panic sell" : ""}${hasReallyPlateaud? ", really plateaud" : ""}${acceptableSell? ", acceptable sell" : ""}${isInDip? ", in dip" : ""}${isInBump? ", in bump" : ""}`);
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
