import { button, el, field, form, input, list, section, select } from './dom.js';
import { demoEditor } from './editor.js';

const codes = [
  [0, 'DETENER'], [1, 'AVANZAR'], [2, 'RETROCEDER'], [4, 'IZQUIERDA'], [8, 'DERECHA'],
  [5, 'AVANZAR_IZQUIERDA'], [6, 'RETROCEDER_IZQUIERDA'], [9, 'AVANZAR_DERECHA'],
  [10, 'RETROCEDER_DERECHA'], [16, 'LUCES'], [32, 'VELOCIDAD'], [64, 'DEMO_ORIGINAL'], [128, 'CLAXON'],
];
const states = [['inventario', 'Inventario'], ['exhibicion', 'Exhibición'], ['vendida', 'Vendida'], ['baja', 'Baja']];
const text = (name, value, maxLength = 80) => input(name, 'text', value, { required: true, maxLength });
const checkbox = (name, checked, disabled = false) =>
  input(name, 'checkbox', '', { class: 'form-check-input', checked: Boolean(checked), disabled });

export function showAdmin(root, api, report) {
  const body = el('div');
  const control = select('seccion', [
    ['dashboard', 'Dashboard'], ['unidades', 'Inventario y asignaciones'], ['modelos', 'Modelos y capacidades'],
    ['usuarios', 'Clientes y usuarios'], ['demos', 'DEMOS de fábrica'], ['reservas', 'Exhibición y reservas'],
    ['auditoria', 'Auditoría'],
  ], 'dashboard');
  let generation = 0;
  root.replaceChildren(el('h2', { tabIndex: -1 }, 'Administración'), field('Sección', control), body);

  async function load(sectionName = control.value, args = {}) {
    const expected = ++generation;
    body.replaceChildren(el('p', { role: 'status' }, 'Cargando…'));
    try {
      const result = await sections[sectionName](args);
      if (expected !== generation) return false;
      body.replaceChildren(result);
      return true;
    } catch (error) {
      if (expected === generation) body.replaceChildren(el('p', { role: 'alert' }, error.message),
        button('Reintentar', () => void load(sectionName, args), true));
      return false;
    }
  }

  const mutate = async (path, method, payload, message, args) => {
    const expected = generation;
    const sectionName = control.value;
    report();
    await api(path, { method, body: payload });
    if (expected === generation && await load(sectionName, args)) report(message);
  };

  const sections = {
    async dashboard() {
      const data = await api('/dashboard');
      const labels = { modelos: 'Modelos activos', unidades: 'Unidades activas', vendidas: 'Vendidas',
        exhibicion: 'Exhibición disponible', clientes: 'Clientes activos', demos: 'DEMOS activas' };
      return section('Dashboard', el('dl', { class: 'iot-metrics' }, Object.entries(labels).map(([key, label]) =>
        el('div', {}, el('dt', {}, label), el('dd', {}, String(data[key]))))));
    },
    async usuarios({ after = 0 } = {}) {
      const rows = await api(`/usuarios?despues=${after}`);
      return section('Clientes y usuarios', el('div', { class: 'iot-columns' },
        form('Dar de alta cliente', [
          field('Nombre', text('nombre')),
          field('Correo', input('email', 'email', '', { required: true, maxLength: 254, autocomplete: 'off' })),
          field('Contraseña inicial', input('password', 'password', '', {
            required: true, minLength: 12, maxLength: 128, autocomplete: 'new-password',
          })),
        ], values => mutate('/usuarios', 'POST', Object.fromEntries(values), 'Cliente registrado.'), report),
        el('div', {}, list(rows, row => [
          el('span', {}, `${row.nombre} · ${row.email} · ${row.rol} · ${row.activo ? 'Activo' : 'Bloqueado'}`),
          row.rol === 'usuario' && button(row.activo ? 'Bloquear' : 'Habilitar',
            () => void mutate(`/usuarios/${row.id}/acceso`, 'PUT', { activo: !row.activo }, 'Acceso actualizado.', { after })
              .catch(error => report(error.message, true)), true),
        ].filter(Boolean)), rows.length === 100 ? button('Siguiente página', () => void load('usuarios', { after: rows.at(-1).id }), true) : null)));
    },
    async modelos({ after = 0, selected } = {}) {
      const rows = await api(`/modelos?despues=${after}`);
      const target = el('div');
      function edit(row) {
        const current = new Map((row?.capacidades ?? []).map(cap => [cap.codigo, cap]));
        const modelCodes = codes.map(([code, name]) => [code, current.get(code)?.nombre ?? name]);
        target.replaceChildren(form(row ? 'Actualizar modelo' : 'Crear modelo', [
          field('SKU', text('sku', row?.sku, 64)),
          field('Nombre', text('nombre', row?.nombre)),
          field('Descripción', input('descripcion', 'text', row?.descripcion, { maxLength: 255 })),
          field('Público', checkbox('publico', row?.publico)),
          field('Activo', checkbox('activo', row?.activo ?? true)),
          row ? el('p', {}, 'Estas casillas se aplican a todas las unidades vendidas de este modelo. Coordina DETENER antes de revocar un movimiento en curso.') : null,
          el('fieldset', { class: 'iot-capabilities' },
            el('legend', {}, row ? 'Comandos del comprador por modelo' : 'Comandos del nuevo modelo'), modelCodes.map(([code, name]) =>
            el('div', {}, field(name, checkbox(`cap${code}`, code === 0 || (current.has(code) && current.get(code).habilitada !== false), code === 0)),
              code <= 10 ? field(`Invitado · ${name}`, checkbox(`guest${code}`, current.get(code)?.invitado)) : null))),
          row ? el('details', {}, el('summary', {}, 'Editar pertenencia al catálogo'),
            el('p', {}, 'Quitar un comando del catálogo requiere un modelo sin unidades ni DEMOS.'),
            modelCodes.filter(([code]) => code !== 0 && current.has(code)).map(([code, name]) =>
              field(`Conservar en catálogo · ${name}`, checkbox(`keep${code}`, true)))) : null,
        ], values => mutate(row ? `/modelos/${row.id}` : '/modelos', row ? 'PUT' : 'POST', {
          sku: values.get('sku'), nombre: values.get('nombre'), descripcion: values.get('descripcion') || null,
          publico: values.has('publico'), activo: values.has('activo'),
          capacidades: modelCodes.filter(([code]) => code === 0 || (current.has(code)
            ? values.has(`keep${code}`) : values.has(`cap${code}`))).map(([codigo, nombre]) => ({
            codigo, nombre, invitado: values.has(`guest${codigo}`), habilitada: codigo === 0 || values.has(`cap${codigo}`),
          })),
        }, 'Modelo guardado.', { after, selected: row?.id }), report));
      }
      edit(rows.find(row => row.id === selected));
      return section('Modelos comerciales', el('div', { class: 'iot-columns' },
        el('div', {}, button('Nuevo modelo', () => edit()), list(rows, row => [
          el('span', {}, `${row.sku} · ${row.nombre}${row.activo ? '' : ' · Baja'}`), button('Editar', () => edit(row), true),
        ]), rows.length === 100 ? button('Siguiente página', () => void load('modelos', { after: rows.at(-1).id }), true) : null), target));
    },
    async unidades({ q = '', estado = '', after = 0 } = {}) {
      const filters = new URLSearchParams({ q, estado, despues: after });
      const [rows, models, clients] = await Promise.all([api(`/unidades?${filters}`), api('/modelos'), api('/usuarios')]);
      const target = el('div');
      const modelChoices = models.map(model => [model.id, model.nombre]);
      const clientChoices = clients.filter(client => client.rol === 'usuario' && client.activo)
        .map(client => [client.id, `${client.nombre} · ${client.email}`]);

      function unitForm(row) {
        target.replaceChildren(form(row ? 'Actualizar unidad' : 'Dar de alta unidad', [
          field('Serie', text('serie', row?.serie)),
          field('Nombre', text('nombre', row?.nombre)),
          field('Modelo', select('modelo', [['', 'Seleccionar'], ...modelChoices], row?.modelo)),
          field('Estado', select('estado', states.filter(([value]) => value !== 'vendida'), row?.estado || 'inventario')),
          row ? null : field('ID operativo existente (opcional)', input('id_vehiculo_existente', 'number', '', { min: 1 })),
        ], values => {
          const payload = Object.fromEntries(values);
          payload.modelo = Number(payload.modelo);
          if (!row) payload.id_vehiculo_existente = Number(payload.id_vehiculo_existente) || null;
          return mutate(row ? `/unidades/${row.vehiculo}` : '/unidades', row ? 'PUT' : 'POST', payload, 'Unidad guardada.', { q, estado });
        }, report));
      }

      function assign(row) {
        const choices = [['', 'Sin propietario'], ...clientChoices];
        if (row.propietario && !choices.some(([id]) => id === row.propietario))
          choices.push([row.propietario, `Propietario actual · #${row.propietario}`]);
        target.replaceChildren(form('Guardar asignación', [
          el('p', {}, `${row.nombre} · ${row.serie}`),
          field('Propietario', select('propietario', choices, row.propietario ?? '')),
        ], values => mutate(`/unidades/${row.vehiculo}/asignacion`, 'PUT', {
          propietario: Number(values.get('propietario')) || null, version: row.version,
        }, 'Asignación guardada.', { q, estado }), report));
      }

      async function history(row) {
        target.replaceChildren(el('p', {}, 'Cargando titularidad…'));
        try {
          const events = await api(`/unidades/${row.vehiculo}/titularidad`);
          target.replaceChildren(section('Historial de titularidad', list(events, item =>
            el('span', {}, `${item.fecha} · #${item.anterior ?? '—'} → #${item.propietario ?? '—'} · Administrador #${item.actor}`))));
        } catch (error) { report(error.message, true); }
      }

      unitForm();
      return section('Inventario', form('Buscar', [
        field('Serie o nombre', input('q', 'search', q)),
        field('Estado', select('estado', [['', 'Todos'], ...states], estado)),
      ], values => load('unidades', Object.fromEntries(values)), report),
      el('div', { class: 'iot-columns' },
        el('div', {}, button('Nueva unidad', () => unitForm()), list(rows, row => [
          el('span', {}, `#${row.vehiculo} · ${row.serie} · ${row.nombre} · ${states.find(([key]) => key === row.estado)[1]}`),
          row.estado !== 'vendida' ? button('Editar', () => unitForm(row), true) : null,
          ['inventario', 'vendida'].includes(row.estado) ? button('Asignar', () => assign(row), true) : null,
          button('Titularidad', () => void history(row), true),
        ]), rows.length === 100 ? button('Siguiente página', () => void load('unidades', { q, estado, after: rows.at(-1).vehiculo }), true) : null), target));
    },
    async demos({ model, selected } = {}) {
      const models = await api('/modelos');
      const choice = select('modelo', [['', 'Seleccionar modelo'], ...models.map(row => [row.id, row.nombre])], model ?? '');
      choice.addEventListener('change', () => void load('demos', { model: Number(choice.value) }));
      if (!model) return section('DEMOS de fábrica', field('Modelo', choice));
      const base = `/modelos/${model}/demos`;
      const editor = demoEditor({
        demos: await api(base), commands: models.find(row => row.id === model).capacidades, report,
        save: (id, body) => api(id ? `${base}/${id}` : base, { method: id ? 'PUT' : 'POST', body }),
        reload: id => load('demos', { model, selected: id }),
      });
      if (selected) editor.select(selected);
      return section('DEMOS de fábrica', field('Modelo', choice), editor.node);
    },
    async reservas() {
      return section('Reservas activas', list(await api('/reservas'), row => [
        el('span', {}, `${row.nombre} · vence ${row.vence} UTC`), button('Revocar reserva',
          () => void mutate(`/reservas/${row.vehiculo}`, 'DELETE', undefined, 'Reserva revocada.')
            .catch(error => report(error.message, true)), true),
      ], 'No hay reservas activas.'));
    },
    async auditoria({ before = 0 } = {}) {
      const rows = await api(`/auditoria?antes=${before}`);
      return section('Auditoría', list(rows, row => el('span', {},
        `${row.fecha} UTC · ${row.accion} · ${row.resultado}${row.actor ? ` · Usuario #${row.actor}` : ''}${row.vehiculo ? ` · Unidad #${row.vehiculo}` : ''}`)),
      rows.length === 100 ? button('Siguiente página', () => void load('auditoria', { before: rows.at(-1).id }), true) : null);
    },
  };
  control.addEventListener('change', () => void load());
  void load();
}
