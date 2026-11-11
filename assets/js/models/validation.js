const INT_MAX = 2147483647;

export function isEntityId(value) {
  return Number.isInteger(value) && value > 0 && value <= INT_MAX;
}

export function isCode(value) {
  return Number.isInteger(value) && value >= -INT_MAX - 1 && value <= INT_MAX;
}

export function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isName(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isMilliseconds(value) {
  return Number.isInteger(value) && value >= 0 && value <= 4294967295;
}

export function isNullableText(value) {
  return value === null || typeof value === 'string';
}

export function isNullableTimestamp(value) {
  return value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
}
