<template lang='pug'>
  .contain.trades-table
    h2 Trades
    table(v-if='trades.length')
      thead
        tr
          th #
          th Action
          th Date (UTC)
          th Price
          th Amount
          th Trade Size
          th Trigger
          th Capital Used
          th Pump
          th Dump
          th Plateau
      tbody
        tr(v-for='(trade, index) in trades', :class='trade.action')
          td {{ index + 1 }}
          td.action(:class='trade.action') {{ trade.action.toUpperCase() }}
          td {{ fmt(trade.date) }}
          td {{ trade.price.toFixed(2) }}
          td {{ trade.amount ? trade.amount.toFixed(8) : '-' }}
          td {{ getTradeSize(trade) }}
          td {{ getTrigger(trade) }}
          td {{ getCapitalUsed(trade) }}
          td(:class='getPumpClass(trade)') {{ getPump(trade) }}
          td(:class='getDumpClass(trade)') {{ getDump(trade) }}
          td(:class='getPlateauClass(trade)') {{ getPlateau(trade) }}
    div(v-if='!trades.length')
      p No trades executed
</template>

<script>
import _ from 'lodash'

export default {
  props: ['trades'],
  data: () => {
    return {}
  },
  methods: {
    fmt: date => {
      let mom;
      if(_.isNumber(date)) {
        mom = moment.unix(date);
      } else {
        mom = moment(date).utc();
      }
      return mom.utc().format('YYYY-MM-DD HH:mm');
    },
    getTradeSize: (trade) => {
      if (trade.strategyState && trade.strategyState.tradeAmount) {
        return trade.strategyState.tradeAmount.toFixed(2);
      }
      return '-';
    },
    getTrigger: (trade) => {
      if (trade.strategyState && trade.strategyState.trigger) {
        return trade.strategyState.trigger;
      }
      return '-';
    },
    getCapitalUsed: (trade) => {
      if (trade.strategyState && trade.strategyState.capitalUsed) {
        return trade.strategyState.capitalUsed.toFixed(2);
      }
      return '-';
    },
    getPump: (trade) => {
      if (trade.strategyState) {
        return trade.strategyState.detected_pump ? 'YES' : 'no';
      }
      return '-';
    },
    getDump: (trade) => {
      if (trade.strategyState) {
        return trade.strategyState.detected_dump ? 'YES' : 'no';
      }
      return '-';
    },
    getPlateau: (trade) => {
      if (trade.strategyState) {
        return trade.strategyState.in_plateau ? 'YES' : 'no';
      }
      return '-';
    },
    getPumpClass: (trade) => {
      if (trade.strategyState && trade.strategyState.detected_pump) {
        return 'state-active';
      }
      return 'state-inactive';
    },
    getDumpClass: (trade) => {
      if (trade.strategyState && trade.strategyState.detected_dump) {
        return 'state-active';
      }
      return 'state-inactive';
    },
    getPlateauClass: (trade) => {
      if (trade.strategyState && trade.strategyState.in_plateau) {
        return 'state-active';
      }
      return 'state-inactive';
    }
  },
}
</script>

<style>

.trades-table {
  margin-top: 50px;
  margin-bottom: 50px;
}

.trades-table table {
  width: 100%;
  border-collapse: collapse;
}

.trades-table table th,
.trades-table table td {
  border: 1px solid #c6cbd1;
  padding: 6px 10px;
  font-size: 13px;
}

.trades-table table th {
  background-color: #f1f1f1;
  font-weight: bold;
  text-align: left;
}

.trades-table table tr.buy {
  background-color: #e8f5e9;
}

.trades-table table tr.sell {
  background-color: #ffebee;
}

.trades-table table tr.buy:hover,
.trades-table table tr.sell:hover {
  background-color: #fff9c4;
}

.trades-table table td.action.buy {
  color: #2e7d32;
  font-weight: bold;
}

.trades-table table td.action.sell {
  color: #c62828;
  font-weight: bold;
}

.trades-table table td.state-active {
  color: #1565c0;
  font-weight: bold;
}

.trades-table table td.state-inactive {
  color: #9e9e9e;
}

</style>
