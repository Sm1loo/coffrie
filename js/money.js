export const MAX_MONEY = 100_000_000_000;

export function parseMoney(text) {
  const clean = String(text).replace(/[\s ]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const [whole, fraction = ''] = clean.split('.');
  const kopecks = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(kopecks) && kopecks <= MAX_MONEY ? kopecks : null;
}

export function parseSignedMoney(text) {
  const trimmed = String(text).trim();
  if (trimmed.startsWith('-')) {
    const value = parseMoney(trimmed.slice(1));
    return value === null ? null : -value;
  }
  return parseMoney(trimmed);
}

const formats = new Map();

function formatterFor(currency) {
  if (!formats.has(currency)) {
    formats.set(currency, new Intl.NumberFormat('ru-RU', { style: 'currency', currency, maximumFractionDigits: 2 }));
  }
  return formats.get(currency);
}

export function formatMoney(kopecks, currency = 'RUB') {
  return formatterFor(currency).format(kopecks / 100);
}

export function formatPlain(kopecks) {
  if (kopecks % 100 === 0) return String(kopecks / 100);
  return (kopecks / 100).toFixed(2).replace('.', ',');
}
