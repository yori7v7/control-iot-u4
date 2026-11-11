import { CONFIG } from '../assets/js/config.js';
import { WebSocketClient } from '../assets/js/services/WebSocketClient.js';

const MAX_SESSION_MS = 10 * 60 * 1000;
const HANDSHAKE_TIMEOUT_MS = 12000;
const EVENT_FIELDS = [
  'tipo_evento', 'id_evento', 'id_vehiculo', 'id_comando', 'comando', 'codigo',
  'timestamp', 'conectado', 'origen', 'id_demo', 'id_demo_movimiento', 'orden',
  'duracion_ms', 'pausa_ms',
];
const STATE_FIELDS = ['id_vehiculo', 'id_comando', 'comando', 'codigo', 'conectado', 'fecha_actualizacion'];

function selectFields(record, fields) {
  return Object.fromEntries(fields.filter(field => Object.hasOwn(record, field))
    .map(field => [field, record[field]]));
}

async function observe(simulation) {
  const { vehicleId, wsUrl } = CONFIG;
  const WebSocketImpl = simulation
    ? (await import('../assets/js/services/simulation.js')).createSimulation().WebSocketImpl
    : globalThis.WebSocket;
  const mode = simulation ? 'simulacion' : 'real';
  let opened = false;
  let finished = false;

  function write(observacion, details = {}) {
    console.log(JSON.stringify({
      recepcion_utc: new Date().toISOString(), modo: mode, observacion, ...details,
    }));
  }

  function finish(reason, exitCode = 0) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    process.off('SIGINT', interrupt);
    socket.stop();
    write('socket_close', { motivo: reason });
    process.exitCode = exitCode;
  }

  const interrupt = () => finish('interrupcion_manual');
  const socket = new WebSocketClient({
    url: wsUrl,
    vehicleId,
    WebSocketImpl,
    handshakeTimeoutMs: HANDSHAKE_TIMEOUT_MS,
    onState(state) {
      if (state === 'connected') {
        opened = true;
        write('socket_open', { id_vehiculo: vehicleId, ...(simulation ? {} : { url: wsUrl }) });
      } else if (state === 'reconnecting') {
        // An interrupted observation cannot support continuous correlation.
        finish(opened ? 'conexion_interrumpida' : 'handshake_fallido_o_agotado', 1);
      }
    },
    onEvent(event) {
      const evidence = selectFields(event, EVENT_FIELDS);
      if (event.tipo_evento === 'estado_actual') {
        evidence.estado = event.estado === null ? null : selectFields(event.estado, STATE_FIELDS);
      }
      write('evento_wss', { evento: evidence });
      if (simulation && event.tipo_evento === 'estado_actual') finish('simulacion_completada');
    },
    onInvalid() {
      write('evento_ignorado', { motivo: 'formato_o_vehiculo_no_valido' });
    },
  });

  const timer = setTimeout(() => finish('duracion_maxima'), MAX_SESSION_MS);
  process.once('SIGINT', interrupt);
  socket.start();
}

const args = process.argv.slice(2);
if (args.length === 1 && ['--real', '--simulacion'].includes(args[0])) {
  await observe(args[0] === '--simulacion');
} else {
  console.error('Uso: node tests/observe-wss.js --simulacion | --real');
  process.exitCode = 2;
}
