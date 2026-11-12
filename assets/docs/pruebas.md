# Validación de las prácticas 4.1 y 4.2

## Práctica 4.2 · MONITOREO

Las suites de Node y Chrome de esta etapa usan dobles de prueba o tráfico interceptado. Se cubren los contratos de estado e historial, valores nulos, más de diez filas, fechas sin zona, IDs int64 exactos y ausencia de credenciales en lecturas. Las pruebas de integración ejercitan navegación y apertura directa, una conexión WSS compartida, deduplicación, otros vehículos, movimientos publicados por otro cliente, reconexión, respuestas tardías, fallos transitorios y la exclusión de pasos de DEMO del historial.

El resultado local fue de **40 de 40 en Node** y **50 de 50 en Chrome**. Se comprobó también que Detener continúa disponible al cambiar de vista con una parada pendiente tras cancelar una DEMO.

La regresión de CONTROL conserva las 18 dimensiones de la matriz, los comandos en estado conectado y desconectado, el joystick, la parada, la DEMO y la autorización. La vista MONITOREO se comprueba en teléfono emulado vertical y horizontal. Las pruebas estáticas y de navegador ejercitan Bootstrap, módulos ES, el sprite y el favicon con las rutas bajo `/control-iot-u4/assets/`. La comprobación del artefacto publicado de 4.2 queda pendiente de la revisión del pull request.

### Etapa 2.1 · Reorganización del PR #3

Tras mover la documentación y las pruebas a `assets/`, `npm ci` terminó correctamente y se mantuvieron los **40 de 40** de Node y los **50 de 50** de Chrome. Playwright detectó cuatro archivos de navegador. El servidor local entregó los recursos de la aplicación y la simulación bajo `/control-iot-u4/`. Las rutas de documentos y pruebas devolvieron HTTP 404, incluida una consulta HEAD al servidor de pruebas. La configuración de Pages excluye ambos directorios.

En Chrome, MONITOREO abrió sin clave con los archivos de la rama servidos mediante intercepción bajo el origen de GitHub Pages. Los GET reales de estado e historial agotaron el tiempo de espera, también en las comprobaciones directas desde Node. WSS quedó en reconexión sin recibir `estado_actual`. La interfaz mostró el error de lectura, API «No disponible» y RDS «Sin verificar». Los GET y el evento inicial quedan pendientes de verificar con AWS disponible. La URL pública respondió HTTP 200 y sirvió la versión anterior de CONTROL.

### Etapa 3 · Validación real de AWS previa al merge

El 11 de noviembre de 2026, hora de Ciudad de México, las cinco consultas reales de lectura respondieron HTTP 200 con `application/json`, `Access-Control-Allow-Origin: https://yori7v7.github.io` y `Vary: Origin`. Se enviaron sin clave, autorización ni cookies. Estas fueron las respuestas observadas.

| GET | Resultado |
| --- | --- |
| `/` | `status: ok` y servicio `Vehículo IoT API`. |
| `/health/database` | `status: ok`, `database: available`. El diagnóstico del código de referencia invoca un procedimiento de lectura. |
| `/vehiculos/1` | Vehículo 1, «Mini RC Forklift IoT», activo. |
| `/vehiculos/1/estado` | `DETENER`, ID de comando 1, código 0, `conectado: true`, `fecha_actualizacion: 2026-11-11T18:22:33`. |
| `/vehiculos/1/historial` | Diez filas de origen `API`, IDs exactos del 651 al 642. Orden descendente por fecha y por ID en el empate de los registros 648 y 647. Intervalo `18:22:33` a `18:18:21` del mismo día. |

El cliente WSS independiente abrió dos conexiones consecutivas con HTTP 101 y TLS 1.3 validado. Ambas entregaron `estado_actual` del vehículo 1, con `comando`, `codigo`, `timestamp` y el objeto `estado`. El timestamp coincidió con la fecha del estado persistido. El cliente cerró ambas sesiones normalmente con código 1000. Solo se observaron tramas iniciales. Sigue pendiente observar un evento `movimiento` nuevo en una prueba autorizada. Los campos `conectado` y `timestamp` proceden del backend y no acreditan la conexión del ESP8266 ni el movimiento físico.

Chrome abrió `#monitoreo` sin clave bajo el origen de Pages. La vista previa sustituyó los recursos estáticos por los archivos de la rama. Los cinco GET de esta etapa y WSS llegaron al backend real. Se bloquearon localmente las lecturas automáticas de catálogos, fuera del alcance de esta prueba. Los indicadores mostraron WSS «En línea», API y RDS «Disponible». La tabla mostró los diez IDs exactos y presentó `AVANZAR_DERECHA` como «Avanzar a la derecha». La fecha sin zona `2026-11-11T18:22:33` se mostró como `11/11/2026 · 18:22:33`. Tras cerrar el socket localmente, la vista conservó las filas, volvió a conectar y releyó estado e historial con HTTP 200. Los 25 recursos cargaron sin HTTP 404 ni errores JavaScript. No hubo desbordamiento horizontal en 1440 × 1000, 320 × 568 ni 568 × 320.

En localhost, Chrome cargó los recursos y WSS, pero bloqueó las lecturas REST por CORS. La interfaz indicó API «No disponible» y RDS «Sin verificar». La vista previa con el origen permitido de Pages confirmó REST y WSS reales. La versión pública de 4.2 queda pendiente de integración y verificación del artefacto desplegado.

La revisión de código confirmó transacciones de solo lectura para las consultas públicas a RDS y una suscripción WSS sin despacho de comandos. Las operaciones de control requieren `X-API-Key`. La auditoría del backend de referencia documenta una brecha de autorización en mutaciones administrativas. Queda pendiente revisar esas protecciones en el backend y cotejar el código desplegado en EC2. Esta etapa se limitó a inspección estática para las rutas administrativas. [Auditoría HTTP del backend](https://github.com/yori7v7/vehiculo_iot_api_dev/blob/3792236cc4c07a3cbbd62c58d16221532e0c2f80/docs/auditoria_http.md)

La revisión del PR detectó que `demo_error` ocultaba Detener en MONITOREO al terminar el seguimiento de la DEMO. La nueva prueba de Chrome reprodujo el fallo antes del cambio. Con la corrección, Detener sigue disponible para la sesión autorizada después del evento y de un HTTP 503 simulado. Un HTTP 200 retira la parada pendiente y conserva el error de ejecución. Las suites finales aprobaron **40 de 40 en Node** y **51 de 51 en Chrome**, con simulación o tráfico interceptado. La vista previa de escritorio también volvió a pasar con datos reales. Las pruebas de esta etapa no enviaron escrituras a AWS ni accionaron el vehículo.

## Práctica 4.1 · Evidencia histórica

Este informe conserva los resultados y pendientes *históricos de la etapa local de preparación* del 7 de noviembre. Las columnas «Evidencia real pendiente» describen ese momento, no el estado actual. Consulta el [cierre de validación original](./validacion-funcional.md#resultados-finales) y la [ampliación de ocho direcciones](./validacion-funcional.md#ampliaci%C3%B3n-posterior-joystick-de-ocho-direcciones-09112026) para los resultados posteriores y los conteos automatizados más recientes.

Pruebas locales realizadas el 7 de noviembre de 2026 con Node.js 24 y Google Chrome en Windows. Se usaron dos modalidades. La simulación de la interfaz genera datos en memoria. La suite de navegador también abre la vista normal e intercepta REST y WSS con Playwright para comprobar qué enviaría el cliente y qué mostraría al recibir respuestas y eventos.

## Resultados locales

| Prueba solicitada | Resultado local | Evidencia real pendiente |
| --- | --- | --- |
| **A · AVANZAR** | Aprobada con transporte interceptado. El POST usa el ID del catálogo y la clave de prueba. La vista distingue la espera HTTP, el 200 y el evento `movimiento` compatible. | POST y evento de la API en AWS desde GitHub Pages. |
| **B · Dirección y DETENER** | Aprobada con transporte interceptado y pruebas de controlador. Cambiar dirección envía la orden efectiva, los movimientos repetidos se omiten y DETENER descarta una orden pendiente. También se probó soltar las flechas y cancelar el contacto táctil. | Secuencia equivalente contra el backend desplegado, con autorización. |
| **C · DEMO** | Aprobada con dobles de prueba. Se consultaron los pasos del catálogo, se verificó el 202 y se observaron inicio, paso, finalización o cancelación. Se probó Cancelar por su endpoint y el orden de cancelación y DETENER. | La lectura real de la DEMO y sus pasos ya se verificó. Falta ejecutar y comprobar eventos desde GitHub Pages. |
| **D · Conectividad** | Aprobada con transporte interceptado. Se reprodujo RDS no disponible con API y WSS activos, fallo de API con RDS sin verificar, reconexión WSS y recuperación de los tres canales. | La auditoría posterior comprobó salud HTTPS, RDS y WSS en AWS, y CORS de lectura en Chrome para el origen previsto. Falta repetir desde la página publicada. |
| **E · Móvil y escritorio** | Aprobada en Chrome a 1440 × 1000 y en emulación táctil a 360 × 800 y 800 × 360. Sin desbordamiento horizontal en esos tamaños. Pasaron las reglas automatizadas WCAG 2/2.1 A y AA de axe en las vistas y el diálogo probados. | Repetir en los dispositivos que se usen para la entrega si difieren de la emulación. |
| **F · GitHub Pages y favicon** | Compatibilidad local aprobada bajo `/control-iot-u4/`. Cargaron CSS, módulos ES, iconos y favicon por rutas relativas. | Activar Pages tras autorización y verificar su URL pública. |

`npm test` pasó **20 de 20** pruebas de modelos, transporte y controladores. `npm run test:browser` pasó **6 de 6** pruebas de navegador. `npm audit --audit-level=high` informó **0 vulnerabilidades** en las dependencias de desarrollo instaladas. Para reproducirlos, consulta [Inicio local y pruebas](../../README.md#pruebas).

Las comprobaciones directas de la fase inicial agotaron el tiempo de conexión. Los resultados de esa fase están en [Contratos](./contratos.md). La [auditoría real posterior](./validacion-real.md) verificó los GET contra AWS y el evento `estado_actual`. La publicación estaba pendiente en esta etapa inicial; quedó realizada después y se verificó posteriormente desde GitHub Pages. Consulta el informe de validación funcional enlazado al comienzo.

## Evidencia para la entrega

Una vez autorizado el despliegue y las operaciones de prueba, abre la aplicación en GitHub Pages con el microcontrolador desconectado. Verifica la conectividad, habilita el control con tu clave personal y registra el método, la ruta, el cuerpo con el ID y el estado HTTP de A y B. En C registra el ID de DEMO, el 202 y los eventos observados. Mantén el encabezado `X-API-Key` fuera de las capturas. Registra los estados independientes de D y las URLs verificadas de E y F.

La conclusión técnica local es que el cliente envía control por REST y observa las publicaciones por WSS. La comparación entre ambos canales es informativa porque el backend no comparte un identificador de solicitud. La evidencia de integración debe reflejar publicaciones del backend y limitarse a lo observado.
