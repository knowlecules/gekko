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

const Broker = require('../exchange/gekkoBroker');
const states = require('../exchange/orders/states');

// Let's create our own strat
var strat = {};
let accounts = {};

// Prepare everything our method needs
strat.init = function() {
  const {currency, exchange, assets, tradeAccounts, instantLiquidation, longTrendCount, shortTrendCount} = this.settings;
  this.input = 'candle';
  this.currentTrend = 'short';
  this.requiredHistory = 1;
  this.instantLiquidation = instantLiquidation;
  this.shortTrendCount = shortTrendCount;
  this.longTrendCount = longTrendCount;
  this.marketHistory = {bullCount: 0, bearCount: 0, advice:false};

  tradeAccounts.forEach((account) => {
    const {key, secret, username} = account;

    assets.forEach((asset) => {
      let broker = new Broker({
        currency,  
        asset,  
        exchange, 
        private: true, 
        key, 
        secret, 
        passphrase: 'z',
        customInterval:100
      });
      if (!accounts[username]) {
        accounts[username] = {account, brokers: []};
      }
      accounts[username].brokers.push(broker);
    })    
  })    
}

function prettyObject(obj) {
  return JSON.stringify(obj, null, 4).replace(/(^\S*\n|\n*\S*$)/g,'').replace(/"\s*\:\s*"?/g," = ").replace(/"/g,"").replace(/,\n/g,"\n")
}

// What happens on every new candle?
strat.update = function(candle) {

  // Configure to default to skip market check and always sell
  if (this.logCandles) {
    this.notify("Candle:\n" + prettyObject(candle));
    log.debug("Candle:\n" + prettyObject(candle));
  }

  // Using candles to wait for a sellers market. Essentially more than 2 increases in a row.
  this.marketHistory.advice = false;
  const isBearMarket =  candle.open > candle.close;
  if (isBearMarket) {
    // Switched from bull market of at least 3 candles
    if (this.marketHistory.bullCount > this.longTrendCount) {
      this.marketHistory.advice = 'short';
    }
    this.marketHistory.bullCount = 0;
    this.marketHistory.bearCount += 1;
  } else {
    // Switched from bear market of at least 3 candles 
    if (this.marketHistory.bearCount > this.shortTrendCount) {
      this.marketHistory.advice = 'long';
    }
    this.marketHistory.bearCount = 0;
    this.marketHistory.bullCount += 1;
  }

  log.debug("Market tracking:" + JSON.stringify(this.marketHistory), ", open: " + candle.open + ", close: " + candle.close + ", difference: " + parseInt((candle.close-candle.open)*100,10)/100 + ", rate: " + parseInt((candle.close-candle.open)*1000/candle.close,10)/1000 + "% ");
}

// For debugging purposes.
strat.log = function() {}

// Based on the newly calculated
// information, check if we should
// update or not.
strat.check = function() {

  // Make sure that the limit is not too low. Not much good when "sticky" trade
  function verifyLimit(ask, bid, minimalLimit) {
    // Place holder for more extensive liquidation timing
    if (self.instantLiquidation || self.marketHistory.advice === "long") {
      return ask > minimalLimit ? ask : false;    
    }
    return false;
  }

  // If the balance is big enough then the trade is made
  function orderOnLiquid(account, broker) {
    if (!Array.isArray(broker.portfolio.balances) || !broker.ticker) {
      return true;
    }
    const {client} = account;
    const {asset, currency} = broker.config;
    const {minimalOrder} = broker.marketConfig
    let {amount} = broker.portfolio.balances.find(el => el.name === asset);

    log.debug(`${client}: Trade check ${amount.toFixed(3)} ${asset} for ${currency}.`);
    if (amount < (minimalOrder.amount * 100)) {
      return true;
    }

    const fee = amount * broker.portfolio.fee;
    const sell = (amount - fee);
    const type = 'sticky';
    const side = 'sell';
    const {ask, bid} = broker.ticker;
    const limit = verifyLimit(ask, bid, minimalOrder.price);
    
    if (!limit) {
      return;
    }

    const tradingText = `${sell.toFixed(3)} ${asset} for ${currency}`
    self.notify(`${client}. Trading ${tradingText}, asking ${ask}. Current bid is ${bid}`);
    log.debug(`${client}: Trading ${tradingText}, asking ${ask}. Current bid is ${bid}`);
    const order = broker.createOrder(type, side, sell, { limit });  
    self.logCandles = true;
    order.on('statusChange', (status) => {
      broker.activeTradingState = status;
      log.debug(`${client}: Order ${tradingText}. Status changed:[${status}]`);
    });
    order.on('filled', result => {
      log.debug(`${client}:  Filled ${tradingText}.`);
    });
    order.on('completed', () => {
      self.logCandles = false;
      order.createSummary((err, summary) => {
        log.debug("Order completed summary:\n" + prettyObject(summary));
        self.notify("Order completed summary:\n" + prettyObject(summary));
      });
    });
  }  

  // To make sure we only open one order at a time for the same currency pair
  function hasActiveTrade(trader) {
    const status = trader.activeTradingState;
    return (status == states.OPEN || status == states.MOVING || status == states.INITIALIZING|| status == states.SUBMITTED);
  } 

  var self = this;
  // Only show advice when running the strategy
  if (this.marketHistory.advice && !this.instantLiquidation) {
    this.advice(this.marketHistory.advice);
  }
  
  if (this.marketHistory.advice || this.instantLiquidation) {
    Object.entries(accounts).forEach(([username, brokerList]) => {
      const {account, brokers} = brokerList;
      if(!account.syncing && brokers[0]) {
        account.syncing = true;
        brokers.forEach((broker) => {
          broker.sync((data, err) => {
            account.syncing = false;
            if (err && err.message) {
              console.error("Error during broker.sync for:",account, broker.market, err.message);
              self.notify("Unable to sync account:" + account.client);
            }

            if (!hasActiveTrade(broker)) {
              orderOnLiquid(account, broker);
            }
          })
        });
      }
    }); 
  }
}

module.exports = strat;
