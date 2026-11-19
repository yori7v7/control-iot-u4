import { button, el, field, form, input, list, section, select } from './dom.js';

export function demoEditor({ demos, commands, save, report, reload }) {
  const container = section('Editor de DEMOS');
  let selected = null;
  let steps = [];
  const stage = el('div');
  const choice = select('demo', [['', 'Nueva DEMO'], ...demos.map(demo => [demo.id, demo.nombre])]);
  const allowed = commands.filter(command => command.codigo !== 64);
  const rows = el('div', { class: 'iot-steps' });
  const time = el('output', { 'aria-live': 'polite' });

  function total() {
    const seconds = steps.reduce((sum, step) => sum + step.duracion_ms + step.pausa_ms, 0) / 1000;
    time.textContent = `Duración total ${seconds.toLocaleString('es-MX')} s`;
  }

  function renderSteps() {
    rows.replaceChildren();
    for (const [index, step] of steps.entries()) {
      const command = select('codigo', allowed.map(item => [item.codigo, item.nombre]), step.codigo);
      const duration = input('duracion', 'number', step.duracion_ms, { min: 30, max: 12000, required: true });
      const pause = input('pausa', 'number', step.pausa_ms, { min: 0, max: 12000, required: true });
      command.onchange = () => { step.codigo = Number(command.value); };
      duration.oninput = () => { step.duracion_ms = Number(duration.value); total(); };
      pause.oninput = () => { step.pausa_ms = Number(pause.value); total(); };
      const move = (destination, selector) => {
        [steps[index], steps[destination]] = [steps[destination], steps[index]];
        renderSteps();
        rows.children[destination].querySelector(selector).focus();
      };
      const up = button('Subir', () => move(index - 1, '.step-up'), true);
      up.classList.add('step-up');
      up.disabled = index === 0;
      const down = button('Bajar', () => move(index + 1, '.step-down'), true);
      down.classList.add('step-down');
      down.disabled = index === steps.length - 1;
      rows.append(el('fieldset', { class: 'iot-step' }, el('legend', {}, `Paso ${index + 1}`),
        field('Comando', command), field('Duración (ms)', duration), field('Pausa (ms)', pause),
        el('div', { class: 'iot-actions' }, up, down, button('Quitar paso', () => {
          steps.splice(index, 1);
          renderSteps();
          add.focus();
        }, true))));
    }
    add.disabled = !allowed.length || steps.length >= 24;
    total();
  }

  const add = button('Agregar paso', () => {
    steps.push({ codigo: allowed[0].codigo, duracion_ms: 500, pausa_ms: 100 });
    renderSteps();
    rows.lastElementChild.querySelector('select').focus();
  }, true);

  function open() {
    selected = demos.find(demo => String(demo.id) === choice.value);
    steps = (selected?.pasos ?? []).map(step => ({ ...step }));
    stage.replaceChildren(form('Guardar DEMO', [
      field('Nombre', input('nombre', 'text', selected?.nombre, { required: true, maxLength: 80 })),
      field('Descripción', input('descripcion', 'text', selected?.descripcion, { maxLength: 255 })),
      field('Activa', input('activo', 'checkbox', '', { class: 'form-check-input', checked: selected ? Boolean(selected.activo) : true })),
      rows, add, time,
    ], async values => {
      if (!steps.length) throw new Error('Agrega al menos un paso.');
      const result = await save(selected?.id, { nombre: values.get('nombre'), descripcion: values.get('descripcion') || null,
        activo: values.has('activo'), pasos: steps });
      await reload(result.id);
      report('DEMO guardada.');
    }, report));
    renderSteps();
  }

  choice.addEventListener('change', open);
  container.append(field('DEMO', choice), stage);
  open();
  return { node: container, select(id) { choice.value = String(id); open(); } };
}
