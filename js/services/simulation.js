import { BACKEND_DETAILS, CONFIG } from '../config.js';

const vehicle = Object.freeze({
  id_vehiculo: 1,
  nombre: 'Montacargas de práctica',
  modelo: 'HJ2025-1D',
  microcontrolador: 'NodeMCU ESP8266',
  descripcion: 'Vehículo de ejemplo para pruebas locales.',
  fecha_registro: null,
  activo: true,
});

const commands = [
  [1, 'DETENER', 0], [2, 'AVANZAR', 1], [3, 'RETROCEDER', 2], [4, 'IZQUIERDA', 4],
  [5, 'RETROCEDER_IZQUIERDA', 6], [6, 'DERECHA', 8], [7, 'AVANZAR_DERECHA', 9],
  [8, 'LUCES', 16], [9, 'VELOCIDAD', 32], [10, 'DEMO_ORIGINAL', 64], [11, 'CLAXON', 128],
].map(([id_comando, nombre, codigo]) => ({
  id_comando, nombre, codigo, id_vehiculo: vehicle.id_vehiculo, descripcion: null, activo: true,
}));

const demo = Object.freeze({
  id_demo: 1,
  id_vehiculo: vehicle.id_vehiculo,
  nombre: 'Recorrido de práctica',
  descripcion: 'Secuencia simulada de tres pasos para verificar la interfaz.',
  activo: true,
});

const steps = [
  [2, 900, 250], [4, 900, 250], [1, 100, 0],
].map(([id_comando, duracion_ms, pausa_ms], index) => {
  const command = commands.find(item => item.id_comando === id_comando);
  return {
    id_demo_movimiento: index + 1, orden: index + 1, id_comando,
    comando: command.nombre, codigo: command.codigo, duracion_ms, pausa_ms,
  };
});

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const interrupt = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', interrupt);
      resolve();
    }, ms);
    signal?.addEventListener('abort', interrupt, { once: true });
  });
}

// A private in-process transport. No branch calls the browser's Fetch or WebSocket.
export function createSimulation({ requestDelayMs = 65, demoStepScale = 1 } = {}) {
  const sockets = new Set();
  const availability = { api: true, database: true, socket: true };
  const vehiclePath = `/vehiculos/${vehicle.id_vehiculo}`;
  const demoPath = `${vehiclePath}/demos/${demo.id_demo}`;
  let state = null;
  let run = null;
  let eventNumber = 0;

  class SimulatedSocket extends EventTarget {
    readyState = 0;

    constructor(url) {
      super();
      queueMicrotask(() => {
        if (this.readyState !== 0) return;
        if (!availability.socket || url !== CONFIG.wsUrl) {
          this.close();
          return;
        }
        this.readyState = 1;
        sockets.add(this);
        this.dispatchEvent(new Event('open'));
        this.deliver({
          tipo_evento: 'estado_actual', id_vehiculo: vehicle.id_vehiculo,
          comando: state?.comando ?? null, codigo: state?.codigo ?? null,
          timestamp: state?.fecha_actualizacion ?? null, estado: state,
        });
      });
    }

    deliver(event) {
      if (this.readyState === 1) {
        this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) }));
      }
    }

    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      sockets.delete(this);
      this.dispatchEvent(new Event('close'));
    }
  }

  function updateState(id_comando, comando, codigo) {
    state = {
      id_vehiculo: vehicle.id_vehiculo, vehiculo: vehicle.nombre, id_comando, comando, codigo,
      conectado: false, fecha_actualizacion: new Date().toISOString(),
    };
  }

  function publish(tipo_evento, fields) {
    const id_evento = (++eventNumber).toString(16).padStart(32, '0');
    const event = { id_evento, tipo_evento, id_vehiculo: vehicle.id_vehiculo, ...fields };
    for (const socket of sockets) socket.deliver(event);
  }

  function publishDemo(type, fields = {}) {
    publish(type, {
      id_demo: demo.id_demo, nombre_demo: demo.nombre,
      timestamp: new Date().toISOString(), id_demo_movimiento: null, id_comando: null,
      orden: null, comando: null, codigo: null, duracion_ms: null, pausa_ms: null,
      conectado: null, mensaje: null, ...fields,
    });
  }

  function progressDemo(index) {
    if (index === steps.length) {
      run = null;
      publishDemo('demo_fin');
      return;
    }
    const step = steps[index];
    updateState(step.id_comando, step.comando, step.codigo);
    publishDemo('demo_movimiento', {
      ...step, timestamp: state.fecha_actualizacion, conectado: state.conectado,
    });
    run.timer = setTimeout(() => progressDemo(index + 1), (step.duracion_ms + step.pausa_ms) * demoStepScale);
  }

  function fetchGet(path) {
    if (path === '/') {
      return Response.json({ status: 'ok', service: 'API simulada', environment: 'development' });
    }
    if (!availability.database) {
      return Response.json({ detail: BACKEND_DETAILS.databaseUnavailable }, { status: 503 });
    }
    switch (path) {
      case '/health/database': return Response.json({ status: 'ok', database: 'available' });
      case vehiclePath: return Response.json(vehicle);
      case `${vehiclePath}/comandos`: return Response.json(commands);
      case `${vehiclePath}/demos`: return Response.json([demo]);
      case `${demoPath}/movimientos`: return Response.json(steps);
      default: return Response.json({ detail: 'Recurso simulado inexistente.' }, { status: 404 });
    }
  }

  function fetchPost(path, body) {
    if (!availability.database && path !== `${demoPath}/cancelar`) {
      return Response.json({ detail: 'La base de datos simulada no está disponible.' }, { status: 503 });
    }
    if (path === `${vehiclePath}/movimientos`) {
      const { id_comando } = JSON.parse(body);
      const command = commands.find(item => item.id_comando === id_comando && item.activo);
      if (!command) return Response.json({ detail: 'Comando inexistente.' }, { status: 404 });
      updateState(id_comando, command.nombre, command.codigo);
      const { comando, codigo, fecha_actualizacion, conectado } = state;
      const movement = { id_comando, comando, codigo, conectado, origen: 'API' };
      publish('movimiento', { ...movement, timestamp: fecha_actualizacion });
      return Response.json({ resultado: 'ok', id_vehiculo: vehicle.id_vehiculo, ...movement, fecha_actualizacion });
    }
    if (path === `${demoPath}/ejecutar`) {
      if (run) return Response.json({ detail: BACKEND_DETAILS.demoConflict }, { status: 409 });
      run = { timer: setTimeout(() => {
        publishDemo('demo_inicio');
        progressDemo(0);
      }, 20) };
      return Response.json({ id_vehiculo: vehicle.id_vehiculo, id_demo: demo.id_demo, estado: 'iniciada' }, { status: 202 });
    }
    if (path === `${demoPath}/cancelar`) {
      if (!run) return Response.json({ detail: 'No hay una DEMO activa.' }, { status: 404 });
      clearTimeout(run.timer);
      run = null;
      publishDemo('demo_cancelada');
      return Response.json({ id_vehiculo: vehicle.id_vehiculo, id_demo: demo.id_demo, estado: 'cancelada' });
    }
    return Response.json({ detail: 'Recurso simulado inexistente.' }, { status: 404 });
  }

  return {
    WebSocketImpl: SimulatedSocket,
    async fetchImpl(url, { method, body, signal }) {
      const target = new URL(url);
      await wait(requestDelayMs, signal);
      if (!availability.api || target.origin !== CONFIG.apiUrl) throw new TypeError('API simulada no disponible.');
      return method === 'GET' ? fetchGet(target.pathname) : fetchPost(target.pathname, body);
    },
    setAvailability(changes) {
      Object.assign(availability, changes);
      if (!availability.socket) for (const socket of sockets) socket.close();
    },
  };
}
