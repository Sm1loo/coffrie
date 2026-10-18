import { parseMoney } from './money.js';

const INCOME_WORDS = ['зарплата', 'зачисление', 'поступление', 'пополнение', 'возврат', 'перевод от', 'кэшбэк'];
const EXPENSE_WORDS = ['покупка', 'оплата', 'списание', 'выдача', 'платёж', 'платеж', 'перевод'];

const AMOUNT = /(\d[\d  ]*(?:[.,]\d{1,2})?)\s?(?:р|₽|руб)(?![а-яёa-z])/i;
const CARD = /(?:visa|mir|мир|master(?:card)?|maestro|сч[её]т)[\s*-]*(\d{4})/i;

export function parseSms(text) {
  const source = String(text).replace(/\s+/g, ' ').trim();
  const balanceAt = source.search(/баланс/i);
  const head = balanceAt === -1 ? source : source.slice(0, balanceAt).trim();
  const found = head.match(AMOUNT);
  if (!found) return null;
  const amount = parseMoney(found[1]);
  if (amount === null || amount < 1) return null;

  const lower = head.toLowerCase();
  let kind = null;
  if (INCOME_WORDS.some((word) => lower.includes(word))) kind = 'income';
  else if (EXPENSE_WORDS.some((word) => lower.includes(word))) kind = 'expense';
  if (kind === null) return null;

  const note = head.slice(found.index + found[0].length).replace(/^[\s.,;:-]+/, '').trim();
  const card = head.match(CARD);
  return { kind, amount, note, card: card ? card[1] : null };
}
