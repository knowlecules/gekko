// This is a basic example strategy for Gekko.
// For more information on everything please refer
// to this document:
//
// https://gekko.wizb.it/docs/strategies/creating_a_strategy.html
//
// The example below is pretty bad investment advice: on every new candle there is
// a 10% chance it will recommend to change your position (to either
// long or short).

var log = require('../core/log');

const Broker = require('../exchange/GekkoBroker');
const states = require('../exchange/orders/states');
const {tradeAccounts} = require("../SECRET-api-keys.json");


// Let's create our own strat
var strat = {};
let traders = [];
let tradePairs = {};

// Prepare everything our method needs
strat.init = function() {
  this.input = 'candle';
  this.currentTrend = 'long';
  this.buyAt = 0;
  this.sellAt = 0;
  this.requiredHistory = 1;
  this.trend = {};
  const {currency, exchange, asset} = this.settings;  

  if (!exchange) {
    this.pumpState = '';
    this.shouldSell = false;
    this.shouldBuy = false;
    this.buyOnInit = true;
    return;
  }
  const account = tradeAccounts[Object.keys(tradeAccounts)[0]]
  const {key, secret} = account;

  let trader = new Broker({
    currency,  
    asset,  
    exchange, 
    private: true, 
    key, 
    secret, 
    passphrase: 'z',
    customInterval:100
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
let pumpOpen = 0;
let interrise = 0;
strat.update = function(candle) {
  
  this.candle = candle;
  const {close, open, low, high} = candle;
  const {riseReq, dropReq, riseTrigger} = this.settings;

  if (this.buyOnInit) {
    this.buyOnInit = false;
    this.shouldBuy = true;
    this.buyAt = close
    return;
  } 

  this.rise = (close-open) / close;

  this.shouldBuy = false;
  this.shouldSell = false;
  this.pumpState = '';

  // A sell watch is triggered on tall(ish) bull candles 
  if (!this.sellAt && this.rise >= riseTrigger) {
    this.pumpState = 'pumped';

    // Track open value to enable historical candle metrics
    if (!pumpOpen) {
      pumpOpen = open;
    }
  } else if (!this.buyAt && this.rise <= dropReq) {
    // A buy watch is triggered on tall bear candles 
    this.pumpState = 'dumped';
  }

  if (this.pumpState)  {
    log.info(this.pumpState);
  }

  // Only sell if a large pump (risereq) is apparent across a few candles and a bear happened
  if (pumpOpen && this.rise < -0.001 && !this.buyAt) {
    let interrise = (close - pumpOpen) / close;
    this.shouldSell = (interrise > riseReq );
    if (this.shouldSell) {
      this.sellAt = close;
      pumpOpen = 0;
      this.buyAt = (1 + dropReq) * close;
    }
  } else if (close <= this.buyAt && this.rise > 0.001) {
    // After dumping we still have to wait for a candle so we can buy low. (Then sell high)
    this.shouldBuy = true;
    this.sellAt = (1 + riseReq) * close;
  }

  this.log()
}


strat.check = function() {
	if(this.pumpState == 'pumped') {
		// new trend detected
		if(this.trend.direction !== 'high'){
			this.trend = {
				duration: 0,
				persisted: false,
				direction: 'high',
				adviced: false
			};
    }

		this.trend.duration++;
	} else 	if(this.pumpState == 'dumped') {

		// new trend detected
		if (this.trend.direction !== 'low'){
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
    this.trend.adviced = true;
    this.buyAt = 0;
    log.warn('buy');
    this.advice('long');
  } else if (this.shouldSell && this.sellAt) {
    this.trend.adviced = true;
    this.sellAt = 0;
    log.warn('sell');
    this.advice('short');
  } else{
		this.advice();
  }
  
}


// for debugging purposes log the last
// calculated parameters.
var lastSellAt = 0;
strat.log = function() {
  var digits = 4;
  log.debug(`\tSell=${this.shouldSell}:${this.sellAt.toFixed(digits)},Buy=${this.shouldBuy}:${this.buyAt.toFixed(digits)}, \tclose:${this.candle.close}, rise:${(this.rise ||0).toFixed(digits)} pumpOpen:${pumpOpen}, PumpState?${this.pumpState}`)
/*
  log.debug('calculated mini_pump properties for candle:');
  log.debug('\t', 'candle:', JSON.stringify(this.candle));
	log.debug("mini-pump buyAt:\t\t" + this.buyAt.toFixed(digits));
	log.debug("mini-pump sellAt:\t\t" + this.sellAt.toFixed(digits));
	log.debug("mini-pump pump:\t\t" + this.pumpState);
	log.debug("mini-pump sell:\t\t" + this.shouldSell);
	log.debug("mini-pump buy:\t\t" + this.shouldBuy);
	log.debug("mini-pump pumpOpen:\t\t" + pumpOpen);
	log.debug("mini-pump trend:\t\t" + JSON.stringify(this.trend));
*/
}
module.exports = strat;
