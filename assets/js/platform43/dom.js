export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.flat().filter(child => child !== undefined && child !== null && child !== false));
  return node;
}

export function button(text, action, quiet = false) {
  return el('button', { type: 'button', class: quiet ? 'btn btn-quiet' : 'btn btn-primary', onclick: action }, text);
}

export function field(label, control) {
  return el('label', { class: 'iot-field' }, el('span', {}, label), control);
}

export function input(name, type = 'text', value = '', options = {}) {
  return el('input', { name, type, value: value ?? '', class: 'form-control', ...options });
}

export function select(name, options, value = '') {
  const control = el('select', { name, class: 'form-select' },
    options.map(([key, label]) => el('option', { value: key }, label)));
  control.value = String(value);
  return control;
}

export function form(label, fields, submit, report) {
  return el('form', {
    class: 'iot-form',
    async onsubmit(event) {
      event.preventDefault();
      const node = event.currentTarget;
      const submitButton = node.querySelector('button[type=submit]');
      submitButton.disabled = true;
      try {
        await submit(new FormData(node));
      } catch (error) {
        report(error.message, true);
      } finally {
        submitButton.disabled = false;
      }
    },
  }, fields, el('button', { type: 'submit', class: 'btn btn-primary' }, label));
}

export function section(title, ...children) {
  return el('section', { class: 'iot-section' }, el('h3', {}, title), ...children);
}

export function list(rows, render, empty = 'Sin registros.') {
  return rows.length ? el('ul', { class: 'iot-list' }, rows.map(row => el('li', {}, render(row)))) : el('p', {}, empty);
}
