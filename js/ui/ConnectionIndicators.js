const STATUS = {
  connecting: ['Conectando', 'wait'],
  connected: ['En línea', 'good'],
  reconnecting: ['Reconectando', 'wait'],
  disconnected: ['Desconectado', 'bad'],
  checking: ['Comprobando', 'wait'],
  available: ['Disponible', 'good'],
  unavailable: ['No disponible', 'bad'],
  unverified: ['Sin verificar', 'idle'],
};

export class ConnectionIndicators {
  #items;

  constructor(document) {
    this.#items = {
      ws: document.getElementById('ws-indicator'),
      api: document.getElementById('api-indicator'),
      rds: document.getElementById('rds-indicator'),
    };
  }

  set(channel, state) {
    const item = this.#items[channel];
    const [label, tone] = STATUS[state];
    const text = item.querySelector('strong');
    if (text.textContent !== label) text.textContent = label;
    item.dataset.tone = tone;
  }
}
