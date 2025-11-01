# Cryptocurrency Backtester Design Guidelines

## Design Approach

**Selected Approach**: Design System (Fintech-Focused)
**Reference Products**: TradingView, Coinbase Pro, Bloomberg Terminal
**Justification**: Data-dense financial application requiring clarity, precision, and professional data visualization standards.

## Core Design Elements

### Typography System
- **Primary Font**: Inter (Google Fonts) - exceptional readability for numbers and data
- **Monospace Font**: JetBrains Mono - for numerical data, timestamps, and code-like elements
- **Hierarchy**:
  - Page Headers: text-2xl font-semibold
  - Section Headers: text-lg font-semibold
  - Metric Labels: text-sm font-medium uppercase tracking-wide
  - Metric Values: text-3xl font-bold (monospace)
  - Body Text: text-base
  - Table Data: text-sm (monospace for numbers)
  - Small Labels: text-xs font-medium

### Layout System
**Spacing Primitives**: Use Tailwind units of 2, 4, 6, and 8 for consistency
- Component padding: p-6
- Section spacing: space-y-6
- Card padding: p-6
- Grid gaps: gap-6
- Element margins: m-2, m-4

**Grid Structure**:
- Main container: max-w-7xl mx-auto px-6
- Two-column data grids: grid-cols-2 md:grid-cols-4 for metrics
- Three-column layout for performance cards

## Application Structure

### Header (Sticky Navigation)
- Full-width with shadow, py-4 px-6
- Left: Application logo/title
- Center: Backtest configuration controls (dropdown filters, date range picker)
- Right: Action buttons ("New Backtest", "Export Results")

### Primary Content Area

**1. Overview Dashboard (Top Section)**
- Four-column metrics grid displaying key performance indicators:
  - Total Return (with percentage badge)
  - Win Rate
  - Max Drawdown
  - Sharpe Ratio
- Each metric card: rounded-lg border with p-6, icon (top-left), label, large value, change indicator

**2. Performance Chart Section**
- Full-width chart container with tabs above ("Equity Curve", "Drawdown", "Returns Distribution")
- Chart height: h-96
- Use Chart.js or Recharts library
- Include zoom controls and time period selectors
- Legend positioned top-right within chart area

**3. Statistics Panel (Two-Column Layout)**
Left Column - Trade Statistics:
- Total Trades, Winning Trades, Losing Trades
- Average Win/Loss, Best/Worst Trade
- Profit Factor, Risk/Reward Ratio

Right Column - Portfolio Metrics:
- Starting Capital, Ending Capital
- Total Fees Paid
- Time in Market
- Average Position Size

**4. Trade History Table**
- Full-width data table with sortable columns
- Columns: Entry Date, Exit Date, Symbol, Side (Buy/Sell), Entry Price, Exit Price, Quantity, P&L, P&L%
- Alternating row backgrounds for readability
- Sticky header row
- Pagination controls at bottom
- Max height with scroll: max-h-96 overflow-y-auto

**5. Strategy Parameters Sidebar** (Optional collapsible panel)
- Display backtest configuration
- Parameter list with labels and values
- Grouped sections (Trading Rules, Risk Management, Filters)

## Component Library

### Metric Cards
- Rounded corners (rounded-lg), border, shadow-sm
- Icon container: rounded-full p-2 (positioned top-left)
- Label: text-sm font-medium tracking-wide
- Value: text-3xl font-bold monospace
- Change indicator: badge with arrow icon and percentage

### Data Tables
- Striped rows for readability
- Hover state on rows
- Monospace font for numerical columns
- Right-aligned numbers, left-aligned text
- Positive values: green accent, Negative values: red accent
- Border on all sides of table

### Chart Containers
- White/light background with subtle border
- Rounded corners (rounded-lg)
- Internal padding: p-4
- Tab navigation for multiple chart types
- Time period selector buttons (1D, 1W, 1M, 3M, 1Y, ALL)

### Badges & Pills
- For trade side (Buy/Sell): rounded-full px-3 py-1 text-xs font-semibold
- For status indicators: similar styling with contextual backgrounds
- Percentage changes: inline badges with arrow icons

### Buttons
Primary Action: px-6 py-2 rounded-lg font-medium
Secondary Action: px-4 py-2 rounded-lg border font-medium
Icon Buttons: p-2 rounded-lg (for filters, exports)

### Form Controls (Filters & Inputs)
- Date range picker: border rounded-lg px-4 py-2
- Dropdown selects: consistent with date picker styling
- Search input: with search icon prefix

## Visual Hierarchy Rules

1. **Primary Focus**: Performance metrics and equity curve chart occupy top 60% of viewport
2. **Secondary Content**: Statistics panel and trade table below, scrollable
3. **Data Density**: Information-rich without clutter - every pixel serves a purpose
4. **Contrast**: High contrast for numerical data, subtle backgrounds for context
5. **Grouping**: Clear visual separation between sections using borders and spacing

## Images

**No Hero Image Required** - This is a data application interface, not a marketing page.

**Icon Usage**:
- Use Heroicons (outline style) via CDN
- Metric cards: TrendingUp, TrendingDown, ChartBar, ShieldCheck
- Navigation: ChartPie, ClockHistory, Download, Settings
- Table actions: Filter, Sort, ArrowsUpDown
- Size: w-5 h-5 for standard icons, w-6 h-6 for emphasis

## Responsive Behavior

- Desktop (lg): Full multi-column layout
- Tablet (md): Two-column metrics, full-width chart, stacked statistics
- Mobile: Single column, metrics stack vertically, horizontal scroll for table

**Critical**: Maintain data readability at all viewport sizes - numbers must remain legible even on mobile devices.