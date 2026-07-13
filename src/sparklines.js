function formatSparklineCoordinate(value) {
  const rounded = Math.round(value * 100) / 100;
  if (Object.is(rounded, -0)) return '0';
  return Number.isInteger(rounded) ? String(rounded) : String(Number(rounded.toFixed(2)));
}

function buildSparklinePoints(values, width, height) {
  const numericValues = Array.isArray(values) ? values.map(Number).filter(Number.isFinite) : [];
  const chartWidth = Number(width);
  const chartHeight = Number(height);

  if (
    !numericValues.length ||
    !Number.isFinite(chartWidth) ||
    !Number.isFinite(chartHeight) ||
    chartWidth <= 0 ||
    chartHeight <= 0
  ) {
    return '';
  }

  if (numericValues.length === 1) {
    return `${formatSparklineCoordinate(chartWidth / 2)},${formatSparklineCoordinate(chartHeight / 2)}`;
  }

  const min = Math.min(...numericValues);
  const max = Math.max(...numericValues);
  const range = max - min;

  return numericValues
    .map((value, index) => {
      const x = (chartWidth * index) / (numericValues.length - 1);
      const y = range === 0 ? chartHeight / 2 : chartHeight - ((value - min) / range) * chartHeight;
      return `${formatSparklineCoordinate(x)},${formatSparklineCoordinate(y)}`;
    })
    .join(' ');
}

export { buildSparklinePoints };
