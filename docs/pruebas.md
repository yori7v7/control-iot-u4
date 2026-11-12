# Validación de las prácticas 4.1 y 4.2

## Práctica 4.2 · MONITOREO

Las suites de Node y Chrome de esta etapa usan dobles de prueba o tráfico interceptado. Se cubren los contratos de estado e historial, valores nulos, más de diez filas, fechas sin zona, IDs int64 exactos y ausencia de credenciales en lecturas. Las pruebas de integración ejercitan navegación y apertura directa, una conexión WSS compartida, deduplicación, otros vehículos, movimientos publicados por otro cliente, reconexión, respuestas tardías, fallos transitorios y la exclusión de pasos de DEMO del historial.

El resultado local fue de **40 de 40 en Node** y **50 de 50 en Chrome**. Se comprobó también que Detener continúa disponible al cambiar de vista con una parada pendiente tras cancelar una DEMO.

La regresión de CONTROL conserva las 18 dimensiones de la matriz, los comandos en estado conectado y desconectado, el joystick, la parada, la DEMO y la autorización. La vista MONITOREO se comprueba en teléfono emulado vertical y horizontal. Las pruebas estáticas y de navegador ejercitan Bootstrap, módulos ES, el sprite y el favicon con las rutas bajo `/control-iot-u4/assets/`. La comprobación del artefacto publicado de 4.2 queda pendiente de la revisión del pull request.

## Práctica 4.1 · Evidencia histórica

Este informe conserva los resultados y pendientes *históricos de la etapa local de preparación* del 7 de noviembre. Las columnas «Evidencia real pendiente» describen ese momento, no el estado actual. Consulta el [cierre de validación original](./validacion-funcional.md#resultados-finales) y la [ampliación de ocho direcciones](./validacion-funcional.md#ampliacion-posterior-joystick-de-ocho-direcciones-09112026) para los resultados posteriores y los conteos automatizados más recientes.

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

`npm test` pasó **20 de 20** pruebas de modelos, transporte y controladores. `npm run test:browser` pasó **6 de 6** pruebas de navegador. `npm audit --audit-level=high` informó **0 vulnerabilidades** en las dependencias de desarrollo instaladas. Para reproducirlos, consulta [Inicio local y pruebas](../README.md#pruebas).

Las comprobaciones directas de la fase inicial agotaron el tiempo de conexión. Los resultados de esa fase están en [Contratos](./contratos.md). La [auditoría real posterior](./validacion-real.md) verificó los GET contra AWS y el evento `estado_actual`. La publicación estaba pendiente en esta etapa inicial; quedó realizada después y se verificó posteriormente desde GitHub Pages. Consulta el informe de validación funcional enlazado al comienzo.

## Evidencia para la entrega

Una vez autorizado el despliegue y las operaciones de prueba, abre la aplicación en GitHub Pages con el microcontrolador desconectado. Verifica la conectividad, habilita el control con tu clave personal y registra el método, la ruta, el cuerpo con el ID y el estado HTTP de A y B. En C registra el ID de DEMO, el 202 y los eventos observados. Mantén el encabezado `X-API-Key` fuera de las capturas. Registra los estados independientes de D y las URLs verificadas de E y F.

La conclusión técnica local es que el cliente envía control por REST y observa las publicaciones por WSS. La comparación entre ambos canales es informativa porque el backend no comparte un identificador de solicitud. La evidencia de integración debe reflejar publicaciones del backend y limitarse a lo observado.
