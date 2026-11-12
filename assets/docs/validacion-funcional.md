# Validación funcional REST/WSS

El propietario confirmó la operación del frontend publicado con AWS real. El cierre de la práctica entregada utilizó la versión [`5f341e6`](https://github.com/yori7v7/control-iot-u4/commit/5f341e66da2650e0f4fa6cdba3f7a21c41975611); la ampliación posterior de ocho direcciones está publicada en [`e692f9e`](https://github.com/yori7v7/control-iot-u4/commit/e692f9e579f43b96a32cc86dd1aef598cf52984e). [Aplicación en GitHub Pages](https://yori7v7.github.io/control-iot-u4/) · [Repositorio](https://github.com/yori7v7/control-iot-u4)

## Resultados finales

### Pruebas manuales desde GitHub Pages con AWS real

Resultados confirmados por el propietario al operar el vehículo 1 desde la aplicación publicada.

| Comprobación | Resultado confirmado |
| --- | --- |
| Conectividad | WSS, API y RDS se mostraron disponibles durante la prueba. |
| Comandos individuales y botones | Las solicitudes probadas recibieron HTTP 200. |
| Joystick | Se probaron las cuatro direcciones. |
| DETENER | La orden se validó mediante REST y WSS. |
| DEMO programada | Se ejecutó hasta su finalización. |
| Cancelación de DEMO | HTTP 200 y confirmación por WSS. |
| DETENER posterior a la cancelación | HTTP 200 y evento WSS compatible. |

La evidencia corresponde a respuestas REST y eventos del backend. La correlación con WSS es orientativa porque los canales no comparten un identificador de solicitud. Estas comprobaciones no acreditan movimiento ni detención física del carrito.

### Pruebas manuales del backend con Swagger y WSS

En una fase anterior, el propietario reportó comprobaciones directas del backend para movimientos, detención, ejecución completa de la DEMO y cancelación. Swagger se utilizó para REST y WSS para observar eventos. Esta evidencia corresponde al backend. La tabla anterior documenta por separado la validación desde el frontend publicado.

### Pruebas automatizadas y verificación publicada en simulación

En la revisión de la versión original entregada pasaron **24 pruebas de Node** con `npm test` y **13 pruebas de Chrome** con `npm run test:browser`. Se usaron simulación y tráfico interceptado. La verificación adicional desde GitHub Pages ejercitó en simulación la cancelación, DETENER, el retorno al estado neutral, la conservación del último resultado y el selector nativo, en Chrome para Windows y emulación Pixel 7. [Despliegue de la versión funcional](https://github.com/yori7v7/control-iot-u4/actions/runs/42418462260)

## Ampliación posterior: joystick de ocho direcciones (09/11/2026)

Esta sección es posterior a la entrega original de la práctica 4.1 y conserva sus resultados históricos. La actualización se publicó en [GitHub Pages](https://yori7v7.github.io/control-iot-u4/) mediante el commit [`e692f9e`](https://github.com/yori7v7/control-iot-u4/commit/e692f9e579f43b96a32cc86dd1aef598cf52984e) y el [despliegue exitoso](https://github.com/yori7v7/control-iot-u4/actions/runs/42723870488). El firmware de ocho direcciones se integró por separado en el [backend](https://github.com/yori7v7/vehiculo_iot_api_dev/pull/2), sin cambios en FastAPI, Stored Procedures o Caddy.

### Catálogo real y pruebas de frontend

El propietario registró en RDS dos nuevos comandos activos mediante `POST /vehiculos/1/comandos`: `AVANZAR_IZQUIERDA` (`id_comando: 16`, código `5`, Q0+Q2) y `RETROCEDER_DERECHA` (`id_comando: 17`, código `10`, Q1+Q3). El GET del catálogo devolvió 13 comandos activos, conservando los 11 originales.

Codex reportó **27/27 pruebas de Node** y **15/15 pruebas de Chrome**, realizadas con simulación o transporte interceptado. En simulación de la página publicada se comprobaron los ocho sectores, ambas diagonales nuevas, los botones y DETENER al soltar, regresar al centro, perder la captura y pulsar el botón. La prueba de navegador verificó que los `id_comando` salen del catálogo y no están codificados como IDs fijos. Estas pruebas automatizadas no contactaron AWS para efectuar movimientos.

### Evidencia real recibida desde AWS por el ESP8266

El usuario compartió un registro de Monitor Serie del ESP8266 (firmware actualizado en NodeMCU) que muestra `AWS WSS CONECTADO`, `[TLS] Certificado del servidor VALIDADO.` y `estado_actual` ignorado como orden física por seguridad.

El mismo registro contiene eventos `movimiento` recibidos por WSS para las **ocho direcciones**; específicamente, los dos movimientos nuevos aparecen con IDs y códigos correctos:

| Movimiento | ID recibido | Código | Confirmación visible del firmware |
| --- | ---: | ---: | --- |
| `AVANZAR_IZQUIERDA` | 16 | 5 | `[GRUA/AWS] AVANZAR + IZQUIERDA - codigo 5` |
| `RETROCEDER_DERECHA` | 17 | 10 | `[GRUA/AWS] RETROCEDER + DERECHA - codigo 10` |
| `DETENER` | 1 | 0 | `[GRUA/AWS] DETENIDO - codigo 0` |

En el registro hay 25 órdenes `movimiento` procesadas, cuatro correspondientes a DETENER; `AVANZAR_IZQUIERDA` figura dos veces y `RETROCEDER_DERECHA` tres. El último evento registrado es DETENER. La secuencia incluye otros cambios de dirección y muestra el procesamiento lógico correcto en el ESP8266.

**Alcance del registro inicial:** la evidencia de Monitor Serie acredita recepción por WSS, validación TLS y despacho en `GruaRC`, pero por sí sola no demostraba movimiento, giro o detención física. Tampoco demuestra que cada soltado del joystick provocara de manera única su evento WSS; el retorno a neutral y DETENER se verificaron además con pruebas automatizadas. La DEMO original no se modificó durante la ampliación.

### Confirmación física posterior del propietario (09/11/2026)

El propietario informó que **realizó todas las pruebas físicas del joystick de ocho direcciones**, incluidas `AVANZAR_IZQUIERDA` (código 5, ID 16) y `RETROCEDER_DERECHA` (código 10, ID 17), y que **los movimientos funcionaron correctamente tanto desde una laptop como desde un teléfono**. Con esta confirmación ya no se considera pendiente la comprobación funcional física de las dos diagonales nuevas. Se conserva separada la evidencia anterior del Monitor Serie, que documenta los comandos y eventos observados; la validación del movimiento físico se registra como **resultado reportado por el propietario**, sin agregar capturas, medidas, horas ni registros no proporcionados. No se realizaron nuevas órdenes AWS ni cambios de firmware durante esta actualización documental.

## Protocolo de referencia

La [auditoría de solo lectura](./validacion-real.md) confirmó el vehículo 1, su catálogo activo, la DEMO 1 y la suscripción WSS. Para repetir el protocolo con operaciones protegidas, solicita autorización y confirma que el microcontrolador esté físicamente desconectado, con el carrito y el transmisor apagados. Los pasos de esta sección describen las acciones y resultados esperados de una corrida de prueba.

### Preparación

1. Reserva una sesión exclusiva para el vehículo 1. Coordina que otros clientes no envíen órdenes ni ejecuten DEMO durante la ventana de prueba. Una trama `estado_actual` es un registro del backend y el campo `conectado` no sustituye la comprobación física del microcontrolador.
2. Instala las dependencias locales con `npm ci`. Comprueba la interfaz con `npm test` y `npm run test:browser`. Estas pruebas reproducen solicitudes y tramas locales sin contactar AWS.
3. Abre una consola separada con `node assets/tests/observe-wss.js --real`. Espera `socket_open` y `estado_actual` del vehículo 1. Este observador se conecta a `wss://100-30-4-62.nip.io/ws/vehiculos/1` sin autenticación ni tramas de aplicación salientes. Usa `node assets/tests/observe-wss.js --simulacion` para ensayarlo sin red. La sesión real se cierra al alcanzar diez minutos o perder la conexión. Si el observador se desconecta, marca el corte de evidencia y detén la progresión de la prueba.
4. Abre el panel en Chrome con `node assets/tests/open-functional-session.js` para comprobar la lectura. El cliente de prueba sirve los archivos locales en el origen auditado `https://yori7v7.github.io` y conecta directamente con AWS. Comprueba API y RDS **Disponible**, WSS **En línea**, vehículo 1, catálogo activo y la DEMO 1 con sus seis pasos. El resultado comprueba el navegador en ese origen con archivos locales. La publicación de GitHub Pages es una fase aparte.
5. Con las dos confirmaciones del usuario y las lecturas aprobadas, cierra la sesión de solo lectura y abre `node assets/tests/open-functional-session.js --habilitar-post`. En el aviso interactivo escribe `MICROCONTROLADOR DESCONECTADO Y POST AUTORIZADOS`. El modo protegido restringe las escrituras a las rutas y los IDs de este protocolo. Introduce manualmente la clave en **Habilitar control** y confirma el aviso de riesgo. La página guarda la clave en memoria y la envía en `X-API-Key` para los POST protegidos. Evita variables de entorno, argumentos, archivos, portapapeles compartido, capturas del diálogo, exportaciones HAR y trazas o registros de encabezados. Para la evidencia de red, conserva únicamente el método, la ruta, el cuerpo no secreto, el estado HTTP y los campos de respuesta indicados abajo.

El sondeo de RDS tiene un límite independiente de 9 s. La API conserva su límite de 6 s. Una respuesta válida de RDS puede llegar después de la de API y actualizar su indicador por separado. Un timeout se muestra como **Sin verificar** y el 503 reconocido de RDS como **No disponible**. Si los indicadores no están operativos antes del primer POST, reprograma la prueba.

### Orden previsto para una corrida autorizada

Base HTTPS `https://100-30-4-62.nip.io`. `M` representa `/vehiculos/1/movimientos` y `D` representa `/vehiculos/1/demos/1`. Usa los botones del panel para que el cambio de dirección sea reproducible. El joystick comparte el cliente REST y añade diagonales y una parada al soltar, que se prueban por separado en el banco local.

| Paso | Acción en el panel y solicitud | HTTP esperado | Evidencia WSS esperada |
| ---: | --- | --- | --- |
| 1 | **DETENER** · `POST M`, `{"id_comando":1}` | 200, `DETENER`, código 0. | `movimiento` del vehículo 1, ID 1, código 0. |
| 2 | **Avanzar** · `POST M`, `{"id_comando":2}` | 200, `AVANZAR`, código 1. | `movimiento`, ID 2, código 1. |
| 3 | **DETENER** · `POST M`, `{"id_comando":1}` | 200, código 0. | `movimiento`, ID 1, código 0. |
| 4 | **Avanzar** · `POST M`, `{"id_comando":2}` | 200, código 1. | `movimiento`, ID 2, código 1. |
| 5 | **Derecha** · `POST M`, `{"id_comando":6}` | 200, `DERECHA`, código 8. | `movimiento`, ID 6, código 8. |
| 6 | **DETENER** · `POST M`, `{"id_comando":1}` | 200, código 0. | `movimiento`, ID 1, código 0. |
| 7 | Selecciona **Demo programada** y pulsa **Ejecutar** una vez · `POST D/ejecutar`, sin cuerpo. | 202, `id_vehiculo: 1`, `id_demo: 1`, `estado: "iniciada"`. | `demo_inicio`, seguido de al menos un `demo_movimiento`. El primer paso del plan es `DETENER`, ID de paso 1, orden 1 y código 0. |
| 8 | Pulsa **Cancelar** en cuanto se observe el primer `demo_movimiento` · `POST D/cancelar`, sin cuerpo. | 200, `id_demo: 1`, `estado: "cancelada"`. | `demo_cancelada` del vehículo 1 y DEMO 1. |
| 9 | **DETENER** tras la cancelación · `POST M`, `{"id_comando":1}` | 200, código 0. | `movimiento`, ID 1, código 0. |

Pulsa cada botón una vez. Completa la comprobación HTTP/WSS de un paso manual antes de enviar la siguiente dirección. Tras una orden manual, ejecuta la parada prevista sin demorarla por capturas o por un evento ausente. Si la parada sustituye un paso pendiente de comprobación, conserva la secuencia observada y marca ese caso como incompleto. Los pasos 4 a 6 prueban un cambio efectivo de dirección antes de parar.

Para el paso 8, mantén **Cancelar** a la vista desde antes de iniciar la DEMO. No esperes a capturar la pantalla ni al final natural. La secuencia avanza del lado del servidor y puede terminar antes de que llegue una cancelación tardía. `demo_fin` o HTTP 404 por falta de una ejecución activa dejan la prueba de cancelación sin aprobar. Si la interfaz aún está resolviendo el inicio, puede encolar la cancelación hasta que termine esa petición. El paso 9 comprueba aparte la orden manual de parada. La cancelación de DEMO no implica un comando manual `DETENER`.

### Correlación y evidencia

- **Actividad de control.** En **SOLICITUD REST**, comprueba «Solicitud enviada. Esperando respuesta HTTP.» y luego «HTTP 200 aceptado.». En **EVENTO WSS**, comprueba el evento en su propia tarjeta. El evento puede aparecer mientras la solicitud sigue pendiente. La fase transitoria ya se puede reproducir con una respuesta demorada en la suite local. Si una respuesta real llega demasiado rápido para apreciarla visualmente, registra el orden del navegador y el observador por separado.
- **Movimiento individual.** Registra `id_vehiculo`, `id_comando`, `comando`, `codigo`, `origen: "API"` y `conectado` de ambas salidas. Compara literalmente `fecha_actualizacion` de HTTP con `timestamp` de WSS. Conserva la hora UTC de recepción por separado. El `id_evento` sirve para deduplicar WSS y no existe en la respuesta HTTP. Una coincidencia única indica compatibilidad con carácter orientativo. Considera las tramas observadas durante el envío y hasta 5 s tras aceptar HTTP. Un timestamp nulo, tramas perdidas, múltiples coincidencias o actividad de otro cliente dejan la correlación indeterminada.
- **DEMO.** Verifica la línea REST de inicio o cancelación (`#demo-http`), con solicitud enviada y luego HTTP 202 o 200 aceptado. La observación WSS tiene su propia línea de estado (`#demo-state`) y aparece en **EVENTO WSS**. Vincula ambos canales con `id_vehiculo: 1`, `id_demo: 1` y el orden de observación. En `demo_movimiento` añade `id_demo_movimiento`, `orden`, ID y código del comando. La API carece de un identificador de ejecución compartido entre canales, por lo que la atribución depende de la sesión exclusiva. Conserva el primer `demo_movimiento` y `demo_inicio` desde el observador, aunque el panel ya haya sustituido el último evento visible.
- **Registro.** Anota por paso hora, acción, método, ruta, ID, estado HTTP, evento, marca de tiempo, `id_evento` cuando exista y veredicto. Los veredictos son **aprobado**, **fallido** e **inconcluso**. Registra por separado el resultado HTTP y el del observador. Un error, una desconexión o una respuesta que llega fuera de la ventana de correlación no deben quedar como evento confirmado.

### Interrupción y cierre

Ante HTTP 401/403, conflicto 409, timeout, respuesta inesperada, pérdida de WSS o actividad de otra sesión, interrumpe las nuevas direcciones y ejecuciones. Tras una orden que pudo haberse aplicado, usa solo las acciones de contención incluidas en la autorización y que correspondan al estado observado. Para una DEMO propia activa intenta **Cancelar** y después **DETENER**. Si una DEMO ajena o no identificada está activa, coordina con su operador. Una ausencia de respuesta HTTP deja incierto el resultado y puede ocurrir después de que el backend reciba la solicitud. Evita reintentos automáticos y nuevas ejecuciones de DEMO para compensar evidencia faltante.

Cierra el control y el navegador de prueba una vez finalizada la última parada o resuelta la incidencia. Cierra el observador con Ctrl+C. Conserva únicamente el registro saneado y los resultados pendientes. La evidencia acredita órdenes y eventos del backend, sin prueba de movimiento físico.

## Antecedentes

### Ensayo local de preparación

Pasaron 21 pruebas de Node y 6 pruebas de Chrome con tráfico interceptado. Las pruebas de Chrome retuvieron deliberadamente las respuestas REST mientras entregaban los eventos WSS para comprobar que se vean ambos estados a la vez. La prueba del sondeo confirmó que RDS puede responder a los 7 s sin retrasar el resultado de API y que al vencer el plazo se registra **Sin verificar**. El observador completó su apertura, lectura de `estado_actual` y cierre en modo simulación.

### Corrida asistida de preparación

El 7 de noviembre de 2026 el propietario autorizó expresamente las operaciones del protocolo y confirmó como condición previa que el ESP8266 estaba físicamente desconectado de toda alimentación y que el carrito y el transmisor estaban apagados. La suscripción WSS se usó para observar publicaciones del backend.

En el preflight real, alrededor de las 14:22 de Ciudad de México, `GET /` devolvió HTTP 200 y `GET /health/database` devolvió HTTP 200 con `database: available`. El catálogo confirmó DETENER, AVANZAR y DERECHA con códigos 0, 1 y 8. La DEMO 1 tenía seis pasos. El WSS completó el handshake HTTP 101 y entregó `estado_actual` del vehículo 1.

La corrida asistida se detuvo antes del primer POST porque la herramienta de control de computadora no pudo verificar la URL activa de Chrome. Las comprobaciones manuales que el propietario reportó después se registran en **Resultados finales**.
