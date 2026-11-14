# Etapa 5.5-K-U — Contrato cruzado HTTPS real con origen GitHub Pages (CI aislado)

**ESTADO: APROBADO EN LABORATORIO HTTPS DE CI. SIN DESPLIEGUE.**

## Requisito de entrega del profesor: UNA SOLA URL

**La entrega académica debe seguir siendo exactamente `https://yori7v7.github.io/control-iot-u4/`.** No se sustituye por una dirección de EC2, Swagger, nip.io, localhost, un enlace de Vercel, ni un segundo sitio. El profesor solamente abrirá esta URL; la página hará las llamadas HTTPS necesarias al backend seguro en segundo plano. GitHub Pages, al ser hosting estático, no ejecuta FastAPI ni WSS, y cualquier acceso remoto real requiere un servicio separado de admisión detrás de la misma interfaz.

En K-U **NO** se publicó ni se activó la nueva admisión. Las banderas `guestAdmissionEnabled=false` y `adminApprovalEnabled=false` permanecen cerradas; `main` y GitHub Pages no se modificaron.

## Hallazgo de seguridad real de Chrome

Cuando la prueba intentó usar la página con origen público `https://yori7v7.github.io` y el servidor de pruebas en loopback `https://ks.localhost:9443`, Chrome rechazó el `fetch` por **Local Network Access**, aunque `curl` validara TLS y CORS. Es una protección legítima del navegador: **no** desactivar LNA, no exponer 8443 de la laptop, no abrir el router y no asumir que la página pública puede conectar directamente con una IP LAN.

Se corrigió la *topología del laboratorio CI*, NO la protección del navegador: en el runner efímero se resuelven `yori7v7.github.io`, `evil.example` y `ks.localhost` a `127.0.0.1`, con servicios HTTPS propios y certificados TLS temporales firmados por una CA efímera confiable para Chrome. Esto simula un origen seguro local y prueba el contrato de red, sin consultar Internet ni modificar DNS en la computadora del alumno ni el sitio real de GitHub Pages.

## Implementación

- **Backend experimental:** `scripts/servidor_55ku_https_ci.py` en `vehiculo_iot_api_dev`; arranca exclusivamente cuando `GITHUB_ACTIONS=true`, `KU_CI_LAB=isolated-loopback-only`, `APP_ENV=development` y todos los certificados / la SQLite privada están dentro del directorio temporal del runner. Escucha exclusivamente en `127.0.0.1:9443`. Sirve el contrato K-S con K-T idempotente requerido. No usa `app.main`, EC2, RDS, control WSS, GPIO ni API de movimiento.
- **Frontend experimental:** `assets/tests/ku_pages_https_ci.py` atiende solo el HTML mínimo de diagnóstico y el archivo real `assets/js/services/GuestAdmissionService.js` por HTTPS en `127.0.0.1:443`. **No es una copia de toda la página de producción**; el objetivo es probar su módulo de admisión desde el origen exacto de Pages.
- **CI:** `.github/workflows/experimental-frontend-ku.yml` descarga ambas ramas experimentales (sin tocar main), genera CA y certificados de vida corta, instala la CA en el trust store temporal del runner, inicia ambos servicios exclusivamente en loopback, hace `curl` con CA verificada / preflight OPTIONS y ejecuta Chrome con `ignoreHTTPSErrors=false` y `--no-proxy-server`. No usa `--ignore-certificate-errors` ni elude CORS/LNA. Termina los servidores y elimina la carpeta temporal.
- **Pruebas reales:** `assets/tests/ku-https-contract.spec.js` hace `fetch` del módulo web real por **HTTPS/TCP** a FastAPI, no intercepta ni simula las respuestas de API. Test 1: POST 201, POST repetido 200 con el mismo ticket; GET de estado; administrador no autenticado 401 / clave incorrecta 403 / clave válida 200; supervisión de 15 s; aprobación temporal 120 s virtual; revocación con `stop_fisico_confirmado=false`; confirmación de `canDrive=false`, sin rutas de movimiento, secreto no persistido ni en URL. Test 2: origen ajeno `evil.example` bloqueado por CORS.
- Nota de método: Playwright puede no emitir un evento `request` para un OPTIONS que Chrome ejecuta internamente; el preflight se comprueba también con `curl`. `Access-Control-Allow-Origin` no está expuesta al JavaScript de página por defecto, por eso no debe afirmarse que el código puede leerla.

## Evidencia

- **K-U Chrome HTTPS real:** [GitHub Actions 43388515487](https://github.com/yori7v7/control-iot-u4/actions/runs/43388515487), commit `f46a9cb8ac7376ee693fc69f61e84b9277a8aa99`: **2/2 E2E aprobadas** con HTTP y TLS reales dentro de CI.
- La misma revisión pasó el flujo aislado K-M de dos pestañas y vista móvil en [GitHub Actions 43388515518](https://github.com/yori7v7/control-iot-u4/actions/runs/43388515518).
- Backend K-T probado por separado: [GitHub Actions 43385380685](https://github.com/yori7v7/vehiculo_iot_api_dev/actions/runs/43385380685), **651 tests, 840 subtests**. K-U agrega interoperabilidad HTTPS real, **no** seguridad mecánica.

## Condiciones para cumplir la entrega final

El requisito es **un enlace público de GitHub Pages**. Para convertir estas pruebas en una funcionalidad entregable faltan:
1. Desplegar una API HTTPS de admisión desde Internet con certificado **públicamente confiable**, CORS limitado a Pages y rate limiting; no exponer directamente el servidor K-G de diagnóstico ni una IP privada.
2. Conectar la vista completa `index.html` (no solo el módulo real) al contrato remoto de manera que el usuario sin clave pueda solicitar turno automáticamente y el administrador aprobar/rechazar/revocar desde el mismo sitio.
3. Elegir una autoridad central, reconciliar persistencia K-R con K-C/WSS, revocación y epochs distribuidas entre EC2 y laptop; supervisión y cierre seguro al perder ESP o servidor.
4. Verificar integridad de despliegue, credenciales no filtradas y acceso real desde un dispositivo externo sin privilegios ni instalación.
5. **Antes de habilitar motor físico:** watchdog del microcontrolador, neutralidad mecánica y hardware interlock, gestión de STOP independiente de WiFi, y autorización de *todas* las rutas de mando (joystick, Swagger, DEMO). Un STOP virtual HMAC no demuestra neutralidad física.

**Por ahora AWS/RDS siguen apagados, la batería desconectada, las ramas main intactas y el PR experimental abierto en borrador.**

**No presentar K-U como enlace público remoto ya funcional:** solo acredita interoperabilidad del módulo de cliente y backend de pruebas bajo un origen simulado local y HTTP/TLS verificados en GitHub Actions.
