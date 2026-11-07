# Auditoría real de solo lectura · Práctica 4.1

Validación del 7 de noviembre de 2026, alrededor de las 14:06 en Ciudad de México. Objetivo `https://100-30-4-62.nip.io`, vehículo `1`. Se revisaron primero los [contratos de referencia](./contratos.md) y las [pruebas locales](./pruebas.md).

Se realizaron GET públicos, una consulta OPTIONS y una suscripción WSS sin tramas de aplicación salientes. La auditoría se realizó sin credenciales y con el microcontrolador fuera de la prueba. Se mantuvieron la infraestructura y el código de la aplicación tal como estaban.

## HTTPS y RDS

El dominio resolvió a `100.30.4.62`. La conexión directa a 443 negoció TLS 1.3 con un certificado válido para `100-30-4-62.nip.io`. Las respuestas HTTP identificaron a `uvicorn` y el proxy `1.1 Caddy`.

| Solicitud real | HTTP | Respuesta observada | Resultado |
| --- | --- | --- | --- |
| `GET /` | 200 | `{"status":"ok","service":"Vehículo IoT API","environment":"production"}` | Salud de API aprobada. |
| `GET /health/database` | 200 | `{"status":"ok","database":"available"}` | Comprobación independiente de RDS aprobada. |
| `GET /vehiculos/1` | 200 | ID `1`, **Mini RC Forklift IoT**, modelo `HJ2025-1D`, `activo: true`, microcontrolador registrado `NodeMCU ESP8266 ESP-12E`. | El modelo `Vehicle` aceptó la respuesta. |
| `GET /vehiculos/1/comandos` | 200 | 11 comandos activos para el vehículo 1. | `Command.forVehicle` aceptó el catálogo. |
| `GET /vehiculos/1/demos` | 200 | Una DEMO activa, ID `1`, **Demo programada**. | `Demo.forVehicle` aceptó el catálogo. |
| `GET /vehiculos/1/demos/1/movimientos` | 200 | Seis pasos ordenados. | El cliente REST validó el plan y los pasos coincidieron con el catálogo. |
| `GET /openapi.json` | 200 | OpenAPI `3.1.0`, API `0.7.0`, 24 operaciones (9 GET, 7 POST, 4 PUT y 4 DELETE). | El esquema publicado coincide con el inventario y los contratos de control auditados. |

En la primera tanda, las dos sondas de salud recibieron los encabezados en 4,09 s y 4,94 s desde Node. Los tiempos incluyen la apertura de las conexiones y son una observación puntual. El navegador también completó las sondas con el timeout de 6 s vigente durante la auditoría. El timeout documentado en la fase anterior no se reprodujo. La [preparación de la fase funcional](./validacion-funcional.md) ajusta el plazo de RDS a 9 s.

### Catálogo del vehículo

| ID REST | Nombre observado | Código | Uso en el frontend |
| ---: | --- | ---: | --- |
| 1 | `DETENER` | 0 | Parada prioritaria y retorno a neutral. |
| 2 | `AVANZAR` | 1 | Joystick y botón. |
| 3 | `RETROCEDER` | 2 | Joystick y botón. |
| 4 | `IZQUIERDA` | 4 | Joystick y botón. |
| 5 | `RETROCEDER_IZQUIERDA` | 6 | Diagonal de joystick y botón adicional. |
| 6 | `DERECHA` | 8 | Joystick y botón. |
| 7 | `AVANZAR_DERECHA` | 9 | Diagonal de joystick y botón adicional. |
| 8 | `LUCES` | 16 | Botón adicional. |
| 9 | `VELOCIDAD` | 32 | Botón adicional. |
| 10 | `DEMO_ORIGINAL` | 64 | Comando individual del catálogo. |
| 11 | `CLAXON` | 128 | Botón adicional. |

Los 11 registros estaban activos y sus IDs, nombres y códigos coincidieron con la referencia de la práctica. El frontend selecciona el ID devuelto por el catálogo a partir del nombre normalizado. `DETENER` cumple la condición de código neutral `0`.

### DEMO programada, ID 1

| Orden | ID del paso | ID del comando | Comando | Código | Duración (ms) | Pausa (ms) |
| ---: | ---: | ---: | --- | ---: | ---: | ---: |
| 1 | 1 | 1 | `DETENER` | 0 | 0 | 700 |
| 2 | 2 | 2 | `AVANZAR` | 1 | 3000 | 700 |
| 3 | 3 | 7 | `AVANZAR_DERECHA` | 9 | 5000 | 1000 |
| 4 | 4 | 5 | `RETROCEDER_IZQUIERDA` | 6 | 5000 | 700 |
| 5 | 5 | 11 | `CLAXON` | 128 | 500 | 0 |
| 6 | 6 | 1 | `DETENER` | 0 | 0 | 0 |

El orden fue creciente, los IDs de paso fueron únicos y cada paso coincidió con el nombre y el código de un comando activo. La descripción almacenada hace referencia a la secuencia del ESP8266. El panel consulta este plan desde FastAPI y su operación de ejecución se refiere a la DEMO del backend. El comando individual `DEMO_ORIGINAL` es un elemento distinto.

## Suscripción WSS

El cliente de la aplicación abrió de forma independiente `wss://100-30-4-62.nip.io/ws/vehiculos/1` desde Node. Se observó apertura y una trama `estado_actual`, aceptada por el validador del frontend. Chrome confirmó por separado el handshake **HTTP 101 Switching Protocols** para el origen previsto.

```json
{
  "tipo_evento": "estado_actual",
  "id_vehiculo": 1,
  "comando": "DETENER",
  "codigo": 0,
  "timestamp": "2026-11-04T18:32:43",
  "estado": {
    "id_vehiculo": 1,
    "vehiculo": "Mini RC Forklift IoT",
    "id_comando": 1,
    "comando": "DETENER",
    "codigo": 0,
    "conectado": true,
    "fecha_actualizacion": "2026-11-04T18:32:43"
  }
}
```

La marca de tiempo es el valor almacenado que reportó el servidor, sin zona horaria en el JSON. El `conectado: true` pertenece a ese registro del 4 de noviembre. El indicador WSS del panel se basa en la conexión actual del navegador y el estado físico del vehículo queda fuera de esta auditoría.

## CORS y comprobación en navegador

- **HTTP directo.** Los siete GET de la primera tanda incluyeron `Origin: https://yori7v7.github.io`. Todos devolvieron `Access-Control-Allow-Origin: https://yori7v7.github.io` y `Vary: Origin`.
- **Consulta OPTIONS.** `OPTIONS /vehiculos/1/movimientos` devolvió 200 y cuerpo `OK`. La consulta anunció `POST` en el encabezado de método solicitado y `content-type,x-api-key` como nombres de encabezados. AWS anunció `GET, POST, OPTIONS`, permitió `Content-Type` y `X-API-Key` para ese origen, y reportó un tiempo de caché de 600 s. La consulta fue exclusivamente OPTIONS.
- **Chrome.** Playwright sirvió los archivos locales desde el origen `https://yori7v7.github.io` al interceptar el documento y sus recursos. Las seis consultas GET de la aplicación llegaron realmente a AWS desde Chrome y el navegador permitió leer las respuestas por CORS. WSS llegó también directamente a AWS y recibió el 101. Así se verificó el comportamiento del navegador para ese origen con los archivos locales. La entrega del documento por el hosting de GitHub Pages queda pendiente.
- **Resultado visible.** El panel mostró WSS **En línea**, API **Disponible** y Amazon RDS **Disponible**. Mostró la identidad del vehículo, diez botones de comando más DETENER, el estado inicial y los seis movimientos al seleccionar **Demo programada**. Los controles protegidos permanecieron bloqueados sin clave. La sesión de prueba terminó sin errores de consola o ejecución.

## Discrepancias y preparación para publicación

Las respuestas reales de lectura fueron compatibles con la implementación y no requirieron cambios de código. El OpenAPI desplegado también declaró `LocalApiKey` en los tres POST de control. Declaró `id_comando` como único campo obligatorio del cuerpo de movimiento, entero positivo, y las respuestas de éxito 200 para movimiento, 202 para ejecutar DEMO y 200 para cancelar. Esas declaraciones se comprobaron en el esquema, mientras que su ejecución queda pendiente.

Se repitieron las suites locales de regresión. Pasaron **20 de 20** pruebas con `npm test` y **6 de 6** con `npm run test:browser`. Estos resultados corresponden a simulación y tráfico interceptado, aparte de la sesión real de Chrome descrita arriba.

| Comprobación pendiente o riesgo | Estado |
| --- | --- |
| URL pública de GitHub Pages | El frontend está preparado para publicar cuando se autorice. Falta abrir el sitio entregado por Pages y verificar sus recursos y la integración de lectura desde la URL efectiva. |
| Autenticación y comandos protegidos | Falta probar la aceptación de la clave y los POST de movimiento, inicio y cancelación. Requieren autorización separada. |
| Eventos de operación | Se observó `estado_actual`. Queda pendiente observar `movimiento` y eventos de una ejecución DEMO real. HTTP y WSS carecen de un identificador de correlación compartido. |
| Disponibilidad y latencia | Las sondas se recuperaron respecto a la fase anterior. Los tiempos observados son puntuales y el tiempo disponible antes del timeout puede variar. |
| Estado del equipo | El estado persistido por el backend acredita un registro. La conexión física del equipo y sus movimientos quedan fuera del alcance. |

La [fase funcional](./validacion-funcional.md) prepara pruebas protegidas con los archivos locales bajo el origen auditado. La publicación y la comprobación de la página entregada por GitHub Pages constituyen una fase separada.
