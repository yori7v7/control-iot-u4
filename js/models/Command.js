import { isCode, isEntityId, isName, isNullableText, isRecord } from './validation.js';

export class Command {
  constructor(data, expectedVehicleId = data?.id_vehiculo) {
    if (!isRecord(data) || !isEntityId(data.id_comando) || !isEntityId(data.id_vehiculo) ||
        data.id_vehiculo !== expectedVehicleId || !isName(data.nombre) ||
        !isCode(data.codigo) || typeof data.activo !== 'boolean' || !isNullableText(data.descripcion)) {
      throw new TypeError('La API devolvió un comando inválido para el vehículo.');
    }

    this.id = data.id_comando;
    this.vehicleId = data.id_vehiculo;
    this.name = data.nombre;
    this.key = this.name.trim().toUpperCase().replace(/\s+/g, '_');
    this.code = data.codigo;
    this.description = data.descripcion;
    this.active = data.activo;
    Object.freeze(this);
  }

  static forVehicle(rows, vehicleId) {
    if (!Array.isArray(rows)) throw new TypeError('El catálogo de comandos es inválido.');
    const commands = rows.map(row => new Command(row, vehicleId));
    if (new Set(commands.map(command => command.id)).size !== commands.length) {
      throw new TypeError('El catálogo contiene identificadores de comando repetidos.');
    }
    const activeCommands = commands.filter(command => command.active);
    if (new Set(activeCommands.map(command => command.key)).size !== activeCommands.length) {
      throw new TypeError('El catálogo contiene nombres de comando activos ambiguos.');
    }
    return commands;
  }
}
