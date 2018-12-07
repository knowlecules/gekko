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
var _ = require('lodash');

const Broker = require('../exchange/GekkoBroker');
const states = require('../exchange/orders/states');

const {secret, key, username} = require("../SECRET-api-keys");

const binance = new Broker({
  currency: 'USDT',  
  asset: 'BTC',  
  exchange: 'binance', 
  private: true, 
  key, 
  secret, 
  passphrase: 'z',
  customInterval:100
});

// Let's create our own strat
var strat = {};
var portfolio = {};

// Prepare everything our method needs
strat.init = function() {
  this.input = 'candle';
  this.currentTrend = 'long';
  this.requiredHistory = 1;
  binance.sync(() => {
    console.log(binance.portfolio);
  });
}

// What happens on every new candle?
strat.update = function(candle) {

  if (!Array.isArray(binance.portfolio.balances) || !binance.ticker) {
    return true;
  }

  var asset = binance.portfolio.balances.find(el => el.name === binance.config.asset)
  if (asset.amount > 0.001) {
    const feeAmount = asset.amount * 0.0001;
    const amount = (asset.amount - feeAmount);
    // To avoid duplicate attempts
    asset.amount = 0;
    const type = 'sticky';
    const side = 'sell';
    const limit = binance.ticker.ask;
 
    const order = binance.createOrder(type, side, amount, { limit });
    order.on('statusChange', (status) => {
      if (status == states.OPEN) {
        binance.sync(console.log);
      }
      console.log("status changed:" + status)
    });
    order.on('filled', result => console.log("order filled:" + result));
    order.on('completed', () => {
      order.createSummary(summary => console.log)
    });
  }
  binance.sync(console.log);
}

// For debugging purposes.
strat.log = function() {
  if (this.createdOrder){
    log.debug('Order opened to sell all.');
  }
}

// Based on the newly calculated
// information, check if we should
// update or not.
strat.check = function() {

  if(this.hasZeroBalance) {
    this.advice('long');
  } else {
    this.advice('short');
  }
}

module.exports = strat;
