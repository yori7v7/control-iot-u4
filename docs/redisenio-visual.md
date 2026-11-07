# Rediseño visual de Control IoT

Versión local del 7 de noviembre de 2026. El punto de restauración anterior al rediseño es la rama `respaldo/pre-redisenio-dark-red`, commit `089c8ea`.

## Diseño de la consola

La estética toma referencias de un cuadro de instrumentos automotriz. La consola usa zinc oscuro, una señal roja para las acciones principales y un joystick circular con bisel, marcas de eje y retroalimentación direccional. La identidad se repite en el favicon de arco y diagonal.

| Elemento | Aplicación |
| --- | --- |
| Color | Fondo `#09090B`, superficie `#18181B`, rojo `#DC2626`, rojo profundo `#991B1B` y texto `#F4F4F5`. Los estados de conectividad incluyen texto y un indicador de color. |
| Tipografía | Familia del sistema para lectura y monospace para identificadores, rótulos y posición del joystick. |
| Composición | Una consola integra el control manual, DEMO y la actividad REST/WSS. La conectividad conserva sus tres indicadores independientes. |
| Acciones | DETENER queda en la cabecera al desplazarse. Las direcciones y los comandos adicionales usan la misma familia de iconos. |
| Pantallas | Una columna en móvil vertical, densidad ajustada en horizontal y dos zonas de trabajo en escritorio. |
| Estados | Carga, errores y bloqueos mantienen mensajes visibles. Los botones distinguen foco, presión y deshabilitación. Las transiciones se suprimen al solicitar movimiento reducido. |

El trabajo abarca el HTML, la hoja de estilos, los SVG y la presentación en `DashboardView`. El atributo visual de dirección lee la dirección que ya entrega el controlador. Los servicios, modelos, controladores, contratos y configuración conservan la versión del respaldo.

## Verificación local

- Pasaron las 21 pruebas de `npm test` y las 6 de `npm run test:browser`. Cubren prioridad de DETENER, joystick táctil y de teclado, credencial en memoria, distinción REST/WSS, inicio y cancelación de DEMO y recuperación de conectividad.
- La revisión de Chrome cubrió diez tamaños entre 320 × 568 y 1440 × 1000, incluidos móvil vertical y horizontal, tableta y escritorio. DETENER mantuvo un objetivo táctil de al menos 44 × 44 px, visible y pulsable al inicio, mitad y final de la página. Las comprobaciones no detectaron desbordamiento horizontal, foco oculto ni infracciones en las reglas WCAG 2/2.1 A y AA evaluadas por axe.
- En horizontal y con muy poca altura, el centro del joystick requiere un desplazamiento breve. DETENER permanece visible. Se comprobó la preferencia de movimiento reducido.
- El servidor de prueba carga la aplicación desde `/control-iot-u4/`. Las rutas del favicon, los estilos, el sprite SVG y los módulos JavaScript son relativas y se verifican bajo ese subdirectorio.

La evidencia de esta fase procede de simulación y tráfico interceptado. La comprobación desde la URL publicada queda pendiente.
