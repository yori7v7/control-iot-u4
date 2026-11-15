# Etapa 5.5-K-H — Solicitud automática en la MISMA página oficial (estructura UX)

**Fecha:** 12/11/2026. **Estado:** prototipo de frontend integrado solo en la rama experimental, desactivado por defecto. **10 pruebas Node locales aprobadas sobre el servicio de autorización.** Aún no se ejecutaron pruebas completas de navegador ni se probó HTTP público desde otra laptop.

## Evidencia previa K-G

El alumno ejecutó el nuevo ASGI FastAPI + WSS K-C con ESP8266 real y aportó salidas de las tres terminales: autenticación HMAC, solicitud del visitante `1799B13E`, aprobación `supervised`, revocación tras STOP lógico y consultas de estado correctas. El servidor presentó `integracion=mismo_controlador_wss` y `control_fisico=false`. [Registro de la prueba K-G del backend](https://github.com/yori7v7/vehiculo_iot_api_dev/blob/feature/5-5a-dispositivo-protocolo-aislado/docs/etapa_5_5k_g_validacion_manual_esp8266.md).

## Requisito invariable de la entrega

El profesor abrirá EXCLUSIVAMENTE `https://yori7v7.github.io/control-iot-u4/`, sin parámetros, enlace alternativo, contraseña, código de entrada ni formulario. Conservamos el `index.html` original, la vista Control con joystick y DETENER, la vista Monitoreo, el tema Dark Red Premium y el diseño compacto sin crear nuevas tarjetas, páginas ni scroll.

## Código en rama experimental

- `assets/js/services/GuestAdmissionService.js`: dos clases ES6:
  - `GuestAdmissionService`: máquina de estados `requesting`, `waiting`, `approved_virtual`, `revoked`, `unavailable`. Solicita un ticket al entrar, lo mantiene **solo en memoria** y consulta el permiso periódicamente cada dos segundos, sin botón de actualizar. Cancela suscripción al revocar, al cerrar la página o al iniciar una sesión administrativa; evita solicitudes duplicadas y descarta respuestas de solicitudes obsoletas. **Todos los estados mantienen `canDrive: false`; ninguna transición habilita movimientos.**
  - `GuestAdmissionClient`: contrato de futuro HTTPS `POST /publico/vehiculos/{id}/solicitudes` y `GET /publico/vehiculos/{id}/solicitudes/estado`; manda secreto opaco solo en cabecera `X-Browser-Session`, nunca en la URL, sin cookies ni almacenamiento persistente. No ofrece APIs de movimiento, STOP ni administración.
- `assets/js/ui/DashboardView.js`: método `setGuestAdmission` que reutiliza el indicador `Turnos de control` y su popover. Indica “Solicitando permiso”, “En espera”, “Permiso virtual”, “Revocado” o “Sin acceso”; el código visible de solicitud se muestra sin que el visitante deba escribir nada.
- `assets/js/app.js`: enlaza la máquina de estados con la página, detiene el sondeo al autenticar administrador, y vuelve a iniciarlo cuando se cierra la sesión. En cierre de página invalida el contexto de consulta; el joystick y la DEMO mantienen exactamente sus comprobaciones anteriores.
- `assets/js/config.js`: **`guestAdmissionEnabled: false`**. ¡No activarla! El backend público HTTPS que implementará estas rutas todavía NO existe, y K-G solo se conecta desde la PC local.
- `assets/tests/guestAdmission.test.js`: 10 pruebas locales: solicitud pendiente, aprobación virtual no actuante, revocación automática, respuesta incoherente falla cerrada, API caída, petición tardía tras cierre, petición duplicada, validación del bearer, ausencia de APIs de movimiento y envío HTTP sin secreto en la URL.

## Validación de desarrollo

Se ejecutó `node --test guestAdmission.test.js` sobre copia equivalente del módulo y pruebas en Node.js 22: **10 passed, 0 failed**. La copia desplegable de GitHub está en el directorio de pruebas habitual `assets/tests/guestAdmission.test.js`. No se ejecutó todavía la suite `npm test` del repositorio completo ni Playwright responsive sobre este cambio.

**El sitio GitHub Pages publicado sigue SIN cambios.** La rama `main` no se modificó. El código del frontend no se desplegó en GitHub Pages ni consumió la API de laboratorio.

## Lo pendiente ANTES de activar el indicador y habilitar joystick

1. Diseñar y desplegar **el contrato HTTPS público real** que autentique cada sesión de navegador sin contraseña, con Origin/CORS restringidos, rate limit, CSRF apropiado, política de sesión segura, rate limit y recuperación tras reinicios/multiworker.
2. Enviar solicitudes pendientes al inspector del administrador **en su laptop**, con aprobación explícita de la sesión concreta (código de referencia), duración definida o supervisada sin límite fijo.
3. Permitir un único controlador real por vehículo y compartir autoridad de sesión entre API pública y WSS del ESP **en AWS**, no con el servidor privado `192.168.1.82`. La IP local y puerto 8443 no deben publicarse ni abrirse al profesor.
4. Implantar un único camino de movimiento para Swagger, DEMO, administrador e invitado, con STOP prioritario y watchdog de hardware; comprobar parada física antes de quitar `ETAPA54_DIAGNOSTICO_SEGURO=1`.
5. **Solo entonces** habilitar el frontend y conectar `canCommand` a una credencial de turno válida y fresca, nunca a una respuesta de estado aislada. Probar las medidas de viewport originales para descartar scroll.
6. Configurar y probar hotspot de teléfono para laptop y ESP antes del examen, no durante la presentación.

**Prohibido confundir `approved_virtual` con permiso para mover motores.** La etapa K-H es preparación UX no actuante. Mantener el PR borrador.
