import { newest, toEnvelope } from './envelope.js';

const DB_NAME = 'coffrie';
const STORE = 'kv';
const KEY = 'state';
const FALLBACK_KEY = 'coffrie.state';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet(key) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function idbPut(key, value) {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

function readFallback() {
  try {
    const text = localStorage.getItem(FALLBACK_KEY);
    return text ? toEnvelope(JSON.parse(text)) : null;
  } catch {
    return null;
  }
}

async function readBoth() {
  let idb = { ok: true, envelope: null };
  try {
    idb = { ok: true, envelope: toEnvelope(await idbGet(KEY)) };
  } catch {
    idb = { ok: false, envelope: null };
  }
  return { idbOk: idb.ok, envelope: newest(idb.envelope, readFallback()) };
}

export async function loadStored() {
  const { idbOk, envelope } = await readBoth();
  if (envelope) return { status: 'ok', envelope };
  return { status: idbOk ? 'empty' : 'error' };
}

export async function peekRev() {
  const { envelope } = await readBoth();
  return envelope ? envelope.rev : null;
}

export async function saveEnvelope(envelope) {
  try {
    await idbPut(KEY, envelope);
    try {
      localStorage.removeItem(FALLBACK_KEY);
    } catch {
      // не критично
    }
    return true;
  } catch {
    try {
      localStorage.setItem(FALLBACK_KEY, JSON.stringify(envelope));
      return true;
    } catch {
      return false;
    }
  }
}

export async function saveRaw(name, value) {
  try {
    await idbPut(`${KEY}-${name}`, value);
    return true;
  } catch {
    try {
      localStorage.setItem(`${FALLBACK_KEY}-${name}`, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }
}

export async function requestPersistence() {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export function getMeta(key) {
  try {
    return localStorage.getItem(`coffrie.${key}`);
  } catch {
    return null;
  }
}

export function setMeta(key, value) {
  try {
    localStorage.setItem(`coffrie.${key}`, value);
  } catch {
    // не критично
  }
}
