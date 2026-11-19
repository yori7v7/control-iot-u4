# Frontend de la plataforma IoT 4.3

El portal carga desde `index.html` y ofrece Control, Monitoreo y Administración en el mismo documento. Los paneles de Control y Monitoreo reutilizan los modelos, controladores, joystick e indicadores de 4.2. La cuenta permite cambiar de unidad y editar DEMOS privadas. Los administradores operan inventario, clientes, modelos, asignación, DEMOS de fábrica, reservas y auditoría. El catálogo público permite iniciar una sesión limitada de exhibición.

En GitHub Pages llama al backend HTTPS configurado en `assets/js/config.js`. El backend 4.3 debe estar habilitado antes de publicar. Las sesiones viven en memoria. El cliente solicita un ticket por cada conexión o reconexión WSS. El modo explícito `?modo=simulacion` conserva el laboratorio 4.2 sin operaciones externas.

El código 64 de DEMO_ORIGINAL sólo está disponible en la consola 4.2 aislada y en su simulación. En 4.3 FastAPI lo omite del catálogo operativo porque la secuencia autónoma carece de una parada física garantizada. Las DEMOS programadas siguen disponibles conforme a los permisos.

```powershell
npm.cmd ci
npm.cmd start
npm.cmd test
npm.cmd run test:browser
```

Abrir `http://127.0.0.1:4173/control-iot-u4/`. En loopback la plataforma usa la API de pruebas en `http://127.0.0.1:8043`. El laboratorio se inicia desde el repositorio backend con `python -m scripts.local43`, después de preparar MySQL y habilitar 4.3 en entorno de desarrollo. La prueba integrada en Chrome se ejecuta con `IOT43_LIVE=1`. Los casos responsive y de regresión usan datos de prueba y transporte interceptado.

Las referencias al acceso anterior en `README.md` y `assets/docs/` corresponden a la documentación de 4.2. La guía de migración, despliegue y matriz de evidencias están en `docs/4.3/` del backend.
