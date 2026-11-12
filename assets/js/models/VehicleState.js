import { isCode, isEntityId, isName, isNullableText, isNullableTimestamp, isRecord } from './validation.js';

export class VehicleState {
  static accepts(data, vehicleId) {
    return isRecord(data) && isEntityId(data.id_vehiculo) && data.id_vehiculo === vehicleId &&
      isName(data.vehiculo) && (data.id_comando === null || isEntityId(data.id_comando)) &&
      isNullableText(data.comando) && (data.codigo === null || isCode(data.codigo)) &&
      typeof data.conectado === 'boolean' && isNullableTimestamp(data.fecha_actualizacion);
  }

  constructor(data, vehicleId) {
    if (!VehicleState.accepts(data, vehicleId)) {
      throw new TypeError('La API devolvió un estado de vehículo inválido.');
    }
    const { id_vehiculo, vehiculo, id_comando, comando, codigo, conectado, fecha_actualizacion } = data;
    Object.assign(this, { id_vehiculo, vehiculo, id_comando, comando, codigo, conectado, fecha_actualizacion });
    Object.freeze(this);
  }
}
