import { addMonths, formatDay, formatMonth, monthRange } from './dates.js';
import { formatMoney, formatPlain, parseMoney } from './money.js';
import { getMeta } from './storage.js';
import { openTxForm } from './txform.js';
import { confirmDialog, emptyState, h, messageFor, monthSwitcher, openSheet, pick, segmented, toast } from './ui.js';
import { openAccountForm } from './settings.js';

const MINUS = '−';

export function primaryCurrency(ledger) {
  return ledger.balances().find((account) => !account.archived)?.currency ?? 'RUB';
}

function signed(tx, ledger) {
  const currency = ledger.account(tx.accountId).currency;
  const text = formatMoney(tx.amount, currency);
  if (tx.kind === 'income') return `+${text}`;
  if (tx.kind === 'expense') return `${MINUS}${text}`;
  return text;
}

export function txRow(ctx, tx, { before } = {}) {
  const { ledger } = ctx;
  const account = ledger.account(tx.accountId);
  let title;
  let sub;
  if (tx.kind === 'transfer') {
    title = 'Перевод';
    sub = `${account.name} → ${ledger.account(tx.toAccountId).name}`;
  } else {
    title = ledger.category(tx.categoryId)?.name ?? 'Без категории';
    sub = account.name;
  }
  return h(
    'button',
    {
      class: 'row tx-row',
      type: 'button',
      onClick: () => {
        before?.();
        openTxForm(ctx, { tx });
      },
    },
    h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, title), h('span', { class: 'row-sub' }, tx.note ? `${tx.note} · ${sub}` : sub)),
    h('span', { class: `row-side amount ${tx.kind}` }, signed(tx, ledger)),
  );
}

export function card(title, ...children) {
  return h('section', { class: 'card' }, title ? h('h3', {}, title) : null, ...children);
}

export function stat(label, value, kind = '', onClick = null) {
  const parts = [h('span', { class: 'stat-label' }, label), h('span', { class: `stat-value ${kind}` }, value)];
  return onClick ? h('button', { class: 'stat tile', type: 'button', onClick }, ...parts) : h('div', { class: 'stat' }, ...parts);
}

export function bar(percent, kind = '') {
  return h('div', { class: 'bar' }, h('div', { class: `bar-fill ${kind}`, style: `width:${Math.max(0, Math.min(100, percent))}%` }));
}

export function homeScreen(ctx) {
  const { ledger, ui } = ctx;
  const [from, to] = monthRange(ui.month);
  const summary = ledger.summary(from, to);
  const accounts = ledger.balances().filter((account) => !account.archived);
  const recent = ledger.listTransactions({ limit: 6 }).items;
  const totals = summary.totals.length > 0 ? summary.totals : [{ currency: primaryCurrency(ledger), income: 0, expense: 0 }];
  const lastBackup = getMeta('lastBackup');
  const backupAge = lastBackup ? (Date.now() - new Date(lastBackup).getTime()) / 86400000 : Infinity;
  const needsBackup = ledger.state.transactions.length >= 1 && backupAge > 7;

  const perCurrency = new Map();
  for (const account of accounts) perCurrency.set(account.currency, (perCurrency.get(account.currency) ?? 0) + account.balance);

  return h(
    'div',
    { class: 'screen' },
    needsBackup
      ? h(
          'button',
          { class: 'banner', type: 'button', onClick: () => ctx.go('settings') },
          lastBackup
            ? 'Прошла неделя с последней резервной копии. Информацию мы на сервере не храним, она есть только на этом телефоне. Нажмите, чтобы сделать новую копию.'
            : 'Сделайте резервную копию. Информацию мы на сервере не храним, она есть только на этом телефоне. Нажмите, чтобы сохранить копию в «Файлы».',
        )
      : null,
    monthSwitcher(formatMonth(ui.month), () => ctx.setMonth(addMonths(ui.month, -1)), () => ctx.setMonth(addMonths(ui.month, 1))),
    card(
      'За месяц',
      totals.map((total) =>
        h(
          'div',
          { class: 'stats' },
          stat('Доходы', formatMoney(total.income, total.currency), 'income'),
          stat('Расходы', formatMoney(total.expense, total.currency), 'expense'),
          stat('Итог', formatMoney(total.income - total.expense, total.currency), total.income - total.expense < 0 ? 'expense' : 'income'),
        ),
      ),
    ),
    accounts.length === 0
      ? card('Счета', emptyState('Добавьте первый счёт, например карту Сбербанка.', h('button', { class: 'button primary', type: 'button', onClick: () => openAccountForm(ctx) }, 'Добавить счёт')))
      : card(
          'Счета',
          accounts.map((account) =>
            h(
              'button',
              { class: 'row', type: 'button', onClick: () => ctx.showAccount(account.id) },
              h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, account.name)),
              h('span', { class: `row-side amount ${account.balance < 0 ? 'expense' : ''}` }, formatMoney(account.balance, account.currency)),
            ),
          ),
          perCurrency.size > 0 && accounts.length > 1
            ? h('div', { class: 'total-line' }, [...perCurrency].map(([currency, sum]) => h('span', {}, `Всего: ${formatMoney(sum, currency)}`)))
            : null,
        ),
    card(
      'Последние операции',
      recent.length === 0 ? emptyState('Операций пока нет. Нажмите «+», чтобы добавить первую.') : recent.map((tx) => txRow(ctx, tx)),
      recent.length > 0 ? h('button', { class: 'button wide', type: 'button', onClick: () => ctx.go('ops') }, 'Все операции') : null,
    ),
  );
}

const OPS_KINDS = [
  { value: '', label: 'Все' },
  { value: 'expense', label: 'Расходы' },
  { value: 'income', label: 'Доходы' },
  { value: 'transfer', label: 'Переводы' },
];

export function operationsScreen(ctx) {
  const { ledger, ui } = ctx;
  const list = h('div', { class: 'ops-list' });

  const draw = () => {
    const range = ui.opsAll ? [undefined, undefined] : monthRange(ui.month);
    const { items, total } = ledger.listTransactions({
      from: range[0],
      to: range[1],
      kind: ui.opsKind || undefined,
      accountId: ui.opsAccount || undefined,
      q: ui.opsQuery,
      limit: ui.opsLimit,
    });
    if (items.length === 0) {
      list.replaceChildren(emptyState(ui.opsQuery || ui.opsKind || ui.opsAccount ? 'По этим условиям ничего не найдено.' : 'В этом периоде операций нет.'));
      return;
    }
    const nodes = [];
    let day = '';
    for (const tx of items) {
      if (tx.occurredOn !== day) {
        day = tx.occurredOn;
        nodes.push(h('div', { class: 'day' }, formatDay(day)));
      }
      nodes.push(txRow(ctx, tx));
    }
    if (total > items.length) {
      nodes.push(
        h(
          'button',
          {
            class: 'button wide',
            type: 'button',
            onClick: () => {
              ui.opsLimit += 100;
              draw();
            },
          },
          `Показать ещё (${total - items.length})`,
        ),
      );
    }
    list.replaceChildren(...nodes);
  };
  draw();

  const accountName = ui.opsAccount ? ledger.account(ui.opsAccount)?.name : null;
  return h(
    'div',
    { class: 'screen' },
    ui.opsAll ? null : monthSwitcher(formatMonth(ui.month), () => ctx.setMonth(addMonths(ui.month, -1)), () => ctx.setMonth(addMonths(ui.month, 1))),
    h(
      'label',
      { class: 'search' },
      h('input', {
        type: 'search',
        placeholder: 'Поиск по заметке',
        autocomplete: 'off',
        value: ui.opsQuery,
        onInput: (event) => {
          ui.opsQuery = event.target.value;
          ui.opsLimit = 100;
          draw();
        },
      }),
    ),
    segmented(OPS_KINDS, ui.opsKind, (kind) => {
      ui.opsKind = kind;
      ui.opsLimit = 100;
      ctx.rerender();
    }),
    h(
      'div',
      { class: 'chips' },
      h(
        'button',
        {
          class: `chip${ui.opsAccount ? ' active' : ''}`,
          type: 'button',
          onClick: async () => {
            const value = await pick({
              title: 'Счёт',
              options: [{ value: 0, label: 'Все счета' }, ...ledger.balances().map((account) => ({ value: account.id, label: account.name }))],
              selected: ui.opsAccount || 0,
            });
            if (value === undefined) return;
            ui.opsAccount = value;
            ui.opsLimit = 100;
            ctx.rerender();
          },
        },
        accountName ?? 'Все счета',
      ),
      h(
        'button',
        {
          class: `chip${ui.opsAll ? ' active' : ''}`,
          type: 'button',
          onClick: () => {
            ui.opsAll = !ui.opsAll;
            ui.opsLimit = 100;
            ctx.rerender();
          },
        },
        'За всё время',
      ),
    ),
    list,
  );
}

function openBudgetForm(ctx, { budget = null, categoryId = null }) {
  const { ledger, ui } = ctx;
  const category = ledger.category(budget?.categoryId ?? categoryId);
  const currency = budget?.currency ?? primaryCurrency(ledger);
  const form = { amount: budget ? formatPlain(budget.amount) : '' };
  openSheet({
    title: category.name,
    build(handle) {
      const errorBox = h('div', { class: 'form-error', role: 'alert' });
      const save = () => {
        const amount = parseMoney(form.amount);
        if (amount === null || amount < 1) {
          errorBox.textContent = 'Введите сумму лимита, например 20000';
          return;
        }
        try {
          ledger.setBudget({ categoryId: category.id, month: ui.month, currency, amount });
        } catch (error) {
          errorBox.textContent = messageFor(error);
          return;
        }
        handle.close();
        toast('Сохранено');
        ctx.rerender();
      };
      return h(
        'form',
        {
          class: 'tx-form',
          novalidate: true,
          onSubmit: (event) => {
            event.preventDefault();
            save();
          },
        },
        h(
          'label',
          { class: 'input-row' },
          h('span', { class: 'field-label' }, `Лимит на ${formatMonth(ui.month).toLowerCase()}, ${currency}`),
          h('input', { class: 'amount-input', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0', value: form.amount, onInput: (event) => (form.amount = event.target.value) }),
        ),
        errorBox,
        h(
          'div',
          { class: 'actions' },
          budget
            ? h(
                'button',
                {
                  class: 'button danger',
                  type: 'button',
                  onClick: () => {
                    ledger.deleteBudget(budget.id);
                    handle.close();
                    ctx.rerender();
                  },
                },
                'Удалить',
              )
            : null,
          h('button', { class: 'button primary', type: 'submit' }, 'Сохранить'),
        ),
      );
    },
  });
}

export function budgetsScreen(ctx) {
  const { ledger, ui } = ctx;
  const items = ledger.budgetsFor(ui.month);
  const taken = new Set(items.map((item) => item.categoryId));
  const free = ledger.state.categories.filter((category) => category.kind === 'expense' && !category.archived && !taken.has(category.id));
  const previous = ledger.budgetsFor(addMonths(ui.month, -1));

  const rows = items.map((item) => {
    const category = ledger.category(item.categoryId);
    const percent = (item.spent / item.amount) * 100;
    const left = item.amount - item.spent;
    return h(
      'button',
      { class: 'row budget-row', type: 'button', onClick: () => openBudgetForm(ctx, { budget: item }) },
      h(
        'span',
        { class: 'row-main' },
        h('span', { class: 'row-title' }, category.name),
        bar(percent, percent >= 100 ? 'expense' : percent >= 80 ? 'warn' : ''),
        h('span', { class: 'row-sub' }, `${formatMoney(item.spent, item.currency)} из ${formatMoney(item.amount, item.currency)}`),
      ),
      h('span', { class: `row-side amount ${left < 0 ? 'expense' : ''}` }, left < 0 ? `${MINUS}${formatMoney(-left, item.currency)}` : formatMoney(left, item.currency)),
    );
  });

  return h(
    'div',
    { class: 'screen' },
    monthSwitcher(formatMonth(ui.month), () => ctx.setMonth(addMonths(ui.month, -1)), () => ctx.setMonth(addMonths(ui.month, 1))),
    card(
      'Бюджеты по категориям',
      items.length === 0 ? emptyState('На этот месяц лимитов нет.') : rows,
      h('p', { class: 'muted' }, items.length > 0 ? 'Справа остаток лимита.' : null),
      free.length > 0
        ? h(
            'button',
            {
              class: 'button wide primary',
              type: 'button',
              onClick: async () => {
                const value = await pick({ title: 'Категория', options: free.map((category) => ({ value: category.id, label: category.name })) });
                if (value !== undefined) openBudgetForm(ctx, { categoryId: value });
              },
            },
            'Добавить лимит',
          )
        : null,
      items.length === 0 && previous.length > 0
        ? h(
            'button',
            {
              class: 'button wide',
              type: 'button',
              onClick: async () => {
                const accepted = await confirmDialog({ title: 'Скопировать лимиты?', text: `Лимиты за ${formatMonth(addMonths(ui.month, -1)).toLowerCase()} будут перенесены на этот месяц.`, okLabel: 'Скопировать' });
                if (!accepted) return;
                for (const item of previous) ledger.setBudget({ categoryId: item.categoryId, month: ui.month, currency: item.currency, amount: item.amount });
                ctx.rerender();
              },
            },
            'Скопировать с прошлого месяца',
          )
        : null,
    ),
  );
}

