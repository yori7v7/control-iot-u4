# Etapa 5.5-K-N — Resiliencia de sesiones en el navegador (solo virtual)

**Estado:** código y pruebas de resiliencia en la rama experimental `feature/5-5k-portal-unico-invitado`. No se publicaron cambios en GitHub Pages ni se modificaron las ramas `main`. AWS, RDS, batería, motores y router de Internet continúan apagados/cerrados.

## Objetivo

Demostrar que el navegador **no mantiene un permiso o supervisión verificable** cuando pierde conectividad, se oculta, recibe una respuesta HTTP antigua o detecta un turno caducado. El permiso **virtual** nunca permite movimiento; ningún cliente K-N expone operaciones físicas.

## Cambios del código

- `GuestAdmissionService.js`: agrega `pause()` y `resume()`. Al ocultarse/offline suspende el sondeo, incrementa la generación, invalida la vista inmediatamente (`unavailable`) y conserva el identificador de sesión **solo en memoria** para poder hacer un GET fresco cuando vuelva la red. Un GET tardío de una generación antigua jamás reactiva el permiso; si el backend devuelve `revocado_o_caducado`, cierra la sesión visual. Si el primer POST quedó sin confirmar, al volver puede crear otra solicitud; las solicitudes huérfanas deben expirar del lado del servidor.
- `AdminApprovalService.js`: también `pause()`/`resume()`. Suspender borra tickets, turno activo y latido de la UI, detiene timers, invalida respuestas pendientes y bloquea autorizar; **intenta** `POST /revocar` si había supervisión, un turno o una operación en vuelo. Se trata de un intento **best-effort**: si la red falla **no demuestra revocación ni STOP físico**. Al volver hay un GET nuevo y debe iniciarse supervisión **manualmente**. Se evita aceptar un heartbeat si el reloj local retrocedió.
- `assets/js/app.js`: conecta eventos `visibilitychange`, `offline`, `online` y `pagehide` con cierre/revalidación. No reanuda al estar oculta la página. Las banderas de acceso público continúan deshabilitadas en `assets/js/config.js`.

## Validación automatizada (sin backend real)

- Pruebas unitarias: `assets/tests/guestAdmission.test.js` y `assets/tests/adminApproval.test.js` agregan caducidad al regresar, pérdida de red, respuestas tardías, petición inicial en vuelo, intento de revocación que falla, reloj atrasado y sesión cerrada.
- Pruebas Chrome: `assets/tests/guest-admin-km.spec.js` ahora incluye cuatro E2E. Dos de K-M (dos navegadores y vista móvil) y dos de K-N (offline + permiso caducado + recarga sin storage, supervisor oculto + revocación + revalidación sin armar).
- GitHub Actions `experimental-frontend-km.yml` ejecuta `npm test` y el E2E aislado: ningún mock llama a AWS, WSS, API real ni movimientos.
- Evidencia confirmada anterior al test de carrera final: [CI 43375481783](https://github.com/yori7v7/control-iot-u4/actions/runs/43375481783) — **84/84 pruebas Node y 4/4 Chrome aprobadas**. La prueba adicional de respuesta tardía de autorización se añadió después y deberá constar en una ejecución posterior.

## Limitaciones y medidas necesarias antes de AWS o motores

1. El cierre visual no revoca por sí solo un permiso remoto: el backend debe aplicar TTL estricto, fencing transaccional, una sola autoridad de control, conexión WSS autenticada y STOP seguro independientemente del navegador.
2. `POST /revocar` al ocultar es best-effort: una página puede cerrarse o perder conexión sin enviar la petición. **No depender del evento de navegador para detener motores**. Para control físico se requiere watchdog autónomo del microcontrolador y pruebas de neutralidad mecánica.
3. Las respuestas de navegador de K-N provienen de mocks interceptados por Playwright. No demuestran AWS, administración pública desde Internet ni motores.
4. `guestAdmissionEnabled=false` y `adminApprovalEnabled=false` siguen intactos; no habilitarlos ni fusionar ramas todavía.
5. Si la ventana vuelve a primer plano, el navegador consulta el estado, pero la supervisión no reanuda automáticamente, evitando que una página que se recupera otorgue permisos por sí sola.

## Próximo incremento

**5.5-K-O: validación de resiliencia y autoridad en el backend**: probar restart/reconnect WSS, vencimiento en servidor, revocación antes/después de aprobaciones concurrentes y bloqueo de métodos legacy. Mantener GPIO inhibidos y AWS/RDS apagados hasta que esos invariantes estén verificados.
