# 5.5-K-AG — Auditoría de contratos frontend/backend (offline, NO GO producción)

**Corte: 13/11/2026.** Comparación por lectura de las ramas experimentales:
- Frontend [PR #6](https://github.com/yori7v7/control-iot-u4/pull/6): `feature/5-5k-portal-unico-invitado`.
- Backend [PR #5](https://github.com/yori7v7/vehiculo_iot_api_dev/pull/5): `feature/5-5a-dispositivo-protocolo-aislado`.

**Resultado: NO-GO para activar permisos de manejo remoto.** No se ejecutó AWS, RDS, ESP o vehículo. GitHub Pages oficial y ambos `main` siguen intactos.

## Contratos que NO son intercambiables

| Punto | Portal frontend K-H/K-J | Backend K-I/K-K de laboratorio | Sidecar K-V detrás de Caddy candidato | Implicación |
| --- | --- | --- | --- | --- |
| Solicitud invitado | `POST /publico/vehiculos/1/solicitudes` con `Idempotency-Key` y `X-Browser-Proposal`, sin body | K-I tiene un gate en memoria y no implementa K-T como autoridad durable pública | K-V recibe par idempotente y persiste tickets SQLite privados | No suponer que K-I soporta las garantías K-V ni que ambos comparten sesión |
| Estado invitado | `GET /solicitudes/estado`, `X-Browser-Session`; solo muestra estado y código | K-I consulta controlador WSS K-C de laboratorio | K-V consulta ledger virtual separado | La autorización visual no equivale a mando físico |
| Bandeja admin | `GET /admin/.../solicitudes`, clave en header, sin cookies ni query | K-K usa `require_api_key` y el controlador WSS K-C, **solo laptop/LAN** | K-V exige **otra** prueba administrativa privada del staging | La API key legacy no debe tratarse como la prueba `admin.proof` del sidecar |
| Modalidad de aprobación | `supervised` o `timed` (selector visible: supervisado o 120 segundos) | K-K admite `supervised` y `timed` (30–300 s), solamente modo laboratorio | K-V `KVirtualApproval` admite **solo `timed`, hasta 120 s** | Conectar el selector supervisado a K-V devolvería 422; no habilitar como si fuera compatible |
| Autoridad y dispositivo | El frontend conserva `canDrive=false` | K-K comparte autoridad con el WSS K-C, sujeto a handover y ESP físico | K-V NO está cableado al controlador WSS ni a motores | No hay todavía una autoridad durable **única** extremo a extremo entre admin, invitado, Swagger y joystick |
| Caddy candidato | La URL pública es la misma | K-I/K-K están bloqueados en `app.main` en AWS y no son los endpoints del sidecar | Caddy deriva solamente las rutas de admisión al `9444` virtual | Que la URL coincida no significa que el backend cumpla el contrato de manejo del profesor |

## Decisión de arquitectura pendiente

Antes de habilitar el portal público debe elegirse e implementar **un único coordinador** de turnos y comandos que integre: tickets durables y anti-replay; autenticación/identidad administrativa; supervisión; exclusividad entre Swagger, joystick, DEMO e invitado; reconexión; STOP físico prioritario/neutralidad firmada; watchdog de firmware. No encender una flag para resolver una diferencia de contratos: sería presentar un permiso virtual como autorización física.

El sidecar K-V permanece útil como ensayo remoto **solo de admisión virtual** (`canDrive=false`). No certifica que la modalidad supervisada funcione para el carrito. K-K es útil para integración WSS **local** con ESP, pero no es todavía un producto HTTPS externo ni una sesión durable tras reinicio.

## Cambios de código verificados offline

K-AF corrigió en `assets/js/services/AdminApprovalService.js` la combinación del `AbortSignal` de sesión con el deadline de red: timeout de 5 s aunque el panel esté abierto y cancelación si se cierra. Además, comprueba la señal después del HTTP y del JSON, descartando respuestas tardías. Los tests nuevos están en `assets/tests/adminApproval.test.js`. Verificar CI del SHA exacto antes de reportar un cierre.

## Criterios de salida para la siguiente sesión física

1. Desde la laptop: ventana aprobada para encender **solamente EC2**, ejecutar preflight `-Mode Server` **solo lectura** de K-AD y registrar resultados saneados. No instalar Caddy/cuenta de servicio por defecto.
2. Resolver en diseño/CI el contrato de un solo coordinador WSS y el esquema de administrador/visitante. Mantener `guestAdmissionEnabled=false` y `adminApprovalEnabled=false`.
3. Verificar Caddy persistente real, tareas, firewall, ACL, secreto de proxy/admin y rollback privado en Windows antes de exponer admisión virtual externa.
4. **Después**, cuando esté disponible ESP + carrito con batería desconectada inicialmente, probar handshake y neutralidad, y solo al final STOP mecánico/watchdog con supervisión segura.

**No fusionar PR #5/#6 ni habilitar acciones físicas a partir de pruebas virtuales o de este documento.**
