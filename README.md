# Control IoT · Práctica 4.1

Panel web para operar el vehículo IoT ID 1 de la práctica **Aplicación de control para IoT**, unidad 04. Integra el backend existente de FastAPI en AWS mediante HTTPS y WSS. Usa HTML semántico, CSS, Bootstrap 5.3.8 local y clases JavaScript con módulos nativos.

**Autor** · Diego Yorel Castelán Silva, Ingeniería en Sistemas Computacionales  
**Institución** · Tecnológico Nacional de México — Instituto Tecnológico de Pachuca  
**Asignatura** · Implementación de Soluciones I · Pinedo Fernández Víctor Manuel · 2026

## Inicio local

Se requiere Node.js 22 o posterior para el servidor y las pruebas. Para abrir la simulación no hace falta instalar dependencias.

```sh
npm start
```

Abre [la simulación local](http://127.0.0.1:4173/control-iot-u4/?modo=simulacion). La banda «Simulación local» identifica las respuestas y los eventos de prueba, generados en memoria. Los controles se pueden usar en este modo sin introducir una clave. El servidor local imita la ruta de GitHub Pages y entrega únicamente archivos estáticos de la aplicación.

La [vista local por defecto](http://127.0.0.1:4173/control-iot-u4/) apunta a la API real. La compatibilidad CORS de esa API se debe verificar desde `https://yori7v7.github.io`. La simulación funciona sin conectarse a AWS y evita depender de CORS durante el desarrollo.

## Uso del panel

1. En modo real, abre **Habilitar control**, introduce la clave administrativa y confirma que comprendes el riesgo. Una orden puede activar el vehículo. Para esta práctica, mantén el microcontrolador desconectado y realiza operaciones de control únicamente con autorización.
2. Usa el joystick con el dedo, el ratón o las flechas cuando tiene foco. Al volver al centro o soltar se solicita DETENER. Las flechas visibles debajo del joystick envían órdenes individuales y **DETENER** las interrumpe. Las diagonales y otros comandos se habilitan según el catálogo activo.
3. Selecciona una DEMO y consulta **Movimientos programados**. **Ejecutar** envía la petición al backend y el panel actualiza el avance con los eventos WSS recibidos. **Cancelar** interrumpe la secuencia con su endpoint dedicado. **DETENER** intenta cancelar una DEMO activa conocida antes de enviar la orden de parada.
4. Revisa por separado el resultado REST, el evento WSS y los indicadores de conectividad. Usa **Actualizar conexión y catálogos** para repetir las consultas. Desde **Sesión de control** puedes actualizar la clave o cerrar la sesión cuando no hay órdenes pendientes ni un movimiento manual sin detener.

## Arquitectura POO

| Ubicación | Clases y responsabilidades |
| --- | --- |
| `js/models/` | `Vehicle`, `Command` y `Demo` validan y encapsulan datos del dominio. `Command` separa el ID REST del código lógico y deriva la clave usada en el control. |
| `js/services/` | `ApiClient` centraliza Fetch, autenticación, validación, timeouts y errores. `WebSocketClient` mantiene una suscripción de lectura, valida tramas, deduplica y reconecta con espera creciente. `ConnectionService` comprueba API y RDS por separado. |
| `js/controllers/` | `JoystickController` gestiona Pointer Events, zona neutral, pérdida de captura y teclado. `CommandService` valida el catálogo, serializa los POST y prioriza DETENER. `DemoController` gestiona la selección, ejecución, cancelación y los eventos de la secuencia. |
| `js/ui/` | `DashboardView` actualiza el DOM sin construir solicitudes HTTP. `ConnectionIndicators` representa los tres estados con texto y color. |
| `js/app.js` y `js/config.js` | El punto de entrada instancia y conecta los objetos. La configuración contiene URLs, ID y tiempos de espera. |
| `assets/`, `css/`, `tests/`, `docs/` | Iconos originales, estilos y licencia de Bootstrap, servidor y suites de prueba, auditoría de contratos. |

```text
Joystick y botones → CommandService ─┐
Selección y acciones → DemoController ├→ ApiClient → HTTPS → FastAPI
ConnectionService ────────────────────┘
DashboardView ← controladores ← WebSocketClient ← WSS ← FastAPI
```

El joystick y los botones envían el `id_comando` entregado por la API. La cola mantiene como máximo una orden manual en curso y una intención pendiente. DETENER debe estar activo y tener código lógico 0. Sustituye una dirección pendiente y espera la orden que ya se despachó. La vista conserva la intención más reciente aunque llegue antes una respuesta anterior. El cliente no reintenta automáticamente POST.

El backend intenta emitir `movimiento` antes de responder HTTP 200. El panel compara vehículo, ID, nombre, código, origen, estado y marca de tiempo presentes en ambas respuestas. Muestra una coincidencia única como **compatible**, ya que el UUID de WSS no existe en HTTP y otros clientes pueden generar eventos iguales. Los estados de conectividad se actualizan con la apertura real de WSS, `GET /` y `GET /health/database`. Cuando falla la comunicación con la API de salud de RDS, el estado es «Sin verificar». Una respuesta específica del backend sobre fallo de RDS se muestra como «No disponible».

Las sondas de salud se ejecutan en paralelo. La API tiene un límite de 6 segundos y RDS uno de 9 segundos. La interfaz exige WSS para iniciar una DEMO y observar el progreso. Los movimientos manuales y las solicitudes de DETENER y cancelar se transmiten por REST. La línea REST de la DEMO distingue la solicitud enviada y el estado HTTP. El progreso WSS se presenta por separado, incluso si un evento llega primero. [Auditoría de los contratos](./docs/contratos.md)

## Seguridad y límites

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

La suite de navegador usa Google Chrome instalado. El [reporte de pruebas](./docs/pruebas.md) describe las comprobaciones locales con simulación y tráfico interceptado. La [auditoría real de solo lectura](./docs/validacion-real.md) documenta las respuestas observadas en AWS, los pasos de la DEMO y la evidencia de CORS y WSS en Chrome. Ninguna suite del frontend requiere una clave administrativa.

El [protocolo de validación funcional](./docs/validacion-funcional.md) fija la secuencia protegida, los criterios de correlación y el uso del observador WSS independiente. Para ensayar únicamente el observador sin red, ejecuta `node tests/observe-wss.js --simulacion`.

## Publicación en GitHub Pages

La publicación queda pendiente de autorización. La URL prevista es [yori7v7.github.io/control-iot-u4](https://yori7v7.github.io/control-iot-u4/).

1. Con la autorización, confirma el repositorio `yori7v7/control-iot-u4` y prepara el commit inicial en la rama `main`. Revisa `git status --short` y los cambios staged antes de subirlos.
2. Sube `main` al repositorio del frontend. En **Settings → Pages**, selecciona **Deploy from a branch**, rama `main` y carpeta **/(root)**. El marcador `.nojekyll` permite entregar los archivos directamente. [Configurar el origen de publicación](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
3. Abre la URL que indique GitHub, verifica los recursos y el favicon, y comprueba los estados y catálogos contra AWS desde ese origen. Ejecuta las pruebas de control real únicamente con autorización expresa y el microcontrolador desconectado.
4. Entrega los enlaces del repositorio y GitHub Pages junto con las conclusiones y los resultados verificados en la plataforma académica.

Bootstrap 5.3.8 se distribuye como CSS bajo licencia MIT. [Versión oficial](https://getbootstrap.com/docs/5.3/getting-started/download/) · [Licencia incluida](./css/vendor/bootstrap-LICENSE.txt)
