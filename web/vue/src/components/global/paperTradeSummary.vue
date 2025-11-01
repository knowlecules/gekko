<template lang='pug'>
.grd-row-col-3-6
  table.p1
    tr
      th amount of trades
      td {{ report.trades }}
    tr(v-if='tradeSize')
      th trade size (per tranche)
      td {{ round(tradeSize) }} {{ report.currency }}
    tr(v-if='tradeSize')
      th total amount traded
      td {{ round(totalTraded) }} {{ report.currency }}
    tr
      th sharpe ratio
      td {{ round2(report.sharpe) }}
    tr
      th start balance
      td {{ round(report.startBalance) }} {{ report.currency }}
    tr
      th final balance
      td {{ round(report.balance) }} {{ report.currency }}
    tr
      th simulated profit

  .big.txt--right.price(:class='profitClass') {{ round(report.relativeProfit) }}%

</template>

<script>

export default {
  props: ['report'],
  methods: {
    round2: n => (+n).toFixed(2),
    round: n => (+n).toFixed(5)
  },
  computed: {
    profitClass: function() {
      if(this.report.relativeProfit > 0)
        return 'profit'
      else
        return 'loss'
    },
    tradeSize: function() {
      if(this.report.strategyParameters && this.report.strategyParameters.trade_amount_percentage) {
        const percentage = this.report.strategyParameters.trade_amount_percentage;
        const investment = this.report.strategyParameters.investment || this.report.startBalance;
        return (investment * percentage) / 100;
      }
      return null;
    },
    totalTraded: function() {
      if(this.tradeSize && this.report.trades) {
        return this.tradeSize * this.report.trades;
      }
      return 0;
    }
  }
}
</script>

<style>
.summary td {
  text-align: right;
}

.big {
  font-size: 1.3em;
  width: 80%;
}

.summary table {
  width: 80%;
}

.price.profit {
  color: #7FFF00;
}

.price.loss {
  color: red;
}

</style>
