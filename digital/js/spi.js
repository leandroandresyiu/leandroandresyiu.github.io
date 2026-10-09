// SPI: codificar palabras en un diagrama (CS, SCLK, MOSI, MISO) y decodificar señales por flancos.
import { bin, hex, nivelDespues, nivelEn } from './bits.js';
import { nuevoDiagrama } from './modelo.js';

export const MODOS = {
	0: 'Modo 0 (CPOL=0, CPHA=0): reposo bajo, muestrea en el flanco de subida',
	1: 'Modo 1 (CPOL=0, CPHA=1): reposo bajo, muestrea en el flanco de bajada',
	2: 'Modo 2 (CPOL=1, CPHA=0): reposo alto, muestrea en el flanco de bajada',
	3: 'Modo 3 (CPOL=1, CPHA=1): reposo alto, muestrea en el flanco de subida',
};
export const POR_DEFECTO = { modo: 0, bits: 8, orden: 'msb', csActivoBajo: true, conCS: true, sclkHz: 1e6 };
export const COLORES = { mosi: '#1f6feb', miso: '#2e7d32' };

/** ¿El modo muestra en el flanco de subida? (modos 0 y 3) */
export const muestreaEnSubida = (modo) => (modo >> 1) === (modo & 1);

const bitsDe = (v, n, orden) => {
	const msb = Array.from({ length: n }, (_, i) => (v >> (n - 1 - i)) & 1);
	return orden === 'lsb' ? msb.reverse() : msb;
};
const valorDe = (bits, orden) => {
	let v = 0;
	if (orden === 'lsb') bits.forEach((b, i) => (v += b * 2 ** i));
	else for (const b of bits) v = v * 2 + b;
	return v;
};

/**
 * Diagrama de tiempos. 2 ticks por bit (medio período de SCLK).
 * mosi / miso: arreglos de palabras (miso puede ser null o más corto: lo que falta queda en alta impedancia).
 */
export function construirDiagrama(mosi, miso, opc = {}) {
	const o = { ...POR_DEFECTO, ...opc };
	const cpol = o.modo >> 1;
	const cpha = o.modo & 1;
	const idleClk = cpol;
	const activo = o.csActivoBajo ? 0 : 1;
	const palabras = Math.max(mosi.length, miso ? miso.length : 0, 1);
	const cs = [];
	const clk = [];
	const mo = [];
	const mi = [];
	const campos = [];
	const marcas = [];
	const push = (c, k, a, b) => {
		cs.push(String(c));
		clk.push(String(k));
		mo.push(a);
		mi.push(b);
	};
	const primerBit = (arr) => (arr && arr[0] !== undefined ? String(bitsDe(arr[0], o.bits, o.orden)[0]) : 'z');
	// 2 ticks de reposo; CS se activa; 1 tick de preparación (con CPHA=1 el dato todavía no es válido)
	for (let i = 0; i < 2; i++) push(1 - activo, idleClk, 'z', 'z');
	const prep = (arr) => (arr && arr[0] !== undefined ? (cpha ? 'x' : primerBit(arr)) : 'z');
	push(activo, idleClk, prep(mosi), prep(miso));
	const tablaPalabras = [];
	for (let n = 0; n < palabras; n++) {
		const a = mosi[n];
		const b = miso ? miso[n] : undefined;
		const ba = a === undefined ? null : bitsDe(a, o.bits, o.orden);
		const bb = b === undefined ? null : bitsDe(b, o.bits, o.orden);
		const t0 = cs.length;
		for (let i = 0; i < o.bits; i++) {
			const x = ba ? String(ba[i]) : 'z';
			const y = bb ? String(bb[i]) : 'z';
			const ini = cs.length;
			// período del bit: CPHA=0 -> (reposo, activo); CPHA=1 -> (activo, reposo). Se muestrea en la mitad.
			const k1 = cpha ? 1 - idleClk : idleClk;
			push(activo, k1, x, y);
			push(activo, 1 - k1, x, y);
			const idx = o.orden === 'lsb' ? i : o.bits - 1 - i;
			campos.push({ a: ini, b: ini + 2, texto: `b${idx}`, color: '#7a7a7a', nivel: 0, sinBanda: true });
			if (ba) marcas.push({ t: ini + 1, fila: 'MOSI' });
			if (bb) marcas.push({ t: ini + 1, fila: 'MISO' });
		}
		const partes = [];
		if (a !== undefined) partes.push(`MOSI 0x${hex(a, Math.ceil(o.bits / 4))}`);
		if (b !== undefined) partes.push(`MISO 0x${hex(b, Math.ceil(o.bits / 4))}`);
		campos.push({ a: t0, b: cs.length, texto: partes.join('  ·  '), color: n % 2 ? COLORES.miso : COLORES.mosi, nivel: 1 });
		tablaPalabras.push({ n, mosi: a ?? null, miso: b ?? null });
	}
	// 1 tick de cola con el reloj en reposo y el dato retenido; CS se desactiva
	push(activo, idleClk, mo[mo.length - 1], mi[mi.length - 1]);
	for (let i = 0; i < 2; i++) push(1 - activo, idleClk, 'z', 'z');
	const d = nuevoDiagrama(cs.length);
	d.titulo = `SPI modo ${o.modo} · ${o.bits} bits · ${o.orden === 'msb' ? 'MSB' : 'LSB'} primero · CS activo en ${o.csActivoBajo ? 'bajo' : 'alto'}`;
	d.tickTime = 1 / (2 * o.sclkHz);
	d.rejilla = 2;
	d.regla = 'tiempo';
	d.senales = [];
	if (o.conCS) d.senales.push({ nombre: 'CS', celdas: cs });
	d.senales.push({ nombre: 'SCLK', celdas: clk });
	d.senales.push({ nombre: 'MOSI', celdas: mo });
	d.senales.push({ nombre: 'MISO', celdas: mi });
	const fila = (nombre) => d.senales.findIndex((x) => x.nombre === nombre);
	d.marcas = marcas.map((m) => ({ t: m.t, fila: fila(m.fila) }));
	d.campos = campos;
	d.pxSugerido = 22;
	return { diagrama: d, palabras: tablaPalabras };
}

/**
 * Decodifica SPI desde señales por flancos { sclk, mosi, miso?, cs? } y un rango [t0, t1] (necesario para saber hasta dónde llega CS).
 * Devuelve transacciones: [{ t0, t1, palabras: [{ t0, t1, mosi, miso }], bitsSueltos }]
 */
export function decodificar(s, opc = {}, rango = {}) {
	const o = { ...POR_DEFECTO, ...opc };
	const subida = muestreaEnSubida(o.modo);
	const bordes = [];
	s.sclk.t.forEach((t, i) => {
		if ((nivelDespues(s.sclk, i) === 1) === subida) bordes.push(t);
	});
	// ventanas de transacción
	const ventanas = [];
	if (s.cs) {
		const activo = o.csActivoBajo ? 0 : 1;
		let a = nivelEn(s.cs, rango.t0 ?? -Infinity) === activo ? (rango.t0 ?? s.cs.t[0] ?? 0) : null;
		s.cs.t.forEach((t, i) => {
			const lvl = nivelDespues(s.cs, i);
			if (lvl === activo && a === null) a = t;
			else if (lvl !== activo && a !== null) {
				ventanas.push([a, t]);
				a = null;
			}
		});
		if (a !== null) ventanas.push([a, rango.t1 ?? Infinity]);
	} else if (bordes.length) {
		// sin CS: se separa por pausas largas entre flancos de muestreo
		const gaps = bordes.slice(1).map((t, i) => t - bordes[i]).sort((x, y) => x - y);
		const tipico = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
		let ini = bordes[0] - tipico;
		let prev = bordes[0];
		for (let i = 1; i < bordes.length; i++) {
			if (bordes[i] - prev > tipico * 4) {
				ventanas.push([ini, prev + tipico]);
				ini = bordes[i] - tipico;
			}
			prev = bordes[i];
		}
		ventanas.push([ini, prev + tipico]);
	}
	const trans = [];
	for (const [va, vb] of ventanas) {
		const mios = bordes.filter((t) => t >= va && t < vb);
		if (!mios.length) continue;
		const palabras = [];
		let actualMosi = [];
		let actualMiso = [];
		let tIni = null;
		mios.forEach((t) => {
			if (tIni === null) tIni = t;
			actualMosi.push(nivelEn(s.mosi, t));
			if (s.miso) actualMiso.push(nivelEn(s.miso, t));
			if (actualMosi.length === o.bits) {
				palabras.push({ t0: tIni, t1: t, mosi: valorDe(actualMosi, o.orden), miso: s.miso ? valorDe(actualMiso, o.orden) : null, tMuestras: mios.slice(palabras.length * o.bits, palabras.length * o.bits + o.bits) });
				actualMosi = [];
				actualMiso = [];
				tIni = null;
			}
		});
		trans.push({ t0: va, t1: Math.min(vb, rango.t1 ?? vb), palabras, bitsSueltos: actualMosi.length });
	}
	return trans;
}

/** Texto de un valor: hex y binario. */
export const textoPalabra = (v, bits) => (v === null || v === undefined ? '—' : `0x${hex(v, Math.ceil(bits / 4))} (${bin(v, bits)})`);
