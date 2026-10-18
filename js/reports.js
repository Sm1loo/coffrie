import { addMonths, currentMonth, formatDay, formatMonth, formatMonthShort, monthOf } from './dates.js';
import { formatMoney } from './money.js';
import { PERIODS, boundsFor, stepMonths } from './periods.js';
import { bar, card, primaryCurrency, stat, txRow } from './screens.js';
import { emptyState, fieldButton, h, monthSwitcher, openSheet, pick, segmented } from './ui.js';

const MINUS = '−';

function monthOptions(ledger) {
  const now = currentMonth();
  const months = ledger.state.transactions.map((tx) => monthOf(tx.occurredOn));
  const first = [addMonths(now, -24), ...months].sort()[0];
  const options = [];
  for (let month = addMonths(now, 12); month >= first; month = addMonths(month, -1)) {
    options.push({ value: month, label: formatMonth(month) });
  }
  return options;
}

function openPeriodEditor(ctx) {
  const { ledger, ui } = ctx;
  const form = { ...ui.reportCustom };
  openSheet({
    title: 'Свой период',
    build(handle) {
      const errorBox = h('div', { class: 'form-error', role: 'alert' });
      const chooseMonth = async (key, title) => {
        const value = await pick({ title, options: monthOptions(ledger), selected: form[key], searchable: true });
        if (value === undefined) return;
        form[key] = value;
        handle.render();
      };
      const apply = () => {
        if (form.mode === 'dates') {
          if (!form.from || !form.to) {
            errorBox.textContent = 'Укажите обе даты';
            return;
          }
          if (form.from > form.to) {
            errorBox.textContent = 'Начало периода позже конца';
            return;
          }
        } else if (form.fromMonth > form.toMonth) {
          errorBox.textContent = 'Начальный месяц позже конечного';
          return;
        }
        ui.reportCustom = form;
        ui.reportPeriod = 'custom';
        handle.close();
        ctx.rerender();
      };
      return h(
        'form',
        {
          class: 'tx-form',
          novalidate: true,
          onSubmit: (event) => {
            event.preventDefault();
            apply();
          },
        },
        segmented(
          [
            { value: 'dates', label: 'По датам' },
            { value: 'months', label: 'По месяцам' },
          ],
          form.mode,
          (mode) => {
            form.mode = mode;
            handle.render();
          },
        ),
        form.mode === 'dates'
          ? [
              h('label', { class: 'input-row' }, h('span', { class: 'field-label' }, 'С даты'), h('input', { type: 'date', value: form.from, onChange: (event) => (form.from = event.target.value) })),
              h('label', { class: 'input-row' }, h('span', { class: 'field-label' }, 'По дату'), h('input', { type: 'date', value: form.to, onChange: (event) => (form.to = event.target.value) })),
              h('p', { class: 'muted hint' }, 'Например, с 13.09.2026 по 18.09.2026: обе даты входят в период.'),
            ]
          : [
              fieldButton('С месяца', formatMonth(form.fromMonth), () => chooseMonth('fromMonth', 'С месяца')),
              fieldButton('По месяц', formatMonth(form.toMonth), () => chooseMonth('toMonth', 'По месяц')),
              h('p', { class: 'muted hint' }, 'Период начинается с первого дня первого месяца и заканчивается последним днём последнего месяца.'),
            ],
        errorBox,
        h('div', { class: 'actions' }, h('button', { class: 'button primary', type: 'submit' }, 'Применить')),
      );
    },
  });
}

function openOpsSheet(ctx, { title, subtitle, filter }) {
  const { ledger } = ctx;
  const all = ledger.listTransactions(filter).items;
  const shown = all.slice(0, 300);
  const sums = new Map();
  for (const tx of all) {
    const currency = ledger.account(tx.accountId).currency;
    const entry = sums.get(currency) ?? { income: 0, expense: 0, transfer: 0 };
    entry[tx.kind] += tx.amount;
    sums.set(currency, entry);
  }

  openSheet({
    title,
    build(handle) {
      const totals = [...sums].map(([currency, sum]) =>
        h(
          'div',
          { class: 'sheet-totals' },
          sum.income > 0 ? h('span', { class: 'income' }, `Доходы: ${formatMoney(sum.income, currency)}`) : null,
          sum.expense > 0 ? h('span', { class: 'expense' }, `Расходы: ${formatMoney(sum.expense, currency)}`) : null,
          sum.transfer > 0 ? h('span', {}, `Переводы: ${formatMoney(sum.transfer, currency)}`) : null,
        ),
      );
      const rows = [];
      let day = '';
      for (const tx of shown) {
        if (tx.occurredOn !== day) {
          day = tx.occurredOn;
          rows.push(h('div', { class: 'day' }, formatDay(day)));
        }
        rows.push(txRow(ctx, tx, { before: () => handle.close() }));
      }
      return h(
        'div',
        { class: 'ops-sheet' },
        h('p', { class: 'muted' }, `${subtitle} · операций: ${all.length}`),
        totals,
        all.length === 0 ? emptyState('Операций нет.') : h('div', { class: 'ops-list flat' }, rows),
        all.length > shown.length ? h('p', { class: 'muted' }, `Показаны первые ${shown.length} из ${all.length}. Сузьте период, чтобы увидеть остальные.`) : null,
      );
    },
  });
}

export function reportsScreen(ctx) {
  const { ledger, ui } = ctx;
  const bounds = boundsFor({ period: ui.reportPeriod, month: ui.month, custom: ui.reportCustom });
  const { from, to, label } = bounds;
  const summary = ledger.summary(from, to);
  const monthly = ledger.monthly(from, to);
  const currencies = summary.totals.map((total) => total.currency);
  const currency = currencies.includes(ui.reportCurrency) ? ui.reportCurrency : (currencies[0] ?? primaryCurrency(ledger));
  const total = summary.totals.find((item) => item.currency === currency) ?? { income: 0, expense: 0 };
  const step = stepMonths(ui.reportPeriod);
  const transfers = ledger.listTransactions({ from, to, kind: 'transfer' }).total;

  const open = (title, extra) => openOpsSheet(ctx, { title, subtitle: label, filter: { from, to, currency, ...extra } });

  const categoryBlock = (kind, title) => {
    const rows = summary.byCategory.filter((entry) => entry.kind === kind && entry.currency === currency);
    if (rows.length === 0) return null;
    const sum = rows.reduce((acc, entry) => acc + entry.total, 0);
    return card(
      title,
      rows.map((entry) =>
        h(
          'button',
          {
            class: 'row report-row',
            type: 'button',
            onClick: () => open(entry.name ?? 'Без категории', { kind, categoryId: entry.categoryId ?? undefined, noCategory: entry.categoryId === null }),
          },
          h('span', { class: 'row-main' }, h('span', { class: 'report-head' }, h('span', {}, entry.name ?? 'Без категории'), h('span', { class: 'amount' }, formatMoney(entry.total, currency))), bar((entry.total / sum) * 100, kind), h('span', { class: 'row-sub' }, `${Math.round((entry.total / sum) * 100)}%`)),
        ),
      ),
    );
  };

  const series = monthly.filter((row) => row.currency === currency);
  const peak = Math.max(1, ...series.flatMap((row) => [row.income, row.expense]));
  const manyYears = series.length > 12;
  const net = total.income - total.expense;

  return h(
    'div',
    { class: 'screen' },
    segmented(PERIODS, ui.reportPeriod, (value) => {
      ui.reportPeriod = value;
      ui.month = currentMonth();
      if (value === 'custom' && !ui.reportCustomSet) {
        ui.reportCustomSet = true;
        ctx.rerender();
        openPeriodEditor(ctx);
        return;
      }
      ctx.rerender();
    }),
    step > 0
      ? monthSwitcher(label, () => ctx.setMonth(addMonths(ui.month, -step)), () => ctx.setMonth(addMonths(ui.month, step)))
      : fieldButton('Период', label, () => openPeriodEditor(ctx)),
    currencies.length > 1
      ? h(
          'div',
          { class: 'chips' },
          currencies.map((code) =>
            h(
              'button',
              {
                class: `chip${code === currency ? ' active' : ''}`,
                type: 'button',
                onClick: () => {
                  ui.reportCurrency = code;
                  ctx.rerender();
                },
              },
              code,
            ),
          ),
        )
      : null,
    card(
      'Итого',
      h(
        'div',
        { class: 'stats' },
        stat('Доходы', formatMoney(total.income, currency), 'income', () => open('Доходы', { kind: 'income' })),
        stat('Расходы', formatMoney(total.expense, currency), 'expense', () => open('Расходы', { kind: 'expense' })),
        stat('Итог', `${net < 0 ? MINUS : ''}${formatMoney(Math.abs(net), currency)}`, net < 0 ? 'expense' : 'income', () => open('Все доходы и расходы', { noTransfers: true })),
      ),
      h('p', { class: 'muted' }, 'Нажмите на сумму или категорию, чтобы увидеть операции.'),
    ),
    summary.totals.length === 0 ? card(null, emptyState('За этот период операций нет.')) : null,
    categoryBlock('expense', 'Расходы по категориям'),
    categoryBlock('income', 'Доходы по категориям'),
    transfers > 0
      ? card(
          'Переводы между счетами',
          h('p', { class: 'muted' }, `Операций: ${transfers}. Переводы между своими счетами не входят в доходы и расходы.`),
          h('button', { class: 'button wide', type: 'button', onClick: () => openOpsSheet(ctx, { title: 'Переводы', subtitle: label, filter: { from, to, kind: 'transfer' } }) }, 'Показать переводы'),
        )
      : null,
    series.length > 1
      ? card(
          'По месяцам',
          h(
            'div',
            { class: 'chart' },
            series.map((row) =>
              h(
                'div',
                { class: 'chart-col' },
                h('div', { class: 'chart-bars' }, h('div', { class: 'chart-bar income', style: `height:${(row.income / peak) * 100}%` }), h('div', { class: 'chart-bar expense', style: `height:${(row.expense / peak) * 100}%` })),
                h('span', { class: 'chart-label' }, manyYears ? row.month.slice(2).replace('-', '.') : formatMonthShort(row.month).slice(0, 3)),
              ),
            ),
          ),
          h('div', { class: 'legend' }, h('span', { class: 'dot income' }), 'Доходы', h('span', { class: 'dot expense' }), 'Расходы'),
        )
      : null,
    card(
      'Как считаются суммы',
      h('p', { class: 'muted' }, 'Доход и расход попадают в итоги и категории. Перевод между своими счетами только перемещает деньги и в итоги не входит. Деньги, отправленные другому человеку или полученные от него, учитывайте как расход или доход с категорией «Переводы людям» или «Переводы от людей». Период включает первый и последний день: для месяца это календарный месяц целиком, для года календарный год.'),
    ),
  );
}
