# 5.5-K-J — Panel administrativo en la página oficial (inactivo hasta HTTPS seguro)

**Fecha:** 12/11/2026, México. **Estado:** implementado en rama experimental del frontend, **apagado por defecto**. No desplegado en GitHub Pages; no modifica la rama `main`. No se encendieron AWS/RDS ni el ESP.

## Requisito de examen

El profesor abrirá exclusivamente **https://yori7v7.github.io/control-iot-u4/** (sin parámetros, códigos ni contraseñas) y la misma interfaz conservará **Control**, **Monitoreo**, joystick y botón DETENER. El administrador autorizará **solo desde su laptop** usando la sesión privada con X-API-Key, después de identificar la solicitud concreta del profesor. La página pública no identifica por sí sola a un profesor: cualquier visitante puede solicitar, pero no recibir permiso sin aprobación explícita.

## Cambios de frontend

- `index.html`: se añadió **dentro del popover existente «Turnos de control»** la sección oculta `#admin-requests`, con lista de pendientes, código de solicitud, caducidad, autorizar, rechazar, selector `Indefinido bajo supervisión` o `2 minutos`, iniciar/finalizar supervisión y revocar. **No hay nuevo HTML independiente, ni se cambian las vistas principales**.
- `assets/css/app.css`: estilo compacto para la lista, botones de 44 px, con el scroll restringido al inspector flotante. No se agranda ni se reordena el joystick ni el `main`.
- `assets/js/ui/DashboardView.js`: `setAdminApproval` muestra pendientes y acciones. Construye la lista con `createElement`/`textContent` (sin HTML interpolado); conserva nodos de solicitudes existentes durante actualizaciones para no perder foco ni crear destellos.
- `assets/js/services/AdminApprovalService.js`: servicio POO `AdminApprovalClient` + `AdminApprovalService`. Guarda la clave administrativa únicamente en **memoria** del navegador administrador, nunca en localStorage, URL ni en la página del invitado. Consulta la cola cada 2 s; el supervisor inicia voluntariamente el heartbeat de 5 s, cuya vigencia se limita a 15 s. Comprueba el código de solicitud, identificador UUID y respuestas estrictamente virtuales (`simulado=true`, `control_fisico=false`). Aprobación, rechazo y revocación exigen además respuesta explícita `aprobada=true`, `rechazada=true` o `revocado=true` respectivamente; un HTTP 200 por sí solo no basta.
- `assets/js/app.js`: conecta la clave introducida en «Habilitar control» al módulo privado de administrador, sin enviarla al visitante. Limpia el módulo al cerrar sesión o abandonar la página; el joystick y DEMO legacy **se bloquean si el módulo experimental llegase a habilitarse**, hasta que haya un despachador WSS único seguro.
- `assets/js/config.js`: **`adminApprovalEnabled: false`** y **`guestAdmissionEnabled: false`**. Son dos flags cerrados por defecto y deben continuar así hasta habilitar una API real segura.
- `assets/tests/adminApproval.test.js`: se añadieron 13 pruebas para Node 22 (`node --test assets/tests/adminApproval.test.js`); el desarrollo ejecutó **las 13 pruebas de lógica directamente sobre el código JS real en un runtime V8 aislado**: **13/13 passed**. Se comprobó también sintaxis de módulos, IDs únicos del HTML y URL/cabecera de la API. **Todavía no se ha corrido la suite npm test del repositorio completo ni Playwright visual**; no afirmar validación de todos los viewports.

## Contrato de backend administrado (aún NO existe)

El frontend esperará las rutas HTTPS siguientes, bajo la misma protección administrativa `/admin/vehiculos/{id}/control-publico`:

- `GET /admin/vehiculos/1/control-publico/solicitudes` → `{solicitudes:[{request_id:uuid,display_code:"A1B2C3D4",vence_en_seg:120}],turno_activo:false,simulado:true,control_fisico:false}`
- `POST /admin/vehiculos/1/control-publico/solicitudes/supervision` → `{supervision:true,vigencia_s:15,simulado:true,control_fisico:false}`
- `POST /admin/vehiculos/1/control-publico/solicitudes/{uuid}/aprobar` con `{modo:"supervised"}` o `{modo:"timed",segundos:120}` → `{aprobada:true,simulado:true,control_fisico:false}`
- `POST /admin/vehiculos/1/control-publico/solicitudes/{uuid}/rechazar` → `{rechazada:true,simulado:true,control_fisico:false}`
- `POST /admin/vehiculos/1/control-publico/solicitudes/revocar` → `{revocado:true,simulado:true,control_fisico:false}`

Las solicitudes requieren la **API key administrativa solo desde la laptop**, protegida con HTTPS, CORS de Pages y autenticación/autorización en el backend. **Estas cinco rutas son un CONTRATO PROPUESTO, NO endpoints operativos en AWS ni en K-G.** La futura implementación debe arbitrar sobre el mismo WSS K-G, no crear una segunda autoridad, y no admitir órdenes físicas hasta contar con stop/watchdog/interlock.

## Límites de seguridad importantes

1. Un heartbeat de navegador, incluso en segundo plano, **no demuestra supervisión humana**. Se necesitará una verificación de presencia activa y watchdog autónomo para control real.
2. El profesor no escribe clave ni código. El administrador debe **verificar personalmente el código visible del navegador del profesor** antes de aprobar, sin revelar secretos.
3. Los `guest_token` de control no están conectados a la página: el invitado **nunca puede conducir** en K-H/K-J, aunque su estado virtual sea autorizado.
4. El botón DETENER del frontend antiguo no basta para STOP mecánico prioritario. Antes del examen se deberán unificar Swagger, DEMO, joystick admin/invitado y la conexión física en una autoridad segura, con pruebas completas de neutralización.
5. La fase final contemplará preparar hotspot del teléfono para ESP8266 + laptop, y ensayar la configuración **antes del examen**, no el mismo día.

**No fusionar, no desplegar K-J como producción, no activar los flags.** La URL pública existente permanece estable.
