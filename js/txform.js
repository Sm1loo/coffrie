import { today } from './dates.js';
import { formatMoney, formatPlain, parseMoney } from './money.js';
import { getMeta, setMeta } from './storage.js';
import { categoryOptions } from './catpick.js';
import { confirmDialog, fieldButton, h, messageFor, openSheet, pick, segmented, toast } from './ui.js';
import { openAccountForm, openCategoryForm } from './settings.js';
import { parseSms } from './sms.js';

const KINDS = [
  { value: 'expense', label: 'Расход' },
  { value: 'income', label: 'Доход' },
  { value: 'transfer', label: 'Перевод' },
];

function suggestCategory(ledger, note, kind) {
  const needle = note.trim().toLowerCase();
  if (!needle || kind === 'transfer') return null;
  const match = ledger.state.transactions
    .filter((tx) => tx.kind === kind && tx.categoryId !== null && tx.note.toLowerCase() === needle)
    .sort((a, b) => b.id - a.id)[0];
  return match && !ledger.category(match.categoryId)?.archived ? match.categoryId : null;
}

export function openFromSms(ctx, text) {
  const parsed = parseSms(text);
  if (!parsed) {
    toast('Не удалось разобрать SMS');
    return false;
  }
  const account = parsed.card ? ctx.ledger.state.accounts.find((item) => !item.archived && item.name.includes(parsed.card)) : null;
  const personCategory = parsed.transfer
    ? ctx.ledger.state.categories.find((item) => item.kind === parsed.kind && item.name === (parsed.kind === 'income' ? 'Переводы от людей' : 'Переводы людям'))
    : null;
  openTxForm(ctx, { preset: { kind: parsed.kind, amount: parsed.amount, note: parsed.note, accountId: account?.id, categoryId: personCategory?.id } });
  return true;
}

export function openTxForm(ctx, { tx = null, preset = {} } = {}) {
  const { ledger } = ctx;
  if (ledger.state.accounts.length === 0) {
    toast('Сначала добавьте счёт');
    openAccountForm(ctx, { onDone: () => openTxForm(ctx, { tx, preset }) });
    return;
  }

  const usable = ledger.balances().filter((account) => !account.archived);
  const lastAccount = Number(getMeta('lastAccount'));
  const defaultAccount = (ledger.defaultAccount() ?? usable.find((account) => account.id === lastAccount) ?? usable[0])?.id ?? null;

  const form = tx
    ? {
        kind: tx.kind,
        accountId: tx.accountId,
        toAccountId: tx.toAccountId,
        categoryId: tx.categoryId,
        amount: formatPlain(tx.amount),
        toAmount: tx.toAmount === null ? '' : formatPlain(tx.toAmount),
        occurredOn: tx.occurredOn,
        note: tx.note,
      }
    : {
        kind: preset.kind ?? 'expense',
        accountId: preset.accountId ?? defaultAccount,
        toAccountId: null,
        categoryId: preset.categoryId ?? null,
        amount: preset.amount ? formatPlain(preset.amount) : '',
        toAmount: '',
        occurredOn: preset.occurredOn ?? today(),
        note: preset.note ?? '',
      };
  if (!tx && form.categoryId === null) form.categoryId = suggestCategory(ledger, form.note, form.kind);

  const accountOptions = (exceptId = null) =>
    ledger
      .balances()
      .filter((account) => (!account.archived || account.id === form.accountId || account.id === form.toAccountId) && account.id !== exceptId)
      .map((account) => ({ value: account.id, label: account.name, hint: formatMoney(account.balance, account.currency) }));

  const sheet = openSheet({
    title: tx ? 'Изменить операцию' : 'Новая операция',
    build(handle) {
      const account = ledger.account(form.accountId);
      const target = ledger.account(form.toAccountId);
      const crossCurrency = form.kind === 'transfer' && account && target && account.currency !== target.currency;
      const errorBox = h('div', { class: 'form-error', role: 'alert' });
      const fail = (text) => {
        errorBox.textContent = text;
      };

      const chooseAccount = async (key, title, exceptId) => {
        const value = await pick({ title, options: accountOptions(exceptId), selected: form[key] });
        if (value === undefined) return;
        form[key] = value;
        handle.render();
      };

      const createCategory = (result) => {
        const selectedCategory = ledger.category(form.categoryId);
        const parentId = selectedCategory ? (selectedCategory.parentId ?? selectedCategory.id) : null;
        openCategoryForm(ctx, {
          kind: form.kind,
          asSub: result.create === 'sub',
          parentId: result.create === 'sub' ? parentId : null,
          name: result.name,
          onDone: (created) => {
            form.categoryId = created.id;
            handle.render();
            toast(`Выбрано: ${ledger.categoryPath(created.id)}`);
          },
        });
      };

      const pasteSms = async () => {
        let text;
        try {
          text = await navigator.clipboard.readText();
        } catch {
          return fail('Не удалось прочитать буфер обмена. Разрешите вставку или вставьте SMS в настройках.');
        }
        const parsed = parseSms(text);
        if (!parsed) return fail('В буфере нет SMS от банка');
        const matched = parsed.card ? ledger.state.accounts.find((item) => !item.archived && item.name.includes(parsed.card)) : null;
        form.kind = parsed.kind;
        form.amount = formatPlain(parsed.amount);
        form.note = parsed.note;
        if (matched) form.accountId = matched.id;
        form.categoryId = suggestCategory(ledger, parsed.note, parsed.kind);
        handle.render();
      };

      const save = () => {
        const amount = parseMoney(form.amount);
        if (amount === null) return fail('Введите сумму, например 1500 или 1500,50');
        const input = {
          kind: form.kind,
          accountId: form.accountId,
          toAccountId: form.kind === 'transfer' ? form.toAccountId : null,
          categoryId: form.kind === 'transfer' ? null : form.categoryId,
          amount,
          toAmount: null,
          occurredOn: form.occurredOn,
          note: form.note,
        };
        if (crossCurrency) {
          const toAmount = parseMoney(form.toAmount);
          if (toAmount === null) return fail('Укажите сумму зачисления');
          input.toAmount = toAmount;
        }
        try {
          if (tx) ledger.updateTransaction(tx.id, input);
          else ledger.addTransaction(input);
        } catch (error) {
          return fail(messageFor(error));
        }
        setMeta('lastAccount', String(form.accountId));
        handle.close();
        toast('Сохранено');
        ctx.rerender();
      };

      const remove = async () => {
        if (!(await confirmDialog({ title: 'Удалить операцию?', text: 'Её нельзя будет вернуть.', okLabel: 'Удалить', danger: true }))) return;
        ledger.deleteTransaction(tx.id);
        handle.close();
        toast('Удалено');
        ctx.rerender();
      };

      const amountInput = h('input', {
        class: 'amount-input',
        type: 'text',
        inputmode: 'decimal',
        autocomplete: 'off',
        placeholder: '0',
        value: form.amount,
        'aria-label': 'Сумма',
        onInput: (event) => {
          form.amount = event.target.value;
        },
      });

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
        tx ? null : h('button', { class: 'link-button', type: 'button', onClick: pasteSms }, 'Вставить SMS из буфера'),
        segmented(KINDS, form.kind, (kind) => {
          if (kind === form.kind) return;
          form.kind = kind;
          form.categoryId = tx && tx.kind === kind ? tx.categoryId : suggestCategory(ledger, form.note, kind);
          if (kind === 'transfer' && form.toAccountId === null) {
            form.toAccountId = usable.find((item) => item.id !== form.accountId)?.id ?? null;
          }
          handle.render();
        }),
        h('label', { class: 'amount-row' }, amountInput, h('span', { class: 'amount-currency' }, account?.currency ?? '')),
        fieldButton(form.kind === 'transfer' ? 'Откуда' : 'Счёт', account?.name ?? 'Выберите', () =>
          chooseAccount('accountId', form.kind === 'transfer' ? 'Откуда' : 'Счёт', form.kind === 'transfer' ? form.toAccountId : null),
        ),
        form.kind === 'transfer'
          ? fieldButton('Куда', target?.name ?? 'Выберите', () => chooseAccount('toAccountId', 'Куда', form.accountId))
          : fieldButton('Категория', ledger.categoryPath(form.categoryId) ?? 'Без категории', async () => {
              const value = await pick({
                title: 'Категория',
                options: categoryOptions(ledger, form.kind, { selected: form.categoryId, noneLabel: 'Без категории' }),
                selected: form.categoryId,
                searchable: true,
                create: [
                  { key: 'category', label: 'Категория', typedLabel: 'категорию' },
                  { key: 'sub', label: 'Подкатегория', typedLabel: 'подкатегорию' },
                ],
              });
              if (value === undefined) return;
              if (value !== null && typeof value === 'object') return createCategory(value);
              form.categoryId = value;
              handle.render();
            }),
        crossCurrency
          ? h(
              'label',
              { class: 'input-row' },
              h('span', { class: 'field-label' }, `Сумма зачисления, ${target.currency}`),
              h('input', {
                type: 'text',
                inputmode: 'decimal',
                autocomplete: 'off',
                value: form.toAmount,
                onInput: (event) => {
                  form.toAmount = event.target.value;
                },
              }),
            )
          : null,
        h(
          'label',
          { class: 'input-row' },
          h('span', { class: 'field-label' }, 'Дата'),
          h('input', {
            type: 'date',
            value: form.occurredOn,
            onChange: (event) => {
              form.occurredOn = event.target.value;
            },
          }),
        ),
        h(
          'label',
          { class: 'input-row' },
          h('span', { class: 'field-label' }, 'Заметка'),
          h('input', {
            type: 'text',
            maxlength: '500',
            autocomplete: 'off',
            placeholder: 'Например, Магнит',
            value: form.note,
            onInput: (event) => {
              form.note = event.target.value;
            },
            onChange: () => {
              if (form.categoryId === null) {
                const suggested = suggestCategory(ledger, form.note, form.kind);
                if (suggested !== null) {
                  form.categoryId = suggested;
                  handle.render();
                }
              }
            },
          }),
        ),
        form.kind === 'transfer'
          ? h('p', { class: 'muted hint' }, 'Перевод между вашими счетами не считается ни доходом, ни расходом. Если деньги ушли другому человеку или пришли от него, выберите «Расход» или «Доход» и категорию «Переводы людям» или «Переводы от людей».')
          : null,
        errorBox,
        h(
          'div',
          { class: 'actions' },
          tx ? h('button', { class: 'button danger', type: 'button', onClick: remove }, 'Удалить') : null,
          h('button', { class: 'button primary', type: 'submit' }, 'Сохранить'),
        ),
      );
    },
  });
  setTimeout(() => sheet.body.querySelector('.amount-input')?.focus(), 50);
}
