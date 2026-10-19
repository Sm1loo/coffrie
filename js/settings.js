import { createDefaultState } from './ledger.js';
import { today } from './dates.js';
import { formatMoney, formatPlain, parseSignedMoney } from './money.js';
import { getMeta, setMeta } from './storage.js';
import { confirmDialog, fieldButton, fillCard, h, messageFor, openSheet, pick, segmented, toast } from './ui.js';
import { openFromSms } from './txform.js';

const CURRENCIES = [
  ['RUB', 'Российский рубль'],
  ['USD', 'Доллар США'],
  ['EUR', 'Евро'],
  ['KZT', 'Казахстанский тенге'],
  ['BYN', 'Белорусский рубль'],
  ['CNY', 'Китайский юань'],
  ['TRY', 'Турецкая лира'],
  ['AMD', 'Армянский драм'],
  ['GEL', 'Грузинский лари'],
  ['GBP', 'Фунт стерлингов'],
].map(([value, label]) => ({ value, label: `${value} · ${label}` }));

export function openAccountForm(ctx, { account = null, onDone } = {}) {
  const { ledger } = ctx;
  const form = {
    name: account?.name ?? '',
    currency: account?.currency ?? 'RUB',
    balance: account ? formatPlain(account.openingBalance) : '',
  };
  openSheet({
    title: account ? 'Счёт' : 'Новый счёт',
    build(handle) {
      const errorBox = h('div', { class: 'form-error', role: 'alert' });
      const used = account ? ledger.state.transactions.some((tx) => tx.accountId === account.id || tx.toAccountId === account.id) : false;

      const save = () => {
        const text = form.balance.trim();
        const openingBalance = text === '' ? 0 : parseSignedMoney(text);
        if (openingBalance === null) {
          errorBox.textContent = 'Начальный остаток: например 15000 или -2500,50';
          return;
        }
        try {
          if (account) ledger.updateAccount(account.id, { name: form.name, currency: form.currency, openingBalance });
          else ledger.addAccount({ name: form.name, currency: form.currency, openingBalance });
        } catch (error) {
          errorBox.textContent = messageFor(error);
          return;
        }
        handle.close();
        toast('Сохранено');
        ctx.rerender();
        onDone?.();
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
          h('span', { class: 'field-label' }, 'Название'),
          h('input', { type: 'text', maxlength: '100', autocomplete: 'off', placeholder: 'Например, Сбербанк 1234', value: form.name, onInput: (event) => (form.name = event.target.value) }),
        ),
        h(
          'button',
          {
            class: 'field',
            type: 'button',
            disabled: used,
            onClick: async () => {
              const value = await pick({ title: 'Валюта', options: CURRENCIES, selected: form.currency });
              if (value === undefined) return;
              form.currency = value;
              handle.render();
            },
          },
          h('span', { class: 'field-label' }, used ? 'Валюта (есть операции)' : 'Валюта'),
          h('span', { class: 'field-value' }, form.currency),
        ),
        h(
          'label',
          { class: 'input-row' },
          h('span', { class: 'field-label' }, 'Начальный остаток'),
          h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0', value: form.balance, onInput: (event) => (form.balance = event.target.value) }),
        ),
        errorBox,
        h(
          'div',
          { class: 'actions wrap' },
          account
            ? h(
                'button',
                {
                  class: 'button',
                  type: 'button',
                  onClick: () => {
                    ledger.updateAccount(account.id, { archived: !account.archived });
                    handle.close();
                    ctx.rerender();
                  },
                },
                account.archived ? 'Вернуть из архива' : 'В архив',
              )
            : null,
          account && !used
            ? h(
                'button',
                {
                  class: 'button danger',
                  type: 'button',
                  onClick: async () => {
                    if (!(await confirmDialog({ title: 'Удалить счёт?', text: account.name, okLabel: 'Удалить', danger: true }))) return;
                    ledger.deleteAccount(account.id);
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

export function openCategoryForm(ctx, { category = null, kind = 'expense', asSub = false, parentId = null, name = '', onCreated = null } = {}) {
  const { ledger } = ctx;
  const kindOf = category ? category.kind : kind;
  const form = { name: category ? category.name : name, parentId: category ? category.parentId : parentId };
  const hasChildren = category ? ledger.childrenOf(category.id).length > 0 : false;
  const showParent = category ? !hasChildren : asSub;

  const parentOptions = () => [
    ...(asSub && !category ? [] : [{ value: null, label: 'Нет (основная категория)' }]),
    ...ledger.categoryTree(kindOf, { includeArchived: true })
      .filter(({ category: root }) => root.id !== category?.id && (!root.archived || root.id === form.parentId))
      .map(({ category: root }) => ({ value: root.id, label: root.name })),
  ];

  openSheet({
    title: category ? 'Категория' : asSub ? 'Новая подкатегория' : kindOf === 'income' ? 'Новая категория доходов' : 'Новая категория расходов',
    build(handle) {
      const errorBox = h('div', { class: 'form-error', role: 'alert' });
      const used = category ? ledger.state.transactions.some((tx) => tx.categoryId === category.id) : false;

      const save = () => {
        if (!category && asSub && form.parentId === null) {
          errorBox.textContent = 'Выберите основную категорию';
          return;
        }
        let saved;
        try {
          if (category) saved = ledger.updateCategory(category.id, { name: form.name, ...(showParent ? { parentId: form.parentId } : {}) });
          else saved = ledger.addCategory({ name: form.name, kind: kindOf, parentId: asSub ? form.parentId : null });
        } catch (error) {
          errorBox.textContent = messageFor(error);
          return;
        }
        handle.close();
        toast('Сохранено');
        ctx.rerender();
        if (!category) onCreated?.(saved);
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
        showParent
          ? fieldButton(asSub && !category ? 'Основная категория' : 'Входит в', ledger.category(form.parentId)?.name ?? 'Нет (основная категория)', async () => {
              const value = await pick({ title: 'Основная категория', options: parentOptions(), selected: form.parentId });
              if (value === undefined) return;
              form.parentId = value;
              handle.render();
            })
          : null,
        h(
          'label',
          { class: 'input-row' },
          h('span', { class: 'field-label' }, 'Название'),
          h('input', { type: 'text', maxlength: '100', autocomplete: 'off', value: form.name, onInput: (event) => (form.name = event.target.value) }),
        ),
        errorBox,
        h(
          'div',
          { class: 'actions wrap' },
          category && category.parentId === null
            ? h(
                'button',
                {
                  class: 'button',
                  type: 'button',
                  onClick: () => {
                    handle.close();
                    openCategoryForm(ctx, { kind: category.kind, asSub: true, parentId: category.id });
                  },
                },
                'Добавить подкатегорию',
              )
            : null,
          category
            ? h(
                'button',
                {
                  class: 'button',
                  type: 'button',
                  onClick: () => {
                    ledger.updateCategory(category.id, { archived: !category.archived });
                    handle.close();
                    ctx.rerender();
                  },
                },
                category.archived ? 'Вернуть из архива' : 'В архив',
              )
            : null,
          category && !used && !hasChildren
            ? h(
                'button',
                {
                  class: 'button danger',
                  type: 'button',
                  onClick: async () => {
                    if (!(await confirmDialog({ title: 'Удалить категорию?', text: ledger.categoryPath(category.id), okLabel: 'Удалить', danger: true }))) return;
                    ledger.deleteCategory(category.id);
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
async function exportBackup(ctx) {
  const json = JSON.stringify(ctx.ledger.exportData(), null, 2);
  const name = `coffrie-${today()}.json`;
  const file = new File([json], name, { type: 'application/json' });
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      toast('Выберите «Сохранить в Файлы» или iCloud Drive, чтобы копия сохранилась');
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const link = h('a', { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  if (standalone) {
    toast('Если файл не появился, откройте Coffrie в Safari и повторите');
    return;
  }
  setMeta('lastBackup', new Date().toISOString());
  ctx.rerender();
}

function markBackupDone(ctx) {
  setMeta('lastBackup', new Date().toISOString());
  toast('Отмечено: копия сделана');
  ctx.rerender();
}

async function pasteIntoBox(ctx, box) {
  try {
    box.value = await navigator.clipboard.readText();
  } catch {
    toast('Не удалось прочитать буфер обмена');
    return;
  }
  openFromSms(ctx, box.value);
}

async function importBackup(ctx, file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    toast('Не удалось прочитать файл');
    return;
  }
  const accepted = await confirmDialog({
    title: 'Загрузить копию?',
    text: 'Текущие данные на этом устройстве будут заменены данными из файла.',
    okLabel: 'Заменить',
    danger: true,
  });
  if (!accepted) return;
  try {
    ctx.ledger.importData(data);
  } catch (error) {
    toast(messageFor(error));
    return;
  }
  toast('Данные загружены');
  ctx.rerender();
}

const SETTINGS_TABS = [
  { value: 'accounts', label: 'Счета' },
  { value: 'categories', label: 'Категории' },
  { value: 'data', label: 'Данные' },
];

function anchored(element, name) {
  element.dataset.anchor = name;
  return element;
}

function section(title, ...children) {
  return h('section', { class: 'card' }, h('h3', {}, title), ...children);
}

function row(label, hint, onClick, extra = '') {
  return h(
    'button',
    { class: `row${extra}`, type: 'button', onClick },
    h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, label)),
    h('span', { class: 'row-side' }, hint),
  );
}

export function settingsScreen(ctx) {
  const { ledger, ui } = ctx;
  const accounts = ledger.balances();
  const categoryTree = ledger.categoryTree(ui.settingsKind, { includeArchived: true });
  const lastBackup = getMeta('lastBackup');
  const smsBox = h('textarea', { class: 'sms-box', rows: '3', placeholder: 'Вставьте текст SMS от банка', 'aria-label': 'Текст SMS' });
  const fileInput = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    hidden: true,
    onChange: (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) importBackup(ctx, file);
    },
  });


  const smsSection = section(
    'SMS из банка',
    h('p', { class: 'muted' }, 'Вставьте текст сообщения от банка, и приложение заполнит операцию. Сумму, тип и магазин нужно проверить перед сохранением. Если в названии счёта есть последние 4 цифры карты, счёт выберется сам.'),
    smsBox,
    h('button', { class: 'button wide primary', type: 'button', onClick: () => pasteIntoBox(ctx, smsBox) }, 'Вставить из буфера и разобрать'),
    h('button', { class: 'button wide', type: 'button', onClick: () => openFromSms(ctx, smsBox.value) }, 'Разобрать текст выше'),
    h(
      'details',
      {},
      h('summary', {}, 'Как ускорить через «Команды» iPhone'),
      h(
        'p',
        { class: 'muted' },
        'В приложении «Команды» создайте автоматизацию «Сообщение» от отправителя 900 с действиями «Скопировать в буфер обмена» (содержимое: входящее сообщение) и, при желании, «Показать уведомление». Когда придёт SMS, откройте Coffrie, нажмите «+» и «Вставить SMS из буфера». Ссылки для автоматического открытия не используйте: они открываются в Safari, а установленное приложение хранит данные отдельно.',
      ),
    ),
  );

  const dataSection = anchored(
    section(
      'Данные',
      h(
        'p',
        { class: 'muted' },
        lastBackup ? `Последняя копия: ${new Date(lastBackup).toLocaleDateString('ru-RU')}.` : 'Резервных копий ещё не было.',
        ' Все данные хранятся только на этом устройстве: если потерять телефон или очистить данные Safari, без копии их не вернуть.',
      ),
      h('button', { class: 'button wide primary', type: 'button', onClick: () => exportBackup(ctx) }, 'Выгрузить копию'),
      h('button', { class: 'button wide', type: 'button', onClick: () => markBackupDone(ctx) }, 'Я сохранил копию в Файлы'),
      h('button', { class: 'button wide', type: 'button', onClick: () => fileInput.click() }, 'Загрузить копию'),
      fileInput,
      h(
        'button',
        {
          class: 'button wide danger',
          type: 'button',
          onClick: async () => {
            const accepted = await confirmDialog({
              title: 'Удалить все данные?',
              text: 'Будут удалены все счета, операции и бюджеты на этом устройстве. Сначала выгрузите копию.',
              okLabel: 'Удалить всё',
              danger: true,
            });
            if (!accepted) return;
            ledger.importData(createDefaultState());
            toast('Данные удалены');
            ctx.rerender();
          },
        },
        'Удалить все данные',
      ),
    ),
    'backup',
  );

  const installSection = section(
    'Установка на iPhone',
    h('p', { class: 'muted' }, 'Откройте сайт в Safari, нажмите «Поделиться» и выберите «На экран “Домой”». Приложение будет открываться как обычное и работать без интернета.'),
  );

  let body;
  if (ui.settingsTab === 'accounts') {
    body = fillCard('Счета', {
      list: accounts.length === 0
        ? h('p', { class: 'muted' }, 'Счетов пока нет.')
        : accounts.map((account) =>
            row(account.name + (account.archived ? ' · архив' : ''), formatMoney(account.balance, account.currency), () => openAccountForm(ctx, { account }), account.archived ? ' archived' : ''),
          ),
      footer: [h('button', { class: 'button wide', type: 'button', onClick: () => openAccountForm(ctx) }, 'Добавить счёт')],
    });
  } else if (ui.settingsTab === 'categories') {
    body = [
      segmented(
        [
          { value: 'expense', label: 'Расходы' },
          { value: 'income', label: 'Доходы' },
        ],
        ui.settingsKind,
        (kind) => {
          ui.settingsKind = kind;
          ctx.rerender();
        },
      ),
      fillCard('Категории', {
        list: categoryTree.flatMap(({ category, children }) => [
          row(category.name + (category.archived ? ' · архив' : ''), children.length > 0 ? `подкатегорий: ${children.length}` : '', () => openCategoryForm(ctx, { category }), category.archived ? ' archived' : ''),
          ...children.map((child) => row(child.name + (child.archived ? ' · архив' : ''), '', () => openCategoryForm(ctx, { category: child }), ` child${child.archived ? ' archived' : ''}`)),
        ]),
        footer: [
          h('button', { class: 'button wide', type: 'button', onClick: () => openCategoryForm(ctx, { kind: ui.settingsKind }) }, 'Добавить категорию'),
          h(
            'button',
            {
              class: 'button wide',
              type: 'button',
              disabled: categoryTree.length === 0,
              onClick: () => openCategoryForm(ctx, { kind: ui.settingsKind, asSub: true }),
            },
            'Добавить подкатегорию',
          ),
        ],
      }),
    ];
  } else {
    body = h('div', { class: 'scroll-area stack' }, dataSection, smsSection, installSection);
  }

  return h(
    'div',
    { class: 'screen' },
    segmented(SETTINGS_TABS, ui.settingsTab, (tab) => {
      ui.settingsTab = tab;
      ctx.rerender();
    }),
    body,
  );
}
