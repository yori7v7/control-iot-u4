import { isEntityId, isName, isNullableText, isRecord } from './validation.js';

export class Demo {
  constructor(data, expectedVehicleId = data?.id_vehiculo) {
    if (!isRecord(data) || !isEntityId(data.id_demo) || !isEntityId(data.id_vehiculo) ||
        data.id_vehiculo !== expectedVehicleId || !isName(data.nombre) ||
        !isNullableText(data.descripcion) || typeof data.activo !== 'boolean') {
      throw new TypeError('La API devolvió una DEMO inválida para el vehículo.');
    }

    this.id = data.id_demo;
    this.vehicleId = data.id_vehiculo;
    this.name = data.nombre;
    this.description = data.descripcion;
    this.active = data.activo;
    Object.freeze(this);
  }

  static forVehicle(rows, vehicleId) {
    if (!Array.isArray(rows)) throw new TypeError('El catálogo de DEMO es inválido.');
    const demos = rows.map(row => new Demo(row, vehicleId));
    if (new Set(demos.map(demo => demo.id)).size !== demos.length) {
      throw new TypeError('El catálogo contiene identificadores de DEMO repetidos.');
    }
    return demos;
  }
}
