const COMMAND_LABELS = {
  DETENER: 'Detener',
  AVANZAR: 'Avanzar',
  RETROCEDER: 'Retroceder',
  IZQUIERDA: 'Izquierda',
  DERECHA: 'Derecha',
  AVANZAR_IZQUIERDA: 'Avanzar a la izquierda',
  AVANZAR_DERECHA: 'Avanzar a la derecha',
  RETROCEDER_IZQUIERDA: 'Retroceder a la izquierda',
  RETROCEDER_DERECHA: 'Retroceder a la derecha',
  LUCES: 'Luces',
  VELOCIDAD: 'Velocidad',
  DEMO_ORIGINAL: 'Demostración original',
  CLAXON: 'Claxon',
};

export function formatCommandName(value) {
  if (typeof value !== 'string') return '';
  const name = value.replace(/[_\s]+/gu, ' ').trim();
  const key = name.toUpperCase().replaceAll(' ', '_');
  if (Object.hasOwn(COMMAND_LABELS, key)) return COMMAND_LABELS[key];

  const readable = name === name.toUpperCase() ? name.toLowerCase() : name;
  return readable.charAt(0).toUpperCase() + readable.slice(1);
}

export function formatCommandReferences(message) {
  return message.replace(/[\p{L}\p{N}_]+/gu, word =>
    Object.hasOwn(COMMAND_LABELS, word) ? COMMAND_LABELS[word] : word);
}
