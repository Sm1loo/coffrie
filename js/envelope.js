export function toEnvelope(value) {
  if (!value || typeof value !== 'object') return null;
  if (Number.isInteger(value.rev) && value.state && typeof value.state === 'object') return value;
  if (value.version === 1 && Array.isArray(value.accounts)) return { rev: 0, savedAt: 0, state: value };
  return null;
}

export function newest(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  return b.rev > a.rev ? b : a;
}
