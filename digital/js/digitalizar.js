// De muestras analógicas (volts) a una señal lógica por flancos { v0, t: [instantes] }. Sin DOM.
import { indiceDe, instante } from './csv.js';

/** Niveles bajo y alto de una señal: percentiles 2 y 98 de hasta 200 mil muestras repartidas. */
export function niveles(v) {
	const n = v.length;
	const paso = Math.max(1, Math.floor(n / 200000));
	const m = new Float64Array(Math.ceil(n / paso));
	let k = 0;
	for (let i = 0; i < n; i += paso) m[k++] = v[i];
	const s = m.subarray(0, k).sort();
	const q = (p) => s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
	return { lo: q(0.02), hi: q(0.98) };
}

/**
 * Digitaliza una señal con histéresis (disparador Schmitt) y ubica cada flanco por interpolación en el cruce por el umbral.
 * opc: { umbral (en volts; por defecto la mitad entre los niveles), histeresis (fracción de la excursión, por defecto 0,12), invertir }
 * Devuelve { sig: { v0, t }, lo, hi, umbral, plana }.
 */
export function digitalizar(csv, v, opc = {}) {
	const { lo, hi } = niveles(v);
	const excursion = hi - lo;
	const n = v.length;
	const t = [];
	if (!(excursion > 1e-12)) return { sig: { v0: opc.invertir ? 1 : 0, t }, lo, hi, umbral: lo, plana: true };
	const mid = Number.isFinite(opc.umbral) ? opc.umbral : (lo + hi) / 2;
	const hh = excursion * (opc.histeresis ?? 0.12);
	const sube = mid + hh;
	const baja = mid - hh;
	let estado = v[0] > mid ? 1 : 0;
	const v0 = estado;
	const instanteDe = (i) => instante(csv, i);
	for (let i = 1; i < n; i++) {
		const x = v[i];
		if (estado === 0 && x > sube) {
			let k = i;
			while (k > 0 && v[k - 1] > mid) k--;
			t.push(cruce(v, k, mid, instanteDe));
			estado = 1;
		} else if (estado === 1 && x < baja) {
			let k = i;
			while (k > 0 && v[k - 1] < mid) k--;
			t.push(cruce(v, k, mid, instanteDe));
			estado = 0;
		}
		if (t.length > 3e6) break;
	}
	// por si el cruce interpolado quedó antes que el flanco anterior (ruido): se mantiene el orden
	for (let i = 1; i < t.length; i++) if (t[i] <= t[i - 1]) t[i] = t[i - 1] + 1e-15;
	return { sig: { v0: opc.invertir ? v0 ^ 1 : v0, t }, lo, hi, umbral: mid, plana: false };
}

function cruce(v, k, mid, instanteDe) {
	if (k === 0) return instanteDe(0);
	const a = v[k - 1];
	const b = v[k];
	const ta = instanteDe(k - 1);
	const tb = instanteDe(k);
	const f = b === a ? 0.5 : (mid - a) / (b - a);
	return ta + Math.max(0, Math.min(1, f)) * (tb - ta);
}

/**
 * La señal analógica de una ventana de tiempo, lista para dibujar: [[t, nivel]] con nivel 0 (bajo) a 1 (alto).
 * Si hay más muestras que píxeles, se resume en mínimos y máximos por columna para no perder los picos.
 */
export function trazaAnalogica(csv, v, lo, hi, t0, t1, maxPuntos = 1800) {
	const i0 = Math.max(0, indiceDe(csv, t0) - 1);
	const i1 = Math.min(csv.n, indiceDe(csv, t1) + 1);
	const cuenta = i1 - i0;
	const exc = hi - lo || 1;
	const y = (x) => Math.max(-0.35, Math.min(1.35, (x - lo) / exc));
	const pts = [];
	if (cuenta <= 0) return pts;
	if (cuenta <= maxPuntos) {
		for (let i = i0; i < i1; i++) pts.push([instante(csv, i), y(v[i])]);
		return pts;
	}
	const cubos = Math.floor(maxPuntos / 2);
	const tam = cuenta / cubos;
	for (let c = 0; c < cubos; c++) {
		const a = i0 + Math.floor(c * tam);
		const b = Math.min(i1, i0 + Math.floor((c + 1) * tam));
		if (b <= a) continue;
		let imin = a;
		let imax = a;
		for (let i = a + 1; i < b; i++) {
			if (v[i] < v[imin]) imin = i;
			if (v[i] > v[imax]) imax = i;
		}
		const par = imin < imax ? [imin, imax] : [imax, imin];
		pts.push([instante(csv, par[0]), y(v[par[0]])]);
		if (par[1] !== par[0]) pts.push([instante(csv, par[1]), y(v[par[1]])]);
	}
	return pts;
}
