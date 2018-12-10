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


// Let's create our own strat
var strat = {};
let traders = [];

// Prepare everything our method needs
strat.init = function() {
  const {currency, exchange, assets, tradeAccounts, upTrendSell} = this.settings;
  this.input = 'candle';
  this.currentTrend = 'short';
  this.requiredHistory = 1;
  this.upTrendSell = upTrendSell;
  tradeAccounts.forEach((account) => {
    const {key, secret, client, username} = account;

    assets.forEach((asset) => {
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
      trader.client = client;
      trader.username = username;  
    })    
  })    
}

let marketHistory = {lastCandle: null, upCount: 0, sell:false};
// What happens on every new candle?
strat.update = function(candle) {

  // Using candles to wait for a sellers market. Essentially more than 2 increases in a row.
  marketHistory.sell = this.upTrendSell;
  if (!marketHistory.lastCandle) {
    marketHistory.lastCandle = candle;
  } else if (marketHistory.lastCandle.vwp >  candle.vwp) {
    marketHistory.upCount ++;
  } else {
    if (marketHistory.upCount > 2) {
      marketHistory.sell = true;
    }
    marketHistory.upCount = 0
  }

  function validateLimit(ask, bid, minimalLimit) {
    if (!marketHistory.sell) {
      return false;
    }
    return ask > minimalLimit ? ask : false;    
  }

  function traderUpdate(trader) {
    if (!Array.isArray(trader.portfolio.balances) || !trader.ticker) {
      return true;
    }
    const client = trader.client;
    const {asset, currency} = trader.config;
    const {minimalOrder} = trader.marketConfig
    let {amount} = trader.portfolio.balances.find(el => el.name === asset);

    log.debug(`${client}: Trade check ${amount.toFixed(3)} ${asset} for ${currency}.`);
    if (amount < (minimalOrder.amount * 100)) {
      return true;
    }
    const fee = amount * trader.portfolio.fee;
    const sell = (amount - fee);
    const type = 'sticky';
    const side = 'sell';
    const {ask, bid} = trader.ticker;
    const limit = validateLimit(ask, bid, minimalOrder.price);
    
    if (!limit) {
      return;
    }
    const tradingText = `${sell.toFixed(3)} ${asset} for ${currency}`
    log.debug(`${client}: Trading ${tradingText}, asking ${ask}. Current bid is ${bid}`);
    const order = trader.createOrder(type, side, sell, { limit });
    order.on('statusChange', (status) => {
      if (status == states.OPEN && !trader.synced) {
        // Get latest balance to avoid re-attempts
        trader.sync(console.log);
        trader.synced = false;
      }
      console.log(`${client}: Order ${tradingText}. Status changed:[${status}]`);
    });
    order.on('filled', result => {
      trader.synced = false;
      console.log(`${client}:  Filled ${tradingText}.`);
    });
    order.on('completed', () => {
      order.createSummary((err, summary) => console.log(summary));
    });

    trader.sync(console.log);  
  }  

  traders.forEach((trader) => {
    traderUpdate(trader);
  });
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
