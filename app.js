// Cinta: lleva entrenos de series en una cinta FTMS y graba la sesión para importarla en COROS.
// Órdenes que se mandan a la cinta: 0x00 (pedir control) y 0x02 (fijar velocidad), probadas el 2026-11-06,
// y 0x03 (inclinación) solo si un entreno la pide. Arrancar, pausar y parar se hacen SIEMPRE con los botones
// de la cinta: la app detecta la pausa al ver la velocidad a 0.
import { crearFIT } from "./fit.js";

const $ = id => document.getElementById(id);
const P = new URLSearchParams(location.search);
const SIMULAR = P.has("simular");
const ACEL = SIMULAR ? Number(P.get("x") || 1) : 1;      // solo en simulación: acelera el reloj
const T0 = Date.now();
const ahora = () => T0 + (Date.now() - T0) * ACEL;

// ---------- utilidades ----------
const coma = (x, d = 1) => x.toFixed(d).replace(".", ",");
const mmss = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(r).padStart(2, "0"); };
const ritmoDeKmh = v => v > 0.5 ? mmss(3600 / v) : "–";
const kmhDeRitmo = r => { const [m, s] = r.split(":").map(Number); return 3600 / (m * 60 + s); };
const r1 = v => Math.round(v * 10) / 10;
const limitar = v => Math.min(18, Math.max(1, r1(v)));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { aviso("No se pudo guardar en el móvil: " + e.message, true); return false; } };
const leer = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };

function aviso(t, malo) {
  const el = $("aviso"); el.textContent = t; el.className = malo ? "mal" : "ok"; el.hidden = false;
  clearTimeout(aviso.t); aviso.t = setTimeout(() => el.hidden = true, malo ? 8000 : 3500);
}

// ---------- sonido y vibración ----------
let audio = null;
function pitido(ms = 120, hz = 880) {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = hz; g.gain.value = 0.25; o.connect(g); g.connect(audio.destination);
    o.start(); o.stop(audio.currentTime + ms / 1000);
  } catch {}
}
const vibrar = p => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };

// ---------- pantalla encendida ----------
let bloqueo = null;
async function pantallaEncendida() {
  if (!("wakeLock" in navigator)) return;
  try { if (!bloqueo || bloqueo.released) bloqueo = await navigator.wakeLock.request("screen"); } catch {}
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pantallaEncendida(); });

// ---------- la cinta ----------
function leerTreadmillData(dv) {
  const f = dv.getUint16(0, true); let i = 2; const r = {};
  if (!(f & 1)) { r.vel = dv.getUint16(i, true) / 100; i += 2; }
  if (f & 2) i += 2;
  if (f & 4) { r.dist = dv.getUint16(i, true) + (dv.getUint8(i + 2) << 16); i += 3; }
  if (f & 8) { r.incl = dv.getInt16(i, true) / 10; i += 4; }
  if (f & 16) i += 4;
  if (f & 32) i += 1;
  if (f & 64) i += 1;
  if (f & 128) i += 5;
  if (f & 256) { r.fc = dv.getUint8(i); i += 1; }
  return r;
}

class CintaBLE {
  constructor() { this.dato = {}; this.cola = Promise.resolve(); this.conControl = false; this.conectada = false; this.alCambiar = () => {}; }
  async conectar() {
    this.disp = await navigator.bluetooth.requestDevice({ filters: [{ services: [0x1826] }, { namePrefix: "REEBOK" }], optionalServices: [0x1826] });
    this.disp.addEventListener("gattserverdisconnected", () => { this.conectada = false; this.conControl = false; this.alCambiar(); });
    await this.abrir();
  }
  async abrir() {
    const srv = await this.disp.gatt.connect();
    const ftms = await srv.getPrimaryService(0x1826);
    const td = await ftms.getCharacteristic(0x2ACD);
    td.addEventListener("characteristicvaluechanged", e => { Object.assign(this.dato, leerTreadmillData(e.target.value)); this.dato.t = ahora(); });
    await td.startNotifications();
    this.cp = await ftms.getCharacteristic(0x2AD9);
    this.cp.addEventListener("characteristicvaluechanged", e => {
      const v = e.target.value;
      if (v.getUint8(0) === 0x80 && v.getUint8(2) !== 0x01) aviso(`La cinta rechazó la orden ${v.getUint8(1)} (código ${v.getUint8(2)})`, true);
    });
    await this.cp.startNotifications();
    this.conectada = true; this.alCambiar();
  }
  async reconectar() { if (this.disp && !this.conectada) await this.abrir(); }
  escribir(bytes) {
    this.cola = this.cola.then(() => this.cp.writeValueWithResponse(new Uint8Array(bytes))).catch(e => aviso("Orden a la cinta: " + e.message, true));
    return this.cola;
  }
  async control() { if (!this.conControl) { await this.escribir([0x00]); this.conControl = true; } }
  async velocidad(kmh) { if (!this.conectada) return; await this.control(); const v = Math.round(limitar(kmh) * 100); await this.escribir([0x02, v & 255, v >> 8]); }
  async inclinacion(p) { if (!this.conectada) return; await this.control(); const v = Math.round(Math.min(15, Math.max(0, p)) * 10); await this.escribir([0x03, v & 255, (v >> 8) & 255]); }
  get nombre() { return this.disp ? this.disp.name : ""; }
}

// Cinta de mentira para probar sin aparato (?simular). Acelera a 1 km/h por segundo, como la de verdad.
class CintaSimulada {
  constructor() { this.dato = { vel: 0, dist: 0, incl: 0 }; this.obj = 0; this.conectada = false; this.alCambiar = () => {}; this.d = 0; }
  async conectar() {
    this.conectada = true; this.alCambiar(); let t = ahora();
    setInterval(() => {
      const n = ahora(), dt = (n - t) / 1000; t = n;
      const v = this.dato.vel, paso = 1 * dt;
      this.dato.vel = r1(Math.abs(this.obj - v) <= paso ? this.obj : v + Math.sign(this.obj - v) * paso);
      this.d += this.dato.vel / 3.6 * dt; this.dato.dist = Math.floor(this.d); this.dato.t = n;
    }, 500 / ACEL);
  }
  async reconectar() {}
  async velocidad(kmh) { this.obj = limitar(kmh); }
  async inclinacion(p) { this.dato.incl = p; }
  botonCinta(kmh) { this.obj = kmh; }          // simula los botones físicos (arrancar / parar)
  get nombre() { return "Cinta simulada"; }
}

// ---------- el pulso ----------
class PulsoBLE {
  constructor() { this.fc = null; this.conectado = false; this.alCambiar = () => {}; }
  async conectar() {
    this.disp = await navigator.bluetooth.requestDevice({ filters: [{ services: ["heart_rate"] }] });
    this.disp.addEventListener("gattserverdisconnected", () => { this.conectado = false; this.fc = null; this.alCambiar(); setTimeout(() => this.reconectar(), 2000); });
    await this.abrir();
  }
  async abrir() {
    const srv = await this.disp.gatt.connect();
    const c = await (await srv.getPrimaryService("heart_rate")).getCharacteristic("heart_rate_measurement");
    c.addEventListener("characteristicvaluechanged", e => { const v = e.target.value; this.fc = (v.getUint8(0) & 1) ? v.getUint16(1, true) : v.getUint8(1); this.tfc = ahora(); });
    await c.startNotifications(); this.conectado = true; this.alCambiar();
  }
  async reconectar() { try { if (!this.conectado) await this.abrir(); } catch { setTimeout(() => this.reconectar(), 3000); } }
  get valor() { return this.fc && ahora() - this.tfc < 5000 ? this.fc : null; }
  get nombre() { return this.disp ? this.disp.name : ""; }
}
class PulsoSimulado {
  constructor() { this.conectado = false; this.alCambiar = () => {}; }
  async conectar() { this.conectado = true; this.alCambiar(); }
  get valor() { const v = cinta.dato.vel || 0; return Math.round(95 + v * 4.5 + Math.sin(ahora() / 9000) * 3); }
  get nombre() { return "Pulso simulado"; }
}

const cinta = SIMULAR ? new CintaSimulada() : new CintaBLE();
const pulso = SIMULAR ? new PulsoSimulado() : new PulsoBLE();

// ---------- biblioteca ----------
const NOMBRE_TIPO = { calentamiento: "Calentamiento", serie: "Serie", recuperacion: "Recuperación", calma: "Vuelta a la calma", cuesta: "Cuesta", rodaje: "Rodaje" };

function expandir(entreno) {
  const lista = [];
  const meter = (p, i, n) => {
    const kmh = p.ritmo ? limitar(kmhDeRitmo(p.ritmo)) : p.kmh ? limitar(p.kmh) : null;
    const base = NOMBRE_TIPO[p.tipo] || p.tipo || "Paso";
    lista.push({
      nombre: p.nombre || (n > 1 && ["serie", "recuperacion", "cuesta"].includes(p.tipo) ? `${base} ${i}/${n}` : base),
      tipo: p.tipo, kmh, incl: p.incl ?? null, libre: !!p.libre,
      s: p.min ? p.min * 60 : p.s || null, m: p.m || null,
    });
  };
  const recorrer = (pasos, i, n) => pasos.forEach(p => {
    if (p.repetir) for (let k = 1; k <= p.repetir; k++) recorrer(p.pasos, k, p.repetir);
    else meter(p, i, n);
  });
  recorrer(entreno.pasos, 1, 1);
  return lista;
}

function duracionEstimada(pasos) {
  let s = 0, libres = 0;
  for (const p of pasos) { if (p.libre) libres++; else if (p.s) s += p.s; else if (p.m && p.kmh) s += p.m / (p.kmh / 3.6); }
  return mmss(s).replace(/:\d\d$/, "") + " min" + (libres ? " + " + libres + " libre" + (libres > 1 ? "s" : "") : "");
}

function describirPaso(p) {
  const dur = p.libre ? "libre" : p.s ? mmss(p.s) : p.m ? (p.m >= 1000 ? coma(p.m / 1000, 2) + " km" : p.m + " m") : "";
  const int = p.kmh ? `${coma(p.kmh)} km/h · ${ritmoDeKmh(p.kmh)}/km` : "a tu aire";
  return `${dur} · ${int}${p.incl ? " · " + p.incl + " %" : ""}`;
}

let entrenos = [];
async function cargarBiblioteca() {
  try {
    const r = await fetch("entrenos.json", { cache: "no-store" });
    entrenos = (await r.json()).entrenos;
    guardar("cinta.biblioteca", entrenos);
  } catch { entrenos = leer("cinta.biblioteca", []); if (entrenos.length) aviso("Sin conexión: uso la última biblioteca descargada", true); }
  pintarInicio();
}

// ---------- pantallas ----------
function mostrar(id) { for (const s of document.querySelectorAll("section")) s.hidden = s.id !== id; window.scrollTo(0, 0); }

function pintarConexiones() {
  const bc = $("bCinta"), bp = $("bPulso");
  bc.className = cinta.conectada ? "hecho" : ""; bc.textContent = cinta.conectada ? "Cinta ✓ " + cinta.nombre : "Conectar cinta";
  bp.className = pulso.conectado ? "hecho" : ""; bp.textContent = pulso.conectado ? "Pulso ✓ " + pulso.nombre : "Conectar pulso";
  $("simBotones").hidden = !SIMULAR;
}
cinta.alCambiar = () => { pintarConexiones(); if (sesion && !cinta.conectada) alarmaDesconexion(); };
pulso.alCambiar = pintarConexiones;

function pintarInicio() {
  pintarConexiones();
  $("lista").innerHTML = entrenos.map((e, i) => {
    const pasos = expandir(e);
    return `<button class="entreno" data-i="${i}"><b>${esc(e.nombre)}</b><span>${duracionEstimada(pasos)} · ${pasos.length} pasos</span></button>`;
  }).join("") || `<p class="suave">La biblioteca está vacía.</p>`;
  for (const b of document.querySelectorAll(".entreno")) b.onclick = () => pintarDetalle(entrenos[b.dataset.i]);
  const ses = leer("cinta.sesiones", []);
  $("sesiones").innerHTML = ses.length ? ses.slice().reverse().map(s => {
    const f = new Date(s.inicio);
    return `<div class="sesion"><div><b>${esc(s.nombre)}</b><span>${f.toLocaleDateString("es-ES")} ${f.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })} · ${coma(conEscala(s).muestras.at(-1)[1] / 1000, 2)} km</span></div><button class="mini" data-id="${s.id}">FIT</button></div>`;
  }).join("") : `<p class="suave">Aún no hay sesiones.</p>`;
  for (const b of document.querySelectorAll(".sesion .mini")) b.onclick = () => descargarFIT(leer("cinta.sesiones", []).find(s => s.id == b.dataset.id));
  const pend = leer("cinta.encurso", null);
  $("recuperar").hidden = !pend;
  if (pend) $("recuperarTxt").textContent = `Hay una sesión sin guardar: ${pend.nombre}, ${new Date(pend.inicio).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}.`;
  mostrar("inicio");
}

let elegido = null;
function pintarDetalle(e) {
  elegido = e; const pasos = expandir(e);
  $("dTitulo").textContent = e.nombre;
  $("dNota").textContent = e.nota || "";
  $("dPasos").innerHTML = pasos.map((p, i) => `<li><b>${esc(p.nombre)}</b><span>${describirPaso(p)}</span></li>`).join("");
  $("dTotal").textContent = duracionEstimada(pasos);
  mostrar("detalle");
}

// ---------- el entreno en marcha ----------
let sesion = null, motor = null;

function empezar() {
  if (!cinta.conectada) { aviso("Conecta antes la cinta", true); return; }
  if (!(cinta.dato.vel > 0)) { aviso("Arranca antes la cinta con su botón: la app la lleva desde ahí", true); return; }
  pitido(1, 440); pantallaEncendida();
  const pasos = expandir(elegido);
  const t = ahora();
  sesion = { id: t, nombre: elegido.nombre, inicio: t, muestras: [], vueltas: [], distBase: cinta.dato.dist ?? 0 };
  motor = { pasos, i: -1, bajada: (elegido.bajada_s ?? 20) * 1000, pausado: false, ceroDesde: null, activoPaso: 0, ultimo: t,
            pitado: 99, ultimaMuestra: 0, ultimoEnvio: 0, enviado: null, rampa: null, reaplicar: 0, terminado: false, distSim: 0 };
  avanzar();
  mostrar("entreno");
  motor.reloj = setInterval(tick, 200 / ACEL);
}

function distSesion() {
  // La distancia la manda la cinta; si no la mandara, se integra la velocidad.
  // Su unidad NO se da por buena: la Reebok FR20z manda decámetros donde FTMS dice metros (09-11: 0,89 km en 50′ a
  // 10,9 km/h). Se compara con la velocidad integrada a partir de 150 m y, si sale ~10 veces menos, se multiplica.
  if (cinta.dato.dist === undefined) return motor.distSim;
  const bruto = Math.max(0, cinta.dato.dist - sesion.distBase);
  if (!motor.escalaDist) {
    if (motor.distSim < 150) return motor.distSim;
    motor.escalaDist = bruto > 0 && bruto / motor.distSim < 0.3 ? 10 : 1;
  }
  return bruto * motor.escalaDist;
}

// Sesiones ya guardadas con la distancia de la cinta sin corregir: se recalcula la escala con su propia velocidad.
function conEscala(s) {
  let integrada = 0;
  for (let k = 1; k < s.muestras.length; k++) integrada += s.muestras[k][2] / 3.6 * (s.muestras[k][0] - s.muestras[k - 1][0]) / 1000;
  const d = s.muestras.at(-1)[1];
  if (!(integrada > 150 && d > 0 && d / integrada < 0.3)) return s;
  return { ...s, muestras: s.muestras.map(([t, dist, vel, fc]) => [t, dist * 10, vel, fc]) };
}

function avanzar() {
  const t = ahora(), M = motor;
  if (M.i >= 0) {
    const p = M.pasos[M.i];
    sesion.vueltas.push({ inicio: M.inicioPaso, fin: t, nombre: p.nombre, disparo: p.libre ? "manual" : p.m ? "distancia" : "tiempo" });
  }
  M.i++;
  if (M.i >= M.pasos.length) return completar();
  const p = M.pasos[M.i], ant = M.pasos[M.i - 1];
  M.inicioPaso = t; M.activoPaso = 0; M.distInicioPaso = distSesion(); M.pitado = 99; M.ajuste = 0;
  M.rampa = null;
  if (p.kmh) {
    const desde = cinta.dato.vel || (ant && ant.kmh) || p.kmh;
    if (desde > p.kmh + 0.15 && M.bajada > 0) M.rampa = { desde, hasta: p.kmh, t0: t };
    else mandar(p.kmh);
  }
  if (p.incl !== null) cinta.inclinacion(p.incl);
  else if (ant && ant.incl) cinta.inclinacion(0);
  if (M.i > 0) { pitido(450, 660); vibrar([300]); }
  if (sesion) guardar("cinta.encurso", sesion);
}

function objetivo() {
  const p = motor.pasos[motor.i];
  return p && p.kmh ? limitar(p.kmh + motor.ajuste) : null;
}

function mandar(kmh) { motor.enviado = limitar(kmh); motor.ultimoEnvio = ahora(); cinta.velocidad(motor.enviado); }

function tick() {
  const t = ahora(), M = motor, dt = t - M.ultimo; M.ultimo = t;
  if (M.terminado) return pintarEntreno();
  const v = cinta.dato.vel ?? 0;

  // Pausa: la detecta la app al ver la cinta parada (se para con su botón).
  if (v === 0 && cinta.conectada) { M.ceroDesde = M.ceroDesde || t; if (t - M.ceroDesde > 1500 && !M.pausado) { M.pausado = true; vibrar([100, 100, 100]); } }
  else if (v > 0) { M.ceroDesde = null; if (M.pausado) { M.pausado = false; M.reaplicar = t + 2500; } }

  if (!M.pausado) {
    M.activoPaso += dt;
    M.distSim += v / 3.6 * dt / 1000;
    if (t - M.ultimaMuestra >= 1000) {
      M.ultimaMuestra = t;
      sesion.muestras.push([t, Math.round(distSesion() * 10) / 10, v, pulso.valor]);
      if (sesion.muestras.length % 10 === 0) guardar("cinta.encurso", sesion);
    }
  }

  const p = M.pasos[M.i];
  // Bajada progresiva: de la velocidad de la serie a la nueva, en línea recta durante «bajada_s».
  if (M.rampa && !M.pausado) {
    const f = Math.min(1, (t - M.rampa.t0) / M.bajada);
    const vObj = r1(M.rampa.desde + (M.rampa.hasta + M.ajuste - M.rampa.desde) * f);
    if (vObj !== M.enviado && t - M.ultimoEnvio >= 450) mandar(vObj);
    if (f >= 1) { M.rampa = null; mandar(objetivo()); }
  }
  if (M.reaplicar && t >= M.reaplicar) { M.reaplicar = 0; if (objetivo()) mandar(objetivo()); }

  // ¿Se acabó el paso?
  let falta = null;
  if (p.s) falta = p.s - M.activoPaso / 1000;
  else if (p.m) falta = (p.m - (distSesion() - M.distInicioPaso)) / Math.max(v / 3.6, 0.5);
  if (falta !== null && !M.pausado) {
    const seg = Math.ceil(falta);
    if (seg <= 3 && seg >= 1 && seg < M.pitado) { M.pitado = seg; pitido(110, 880); }
    if (p.s ? falta <= 0 : distSesion() - M.distInicioPaso >= p.m) avanzar();
  }
  pintarEntreno();
}

function pintarEntreno() {
  const M = motor, p = M.pasos[Math.min(M.i, M.pasos.length - 1)], v = cinta.dato.vel ?? 0, fc = pulso.valor;
  if (M.terminado) {
    $("ePaso").textContent = "Entreno completado";
    $("eQueda").textContent = "✓";
    $("eObj").textContent = "Para la cinta con su botón y pulsa «Guardar»";
  } else {
    $("ePaso").textContent = `${p.nombre}`;
    $("eNum").textContent = `paso ${M.i + 1} de ${M.pasos.length}`;
    if (p.libre) $("eQueda").textContent = mmss(M.activoPaso / 1000);
    else if (p.s) $("eQueda").textContent = mmss(p.s - M.activoPaso / 1000);
    else $("eQueda").textContent = Math.max(0, Math.round(p.m - (distSesion() - M.distInicioPaso))) + " m";
    const o = objetivo();
    $("eObj").textContent = M.pausado ? "EN PAUSA · arranca la cinta para seguir"
      : o ? `Objetivo ${coma(o)} km/h · ${ritmoDeKmh(o)}/km${M.rampa ? " · bajando…" : ""}${M.ajuste ? ` (ajuste ${M.ajuste > 0 ? "+" : ""}${coma(M.ajuste)})` : ""}`
      : p.libre ? "Libre · pulsa «Siguiente» cuando acabes" : "A tu aire";
    const sig = M.pasos[M.i + 1];
    $("eSig").textContent = sig ? `Después: ${sig.nombre} · ${describirPaso(sig)}` : "Último paso";
  }
  $("eVel").textContent = coma(v);
  $("eRitmo").textContent = ritmoDeKmh(v);
  $("eFc").textContent = fc ?? "–";
  $("eDist").textContent = coma(distSesion() / 1000, 2);
  $("eTotal").textContent = mmss(((M.tFin || ahora()) - sesion.inicio) / 1000);
  $("entreno").classList.toggle("pausa", M.pausado);
  $("bTerminar").textContent = M.terminado ? "Guardar" : $("bTerminar").dataset.armado ? "¿Seguro? Pulsa otra vez" : "Terminar";
  $("bSig").disabled = M.terminado;
}

function completar() {
  motor.terminado = true; motor.tFin = ahora(); pitido(800, 990); vibrar([400, 150, 400]);
  guardar("cinta.encurso", sesion);
}

function cerrarSesion() {
  clearInterval(motor.reloj);
  if (!motor.terminado) {
    const p = motor.pasos[motor.i];
    sesion.vueltas.push({ inicio: motor.inicioPaso, fin: ahora(), nombre: p.nombre, disparo: "manual" });
  }
  const s = { id: sesion.id, nombre: sesion.nombre, inicio: sesion.inicio, muestras: sesion.muestras, vueltas: sesion.vueltas };
  if (s.muestras.length < 2) { aviso("Sesión demasiado corta: no se guarda", true); localStorage.removeItem("cinta.encurso"); sesion = null; return pintarInicio(); }
  const todas = leer("cinta.sesiones", []); todas.push(s);
  if (guardar("cinta.sesiones", todas.slice(-15))) localStorage.removeItem("cinta.encurso");
  sesion = null; motor = null;
  pintarFinal(s);
}

function alarmaDesconexion() {
  aviso("¡CINTA DESCONECTADA! Sigue a la última velocidad: usa sus botones", true);
  pitido(900, 330); vibrar([600, 200, 600, 200, 600]);
  const intento = async () => {
    if (!sesion || cinta.conectada) return;
    try { await cinta.reconectar(); aviso("Cinta reconectada"); if (motor && objetivo()) mandar(objetivo()); }
    catch { setTimeout(intento, 2000); }
  };
  setTimeout(intento, 1500);
}

// ---------- final y archivo para COROS ----------
function vueltasResumen(s) {
  return s.vueltas.map(v => {
    const m = s.muestras.filter(x => x[0] > v.inicio && x[0] <= v.fin);
    const antes = s.muestras.filter(x => x[0] <= v.inicio).pop();
    const d = m.length ? m.at(-1)[1] - (antes ? antes[1] : 0) : 0;
    const fcs = m.map(x => x[3]).filter(Boolean);
    const seg = (v.fin - v.inicio) / 1000;
    return { nombre: v.nombre, seg, d, ritmo: d > 0 ? mmss(seg / (d / 1000)) : "–", fc: fcs.length ? Math.round(fcs.reduce((a, b) => a + b) / fcs.length) : "–" };
  });
}

function pintarFinal(s) {
  s = conEscala(s);
  const d = s.muestras.at(-1)[1], seg = (s.muestras.at(-1)[0] - s.inicio) / 1000;
  const fcs = s.muestras.map(x => x[3]).filter(Boolean);
  $("fResumen").innerHTML = `<div><b>${mmss(seg)}</b><span>tiempo</span></div><div><b>${coma(d / 1000, 2)}</b><span>km</span></div>
    <div><b>${d > 0 ? mmss(seg / (d / 1000)) : "–"}</b><span>/km medio</span></div><div><b>${fcs.length ? Math.round(fcs.reduce((a, b) => a + b) / fcs.length) : "–"}</b><span>ppm medio</span></div>`;
  $("fVueltas").innerHTML = vueltasResumen(s).map(v => `<tr><td>${esc(v.nombre)}</td><td>${mmss(v.seg)}</td><td>${coma(v.d / 1000, 2)}</td><td>${v.ritmo}</td><td>${v.fc}</td></tr>`).join("");
  $("bFit").onclick = () => descargarFIT(s);
  mostrar("final");
}

function descargarFIT(s) {
  s = conEscala(s);
  const fit = crearFIT({
    inicio: s.inicio,
    muestras: s.muestras.map(([t, dist, vel, fc]) => ({ t, dist, vel, fc })),
    vueltas: s.vueltas,
  });
  const f = new Date(s.inicio), dia = f.toISOString().slice(0, 10);
  const nombre = `Cinta ${dia} ${s.nombre}.fit`.replace(/[\/\\:*?"<>|]/g, "-");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([fit], { type: "application/octet-stream" })); a.download = nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  const kb = fit.length / 1024;
  aviso(kb < 20 ? `Descargado (${coma(kb)} KB). Ojo: COROS dice rechazar archivos de menos de 20 KB` : `Descargado: ${nombre} (${Math.round(kb)} KB)`, kb < 20);
}

// ---------- botones ----------
$("bCinta").onclick = async () => {
  if (!SIMULAR && !navigator.bluetooth) return aviso("Este navegador no tiene Bluetooth: ábrela en Chrome de Android", true);
  try { await cinta.conectar(); pantallaEncendida(); } catch (e) { if (e.name !== "NotFoundError") aviso("Cinta: " + e.message, true); }
};
$("bPulso").onclick = async () => {
  if (!SIMULAR && !navigator.bluetooth) return aviso("Este navegador no tiene Bluetooth", true);
  try { await pulso.conectar(); } catch (e) { if (e.name !== "NotFoundError") aviso("Pulso: " + e.message, true); }
};
$("bEmpezar").onclick = empezar;
$("bVolver").onclick = pintarInicio;
$("bSig").onclick = () => { if (motor && !motor.terminado) avanzar(); };
$("bMenos").onclick = () => { if (objetivo()) { motor.ajuste = r1(motor.ajuste - 0.1); if (!motor.rampa) mandar(objetivo()); } };
$("bMas").onclick = () => { if (objetivo()) { motor.ajuste = r1(motor.ajuste + 0.1); if (!motor.rampa) mandar(objetivo()); } };
$("bTerminar").onclick = () => {
  const b = $("bTerminar");
  if (motor.terminado || b.dataset.armado) { delete b.dataset.armado; return cerrarSesion(); }
  b.dataset.armado = "1"; setTimeout(() => delete b.dataset.armado, 4000);
};
$("bInicio").onclick = pintarInicio;
$("bRecGuardar").onclick = () => {
  const s = leer("cinta.encurso", null); if (!s) return;
  if (s.muestras.length < 2) { localStorage.removeItem("cinta.encurso"); return pintarInicio(); }
  // La última vuelta quedó abierta al cortarse: se cierra en la última muestra grabada.
  const finUlt = s.vueltas.length ? s.vueltas.at(-1).fin : s.inicio, tUlt = s.muestras.at(-1)[0];
  if (tUlt > finUlt) s.vueltas.push({ inicio: finUlt, fin: tUlt, nombre: "Hasta el corte", disparo: "manual" });
  const todas = leer("cinta.sesiones", []); if (!todas.some(x => x.id === s.id)) todas.push({ id: s.id, nombre: s.nombre, inicio: s.inicio, muestras: s.muestras, vueltas: s.vueltas });
  if (guardar("cinta.sesiones", todas.slice(-15))) localStorage.removeItem("cinta.encurso");
  pintarInicio();
};
$("bRecDescartar").onclick = () => { if (confirm("¿Descartar la sesión sin guardar?")) { localStorage.removeItem("cinta.encurso"); pintarInicio(); } };
if (SIMULAR) {
  $("simArrancar").onclick = () => cinta.botonCinta(3);
  $("simParar").onclick = () => cinta.botonCinta(0);
}

if ("serviceWorker" in navigator && !SIMULAR) navigator.serviceWorker.register("sw.js");
cargarBiblioteca();
