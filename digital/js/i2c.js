// I²C: armar una transacción (diagrama de tiempos), leerla de un texto ("S 50 W A 00 A P") y decodificarla de señales SDA/SCL.
import { hex, nivelDespues, nivelEn } from './bits.js';
import { nuevoDiagrama } from './modelo.js';

export const COLORES = { maestro: '#1f6feb', esclavo: '#d9730d', cond: '#c0392b', ack: '#2e7d32' };
export const POR_DEFECTO = { fHz: 100000 };

// Una transacción es una lista de eventos:
//   { tipo: 'S' } | { tipo: 'Sr' } | { tipo: 'P' }
//   { tipo: 'byte', v, ack, rol: 'dir7' | 'dir10a' | 'dir10b' | 'dato', rw?: 'W'|'R', esclavo: bool }   (esclavo: el dato lo pone el esclavo)

const bitsMSB = (v, n = 8) => Array.from({ length: n }, (_, i) => (v >> (n - 1 - i)) & 1);

/**
 * Evento de dirección(es) según el modo. Devuelve los eventos "byte" de la dirección.
 * dir: dirección de 7 bits (o de 10 si bits10).
 */
function eventosDireccion(dir, rw, ack, bits10) {
	if (!bits10) return [{ tipo: 'byte', v: ((dir & 0x7f) << 1) | (rw === 'R' ? 1 : 0), ack, rol: 'dir7', rw }];
	const alto = (dir >> 8) & 3;
	return [
		{ tipo: 'byte', v: 0xf0 | (alto << 1) | (rw === 'R' ? 1 : 0), ack, rol: 'dir10a', rw },
		{ tipo: 'byte', v: dir & 0xff, ack, rol: 'dir10b', rw },
	];
}

/**
 * Transacción desde un formulario.
 * { dir, bits10, rw: 'W'|'R'|'WR', escribir: [bytes], leer: [bytes], nackDir, ultimoNack }
 *  - escribir: bytes que el maestro manda; leer: bytes que devuelve el esclavo
 *  - nackDir: el esclavo no responde (NACK en la dirección)
 *  - ultimoNack: en lecturas el maestro responde NACK al último byte (lo normal)
 */
export function secuenciaDesdeForm(f) {
	const ev = [{ tipo: 'S' }];
	const escribir = f.escribir || [];
	const leer = f.leer || [];
	const ackDir = !f.nackDir;
	const dir = (rw) => eventosDireccion(f.dir, rw, ackDir, f.bits10);
	if (f.rw === 'W') {
		ev.push(...dir('W'));
		if (ackDir) for (const v of escribir) ev.push({ tipo: 'byte', v, ack: true, rol: 'dato', esclavo: false });
	} else if (f.rw === 'R') {
		if (f.bits10) {
			// en 10 bits la lectura empieza escribiendo la dirección y repite el inicio con el bit R
			const [a, b] = eventosDireccion(f.dir, 'W', ackDir, true);
			ev.push(a, b, { tipo: 'Sr' }, ...eventosDireccion(f.dir, 'R', ackDir, true).slice(0, 1));
		} else ev.push(...dir('R'));
		if (ackDir) leer.forEach((v, i) => ev.push({ tipo: 'byte', v, ack: !(f.ultimoNack !== false && i === leer.length - 1), rol: 'dato', esclavo: true }));
	} else {
		ev.push(...dir('W'));
		if (ackDir) {
			for (const v of escribir) ev.push({ tipo: 'byte', v, ack: true, rol: 'dato', esclavo: false });
			ev.push({ tipo: 'Sr' });
			if (f.bits10) ev.push(...eventosDireccion(f.dir, 'R', ackDir, true).slice(0, 1));
			else ev.push(...dir('R'));
			leer.forEach((v, i) => ev.push({ tipo: 'byte', v, ack: !(f.ultimoNack !== false && i === leer.length - 1), rol: 'dato', esclavo: true }));
		}
	}
	if (!f.sinStop) ev.push({ tipo: 'P' });
	return ev;
}

/** Texto -> eventos. Entiende S, Sr, P, A (ACK), N (NACK), W, R y bytes en hexadecimal. { eventos, avisos } */
export function parsearTexto(txt) {
	const toks = String(txt ?? '').split(/[\s,;|]+/).filter(Boolean);
	const ev = [];
	const avisos = [];
	let esperaDir = false;
	let rwActual = 'W';
	let i = 0;
	const hexTok = (t) => /^(0x)?[0-9a-fA-F]{1,2}$/.test(t) && !/^[ap]$/i.test(t);
	const aHex = (t) => parseInt(t.replace(/^0x/i, ''), 16);
	const lee_ack = () => {
		const t = (toks[i] || '').toUpperCase();
		if (t === 'A' || t === 'ACK') {
			i++;
			return true;
		}
		if (t === 'N' || t === 'NA' || t === 'NACK') {
			i++;
			return false;
		}
		return null;
	};
	while (i < toks.length) {
		const t = toks[i];
		const T = t.toUpperCase();
		if (T === 'S' || T === 'START') {
			ev.push({ tipo: 'S' });
			esperaDir = true;
			i++;
		} else if (T === 'SR' || T === 'RS' || T === 'REPEATED') {
			ev.push({ tipo: 'Sr' });
			esperaDir = true;
			i++;
		} else if (T === 'P' || T === 'STOP') {
			ev.push({ tipo: 'P' });
			esperaDir = false;
			i++;
		} else if (hexTok(t)) {
			const v = aHex(t);
			i++;
			if (esperaDir) {
				esperaDir = false;
				const sig = (toks[i] || '').toUpperCase();
				let dir7;
				let rw;
				if (sig === 'W' || sig === 'R' || sig === 'WR' || sig === 'RD') {
					// "50 W": dirección de 7 bits y operación separadas
					dir7 = v & 0x7f;
					rw = sig === 'R' || sig === 'RD' ? 'R' : 'W';
					i++;
					if (v > 0x7f) avisos.push(`La dirección ${t} no entra en 7 bits: se usó ${hex(dir7)}.`);
				} else {
					// "A0": byte de dirección completo (dirección << 1 | R/W)
					dir7 = v >> 1;
					rw = v & 1 ? 'R' : 'W';
				}
				const ack = lee_ack();
				const bits10 = (dir7 >> 2) === 0x1e;
				ev.push({ tipo: 'byte', v: (dir7 << 1) | (rw === 'R' ? 1 : 0), ack: ack ?? true, rol: bits10 ? 'dir10a' : 'dir7', rw });
				rwActual = rw;
				if (ack === null) avisos.push('Faltó el ACK/NACK después de la dirección: se supuso ACK.');
			} else {
				const ack = lee_ack();
				if (ack === null && i < toks.length && !/^(S|SR|P|START|STOP)$/i.test(toks[i]) && !hexTok(toks[i])) avisos.push(`No se entendió "${toks[i]}".`);
				const previo = ev[ev.length - 1];
				const rol = previo && previo.tipo === 'byte' && previo.rol === 'dir10a' ? 'dir10b' : 'dato';
				ev.push({ tipo: 'byte', v, ack: ack ?? true, rol, rw: rwActual, esclavo: rol === 'dato' && rwActual === 'R' });
			}
		} else {
			avisos.push(`No se entendió "${t}".`);
			i++;
		}
	}
	return { eventos: ev, avisos };
}

const F = (a, b, texto, color, nivel = 0, extra = {}) => ({ a, b, texto, color, nivel, ...extra });

/** Eventos -> diagrama de tiempos (4 ticks por bit). */
export function construirDiagrama(eventos, opc = {}) {
	const o = { ...POR_DEFECTO, ...opc };
	const scl = [];
	const sda = [];
	const campos = [];
	const marcas = [];
	const push = (c, d, n = 1) => {
		for (let k = 0; k < n; k++) {
			scl.push(String(c));
			sda.push(String(d));
		}
	};
	push(1, 1, 2);
	let sdaPrev = 1;
	eventos.forEach((e) => {
		if (e.tipo === 'S') {
			const a = scl.length;
			push(1, 0);
			push(0, 0);
			campos.push(F(a, scl.length, 'S', COLORES.cond));
			sdaPrev = 0;
		} else if (e.tipo === 'Sr') {
			const a = scl.length;
			push(0, 1);
			push(1, 1);
			push(1, 0);
			push(0, 0);
			campos.push(F(a, scl.length, 'Sr', COLORES.cond));
			sdaPrev = 0;
		} else if (e.tipo === 'P') {
			if (sdaPrev === 1) push(0, 0);
			const a = scl.length;
			push(1, 0);
			push(1, 1);
			campos.push(F(a, scl.length, 'P', COLORES.cond));
			sdaPrev = 1;
		} else if (e.tipo === 'byte') {
			const bits = bitsMSB(e.v);
			const colorDato = e.esclavo ? COLORES.esclavo : COLORES.maestro;
			const ini = scl.length;
			const ponerBit = (b) => {
				const a = scl.length;
				push(0, b, 1);
				push(1, b, 2);
				push(0, b, 1);
				marcas.push({ t: a + 1, fila: 1 });
				return a;
			};
			const pos = bits.map((b) => ponerBit(b));
			const aAck = ponerBit(e.ack ? 0 : 1);
			sdaPrev = e.ack ? 0 : 1;
			const w = (n) => n * 4;
			if (e.rol === 'dir7') {
				campos.push(F(pos[0], pos[7], `Dir 0x${hex(e.v >> 1)}`, COLORES.maestro));
				campos.push(F(pos[7], pos[7] + w(1), e.rw === 'R' ? 'R' : 'W', COLORES.maestro));
			} else if (e.rol === 'dir10a') {
				campos.push(F(pos[0], pos[5], '11110', COLORES.maestro));
				campos.push(F(pos[5], pos[7], `A9:A8`, COLORES.maestro));
				campos.push(F(pos[7], pos[7] + w(1), e.rw === 'R' ? 'R' : 'W', COLORES.maestro));
			} else if (e.rol === 'dir10b') {
				campos.push(F(pos[0], pos[7] + w(1), `A7:A0 = 0x${hex(e.v)}`, COLORES.maestro));
			} else {
				campos.push(F(pos[0], pos[7] + w(1), `${e.esclavo ? 'Dato (esclavo)' : 'Dato'} 0x${hex(e.v)}`, colorDato));
			}
			// quien responde el ACK: el esclavo en dirección y escrituras; el maestro cuando lee datos
			const ackEsMaestro = e.rol === 'dato' && e.esclavo;
			campos.push(F(aAck, aAck + w(1), e.ack ? 'A' : 'N', ackEsMaestro ? COLORES.maestro : COLORES.esclavo, 0));
			void ini;
		}
	});
	// sin STOP final el bus queda con SCL bajo (la transacción sigue); con STOP o vacío, en reposo
	const libre = !eventos.length || eventos[eventos.length - 1].tipo === 'P';
	push(libre ? 1 : 0, libre ? 1 : sdaPrev, 2);
	const d = nuevoDiagrama(scl.length);
	d.titulo = `I²C ${(o.fHz / 1000).toLocaleString('es-AR')} kHz`;
	d.tickTime = 1 / (4 * o.fHz);
	d.rejilla = 4;
	d.regla = 'tiempo';
	d.senales = [
		{ nombre: 'SCL', celdas: scl },
		{ nombre: 'SDA', celdas: sda },
	];
	d.campos = campos;
	d.marcas = marcas;
	d.pxSugerido = 9;
	return d;
}

/** Eventos -> notación de texto ("S 50 W A 10 A P"), la misma que entiende parsearTexto. */
export function aTexto(eventos) {
	const ack = (e) => (e.ack ? 'A' : 'N');
	return eventos
		.map((e) => {
			if (e.tipo !== 'byte') return e.tipo;
			if (e.rol === 'dir7') return `${hex(e.v >> 1)} ${e.rw === 'R' ? 'R' : 'W'} ${ack(e)}`;
			return `${hex(e.v)} ${ack(e)}`;
		})
		.join(' ');
}

/** Interpretación en palabras de una lista de eventos (para la tabla). */
export function describir(eventos) {
	const filas = [];
	for (const e of eventos) {
		if (e.tipo === 'S') filas.push({ campo: 'START', valor: '', nota: 'SDA baja mientras SCL está alto' });
		else if (e.tipo === 'Sr') filas.push({ campo: 'START repetido', valor: '', nota: 'nuevo inicio sin liberar el bus' });
		else if (e.tipo === 'P') filas.push({ campo: 'STOP', valor: '', nota: 'SDA sube mientras SCL está alto' });
		else if (e.tipo === 'byte') {
			const a = e.ack ? 'ACK' : 'NACK';
			if (e.rol === 'dir7') filas.push({ campo: 'Dirección', valor: `0x${hex(e.v >> 1)}  ${e.rw === 'R' ? 'Lectura' : 'Escritura'}`, nota: `byte 0x${hex(e.v)} · ${a}${e.ack ? '' : ' (nadie respondió)'}` });
			else if (e.rol === 'dir10a') filas.push({ campo: 'Dirección (10 bits, parte alta)', valor: `0b11110${(e.v >> 1) & 3 ? ((e.v >> 1) & 3).toString(2).padStart(2, '0') : '00'}`, nota: `byte 0x${hex(e.v)} · ${e.rw === 'R' ? 'Lectura' : 'Escritura'} · ${a}` });
			else if (e.rol === 'dir10b') filas.push({ campo: 'Dirección (10 bits, parte baja)', valor: `0x${hex(e.v)}`, nota: a });
			else filas.push({ campo: e.esclavo ? 'Dato leído (lo manda el esclavo)' : 'Dato escrito (lo manda el maestro)', valor: `0x${hex(e.v)}  (${e.v})`, nota: `${a} del ${e.esclavo ? 'maestro' : 'esclavo'}` });
		}
	}
	return filas;
}

/** Eventos del texto o del decodificador -> dirección de 10 bits completa cuando corresponda (para la tabla). */
export const dir10 = (a, b) => ((((a.v >> 1) & 3) << 8) | b.v);

/**
 * Decodifica de señales por flancos { sda, scl }.
 * Devuelve { eventos: [...], transacciones: [[eventos con t0/t1]] }. Los eventos llevan t0, t1 y tBits (instantes de muestreo).
 */
export function decodificar(sda, scl, rango = {}) {
	const ev = [];
	sda.t.forEach((t, i) => ev.push({ t, s: 'sda', n: nivelDespues(sda, i) }));
	scl.t.forEach((t, i) => ev.push({ t, s: 'scl', n: nivelDespues(scl, i) }));
	ev.sort((a, b) => a.t - b.t);
	const t0 = rango.t0 ?? -Infinity;
	let sdaN = nivelEn(sda, t0);
	let sclN = nivelEn(scl, t0);
	const salida = [];
	let dentro = false;
	let bits = [];
	const cerrarBytes = (tFin, porCondicion = false) => {
		// antes de un Sr o un STOP el reloj sube una vez más con SDA preparándose: ese pulso no es un bit de dato
		if (porCondicion && bits.length % 9 === 1) bits.pop();
		// bits de a 9: 8 de dato + ACK
		for (let k = 0; k + 9 <= bits.length; k += 9) {
			const g = bits.slice(k, k + 9);
			const v = g.slice(0, 8).reduce((a, b) => (a << 1) | b.v, 0);
			salida.push({ tipo: 'byte', v, ack: g[8].v === 0, t0: g[0].t, t1: g[8].t, tBits: g.map((x) => x.t), rol: 'dato' });
		}
		if (bits.length % 9) salida.push({ tipo: 'incompleto', bitsSueltos: bits.length % 9, t0: bits[bits.length - (bits.length % 9)].t, t1: tFin });
		bits = [];
	};
	for (const e of ev) {
		if (e.t < t0) {
			if (e.s === 'sda') sdaN = e.n;
			else sclN = e.n;
			continue;
		}
		if (rango.t1 !== undefined && e.t > rango.t1) break;
		if (e.s === 'sda') {
			const prev = sdaN;
			sdaN = e.n;
			if (sclN === 1 && prev !== sdaN) {
				if (prev === 1 && sdaN === 0) {
					if (dentro) cerrarBytes(e.t, true);
					salida.push({ tipo: dentro ? 'Sr' : 'S', t0: e.t, t1: e.t });
					dentro = true;
				} else if (prev === 0 && sdaN === 1 && dentro) {
					cerrarBytes(e.t, true);
					salida.push({ tipo: 'P', t0: e.t, t1: e.t });
					dentro = false;
				}
			}
		} else {
			const prev = sclN;
			sclN = e.n;
			if (prev === 0 && sclN === 1 && dentro) bits.push({ t: e.t, v: sdaN });
		}
	}
	if (dentro) cerrarBytes(rango.t1 ?? (ev.length ? ev[ev.length - 1].t : 0));
	// roles: el primer byte tras S/Sr es la dirección; si es 11110xx se le suma la parte baja
	let esperaDir = false;
	let rw = 'W';
	let prevDir10 = null;
	for (const e of salida) {
		if (e.tipo === 'S' || e.tipo === 'Sr') esperaDir = true;
		else if (e.tipo === 'byte') {
			if (esperaDir) {
				esperaDir = false;
				rw = e.v & 1 ? 'R' : 'W';
				e.rw = rw;
				const alta = e.v >> 3;
				if (alta === 0x1e) {
					e.rol = 'dir10a';
					// la lectura de 10 bits repite solo el primer byte (tras el Sr): ahí no viene byte bajo
					prevDir10 = rw === 'W' ? e : null;
				} else e.rol = 'dir7';
			} else if (prevDir10) {
				e.rol = 'dir10b';
				e.rw = prevDir10.rw;
				prevDir10 = null;
			} else {
				e.rw = rw;
				e.esclavo = rw === 'R';
			}
		}
	}
	// agrupa por transacciones (S ... P)
	const transacciones = [];
	let actual = null;
	for (const e of salida) {
		if (e.tipo === 'S') {
			actual = [e];
			transacciones.push(actual);
		} else if (actual) actual.push(e);
		else {
			actual = [e];
			transacciones.push(actual);
		}
		if (e.tipo === 'P') actual = null;
	}
	return { eventos: salida, transacciones };
}
