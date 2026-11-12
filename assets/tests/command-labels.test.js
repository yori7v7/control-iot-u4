import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCommandName, formatCommandReferences } from '../js/ui/commandLabels.js';

test('presenta diagonales, parada y demostración con sus nombres naturales', () => {
  assert.deepEqual([
    'AVANZAR_DERECHA', 'RETROCEDER_IZQUIERDA', 'AVANZAR_IZQUIERDA',
    'RETROCEDER_DERECHA', 'DEMO_ORIGINAL', 'DETENER',
  ].map(formatCommandName), [
    'Avanzar a la derecha', 'Retroceder a la izquierda', 'Avanzar a la izquierda',
    'Retroceder a la derecha', 'Demostración original', 'Detener',
  ]);
});

test('normaliza claves adicionales y omite valores ausentes', () => {
  assert.equal(formatCommandName('  GIRAR__MÁS_RÁPIDO  '), 'Girar más rápido');
  assert.equal(formatCommandName('Control_LED'), 'Control LED');
  assert.equal(formatCommandName(' avanzar derecha '), 'Avanzar a la derecha');
  assert.equal(formatCommandName(null), '');
  assert.equal(formatCommandName('_'), '');
});

test('traduce referencias de comando en avisos y conserva el resto del texto', () => {
  assert.equal(formatCommandReferences('Usa DETENER. AVANZAR_DERECHA recibió HTTP 200 por REST.'),
    'Usa Detener. Avanzar a la derecha recibió HTTP 200 por REST.');
  assert.equal(formatCommandReferences('CLAXON_2 y otra DEMO por WSS.'), 'CLAXON_2 y otra DEMO por WSS.');
});
