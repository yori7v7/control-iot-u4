# Control IoT · Prácticas 4.1 y 4.2

Consola web para operar y monitorear el vehículo IoT ID 1. **CONTROL** reúne el joystick, los comandos y las demostraciones de la práctica 4.1. **MONITOREO** presenta el estado y el historial persistidos para la práctica 4.2. Ambas vistas comparten el backend FastAPI en AWS, el cliente HTTPS y una suscripción WSS. La interfaz usa HTML semántico, Bootstrap 5.3.8 local y clases JavaScript con módulos nativos.

[Abrir Control IoT en GitHub Pages](https://yori7v7.github.io/control-iot-u4/) · [Repositorio del frontend](https://github.com/yori7v7/control-iot-u4)

Premium Dashboard 2.0 parte del estado validado en `e0b4121`. [Estado previo al rediseño](https://github.com/yori7v7/control-iot-u4/commit/e0b4121b028c0e8df91f14238ee1ad7265f05e85) · [Ampliación de ocho direcciones](https://github.com/yori7v7/control-iot-u4/commit/e692f9e579f43b96a32cc86dd1aef598cf52984e) · [Entrega inicial](https://github.com/yori7v7/control-iot-u4/commit/5f341e66da2650e0f4fa6cdba3f7a21c41975611)

**Autor** · Diego Yorel Castelán Silva, Ingeniería en Sistemas Computacionales  
**Institución** · Tecnológico Nacional de México — Instituto Tecnológico de Pachuca  
**Asignatura** · Implementación de Soluciones I · Pinedo Fernández Víctor Manuel · 2026

## Inicio local

Se requiere Node.js 22 o posterior para el servidor y las pruebas. Desde la raíz del repositorio, `npm start` ejecuta `assets/tests/serve.js`. Para abrir la simulación no hace falta instalar dependencias.

```sh
npm start
```

Abre [la simulación local](http://127.0.0.1:4173/control-iot-u4/?modo=simulacion). La banda «Simulación local» identifica las respuestas y los eventos de prueba, generados en memoria. Los controles se pueden usar en este modo sin introducir una clave. El servidor local imita la ruta de GitHub Pages y sirve el HTML, los estilos, los módulos y los dos SVG de la aplicación.

La [vista local por defecto](http://127.0.0.1:4173/control-iot-u4/) apunta a la API real. La compatibilidad CORS de esa API se debe verificar desde `https://yori7v7.github.io`. La simulación funciona sin conectarse a AWS y evita depender de CORS durante el desarrollo.

## Navegación y uso

La ruta base abre **Control**. Usa los enlaces de la cabecera o el botón **Vistas** en pantallas compactas. El fragmento `#monitoreo` abre directamente **Monitoreo**. El cambio de vista ocurre dentro de la misma página y conserva el ciclo de vida de la sesión y del socket.

### Control

1. En modo real, abre **Habilitar control**, introduce la clave administrativa y confirma que comprendes el riesgo. Una orden puede activar el vehículo. Para esta práctica, mantén el microcontrolador desconectado y realiza operaciones de control únicamente con autorización.
2. Usa el joystick con el dedo, el ratón o las flechas cuando tiene foco. Al volver al centro o soltar se solicita DETENER. Los ocho botones de la cruceta envían órdenes individuales y **DETENER** las interrumpe. Las diagonales y otros comandos se habilitan según el catálogo activo.
3. Selecciona una DEMO y abre **Detalle de DEMO** para consultar **Movimientos programados**. **Ejecutar** envía la petición al backend y el panel actualiza el avance con los eventos WSS recibidos. **Cancelar** interrumpe la secuencia con su endpoint dedicado. **DETENER** intenta cancelar una DEMO activa conocida antes de enviar la orden de parada.
4. Revisa el estado de la orden y los indicadores de conectividad. CONTROL presenta la solicitud REST, el evento WSS compatible cuando se observa y los errores operativos en la vista principal. **Actualizar conexión y catálogos** repite las lecturas. Desde **Sesión de control** puedes actualizar la clave o cerrar la sesión cuando no hay órdenes pendientes ni un movimiento manual sin detener.

Al finalizar normalmente o tras aceptar por HTTP un DETENER posterior a la cancelación, el panel conserva el resultado visible unos cuatro segundos. Luego vuelve a «Sin DEMO en ejecución», mantiene la selección y guarda la evidencia disponible en **Último resultado**. Si DETENER falla o agota el plazo, permanece el aviso.

**Turnos de control** muestra la disponibilidad para invitados. El contrato de la etapa 5.2 admite turnos simulados exclusivamente en loopback. El CONTROL autenticado sigue disponible con el backend en modo público deshabilitado. [Integración y prueba local](assets/docs/control-publico.md#integración-de-la-etapa-53)

### Monitoreo

La vista abre sin clave. Al entrar consulta `GET /vehiculos/1/estado` y `GET /vehiculos/1/historial`. El estado puede ser `null`. El historial puede estar vacío y muestra hasta diez filas persistidas en el orden del servidor. Las fechas sin zona conservan la hora reportada y las filas mantienen su origen y el identificador de historial exacto.

Los eventos de `WSS /ws/vehiculos/1` actualizan el reporte observado y solicitan una reconciliación. Un movimiento individual activa la lectura de estado e historial. Un paso de DEMO actualiza el estado y queda fuera de la tabla. La reconexión y **Actualizar monitoreo** recargan ambos recursos. Las lecturas se agrupan ante ráfagas, se descartan resultados obsoletos y la última tabla válida sigue visible durante fallos transitorios. El historial se actualiza por eventos y por demanda.

La tarjeta distingue el evento recibido del estado confirmado por REST. El estado persistido, WSS y `conectado` describen evidencia del backend y carecen de acuse físico del actuador. En simulación, MONITOREO indica que el historial real está disponible en el modo conectado.

El indicador **DEMO programada** usa el WSS compartido al cambiar de vista. Un paso aislado acredita el movimiento observado. Tras perder WSS, una ejecución previa queda sin confirmar hasta que llegue evidencia nueva.

## Premium Dashboard 2.0

La consola de grafito y rojo reúne el joystick circular de ocho direcciones, una cruceta de botones y los comandos auxiliares. La cabecera mantiene **DETENER** junto a la sesión y la barra muestra WSS, API y RDS por separado. El rediseño conserva los IDs dinámicos del catálogo, la prioridad de DETENER y la lógica de los controladores y transportes. La simulación local sigue funcionando sin red.

- En vertical con poca altura, joystick y cruceta comparten una fila. Con más altura, el joystick ocupa una fila propia y la cruceta comparte espacio con los comandos auxiliares.
- En horizontal compacto, el control manual ocupa la zona izquierda y la DEMO la derecha. CONTROL conserva la confirmación REST y WSS en línea tras retirar el botón y panel **Diagnóstico**. Los paneles de DEMO y vehículo conservan los pasos, el último resultado y los créditos. El aviso **Pulsa Detener** permanece visible mientras esté pendiente una parada posterior a la cancelación.
- Las direcciones responden con una pulsación breve. Luces usa un destello, Velocidad un giro, Claxon una vibración visual y Demostración original un pulso del icono. El efecto indica interacción local, se reinicia al repetir la pulsación y respeta la preferencia de movimiento reducido. El firmware envía pulsos de 300 ms en los cuatro auxiliares. Las luces y los tres modos de velocidad carecen de telemetría en el backend, por lo que la interfaz no estima ni conserva un estado físico. [Firmware de referencia](https://github.com/yori7v7/vehiculo_iot_api_dev/blob/3c26b3aa50ad21c6802cdb89b10aa6fdec0b217d/firmware/Excavadora_IoT_AWS/Excavadora_IoT_AWS.ino#L217-L239)
- MONITOREO apila el reporte y el historial en teléfono vertical. En horizontal y pantallas amplias los presenta lado a lado. La tabla pagina según el espacio disponible para conservar los diez registros sin scroll interno. **Anterior** y **Siguiente** funcionan con teclado y tacto. La primera página sigue las novedades. Al consultar páginas anteriores, la vista mantiene la referencia al primer ID que siga disponible y avisa que hay movimientos más recientes.
- El layout reserva las áreas seguras del navegador. Los paneles de detalle y el cuerpo del diálogo de sesión pueden desplazarse internamente si el contenido crece. La acción **Volver** permanece en el pie del diálogo. Fuera de la matriz, un viewport muy reducido o con zoom puede requerir desplazamiento para conservar la legibilidad y los controles táctiles.

La validación de Premium Dashboard 2.0 aprobó **27 pruebas de Node y 38 de Chrome**. La suite responsive verificó cero desplazamiento horizontal y vertical, ausencia de solapamientos y áreas de al menos 44 × 44 px CSS en los botones de movimiento, DETENER y controles de DEMO de los 18 tamaños siguientes.

| Grupo | Viewports de prueba en px CSS |
| --- | --- |
| Teléfonos en vertical | 320 × 568, 360 × 640, 375 × 667, 390 × 844, 414 × 896, 430 × 932 |
| Teléfonos en horizontal | 568 × 320, 640 × 360, 667 × 375, 740 × 360, 844 × 390, 896 × 414, 932 × 430 |
| Tabletas y escritorio | 768 × 1024, 1024 × 768, 1280 × 720, 1366 × 768, 1920 × 1080 |

Playwright ejecuta Chrome en escritorio y emula los tamaños móviles y la reducción de altura al abrir el teclado. Las particularidades del teclado virtual, las barras del navegador y las áreas seguras dependen del dispositivo y requieren comprobación en un teléfono físico.

## Arquitectura POO

| Ubicación | Clases y responsabilidades |
| --- | --- |
| `assets/js/models/` | `Vehicle`, `Command` y `Demo` validan datos del dominio. `VehicleState` y `MovementHistoryEntry` validan las lecturas de monitoreo. |
| `assets/js/services/` | `ApiClient` centraliza Fetch, autenticación, validación, timeouts y errores. `WebSocketClient` mantiene una suscripción de lectura, valida tramas, deduplica y reconecta con espera creciente. `ConnectionService` comprueba API y RDS por separado. |
| `assets/js/controllers/` | `JoystickController` gestiona puntero y teclado. `CommandService` serializa los POST y prioriza DETENER. `DemoController` coordina las demostraciones. `MonitoringController` agrupa lecturas e invalida datos con WSS. |
| `assets/js/ui/` | `DashboardView` presenta CONTROL. `MonitoringView` presenta estado, evento e historial. `ConnectionIndicators` representa los tres canales. `commandLabels.js` traduce los nombres únicamente al presentarlos. |
| `assets/js/app.js` y `assets/js/config.js` | El punto de entrada instancia y conecta los objetos. La configuración contiene URLs, ID y tiempos de espera. |
| `assets/css/` y `assets/` | Estilos, Bootstrap y su licencia, favicon y sprite SVG. |
| `assets/tests/` y `assets/docs/` | Servidor local, suites de prueba y documentación técnica. |

```text
Joystick y botones → CommandService ─┐
Selección y acciones → DemoController ├→ ApiClient → HTTPS → FastAPI → RDS
MonitoringView ← MonitoringController┤
ConnectionService ────────────────────┘
CONTROL y MONITOREO ← WebSocketClient ← WSS ← FastAPI
```

El joystick y los botones envían el `id_comando` entregado por la API. La cola mantiene como máximo una orden manual en curso y una intención pendiente. DETENER debe estar activo y tener código lógico 0. Sustituye una dirección pendiente y espera la orden que ya se despachó. La vista conserva la intención más reciente aunque llegue antes una respuesta anterior. El cliente no reintenta automáticamente POST.

El backend intenta emitir `movimiento` antes de responder HTTP 200. El panel compara vehículo, ID, nombre, código, origen, estado y marca de tiempo presentes en ambas respuestas. Muestra una coincidencia única como **compatible**, ya que el UUID de WSS no existe en HTTP y otros clientes pueden generar eventos iguales. Los estados de conectividad se actualizan con la apertura real de WSS, `GET /` y `GET /health/database`. Cuando falla la comunicación con la API de salud de RDS, el estado es «Sin verificar». Una respuesta específica del backend sobre fallo de RDS se muestra como «No disponible».

Las sondas de salud se ejecutan en paralelo. La API tiene un límite de 6 segundos y RDS uno de 9 segundos. La interfaz exige WSS para iniciar una DEMO y observar el progreso. Los movimientos manuales y las solicitudes de DETENER y cancelar se transmiten por REST. La línea REST de la DEMO distingue la solicitud enviada y el estado HTTP. El progreso WSS se presenta por separado, incluso si un evento llega primero. [Auditoría de los contratos](./assets/docs/contratos.md)

## Seguridad y límites

- MONITOREO usa GET y WSS públicos. CONTROL físico conserva la sesión actual para autorizar sus POST. El acceso de operadores identificados sin clave manual podría usar OIDC y PKCE. Para acceso verdaderamente público, la propuesta de FastAPI requiere habilitación del propietario, turno exclusivo y parada segura. Un modo público permite a desconocidos intentar operar el vehículo. Su implementación requiere una revisión y PR independientes. [Propuesta de acceso público](./assets/docs/control-publico.md) · [Seguridad OAuth 2.0](https://www.rfc-editor.org/rfc/rfc9700.html)
- La clave se conserva en memoria durante la sesión de la página. Se añade solo a los POST protegidos y se borra del campo de entrada. Los errores visibles usan mensajes definidos por el cliente. Las políticas de contenido y referencia restringen scripts, conexiones y envíos de formulario.
- Una clave administrativa en el navegador es adecuada únicamente para la prueba personal autorizada. Las solicitudes protegidas aparecen en las herramientas de red de esa sesión. Oculta el encabezado al preparar evidencia académica.
- HTTP y WSS comprueban actividad del backend. Un timeout puede ocurrir después de que el servidor reciba una orden. Cerrar la página o cancelar Fetch no confirma una parada física. Una DEMO iniciada desde otro cliente durante una desconexión puede quedar fuera del estado observado por este panel.
- La cancelación dedicada de DEMO y la orden DETENER cumplen funciones diferentes. Un fallo al cancelar deja el estado de ejecución incierto aunque se intente enviar DETENER.

## Pruebas

```sh
npm ci
npm test
npm run test:browser
```

La suite de navegador usa Google Chrome instalado. El [reporte de pruebas](./assets/docs/pruebas.md) describe las comprobaciones locales con simulación y tráfico interceptado. La [auditoría real de solo lectura](./assets/docs/validacion-real.md) documenta las respuestas observadas en AWS, los pasos de la DEMO y la evidencia de CORS y WSS en Chrome. Ninguna suite del frontend requiere una clave administrativa.

La etapa 2 de la práctica 4.2 pasó **40 pruebas de Node y 50 de Chrome**. La regresión de CONTROL cubre los 18 tamaños de la matriz. Las pruebas nuevas de MONITOREO incluyen Chrome con emulación táctil de 320 × 568 y 568 × 320, navegación por teclado y los recursos bajo la ruta de Pages.

En la etapa 3, la vista previa de la rama bajo el origen de GitHub Pages abrió MONITOREO sin clave, consultó diez movimientos reales en RDS y reconcilió el estado y el historial tras reconectar WSS. Pasaron **40 pruebas de Node y 51 de Chrome**, incluida la regresión de Detener tras un error de ejecución de DEMO. Tras integrar el PR #3, el propietario confirmó que los movimientos enviados desde CONTROL en laptop y teléfono se reflejan en MONITOREO del otro dispositivo. [Validación real de la etapa 3](./assets/docs/pruebas.md#etapa-3--validaci%C3%B3n-real-de-aws-previa-al-merge)

La rama de la etapa 4 aprobó **40 pruebas de Node y 72 de Chrome**. Ambas vistas pasaron las 18 resoluciones, con comprobación de paginación, teclado, áreas seguras y movimiento reducido. [Resultados de la etapa 4](./assets/docs/pruebas.md#etapa-4--interfaz-y-paginaci%C3%B3n-adaptativa)

La revisión previa al despliegue aprobó 21 pruebas de Node y 6 de Chrome. En la versión original entregada pasaron **24 pruebas de Node y 13 de Chrome**; tras ampliar el joystick a ocho direcciones, Codex reportó **27 pruebas de Node y 15 de Chrome** aprobadas, con simulación y tráfico interceptado.

El propietario confirmó desde GitHub Pages la conexión con AWS real, los tres indicadores, los comandos y botones con HTTP 200, las cuatro direcciones del joystick, DETENER por REST y WSS, la finalización y cancelación de la DEMO, y DETENER posterior por HTTP 200 y WSS. Las pruebas anteriores de Swagger y WSS corresponden al backend. [Resultados finales y protocolo de validación](./assets/docs/validacion-funcional.md)

Para ensayar el observador sin red, ejecuta `node assets/tests/observe-wss.js --simulacion`.

El [registro del rediseño visual](./assets/docs/redisenio-visual.md) documenta la identidad, el respaldo de Git y la verificación local en diferentes tamaños de pantalla.

## Ampliación posterior a la entrega: ocho direcciones (09/11/2026)

El joystick interpreta ocho sectores, con cuatro movimientos cardinales y cuatro diagonales. Al soltar, regresar a la zona neutral o perder la captura, solicita DETENER; no es un mando analógico de velocidad o giro proporcional. Si falta una diagonal activa en el catálogo, utiliza el cardinal dominante.

| Dirección | Comando | `id_comando` en RDS | Código 74HC595 |
| --- | --- | ---: | ---: |
| ↑ | `AVANZAR` | 2 | 1 |
| ↗ | `AVANZAR_DERECHA` | 7 | 9 |
| → | `DERECHA` | 6 | 8 |
| ↘ | `RETROCEDER_DERECHA` | **17** | **10** |
| ↓ | `RETROCEDER` | 3 | 2 |
| ↙ | `RETROCEDER_IZQUIERDA` | 5 | 6 |
| ← | `IZQUIERDA` | 4 | 4 |
| ↖ | `AVANZAR_IZQUIERDA` | **16** | **5** |
| Centro | `DETENER` | 1 | 0 |

El código usa IDs del catálogo leído de AWS, no IDs de prueba fijos; los dos comandos nuevos se añadieron a RDS y constan activos. La ampliación se publicó desde `main` con el commit `e692f9e`. [Despliegue de la ampliación en GitHub Pages](https://github.com/yori7v7/control-iot-u4/actions/runs/42723870488)

Las verificaciones de usuario y el Monitor Serie del ESP8266 demostraron recepción y despacho WSS de las ocho direcciones, incluidas las nuevas, y DETENER. **Actualización posterior (09/11/2026):** el propietario confirmó que completó las pruebas físicas de los movimientos del joystick, incluidas las dos diagonales nuevas, y que funcionaron correctamente tanto desde laptop como desde teléfono. Esta confirmación es testimonial y complementa la evidencia previa de WSS/Monitor Serie; no se adjuntó una nueva grabación del movimiento físico. Véase [validación de la ampliación](./assets/docs/validacion-funcional.md#ampliaci%C3%B3n-posterior-joystick-de-ocho-direcciones-09112026).

## Publicación en GitHub Pages

La fuente de Pages es **Deploy from a branch**, rama `main`, carpeta **/(root)**. El frontend usa recursos relativos y no requiere compilar JavaScript. GitHub Pages aplica `_config.yml` para excluir `assets/tests/`, `assets/docs/`, los archivos de desarrollo y las cachés. Las pruebas y la documentación se consultan en el repositorio. [Configuración de la fuente de Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

La URL sin parámetros abre CONTROL real. MONITOREO usa `#monitoreo` en esa misma página. La simulación se activa mediante `?modo=simulacion` y genera respuestas de prueba solo para CONTROL. Los recursos se publican bajo `/control-iot-u4/assets/`. **La vista MONITOREO de la práctica 4.2 ya se encuentra integrada en `main` y publicada mediante GitHub Pages**; la compilación y el despliegue de Pages para el commit `84c9d1d` terminaron correctamente. El monitoreo de datos vivos requiere que la API y la base de datos de AWS estén disponibles; su ausencia se indica en la interfaz y no demuestra un fallo de publicación.

Bootstrap 5.3.8 se distribuye como CSS bajo licencia MIT. [Versión oficial](https://getbootstrap.com/docs/5.3/getting-started/download/) · [Licencia incluida](./assets/css/vendor/bootstrap-LICENSE.txt)

## Entrega digital — Práctica 4.2 (13/11/2026)

- **Aplicación web de CONTROL y MONITOREO:** https://yori7v7.github.io/control-iot-u4/
- **Código fuente del frontend:** https://github.com/yori7v7/control-iot-u4
- **Monitoreo directo, en el mismo sitio:** https://yori7v7.github.io/control-iot-u4/#monitoreo

La parte digital incluye consulta del estado y de los últimos movimientos persistidos, actualizaciones por WSS, historial paginado y presentación adaptable. Los eventos del backend no constituyen una confirmación independiente del movimiento físico. Las funciones experimentales de admisión de visitantes y autorización remota se desarrollan en una rama aparte y **no** se presentan como habilitadas en esta entrega digital. Las pruebas físicas de la ampliación se realizan en una fecha posterior.
