/** 5.5-K-P — puerta de liberación en rama experimental.
 * No consume red, no usa navegador real y no interactúa con el ESP.
 * Esta rama habilita SOLO admisión virtual; CI falla si el joystick físico deja de estar bloqueado.
 * No fusionar esta rama al main del control físico legado.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { CONFIG } from '../js/config.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../');
const read = (relative) => readFileSync(resolve(ROOT, relative), 'utf8');

test('K-P: rama experimental activa SOLO admisión y aprobación virtuales juntas', () => {
  assert.equal(CONFIG.guestAdmissionEnabled, true);
  assert.equal(CONFIG.adminApprovalEnabled, true);
});

test('K-P: habilitar administracion experimental bloquea TODOS los comandos de actuacion', () => {
  const app = read('assets/js/app.js');
  assert.match(app, /if\s*\(CONFIG\.adminApprovalEnabled\)\s*return false\s*;/);
  assert.match(app, /const canControl\s*=\s*\(\)\s*=>\s*\{/);
});

test('K-P: el CSP oficial permite solo la API HTTPS y WSS legadas', () => {
  const html = read('index.html');
  assert.match(html, /connect-src 'self' https:\/\/100-30-4-62\.nip\.io wss:\/\/100-30-4-62\.nip\.io/);
  assert.doesNotMatch(html, /lab\.invalid|192\.168\.1\.82:8443/);
});

test('K-P: no hay URL de laboratorio ni simuladores en config experimental', () => {
  const cfg = read('assets/js/config.js');
  assert.match(cfg, /guestAdmissionEnabled:\s*true/);
  assert.match(cfg, /adminApprovalEnabled:\s*true/);
  assert.doesNotMatch(cfg, /lab\.invalid|192\.168\.1\.82|\/publico\/vehiculos\/1\/solicitudes/);
});

test('K-P: una falla de autorizacion no debe reactivar movimiento de joystick ni DEMO', () => {
  const src = read('assets/js/services/GuestAdmissionService.js');
  const admin = read('assets/js/services/AdminApprovalService.js');
  assert.match(src, /get state\(\)\s*\{\s*return Object\.freeze\(\{[^}]*canDrive:\s*false/);
  assert.match(admin, /canDrive:\s*false/);
  assert.match(src, /pause\(\)/);
  assert.match(admin, /pause\(\)/);
});
