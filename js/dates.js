const pad = (n) => String(n).padStart(2, '0');

export function today() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function monthOf(date) {
  return date.slice(0, 7);
}

export function currentMonth() {
  return monthOf(today());
}

export function formatDate(date) {
  const [year, month, day] = date.split('-');
  return `${day}.${month}.${year}`;
}

export function monthRange(month) {
  const [year, number] = month.split('-').map(Number);
  const last = new Date(year, number, 0).getDate();
  return [`${month}-01`, `${month}-${pad(last)}`];
}

export function addMonths(month, delta) {
  const [year, number] = month.split('-').map(Number);
  const shifted = new Date(year, number - 1 + delta, 1);
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}`;
}

export function addDays(date, delta) {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(year, month - 1, day + delta);
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-${pad(shifted.getDate())}`;
}

const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const monthGenitive = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export function formatMonth(month) {
  const [year, number] = month.split('-').map(Number);
  return `${monthNames[number - 1]} ${year}`;
}

export function formatMonthShort(month) {
  const [year, number] = month.split('-').map(Number);
  return `${monthNames[number - 1].slice(0, 3).toLowerCase()} ${year}`;
}

export function formatDay(date) {
  const now = today();
  if (date === now) return 'Сегодня';
  if (date === addDays(now, -1)) return 'Вчера';
  const [year, month, day] = date.split('-').map(Number);
  const base = `${day} ${monthGenitive[month - 1]}`;
  return year === Number(now.slice(0, 4)) ? base : `${base} ${year}`;
}
