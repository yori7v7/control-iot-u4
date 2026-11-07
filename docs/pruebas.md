# Validación de la práctica 4.1

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

Las comprobaciones directas de la fase inicial agotaron el tiempo de conexión. Los resultados de esa fase están en [Contratos](./contratos.md). La [auditoría real posterior](./validacion-real.md) verificó los GET contra AWS y el evento `estado_actual`. Conserva por separado la evidencia del navegador bajo el origen previsto y la publicación, que sigue pendiente.

## Evidencia para la entrega

Una vez autorizado el despliegue y las operaciones de prueba, abre la aplicación en GitHub Pages con el microcontrolador desconectado. Verifica la conectividad, habilita el control con tu clave personal y registra el método, la ruta, el cuerpo con el ID y el estado HTTP de A y B. En C registra el ID de DEMO, el 202 y los eventos observados. Mantén el encabezado `X-API-Key` fuera de las capturas. Registra los estados independientes de D y las URLs verificadas de E y F.

La conclusión técnica local es que el cliente envía control por REST y observa las publicaciones por WSS. La comparación entre ambos canales es informativa porque el backend no comparte un identificador de solicitud. La evidencia de integración debe reflejar publicaciones del backend y limitarse a lo observado.
