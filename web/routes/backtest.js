// simple POST request that returns the backtest result

const _ = require('lodash');
const promisify = require('tiny-promisify');
const pipelineRunner = promisify(require('../../core/workers/pipeline/parent'));

// starts a backtest
// requires a post body like:
//
// {
//   gekkoConfig: {watch: {exchange: "poloniex", currency: "USDT", asset: "BTC"},…},…}
//   data: {
//     candleProps: ["close", "start"],
//     indicatorResults: true,
//     report: true,
//     roundtrips: true
//   }
// }
module.exports = function *() {
  var mode = 'backtest';

  var config = {};

  var base = require('./baseConfig');

  var req = this.request.body;

  _.merge(config, base, req);

  var result = yield pipelineRunner(mode, config);
  
  // Debug: log trades count
  console.log('[Backtest API] Result trades count:', result && result.trades ? result.trades.length : 'no trades array');
  console.log('[Backtest API] Result roundtrips count:', result && result.roundtrips ? result.roundtrips.length : 'no roundtrips array');
  
  this.body = result;
}