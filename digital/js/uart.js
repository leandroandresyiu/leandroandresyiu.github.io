// UART: codificar bytes en una trama (diagrama de tiempos) y decodificar una señal o una cadena de bits.
import { bin, car, hex, nivelDespues, nivelEn, primerFlancoDesde, senalDesdeBits } from './bits.js';
import { nuevoDiagrama } from './modelo.js';

export const BAUDIOS_COMUNES = [110, 300, 600, 1200, 2400, 4800, 9600, 14400, 19200, 28800, 38400, 57600, 76800, 115200, 230400, 250000, 460800, 500000, 576000, 921600, 1000000, 1500000, 2000000, 3000000];
export const PARIDADES = { N: 'Ninguna', P: 'Par', I: 'Impar', M: 'Marca (siempre 1)', S: 'Espacio (siempre 0)' };

export const POR_DEFECTO = { baud: 9600, datos: 8, paridad: 'N', stop: 1, orden: 'lsb', invertida: false };

export const COLORES = { inicio: '#c0392b', dato: '#1f6feb', paridad: '#b7791f', stop: '#2e7d32' };

/** Bit de paridad para unos bits de datos. */
export function bitParidad(bitsDato, tipo) {
	const unos = bitsDato.reduce((a, b) => a + b, 0);
	if (tipo === 'P') return unos % 2; // par: la cantidad total de unos (con paridad) queda par
	if (tipo === 'I') return (unos + 1) % 2;
	if (tipo === 'M') return 1;
	if (tipo === 'S') return 0;
	return null;
}

/** Bits de datos de un valor en el orden en que se transmiten. */
export function bitsDeValor(v, datos, orden) {
	const lsb = Array.from({ length: datos }, (_, i) => (v >> i) & 1);
	return orden === 'msb' ? lsb.reverse() : lsb;
}

export function valorDeBits(bits, orden) {
	let v = 0;
	if (orden === 'msb') for (const b of bits) v = (v << 1) | b;
	else bits.forEach((b, i) => (v |= b << i));
	return v;
}

/** Etiqueta de un valor: "0x41 'A'". */
export function etiquetaValor(v, datos = 8) {
	const h = '0x' + hex(v, Math.ceil(datos / 4));
	return datos <= 8 && v >= 32 && v < 127 ? `${h} '${car(v)}'` : h;
}

/**
 * Diagrama de tiempos de una lista de bytes. 2 ticks por bit (así entra el 1,5 de bits de stop).
 * Devuelve { diagrama, tramas: [{ n, valor, bits, paridad, desde, hasta }], bitsTotal }.
 */
export function construirDiagrama(bytes, opc = {}) {
	const o = { ...POR_DEFECTO, reposoIni: 2, reposoFin: 2, reposoEntre: 0, marcas: true, ...opc };
	const K = 2;
	const inv = o.invertida ? 1 : 0;
	const reposo = 1 ^ inv;
	const celTX = [];
	const celDato = [];
	const campos = [];
	const marcas = [];
	const tramas = [];
	const pushBit = (nivel, bus = null, bits = 1) => {
		for (let i = 0; i < bits * K; i++) {
			celTX.push(String(nivel ^ inv));
			celDato.push(bus ?? '-');
		}
	};
	const pushIdle = (bits) => {
		for (let i = 0; i < bits * K; i++) {
			celTX.push(String(reposo));
			celDato.push('-');
		}
	};
	pushIdle(o.reposoIni);
	bytes.forEach((byte, n) => {
		const valor = byte & ((1 << o.datos) - 1);
		const bitsDato = bitsDeValor(valor, o.datos, o.orden);
		const par = bitParidad(bitsDato, o.paridad);
		const desde = celTX.length;
		const bloque = { d: etiquetaValor(valor, o.datos), k: n };
		const campo = (nombre, tipo, ticks0, ticks1, color) => campos.push({ a: ticks0, b: ticks1, texto: nombre, color, nivel: 0 });
		let t = celTX.length;
		pushBit(0);
		campo('START', 'inicio', t, celTX.length, COLORES.inicio);
		bitsDato.forEach((b, i) => {
			t = celTX.length;
			pushBit(b, bloque);
			const idx = o.orden === 'msb' ? o.datos - 1 - i : i;
			campo(`D${idx}`, 'dato', t, celTX.length, COLORES.dato);
		});
		if (par !== null) {
			t = celTX.length;
			pushBit(par);
			campo(o.paridad === 'P' ? 'P (par)' : o.paridad === 'I' ? 'P (impar)' : 'P', 'paridad', t, celTX.length, COLORES.paridad);
		}
		t = celTX.length;
		for (let i = 0; i < o.stop * K; i++) {
			celTX.push(String(reposo));
			celDato.push('-');
		}
		campo(o.stop === 1 ? 'STOP' : `STOP (${o.stop})`, 'stop', t, celTX.length, COLORES.stop);
		tramas.push({ n, valor, bits: [0, ...bitsDato, ...(par !== null ? [par] : []), 1], paridad: par, desde, hasta: celTX.length });
		pushIdle(o.reposoEntre);
	});
	pushIdle(o.reposoFin);
	if (o.marcas) {
		for (const tr of tramas) {
			const nb = tr.bits.length;
			for (let i = 0; i < nb; i++) marcas.push({ t: tr.desde + (i + 0.5) * K, fila: 0 });
		}
	}
	const d = nuevoDiagrama(celTX.length);
	d.titulo = `UART ${o.baud} baudios · ${o.datos}${o.paridad === 'N' ? 'N' : o.paridad}${o.stop}`;
	d.tickTime = 1 / (K * o.baud);
	d.rejilla = K;
	d.regla = 'tiempo';
	d.senales = [
		{ nombre: o.invertida ? 'TX (inv.)' : 'TX', celdas: celTX },
		{ nombre: 'Dato', celdas: celDato },
	];
	d.campos = campos;
	d.marcas = marcas;
	d.pxSugerido = 20;
	return { diagrama: d, tramas, bitsTotal: celTX.length / K };
}

/** Estima los baudios a partir de los flancos de la señal (el pulso más corto) y los ajusta al valor estándar más cercano. */
export function estimarBaudios(sig) {
	const w = [];
	for (let i = 1; i < sig.t.length; i++) w.push(sig.t[i] - sig.t[i - 1]);
	if (w.length < 2) return null;
	w.sort((a, b) => a - b);
	// el pulso más corto "confiable": el percentil bajo, ignorando algún glitch aislado
	const base = w[Math.min(w.length - 1, Math.floor(w.length * 0.05))];
	const cand = [base];
	const b = 1 / base;
	let mejor = BAUDIOS_COMUNES.reduce((m, x) => (Math.abs(x - b) < Math.abs(m - b) ? x : m), BAUDIOS_COMUNES[0]);
	const err = Math.abs(mejor - b) / mejor;
	return { baud: err < 0.06 ? mejor : Math.round(b), exacto: err < 0.06, medido: b, error: err };
}

/**
 * Decodifica tramas UART de una señal por flancos. T = duración de un bit.
 * Devuelve [{ t0, t1, valor, bits, paridad: {rx, esperado, ok}|null, stopOk, error }].
 */
export function decodificar(sig, T, opc = {}, rango = {}) {
	const o = { ...POR_DEFECTO, ...opc };
	const idle = o.invertida ? 0 : 1;
	const inicio = 1 - idle;
	const tMin = rango.t0 ?? -Infinity;
	const tMax = rango.t1 ?? Infinity;
	const nPar = o.paridad === 'N' ? 0 : 1;
	const nStop = Math.max(1, Math.ceil(o.stop));
	const largoBits = 1 + o.datos + nPar + o.stop;
	const tramas = [];
	let i = primerFlancoDesde(sig, tMin);
	while (i < sig.t.length) {
		const ts = sig.t[i];
		if (ts > tMax) break;
		if (nivelDespues(sig, i) !== inicio || nivelEn(sig, ts + 0.5 * T) !== inicio) {
			i++;
			continue;
		}
		const m = (k) => nivelEn(sig, ts + (k + 0.5) * T);
		const bitsDato = [];
		for (let j = 0; j < o.datos; j++) bitsDato.push(m(1 + j) ^ (o.invertida ? 1 : 0));
		let paridad = null;
		let error = null;
		if (nPar) {
			const rx = m(1 + o.datos) ^ (o.invertida ? 1 : 0);
			const esperado = bitParidad(bitsDato, o.paridad);
			paridad = { rx, esperado, ok: rx === esperado };
			if (!paridad.ok) error = 'paridad';
		}
		// cada bit de stop se mira en la mitad de su tramo (el último puede ser de 0,5: 1,5 bits de stop)
		let stopOk = true;
		const ini = 1 + o.datos + nPar;
		for (let j = 0; j < nStop; j++) {
			const largo = Math.min(1, o.stop - j);
			if (nivelEn(sig, ts + (ini + j + largo / 2) * T) !== idle) stopOk = false;
		}
		const valor = valorDeBits(bitsDato, o.orden);
		if (!stopOk) error = bitsDato.every((b) => b === 0) ? 'ruptura (break)' : 'stop';
		const te = ts + largoBits * T;
		tramas.push({ t0: ts, t1: te, valor, bits: bitsDato, paridad, stopOk, error, T });
		// la próxima trama puede empezar justo al terminar el stop; con error se vuelve a sincronizar antes
		i = primerFlancoDesde(sig, stopOk ? te - 0.3 * T : ts + 0.9 * T);
	}
	return tramas;
}

/** Cadena de bits (una muestra por bit, o `k` muestras por bit) -> tramas. Los tiempos salen en "bits". */
export function decodificarBits(bits, opc = {}, k = 1) {
	const sig = senalDesdeBits(bits, 1);
	const tramas = decodificar(sig, k, opc);
	return tramas.map((f) => ({ ...f, t0: f.t0 / k, t1: f.t1 / k, T: 1 }));
}

export const resumenTrama = (f, datos = 8) => ({
	valor: f.valor,
	hex: '0x' + hex(f.valor, Math.ceil(datos / 4)),
	bin: bin(f.valor, datos),
	dec: f.valor,
	ascii: datos <= 8 ? car(f.valor) : '',
});

/** Llaves (START, D0…, paridad, STOP) de una trama decodificada. K = ticks por bit. */
export function camposDeTrama(f, opc, K) {
	const o = { ...POR_DEFECTO, ...opc };
	const campos = [];
	let t = f.t0;
	const add = (texto, largo, color) => {
		campos.push({ a: t * K, b: (t + largo) * K, texto, color, nivel: 0 });
		t += largo;
	};
	add('START', 1, COLORES.inicio);
	f.bits.forEach((_, i) => add(`D${o.orden === 'msb' ? o.datos - 1 - i : i}`, 1, COLORES.dato));
	if (f.paridad) add(f.paridad.ok ? 'P' : 'P ✗', 1, f.paridad.ok ? COLORES.paridad : '#c0392b');
	add(o.stop === 1 ? 'STOP' : `STOP (${o.stop})`, o.stop, f.stopOk ? COLORES.stop : '#c0392b');
	return campos;
}

/**
 * Diagrama de una cadena de bits (una muestra por bit, o `k` por bit) con las tramas ya decodificadas encima.
 * Devuelve { diagrama, truncado } (se dibujan como mucho ~2400 ticks).
 */
export function diagramaDeBits(bits, k, tramas, opc = {}) {
	const o = { ...POR_DEFECTO, ...opc };
	const tpm = k >= 2 ? 1 : 2; // ticks por muestra
	const K = tpm * k; // ticks por bit
	const maxMuestras = Math.floor(2400 / tpm);
	const usados = bits.slice(0, maxMuestras);
	const celdas = usados.flatMap((b) => Array(tpm).fill(String(b)));
	const dato = Array(celdas.length).fill('-');
	const campos = [];
	const marcas = [];
	const total = celdas.length;
	tramas.forEach((f, n) => {
		if (f.t1 * K > total) return;
		const desde = Math.round((f.t0 + 1) * K);
		const hasta = Math.round((f.t0 + 1 + o.datos) * K);
		const txt = etiquetaValor(f.valor, o.datos) + (f.error ? ' ✗' : '');
		for (let i = desde; i < hasta && i < total; i++) dato[i] = { d: txt, k: n };
		campos.push(...camposDeTrama(f, o, K));
		const nb = 1 + o.datos + (f.paridad ? 1 : 0) + Math.ceil(o.stop);
		for (let i = 0; i < nb; i++) marcas.push({ t: (f.t0 + i + 0.5) * K, fila: 0 });
	});
	const d = nuevoDiagrama(total);
	d.titulo = `UART ${o.datos}${o.paridad === 'N' ? 'N' : o.paridad}${o.stop} · ${tramas.length} trama${tramas.length === 1 ? '' : 's'}`;
	d.tickTime = o.baud ? 1 / (K * o.baud) : null;
	d.rejilla = K;
	d.regla = d.tickTime ? 'tiempo' : 'ticks';
	d.senales = [
		{ nombre: o.invertida ? 'RX (inv.)' : 'RX', celdas },
		{ nombre: 'Dato', celdas: dato },
	];
	d.campos = campos;
	d.marcas = marcas;
	d.pxSugerido = k >= 4 ? 5 : 17;
	return { diagrama: d, truncado: bits.length > usados.length };
}
