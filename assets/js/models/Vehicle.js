import { isEntityId, isName, isNullableText, isRecord } from './validation.js';

export class Vehicle {
  constructor(data, expectedId = data?.id_vehiculo) {
    if (!isRecord(data) || !isEntityId(data.id_vehiculo) || data.id_vehiculo !== expectedId ||
        !isName(data.nombre) || typeof data.activo !== 'boolean' ||
        !isNullableText(data.descripcion) || !isNullableText(data.modelo) ||
        !isNullableText(data.microcontrolador)) {
      throw new TypeError('La API devolvió información inválida del vehículo.');
    }

    this.id = data.id_vehiculo;
    this.name = data.nombre;
    this.model = data.modelo;
    this.description = data.descripcion;
    this.microcontroller = data.microcontrolador;
    this.active = data.activo;
    Object.freeze(this);
  }
}
