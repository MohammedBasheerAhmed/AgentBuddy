// The chart kit for the reports area. Pure SVG / HTML, no chart library. Every chart exposes its numbers as text (an image
// role with a summary, or a labelled group when it has drill-down buttons) and can be shown as a table.
export { default as Tile } from './Tile.jsx';
export { default as HorizontalBar } from './HorizontalBar.jsx';
export { default as StackedBar } from './StackedBar.jsx';
export { default as TrendChart } from './TrendChart.jsx';
export { default as Donut } from './Donut.jsx';
export { default as HeatStrip } from './HeatStrip.jsx';
export { default as DataTable } from './DataTable.jsx';
export { default as ChartFrame, PatternDefs, Swatch, patternId, useUid } from './ChartFrame.jsx';
export { useWidth } from './useWidth.js';
export * from './geometry.js';
