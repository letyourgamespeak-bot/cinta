// Control de la velocidad por pulso en los bloques largos (acordado con él el 2026-11-06, afinado el 2026-11-09).
// Puro: no toca la cinta ni la pantalla, así se prueba con un atleta simulado (prueba_control.mjs).
//
// La idea: en cinta el pulso le sube por el calor y la humedad del sótano. Lo que importa es el ESTÍMULO, así que la
// velocidad se mueve para que el pulso llegue al final del bloque a «fin» (p. ej. 172, 174, 176 en un 3×8′ con
// techo 177), aunque el ritmo salga más lento que en la calle. Reglas:
//   - Los primeros «desde_s» (120 s) no se toca nada: el pulso todavía está subiendo.
//   - Después, el objetivo sube en línea recta de fin−5 (a los 2′) a fin (al acabar): la deriva normal del bloque.
//   - Cada 40 s como mínimo: >5 por encima → −0,2 km/h; >1,5 por encima → −0,1; >4 por debajo → +0,1.
//   - Freno de emergencia en cualquier momento desde el minuto 1: fin+3 o más → −0,2 (cada 20 s como mucho).
//   - En el último minuto solo baja: subir ya no le da tiempo al pulso a responder.
//   - Nunca más rápido que vmax ni más lento que vmin; si en vmin sigue alto, alarma. Desde el 12-11 vmax ya no es el
//     ritmo del Plan sino el del sistema de encima (él: «prefiero que salga el estímulo»): en cinta manda el pulso.
//   - Sin pulso: la velocidad se queda quieta.

export const ESPERA_S = 40, ESPERA_EMERGENCIA_S = 20, MARGEN_ARRANQUE = 5;

export function objetivoPulso(fin, tPaso, durPaso, desde = 120) {
  const frac = durPaso > desde ? Math.min(1, Math.max(0, (tPaso - desde) / (durPaso - desde))) : 1;
  return fin - MARGEN_ARRANQUE * (1 - frac);
}

// e = {t: s de reloj, tPaso: s activos en el paso, durPaso: s, fc: media de los últimos 10 s o null,
//      vel: km/h que se está pidiendo ahora, fin, vmax, vmin, desde}
// estado = {ultimo: s del último ajuste automático (o manual)}
// Devuelve {delta, motivo, alarma}. delta en km/h (0, ±0,1, −0,2); ya respeta vmax/vmin.
export function decidir(e, estado) {
  const desde = e.desde ?? 120;
  if (e.fc == null || e.fc < 60 || e.fc > 215) return { delta: 0, motivo: "sin pulso: velocidad quieta", alarma: false };
  const desdeUltimo = estado.ultimo == null ? Infinity : e.t - estado.ultimo;
  let delta = 0, motivo = "";
  const objetivo = objetivoPulso(e.fin, e.tPaso, e.durPaso, desde);

  if (e.tPaso >= 60 && e.fc >= e.fin + 3 && desdeUltimo >= ESPERA_EMERGENCIA_S) {
    delta = -0.2; motivo = `pulso ${e.fc} ≥ ${e.fin + 3}`;
  } else if (e.tPaso >= desde && desdeUltimo >= ESPERA_S) {
    const err = e.fc - objetivo;
    const quedan = e.durPaso - e.tPaso;
    if (err > 5) { delta = -0.2; motivo = `pulso ${e.fc}, objetivo ${Math.round(objetivo)}`; }
    else if (err > 1.5) { delta = -0.1; motivo = `pulso ${e.fc}, objetivo ${Math.round(objetivo)}`; }
    else if (err < -4 && quedan > 60) { delta = 0.1; motivo = `pulso ${e.fc}, objetivo ${Math.round(objetivo)}`; }
  }
  if (!delta) return { delta: 0, motivo: "", alarma: false };

  const nueva = Math.round((e.vel + delta) * 10) / 10;
  const acotada = Math.min(e.vmax, Math.max(e.vmin, nueva));
  const real = Math.round((acotada - e.vel) * 10) / 10;
  const alarma = delta < 0 && real === 0 && e.fc > objetivo + 3; // ya en el mínimo y sigue alto
  return { delta: real, motivo: real ? motivo : (alarma ? `pulso ${e.fc} alto incluso al ritmo más lento permitido` : ""), alarma };
}
