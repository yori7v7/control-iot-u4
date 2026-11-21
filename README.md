# Control IoT · Actividad 4.3

Portal web de **Administración, Control y Monitoreo** para el proyecto IoT de la grúa RC HJ2025-1D. La versión publicada incorpora inventario, asignaciones, sesiones por rol, exhibición temporal, DEMOS privadas y de fábrica, reservas y auditoría.

[Abrir el portal en GitHub Pages](https://yori7v7.github.io/control-iot-u4/) · [Guía 4.3](docs/4.3/README.md) · [Repositorio del backend](https://github.com/yori7v7/vehiculo_iot_api_dev) · [Swagger de producción](https://100-30-4-62.nip.io/docs)

## Acceso y uso

| Rol | Cómo entrar y qué puede hacer |
| --- | --- |
| Administrador | Abre **Acceso** e inicia sesión con la cuenta administrativa (ID 1). En **Administración** puedes gestionar clientes, modelos, capacidades, inventario, asignaciones, DEMOS de fábrica y reservas, y consultar la auditoría. |
| Comprador | En **Acceso**, inicia sesión con tu cuenta y abre **Cuenta → Mis vehículos**. El comprador ID 2 tiene asignada la unidad física ID 1, serie `RC-IOT-001`. Selecciónala para usar **Control**, consultar **Monitoreo** o gestionar tus DEMOS privadas. |
| Invitado | Abre **Acceso** y solicita la unidad de exhibición disponible ID 4, serie `EXH-LOGICA-43`. La reserva es exclusiva, dura 120 segundos y puede expirar o revocarse. **Control** muestra **DETENER** (código 0) y **AVANZAR** (código 1). Los eventos de la sesión corresponden a una unidad lógica sin ESP8266 ni actuación física. |

### Control del comprador

1. Selecciona la unidad 1 y abre **Control**. Comprueba el estado de API, RDS, WSS del navegador y despacho de la unidad.
2. Usa el joystick o la cruceta para las ocho direcciones. El joystick solicita **DETENER** al regresar al centro o soltarlo. También están disponibles **Luces**, **Velocidad**, **Claxon** y el botón **Detener**.
3. Para una **DEMO programada**, consulta los pasos, elige **Ejecutar** y observa el avance. Usa **Cancelar** para interrumpir la secuencia gestionada por el servidor.
4. **Demostración original** inicia `DEMO_ORIGINAL` (código 64) con el enlace físico compatible disponible. La interrupción física comprobada se realiza con **Claxon** (código 128). **Detener** (código 0) libera las salidas del ESP8266 y por sí solo no garantiza interrumpir esa secuencia autónoma.
5. Abre **Monitoreo** para consultar el último estado, los eventos observados y hasta diez movimientos individuales del alcance autorizado. Cierra la sesión desde **Cuenta**.

## Arquitectura y POO

GitHub Pages sirve HTML, CSS y JavaScript ES6. El navegador usa HTTPS con FastAPI en EC2 y un canal WSS de eventos. FastAPI aplica permisos y persiste en Amazon RDS MySQL. El equipo físico recibe órdenes por un canal WSS separado. La única grúa física integra un ESP8266 NodeMCU, un 74HC595 y ocho PC817.

| Capa del navegador | Responsabilidad |
| --- | --- |
| Modelos | `Vehicle`, `Command`, `Demo`, `VehicleState` y `MovementHistoryEntry` validan los datos de dominio. |
| Servicios | `ApiClient` y `WebSocketClient` gestionan solicitudes, eventos y reconexión. El cliente 4.3 añade sesión y ticket de un solo uso para cada conexión WSS. |
| Controladores | `JoystickController` procesa puntero y teclado, `CommandService` coordina órdenes, `DemoController` gestiona secuencias y `MonitoringController` concilia eventos y lecturas. |
| Vistas | `DashboardView`, `MonitoringView` e indicadores presentan los resultados. Los módulos del portal 4.3 gestionan Acceso, Cuenta, edición de DEMOS y Administración. |

El bearer 4.3 vive en memoria. El backend comprueba rol y alcance por unidad. HTTP, los eventos WSS y el indicador de despacho reflejan evidencia de software. La confirmación de actuación de la grúa requiere observación física.

## Pruebas y versiones

- El propietario confirmó el uso en PC y teléfono en vertical y horizontal, el control físico del comprador y la interrupción de la DEMO original con Claxon.
- Las pruebas locales de JavaScript y Chrome usan simulación o peticiones interceptadas. La integración contra un backend MySQL aislado tiene una ejecución separada. Consulta los comandos y los límites de la evidencia en la [guía 4.3](docs/4.3/README.md).
- Las prácticas 4.1 y 4.2 quedan como antecedente del joystick, las DEMOS y el monitoreo. El acceso directo con API key y las rutas sin sesión descritos allí pertenecen al laboratorio histórico. [Documentación histórica 4.1/4.2](assets/docs/) · [Portada de la última restauración 4.2](https://github.com/yori7v7/control-iot-u4/blob/ff9eda1518f92de361f6c3bc3f8f348a94b2de2b/README.md).

La aplicación 4.3 publicada se identificó en `421b65a`. La revisión de documentación de esta entrega conserva los archivos de la aplicación.

**Contexto académico.** Actividad 4.3 de Implementación de Soluciones I, Ingeniería en Sistemas Computacionales. Diego Yorel Castelán Silva, Tecnológico Nacional de México — Instituto Tecnológico de Pachuca, 2026. Docente Pinedo Fernández Víctor Manuel.
