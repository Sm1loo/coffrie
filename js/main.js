import { currentMonth, monthRange } from './dates.js';
import { CURRENT_VERSION, Ledger, createDefaultState, validateState } from './ledger.js';
import { parseMoney } from './money.js';
import { reportsScreen } from './reports.js';
import { budgetsScreen, homeScreen, operationsScreen } from './screens.js';
import { settingsScreen } from './settings.js';
import { getMeta, loadStored, peekRev, requestPersistence, saveEnvelope, saveRaw, setMeta } from './storage.js';
import { openFromSms, openTxForm } from './txform.js';
import { h, icon, toast } from './ui.js';

const TITLES = { home: 'Coffrie', ops: 'Операции', budgets: 'Бюджеты', reports: 'Отчёты', settings: 'Настройки' };
const SCREENS = { home: homeScreen, ops: operationsScreen, budgets: budgetsScreen, reports: reportsScreen, settings: settingsScreen };

const app = document.getElementById('app');

function currentTheme() {
  return getMeta('theme') === 'light' ? 'light' : 'dark';
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
}

applyTheme(currentTheme());

function downloadJson(name, value) {
  const file = new File([JSON.stringify(value, null, 2)], name, { type: 'application/json' });
  const url = URL.createObjectURL(file);
  const link = h('a', { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function bootScreen(title, text, buttons) {
  app.replaceChildren(
    h(
      'div',
      { class: 'boot' },
      h('h1', {}, title),
      h('p', {}, text),
      buttons.map(([label, handler, kind]) => h('button', { class: `button wide ${kind ?? ''}`, type: 'button', onClick: handler }, label)),
    ),
  );
}

async function boot() {
  const loaded = await loadStored();

  if (loaded.status === 'error') {
    bootScreen(
      'Хранилище недоступно',
      'Не удалось прочитать данные: браузер временно не отдаёт хранилище. Ваши данные не потеряны. Закройте приложение полностью и откройте снова.',
      [
        ['Повторить', () => location.reload(), 'primary'],
        ['Работать без сохранения', () => start(createDefaultState(), 0, false)],
      ],
    );
    return;
  }

  if (loaded.status === 'empty') {
    start(createDefaultState(), 0, true);
    return;
  }

  let state;
  try {
    const savedVersion = loaded.envelope.state.version;
    if (Number.isInteger(savedVersion) && savedVersion < CURRENT_VERSION) {
      await saveRaw(`premigrate-v${savedVersion}-${Date.now()}`, loaded.envelope);
    }
    state = validateState(loaded.envelope.state);
  } catch {
    bootScreen(
      'Данные не удалось прочитать',
      'Сохранённые данные не прошли проверку. Они остались на устройстве нетронутыми. На всякий случай скачайте их, а затем начните заново или загрузите свою резервную копию.',
      [
        ['Скачать сохранённые данные', () => downloadJson('coffrie-raw.json', loaded.envelope.state), 'primary'],
        [
          'Начать заново',
          async () => {
            await saveRaw(`corrupt-${Date.now()}`, loaded.envelope);
            start(createDefaultState(), loaded.envelope.rev, true);
          },
        ],
      ],
    );
    return;
  }
  start(state, loaded.envelope.rev, true);
}

function start(state, initialRev, persist) {
  let baseRev = initialRev;
  let dirty = false;
  let saving = false;
  let blocked = false;
  let notice = persist ? null : { text: 'Данные не сохраняются. После закрытия приложения всё исчезнет.' };
  let updateReady = false;
  let timer = 0;

  const ledger = new Ledger(state, () => {
    if (!persist) return;
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(flush, 0);
  });

  async function flush() {
    if (saving || blocked || !persist) return;
    saving = true;
    try {
      while (dirty && !blocked) {
        const stored = await peekRev();
        if (stored !== null && stored > baseRev) {
          blocked = true;
          notice = { text: 'Данные изменены в другом окне. Нажмите, чтобы загрузить актуальные (последние изменения в этом окне не сохранены).', handler: reloadFromStorage };
          render();
          break;
        }
        dirty = false;
        const rev = baseRev + 1;
        if (await saveEnvelope({ rev, savedAt: Date.now(), state })) {
          baseRev = rev;
          if (notice && !blocked) {
            notice = null;
            render();
          }
        } else {
          dirty = true;
          notice = { text: 'Не удалось сохранить данные: нет места или хранилище недоступно. Сделайте резервную копию в настройках.', handler: () => ctx.go('settings', 'backup') };
          render();
          break;
        }
      }
    } finally {
      saving = false;
    }
  }

  async function reloadFromStorage() {
    const loaded = await loadStored();
    if (loaded.status !== 'ok') return;
    try {
      const fresh = validateState(loaded.envelope.state);
      Object.assign(state, fresh);
      baseRev = loaded.envelope.rev;
      dirty = false;
      blocked = false;
      notice = null;
      render();
    } catch {
      toast('Не удалось загрузить данные');
    }
  }

  async function syncFromStorage() {
    if (!persist || dirty || saving || blocked || document.querySelector('.overlay')) return;
    const stored = await peekRev();
    if (stored !== null && stored > baseRev) await reloadFromStorage();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
    else syncFromStorage();
  });
  window.addEventListener('pagehide', flush);
  requestPersistence();

  const ui = {
    tab: 'home',
    month: currentMonth(),
    opsKind: '',
    opsAccount: 0,
    opsAll: false,
    opsQuery: '',
    opsLimit: 100,
    settingsKind: 'expense',
    reportPeriod: 'month',
    reportCurrency: null,
    reportCustomSet: false,
    reportCustom: { mode: 'dates', from: monthRange(currentMonth())[0], to: monthRange(currentMonth())[1], fromMonth: currentMonth(), toMonth: currentMonth() },
  };

  const ctx = {
    ledger,
    ui,
    rerender: () => render(),
    go(tab, anchor = null) {
      ui.tab = tab;
      render(true, anchor);
    },
    setMonth(month) {
      ui.month = month;
      render();
    },
    showAccount(accountId) {
      ui.opsAccount = accountId;
      ui.opsKind = '';
      ui.opsQuery = '';
      ui.opsAll = false;
      ui.opsLimit = 100;
      ui.tab = 'ops';
      render(true);
    },
  };

  function tabButton(tab, label, iconName) {
    return h('button', { class: `tab${ui.tab === tab ? ' active' : ''}`, type: 'button', 'aria-current': ui.tab === tab ? 'page' : null, onClick: () => ctx.go(tab) }, icon(iconName), h('span', {}, label));
  }

  function render(resetScroll = false, anchor = null) {
    const previous = document.querySelector('.content');
    const scrollTop = previous && !resetScroll ? previous.scrollTop : 0;
    const content = h(
      'main',
      { class: 'content' },
      updateReady
        ? h(
            'button',
            {
              class: 'banner',
              type: 'button',
              onClick: async () => {
                await flush();
                location.reload();
              },
            },
            'Вышла новая версия Coffrie. Ваши данные сохранены и не пострадают. Нажмите, чтобы обновить.',
          )
        : null,
      notice ? h('button', { class: 'banner alert', type: 'button', onClick: notice.handler }, notice.text) : null,
      SCREENS[ui.tab](ctx),
    );
    const header = h(
      'header',
      { class: 'topbar' },
      ui.tab === 'settings'
        ? h('button', { class: 'icon-button', type: 'button', 'aria-label': 'Назад', onClick: () => ctx.go('home') }, icon('left'))
        : null,
      h('h1', {}, TITLES[ui.tab]),
      h(
        'button',
        {
          class: 'icon-button',
          type: 'button',
          'aria-label': currentTheme() === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему',
          title: currentTheme() === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему',
          onClick: () => {
            const next = currentTheme() === 'dark' ? 'light' : 'dark';
            setMeta('theme', next);
            applyTheme(next);
            toast(next === 'dark' ? 'Тёмная тема' : 'Светлая тема');
            render();
          },
        },
        icon(currentTheme() === 'dark' ? 'sun' : 'moon'),
      ),
      ui.tab === 'settings' ? null : h('button', { class: 'icon-button', type: 'button', 'aria-label': 'Настройки', title: 'Настройки', onClick: () => ctx.go('settings') }, icon('gear')),
    );
    const tabbar = h(
      'nav',
      { class: 'tabbar' },
      tabButton('home', 'Главная', 'home'),
      tabButton('ops', 'Операции', 'list'),
      h('button', { class: 'tab add', type: 'button', 'aria-label': 'Добавить операцию', onClick: () => openTxForm(ctx) }, icon('plus', 26)),
      tabButton('budgets', 'Бюджеты', 'target'),
      tabButton('reports', 'Отчёты', 'chart'),
    );
    app.replaceChildren(header, content, tabbar);
    content.scrollTop = scrollTop;
    const target = anchor ? content.querySelector(`[data-anchor="${anchor}"]`) : null;
    if (target) content.scrollTop += target.getBoundingClientRect().top - content.getBoundingClientRect().top - 8;
  }

  function findByName(list, name) {
    const needle = name.trim().toLowerCase();
    return list.find((item) => item.name.toLowerCase() === needle);
  }

  function handleHash() {
    const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
    if (path === 'sms') {
      const raw = query.match(/(?:^|&)text=([^&]*)/);
      let text = '';
      try {
        text = raw ? decodeURIComponent(raw[1]) : '';
      } catch {
        text = raw ? raw[1] : '';
      }
      history.replaceState(null, '', location.pathname);
      render();
      openFromSms(ctx, text);
      return;
    }
    const params = new URLSearchParams(query);
    if (path === 'add') {
      history.replaceState(null, '', location.pathname);
      render();
      const preset = {};
      const amount = params.get('amount');
      if (amount) preset.amount = parseMoney(amount) ?? undefined;
      if (['expense', 'income', 'transfer'].includes(params.get('kind'))) preset.kind = params.get('kind');
      if (params.get('note')) preset.note = params.get('note');
      if (/^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '')) preset.occurredOn = params.get('date');
      const account = params.get('account') && findByName(ledger.state.accounts, params.get('account'));
      if (account) preset.accountId = account.id;
      const category = params.get('category') && findByName(ledger.state.categories.filter((item) => item.kind === (preset.kind ?? 'expense')), params.get('category'));
      if (category) preset.categoryId = category.id;
      openTxForm(ctx, { preset });
      return;
    }
    if (Object.hasOwn(SCREENS, path)) ui.tab = path;
    render(true);
  }

  window.addEventListener('hashchange', handleHash);
  handleHash();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    let controlled = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (controlled) {
        updateReady = true;
        render();
      }
      controlled = true;
    });
    navigator.serviceWorker
      .register('./sw.js')
      .then((registration) => {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') registration.update().catch(() => {});
        });
      })
      .catch(() => {});
  }
}

boot();
