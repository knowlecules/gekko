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
  this.input = 'candle';
  this.currentTrend = 'long';
  this.requiredHistory = 1;
  const {currency, exchange, assets, tradeAccounts} = this.settings;

  tradeAccounts.forEach((account) => {
    const {key, secret} = account;

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
    })    
  })    
}

// What happens on every new candle?
strat.update = function(candle) {

  function traderUpdate(trader) {
    if (!Array.isArray(trader.portfolio.balances) || !trader.ticker) {
      return true;
    }
  
    var asset = trader.portfolio.balances.find(el => el.name === trader.config.asset);
    if (asset.amount > 0.001) {
      const feeAmount = asset.amount * 0.0001;
      const amount = (asset.amount - feeAmount);
      const type = 'sticky';
      const side = 'sell';
      const limit = trader.ticker.ask;
   
      const order = trader.createOrder(type, side, amount, { limit });
      order.on('statusChange', (status) => {
        if (status == states.OPEN && !trader.synced) {
          // Get latest balance to avoid re-attempts
          trader.sync(console.log);
          trader.synced = false;
        }
        console.log("status changed:" + status)
      });
      order.on('filled', result => {
        trader.synced = false;
        console.log("order filled:" + result)
      });
      order.on('completed', () => {
        order.createSummary(summary => console.log)
      });
    } else {
      console.log(`Insufficient funds (${asset.amount}) to trade ${asset.name}!`);
    }
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
