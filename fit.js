// Codificador mínimo de archivos FIT de actividad (carrera en cinta), sin dependencias.
// Números de campo sacados del perfil oficial de Garmin (garmin-fit-sdk) el 2026-11-06.
// Uso: crearFIT(sesion) -> Uint8Array. sesion = {inicio: ms epoch, muestras: [...], vueltas: [...]}
//   muestra: {t: ms epoch, dist: metros acumulados, vel: km/h, fc: ppm|null}
//   vuelta:  {inicio: ms, fin: ms, nombre, disparo: "tiempo"|"distancia"|"manual"}

const FIT_EPOCH = 631065600; // 1989-12-31T00:00:00Z en segundos Unix
const ts = ms => Math.round(ms / 1000) - FIT_EPOCH;

// Tipos base: [código, bytes, valor no válido]
const T = {
  enum: [0x00, 1, 0xFF], uint8: [0x02, 1, 0xFF], uint16: [0x84, 2, 0xFFFF],
  uint32: [0x86, 4, 0xFFFFFFFF], uint32z: [0x8C, 4, 0], string: [0x07, 0, 0],
};

const CRC_TABLA = [0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401,
                   0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400];
function crc(bytes, c = 0) {
  for (const b of bytes) {
    let t = CRC_TABLA[c & 0xF]; c = (c >> 4) & 0x0FFF; c = c ^ t ^ CRC_TABLA[b & 0xF];
    t = CRC_TABLA[c & 0xF]; c = (c >> 4) & 0x0FFF; c = c ^ t ^ CRC_TABLA[(b >> 4) & 0xF];
  }
  return c;
}

class Escritor {
  constructor() { this.b = []; this.defs = {}; }
  u8(v) { this.b.push(v & 0xFF); }
  u16(v) { this.u8(v); this.u8(v >> 8); }
  u32(v) { this.u16(v & 0xFFFF); this.u16(Math.floor(v / 65536)); }
  // campos: [[num, tipo, bytesSiString]]
  definir(local, global, campos) {
    this.u8(0x40 | local); this.u8(0); this.u8(0); this.u16(global); this.u8(campos.length);
    for (const [num, tipo, n] of campos) { this.u8(num); this.u8(tipo === "string" ? n : T[tipo][1]); this.u8(T[tipo][0]); }
    this.defs[local] = campos;
  }
  dato(local, valores) {
    this.u8(local);
    this.defs[local].forEach(([, tipo, n], i) => {
      let v = valores[i];
      if (tipo === "string") {
        const enc = new TextEncoder().encode(v || ""); for (let k = 0; k < n; k++) this.u8(k < enc.length && k < n - 1 ? enc[k] : 0); return;
      }
      if (v === null || v === undefined || Number.isNaN(v)) v = T[tipo][2];
      if (T[tipo][1] === 1) this.u8(v); else if (T[tipo][1] === 2) this.u16(v); else this.u32(v);
    });
  }
}

// Calorías (COROS no las calcula en un archivo importado: usa las del archivo, comprobado el 10-11).
// Por RITMO, no por pulso: en el sótano el pulso sale inflado por el calor y engordaría la cifra. Ajustado el 10-11 a lo
// que COROS le da en la CALLE (32 carreras del 01-10 al 08-11): ~66 kcal/km a 5:00 o más lento, y 0,2 kcal/km más por
// cada segundo por debajo de 5:00 (a 3:59, ~78). Error típico ±4,5 kcal/km. Hasta el 10-11 iba por pulso calibrado
// a la cinta del reloj (0,71 × Keytel) y daba ~30 % menos que la calle: 515 kcal en el 3×8′ (él: «me parecen pocas»).
const KCAL_KM = 66, KCAL_POR_S = 0.2;
function kcalPaso(m, seg) {
  const v = m.vel || 0;
  if (v < 1) return 0;
  const ritmo = 3600 / v;
  return v / 3600 * seg * (KCAL_KM + KCAL_POR_S * Math.max(0, 300 - ritmo));
}

const vms = kmh => Math.round(kmh / 3.6 * 1000); // km/h -> m/s * 1000

function resumen(muestras, desde, hasta) {
  // Una muestra en el instante exacto del cambio cierra la vuelta anterior: cada vuelta toma (desde, hasta].
  const m = muestras.filter(x => x.t > desde && x.t <= hasta);
  if (!m.length) return { kcal: 0, dist: 0, vMed: 0, vMax: 0, fcMed: null, fcMax: null };
  const antes = muestras.filter(x => x.t <= desde).pop();
  const dist = m[m.length - 1].dist - (antes ? antes.dist : 0);
  const seg = (hasta - desde) / 1000;
  const fcs = m.map(x => x.fc).filter(x => x > 0);
  let kcal = 0, prev = antes;
  for (const x of m) { if (prev) kcal += kcalPaso(x, Math.min(2, (x.t - prev.t) / 1000)); prev = x; } // un hueco de pausa no suma
  return {
    kcal: Math.round(kcal),
    dist: Math.max(0, dist),
    vMed: seg > 0 ? dist / seg * 3.6 : 0,
    vMax: Math.max(...m.map(x => x.vel || 0)),
    fcMed: fcs.length ? Math.round(fcs.reduce((a, b) => a + b, 0) / fcs.length) : null,
    fcMax: fcs.length ? Math.max(...fcs) : null,
  };
}

export function crearFIT(sesion) {
  const { muestras, vueltas } = sesion;
  const t0 = sesion.inicio, t1 = muestras[muestras.length - 1].t;
  const w = new Escritor();
  const disparo = { tiempo: 1, distancia: 2, manual: 0 };

  w.definir(0, 0, [[0, "enum"], [1, "uint16"], [2, "uint16"], [3, "uint32z"], [4, "uint32"]]);
  w.dato(0, [4, 255, 1, 1106, ts(t0)]); // actividad, fabricante «development»

  // El nombre del entreno va en tres sitios, porque no consta cuál lee COROS para el título (por probar, 09-11):
  // el deporte (sport.name), un mensaje de entreno (workout.wkt_name) y la sesión (sport_profile_name).
  const nombre = sesion.nombre || "Cinta";
  w.definir(1, 12, [[0, "enum"], [1, "enum"], [3, "string", 48]]);
  w.dato(1, [1, 1, nombre]); // carrera, en cinta
  w.definir(7, 26, [[4, "enum"], [8, "string", 48]]);
  w.dato(7, [1, nombre]);

  w.definir(2, 21, [[253, "uint32"], [0, "enum"], [1, "enum"]]);
  w.dato(2, [ts(t0), 0, 0]); // temporizador: empieza

  w.definir(3, 20, [[253, "uint32"], [3, "uint8"], [5, "uint32"], [6, "uint16"], [73, "uint32"]]);
  for (const m of muestras) {
    const v = vms(m.vel || 0);
    w.dato(3, [ts(m.t), m.fc > 0 ? m.fc : null, Math.round(m.dist * 100), Math.min(v, 0xFFFE), v]);
  }

  w.dato(2, [ts(t1), 0, 4]); // temporizador: se para

  w.definir(4, 19, [[253, "uint32"], [0, "enum"], [1, "enum"], [2, "uint32"], [7, "uint32"], [8, "uint32"],
    [9, "uint32"], [13, "uint16"], [14, "uint16"], [15, "uint8"], [16, "uint8"], [24, "enum"], [25, "enum"],
    [39, "enum"], [254, "uint16"], [110, "uint32"], [111, "uint32"], [11, "uint16"]]);
  vueltas.forEach((v, i) => {
    const r = resumen(muestras, v.inicio, v.fin), dur = Math.round(v.fin - v.inicio);
    w.dato(4, [ts(v.fin), 9, 1, ts(v.inicio), dur, dur, Math.round(r.dist * 100), vms(r.vMed), vms(r.vMax),
      r.fcMed, r.fcMax, disparo[v.disparo] ?? 0, 1, 1, i, vms(r.vMed), vms(r.vMax), r.kcal]);
  });

  const r = resumen(muestras, t0, t1), dur = Math.round(t1 - t0);
  w.definir(5, 18, [[253, "uint32"], [0, "enum"], [1, "enum"], [2, "uint32"], [5, "enum"], [6, "enum"],
    [7, "uint32"], [8, "uint32"], [9, "uint32"], [14, "uint16"], [15, "uint16"], [16, "uint8"], [17, "uint8"],
    [25, "uint16"], [26, "uint16"], [28, "enum"], [254, "uint16"], [124, "uint32"], [125, "uint32"], [11, "uint16"],
    [110, "string", 48]]);
  w.dato(5, [ts(t1), 8, 1, ts(t0), 1, 1, dur, dur, Math.round(r.dist * 100), vms(r.vMed), vms(r.vMax),
    r.fcMed, r.fcMax, 0, vueltas.length, 0, 0, vms(r.vMed), vms(r.vMax), r.kcal, nombre]);

  const local = ts(t1) - new Date(t1).getTimezoneOffset() * 60;
  w.definir(6, 34, [[253, "uint32"], [0, "uint32"], [1, "uint16"], [2, "enum"], [3, "enum"], [4, "enum"], [5, "uint32"]]);
  w.dato(6, [ts(t1), dur, 1, 0, 26, 1, local]);

  const datos = new Uint8Array(w.b);
  const cab = new Uint8Array(14);
  const dv = new DataView(cab.buffer);
  dv.setUint8(0, 14); dv.setUint8(1, 0x20); dv.setUint16(2, 2132, true); dv.setUint32(4, datos.length, true);
  cab.set([0x2E, 0x46, 0x49, 0x54], 8); dv.setUint16(12, crc(cab.subarray(0, 12)), true);
  const fin = new Uint8Array(14 + datos.length + 2);
  fin.set(cab); fin.set(datos, 14);
  const c = crc(datos);
  fin[fin.length - 2] = c & 0xFF; fin[fin.length - 1] = c >> 8;
  return fin;
}
