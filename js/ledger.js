import { MAX_MONEY } from './money.js';

export class LedgerError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export const DEFAULT_CATEGORIES = {
  expense: ['Продукты', 'Кафе и рестораны', 'Транспорт', 'Жильё и коммунальные', 'Связь и интернет', 'Здоровье', 'Одежда', 'Развлечения', 'Подарки', 'Переводы людям', 'Прочее'],
  income: ['Зарплата', 'Подработка', 'Проценты', 'Подарки', 'Переводы от людей', 'Прочее'],
};

export const CURRENT_VERSION = 1;

const MIGRATIONS = {};

export function migrate(data) {
  if (!data || typeof data !== 'object' || !Number.isInteger(data.version)) return data;
  let result = data;
  while (result.version < CURRENT_VERSION && MIGRATIONS[result.version]) result = MIGRATIONS[result.version](result);
  return result;
}

const KINDS = ['income', 'expense', 'transfer'];

const isId = (value) => Number.isInteger(value) && value > 0;
const isMoney = (value) => Number.isInteger(value) && value >= 1 && value <= MAX_MONEY;
const isSignedMoney = (value) => Number.isInteger(value) && Math.abs(value) <= MAX_MONEY;
const isCurrency = (value) => typeof value === 'string' && /^[A-Z]{3}$/.test(value);
const isMonth = (value) => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function cleanTitle(value) {
  const title = typeof value === 'string' ? value.trim() : '';
  if (title.length < 1 || title.length > 100) throw new LedgerError('invalid_name');
  return title;
}

const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();

export function createState() {
  return { version: CURRENT_VERSION, nextId: 1, accounts: [], categories: [], transactions: [], budgets: [] };
}

export function createDefaultState() {
  const state = createState();
  const ledger = new Ledger(state);
  for (const kind of ['expense', 'income']) {
    for (const name of DEFAULT_CATEGORIES[kind]) ledger.addCategory({ name, kind });
  }
  return state;
}

export class Ledger {
  constructor(state, onChange = () => {}) {
    this.state = state;
    this.onChange = onChange;
  }

  #nextId() {
    return this.state.nextId++;
  }

  #commit() {
    this.onChange(this.state);
  }

  account(id) {
    return this.state.accounts.find((item) => item.id === id);
  }

  category(id) {
    return this.state.categories.find((item) => item.id === id);
  }

  transaction(id) {
    return this.state.transactions.find((item) => item.id === id);
  }

  #accountUsed(id) {
    return this.state.transactions.some((tx) => tx.accountId === id || tx.toAccountId === id);
  }

  addAccount(input) {
    const name = cleanTitle(input.name);
    const currency = input.currency ?? 'RUB';
    const openingBalance = input.openingBalance ?? 0;
    if (!isCurrency(currency)) throw new LedgerError('invalid_currency');
    if (!isSignedMoney(openingBalance)) throw new LedgerError('invalid_amount');
    if (this.state.accounts.some((item) => sameName(item.name, name))) throw new LedgerError('duplicate');
    const account = { id: this.#nextId(), name, currency, openingBalance, archived: false };
    this.state.accounts.push(account);
    this.#commit();
    return account;
  }

  updateAccount(id, patch) {
    const account = this.account(id);
    if (!account) throw new LedgerError('not_found');
    const next = { ...account };
    if (patch.name !== undefined) next.name = cleanTitle(patch.name);
    if (patch.currency !== undefined) {
      if (!isCurrency(patch.currency)) throw new LedgerError('invalid_currency');
      if (patch.currency !== account.currency && this.#accountUsed(id)) throw new LedgerError('account_has_transactions');
      next.currency = patch.currency;
    }
    if (patch.openingBalance !== undefined) {
      if (!isSignedMoney(patch.openingBalance)) throw new LedgerError('invalid_amount');
      next.openingBalance = patch.openingBalance;
    }
    if (patch.archived !== undefined) next.archived = Boolean(patch.archived);
    if (this.state.accounts.some((item) => item.id !== id && sameName(item.name, next.name))) {
      throw new LedgerError('duplicate');
    }
    Object.assign(account, next);
    this.#commit();
    return account;
  }

  deleteAccount(id) {
    if (!this.account(id)) throw new LedgerError('not_found');
    if (this.#accountUsed(id)) throw new LedgerError('account_has_transactions');
    this.state.accounts = this.state.accounts.filter((item) => item.id !== id);
    this.#commit();
  }

  addCategory(input) {
    const name = cleanTitle(input.name);
    if (input.kind !== 'income' && input.kind !== 'expense') throw new LedgerError('invalid_kind');
    if (this.state.categories.some((item) => item.kind === input.kind && sameName(item.name, name))) {
      throw new LedgerError('duplicate');
    }
    const category = { id: this.#nextId(), name, kind: input.kind, archived: false };
    this.state.categories.push(category);
    this.#commit();
    return category;
  }

  updateCategory(id, patch) {
    const category = this.category(id);
    if (!category) throw new LedgerError('not_found');
    const next = { ...category };
    if (patch.name !== undefined) next.name = cleanTitle(patch.name);
    if (patch.archived !== undefined) next.archived = Boolean(patch.archived);
    if (this.state.categories.some((item) => item.id !== id && item.kind === next.kind && sameName(item.name, next.name))) {
      throw new LedgerError('duplicate');
    }
    Object.assign(category, next);
    this.#commit();
    return category;
  }

  deleteCategory(id) {
    if (!this.category(id)) throw new LedgerError('not_found');
    if (this.state.transactions.some((tx) => tx.categoryId === id)) throw new LedgerError('category_has_transactions');
    this.state.categories = this.state.categories.filter((item) => item.id !== id);
    this.state.budgets = this.state.budgets.filter((item) => item.categoryId !== id);
    this.#commit();
  }

  resolve(input) {
    if (!KINDS.includes(input.kind)) throw new LedgerError('invalid_kind');
    if (!isId(input.accountId)) throw new LedgerError('account_not_found');
    if (!isMoney(input.amount)) throw new LedgerError('invalid_amount');
    if (!isDate(input.occurredOn)) throw new LedgerError('invalid_date');
    const note = typeof input.note === 'string' ? input.note.trim() : '';
    if (note.length > 500) throw new LedgerError('invalid_note');
    const externalId = input.externalId ?? null;
    if (externalId !== null && (typeof externalId !== 'string' || externalId.length < 1 || externalId.length > 200)) {
      throw new LedgerError('invalid_external_id');
    }
    const account = this.account(input.accountId);
    if (!account) throw new LedgerError('account_not_found');

    const row = {
      kind: input.kind,
      accountId: input.accountId,
      toAccountId: null,
      categoryId: null,
      amount: input.amount,
      toAmount: null,
      occurredOn: input.occurredOn,
      note,
      externalId,
    };

    if (input.kind === 'transfer') {
      if (input.toAccountId == null) throw new LedgerError('to_account_required');
      if (input.categoryId != null) throw new LedgerError('category_not_allowed');
      if (input.toAccountId === input.accountId) throw new LedgerError('same_account');
      const target = this.account(input.toAccountId);
      if (!target) throw new LedgerError('account_not_found');
      if (target.currency === account.currency) {
        if (input.toAmount != null && input.toAmount !== input.amount) throw new LedgerError('amount_mismatch');
        row.toAmount = input.amount;
      } else {
        if (input.toAmount == null) throw new LedgerError('to_amount_required');
        if (!isMoney(input.toAmount)) throw new LedgerError('invalid_amount');
        row.toAmount = input.toAmount;
      }
      row.toAccountId = input.toAccountId;
      return row;
    }

    if (input.toAccountId != null || input.toAmount != null) throw new LedgerError('transfer_fields_not_allowed');
    if (input.categoryId != null) {
      const category = this.category(input.categoryId);
      if (!category) throw new LedgerError('category_not_found');
      if (category.kind !== input.kind) throw new LedgerError('category_kind_mismatch');
      row.categoryId = input.categoryId;
    }
    return row;
  }

  #hasExternalId(externalId, exceptId = null) {
    return externalId !== null && this.state.transactions.some((tx) => tx.externalId === externalId && tx.id !== exceptId);
  }

  addTransaction(input) {
    const row = this.resolve(input);
    if (this.#hasExternalId(row.externalId)) throw new LedgerError('duplicate');
    const tx = { id: this.#nextId(), ...row, createdAt: new Date().toISOString() };
    this.state.transactions.push(tx);
    this.#commit();
    return tx;
  }

  updateTransaction(id, patch) {
    const current = this.transaction(id);
    if (!current) throw new LedgerError('not_found');
    const draft = { ...current, ...patch };
    if (patch.kind !== undefined && patch.kind !== current.kind) {
      if (patch.kind === 'transfer') {
        if (patch.categoryId === undefined) draft.categoryId = null;
      } else {
        if (patch.toAccountId === undefined) draft.toAccountId = null;
        if (patch.toAmount === undefined) draft.toAmount = null;
      }
    }
    if (
      draft.kind === 'transfer' &&
      patch.toAmount === undefined &&
      (patch.amount !== undefined || patch.toAccountId !== undefined || patch.accountId !== undefined)
    ) {
      draft.toAmount = null;
    }
    const row = this.resolve(draft);
    if (this.#hasExternalId(row.externalId, id)) throw new LedgerError('duplicate');
    Object.assign(current, row);
    this.#commit();
    return current;
  }

  deleteTransaction(id) {
    if (!this.transaction(id)) throw new LedgerError('not_found');
    this.state.transactions = this.state.transactions.filter((tx) => tx.id !== id);
    this.#commit();
  }

  importTransactions(items) {
    if (!Array.isArray(items) || items.length === 0 || items.length > 5000) throw new LedgerError('invalid_import');
    const rows = items.map((item) => this.resolve(item));
    const known = new Set(this.state.transactions.map((tx) => tx.externalId).filter((value) => value !== null));
    let created = 0;
    let skipped = 0;
    for (const row of rows) {
      if (row.externalId !== null && known.has(row.externalId)) {
        skipped++;
        continue;
      }
      if (row.externalId !== null) known.add(row.externalId);
      this.state.transactions.push({ id: this.#nextId(), ...row, createdAt: new Date().toISOString() });
      created++;
    }
    if (created > 0) this.#commit();
    return { created, skipped };
  }

  setBudget(input) {
    if (!isMonth(input.month)) throw new LedgerError('invalid_month');
    if (!isMoney(input.amount)) throw new LedgerError('invalid_amount');
    const currency = input.currency ?? 'RUB';
    if (!isCurrency(currency)) throw new LedgerError('invalid_currency');
    const category = this.category(input.categoryId);
    if (!category) throw new LedgerError('category_not_found');
    if (category.kind !== 'expense') throw new LedgerError('category_kind_mismatch');
    let budget = this.state.budgets.find(
      (item) => item.categoryId === input.categoryId && item.month === input.month && item.currency === currency,
    );
    if (budget) {
      budget.amount = input.amount;
    } else {
      budget = { id: this.#nextId(), categoryId: input.categoryId, month: input.month, currency, amount: input.amount };
      this.state.budgets.push(budget);
    }
    this.#commit();
    return budget;
  }

  deleteBudget(id) {
    if (!this.state.budgets.some((item) => item.id === id)) throw new LedgerError('not_found');
    this.state.budgets = this.state.budgets.filter((item) => item.id !== id);
    this.#commit();
  }

  balances() {
    const delta = new Map(this.state.accounts.map((account) => [account.id, 0]));
    for (const tx of this.state.transactions) {
      delta.set(tx.accountId, delta.get(tx.accountId) + (tx.kind === 'income' ? tx.amount : -tx.amount));
      if (tx.toAccountId !== null) delta.set(tx.toAccountId, delta.get(tx.toAccountId) + tx.toAmount);
    }
    return this.state.accounts
      .map((account) => ({ ...account, balance: account.openingBalance + delta.get(account.id) }))
      .sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name, 'ru'));
  }

  listTransactions(filter = {}) {
    const query = filter.q ? filter.q.trim().toLowerCase() : '';
    const matches = this.state.transactions
      .filter((tx) => !filter.from || tx.occurredOn >= filter.from)
      .filter((tx) => !filter.to || tx.occurredOn <= filter.to)
      .filter((tx) => !filter.accountId || tx.accountId === filter.accountId || tx.toAccountId === filter.accountId)
      .filter((tx) => !filter.categoryId || tx.categoryId === filter.categoryId)
      .filter((tx) => !filter.noCategory || (tx.categoryId === null && tx.kind !== 'transfer'))
      .filter((tx) => !filter.noTransfers || tx.kind !== 'transfer')
      .filter((tx) => !filter.currency || this.account(tx.accountId).currency === filter.currency)
      .filter((tx) => !filter.kind || tx.kind === filter.kind)
      .filter((tx) => !query || tx.note.toLowerCase().includes(query))
      .sort((a, b) => (a.occurredOn === b.occurredOn ? b.id - a.id : a.occurredOn < b.occurredOn ? 1 : -1));
    const offset = filter.offset ?? 0;
    const items = filter.limit ? matches.slice(offset, offset + filter.limit) : matches.slice(offset);
    return { items, total: matches.length };
  }

  #flows(from, to) {
    return this.state.transactions
      .filter((tx) => tx.kind !== 'transfer' && tx.occurredOn >= from && tx.occurredOn <= to)
      .map((tx) => ({ tx, currency: this.account(tx.accountId).currency }));
  }

  summary(from, to) {
    if (from > to) throw new LedgerError('invalid_range');
    const totals = new Map();
    const categories = new Map();
    for (const { tx, currency } of this.#flows(from, to)) {
      const total = totals.get(currency) ?? { currency, income: 0, expense: 0 };
      total[tx.kind] += tx.amount;
      totals.set(currency, total);
      const key = `${currency}|${tx.kind}|${tx.categoryId}`;
      const entry = categories.get(key) ?? {
        categoryId: tx.categoryId,
        name: tx.categoryId === null ? null : this.category(tx.categoryId).name,
        kind: tx.kind,
        currency,
        total: 0,
      };
      entry.total += tx.amount;
      categories.set(key, entry);
    }
    return {
      from,
      to,
      totals: [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
      byCategory: [...categories.values()].sort(
        (a, b) => a.currency.localeCompare(b.currency) || a.kind.localeCompare(b.kind) || b.total - a.total,
      ),
    };
  }

  monthly(from, to) {
    if (from > to) throw new LedgerError('invalid_range');
    const rows = new Map();
    for (const { tx, currency } of this.#flows(from, to)) {
      const month = tx.occurredOn.slice(0, 7);
      const key = `${month}|${currency}`;
      const row = rows.get(key) ?? { month, currency, income: 0, expense: 0 };
      row[tx.kind] += tx.amount;
      rows.set(key, row);
    }
    return [...rows.values()].sort((a, b) => a.month.localeCompare(b.month) || a.currency.localeCompare(b.currency));
  }

  budgetsFor(month) {
    const from = `${month}-01`;
    const to = `${month}-31`;
    return this.state.budgets
      .filter((budget) => budget.month === month)
      .map((budget) => {
        const spent = this.state.transactions
          .filter(
            (tx) =>
              tx.kind === 'expense' &&
              tx.categoryId === budget.categoryId &&
              tx.occurredOn >= from &&
              tx.occurredOn <= to &&
              this.account(tx.accountId).currency === budget.currency,
          )
          .reduce((sum, tx) => sum + tx.amount, 0);
        return { ...budget, spent };
      });
  }

  exportData() {
    return { app: 'coffrie', exportedAt: new Date().toISOString(), ...structuredClone(this.state) };
  }

  importData(data) {
    const clean = validateState(data);
    Object.assign(this.state, clean);
    this.#commit();
  }
}

export function validateState(raw) {
  const fail = () => {
    throw new LedgerError('invalid_backup');
  };
  const data = migrate(raw);
  if (!data || typeof data !== 'object' || data.version !== CURRENT_VERSION) fail();
  for (const key of ['accounts', 'categories', 'transactions', 'budgets']) {
    if (!Array.isArray(data[key])) fail();
  }
  const state = createState();
  const ledger = new Ledger(state);
  const ids = new Set();
  let maxId = 0;
  const take = (id) => {
    if (!isId(id) || ids.has(id)) fail();
    ids.add(id);
    maxId = Math.max(maxId, id);
  };

  try {
    for (const item of data.accounts) {
      take(item.id);
      const account = ledger.addAccount({ name: item.name, currency: item.currency, openingBalance: item.openingBalance });
      Object.assign(account, { id: item.id, archived: Boolean(item.archived) });
    }
    for (const item of data.categories) {
      take(item.id);
      const category = ledger.addCategory({ name: item.name, kind: item.kind });
      Object.assign(category, { id: item.id, archived: Boolean(item.archived) });
    }
    for (const item of data.transactions) {
      take(item.id);
      const row = ledger.resolve(item);
      state.transactions.push({ id: item.id, ...row, createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString() });
    }
    for (const item of data.budgets) {
      take(item.id);
      const budget = ledger.setBudget({ categoryId: item.categoryId, month: item.month, currency: item.currency, amount: item.amount });
      budget.id = item.id;
    }
  } catch (error) {
    if (error instanceof LedgerError) fail();
    throw error;
  }
  state.nextId = Math.max(maxId, ...state.transactions.map((tx) => tx.id), 0) + 1;
  return state;
}
