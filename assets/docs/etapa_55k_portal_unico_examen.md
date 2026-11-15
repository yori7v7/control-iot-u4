# Etapa 5.5-K — Un único enlace oficial para profesor y administrador

**Requisito confirmado por el propietario (12 de noviembre de 2026):** para el examen solamente se compartirá la dirección **https://yori7v7.github.io/control-iot-u4/**, sin parámetros especiales, enlaces de invitación, contraseñas, claves API, segunda página ni formulario para el profesor.

## Experiencia requerida

- Preservar `index.html` en la raíz, diseño Dark Red Premium, las pestañas **Control** y **Monitoreo**, joystick y botón **DETENER**, además de las funcionalidades existentes.
- **Visitante sin credenciales:** la página detecta el rol visitante y registra automáticamente una solicitud a la API segura (cuando esté implementada). El joystick queda deshabilitado y junto a él aparece un indicador discreto `Esperando autorización del administrador`. No abrir un modal, pedir texto, redirigir ni obligar a desplazarse para hallar el control.
- **Administrador autenticado:** en el inspector de Turnos ya existente recibe las solicitudes pendientes con un código corto de identificación; aprueba expresamente la sesión correcta tras verificar en persona que se trata del profesor. Puede elegir `Tiempo limitado` o `Tiempo indefinido bajo supervisión`, revocar y ejecutar DETENER.
- **Visitante aprobado:** recibe una credencial opaca efímera propia, nunca la X-API-Key. La misma página activa el joystick sin recarga, notifica cambios automáticamente y desactiva el control de inmediato cuando la autorización caduca o es revocada.
- **Monitoreo:** conserva su vista y muestra al visitante el estado de solo lectura que sea permitido; el administrador puede monitorear mientras otro opera.
- **Diseño responsivo:** evitar que haya que hacer scroll para acceder al joystick, permiso y DETENER, tanto en ordenador como en móvil. Comprobar tamaños reales y accesibilidad; no esconder controles críticos.

## Restricción esencial

La URL por sí sola NO identifica al profesor. Un visitante cualquiera podría solicitar acceso, pero **nadie** lo recibe automáticamente. El administrador debe seleccionar y autorizar la sesión concreta. Para distinguir personas sin pedirles que escriban nada, ambos paneles mostrarán un código corto de solicitud. En escenarios de examen debe cotejarse presencialmente (o por voz) con el docente antes de aprobar.

El frontend no puede garantizar parada mecánica. Todas las rutas de movimiento, también las legacy de Swagger/admin y DEMO, deben pasar primero por un **coordinador único con bloqueo de propietario y STOP prioritario**, y el dispositivo debe tener watchdog independiente. No exponer tokens en el URL, no usar localStorage para secretos, no retirar los filtros loopback actuales hasta implementar la nueva ruta segura.

## Implementación actual

Solo existe el contrato de negocio experimental `SingleLinkAdmissionLab` en la rama `feature/5-5a-dispositivo-protocolo-aislado` del repositorio backend, con **9 pruebas unitarias locales aprobadas**. **No existe todavía el endpoint HTTP de solicitud automática**, ni está conectado a `app.js`, ni a AWS, ni a WSS; la URL pública actual mantiene su comportamiento anterior.

**Esta rama no modifica la página desplegada.** El código real del frontend solo debe activarse cuando los endpoints y el coordinador tengan garantías suficientes; mientras tanto `main` y GitHub Pages siguen estables.

## Próximos incrementos

1. Construir un adaptador HTTP de desarrollo para solicitar, consultar y aprobar tickets con estado `esperando/autorizado/revocado`; proteger contra spam y solicitudes cruzadas.
2. Probar el flujo en dos navegadores de la misma PC, sin actuadores.
3. Conectar el flujo con el coordinador WSS y asegurar que no exista un segundo camino de movimiento (Swagger y DEMO incluidos).
4. Integrar en `index.html` y `app.js` con avisos discretos, sin pantallas nuevas; probar en móvil/escritorio.
5. Desplegar HTTPS, probar acceso desde otra laptop y, solo después, validar parada real y movimiento bajo supervisión.

**No borrar ni reemplazar el diseño original del sitio.**
