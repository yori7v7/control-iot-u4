# Guía del frontend 4.3

[Portada y recorrido por rol](../../../README.md) · [Portal publicado](https://yori7v7.github.io/control-iot-u4/) · [Guía técnica del backend](https://github.com/yori7v7/vehiculo_iot_api_dev/blob/main/docs/4.3/README.md) · [Swagger](https://100-30-4-62.nip.io/docs)

## Operación y evidencias

| Alcance | Comportamiento de la entrega |
| --- | --- |
| Administración | Clientes, modelos y capacidades, inventario, asignaciones, historial de titularidad, DEMOS de fábrica, reservas y auditoría. |
| Comprador ID 2 | Control y monitoreo de la unidad física 1 (`RC-IOT-001`, modelo HJ2025-1D) según el catálogo efectivo. El comprador accede a la unidad vendida de su titularidad y gestiona sus DEMOS privadas. |
| Invitado | La sesión exclusiva de 120 segundos usa la unidad lógica 4 (`EXH-LOGICA-43`). El catálogo actual acepta DETENER (0) y AVANZAR (1). La expiración, el cierre y la revocación finalizan el acceso. |
| DEMO programada | Las DEMOS privadas se delimitan por titularidad y las de fábrica activas se ofrecen por modelo. FastAPI verifica los permisos al iniciar y antes de aplicar cada paso. El panel muestra la solicitud HTTP y el avance WSS por separado. **Cancelar** solicita la cancelación de la secuencia. |
| DEMO original | `DEMO_ORIGINAL` (64) inicia la secuencia autónoma del mando de la unidad física. Requiere el catálogo de referencia completo y un enlace de despacho compatible. **Claxon** (128) interrumpió la secuencia en una comprobación física anterior. **Detener** (0) libera las salidas del ESP8266. La secuencia autónoma puede continuar. |

En **Monitoreo**, el estado confirmado por HTTPS y el evento recibido por WSS se presentan por separado. El comprador puede consultar hasta diez movimientos individuales de su titularidad. El invitado recibe eventos de su sesión y las consultas REST devuelven estado nulo e historial vacío. WSS conectado indica el canal del navegador. **DESPACHO SIN ACK** indica que hay un enlace disponible al dispositivo, sin acuse de actuación. HTTP 200 acredita aceptación o persistencia según la operación. La confirmación mecánica requiere observación física. La unidad 4 carece de ESP8266 y su actividad es lógica.

El backend delimita el catálogo, las DEMOS y los datos de monitoreo por sesión y unidad. El cliente guarda la sesión en memoria y solicita un ticket nuevo por conexión o reconexión WSS. La expiración o la revocación invalida el acceso. La [configuración del frontend](../../js/config.js) contiene el endpoint público y los tiempos de espera.

## Permisos y actualización de una sesión abierta

En **Administración → Modelos y capacidades**, las casillas **Comandos del comprador por modelo** guardan `habilitada` con **Actualizar modelo**. Alcanzan a todas las unidades vendidas del modelo. La titularidad de la cuenta determina cuáles de esas unidades puede usar cada comprador.

- **Pertenencia al catálogo** conserva el código y el nombre registrados. Quitar una capacidad del catálogo requiere que el modelo carezca de unidades y DEMOS referenciadas.
- **Habilitación operativa** activa o revoca una capacidad del comprador conservando su referencia. La migración 004 incorporó este indicador en MySQL.
- **Invitado** usa un indicador separado para los comandos de la exhibición lógica reservada.

El portal vuelve a leer el modelo guardado y muestra la respuesta de la API si el cambio se rechaza. La consola abierta consulta periódicamente el despacho. Cuando cambia `revision_comandos`, actualiza el catálogo y los datos de DEMO sin recargar la página. FastAPI comprueba el permiso vigente de cada orden. DETENER permanece habilitado en el modelo. RETROCEDER determina también la disponibilidad de las dos diagonales de retroceso, que requieren sus respectivas cardinales y su propia habilitación.

La revocación bloquea órdenes posteriores. El dispositivo sigue gobernando las órdenes ya recibidas y el tiempo de un paso ya iniciado. Si un cambio invalida pasos de una DEMO programada, el servidor bloquea el siguiente paso. Si hay un arranque pendiente de la DEMO original, el servidor exige CLAXON antes de aceptar una revocación del modelo que afecte la secuencia.

## Pruebas locales

Ejecuta estos comandos en la raíz con Node.js 22 o posterior y Google Chrome instalado.

```powershell
npm.cmd ci
npm.cmd test
$env:IOT43_LIVE = '0'
npm.cmd run test:browser -- --retries=0
```

Las suites cubren modelos, controladores, DEMOS, monitoreo, portal por rol, indicadores y diseño adaptable con simulación y tráfico de prueba. Para explorar el laboratorio 4.2 con respuestas en memoria, usa `npm.cmd start` y abre [la simulación](http://127.0.0.1:4173/control-iot-u4/?modo=simulacion).

En la [ruta local 4.3](http://127.0.0.1:4173/control-iot-u4/) la API apunta a `http://127.0.0.1:8043`. Para la integración opcional, levanta el MySQL aislado y `python -m scripts.local43` del backend, prepara una unidad de exhibición de prueba y ejecuta `$env:IOT43_LIVE = '1'` seguido de `npm.cmd run test:browser -- assets/tests/platform43-live.spec.js`.

## Resultados de la corrección

| Tipo de evidencia | Resultado reportado |
| --- | --- |
| Pruebas automatizadas | 44 de Node, 98 de Chrome y 2 de integración Chrome, FastAPI y MySQL aprobadas en sus respectivas ejecuciones. La revisión posterior aprobó 3 pruebas focalizadas de Chrome. |
| Verificación productiva | GitHub Pages sirvió los JavaScript de la corrección. La revocación de RETROCEDER se comprobó con la sesión del comprador abierta y sin recargar. |
| Prueba física reportada por el operador | Funcionamiento satisfactorio con el despacho rehabilitado. RETROCEDER quedó bloqueado tras revocarlo y volvió a mover la grúa tras rehabilitarlo. La prueba individual se limitó a RETROCEDER. |

Las suites pueden compartir cobertura. [La prueba de navegador](../../tests/platform43.spec.js) cubre el guardado, el rechazo visible, la actualización de la sesión y la rehabilitación del catálogo mediante tráfico interceptado. El rechazo de una petición HTTP directa con un comando prohibido se comprobó en el laboratorio del backend. La [guía técnica del backend](https://github.com/yori7v7/vehiculo_iot_api_dev/blob/main/docs/4.3/README.md) reúne los resultados completos y su alcance.

El registro anterior a esta corrección incluyó 44 pruebas de Node, 95 de Chrome y una integración separada del invitado. El propietario había confirmado la interfaz en PC y teléfono en ambas orientaciones, el control físico y el uso de Claxon para interrumpir la DEMO original. La pérdida de enlace y la identidad binaria del firmware quedan fuera de la verificación local. El firmware, el hardware, la titularidad, el comprador, las unidades y las reservas se conservaron.

## Publicación e historial

GitHub Pages sirve los recursos relativos de la aplicación desde `main`. La entrega inicial documentó el portal en `421b65a`. La versión corregida se publicó en `2345874d9eb213fe4270a52313f00a67b1f7102e`. Las guías en `assets/docs/4.3` y las pruebas en `assets/tests/` se consultan en el repositorio. La configuración de Jekyll las excluye del sitio servido. Un cambio documental puede iniciar una compilación de Pages con los mismos archivos funcionales. La API FastAPI y el firmware tienen ciclos de despliegue separados.

Los informes de [`assets/docs/`](../) conservan los contratos, pruebas y diseño de 4.1/4.2, incluido el acceso directo histórico con API key. Para el funcionamiento publicado de 4.3, usa esta guía y el Swagger 4.3.
