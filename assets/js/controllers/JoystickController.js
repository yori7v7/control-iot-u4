const KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const CARDINALS = ['AVANZAR', 'RETROCEDER', 'IZQUIERDA', 'DERECHA'];
const DIAGONAL_RATIO = Math.SQRT2 - 1;

export class JoystickController {
  #element;
  #knob;
  #canCommand;
  #onDirection;
  #onRelease;
  #onPreview;
  #window;
  #document;
  #listeners = new AbortController();
  #pointer = null;
  #keys = new Set();
  #direction = null;
  #preview = null;
  #neutralSent = false;

  constructor({ element, knob, canCommand = () => true, onDirection, onRelease, onPreview = () => {} }) {
    this.#element = element;
    this.#knob = knob;
    this.#canCommand = canCommand;
    this.#onDirection = onDirection;
    this.#onRelease = onRelease;
    this.#onPreview = onPreview;
    this.#document = element.ownerDocument;
    this.#window = this.#document.defaultView;
    const options = { signal: this.#listeners.signal };

    element.addEventListener('pointerdown', event => this.#pointerDown(event), options);
    this.#window.addEventListener('pointermove', event => this.#pointerMove(event), options);
    this.#window.addEventListener('pointerup', event => this.#pointerEnd(event), options);
    this.#window.addEventListener('pointercancel', event => this.#pointerEnd(event), options);
    this.#window.addEventListener('pointerout', event => {
      if (event.relatedTarget === null && !element.hasPointerCapture?.(event.pointerId)) this.#pointerEnd(event);
    }, options);
    element.addEventListener('lostpointercapture', event => this.#pointerEnd(event), options);
    element.addEventListener('keydown', event => this.#keyDown(event), options);
    element.addEventListener('keyup', event => this.#keyUp(event), options);
    element.addEventListener('blur', () => {
      if (this.#keys.size) this.reset({ stop: true });
    }, options);
    this.#window.addEventListener('blur', () => this.reset({ stop: true }), options);
    this.#window.addEventListener('pagehide', () => this.reset({ stop: true }), options);
    this.#document.addEventListener('visibilitychange', () => {
      if (this.#document.hidden) this.reset({ stop: true });
    }, options);
  }

  reset({ stop = false } = {}) {
    const pointer = this.#pointer;
    const engaged = pointer !== null || this.#keys.size > 0 || this.#direction !== null;
    this.#pointer = null;
    this.#keys.clear();
    this.#direction = null;
    this.#position(0, 0);
    this.#show(null);

    if (pointer !== null && this.#element.hasPointerCapture?.(pointer)) {
      this.#element.releasePointerCapture(pointer);
    }
    if (stop && engaged && !this.#neutralSent) this.#onRelease();
    this.#neutralSent = false;
  }

  destroy() {
    this.reset({ stop: true });
    this.#listeners.abort();
  }

  #pointerDown(event) {
    if (event.button !== 0 || this.#pointer !== null || this.#keys.size ||
        !CARDINALS.some(name => this.#canCommand(name))) return;
    event.preventDefault();
    this.#element.focus({ preventScroll: true });
    this.#pointer = event.pointerId;
    try {
      this.#element.setPointerCapture?.(event.pointerId);
    } catch {
      // The window listeners also cover a release outside the surface.
    }
    this.#pointerMove(event);
  }

  #pointerMove(event) {
    if (this.#pointer !== event.pointerId) return;
    if (event.pointerType === 'mouse' && event.buttons === 0) {
      this.reset({ stop: true });
      return;
    }
    const bounds = this.#element.getBoundingClientRect();
    const travel = this.#travel(bounds);
    const x = event.clientX - bounds.left - bounds.width / 2;
    const y = event.clientY - bounds.top - bounds.height / 2;
    const distance = Math.hypot(x, y);
    const scale = distance > travel ? travel / distance : 1;
    const threshold = this.#direction ? 0.16 : 0.23;
    this.#position(x * scale, y * scale);
    this.#publish(distance > threshold * travel ? this.#choose(x, y) : null);
  }

  #pointerEnd(event) {
    if (this.#pointer === event.pointerId) this.reset({ stop: true });
  }

  #keyDown(event) {
    if (event.key === 'Escape' && !event.repeat) {
      event.preventDefault();
      this.reset();
      this.#onRelease();
      return;
    }
    if (!KEYS.has(event.key)) return;
    event.preventDefault();
    if (this.#pointer !== null || event.repeat || !CARDINALS.some(name => this.#canCommand(name))) return;
    this.#keys.add(event.key);
    this.#updateKeys();
  }

  #keyUp(event) {
    if (!KEYS.has(event.key) || !this.#keys.delete(event.key)) return;
    event.preventDefault();
    if (this.#keys.size) this.#updateKeys();
    else this.reset({ stop: true });
  }

  #updateKeys() {
    const x = Number(this.#keys.has('ArrowRight')) - Number(this.#keys.has('ArrowLeft'));
    const y = Number(this.#keys.has('ArrowDown')) - Number(this.#keys.has('ArrowUp'));
    const distance = Math.hypot(x, y) || 1;
    const travel = this.#travel(this.#element.getBoundingClientRect());
    this.#position(x * travel / distance, y * travel / distance);
    this.#publish(x || y ? this.#choose(x, y) : null);
  }

  #choose(x, y) {
    const horizontal = Math.abs(x);
    const vertical = Math.abs(y);
    const longitudinal = y < 0 ? 'AVANZAR' : 'RETROCEDER';
    const lateral = x < 0 ? 'IZQUIERDA' : 'DERECHA';
    const nearDiagonal = Math.min(horizontal, vertical) > DIAGONAL_RATIO * Math.max(horizontal, vertical);
    if (nearDiagonal) {
      const diagonal = `${longitudinal}_${lateral}`;
      if (this.#canCommand(diagonal)) return diagonal;
    }
    const cardinal = vertical >= horizontal ? longitudinal : lateral;
    return this.#canCommand(cardinal) ? cardinal : null;
  }

  #publish(direction) {
    this.#show(direction);
    if (direction === this.#direction) return;
    if (direction) {
      if (this.#onDirection(direction) === false) return;
      this.#neutralSent = false;
    } else {
      this.#onRelease();
      this.#neutralSent = true;
    }
    this.#direction = direction;
  }

  #show(direction) {
    if (this.#preview === direction) return;
    this.#preview = direction;
    this.#onPreview(direction);
  }

  #travel(bounds) {
    const knob = this.#knob.getBoundingClientRect();
    return Math.max(1, (Math.min(bounds.width, bounds.height) - Math.max(knob.width, knob.height)) / 2 - 8);
  }

  #position(x, y) {
    this.#knob.style.translate = `${x}px ${y}px`;
  }
}
