// CAN 2.0A/B (trama estándar de 11 bits y extendida de 29): codificar con relleno de bits y CRC-15, y decodificar.
// Convención lógica: 0 = dominante, 1 = recesivo.
import { hex, nivelDespues, nivelEn, primerFlancoDesde } from './bits.js';
import { nuevoDiagrama } from './modelo.js';

export const COLORES = { sof: '#c0392b', id: '#1f6feb', ctrl: '#7a7a7a', datos: '#0f9d8a', crc: '#8e44ad', ack: '#2e7d32', eof: '#9a9a9a', relleno: '#c0392b' };
export const POR_DEFECTO = { ext: false, rtr: false, bitrate: 500000, ack: true };

const MAX_BITS = 170;

/** CRC-15 de CAN (polinomio 0x4599) sobre bits ya sin relleno, de SOF al último bit de datos. */
export function crc15(bits) {
	let crc = 0;
	for (const b of bits) {
		const siguiente = b ^ ((crc >> 14) & 1);
		crc = (crc << 1) & 0x7fff;
		if (siguiente) crc ^= 0x4599;
	}
	return crc;
}

const bitsDe = (v, n) => Array.from({ length: n }, (_, i) => Math.floor(v / 2 ** (n - 1 - i)) % 2);
const valorDe = (bits) => bits.reduce((a, b) => a * 2 + b, 0);

/** Relleno de bits: tras 5 bits iguales se inserta uno opuesto. Devuelve { bits, pos } (pos[i] = índice en la trama con relleno del bit i). */
export function rellenar(bits) {
	const out = [];
	const pos = [];
	let ult = -1;
	let n = 0;
	for (const b of bits) {
		pos.push(out.length);
		out.push(b);
		if (b === ult) n++;
		else {
			ult = b;
			n = 1;
		}
		if (n === 5) {
			out.push(1 - b);
			ult = 1 - b;
			n = 1;
		}
	}
	return { bits: out, pos };
}

const lenDatos = (dlc) => Math.min(dlc, 8);

/**
 * Codifica una trama.
 * { ext, id, rtr, datos: [bytes], dlc (opcional: por defecto la cantidad de datos; en remotas es lo que se pide), ack, ifs }
 */
export function codificar(f) {
	const ext = !!f.ext;
	const idMax = ext ? 0x1fffffff : 0x7ff;
	if (!(f.id >= 0 && f.id <= idMax)) throw new Error(`El ID debe estar entre 0 y 0x${idMax.toString(16).toUpperCase()}`);
	const rtr = !!f.rtr;
	const datos = rtr ? [] : (f.datos || []).slice(0, 8);
	const dlc = f.dlc ?? (rtr ? 0 : datos.length);
	if (dlc < 0 || dlc > 15) throw new Error('El DLC va de 0 a 15');
	if (!rtr && (f.datos || []).length > 8) throw new Error('CAN clásico lleva como máximo 8 bytes de datos');
	if (!rtr && datos.length !== lenDatos(dlc)) throw new Error(`Con DLC = ${dlc} hacen falta ${lenDatos(dlc)} bytes de datos (hay ${datos.length})`);

	// campos con relleno: lista de [nombre, bits, tipo, valor, nota]
	const campos = [];
	const add = (nombre, bits, tipo, valor, nota = '') => campos.push({ nombre, bits, tipo, valor, nota });
	add('SOF', [0], 'sof', '0', 'inicio de trama (dominante)');
	if (!ext) {
		add('ID', bitsDe(f.id, 11), 'id', `0x${hex(f.id, 3)}`, 'identificador de 11 bits (menor número = más prioridad)');
		add('RTR', [rtr ? 1 : 0], 'ctrl', rtr ? '1' : '0', rtr ? 'trama remota (pide datos)' : 'trama de datos');
		add('IDE', [0], 'ctrl', '0', 'formato estándar');
		add('r0', [0], 'ctrl', '0', 'reservado');
	} else {
		add('ID A', bitsDe(f.id >> 18, 11), 'id', `0x${hex(f.id >> 18, 3)}`, 'primeros 11 bits del identificador');
		add('SRR', [1], 'ctrl', '1', 'reemplaza al RTR (siempre recesivo)');
		add('IDE', [1], 'ctrl', '1', 'formato extendido');
		add('ID B', bitsDe(f.id & 0x3ffff, 18), 'id', `0x${hex(f.id & 0x3ffff, 5)}`, 'últimos 18 bits del identificador');
		add('RTR', [rtr ? 1 : 0], 'ctrl', rtr ? '1' : '0', rtr ? 'trama remota (pide datos)' : 'trama de datos');
		add('r1', [0], 'ctrl', '0', 'reservado');
		add('r0', [0], 'ctrl', '0', 'reservado');
	}
	add('DLC', bitsDe(dlc, 4), 'ctrl', String(dlc), rtr ? 'cantidad de bytes que se piden' : `${lenDatos(dlc)} byte(s) de datos`);
	datos.forEach((b, i) => add(`D${i}`, bitsDe(b, 8), 'datos', `0x${hex(b)}`, ''));
	const sinCRC = campos.flatMap((c) => c.bits);
	const crc = crc15(sinCRC);
	add('CRC', bitsDe(crc, 15), 'crc', `0x${hex(crc, 4)}`, 'CRC-15 calculado de SOF a los datos');

	// relleno de bits sobre lo anterior (de SOF al final del CRC)
	const todos = campos.flatMap((c) => c.bits);
	const { bits: rell, pos } = rellenar(todos);
	let k = 0;
	for (const c of campos) {
		c.a = pos[k];
		k += c.bits.length;
		c.b = pos[k - 1] + 1;
	}
	// parte sin relleno
	const cola = [];
	const addCola = (nombre, bits, tipo, valor, nota) => cola.push({ nombre, bits, tipo, valor, nota });
	addCola('CRC delim.', [1], 'crc', '1', 'siempre recesivo');
	addCola('ACK', [f.ack === false ? 1 : 0], 'ack', f.ack === false ? '1' : '0', f.ack === false ? 'nadie confirmó (recesivo)' : 'un receptor confirmó (dominante)');
	addCola('ACK delim.', [1], 'ack', '1', 'siempre recesivo');
	addCola('EOF', [1, 1, 1, 1, 1, 1, 1], 'eof', '1111111', 'fin de trama: 7 bits recesivos');
	if (f.ifs !== false) addCola('IFS', [1, 1, 1], 'eof', '111', 'espacio entre tramas: 3 bits recesivos');
	const bitsFinal = [...rell];
	for (const c of cola) {
		c.a = bitsFinal.length;
		bitsFinal.push(...c.bits);
		c.b = bitsFinal.length;
	}
	const usados = new Set(pos);
	const rellenos = [];
	for (let i = 0; i < rell.length; i++) if (!usados.has(i)) rellenos.push(i);
	return { ext, id: f.id, rtr, dlc, datos, crc, campos: [...campos, ...cola], bits: bitsFinal, bitsSinRelleno: todos, rellenos };
}

/** Diagrama de tiempos de una trama codificada (1 tick por bit). */
export function construirDiagrama(tr, opc = {}) {
	const o = { ...POR_DEFECTO, ...opc };
	const idle = 3;
	const cel = [];
	for (let i = 0; i < idle; i++) cel.push('1');
	for (const b of tr.bits) cel.push(String(b));
	for (let i = 0; i < idle; i++) cel.push('1');
	const campos = [];
	for (const c of tr.campos) {
		let texto = c.nombre;
		if (c.tipo === 'id' || c.nombre === 'DLC' || c.nombre === 'CRC') texto += ` ${c.valor}`;
		else if (c.tipo === 'datos') texto = `${c.nombre} ${c.valor}`;
		campos.push({ a: c.a + idle, b: c.b + idle, texto, color: COLORES[c.tipo] || '#444', nivel: 0, tam: 11 });
	}
	for (const i of tr.rellenos) campos.push({ a: i + idle, b: i + idle + 1, texto: 'S', color: COLORES.relleno, nivel: 1, tam: 10, sinBanda: true });
	const d = nuevoDiagrama(cel.length);
	d.titulo = `CAN ${tr.ext ? 'extendida' : 'estándar'} · ID 0x${hex(tr.id, tr.ext ? 8 : 3)} · ${(o.bitrate / 1000).toLocaleString('es-AR')} kbit/s`;
	d.tickTime = 1 / o.bitrate;
	d.rejilla = 1;
	d.regla = 'tiempo';
	d.senales = [{ nombre: 'CAN (0 = dominante)', celdas: cel }];
	d.campos = campos;
	d.marcas = [];
	d.pxSugerido = 15;
	return d;
}

/** "123#DEADBEEF", "1F334455#R", "12345678#11.22.33" -> { ext, id, rtr, datos, dlc } o null. */
export function parsearCandump(txt) {
	const m = String(txt).match(/([0-9A-Fa-f]{1,8})#(R[0-9]?|[0-9A-Fa-f.]*)/);
	if (!m) return null;
	const idTxt = m[1];
	const ext = idTxt.length > 3;
	const id = parseInt(idTxt, 16);
	if (id > (ext ? 0x1fffffff : 0x7ff)) return null;
	const resto = m[2];
	if (/^R/.test(resto)) return { ext, id, rtr: true, datos: [], dlc: resto.length > 1 ? parseInt(resto.slice(1), 10) : 0 };
	const h = resto.replace(/\./g, '');
	if (h.length % 2) return null;
	const datos = [];
	for (let i = 0; i < h.length; i += 2) datos.push(parseInt(h.slice(i, i + 2), 16));
	if (datos.length > 8) return null;
	return { ext, id, rtr: false, datos, dlc: datos.length };
}

/**
 * Decodifica una trama a partir de los bits como se ven en el bus (con relleno), empezando en el SOF (primer 0).
 * Devuelve { ok, errores: [...], ext, id, rtr, dlc, datos, crcRx, crcCalc, crcOk, ack, campos, consumidos, rellenos }.
 */
export function decodificarBits(bitsEntrada) {
	const bits = bitsEntrada.slice(0, MAX_BITS);
	const r = { ok: false, errores: [], advertencias: [], campos: [], rellenos: [], consumidos: 0 };
	// destuffing con seguimiento de posiciones
	const des = [];
	const posDes = []; // índice en la trama con relleno de cada bit sin relleno
	let ult = -1;
	let n = 0;
	let i = 0;
	let zonaRelleno = true;
	let limiteRelleno = Infinity; // cantidad de bits sin relleno hasta el final del CRC
	const leer = (cuantos) => {
		// lee `cuantos` bits sin relleno; devuelve null si no alcanzan
		const out = [];
		while (out.length < cuantos) {
			if (i >= bits.length) return null;
			let b = bits[i];
			if (zonaRelleno && n === 5) {
				// este bit debe ser de relleno
				if (b === ult) {
					r.errores.push(`Error de relleno en el bit ${i}: seis bits iguales seguidos`);
					return null;
				}
				r.rellenos.push(i);
				ult = b;
				n = 1;
				i++;
				continue;
			}
			posDes.push(i);
			des.push(b);
			if (zonaRelleno) {
				if (b === ult) n++;
				else {
					ult = b;
					n = 1;
				}
			}
			out.push(b);
			i++;
		}
		return out;
	};
	const campo = (nombre, tipo, bitsC, valor, nota = '') => {
		const idx = des.length - bitsC.length;
		r.campos.push({ nombre, tipo, bits: bitsC, valor, nota, a: posDes[idx], b: posDes[des.length - 1] + 1 });
	};
	const falla = (msg) => {
		r.errores.push(msg);
		r.consumidos = i;
		return r;
	};
	const sof = leer(1);
	if (!sof) return falla('No hay datos');
	if (sof[0] !== 0) return falla('La trama debe empezar con un bit dominante (0) de SOF');
	campo('SOF', 'sof', sof, '0');
	const idA = leer(11);
	if (!idA) return falla(r.errores.length ? r.errores[0] : 'La trama termina antes de tiempo (ID)');
	const rtrOSrr = leer(1);
	const ide = rtrOSrr && leer(1);
	if (!ide) return falla(r.errores.length ? r.errores[0] : 'La trama termina antes de tiempo (control)');
	r.ext = ide[0] === 1;
	let idVal;
	if (!r.ext) {
		idVal = valorDe(idA);
		campo('ID', 'id', idA, `0x${hex(idVal, 3)}`);
		campo('RTR', 'ctrl', rtrOSrr, String(rtrOSrr[0]), rtrOSrr[0] ? 'trama remota' : 'trama de datos');
		campo('IDE', 'ctrl', ide, '0', 'formato estándar');
		r.rtr = rtrOSrr[0] === 1;
		const r0 = leer(1);
		if (!r0) return falla(r.errores[0] || 'La trama termina antes de tiempo');
		campo('r0', 'ctrl', r0, String(r0[0]), r0[0] ? 'FDF=1: es una trama CAN FD (no soportada)' : 'reservado');
		if (r0[0]) r.errores.push('Es una trama CAN FD (bit FDF recesivo): este decodificador entiende CAN clásico.');
	} else {
		campo('ID A', 'id', idA, `0x${hex(valorDe(idA), 3)}`);
		campo('SRR', 'ctrl', rtrOSrr, String(rtrOSrr[0]), 'reemplaza al RTR');
		campo('IDE', 'ctrl', ide, '1', 'formato extendido');
		const idB = leer(18);
		const rtr = idB && leer(1);
		const r1 = rtr && leer(1);
		const r0 = r1 && leer(1);
		if (!r0) return falla(r.errores[0] || 'La trama termina antes de tiempo (ID extendido)');
		idVal = valorDe(idA) * 2 ** 18 + valorDe(idB);
		campo('ID B', 'id', idB, `0x${hex(valorDe(idB), 5)}`);
		campo('RTR', 'ctrl', rtr, String(rtr[0]), rtr[0] ? 'trama remota' : 'trama de datos');
		campo('r1', 'ctrl', r1, String(r1[0]), 'reservado');
		campo('r0', 'ctrl', r0, String(r0[0]), 'reservado');
		r.rtr = rtr[0] === 1;
	}
	r.id = idVal;
	const dlcB = leer(4);
	if (!dlcB) return falla(r.errores[0] || 'La trama termina antes de tiempo (DLC)');
	r.dlc = valorDe(dlcB);
	campo('DLC', 'ctrl', dlcB, String(r.dlc), r.rtr ? 'bytes pedidos' : `${lenDatos(r.dlc)} byte(s) de datos${r.dlc > 8 ? ' (DLC > 8 se toma como 8)' : ''}`);
	r.datos = [];
	if (!r.rtr) {
		for (let k = 0; k < lenDatos(r.dlc); k++) {
			const b = leer(8);
			if (!b) return falla(r.errores[0] || 'La trama termina antes de tiempo (datos)');
			r.datos.push(valorDe(b));
			campo(`D${k}`, 'datos', b, `0x${hex(valorDe(b))}`);
		}
	}
	const sinCRC = des.slice();
	const crcB = leer(15);
	if (!crcB) return falla(r.errores[0] || 'La trama termina antes de tiempo (CRC)');
	r.crcRx = valorDe(crcB);
	r.crcCalc = crc15(sinCRC);
	r.crcOk = r.crcRx === r.crcCalc;
	campo('CRC', 'crc', crcB, `0x${hex(r.crcRx, 4)}`, r.crcOk ? 'correcto' : `ERROR: se esperaba 0x${hex(r.crcCalc, 4)}`);
	if (!r.crcOk) r.errores.push(`Error de CRC: llegó 0x${hex(r.crcRx, 4)} y se calculó 0x${hex(r.crcCalc, 4)}`);
	// si los últimos 5 bits del CRC son iguales, todavía viene un bit de relleno antes del delimitador
	if (n === 5 && i < bits.length) {
		if (bits[i] === ult) r.errores.push(`Error de relleno en el bit ${i}: seis bits iguales seguidos`);
		else r.rellenos.push(i);
		i++;
	}
	zonaRelleno = false;
	const cola = (nombre, tipo, cuantos, nota, esperado) => {
		const b = leer(cuantos);
		if (!b) return null;
		campo(nombre, tipo, b, b.join(''), nota);
		if (esperado !== undefined && b.some((x) => x !== esperado)) r.advertencias.push(`${nombre} debería ser recesivo (1)`);
		return b;
	};
	const cd = cola('CRC delim.', 'crc', 1, 'recesivo', 1);
	const ack = cola('ACK', 'ack', 1, '');
	const ad = cola('ACK delim.', 'ack', 1, 'recesivo', 1);
	if (!cd || !ack || !ad) {
		r.errores.push('La trama termina antes del ACK');
		r.consumidos = i;
		return r;
	}
	r.ack = ack[0] === 0;
	r.campos[r.campos.length - 2].nota = r.ack ? 'confirmada por un receptor (dominante)' : 'sin ACK: nadie la confirmó';
	if (!r.ack) r.advertencias.push('Nadie confirmó la trama (ACK recesivo).');
	const eof = cola('EOF', 'eof', 7, '7 bits recesivos', 1);
	if (!eof) r.advertencias.push('La captura termina antes del EOF completo.');
	r.consumidos = i;
	r.ok = r.errores.length === 0;
	return r;
}

/** Primer flanco (índice) que sigue a un tramo en reposo (nivel 1) de al menos `minimo` segundos, a partir del índice `desde`. */
function despuesDeReposo(sig, desde, minimo) {
	for (let j = desde; j < sig.t.length; j++) {
		if (nivelDespues(sig, j) !== 1) continue;
		if (j + 1 >= sig.t.length || sig.t[j + 1] - sig.t[j] >= minimo) return j + 1;
	}
	return sig.t.length;
}

/**
 * Decodifica tramas CAN de una señal lógica por flancos (1 = recesivo). T = duración de un bit.
 * muestreo: punto de muestreo dentro del bit (0.75 = 75 %). Resincroniza con cada flanco.
 */
export function decodificarSenal(sig, T, opc = {}, rango = {}) {
	const muestreo = opc.muestreo ?? 0.75;
	const tMax = rango.t1 ?? Infinity;
	const tramas = [];
	let i = primerFlancoDesde(sig, rango.t0 ?? -Infinity);
	while (i < sig.t.length) {
		const ts = sig.t[i];
		if (ts > tMax) break;
		if (nivelDespues(sig, i) !== 0) {
			i++;
			continue;
		}
		// muestrea hasta MAX_BITS con resincronización en cada flanco cercano a un límite de bit
		const bits = [];
		const tMuestras = [];
		let off = 0;
		for (let b = 0; b < MAX_BITS; b++) {
			const limite = ts + b * T + off;
			// ajusta con un flanco cercano a este límite (excepto el primero: es el SOF)
			if (b > 0) {
				const j = primerFlancoDesde(sig, limite - 0.35 * T);
				if (j < sig.t.length && Math.abs(sig.t[j] - limite) < 0.35 * T) off += sig.t[j] - limite;
			}
			const tm = ts + b * T + off + muestreo * T;
			if (tm > tMax) break;
			bits.push(nivelEn(sig, tm));
			tMuestras.push(tm);
		}
		const res = decodificarBits(bits);
		const usados = Math.max(1, res.consumidos);
		tramas.push({ t0: ts, t1: ts + usados * T + off, T, resultado: res, bits: bits.slice(0, usados), tMuestras: tMuestras.slice(0, usados), off });
		const fin = ts + (usados - 0.5) * T + off;
		// tras un error el bus queda desordenado: se espera a verlo en reposo (más de 10 bits recesivos) antes de buscar otro SOF
		i = res.ok ? primerFlancoDesde(sig, fin) : despuesDeReposo(sig, primerFlancoDesde(sig, fin), 10.5 * T);
	}
	return tramas;
}

/** Estima el bitrate (el pulso más corto) y lo ajusta a uno estándar. */
export const BITRATES = [10000, 20000, 50000, 83333, 100000, 125000, 250000, 500000, 800000, 1000000];
export function estimarBitrate(sig) {
	const w = [];
	for (let i = 1; i < sig.t.length; i++) w.push(sig.t[i] - sig.t[i - 1]);
	if (w.length < 4) return null;
	w.sort((a, b) => a - b);
	const base = w[Math.min(w.length - 1, Math.floor(w.length * 0.03))];
	const b = 1 / base;
	const mejor = BITRATES.reduce((m, x) => (Math.abs(x - b) < Math.abs(m - b) ? x : m), BITRATES[0]);
	const err = Math.abs(mejor - b) / mejor;
	return { bitrate: err < 0.08 ? mejor : Math.round(b), exacto: err < 0.08, medido: b };
}
