# Práctica 4.2: integración definitiva local

Fecha: 16 de noviembre de 2026.

Repositorio de escritura: `C:\Users\alf13\Downloads\control-iot-u4-publicacion`.
Rama: `restauracion/4-2-publicacion-main`.
HEAD conservado: `61d79c3e1f1990b2785eae70133fffb8fa5e4310`.
Referencia consultada exclusivamente en lectura: `control-iot-u4-restauracion`.
URL pública conservada: https://yori7v7.github.io/control-iot-u4/

## Resultado

CONTROL y MONITOREO abren directamente en la misma interfaz, sin turnos, aprobaciones, ventanas de sesión, roles de usuario, formularios ni ingreso manual de claves. Se retiraron los clientes de turnos, sus imports, eventos, paneles y estilos exclusivos. Se mantuvieron clases POO y módulos ES6.

La configuración es idéntica, byte por byte, al `config.js` de la referencia. La clave de operador sigue configurada y se aplica automáticamente mediante `X-API-Key` exclusivamente a los POST de movimientos, ejecutar DEMO y cancelar DEMO. GET y WSS no llevan la clave. No se consultaron claves administrativas. No se muestra ningún valor de credencial en este informe.

Se conservan las ocho direcciones, joystick, teclado, DETENER al soltar y su prioridad, luces, velocidad, claxon, DEMO programada, cancelación, historial y los indicadores independientes de WSS, API y RDS. DEMO_ORIGINAL queda bloqueada incluso cuando el catálogo remoto la marca activa; su botón existente permanece deshabilitado.

## Archivos modificados

| Archivo | Cambio |
| --- | --- |
| `index.html` | Retira sesión, formulario y panel de turnos; conserva navegación y estado DEMO de monitoreo. |
| `assets/js/app.js` | Integra control directo y conserva el monitoreo compartido y los bloqueos operativos del catálogo. |
| `assets/js/config.js` | Copia exacta de la configuración funcional de referencia, sin modificar su clave. |
| `assets/js/services/ApiClient.js` | Aplica automáticamente la clave de operador a los POST protegidos. |
| `assets/js/controllers/CommandService.js` | Excluye DEMO_ORIGINAL del catálogo operativo sin cambiar DETENER ni contratos. |
| `assets/js/ui/DashboardView.js` | Presenta control directo sin roles, formularios ni turnos. |
| `assets/css/app.css` | Elimina únicamente 38 líneas de estilos exclusivos de turnos y diálogo; mantiene las reglas responsive actuales. |
| `assets/tests/control.test.js` | Añade regresión del bloqueo de DEMO_ORIGINAL activa. |
| `assets/tests/services.test.js` | Comprueba clave automática, ausencia de credenciales en GET y contratos con claves ficticias. |
| `assets/tests/dashboard.spec.js` | Adapta cobertura al control directo, recarga, ausencia de formularios y bloqueo de DEMO_ORIGINAL. |
| `assets/tests/monitoring.spec.js` | Retira fixture de turnos y recurso de sesión; espera DETENER disponible al volver a CONTROL. |
| `assets/tests/monitoring.test.js` | Inyecta una clave ficticia en el transporte de prueba. |
| `assets/tests/responsive.spec.js` | Sustituye pruebas de turnos y diálogo por acceso directo y cambios de tamaño; conserva la matriz de controles. |
| `assets/tests/open-functional-session.js` | Actualiza el mensaje obsoleto de ingreso manual de clave; no se ejecutó este auxiliar de pruebas reales. |
| `README.md` | Documenta control directo, validación local y ausencia de publicación. |
| `assets/docs/control-publico.md` | Sustituye la propuesta obsoleta por el flujo vigente. |
| `assets/docs/validacion-funcional.md` | Actualiza el paso obsoleto de ingreso manual. |
| `assets/docs/integracion-publicacion-4-2.md` | Este informe de entrega. |

Archivos eliminados:

- `assets/js/services/PublicControlClient.js`
- `assets/js/services/PublicControlService.js`
- `assets/js/ui/sessionViewport.js`
- `assets/tests/public-control.test.js`
- `assets/tests/public-control.spec.js`

Se conservaron intactos `assets/js/controllers/MonitoringController.js`, `assets/js/ui/MonitoringView.js`, `assets/tests/control-viewport-regression.spec.js` y `.github/workflows/control-height-regression.yml`. También permanecen sin cambios los controladores de joystick y DEMO, los modelos y los contratos de red.

## Validación

| Comprobación | Aprobadas | Fallidas |
| --- | ---: | ---: |
| `npm.cmd test` | 44 | 0 |
| Playwright con Chrome | 83 | 0 |
| Total | 127 | 0 |

Chrome valida CONTROL y MONITOREO en las 18 resoluciones existentes: 320×568, 360×640, 375×667, 390×844, 414×896, 430×932, 568×320, 640×360, 667×375, 740×360, 844×390, 896×414, 932×430, 768×1024, 1024×768, 1280×720, 1366×768 y 1920×1080. Pasaron los controles de scroll, recorte, superposición, áreas táctiles, áreas seguras, rotación y movimiento reducido. La suite mantiene las verificaciones automáticas de accesibilidad WCAG 2.1 AA.

Las ocho regresiones específicas de altura de CONTROL también pasaron: 1366×680, 1366×768, 1280×650 y 1440×700, cada una desconectada y en simulación. No se detectaron controles recortados ni scroll en esos casos.

La ejecución estándar de Playwright completó sus 83 casos pero quedó esperando al cerrar su servidor auxiliar en Windows. Para obtener una salida limpia se inició `node assets/tests/serve.js` por separado y se ejecutó:

```powershell
npm.cmd run test:browser -- --config .cache/validation/playwright.config.js --workers=2
```

La configuración temporal importa la configuración original y solo omite el servidor automático y ubica resultados bajo `.cache/validation/`. Resultado final: `83 passed (1.1m)`, código de salida 0. El servidor local se detuvo al terminar. No se modificó la configuración Playwright versionada ni el workflow.

Las suites usan transporte simulado o tráfico interceptado; no enviaron POST reales ni controlaron hardware. Se verificaron 31 imports locales sin rutas rotas, `git diff --check` sin errores y cero copias de la clave fuera de `assets/js/config.js` en fuentes y artefactos inspeccionados.

## Límites y estado final

No quedan incompatibilidades funcionales detectadas en las pruebas locales. La operación física y los POST reales no se probaron por instrucción del usuario. Los tamaños extremos fuera de la matriz conservan la posibilidad de desplazamiento accesible prevista por el main, incluida la prueba existente de MONITOREO con altura extrema. Chrome emula móvil; no sustituye una comprobación en dispositivo físico.

La espera al cerrar el servidor automático es una limitación del ejecutor en este entorno Windows; se resolvió para esta validación usando un servidor separado. Las dependencias y artefactos locales están en directorios ignorados por Git.

No hubo commit, push, merge, reset, despliegue ni publicación. HEAD e historial Git permanecen intactos. No se modificaron backend, AWS, RDS, firmware ni ESP8266. La referencia permaneció de solo lectura. El trabajo se detuvo tras la integración y validación local.
