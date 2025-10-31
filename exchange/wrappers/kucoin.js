const moment = require('moment');
const _ = require('lodash');
const API = require('kucoin-node-sdk');
const request = require('request-promise');

const Errors = require('../exchangeErrors');
const marketData = require('./kucoin-markets.json');
const exchangeUtils = require('../exchangeUtils');
const retry = exchangeUtils.retry;
const scientificToDecimal = exchangeUtils.scientificToDecimal;

const Trader = function(config) {
  _.bindAll(this, [
    'roundAmount',
    'roundPrice',
    'isValidPrice',
    'isValidLot'
  ]);

  if (_.isObject(config)) {
    this.key = config.key;
    this.secret = config.secret;
    this.passphrase = config.passphrase;
    this.currency = config.currency.toUpperCase();
    this.asset = config.asset.toUpperCase();
  }

  this.pair = `${this.asset}-${this.currency}`;
  this.name = 'kucoin';

  this.market = _.find(Trader.getCapabilities().markets, (market) => {
    return market.pair[0] === this.currency && market.pair[1] === this.asset
  });

  // Only initialize KuCoin API SDK if credentials are provided
  if(this.key && this.secret && this.passphrase) {
    const apiConfig = {
      baseUrl: 'https://api.kucoin.com',
      apiAuth: {
        key: this.key,
        secret: this.secret,
        passphrase: this.passphrase,
      },
      authVersion: 2,
    };
    
    API.init(apiConfig);
    
    this.fee = 0.001; // Default KuCoin fee (0.1%)
    this.getFee(_.noop);
    this.oldOrder = false;
  } else {
    // For import mode without credentials, we'll use direct HTTP requests
    this.fee = 0.001; // Default fee for import mode
  }
};

const recoverableErrors = [
  'SOCKETTIMEDOUT',
  'TIMEDOUT',
  'CONNRESET',
  'CONNREFUSED',
  'NOTFOUND',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'EAI_AGAIN',
  'ENETUNREACH',
  'Too Many Requests',
  '429',
  'Service Unavailable',
  '503'
];

const includes = (str, list) => {
  if(!_.isString(str))
    return false;

  return _.some(list, item => str.includes(item));
}

Trader.prototype.handleResponse = function(funcName, callback) {
  return (error, body) => {
    if (body && body.code && body.code !== '200000') {
      error = new Error(`Error ${body.code}: ${body.msg || body.message}`);
    }

    if(error) {
      if(_.isString(error)) {
        error = new Error(error);
      }

      if(includes(error.message, recoverableErrors)) {
        error.notFatal = true;
      }

      if(funcName === 'cancelOrder' && error.message.includes('order not exist')) {
        console.log(new Date, 'cancelOrder', 'order not exist');
        return callback(false, {filled: true});
      }

      if(funcName === 'addOrder' && error.message.includes('Insufficient')) {
        console.log(new Date, 'insufficientFunds');
        error.type = 'insufficientFunds';
      }

      return callback(error);
    }

    return callback(undefined, body);
  }
};

Trader.prototype.getTrades = function(since, callback, descending) {
  // When importing historical data, use candles endpoint which respects date boundaries
  // The /market/histories endpoint only returns recent trades regardless of date params
  if (since && (!this.key || !this.secret || !this.passphrase)) {
    return this.getTradesFromCandles(since, callback, descending);
  }

  const processResults = (err, data) => {
    if (err) return callback(err);

    if(!data || !data.data) {
      return callback(new Error('No trade data returned'));
    }

    var parsedTrades = [];
    _.each(
      data.data,
      function(trade) {
        parsedTrades.push({
          tid: trade.sequence,
          date: moment(trade.time / 1000000).unix(),
          price: parseFloat(trade.price),
          amount: parseFloat(trade.size),
        });
      },
      this
    );

    if (descending) callback(null, parsedTrades.reverse());
    else callback(undefined, parsedTrades);
  };

  const fetch = cb => {
    // Use SDK if credentials are available
    if (this.key && this.secret && this.passphrase) {
      API.rest.Market.Histories.getMarketHistories(this.pair)
        .then(response => cb(null, response))
        .catch(err => cb(err));
    } else {
      // For live/recent data without credentials
      const url = 'https://api.kucoin.com/api/v1/market/histories';
      request({
        url: url,
        qs: { symbol: this.pair },
        json: true,
        headers: { 'User-Agent': 'Gekko' }
      })
        .then(response => cb(null, response))
        .catch(err => cb(err));
    }
  };

  retry(undefined, fetch, (err, data) => {
    this.handleResponse('getTrades', processResults)(err, data);
  });
};

// Get historical trades from candles (respects date boundaries)
Trader.prototype.getTradesFromCandles = function(since, callback, descending) {
  const processCandles = (err, data) => {
    if (err) return callback(err);

    if(!data || !data.data) {
      return callback(new Error('No candle data returned'));
    }

    // KuCoin returns candles as: [timestamp, open, close, high, low, volume, turnover]
    // Convert to trade format
    var parsedTrades = [];
    let tid = moment(since).unix() * 1000000; // Generate sequential TIDs
    
    _.each(
      data.data,
      function(candle) {
        const timestamp = parseInt(candle[0]);
        const close = parseFloat(candle[2]);
        const volume = parseFloat(candle[5]);
        
        if (volume > 0) {
          parsedTrades.push({
            tid: tid++,
            date: timestamp,
            price: close,
            amount: volume,
          });
        }
      },
      this
    );

    // KuCoin returns candles in reverse chronological order, so reverse to get chronological
    parsedTrades.reverse();

    if (descending) callback(null, parsedTrades.reverse());
    else callback(undefined, parsedTrades);
  };

  const startAt = Math.floor(moment(since).valueOf() / 1000);
  const endAt = Math.floor(moment(since).add(1, 'h').valueOf() / 1000);

  const fetch = cb => {
    const url = 'https://api.kucoin.com/api/v1/market/candles';
    const params = {
      symbol: this.pair,
      type: '1min',
      startAt: startAt,
      endAt: endAt
    };
    
    request({
      url: url,
      qs: params,
      json: true,
      headers: { 'User-Agent': 'Gekko' }
    })
      .then(response => cb(null, response))
      .catch(err => cb(err));
  };

  retry(undefined, fetch, (err, data) => {
    this.handleResponse('getTradesFromCandles', processCandles)(err, data);
  });
};

Trader.prototype.getPortfolio = function(callback) {
  // getPortfolio requires authentication
  if (!this.key || !this.secret || !this.passphrase) {
    return callback(new Error('getPortfolio requires API credentials'));
  }

  const setBalance = (err, data) => {
    if (err) return callback(err);

    if(!data || !data.data) {
      return callback(new Error('No balance data returned'));
    }

    const findAsset = item => item.currency === this.asset && item.type === 'trade';
    const assetData = _.find(data.data, findAsset);
    let assetAmount = assetData ? parseFloat(assetData.available) : 0;

    const findCurrency = item => item.currency === this.currency && item.type === 'trade';
    const currencyData = _.find(data.data, findCurrency);
    let currencyAmount = currencyData ? parseFloat(currencyData.available) : 0;

    if (!_.isNumber(assetAmount) || _.isNaN(assetAmount)) {
      assetAmount = 0;
    }

    if (!_.isNumber(currencyAmount) || _.isNaN(currencyAmount)) {
      currencyAmount = 0;
    }

    const portfolio = [
      { name: this.asset, amount: assetAmount },
      { name: this.currency, amount: currencyAmount },
    ];

    return callback(undefined, portfolio);
  };

  const fetch = cb => {
    API.rest.User.Account.getAccountsList()
      .then(response => cb(null, response))
      .catch(err => cb(err));
  };

  retry(undefined, fetch, (err, data) => {
    this.handleResponse('getPortfolio', setBalance)(err, data);
  });
};

Trader.prototype.getFee = function(callback) {
  // getFee requires authentication
  if (!this.key || !this.secret || !this.passphrase) {
    this.fee = 0.001; // Use default fee when no credentials
    return callback(undefined, this.fee);
  }

  const handle = (err, data) => {
    if(err)  {
      return callback(err);
    }

    if(!data || !data.data) {
      this.fee = 0.001; // Default fee
      return callback(undefined, this.fee);
    }

    // KuCoin returns maker and taker fees as strings (e.g., "-0.001" or "0.001")
    // Normalize to positive decimals for Gekko's fee calculations
    const makerFee = Math.abs(parseFloat(data.data.makerFeeRate)) || 0;
    const takerFee = Math.abs(parseFloat(data.data.takerFeeRate)) || 0;
    
    // Use taker fee as it's typically higher, fallback to default if both are 0
    this.fee = takerFee || makerFee || 0.001;

    callback(undefined, this.fee);
  }

  const fetch = cb => {
    API.rest.User.User.getUserInfo()
      .then(response => cb(null, response))
      .catch(err => cb(err));
  };

  retry(undefined, fetch, (err, data) => {
    this.handleResponse('getFee', handle)(err, data);
  });
};

Trader.prototype.getTicker = function(callback) {
  const setTicker = (err, data) => {
    if (err)
      return callback(err);

    if(!data || !data.data) {
      return callback(new Error('No ticker data returned'));
    }

    var ticker = {
      ask: parseFloat(data.data.bestAsk),
      bid: parseFloat(data.data.bestBid),
    };

    callback(undefined, ticker);
  };

  const fetch = cb => {
    API.rest.Market.Symbols.getTicker(this.pair)
      .then(response => cb(null, response))
      .catch(err => cb(err));
  };

  retry(undefined, fetch, (err, data) => {
    this.handleResponse('getTicker', setTicker)(err, data);
  });
};

Trader.prototype.getPrecision = function(tickSize) {
  if (!isFinite(tickSize)) return 0;
  var e = 1, p = 0;
  while (Math.round(tickSize * e) / e !== tickSize) { e *= 10; p++; }
  return p;
};

Trader.prototype.round = function(amount, tickSize) {
  var precision = 100000000;
  var t = this.getPrecision(tickSize);

  if(Number.isInteger(t))
    precision = Math.pow(10, t);

  amount *= precision;
  amount = Math.floor(amount);
  amount /= precision;

  amount = scientificToDecimal(amount);

  return amount;
};

Trader.prototype.roundAmount = function(amount) {
  return this.round(amount, this.market.minimalOrder.amount);
}

Trader.prototype.roundPrice = function(price) {
  return this.round(price, this.market.minimalOrder.price);
}

Trader.prototype.isValidPrice = function(price) {
  return price >= this.market.minimalOrder.price;
}

Trader.prototype.isValidLot = function(price, amount) {
  return amount * price >= this.market.minimalOrder.order;
}

Trader.prototype.outbidPrice = function(price, isUp) {
  let newPrice;

  if(isUp) {
    newPrice = price + this.market.minimalOrder.price;
  } else {
    newPrice = price - this.market.minimalOrder.price;
  }

  return this.roundPrice(newPrice);
}

Trader.prototype.addOrder = function(tradeType, amount, price, callback) {
  // addOrder requires authentication
  if (!this.key || !this.secret || !this.passphrase) {
    return callback(new Error('Trading requires API credentials'));
  }

  const setOrder = (err, data) => {
    if (err) return callback(err);

    if(!data || !data.data || !data.data.orderId) {
      return callback(new Error('No order ID returned'));
    }

    const txid = data.data.orderId;

    callback(undefined, txid);
  };

  const reqData = {
    clientOid: Date.now().toString(),
    side: tradeType,
    symbol: this.pair,
    type: 'limit',
    price: price.toString(),
    size: amount.toString()
  };

  const fetch = cb => {
    API.rest.Trade.Orders.postOrder(reqData)
      .then(response => cb(null, response))
      .catch(err => cb(err));
  };

  retry(undefined, fetch, (err, data) => {
    this.handleResponse('addOrder', setOrder)(err, data);
  });
};

Trader.prototype.getOrder = function(order, callback) {
  // getOrder requires authentication
  if (!this.key || !this.secret || !this.passphrase) {
    return callback(new Error('Trading requires API credentials'));
  }

  const get = (err, data) => {
    if (err) return callback(err);

    if(!data || !data.data) {
      return callback(new Error('No order data returned'));
    }

    let price = 0;
    let amount = 0;
    let date = moment(0);

    const fees = {};

    const orderData = data.data;
    
    price = parseFloat(orderData.price);
    amount = parseFloat(orderData.dealSize);
    date = moment(orderData.createdAt);

    if(orderData.fee) {
      fees[orderData.feeCurrency] = parseFloat(orderData.fee);
    }

    callback(undefined, { price, amount, date, fees, feesCurrency: orderData.feeCurrency });
  };

  const fetch = cb => {
    API.rest.Trade.Orders.getOrderByID(order)
      .then(response => cb(null, response))
      .catch(err => cb(err));
  };

  retry(undefined, fetch, (err, data) => {
    this.handleResponse('getOrder', get)(err, data);
  });
};

Trader.prototype.buy = function(amount, price, callback) {
  this.addOrder('buy', amount, price, callback);
};

Trader.prototype.sell = function(amount, price, callback) {
  this.addOrder('sell', amount, price, callback);
};

Trader.prototype.checkOrder = function(order, callback) {
  // checkOrder requires authentication
  if (!this.key || !this.secret || !this.passphrase) {
    return callback(new Error('Trading requires API credentials'));
  }

  const check = (err, data) => {
    if(err)
      return callback(err);

    if(!data || !data.data) {
      return callback(new Error('No order data returned'));
    }

    const orderData = data.data;
    const status = orderData.isActive;

    if(status === false && orderData.cancelExist === false) {
      return callback(undefined, { executed: true, open: false });
    }

    if(status === true) {
      return callback(undefined, { executed: false, open: true, filledAmount: parseFloat(orderData.dealSize) });
    }

    if(orderData.cancelExist === true) {
      return callback(undefined, { executed: false, open: false });
    }

    console.log('Unknown order status:', status, orderData);
    throw new Error('Unknown order status');
  };

  const fetch = cb => {
    API.rest.Trade.Orders.getOrderByID(order)
      .then(response => cb(null, response))
      .catch(err => cb(err));
  };

  retry(undefined, fetch, (err, data) => {
    this.handleResponse('checkOrder', check)(err, data);
  });
};

Trader.prototype.cancelOrder = function(order, callback) {
  // cancelOrder requires authentication
  if (!this.key || !this.secret || !this.passphrase) {
    return callback(new Error('Trading requires API credentials'));
  }

  const cancel = (err, data) => {
    this.oldOrder = order;

    if(err) {
      return callback(err);
    }

    if(data && data.filled) {
      return callback(undefined, true);
    }

    return callback(undefined, false);
  };

  const fetch = cb => {
    API.rest.Trade.Orders.cancelOrderByID(order)
      .then(response => cb(null, response))
      .catch(err => cb(err));
  };

  retry(undefined, fetch, (err, data) => {
    this.handleResponse('cancelOrder', cancel)(err, data);
  });
};

Trader.getCapabilities = function() {
  return {
    name: 'KuCoin',
    slug: 'kucoin',
    currencies: marketData.currencies,
    assets: marketData.assets,
    markets: marketData.markets,
    requires: ['key', 'secret', 'passphrase'],
    providesHistory: 'date',
    providesFullHistory: true,
    tid: 'tid',
    tradable: true,
    gekkoBroker: 0.6
  };
};

module.exports = Trader;
