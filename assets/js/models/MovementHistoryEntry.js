import { isCode, isEntityId, isNullableText, isNullableTimestamp, isRecord } from './validation.js';

const MAX_HISTORY_ID = 9_223_372_036_854_775_807n;
const MAX_ROWS = 10;

function isHistoryId(value) {
  if (typeof value === 'bigint') return value > 0n && value <= MAX_HISTORY_ID;
  return Number.isSafeInteger(value) && value > 0;
}

export class MovementHistoryEntry {
  static decode(text) {
    return JSON.parse(text, (key, value, context) => {
      // Keep the JSON integer intact before any conversion to a JavaScript Number.
      if (key === 'id_historial' && typeof value === 'number' && context?.source !== undefined) {
        return /^[1-9]\d{0,18}$/.test(context.source) ? BigInt(context.source) : value;
      }
      return value;
    });
  }

  static forVehicle(rows, vehicleId) {
    const entries = new Map();
    for (const row of rows) {
      const entry = new MovementHistoryEntry(row, vehicleId);
      if (!entries.has(entry.id_historial)) entries.set(entry.id_historial, entry);
      if (entries.size === MAX_ROWS) break;
    }
    return [...entries.values()];
  }

  constructor(data, vehicleId) {
    if (!isRecord(data) || !isHistoryId(data.id_historial) || !isEntityId(data.id_vehiculo) ||
        data.id_vehiculo !== vehicleId || !isNullableText(data.comando) ||
        (data.codigo !== null && !isCode(data.codigo)) || !isNullableTimestamp(data.fecha_hora) ||
        typeof data.origen !== 'string' || [...data.origen].length > 30) {
      throw new TypeError('La API devolvió un registro de historial inválido.');
    }
    const { id_historial, id_vehiculo, comando, codigo, fecha_hora, origen } = data;
    Object.assign(this, { id_historial: String(id_historial), id_vehiculo, comando, codigo, fecha_hora, origen });
    Object.freeze(this);
  }
}
