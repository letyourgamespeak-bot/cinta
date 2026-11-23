// Prueba del control por pulso con un atleta simulado: node prueba_control.mjs
// Modelo (inventado, solo para probar el control): pulso estable = 48 + 8·v + calor + deriva; cinética de 35 s al
// subir y 50 s al bajar; deriva +0,45 ppm/min por encima de 13 km/h, −0,3 por debajo.
import { decidir } from "./control_pulso.js";

function sesion({ calor, fines = [172, 174, 176], v0 = 15.3, vmax = 15.5, vmin = 14.1, cortePulso = null, heredar = "media", serieS = 480, derivaMin = 0.45 }) {
  let fc = 70, deriva = 0, t = 0, vel = 10.5, estado = { ultimo: null }, buf = [];
  const filas = [], alarmas = [];
  const correr = (seg, vObj, ctrl) => {
    if (vObj != null) vel = vObj;
    let suma = 0;
    for (let s = 0; s < seg; s++, t++) {
      const ss = 48 + 8 * vel + calor + deriva;
      fc += (ss - fc) / (ss > fc ? 35 : 50);
      deriva = Math.max(0, deriva + (vel > 13 ? derivaMin : -0.3) / 60);
      const sinPulso = cortePulso && t >= cortePulso[0] && t < cortePulso[1];
      buf.push(sinPulso ? null : fc); if (buf.length > 10) buf.shift();
      const vals = buf.filter(x => x != null);
      const fcMed = vals.length >= 5 ? Math.round(vals.reduce((a, b) => a + b) / vals.length) : null;
      if (ctrl) {
        const r = decidir({ t, tPaso: s, durPaso: seg, fc: fcMed, vel, fin: ctrl.fin, vmax, vmin }, estado);
        if (r.delta) { vel = Math.round((vel + r.delta) * 10) / 10; estado.ultimo = t; }
        if (r.alarma) alarmas.push(t);
        if (s % 60 === 59) ctrl.minutos.push(`${Math.round(fc)}@${vel.toFixed(1)}`);
        ctrl.max = Math.max(ctrl.max || 0, fc);
      }
      suma += vel;
    }
    // Lo que hereda la serie siguiente: la media del bloque (app.js desde el 23-11) o, antes, la velocidad final.
    return heredar === "media" ? Math.round(suma / seg * 10) / 10 : vel;
  };
  correr(480, 10.5); correr(240, 11.5);
  let v = v0;
  fines.forEach((fin, i) => {
    const ctrl = { fin, minutos: [] };
    v = correr(serieS, v, ctrl);
    filas.push(`serie ${i + 1} (fin ${fin}): ${ctrl.minutos.join(" ")}  → acaba a ${Math.round(fc)} ppm (máx ${Math.round(ctrl.max)}), hereda ${v.toFixed(1)} km/h`);
    correr(120, 9.0);
    estado.ultimo = null;
  });
  return { filas, alarmas: alarmas.length };
}

for (const [nombre, op] of [["sótano (calor +6)", { calor: 6 }], ["fresco (calor 0)", { calor: 0 }],
                            ["mucho calor (+14)", { calor: 14 }], ["sótano, banda caída min 3-4 de la serie 1", { calor: 6, cortePulso: [900, 960] }]]) {
  const r = sesion(op); console.log("== " + nombre); r.filas.forEach(f => console.log("  " + f)); console.log("  alarmas:", r.alarmas);
}

// El caso del 2026-11-23: 2×10′ de ritmo 10K (fin 175/177, raíl 16,7 = 3:35, suelo 13,8 = 4:20), arranque 15,6.
for (const h of ["final", "media"]) {
  const r = sesion({ calor: 6, fines: [175, 177], v0: 15.6, vmax: 16.7, vmin: 13.8, heredar: h, serieS: 600 });
  console.log(`== 2×10′ ritmo 10K, heredando la velocidad ${h}`); r.filas.forEach(f => console.log("  " + f));
}

// Ajustado a SU sesión real del 23-11 (pulso más bajo al arrancar y deriva de ~1 ppm/min: el 1.º bloque fue de 145 a
// 171 mientras la app subía de 15,6 a 16,7, y el 2.º llegó a 181 a 16,7). Es una aproximación, no su fisiología.
for (const h of ["final", "media"]) {
  const r = sesion({ calor: -15, derivaMin: 1.0, fines: [175, 177], v0: 15.6, vmax: 16.7, vmin: 13.8, heredar: h, serieS: 600 });
  console.log(`== como el 23-11, heredando la velocidad ${h}`); r.filas.forEach(f => console.log("  " + f));
}
