# Etapa 5.5-K-P — Puerta de liberación previa a AWS (sin despliegue)

**Estado:** revisión automatizada preliminar agregada a la rama experimental `feature/5-5k-portal-unico-invitado`. Sin AWS/RDS, sin batería y sin cambios en `main` o GitHub Pages.

## Evidencia de entrada

El operador confirmó en Windows, mediante `prueba_55ko_reconexion_local.py` (13/11/2026), **3/3 barreras HTTP** del backend K-O:
- Preflight con 17 GET HTTP 200 estables durante 12 s; TLS 1.3 y verificación de certificado e IP.
- Al desconectar USB del ESP8266, HTTP 503.
- Tras reconectar USB y confirmar manualmente nueva autenticación, continuó HTTP 503: no se reabrieron permisos.
- **No se envió movimiento y no se demostró STOP mecánico**. El archivo de Terminal 1 de este tercer ensayo no se adjuntó y la autenticación posterior es una confirmación del operador, no una verificación independiente.

El backend registró el detalle en `docs/etapa_5_5k_o_resiliencia_backend_virtual.md`; rama `feature/5-5a-dispositivo-protocolo-aislado`.

## Bloqueo de liberación automático

`assets/tests/releaseGateKP.test.js` se ejecuta con `npm test` y falla si:
1. Alguien habilita `guestAdmissionEnabled` o `adminApprovalEnabled` sin eliminar explícitamente este requisito de la política (aún no aprobada).
2. Se retira la barrera global de mando mientras se muestra la administración experimental.
3. Se introduce la URL local `192.168.1.82:8443` o el dominio del mock en `config.js` o el CSP real.
4. El modelo virtual empieza a anunciar `canDrive=true` en el servicio de visitante/admin o pierde el método de suspensión conservadora.

Es una defensa de regresión estática y **no** una auditoría de seguridad integral.

## Requisitos antes de considerar la primera conexión pública

- Definir una única autoridad de movimientos y STOP, no permitir rutas Swagger antiguas que evadan el coordinador WSS.
- Asegurar sesiones y turnos persistentes del lado del servidor, con expiraciones por reloj monotónico controladas, revisiones de época/fencing y exclusividad entre workers/reinicios.
- Sesiones de profesor de duración limitada, resistentes a abuso (rate limiting), HTTPS con certificado público y credenciales nunca entregadas al visitante.
- Comprobar la neutralización física del vehículo y un watchdog **independiente en el microcontrolador**; un `STOP HMAC virtual` o un `HTTP 503` **no** detiene mecánicamente el motor.
- Revisar la autenticación administrativa, expiración por pérdida de foco/red, CSRF/orígenes, CORS, fuga de claves, auditoría y restricciones de acceso.
- Validar despliegue seguro en un entorno aislado del sistema que controla motores; no trasladar sin revisión el puerto LAN `8443` a EC2.
- Mantener `main` y GitHub Pages intactos hasta cumplir las verificaciones anteriores.

## Próximo trabajo

Probar que este gate falla **cuando deliberadamente** se activa una bandera en un fixture de CI (sin alterar la configuración real), completar la auditoría de las rutas legacy y diseñar infraestructura pública separada para recepción de solicitudes. **Todavía NO encender AWS ni RDS.**
