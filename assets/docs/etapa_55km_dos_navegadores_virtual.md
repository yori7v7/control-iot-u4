# Etapa 5.5-K-M — Dos navegadores, misma interfaz; SIN AWS

**Estado:** implementación y batería de Playwright en la rama experimental `feature/5-5k-portal-unico-invitado` del frontend. La URL oficial `https://yori7v7.github.io/control-iot-u4/` permanece sin cambios. NO se modificó `main` ni se encendió AWS, RDS o el vehículo.

## Objetivo

Simular, en dos pestañas Chrome de la **misma URL** (`/control-iot-u4/`, sin parámetros de invitación), el flujo del futuro examen: visitante entra sin contraseña, solicita turno; administrador ingresa su propia API key, revisa código y aprueba 120 segundos; visitante ve autorización virtual y después revocación. El joystick, DEMO y DETENER del camino físico deben permanecer bloqueados incluso al recibir permiso virtual.

## Implementación

- `assets/tests/guest-admin-km.spec.js`: Playwright intercepta todos los recursos hacia Internet; la API ficticia `https://lab.invalid` es respondida exclusivamente por el propio test, con cola compartida de tickets. No se realiza una llamada a AWS, LAN ni a ninguna API real. Las rutas de movimientos/acciones/parada se consideran inesperadas.
- Playwright ajusta **solo en la respuesta interceptada del navegador de pruebas** el CSP y las banderas `guestAdmissionEnabled/adminApprovalEnabled`; los archivos reales `index.html` y `assets/js/config.js` siguen intactos y con ambas banderas en `false`.
- Se corrigen dos detalles reales de los clientes ES6 `GuestAdmissionService.js` y `AdminApprovalService.js`: llamar `fetch`, `setInterval` y `clearInterval` vinculados al objeto global; en Chrome la invocación sobre un receptor arbitrario podía fallar con `TypeError: Illegal invocation`. La prueba de navegador detectó y ayudó a corregirlo.
- El test atiende explícitamente las consultas legacy `GET /publico/vehiculos/1/control` y `GET /admin/vehiculos/1/control-publico` con **ventana cerrada**, sin habilitar operaciones legacy ni simular movimiento.

## Validación

- GitHub Actions [43374197509](https://github.com/yori7v7/control-iot-u4/actions/runs/43374197509), sobre el arreglo de los GET de solo lectura: **pruebas Node y dos E2E Chrome exitosos**. La ejecución sobre el archivo ya limpio de instrumentación debe comprobarse en la siguiente corrida.
- E2E escritorio: visitante sin contraseña → espera → solicitud del código concreto en inspector admin → pulso supervisor → aprobación `timed` de 120 s → usuario ve `Permiso virtual` → administrador revoca → visitante ve `Turno revocado`. Comprobados doce botones deshabilitados, joystick `aria-disabled`, DEMO y STOP deshabilitados y ausencia de POST de movimiento.
- E2E móvil `390×844`: indicadores de permiso y código visibles, sin desplazamiento horizontal y sin habilitar movimientos. Este caso aislado **no sustituye** la matriz visual completa ni la verificación física.

## Límites invariables

1. El contrato de laboratorio K-L recibió **16/16** por HTTPS 1.3 con ESP real pero GPIO inhibidos; eso no verifica detención mecánica.
2. En K-M los navegadores utilizan mocks, **NO** se conectan al servidor K-G real ni a AWS. Falta validar visualmente contra un HTTPS local con CA aprobada o una infraestructura de staging segura y separada.
3. Las banderas del frontend siguen `false`. NO hacer merge de la rama, desplegar ni pasar el token administrativo al visitante.
4. Para producción aún faltan autoridad durable de sesiones, fencing y arbitraje ante reinicios, protección antiabuso, supervisión humana efectiva, despacho único para joystick/Swagger/DEMO, neutralización STOP física comprobada, watchdog del dispositivo y revisión de seguridad remota.
5. **AWS y RDS permanecen apagados.** Solo se indicará encenderlos explícitamente cuando haya un incremento remoto controlado con verificaciones previas y sin depender de pruebas físicas no concluidas.

## Próximo incremento propuesto

5.5-K-N: pruebas de resiliencia del navegador (pestaña oculta, pérdida de red, reconexión, reinicio y expiración de turno), con fallos cerrados. Seguir con CI y mocks, sin motores.
