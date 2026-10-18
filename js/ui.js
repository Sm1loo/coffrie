import { LedgerError } from './ledger.js';

const ICONS = {
  home: '<path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  gear: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  auto: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
  left: '<path d="m15 5-7 7 7 7"/>',
  right: '<path d="m9 5 7 7-7 7"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
};

export function icon(name, size = 22) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  return span;
}

function append(element, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function h(tag, attrs = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') element.className = value;
    else if (key.startsWith('on')) element.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) element.setAttribute(key, '');
    else element.setAttribute(key, value);
  }
  append(element, children);
  return element;
}

const MESSAGES = {
  invalid_name: 'Введите название (до 100 символов)',
  duplicate: 'Такое уже есть',
  invalid_currency: 'Укажите валюту из трёх букв, например RUB',
  invalid_amount: 'Введите сумму больше нуля',
  account_has_transactions: 'По этому счёту есть операции: его можно только архивировать',
  category_has_transactions: 'В категории есть операции: её можно только архивировать',
  account_not_found: 'Выберите счёт',
  category_not_found: 'Выберите категорию',
  category_kind_mismatch: 'Категория не подходит к типу операции',
  to_account_required: 'Выберите счёт зачисления',
  same_account: 'Счета должны отличаться',
  to_amount_required: 'Укажите сумму зачисления (счета в разных валютах)',
  amount_mismatch: 'Суммы списания и зачисления должны совпадать (одна валюта)',
  invalid_date: 'Проверьте дату',
  invalid_note: 'Заметка слишком длинная',
  invalid_backup: 'Файл не похож на копию Coffrie или повреждён',
  invalid_month: 'Некорректный месяц',
  not_found: 'Запись не найдена',
};

export function messageFor(error) {
  if (error instanceof LedgerError) return MESSAGES[error.code] ?? `Ошибка: ${error.code}`;
  return 'Что-то пошло не так';
}

let toastTimer = 0;

export function toast(text) {
  document.querySelector('.toast')?.remove();
  const element = h('div', { class: 'toast', role: 'status' }, text);
  document.body.append(element);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.remove(), 2600);
}

const sheets = [];

export function openSheet({ title, build, onClose }) {
  const body = h('div', { class: 'sheet-body' });
  const closeButton = h('button', { class: 'icon-button', type: 'button', 'aria-label': 'Закрыть' }, icon('close'));
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('div', { class: 'sheet-head' }, h('h2', {}, title), closeButton), body);
  const overlay = h('div', { class: 'overlay' }, panel);
  const handle = {
    body,
    closed: false,
    close() {
      if (handle.closed) return;
      handle.closed = true;
      sheets.splice(sheets.indexOf(handle), 1);
      overlay.remove();
      onClose?.();
    },
    render() {
      body.replaceChildren(build(handle));
    },
  };
  closeButton.addEventListener('click', handle.close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) handle.close();
  });
  sheets.push(handle);
  handle.render();
  document.body.append(overlay);
  return handle;
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && sheets.length > 0) sheets[sheets.length - 1].close();
});

export function pick({ title, options, selected, searchable = options.length > 7 }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    openSheet({
      title,
      onClose: () => finish(undefined),
      build(sheet) {
        const list = h('div', { class: 'pick-list' });
        const draw = (query) => {
          const needle = query.trim().toLowerCase();
          const rows = options.filter((option) => !needle || option.label.toLowerCase().includes(needle));
          list.replaceChildren(
            ...(rows.length === 0
              ? [h('div', { class: 'empty' }, 'Ничего не найдено')]
              : rows.map((option) =>
                  h(
                    'button',
                    {
                      class: `pick-row${option.value === selected ? ' selected' : ''}`,
                      type: 'button',
                      onClick: () => {
                        finish(option.value);
                        sheet.close();
                      },
                    },
                    h('span', { class: 'pick-label' }, option.label),
                    option.hint ? h('span', { class: 'pick-hint' }, option.hint) : null,
                    option.value === selected ? icon('check', 18) : null,
                  ),
                )),
          );
        };
        draw('');
        const search = searchable
          ? h('label', { class: 'search' }, icon('search', 18), h('input', { type: 'search', placeholder: 'Поиск', autocomplete: 'off', onInput: (event) => draw(event.target.value) }))
          : null;
        return h('div', { class: 'pick' }, search, list);
      },
    });
  });
}

export function confirmDialog({ title, text, okLabel = 'Подтвердить', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    openSheet({
      title,
      onClose: () => finish(false),
      build(sheet) {
        return h(
          'div',
          { class: 'confirm' },
          h('p', {}, text),
          h(
            'div',
            { class: 'actions' },
            h('button', { class: 'button', type: 'button', onClick: () => sheet.close() }, 'Отмена'),
            h(
              'button',
              {
                class: `button ${danger ? 'danger' : 'primary'}`,
                type: 'button',
                onClick: () => {
                  finish(true);
                  sheet.close();
                },
              },
              okLabel,
            ),
          ),
        );
      },
    });
  });
}

export function fieldButton(label, value, onClick) {
  return h(
    'button',
    { class: 'field', type: 'button', onClick },
    h('span', { class: 'field-label' }, label),
    h('span', { class: 'field-value' }, value),
    icon('down', 18),
  );
}

export function segmented(options, value, onChange) {
  return h(
    'div',
    { class: 'segmented', role: 'tablist' },
    options.map((option) =>
      h(
        'button',
        {
          class: `segment${option.value === value ? ' active' : ''}`,
          type: 'button',
          role: 'tab',
          'aria-selected': String(option.value === value),
          onClick: () => onChange(option.value),
        },
        option.label,
      ),
    ),
  );
}

export function monthSwitcher(label, onPrev, onNext) {
  return h(
    'div',
    { class: 'month-switcher' },
    h('button', { class: 'icon-button', type: 'button', 'aria-label': 'Предыдущий период', onClick: onPrev }, icon('left')),
    h('span', { class: 'month-label' }, label),
    h('button', { class: 'icon-button', type: 'button', 'aria-label': 'Следующий период', onClick: onNext }, icon('right')),
  );
}

export function emptyState(text, action) {
  return h('div', { class: 'empty' }, h('p', {}, text), action);
}
