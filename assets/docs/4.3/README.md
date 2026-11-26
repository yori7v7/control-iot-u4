# Guía del frontend 4.3

[Portada y recorrido por rol](../../../README.md) · [Portal publicado](https://yori7v7.github.io/control-iot-u4/) · [Swagger](https://100-30-4-62.nip.io/docs)

## Operación y evidencias

| Alcance | Comportamiento de la entrega |
| --- | --- |
| Administración | Clientes, modelos y capacidades, inventario, asignaciones, historial de titularidad, DEMOS de fábrica, reservas y auditoría. |
| Comprador ID 2 | Control y monitoreo de la unidad física 1 (`RC-IOT-001`, modelo HJ2025-1D). Ocho direcciones, DETENER, LUCES, VELOCIDAD, CLAXON, DEMO programada y DEMO original. El comprador gestiona sus DEMOS privadas. |
| Invitado | La sesión exclusiva de 120 segundos usa la unidad lógica 4 (`EXH-LOGICA-43`). El catálogo actual acepta DETENER (0) y AVANZAR (1). La expiración, el cierre y la revocación finalizan el acceso. |
| DEMO programada | FastAPI ejecuta los pasos de una DEMO autorizada. El panel muestra la solicitud HTTP y el avance WSS por separado. **Cancelar** solicita la cancelación de la secuencia. |
| DEMO original | `DEMO_ORIGINAL` (64) inicia la secuencia autónoma del mando de la unidad física. Su disponibilidad depende del catálogo y del enlace de despacho compatible. **Claxon** (128) es la interrupción física comprobada. **Detener** (0) libera las salidas del ESP8266 y por sí solo no garantiza interrumpir la secuencia autónoma. |

En **Monitoreo**, el estado confirmado por HTTPS y el evento recibido por WSS se presentan por separado. El comprador puede consultar hasta diez movimientos individuales de su titularidad. El invitado recibe eventos de su sesión y las consultas REST devuelven estado nulo e historial vacío. El indicador WSS describe el navegador y la vista. El estado de despacho informa sobre el enlace de dispositivo. La unidad 4 carece de ESP8266. Una aceptación HTTP o un evento WSS de esa unidad acredita actividad lógica.

El backend delimita el catálogo, las DEMOS y los datos de monitoreo por sesión y unidad. El cliente guarda la sesión en memoria y solicita un ticket nuevo por conexión o reconexión WSS. La expiración o la revocación invalida el acceso. La [configuración del frontend](../../js/config.js) contiene el endpoint público y los tiempos de espera.

En **Administración → Modelos y capacidades**, las casillas de comprador se guardan con **Actualizar modelo**. Los permisos del comprador se aplican a las unidades vendidas del modelo y las casillas de invitado conservan su alcance. El portal lee el modelo guardado después de actualizar y muestra la respuesta de la API cuando el guardado es rechazado. Una consola abierta vuelve a consultar el catálogo cuando detecta un cambio. DETENER permanece disponible y las diagonales dependen de sus dos direcciones cardinales.

Una DEMO programada requiere que sus pasos sigan autorizados. La DEMO original sólo está disponible con el catálogo de referencia completo y el despacho compatible. Si el servidor registra un arranque pendiente, solicita CLAXON antes de guardar una revocación.

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

El cierre local aprobó 44 pruebas de Node, 95 de Chrome con simulación o tráfico interceptado y, en una corrida separada, la integración del invitado con FastAPI y MySQL aislados. La confirmación del propietario incluye PC y teléfono en vertical y horizontal, la actuación del comprador y el uso de Claxon para interrumpir la DEMO original. Las pruebas físicas y colaborativas con usuarios reales, la pérdida de enlace con la grúa y la identidad binaria del firmware instalado quedaron fuera de la verificación local.

## Publicación e historial

GitHub Pages sirve los recursos relativos de la aplicación desde `main`. El portal 4.3 se identificó en `421b65a`. Un cambio documental en GitHub puede disparar la compilación de Pages aunque el contenido de la aplicación se conserve. La API FastAPI y el firmware tienen ciclos de despliegue separados.

Los informes de [`assets/docs/`](../) conservan los contratos, pruebas y diseño de 4.1/4.2, incluido el acceso directo histórico con API key. Para el funcionamiento publicado de 4.3, usa esta guía y el Swagger 4.3.
