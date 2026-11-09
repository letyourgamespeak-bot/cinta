// Prueba del control por pulso con un atleta simulado: node prueba_control.mjs
// Modelo (inventado, solo para probar el control): pulso estable = 48 + 8·v + calor + deriva; cinética de 35 s al
// subir y 50 s al bajar; deriva +0,45 ppm/min por encima de 13 km/h, −0,3 por debajo.
import { decidir } from "./control_pulso.js";

function sesion({ calor, fines = [172, 174, 176], v0 = 15.3, vmax = 15.5, vmin = 14.1, cortePulso = null }) {
  let fc = 70, deriva = 0, t = 0, vel = 10.5, estado = { ultimo: null }, buf = [];
  const filas = [], alarmas = [];
  const correr = (seg, vObj, ctrl) => {
    if (vObj != null) vel = vObj;
    for (let s = 0; s < seg; s++, t++) {
      const ss = 48 + 8 * vel + calor + deriva;
      fc += (ss - fc) / (ss > fc ? 35 : 50);
      deriva = Math.max(0, deriva + (vel > 13 ? 0.45 : -0.3) / 60);
      const sinPulso = cortePulso && t >= cortePulso[0] && t < cortePulso[1];
      buf.push(sinPulso ? null : fc); if (buf.length > 10) buf.shift();
      const vals = buf.filter(x => x != null);
      const fcMed = vals.length >= 5 ? Math.round(vals.reduce((a, b) => a + b) / vals.length) : null;
      if (ctrl) {
        const r = decidir({ t, tPaso: s, durPaso: seg, fc: fcMed, vel, fin: ctrl.fin, vmax, vmin }, estado);
        if (r.delta) { vel = Math.round((vel + r.delta) * 10) / 10; estado.ultimo = t; }
        if (r.alarma) alarmas.push(t);
        if (s % 60 === 59) ctrl.minutos.push(`${Math.round(fc)}@${vel.toFixed(1)}`);
      }
    }
    return vel;
  };
  correr(480, 10.5); correr(240, 11.5);
  let v = v0;
  fines.forEach((fin, i) => {
    const ctrl = { fin, minutos: [] };
    v = correr(480, v, ctrl);
    filas.push(`serie ${i + 1} (fin ${fin}): ${ctrl.minutos.join(" ")}  → acaba a ${Math.round(fc)} ppm, ${v.toFixed(1)} km/h`);
    correr(120, 9.0);
    estado.ultimo = null;
  });
  return { filas, alarmas: alarmas.length };
}

for (const [nombre, op] of [["sótano (calor +6)", { calor: 6 }], ["fresco (calor 0)", { calor: 0 }],
                            ["mucho calor (+14)", { calor: 14 }], ["sótano, banda caída min 3-4 de la serie 1", { calor: 6, cortePulso: [900, 960] }]]) {
  const r = sesion(op); console.log("== " + nombre); r.filas.forEach(f => console.log("  " + f)); console.log("  alarmas:", r.alarmas);
}
