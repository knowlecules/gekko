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
let accounts = {};

// Prepare everything our method needs
strat.init = function() {
  const {currency, exchange, assets, tradeAccounts, upTrendSell} = this.settings;
  this.input = 'candle';
  this.currentTrend = 'short';
  this.requiredHistory = 1;
  this.upTrendSell = upTrendSell;
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

let marketHistory = {lastCandle: null, upCount: 0, sell:false};
// What happens on every new candle?
strat.update = function(candle) {

  // Configure to default to skip market check and always sell
  let candleParts = {...candle};
  delete(candleParts.start)
  delete(candleParts.trades)
  log.debug("Candle", candleParts);
  marketHistory.sell = this.upTrendSell;

  // Using candles to wait for a sellers market. Essentially more than 2 increases in a row.
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
  
  // Make sure that the limit is not too low. Not much good when "sticky" trade
  function verifyLimit(ask, bid, minimalLimit) {
    if (!marketHistory.sell) {
      return false;
    }
    return ask > minimalLimit ? ask : false;    
  }

  // If the balance is big enough then the trade is made
  function balanceCheck(account, broker) {
    if (!Array.isArray(broker.portfolio.balances) || !broker.ticker) {
      return true;
    }
    const {client} = account;
    const {asset, currency} = broker.config;
    const {minimalOrder} = broker.marketConfig
    let {amount} = broker.portfolio.balances.find(el => el.name === asset);

    const fee = amount * broker.portfolio.fee;
    const sell = (amount - fee);
    const type = 'sticky';
    const side = 'sell';
    const {ask, bid} = broker.ticker;
    const limit = verifyLimit(ask, bid, minimalOrder.price);
    const tradingText = `${sell.toFixed(3)} ${asset} for ${currency}`
    
    log.debug(`${client}: Trade check ${amount.toFixed(3)} ${asset} for ${currency}.`);
    if (amount < (minimalOrder.amount * 100)) {
      log.debug(`${client}:  Insufficient balance: ${tradingText}.`);
      return true;
    }

    if (!limit) {
      log.debug(`${client}:  Abort trade as ask of ${ask} is too low: ${tradingText}.`);
      return;
    }

    log.debug(`${client}: Trading ${tradingText}, asking ${ask}. Current bid is ${bid}`);
    const order = broker.createOrder(type, side, sell, { limit });
    order.on('statusChange', (status) => {
      broker.activeTradingState = status;
      log.debug(`${client}: Order ${tradingText}. Status changed:[${status}]`);
    });
    order.on('filled', result => {
      log.debug(`${client}:  Filled ${tradingText}.`);
    });
    order.on('completed', () => {
      order.createSummary((err, summary) => log.debug(summary));
    });

  }  

  // To make sure we only open one order at a time for the same currency pair
  function hasActiveTrade(trader) {
    const status = trader.activeTradingState;
    return (status == states.OPEN || status == states.MOVING || status == states.INITIALIZING|| status == states.SUBMITTED);
  } 

  Object.entries(accounts).forEach(([username, brokerList]) => {
    const {account, brokers} = brokerList;
    if(!account.syncing && brokers[0]) {
      account.syncing = true;
      brokers.forEach((broker) => {
        broker.sync(() => {
          if (!hasActiveTrade(broker)) {
            balanceCheck(account, broker);
          }
          account.syncing = false;
        })
      });
    }
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
