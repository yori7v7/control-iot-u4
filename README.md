# Control IoT · Actividad 4.3

Portal web de **Administración, Control y Monitoreo** para el proyecto IoT de la grúa RC HJ2025-1D. La versión publicada incorpora inventario, asignaciones, sesiones por rol, exhibición temporal, DEMOS privadas y de fábrica, reservas y auditoría.

[Abrir el portal en GitHub Pages](https://yori7v7.github.io/control-iot-u4/) · [Guía 4.3](assets/docs/4.3/README.md) · [Repositorio del backend](https://github.com/yori7v7/vehiculo_iot_api_dev) · [API de producción](https://100-30-4-62.nip.io/) · [Swagger](https://100-30-4-62.nip.io/docs)

## Acceso y uso

| Rol | Cómo entrar y qué puede hacer |
| --- | --- |
| Administrador | Abre **Acceso** e inicia sesión con la cuenta administrativa (ID 1). En **Administración** puedes gestionar clientes, modelos, capacidades, inventario, asignaciones, titularidad, DEMOS de fábrica y reservas, y consultar la auditoría. |
| Comprador | En **Acceso**, inicia sesión con tu cuenta y abre **Cuenta → Mis vehículos**. El comprador ID 2 tiene asignada la unidad física ID 1, serie `RC-IOT-001`. Selecciónala para usar **Control**, consultar **Monitoreo** o gestionar tus DEMOS privadas. |
| Invitado | Abre **Acceso** y solicita la unidad de exhibición disponible ID 4, serie `EXH-LOGICA-43`. La reserva es exclusiva, dura 120 segundos y puede expirar o revocarse. **Control** muestra **DETENER** (código 0) y **AVANZAR** (código 1). Los eventos de la sesión corresponden a una unidad lógica sin ESP8266 ni actuación física. |

### Control del comprador

1. Selecciona la unidad 1 y abre **Control**. Comprueba el estado de API, RDS, WSS del navegador y despacho de la unidad.
2. Usa el joystick o la cruceta para las direcciones habilitadas. Cada diagonal requiere también sus dos direcciones cardinales. El joystick solicita **DETENER** al regresar al centro o soltarlo. **Luces**, **Velocidad** y **Claxon** dependen del catálogo efectivo. **Detener** se conserva al cambiar los permisos del modelo.
3. Para una **DEMO programada**, consulta los pasos, elige **Ejecutar** y observa el avance. FastAPI exige que los pasos de las DEMOS privadas y de fábrica estén autorizados. **Cancelar** solicita la interrupción de la secuencia gestionada por el servidor.
4. **Demostración original** inicia `DEMO_ORIGINAL` (código 64) cuando el catálogo de referencia está completo y el enlace físico es compatible. **Claxon** (código 128) interrumpió la secuencia en una comprobación física anterior. **Detener** (código 0) libera las salidas del ESP8266. La secuencia autónoma puede continuar.
5. Abre **Monitoreo** para consultar el último estado, los eventos observados y hasta diez movimientos individuales del alcance autorizado. Cierra la sesión desde **Cuenta**.

En **Administración → Modelos y capacidades**, **Actualizar modelo** guarda las casillas generales para todas las unidades vendidas de ese modelo. La cuenta del comprador determina qué unidades puede usar. La habilitación del modelo determina qué comandos puede ejecutar en ellas. La pertenencia al catálogo y el permiso del invitado se gestionan por separado. Una sesión abierta del comprador actualiza el catálogo al detectar el cambio, sin recargar. La revocación bloquea órdenes posteriores y las que el dispositivo ya recibió quedan bajo control local.

## Arquitectura y POO

GitHub Pages sirve `index.html`, los estilos de `assets/css/` y los módulos ES6 de `assets/js/`. El navegador llega a FastAPI a través de Caddy en EC2 mediante HTTPS y WSS. FastAPI aplica permisos y persiste en RDS MySQL 8.4.9, donde la migración 004 añadió la habilitación por capacidad. El equipo físico recibe órdenes por un canal WSS separado. La única grúa física integra un ESP8266 NodeMCU, un 74HC595 y ocho PC817. [Guía técnica del backend](https://github.com/yori7v7/vehiculo_iot_api_dev/blob/main/docs/4.3/README.md)

| Capa del navegador | Responsabilidad |
| --- | --- |
| Modelos | `Vehicle`, `Command`, `Demo`, `VehicleState` y `MovementHistoryEntry` validan los datos de dominio. |
| Servicios | `ApiClient` y `WebSocketClient` gestionan solicitudes, eventos y reconexión. El cliente 4.3 añade sesión y ticket de un solo uso para cada conexión WSS. |
| Controladores | `JoystickController` procesa puntero y teclado, `CommandService` coordina órdenes, `DemoController` gestiona secuencias y `MonitoringController` concilia eventos y lecturas. |
| Vistas | `DashboardView`, `MonitoringView` e indicadores presentan los resultados. Los módulos del portal 4.3 gestionan Acceso, Cuenta, edición de DEMOS y Administración. |

El bearer 4.3 vive en memoria. El backend comprueba el rol, el acceso a la unidad y el permiso vigente de cada orden. HTTP 200 comunica aceptación o persistencia según la operación. WSS conectado indica que el navegador tiene un canal de eventos. **DESPACHO SIN ACK** indica disponibilidad del enlace del dispositivo sin acuse de actuación. La confirmación mecánica requiere observación física.

## Pruebas y versiones

- La corrección registró 44 pruebas de Node y 98 de Chrome aprobadas. La integración Chrome, FastAPI y MySQL aprobó 2 pruebas en una ejecución separada. Los resultados focalizados y el alcance de cada comprobación se detallan en la [guía 4.3](assets/docs/4.3/README.md#resultados-de-la-corrección).
- En producción se verificó la revocación de RETROCEDER con la sesión del comprador abierta y sin recargar. Con el despacho rehabilitado, el operador confirmó el bloqueo físico de RETROCEDER y la recuperación del movimiento tras rehabilitarlo. El ensayo físico individual se limitó a RETROCEDER.
- La validación anterior del propietario abarcó PC, teléfono en vertical y horizontal, control físico y la interrupción de la DEMO original con Claxon.
- Las prácticas 4.1 y 4.2 quedan como antecedente del joystick, las DEMOS y el monitoreo. El acceso directo con API key y las rutas sin sesión descritos allí pertenecen al laboratorio histórico. [Documentación histórica 4.1/4.2](assets/docs/) · [Portada de la última restauración 4.2](https://github.com/yori7v7/control-iot-u4/blob/ff9eda1518f92de361f6c3bc3f8f348a94b2de2b/README.md).

La entrega inicial documentó el portal en `421b65a`. La versión corregida y verificada se publicó en `2345874d9eb213fe4270a52313f00a67b1f7102e`. El cierre incorpora [las pruebas de regresión](assets/tests/platform43.spec.js) y actualiza la documentación. Los archivos de la aplicación conservan el contenido de la versión probada físicamente.

**Contexto académico.** Actividad 4.3 de Implementación de Soluciones I, Ingeniería en Sistemas Computacionales. Diego Yorel Castelán Silva, Tecnológico Nacional de México — Instituto Tecnológico de Pachuca, 2026. Docente Pinedo Fernández Víctor Manuel.
