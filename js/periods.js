import { addMonths, formatDate, formatMonth, formatMonthShort, monthRange } from './dates.js';

export const PERIODS = [
  { value: 'month', label: 'Месяц' },
  { value: 'quarter', label: '3 месяца' },
  { value: 'year', label: 'Год' },
  { value: 'custom', label: 'Период' },
];

const STEPS = { month: 1, quarter: 3, year: 12 };

export function stepMonths(period) {
  return STEPS[period] ?? 0;
}

export function boundsFor({ period, month, custom }) {
  if (period === 'quarter') {
    const start = addMonths(month, -2);
    return { from: monthRange(start)[0], to: monthRange(month)[1], label: `${formatMonthShort(start)} – ${formatMonthShort(month)}` };
  }
  if (period === 'year') {
    const year = month.slice(0, 4);
    return { from: `${year}-01-01`, to: `${year}-12-31`, label: year };
  }
  if (period === 'custom') {
    if (custom.mode === 'months') {
      const [first, last] = custom.fromMonth <= custom.toMonth ? [custom.fromMonth, custom.toMonth] : [custom.toMonth, custom.fromMonth];
      return { from: monthRange(first)[0], to: monthRange(last)[1], label: `${formatMonth(first)} – ${formatMonth(last)}` };
    }
    const [from, to] = custom.from <= custom.to ? [custom.from, custom.to] : [custom.to, custom.from];
    return { from, to, label: `${formatDate(from)} – ${formatDate(to)}` };
  }
  const [from, to] = monthRange(month);
  return { from, to, label: formatMonth(month) };
}
