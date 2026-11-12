# Auditoría de contratos del backend

Revisión del 7 de noviembre de 2026. El frontend se integra con la API 0.7.0 del repositorio público `yori7v7/vehiculo_iot_api_dev`, revisada en el commit `2bc84f3b8282fd86a08093d7e6055b0ac67fd396`. El inventario de OpenAPI consta de 24 operaciones de negocio (9 GET, 7 POST, 4 PUT y 4 DELETE), además de las rutas automáticas de documentación. Los 21 procedimientos almacenados se reutilizan desde diferentes operaciones. La suscripción WSS se registra por separado. [Código auditado](https://github.com/yori7v7/vehiculo_iot_api_dev/tree/2bc84f3b8282fd86a08093d7e6055b0ac67fd396) · [Matriz HTTP](https://github.com/yori7v7/vehiculo_iot_api_dev/blob/2bc84f3b8282fd86a08093d7e6055b0ac67fd396/docs/auditoria_http.md)

## REST del módulo de control

La base HTTPS es `https://100-30-4-62.nip.io`. En la tabla, `V` representa `/vehiculos/{id_vehiculo}` y `D` representa `V/demos/{id_demo}`. El frontend está configurado para el vehículo `1`.

| Solicitud | Respuesta exitosa | Errores de OpenAPI |
| --- | --- | --- |
| `GET /` | 200 con `status: "ok"`, `service` y `environment` | 500 |
| `GET /health/database` | 200 con `status: "ok"` y `database: "available"` tras una transacción de lectura | 500, 503 |
| `GET /vehiculos` | 200 con lista de vehículos | 500, 503 |
| `GET V` | 200 con `id_vehiculo`, `nombre`, `modelo`, `descripcion`, `microcontrolador`, `fecha_registro` y `activo` | 404, 422, 500, 503 |
| `GET V/comandos` | 200 con lista de comandos, cada uno con `id_comando`, `id_vehiculo`, `nombre`, `codigo`, `descripcion` y `activo` | 404, 422, 500, 503 |
| `GET V/demos` | 200 con lista de DEMO, cada una con `id_demo`, `id_vehiculo`, `nombre`, `descripcion` y `activo` | 404, 422, 500, 503 |
| `GET D/movimientos` | 200 con lista ordenada que incluye `id_demo_movimiento`, `orden`, `id_comando`, `comando`, `codigo`, `duracion_ms` y `pausa_ms` | 404, 422, 500, 503 |
| `POST V/movimientos` | 200 con `resultado: "ok"`, `id_vehiculo`, `id_comando`, `comando`, `codigo`, `fecha_actualizacion`, `conectado` y `origen: "API"` | 401, 403, 404, 409, 422, 500, 503 |
| `POST D/ejecutar` | 202 con `id_vehiculo`, `id_demo` y `estado: "iniciada"` | 401, 403, 404, 409, 422, 500, 503 |
| `POST D/cancelar` | 200 con `id_vehiculo`, `id_demo` y `estado: "cancelada"` | 401, 403, 404, 422, 500, 503 |

Los tres POST requieren `X-API-Key`. El movimiento recibe un objeto con `id_comando` entero positivo como única propiedad. Los POST de DEMO se envían sin cuerpo. El código lógico `codigo` identifica la señal del comando y llega en las respuestas y eventos. Los errores de negocio usan `detail` textual y la validación HTTP 422 usa una lista en `detail`. Para cancelar, 404 indica que esa DEMO carece de una ejecución activa en el vehículo. [Routers](https://github.com/yori7v7/vehiculo_iot_api_dev/tree/2bc84f3b8282fd86a08093d7e6055b0ac67fd396/app/routers) · [Modelos](https://github.com/yori7v7/vehiculo_iot_api_dev/tree/2bc84f3b8282fd86a08093d7e6055b0ac67fd396/app/models) · [Autorización](https://github.com/yori7v7/vehiculo_iot_api_dev/blob/2bc84f3b8282fd86a08093d7e6055b0ac67fd396/app/security/api_key.py)

## WSS y coordinación

`wss://100-30-4-62.nip.io/ws/vehiculos/1` permite suscribirse sin clave. El servidor consulta el estado inicial antes de aceptar. La conexión abierta confirma la suscripción del navegador. El campo persistido `conectado` se conserva al aplicar movimientos y el socket tampoco lo actualiza. [Ruta WSS](https://github.com/yori7v7/vehiculo_iot_api_dev/blob/2bc84f3b8282fd86a08093d7e6055b0ac67fd396/app/websocket/router.py)

| `tipo_evento` | Datos emitidos |
| --- | --- |
| `estado_actual` | `id_vehiculo`, `comando`, `codigo`, `timestamp` y `estado`. Los cuatro últimos campos pueden ser nulos. |
| `movimiento` | `id_evento`, `id_vehiculo`, `id_comando`, `comando`, `codigo`, `timestamp`, `conectado` y `origen`. El `timestamp` copia `fecha_actualizacion` del resultado HTTP y puede ser nulo. |
| `demo_inicio`, `demo_movimiento`, `demo_fin`, `demo_cancelada`, `demo_error` | `id_evento`, `id_vehiculo`, `id_demo`, `nombre_demo`, `comando`, `codigo`, `timestamp`, `id_demo_movimiento`, `id_comando`, `orden`, `duracion_ms`, `pausa_ms`, `conectado` y `mensaje`. Los campos posteriores a `id_demo` admiten nulo. |

El UUID `id_evento` permite deduplicar publicaciones. El backend intenta publicar `movimiento` después del commit y antes de devolver HTTP 200, por lo que el evento puede llegar primero al navegador. Una coincidencia única de vehículo, comando, código y fecha no nula con la respuesta HTTP permite mostrar un evento compatible. Como la respuesta HTTP carece de UUID y pueden coincidir solicitudes ajenas, la compatibilidad tiene carácter informativo. [Eventos](https://github.com/yori7v7/vehiculo_iot_api_dev/tree/2bc84f3b8282fd86a08093d7e6055b0ac67fd396/app/websocket) · [Ruta de movimiento](https://github.com/yori7v7/vehiculo_iot_api_dev/blob/2bc84f3b8282fd86a08093d7e6055b0ac67fd396/app/routers/movement.py)

El 202 de DEMO indica que el backend preparó la secuencia y creó la tarea. El progreso procede de WSS, que publica por vehículo y DEMO sin un identificador compartido por ejecución. El backend reserva una DEMO por vehículo. La ruta de movimiento individual opera sin consultar esa reserva, por lo que el frontend coordina sus propias órdenes. Cancelar interrumpe las esperas y aguarda la salida de una transacción en curso. La cancelación lógica carece de una orden DETENER implícita. La secuencia se ejecuta en el backend y sus pasos se mantienen fuera del historial de movimientos individuales. [Gestor de ejecución](https://github.com/yori7v7/vehiculo_iot_api_dev/blob/2bc84f3b8282fd86a08093d7e6055b0ac67fd396/app/execution/manager.py) · [Servicio de DEMO](https://github.com/yori7v7/vehiculo_iot_api_dev/blob/2bc84f3b8282fd86a08093d7e6055b0ac67fd396/app/services/demo_execution.py)

## Lecturas de la práctica 4.2

La auditoría de la etapa 1 del 11 de noviembre de 2026 comprobó HTTP 200 desde el origen de GitHub Pages para `GET /`, `GET /health/database`, `GET V`, `GET V/estado` y `GET V/historial`. El handshake WSS respondió HTTP 101 y entregó `estado_actual`. El código de referencia del backend para esta etapa es `3792236`, que incluye el CORS para Pages. [Aplicación FastAPI revisada](https://github.com/yori7v7/vehiculo_iot_api_dev/blob/3792236cc4c07a3cbbd62c58d16221532e0c2f80/app/main.py#L61)

| Lectura | Contrato |
| --- | --- |
| `GET V/estado` | HTTP 200 con `null` o con `id_vehiculo`, `vehiculo`, `id_comando`, `comando`, `codigo`, `conectado` y `fecha_actualizacion`. El comando, su ID, el código y la fecha pueden ser nulos. La instantánea carece de origen. |
| `GET V/historial` | HTTP 200 con una lista de hasta diez filas. Cada fila tiene `id_historial`, `id_vehiculo`, `comando`, `codigo`, `fecha_hora` y `origen`. Comando, código y fecha pueden ser nulos. El servicio limita la respuesta a diez y conserva el orden del procedimiento por fecha y por ID descendentes. |

El cliente conserva el ID de historial como una cadena decimal exacta. Cuando el navegador no puede recuperar el literal JSON, acepta solo los IDs representables como enteros seguros. Las fechas sin zona se presentan con sus componentes originales. Las filas de la tabla se obtienen únicamente de REST. `movimiento` invalida estado e historial. `demo_movimiento` y los hitos terminales de DEMO invalidan estado. Una reconexión relee ambos recursos para recuperar publicaciones perdidas. La tabla conserva su origen de RDS incluso si una publicación WSS falla o si la modificación se realizó fuera del publicador. [Modelo de estado](https://github.com/yori7v7/vehiculo_iot_api_dev/blob/3792236cc4c07a3cbbd62c58d16221532e0c2f80/app/models/state.py) · [Modelo de historial](https://github.com/yori7v7/vehiculo_iot_api_dev/blob/3792236cc4c07a3cbbd62c58d16221532e0c2f80/app/models/history.py) · [Servicio de historial](https://github.com/yori7v7/vehiculo_iot_api_dev/blob/3792236cc4c07a3cbbd62c58d16221532e0c2f80/app/services/history.py)

## Verificación local del código de referencia

En una copia temporal con las dependencias del backend se ejecutaron las suites siguientes. La auditoría compone OpenAPI con los routers y bloquea el acceso a la configuración y la base de datos. Estas comprobaciones usan el código publicado y dobles de prueba.

| Suite de referencia | Resultado |
| --- | --- |
| `test_http_audit.py` | 10 de 10. Confirma 24 operaciones, el esquema `LocalApiKey`, modelos de error y la cobertura de 21 SP. |
| `test_demo_execution*.py` | 33 de 33. |
| `test_http_movement.py` y `test_security.py` | 8 de 8 y 10 de 10. |
| `test_ws_event_ids.py` | 3 de 3. |
| `test_websocket*.py` | 50 de 53. Tres aserciones del backend comparan objetos completos de movimiento y esperan una estructura sin el `id_evento` que el modelo vigente agrega. |

[Pruebas de referencia](https://github.com/yori7v7/vehiculo_iot_api_dev/tree/2bc84f3b8282fd86a08093d7e6055b0ac67fd396/tests)

## Comprobaciones iniciales contra AWS

| Comprobación de solo lectura | Resultado desde el entorno de trabajo |
| --- | --- |
| HTTPS `GET /`, `GET /health/database` y `GET /openapi.json` | `curl` 28 al intentar establecer la conexión, alrededor de cinco segundos por solicitud. |
| HTTPS `OPTIONS /vehiculos/1/movimientos` con origen `https://yori7v7.github.io` y encabezados `Content-Type, X-API-Key` solicitados para POST | `curl` 28 durante la conexión. El 200 previo se conserva como antecedente comunicado por el usuario. |
| HTTPS Upgrade a `/ws/vehiculos/1` con el origen de GitHub Pages | `curl` 28 durante la conexión, sin handshake observado. |

Durante esta fase inicial no se pudo contrastar el despliegue. La [validación real posterior](./validacion-real.md) confirmó el [OpenAPI publicado](https://100-30-4-62.nip.io/openapi.json), el catálogo, la salud de RDS, el handshake WSS y CORS de lectura para el origen previsto. El código revisado de `app/main.py` y el `Caddyfile` versionado carecen de una política CORS explícita. Los encabezados documentados en la validación posterior son los observados en la instancia desplegada. [Aplicación FastAPI](https://github.com/yori7v7/vehiculo_iot_api_dev/blob/2bc84f3b8282fd86a08093d7e6055b0ac67fd396/app/main.py) · [Caddyfile versionado](https://github.com/yori7v7/vehiculo_iot_api_dev/blob/2bc84f3b8282fd86a08093d7e6055b0ac67fd396/deploy/windows/Caddyfile)
