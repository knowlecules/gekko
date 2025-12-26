import _ from 'lodash';
// global moment

export default function(_data, _trades, _height) {

  console.log('[Chart4] Received trades:', _trades ? _trades.length : 'null/undefined', _trades);

  const toDate = i => {
    if(_.isNumber(i)) {
      return moment.unix(i).utc().toDate();
    } else {
      return moment.utc(i).toDate();
    }
  }

  const trades = _trades.map(t => {
    return {
      price: t.price,
      date: toDate(t.date),
      action: t.action,
      strategyState: t.strategyState || null
    }
  });
  
  console.log('[Chart4] Processed trades:', trades.length, trades);

  const data = _data.map(c => {
    return {
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      date: toDate(c.start)
    }
  });

  var dates = data.map(c => +c.date);
  var highs = data.map(c => +c.high);
  var lows = data.map(c => +c.low);

  var svg = d3.select("#chart");

  svg.attr("width", window.innerWidth - 20);

  var margin = {top: 20, right: 20, bottom: 110, left: 40};
  var height = _height - margin.top - margin.bottom;
  var margin2 = {top: _height - 70, right: 20, bottom: 30, left: 40};
  var width = +svg.attr("width") - margin.left - margin.right;
  var height2 = _height - margin2.top - margin2.bottom;

  var x = d3.scaleUtc().range([0, width]),
      x2 = d3.scaleUtc().range([0, width]),
      y = d3.scaleLinear().range([height, 0]),
      y2 = d3.scaleLinear().range([height2, 0]);

  var xAxis = d3.axisBottom(x),
      xAxis2 = d3.axisBottom(x2),
      yAxis = d3.axisLeft(y).ticks(_height / 50);

  var brush = d3.brushX()
      .extent([[0, 0], [width, height2]])
      .on("brush end", brushed);

  var zoom = d3.zoom()
      .scaleExtent([1, 100])
      .translateExtent([[0, 0], [width, height]])
      .extent([[0, 0], [width, height]])
      .on("zoom", zoomed);

  var candleWidth = Math.max(1, (width / data.length) * 0.8);

  svg.append("defs").append("clipPath")
      .attr("id", "clip")
    .append("rect")
      .attr("width", width)
      .attr("height", height);

  var focus = svg.append("g")
      .attr("class", "focus")
      .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

  var context = svg.append("g")
      .attr("class", "context")
      .attr("transform", "translate(" + margin2.left + "," + margin2.top + ")");

  x.domain(d3.extent(data, function(d) { return d.date; }));
  y.domain([
    d3.min(lows) * 0.99,
    d3.max(highs) * 1.01
  ]);
  x2.domain(x.domain());
  y2.domain(y.domain());

  // Draw candlesticks in focus (main chart)
  var candleGroups = focus.append("g")
      .attr("class", "candles")
      .attr("clip-path", "url(#clip)")
      .selectAll("g")
      .data(data)
      .enter().append("g")
        .attr("class", "candle");

  // Draw wicks (high-low lines)
  candleGroups.append("line")
      .attr("class", "wick")
      .attr("x1", function(d) { return x(d.date); })
      .attr("x2", function(d) { return x(d.date); })
      .attr("y1", function(d) { return y(d.high); })
      .attr("y2", function(d) { return y(d.low); });

  // Draw candle bodies
  candleGroups.append("rect")
      .attr("class", function(d) { return d.close >= d.open ? "candle-body up" : "candle-body down"; })
      .attr("x", function(d) { return x(d.date) - candleWidth / 2; })
      .attr("y", function(d) { return y(Math.max(d.open, d.close)); })
      .attr("width", candleWidth)
      .attr("height", function(d) { 
        var h = Math.abs(y(d.open) - y(d.close));
        return h === 0 ? 1 : h; // minimum height of 1px for doji candles
      });

  // Draw candlesticks in context (mini chart)
  var contextCandleWidth = Math.max(1, (width / data.length) * 0.6);
  
  var contextCandleGroups = context.append("g")
      .attr("class", "candles-mini")
      .selectAll("g")
      .data(data)
      .enter().append("g")
        .attr("class", "candle-mini");

  // Draw mini wicks
  contextCandleGroups.append("line")
      .attr("class", "wick-mini")
      .attr("x1", function(d) { return x2(d.date); })
      .attr("x2", function(d) { return x2(d.date); })
      .attr("y1", function(d) { return y2(d.high); })
      .attr("y2", function(d) { return y2(d.low); });

  // Draw mini candle bodies
  contextCandleGroups.append("rect")
      .attr("class", function(d) { return d.close >= d.open ? "candle-body-mini up" : "candle-body-mini down"; })
      .attr("x", function(d) { return x2(d.date) - contextCandleWidth / 2; })
      .attr("y", function(d) { return y2(Math.max(d.open, d.close)); })
      .attr("width", contextCandleWidth)
      .attr("height", function(d) { 
        var h = Math.abs(y2(d.open) - y2(d.close));
        return h === 0 ? 1 : h;
      });

  focus.append("g")
      .attr("class", "axis axis--x")
      .attr("transform", "translate(0," + height + ")")
      .call(xAxis);

  focus.append("g")
      .attr("class", "axis axis--y")
      .call(yAxis);

  context.append("g")
      .attr("class", "axis axis--x")
      .attr("transform", "translate(0," + height2 + ")")
      .call(xAxis2);

  // Create tooltip div
  var tooltip = d3.select("body").append("div")
    .attr("class", "chart-tooltip")
    .style("position", "absolute")
    .style("visibility", "hidden")
    .style("background-color", "rgba(0, 0, 0, 0.85)")
    .style("color", "#fff")
    .style("padding", "10px")
    .style("border-radius", "4px")
    .style("font-size", "12px")
    .style("max-width", "300px")
    .style("z-index", "1000")
    .style("pointer-events", "none");

  // Format tooltip content from strategy state
  function formatTooltip(d) {
    var content = '<strong>' + d.action.toUpperCase() + '</strong><br>';
    content += 'Price: ' + d.price.toFixed(2) + '<br>';
    content += 'Date: ' + moment(d.date).format('YYYY-MM-DD HH:mm') + '<br>';
    
    if (d.strategyState) {
      var s = d.strategyState;
      content += '<hr style="margin: 5px 0; border-color: #666">';
      content += '<strong>Trigger:</strong> ' + s.trigger + '<br>';
      content += '<strong>Trade:</strong> ' + (s.isInitialTrade ? 'INITIAL (50%)' : 'Subsequent (' + s.tradePercentage + '%)') + '<br>';
      content += '<strong>Amount:</strong> ' + s.tradeAmount.toFixed(2) + '<br>';
      content += '<strong>Capital Used:</strong> ' + s.capitalUsed.toFixed(2) + '<br>';
      content += '<hr style="margin: 5px 0; border-color: #666">';
      content += '<strong>State at trigger:</strong><br>';
      content += '&nbsp;&nbsp;Pump detected: ' + s.detected_pump + '<br>';
      content += '&nbsp;&nbsp;Dump detected: ' + s.detected_dump + '<br>';
      content += '&nbsp;&nbsp;In plateau: ' + s.in_plateau + '<br>';
      content += '&nbsp;&nbsp;Plateau count: ' + s.plateau_count + '<br>';
      if (s.sell_limit > 0) content += '&nbsp;&nbsp;Sell limit: ' + s.sell_limit.toFixed(2) + '<br>';
      if (s.buy_limit > 0) content += '&nbsp;&nbsp;Buy limit: ' + s.buy_limit.toFixed(2) + '<br>';
      if (s.plateau_high > 0) content += '&nbsp;&nbsp;Plateau range: ' + s.plateau_low.toFixed(2) + ' - ' + s.plateau_high.toFixed(2);
    }
    return content;
  }

  var circles = svg
    .append('g')
    .attr("transform", "translate(" + margin.left + "," + margin.top + ")")
      .selectAll("circle")
      .data(trades)
      .enter().append("circle")
        .attr('class', function(d) { return d.action })
        .attr("cx", function(d) { return x(d.date); })
        .attr("cy", function(d) { return y(d.price); })
        .attr('r', 5)
        .style("cursor", "pointer")
        .on("mouseover", function(d) {
          tooltip.html(formatTooltip(d))
            .style("visibility", "visible");
        })
        .on("mousemove", function() {
          tooltip.style("top", (d3.event.pageY - 10) + "px")
            .style("left", (d3.event.pageX + 10) + "px");
        })
        .on("mouseout", function() {
          tooltip.style("visibility", "hidden");
        });

  var brushCircles = context
    .append('g')
      .selectAll("circle")
      .data(trades)
      .enter().append("circle")
        .attr('class', function(d) { return d.action })
        .attr("cx", function(d) { return x2(d.date); })
        .attr("cy", function(d) { return y2(d.price); })
        .attr('r', 3);


  context.append("g")
      .attr("class", "brush")
      .call(brush)
      .call(brush.move, x.range());

  svg.append("rect")
      .attr("class", "zoom")
      .attr("width", width)
      .attr("height", height)
      .attr("transform", "translate(" + margin.left + "," + margin.top + ")")
      .call(zoom);

  function brushed() {
    if (d3.event.sourceEvent && d3.event.sourceEvent.type === "zoom") return;
    var s = d3.event.selection || x2.range();
    x.domain(s.map(x2.invert, x2));

    scaleY(x.domain());

    svg.select(".axis--y")
      .call(yAxis);

    circles
      .attr("cx", function(d) { return x(d.date); })
      .attr("cy", function(d) { return y(d.price); })

    updateCandlesticks();
    focus.select(".axis--x").call(xAxis);
    svg.select(".zoom").call(zoom.transform, d3.zoomIdentity
        .scale(width / (s[1] - s[0]))
        .translate(-s[0], 0));
  }

  function scaleY(domain) {
    let [min, max] = domain;

    let minIndex = _.sortedIndex(dates, min);
    let maxIndex = _.sortedIndex(dates, max);

    let highsSet = highs.slice(minIndex, maxIndex);
    let lowsSet = lows.slice(minIndex, maxIndex);
    y.domain([
      d3.min(lowsSet) * 0.9995,
      d3.max(highsSet) * 1.0005
    ]);
  }

  function updateCandlesticks() {
    var visibleData = data.filter(function(d) {
      var xPos = x(d.date);
      return xPos >= 0 && xPos <= width;
    });
    var newCandleWidth = Math.max(1, (width / visibleData.length) * 0.8);

    focus.selectAll(".candle .wick")
      .attr("x1", function(d) { return x(d.date); })
      .attr("x2", function(d) { return x(d.date); })
      .attr("y1", function(d) { return y(d.high); })
      .attr("y2", function(d) { return y(d.low); });

    focus.selectAll(".candle .candle-body")
      .attr("x", function(d) { return x(d.date) - newCandleWidth / 2; })
      .attr("y", function(d) { return y(Math.max(d.open, d.close)); })
      .attr("width", newCandleWidth)
      .attr("height", function(d) { 
        var h = Math.abs(y(d.open) - y(d.close));
        return h === 0 ? 1 : h;
      });
  }

  function zoomed() {
    if (d3.event.sourceEvent && d3.event.sourceEvent.type === "brush") return;
    var t = d3.event.transform;

    scaleY(t.rescaleX(x2).domain());    

    svg.select(".axis--y")
      .call(yAxis);

    x.domain(t.rescaleX(x2).domain());

    circles
      .attr("cx", function(d) { return x(d.date); })
      .attr("cy", function(d) { return y(d.price); })

    updateCandlesticks();
    focus.select(".axis--x").call(xAxis);
    context.select(".brush").call(brush.move, x.range().map(t.invertX, t));
  }
}
