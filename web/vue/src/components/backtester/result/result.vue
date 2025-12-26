<template lang='pug'>
  div
    .hr.contain
    div.contain
      h3 Backtest result
    result-summary(:report='enhancedReport')
    .hr.contain
    chart(:data='candles', height='500')
    .hr.contain
    tradesTable(:trades='result.trades')
</template>

<script>
import resultSummary from './summary.vue'
import chart from './chartWrapper.vue'
import tradesTable from './tradesTable.vue'

export default {
  props: ['result'],
  data: () => {
    return {}
  },
  methods: {},
  components: {
    tradesTable,
    resultSummary,
    chart
  },
  computed: {
    candles: function() {
      return {
        candles: this.result.stratCandles,
        trades: this.result.trades
      };
    },
    enhancedReport: function() {
      return {
        ...this.result.performanceReport,
        strategyParameters: this.result.strategyParameters
      };
    }
  }
}
</script>

<style>
</style>
