# Protocolo de validación funcional REST/WSS

**Protocolo preparado. Las operaciones protegidas quedan pendientes.** La [auditoría de solo lectura](./validacion-real.md) confirmó el vehículo 1, su catálogo activo, la DEMO 1 y la suscripción WSS. La confirmación explícita del usuario de que el microcontrolador está físicamente desconectado, junto con su autorización para las operaciones protegidas de este protocolo, es el punto de partida de la fase real.

## Preparación

1. Reserva una sesión exclusiva para el vehículo 1. Coordina que otros clientes no envíen órdenes ni ejecuten DEMO durante la ventana de prueba. Una trama `estado_actual` es un registro del backend y el campo `conectado` no sustituye la comprobación física del microcontrolador.
2. Instala las dependencias locales con `npm ci`. Comprueba la interfaz con `npm test` y `npm run test:browser`. Estas pruebas reproducen solicitudes y tramas locales sin contactar AWS.
3. Abre una consola separada con `node tests/observe-wss.js --real`. Espera `socket_open` y `estado_actual` del vehículo 1. Este observador se conecta a `wss://100-30-4-62.nip.io/ws/vehiculos/1` sin autenticación ni tramas de aplicación salientes. Usa `node tests/observe-wss.js --simulacion` para ensayarlo sin red. La sesión real se cierra al alcanzar diez minutos o perder la conexión. Si el observador se desconecta, marca el corte de evidencia y detén la progresión de la prueba.
4. Abre el panel en Chrome con `node tests/open-functional-session.js` para comprobar la lectura. El cliente de prueba sirve los archivos locales en el origen auditado `https://yori7v7.github.io` y conecta directamente con AWS. Comprueba API y RDS **Disponible**, WSS **En línea**, vehículo 1, catálogo activo y la DEMO 1 con sus seis pasos. El resultado comprueba el navegador en ese origen con archivos locales. La publicación de GitHub Pages es una fase aparte.
5. Con las dos confirmaciones del usuario y las lecturas aprobadas, cierra la sesión de solo lectura y abre `node tests/open-functional-session.js --habilitar-post`. En el aviso interactivo escribe `MICROCONTROLADOR DESCONECTADO Y POST AUTORIZADOS`. El modo protegido restringe las escrituras a las rutas y los IDs de este protocolo. Introduce manualmente la clave en **Habilitar control** y confirma el aviso de riesgo. La página guarda la clave en memoria y la envía en `X-API-Key` para los POST protegidos. Evita variables de entorno, argumentos, archivos, portapapeles compartido, capturas del diálogo, exportaciones HAR y trazas o registros de encabezados. Para la evidencia de red, conserva únicamente el método, la ruta, el cuerpo no secreto, el estado HTTP y los campos de respuesta indicados abajo.

El sondeo de RDS tiene un límite independiente de 9 s. La API conserva su límite de 6 s. Una respuesta válida de RDS puede llegar después de la de API y actualizar su indicador por separado. Un timeout se muestra como **Sin verificar** y el 503 reconocido de RDS como **No disponible**. Si los indicadores no están operativos antes del primer POST, reprograma la prueba.

## Orden exacto de la corrida autorizada

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

## Correlación y evidencia

- **Actividad de control.** En **SOLICITUD REST**, comprueba «Solicitud enviada. Esperando respuesta HTTP.» y luego «HTTP 200 aceptado.». En **EVENTO WSS**, comprueba el evento en su propia tarjeta. El evento puede aparecer mientras la solicitud sigue pendiente. La fase transitoria ya se puede reproducir con una respuesta demorada en la suite local. Si una respuesta real llega demasiado rápido para apreciarla visualmente, registra el orden del navegador y el observador por separado.
- **Movimiento individual.** Registra `id_vehiculo`, `id_comando`, `comando`, `codigo`, `origen: "API"` y `conectado` de ambas salidas. Compara literalmente `fecha_actualizacion` de HTTP con `timestamp` de WSS. Conserva la hora UTC de recepción por separado. El `id_evento` sirve para deduplicar WSS y no existe en la respuesta HTTP. Una coincidencia única indica compatibilidad con carácter orientativo. Considera las tramas observadas durante el envío y hasta 5 s tras aceptar HTTP. Un timestamp nulo, tramas perdidas, múltiples coincidencias o actividad de otro cliente dejan la correlación indeterminada.
- **DEMO.** Verifica la línea REST de inicio o cancelación (`#demo-http`), con solicitud enviada y luego HTTP 202 o 200 aceptado. La observación WSS tiene su propia línea de estado (`#demo-state`) y aparece en **EVENTO WSS**. Vincula ambos canales con `id_vehiculo: 1`, `id_demo: 1` y el orden de observación. En `demo_movimiento` añade `id_demo_movimiento`, `orden`, ID y código del comando. La API carece de un identificador de ejecución compartido entre canales, por lo que la atribución depende de la sesión exclusiva. Conserva el primer `demo_movimiento` y `demo_inicio` desde el observador, aunque el panel ya haya sustituido el último evento visible.
- **Registro.** Anota por paso hora, acción, método, ruta, ID, estado HTTP, evento, marca de tiempo, `id_evento` cuando exista y veredicto. Los veredictos son **aprobado**, **fallido** e **inconcluso**. Registra por separado el resultado HTTP y el del observador. Un error, una desconexión o una respuesta que llega fuera de la ventana de correlación no deben quedar como evento confirmado.

## Interrupción y cierre

Ante HTTP 401/403, conflicto 409, timeout, respuesta inesperada, pérdida de WSS o actividad de otra sesión, interrumpe las nuevas direcciones y ejecuciones. Tras una orden que pudo haberse aplicado, usa solo las acciones de contención incluidas en la autorización y que correspondan al estado observado. Para una DEMO propia activa intenta **Cancelar** y después **DETENER**. Si una DEMO ajena o no identificada está activa, coordina con su operador. Una ausencia de respuesta HTTP deja incierto el resultado y puede ocurrir después de que el backend reciba la solicitud. Evita reintentos automáticos y nuevas ejecuciones de DEMO para compensar evidencia faltante.

Cierra el control y el navegador de prueba una vez finalizada la última parada o resuelta la incidencia. Cierra el observador con Ctrl+C. Conserva únicamente el registro saneado y los resultados pendientes. La evidencia acredita órdenes y eventos del backend, sin prueba de movimiento físico.

## Ensayo local de preparación

Pasaron 21 pruebas de Node y 6 pruebas de Chrome con tráfico interceptado. Las pruebas de Chrome retuvieron deliberadamente las respuestas REST mientras entregaban los eventos WSS para comprobar que se vean ambos estados a la vez. La prueba del sondeo confirmó que RDS puede responder a los 7 s sin retrasar el resultado de API y que al vencer el plazo se registra **Sin verificar**. El observador completó su apertura, lectura de `estado_actual` y cierre en modo simulación. Los nueve POST de la tabla siguen pendientes de la corrida autorizada en AWS.

## Registro de la corrida autorizada

El 7 de noviembre de 2026 el propietario autorizó expresamente las operaciones del protocolo y confirmó antes del primer POST que el ESP8266 estaba físicamente desconectado de toda alimentación y que el carrito y el transmisor estaban apagados. La confirmación fue del propietario. La suscripción WSS se usó para observar publicaciones del backend.

En el preflight real, alrededor de las 14:22 de Ciudad de México, `GET /` devolvió HTTP 200 y `GET /health/database` devolvió HTTP 200 con `database: available`. El catálogo confirmó DETENER, AVANZAR y DERECHA con códigos 0, 1 y 8. La DEMO 1 tenía seis pasos. El WSS completó el handshake HTTP 101 y entregó `estado_actual` del vehículo 1.
