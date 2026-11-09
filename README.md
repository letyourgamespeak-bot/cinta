# Cinta

App web instalable para llevar entrenos de series en una cinta con Bluetooth FTMS (probada con una Reebok FR20z
Floatride, «REEBOK 0674», ChangYow SI3014) y leer el pulso de una banda Bluetooth estándar. Graba la sesión con una
vuelta por paso y la exporta en FIT para importarla en COROS (t.coros.com → Actividades → Importar datos).

- `entrenos.json`: la biblioteca, sin fechas. El formato está en su cabecera.
- `app.js`: conexión, motor de pasos (bajada progresiva, pausa detectada con la cinta a 0) y grabación.
- `fit.js`: codificador FIT mínimo (validado con el SDK oficial de Garmin y con fitdecode).
- `?simular` (y `&x=10` para acelerar el reloj): cinta y pulso de mentira, para probar sin aparato.

Todo lo que graba se queda en el móvil (localStorage). Aquí solo hay el código y la lista de entrenos.
Órdenes que manda a la cinta: pedir control (0x00), velocidad (0x02) e inclinación (0x03, solo si un entreno la pide).
Arrancar, pausar y parar se hacen siempre con los botones de la cinta.

## Control por pulso (desde el 2026-11-09)

En los bloques largos con `pulso` en `entrenos.json`, la velocidad la lleva el pulso (`control_pulso.js`): 2′ sin
tocar, luego cada 40″ ±0,1 (o −0,2) para acabar el bloque en `fin`; nunca más rápido que `rapido` ni más lento que
`lento`; sin pulso, velocidad quieta; si toca él ±0,1, espera 40″. `heredar` arranca el bloque a la velocidad con que
acabó el anterior. Al terminar el entreno, la cinta baja sola a 6 km/h. Prueba con atleta simulado:
`node prueba_control.mjs`. El FIT lleva el nombre del entreno (deporte, workout y sesión) y las calorías.
