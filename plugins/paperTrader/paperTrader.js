const _ = require('lodash');

const util = require('../../core/util');
const ENV = util.gekkoEnv();

const config = util.getConfig();
const calcConfig = config.paperTrader;
const watchConfig = config.watch;
const dirs = util.dirs();
const log = require(dirs.core + 'log');

const TrailingStop = require(dirs.broker + 'triggers/trailingStop');

const PaperTrader = function() {
  _.bindAll(this);

  if(calcConfig.feeUsing === 'maker') {
    this.rawFee = calcConfig.feeMaker;
  } else {
    this.rawFee = calcConfig.feeTaker;
  }

  this.fee = 1 - this.rawFee / 100;

  this.currency = watchConfig.currency;
  this.asset = watchConfig.asset;

  this.portfolio = {
    asset: calcConfig.simulationBalance.asset,
    currency: calcConfig.simulationBalance.currency,
  }

  this.balance = false;

  if(this.portfolio.asset > 0) {
    this.exposed = true;
  }

  this.propogatedTrades = 0;
  this.propogatedTriggers = 0;

  this.warmupCompleted = false;

  this.warmupCandle;
}

PaperTrader.prototype.relayPortfolioChange = function() {
  this.deferredEmit('portfolioChange', {
    asset: this.portfolio.asset,
    currency: this.portfolio.currency
  });
}

PaperTrader.prototype.relayPortfolioValueChange = function() {
  this.deferredEmit('portfolioValueChange', {
    balance: this.getBalance()
  });
}

PaperTrader.prototype.extractFee = function(amount) {
  amount *= 1e8;
  amount *= this.fee;
  amount = Math.floor(amount);
  amount /= 1e8;
  return amount;
}

PaperTrader.prototype.setStartBalance = function() {
  this.balance = this.getBalance();
}

// after every succesfull trend ride we hopefully end up
// with more BTC than we started with, this function
// calculates Gekko's profit in %.
// tradeAmount: optional exact amount in currency to trade (for buy) or currency value to sell (for sell)
PaperTrader.prototype.updatePosition = function(what, tradeAmount) {

  let cost;
  let amount;

  // virtually trade {amount} of {currency} to {asset}
  // at the current price (minus fees)
  if(what === 'long') {
    // Use specified amount or all available currency
    let currencyToUse;
    if(tradeAmount && tradeAmount > 0) {
      // Use specified amount, but cap at available currency
      currencyToUse = Math.min(tradeAmount, this.portfolio.currency);
    } else {
      // No amount specified, use all available
      currencyToUse = this.portfolio.currency;
    }
    
    if(currencyToUse <= 0) {
      log.warn('[Papertrader] No currency available to buy');
      return { cost: 0, amount: 0, effectivePrice: this.price };
    }
    
    cost = (1 - this.fee) * currencyToUse;
    const assetBought = this.extractFee(currencyToUse / this.price);
    this.portfolio.asset += assetBought;
    amount = assetBought;
    this.portfolio.currency -= currencyToUse;

    this.exposed = this.portfolio.asset > 0;
    this.trades++;
    
    log.info('[Papertrader] BUY', currencyToUse.toFixed(2), this.currency,
      '-> Got', assetBought.toFixed(8), this.asset,
      '@', this.price.toFixed(2),
      '| Remaining currency:', this.portfolio.currency.toFixed(2));
  }

  // virtually trade {amount} worth of {asset} to {currency}
  // at the current price (minus fees)
  else if(what === 'short') {
    // Use specified amount (as currency value) or all available asset
    let assetToSell;
    if(tradeAmount && tradeAmount > 0) {
      // Convert currency amount to asset amount, but cap at available asset
      assetToSell = Math.min(tradeAmount / this.price, this.portfolio.asset);
    } else {
      // No amount specified, sell all available
      assetToSell = this.portfolio.asset;
    }
    
    if(assetToSell <= 0) {
      log.warn('[Papertrader] No asset available to sell');
      return { cost: 0, amount: 0, effectivePrice: this.price };
    }
    
    cost = (1 - this.fee) * (assetToSell * this.price);
    const currencyReceived = this.extractFee(assetToSell * this.price);
    this.portfolio.currency += currencyReceived;
    amount = currencyReceived;
    this.portfolio.asset -= assetToSell;

    this.exposed = this.portfolio.asset > 0;
    this.trades++;
    
    log.info('[Papertrader] SELL', assetToSell.toFixed(8), this.asset,
      '-> Got', currencyReceived.toFixed(2), this.currency,
      '@', this.price.toFixed(2),
      '| Remaining asset:', this.portfolio.asset.toFixed(8));
  }

  const effectivePrice = this.price * this.fee;

  return { cost, amount, effectivePrice };
}

PaperTrader.prototype.getBalance = function() {
  return this.portfolio.currency + this.price * this.portfolio.asset;
}

PaperTrader.prototype.now = function() {
  return this.candle.start.clone().add(1, 'minute');
}

PaperTrader.prototype.processAdvice = function(advice) {
  let action;
  if(advice.recommendation === 'short') {
    action = 'sell';

    // clean up potential old stop trigger
    if(this.activeStopTrigger) {
      this.deferredEmit('triggerAborted', {
        id: this.activeStopTrigger.id,
        date: advice.date
      });

      delete this.activeStopTrigger;
    }

  } else if(advice.recommendation === 'long') {
    action = 'buy';

    if(advice.trigger) {

      // clean up potential old stop trigger
      if(this.activeStopTrigger) {
        this.deferredEmit('triggerAborted', {
          id: this.activeStopTrigger.id,
          date: advice.date
        });

        delete this.activeStopTrigger;
      }

      this.createTrigger(advice);
    }
  } else {
    return log.warn(
      `[Papertrader] ignoring unknown advice recommendation: ${advice.recommendation}`
    );
  }

  // Extract trade amount from strategy state (if provided)
  // This allows strategies to specify exact position sizes
  const tradeAmount = advice.strategyState && advice.strategyState.tradeAmount 
    ? advice.strategyState.tradeAmount 
    : null;

  this.tradeId = 'trade-' + (++this.propogatedTrades);

  this.deferredEmit('tradeInitiated', {
    id: this.tradeId,
    adviceId: advice.id,
    action,
    portfolio: _.clone(this.portfolio),
    balance: this.getBalance(),
    date: advice.date,
    tradeAmount
  });

  const { cost, amount, effectivePrice } = this.updatePosition(advice.recommendation, tradeAmount);

  this.relayPortfolioChange();
  this.relayPortfolioValueChange();

  this.deferredEmit('tradeCompleted', {
    id: this.tradeId,
    adviceId: advice.id,
    action,
    cost,
    amount,
    price: this.price,
    portfolio: this.portfolio,
    balance: this.getBalance(),
    date: advice.date,
    effectivePrice,
    feePercent: this.rawFee,
    strategyState: advice.strategyState || null
  });
}

PaperTrader.prototype.createTrigger = function(advice) {
  const trigger = advice.trigger;

  if(trigger && trigger.type === 'trailingStop') {

    if(!trigger.trailValue) {
      return log.warn(`[Papertrader] ignoring trailing stop without trail value`);
    }

    const triggerId = 'trigger-' + (++this.propogatedTriggers);

    this.deferredEmit('triggerCreated', {
      id: triggerId,
      at: advice.date,
      type: 'trailingStop',
      proprties: {
        trail: trigger.trailValue,
        initialPrice: this.price,
      }
    });

    this.activeStopTrigger = {
      id: triggerId,
      adviceId: advice.id,
      instance: new TrailingStop({
        initialPrice: this.price,
        trail: trigger.trailValue,
        onTrigger: this.onStopTrigger
      })
    }
  } else {
    log.warn(`[Papertrader] Gekko does not know trigger with type "${trigger.type}".. Ignoring stop.`);
  }
}

PaperTrader.prototype.onStopTrigger = function() {

  const date = this.now();

  this.deferredEmit('triggerFired', {
    id: this.activeStopTrigger.id,
    date
  });

  const { cost, amount, effectivePrice } = this.updatePosition('short');

  this.relayPortfolioChange();
  this.relayPortfolioValueChange();

  this.deferredEmit('tradeCompleted', {
    id: this.tradeId,
    adviceId: this.activeStopTrigger.adviceId,
    action: 'sell',
    cost,
    amount,
    price: this.price,
    portfolio: this.portfolio,
    balance: this.getBalance(),
    date,
    effectivePrice,
    feePercent: this.rawFee
  });

  delete this.activeStopTrigger;
}

PaperTrader.prototype.processStratWarmupCompleted = function() {
  this.warmupCompleted = true;
  this.processCandle(this.warmupCandle, _.noop);
}

PaperTrader.prototype.processCandle = function(candle, done) {
  if(!this.warmupCompleted) {
    this.warmupCandle = candle;
    return done();
  }

  this.price = candle.close;
  this.candle = candle;

  if(!this.balance) {
    this.setStartBalance();
    this.relayPortfolioChange();
    this.relayPortfolioValueChange();
  }

  if(this.exposed) {
    this.relayPortfolioValueChange();
  }

  if(this.activeStopTrigger) {
    this.activeStopTrigger.instance.updatePrice(this.price);
  }

  done();
}

module.exports = PaperTrader;
