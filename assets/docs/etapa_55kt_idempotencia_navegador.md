# Etapa 5.5-K-T — Solicitudes idempotentes en la misma página (frontend experimental)

**Estado: VALIDADA con Node y Chrome en mocks. No desplegada.** Solo en rama `feature/5-5k-portal-unico-invitado`; ambas banderas `guestAdmissionEnabled=false` y `adminApprovalEnabled=false` en `assets/js/config.js`. La URL oficial de GitHub Pages y la rama `main` no se modificaron.

## Objetivo

Que una persona entre a la única página del control IoT, solicite un turno virtual y, si se pierde la respuesta HTTPS, el navegador pueda reintentar **sin generar un segundo ticket**. Si se cierra la pestaña, los valores no se guardan en almacenamiento del navegador y el ticket huérfano expira en el servidor. Todos los permisos permanecen virtuales; nunca se habilitan los motores.

## Cambios del navegador

- `GuestAdmissionClient` genera dos claves **distintas** con `crypto.getRandomValues(new Uint8Array(32))` y Base64url de 43 caracteres. Nunca usa `Math.random`, API key administrativa, almacenamiento persistente, query strings ni cookies.
- Envía la solicitud POST con `Idempotency-Key` y `X-Browser-Proposal`. Valida que el servidor devuelva el mismo secreto propuesto, `simulado=true`, `control_fisico=false` y `canDrive=false`. Si no coincide, rechaza la respuesta sin autorizar nada.
- Si un primer POST da error de red o timeout, conserva el mismo par en RAM y lo reintenta por el ciclo de sondeo. El backend experimental K-T devuelve HTTP 201 al crear un ticket y HTTP 200 para repetir un ticket **aún pendiente** con la misma identidad y el mismo par.
- `GuestAdmissionService` solo marca la sesión como `waiting` si la respuesta es virtual y verificable. Al perder foco/red la interfaz se vuelve `unavailable`; al regresar revalida. En `stop()` se borra el secreto y el cliente descarta el par.
- El mock aislado Playwright simula la misma idempotencia para las dos pestañas de la página. No hay tráfico real hacia AWS, LAN, API pública, RDS o WebSocket del vehículo.

## Validación automática

- Backend K-T: [GitHub Actions 43385380685](https://github.com/yori7v7/vehiculo_iot_api_dev/actions/runs/43385380685), **651 pruebas y 840 subpruebas aprobadas**, con creación/repetición/sesiones viejas/límites/concurrencia en SQLite.
- Frontend K-T: [GitHub Actions 43386103986](https://github.com/yori7v7/control-iot-u4/actions/runs/43386103986), commit `98cc45d14badd52fd889f7a0d34f84ee2f8a3f63`: **93/93 pruebas JavaScript y 4/4 Chrome aprobadas**.
- Las pruebas JavaScript cubren pérdida de la primera respuesta, repetición con exactamente los mismos valores, invalidación de las claves al cerrar, rechazo de una respuesta falsa o física, y ausencia de métodos de movimiento.
- Las pruebas Chrome comprueban el flujo de dos pestañas (profesor y supervisor), móvil, pérdida de red, revocación, reanudación sin supervisión automática y que joystick/DEMO permanezcan deshabilitados.

## Límites y trabajos necesarios

- El contrato HTTPS K-S está implementado **solo en ASGI TestClient**, no en EC2 ni en FastAPI público. El mock Chrome no prueba un enlace real navegador↔backend con TLS completo.
- El soporte sin cabeceras de idempotencia de K-S es una **compatibilidad de laboratorio**: con `kt_idempotency_required=False` permite duplicados antiguos. Para staging futuro debe configurarse en `True` y aprobarse la interoperabilidad con el cliente actualizado.
- Si el navegador se reinicia antes de conservar la respuesta, no puede recuperar el par secreto anterior: no se persiste deliberadamente. El servidor debe expirar/revocar ese ticket huérfano, y un nuevo intento podrá quedar sujeto a cuota.
- Una respuesta `autorizado` significa **solo permiso virtual**, no control de motores, y el frontend no tiene un canal de movimiento autorizado para visitantes.
- Faltan seguridad física del STOP, watchdog del microcontrolador, único despachador WSS para joystick/DEMO/Swagger y autoridad durable distribuida para el acceso remoto desde Internet.
- **NO habilitar las banderas, fusionar la rama ni encender AWS/RDS por esta etapa.**

## Siguiente incremento

Preparar pruebas de contrato cruzado navegador ↔ K-S con un servicio HTTPS de staging **sin actuadores**, con controles de origen y certificado públicos, pero no exponer el laboratorio K-G ni abrir el puerto LAN 8443 al exterior. Confirmar que un visitante real no recibe una API key administrativa y que no hay ninguna ruta física disponible antes de la primera evaluación de despliegue remoto.
