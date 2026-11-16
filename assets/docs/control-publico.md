# Control directo de la practica 4.2

La integracion local definitiva retira los clientes y servicios de turnos, sus roles, ventanas y formularios. CONTROL y MONITOREO abren directamente en la misma interfaz.

La clave de operador ya configurada se conserva y se aplica automaticamente mediante X-API-Key exclusivamente en los POST de movimientos y de ejecucion/cancelacion de DEMO programada. GET y WSS no envian la clave. No se consultan rutas administrativas. DEMO_ORIGINAL permanece bloqueada.

Las propuestas anteriores de turnos se conservan unicamente en el historial Git y no describen el flujo vigente. Esta integracion no modifica el backend ni publica el frontend.
