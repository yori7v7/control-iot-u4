import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { CONFIG } from '../js/config.js';

const APP = new URL('https://yori7v7.github.io/control-iot-u4/');
const VEHICLE = '/vehiculos/1';
const DEMO = `${VEHICLE}/demos/1`;
const MOVEMENT = `${VEHICLE}/movimientos`;
const READ_PATHS = new Set([
  '/', '/health/database', VEHICLE, `${VEHICLE}/comandos`, `${VEHICLE}/demos`, `${DEMO}/movimientos`,
]);
const CONTROL_PATHS = new Set([MOVEMENT, `${DEMO}/ejecutar`, `${DEMO}/cancelar`]);
const COMMANDS = new Map([[1, ['DETENER', 0]], [2, ['AVANZAR', 1]], [6, ['DERECHA', 8]]]);
const CONFIRMATION = 'MICROCONTROLADOR DESCONECTADO Y POST AUTORIZADOS';
const TYPES = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  svg: 'image/svg+xml',
};

function movementId(request) {
  try {
    const body = JSON.parse(request.postData());
    if (body && Object.keys(body).length === 1 && COMMANDS.has(body.id_comando)) return body.id_comando;
  } catch {
    // Reject unexpected bodies without logging them.
  }
  return null;
}

function allowsPost(path, request) {
  if (!CONTROL_PATHS.has(path)) return false;
  return path === MOVEMENT ? movementId(request) !== null : !request.postData();
}

async function serveLocal(route, path) {
  const asset = path.slice(APP.pathname.length) || 'index.html';
  if (!path.startsWith(APP.pathname) || (asset !== 'index.html' &&
    !/^(?:css|js|assets)\/(?:[a-z\d_-]+\/)*[a-z\d_.-]+\.(?:css|js|svg)$/i.test(asset))) {
    return route.abort();
  }

  let body;
  try {
    body = await readFile(new URL(`../${asset}`, import.meta.url));
  } catch {
    return route.fulfill({ status: 404 });
  }
  return route.fulfill({
    status: 200,
    body,
    headers: { 'content-type': TYPES[asset.split('.').at(-1).toLowerCase()], 'cache-control': 'no-store' },
  });
}

export async function configureFunctionalContext(context, allowPost) {
  // Keep the approved socket native so its handshake and events are genuine.
  await context.routeWebSocket(url => url.href !== CONFIG.wsUrl, socket => socket.close({ code: 1008 }));
  await context.route('**/*', async route => {
    const request = route.request();
    const { origin, pathname, search } = new URL(request.url());
    const method = request.method();
    if (search || request.redirectedFrom()) return route.abort();

    if (method === 'GET' && origin === APP.origin) return serveLocal(route, pathname);
    if (origin === CONFIG.apiUrl) {
      if (allowPost && method === 'OPTIONS' && CONTROL_PATHS.has(pathname)) return route.continue();
      const allowed = ['fetch', 'xhr'].includes(request.resourceType()) &&
        ((method === 'GET' && READ_PATHS.has(pathname)) ||
        (allowPost && method === 'POST' && allowsPost(pathname, request)));
      if (allowed) return route.continue();
    }
    return route.abort();
  });
}

async function recordControlResponse(response) {
  const { origin, pathname } = new URL(response.url());
  const request = response.request();
  if (origin !== CONFIG.apiUrl || request.method() !== 'POST' || !allowsPost(pathname, request)) return;

  const status = response.status();
  const record = { recibido_en: new Date().toISOString(), metodo: 'POST', ruta: pathname, http: status };
  if (pathname === MOVEMENT) record.id_comando = movementId(request);
  else record.id_demo = 1;
  if (status === 200 || status === 202) {
    try {
      const data = await response.json();
      if (pathname === MOVEMENT) {
        const command = COMMANDS.get(data.id_comando);
        if (status === 200 && command && data.id_comando === record.id_comando &&
          data.resultado === 'ok' && data.id_vehiculo === 1 &&
          command[0] === data.comando && command[1] === data.codigo &&
          data.origen === 'API' && typeof data.conectado === 'boolean' && (data.fecha_actualizacion === null ||
          typeof data.fecha_actualizacion === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.+-]+Z?$/.test(data.fecha_actualizacion))) {
          const { id_vehiculo, id_comando, comando, codigo, fecha_actualizacion, conectado, origen } = data;
          Object.assign(record, { id_vehiculo, id_comando, comando, codigo, fecha_actualizacion, conectado, origen });
        }
      } else if (data.id_vehiculo === 1 && data.id_demo === 1 && ['iniciada', 'cancelada'].includes(data.estado)) {
        Object.assign(record, { id_vehiculo: 1, id_demo: 1, estado: data.estado });
      }
    } catch {
      // Retain only the HTTP status when the expected JSON is unavailable.
    }
  }
  console.log(JSON.stringify(record));
}

async function askForConfirmation() {
  if (!stdin.isTTY || !stdout.isTTY) return false;
  const input = createInterface({ input: stdin, output: stdout });
  try {
    console.log('Modo protegido. Confirma la desconexión física del microcontrolador y la autorización expresa.');
    console.log('La clave se introduce únicamente en el formulario del panel.');
    return await input.question(`Escribe ${CONFIRMATION} y pulsa Enter.\n> `) === CONFIRMATION;
  } finally {
    input.close();
  }
}

async function openSession(args) {
  const allowPost = args.length === 1 && args[0] === '--habilitar-post';
  if (args.length && !allowPost) {
    console.error('Uso: node tests/open-functional-session.js [--habilitar-post]');
    process.exitCode = 1;
    return;
  }
  const debugSettings = ['DEBUG', 'DEBUG_FILE', 'PWDEBUG', 'PWDEBUGIMPL'];
  const hasDebugSettings = debugSettings.some(name => [name, `npm_config_${name.toLowerCase()}`,
    `npm_package_config_${name.toLowerCase()}`].some(key => process.env[key]));
  if (allowPost && hasDebugSettings) {
    console.error('Para la sesión protegida, inicia una terminal sin depuración de Playwright (DEBUG, DEBUG_FILE, PWDEBUG, PWDEBUGIMPL).');
    process.exitCode = 1;
    return;
  }
  if (allowPost && !await askForConfirmation()) {
    console.error('La confirmación interactiva no se completó. La sesión protegida no se abrió.');
    process.exitCode = 1;
    return;
  }

  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ channel: 'chrome', headless: false });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
    await configureFunctionalContext(context, allowPost);
    const page = await context.newPage();
    if (allowPost) page.on('response', response => void recordControlResponse(response));

    let endSession;
    const closed = new Promise(resolveClosed => { endSession = resolveClosed; });
    browser.once('disconnected', endSession);
    page.once('close', endSession);
    process.once('SIGINT', endSession);
    try {
      await page.goto(APP.href, { waitUntil: 'domcontentloaded' });
      console.log(allowPost ? 'Sesión protegida habilitada para la secuencia acordada.' : 'Sesión de solo lectura. POST bloqueados.');
      console.log('Archivos locales bajo el origen previsto de GitHub Pages. Cierra la ventana para terminar.');
      await closed;
    } finally {
      process.off('SIGINT', endSession);
    }
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await openSession(process.argv.slice(2));
  } catch {
    console.error('No se pudo completar la sesión de Chrome. Verifica que Chrome y las dependencias del proyecto estén instalados.');
    process.exitCode = 1;
  }
}
