// Conversor de bits: de un valor (decimal, hexadecimal, binario, octal, texto o flotante) a todas las demás formas.
// Sin DOM, con BigInt (hasta 64 bits) para poder probarlo con Node.

export const FORMATOS = {
	hex: 'Hexadecimal',
	dec: 'Decimal',
	bin: 'Binario',
	oct: 'Octal',
	ascii: 'Texto (ASCII)',
	float: 'Flotante (IEEE 754)',
};
export const ANCHOS = ['auto', 8, 16, 32, 64];

const MASCARA = (n) => (1n << BigInt(n)) - 1n;
const bitsDe = (v) => (v === 0n ? 1 : v.toString(2).length);
/** Ancho mínimo (8, 16, 32 o 64) en que entra un valor sin signo. */
const anchoMinimo = (v) => [8, 16, 32, 64].find((n) => bitsDe(v) <= n) ?? 64;

/**
 * Lee lo que se escribió. `ancho`: 'auto' o 8/16/32/64 (en flotantes, auto = 32 bits).
 * Devuelve { valor: BigInt sin signo, ancho, avisos } o { error }.
 */
export function leerEntrada(texto, formato, ancho = 'auto') {
	const avisos = [];
	const t = String(texto ?? '').trim();
	if (!t) return { error: null, vacio: true };
	try {
		let valor;
		if (formato === 'ascii') {
			const bytes = [...new TextEncoder().encode(t.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\\0/g, '\0'))];
			if (bytes.length > 8) throw new Error('Con texto entran hasta 8 caracteres (64 bits).');
			valor = bytes.reduce((a, b) => (a << 8n) | BigInt(b), 0n);
			const necesario = [8, 16, 32, 64].find((x) => x >= bytes.length * 8) ?? 64;
			return { valor, ancho: ancho === 'auto' ? necesario : Math.max(ancho, necesario), avisos };
		}
		if (formato === 'float') {
			const x = Number(t.replace(',', '.'));
			if (!Number.isFinite(x) && !/^[+-]?(inf|infinity)$/i.test(t)) throw new Error('No es un número. Por ejemplo: 3,14 o 1e-3.');
			const w = ancho === 64 ? 64 : ancho === 16 ? 16 : 32;
			valor = floatABits(Number.isFinite(x) ? x : /^-/.test(t) ? -Infinity : Infinity, w);
			return { valor, ancho: w, avisos };
		}
		const limpio = t.replace(/[\s_]/g, '');
		if (formato === 'dec') {
			if (!/^-?\d+$/.test(limpio)) throw new Error('El decimal lleva solo dígitos (y un − adelante si es negativo).');
			let n = BigInt(limpio);
			const negativo = n < 0n;
			const necesita = negativo ? bitsDe(-n - 1n) + 1 : bitsDe(n);
			let w = ancho === 'auto' ? [8, 16, 32, 64].find((x) => necesita <= x) ?? 64 : ancho;
			if (necesita > w) {
				avisos.push(`${limpio} no entra en ${w} bits: se recorta.`);
			}
			if (negativo) n = (1n << BigInt(w)) + n; // complemento a dos
			return { valor: n & MASCARA(w), ancho: w, avisos };
		}
		const base = { hex: 16, bin: 2, oct: 8 }[formato];
		const dig = { hex: /^(0x)?[0-9a-f]+$/i, bin: /^(0b)?[01]+$/i, oct: /^(0o)?[0-7]+$/i }[formato];
		if (!dig.test(limpio)) throw new Error({ hex: 'El hexadecimal lleva dígitos 0 a 9 y A a F.', bin: 'El binario lleva solo 0 y 1.', oct: 'El octal lleva dígitos de 0 a 7.' }[formato]);
		const sin = limpio.replace(/^0[xbo]/i, '');
		valor = BigInt((base === 16 ? '0x' : base === 2 ? '0b' : '0o') + sin);
		// los ceros de la izquierda cuentan para el ancho (0x00FF son 16 bits)
		const dig2 = sin.length;
		const anchoDeTexto = base === 16 ? dig2 * 4 : base === 2 ? dig2 : Math.ceil((dig2 * 3) / 8) * 8;
		let w = ancho === 'auto' ? [8, 16, 32, 64].find((x) => Math.max(bitsDe(valor), anchoDeTexto) <= x) ?? 64 : ancho;
		if (bitsDe(valor) > w) avisos.push(`El valor necesita ${bitsDe(valor)} bits y el ancho es ${w}: se recorta.`);
		if (bitsDe(valor) > 64) throw new Error('Hasta 64 bits.');
		return { valor: valor & MASCARA(w), ancho: w, avisos };
	} catch (e) {
		return { error: e.message };
	}
}

// ------------------------------------------------------------------ flotantes
export function floatABits(x, ancho) {
	const dv = new DataView(new ArrayBuffer(8));
	if (ancho === 64) {
		dv.setFloat64(0, x);
		return dv.getBigUint64(0);
	}
	if (ancho === 32) {
		dv.setFloat32(0, x);
		return BigInt(dv.getUint32(0));
	}
	// media precisión (binary16)
	if (Number.isNaN(x)) return 0x7e00n;
	const s = x < 0 || Object.is(x, -0) ? 1 : 0;
	const a = Math.abs(x);
	if (a === Infinity) return BigInt((s << 15) | 0x7c00);
	if (a === 0) return BigInt(s << 15);
	let e = Math.floor(Math.log2(a));
	let m;
	if (e < -14) {
		m = Math.round(a / 2 ** -24); // subnormal
		e = -15;
	} else {
		m = Math.round((a / 2 ** e - 1) * 1024);
		if (m === 1024) {
			m = 0;
			e++;
		}
	}
	if (e > 15) return BigInt((s << 15) | 0x7c00);
	return BigInt((s << 15) | ((e + 15) << 10) | m);
}

export function bitsAFloat(valor, ancho) {
	const dv = new DataView(new ArrayBuffer(8));
	if (ancho === 64) {
		dv.setBigUint64(0, valor);
		return dv.getFloat64(0);
	}
	if (ancho === 32) {
		dv.setUint32(0, Number(valor));
		return dv.getFloat32(0);
	}
	if (ancho === 16) {
		const v = Number(valor);
		const s = v >> 15 ? -1 : 1;
		const e = (v >> 10) & 31;
		const m = v & 1023;
		if (e === 0) return s * m * 2 ** -24;
		if (e === 31) return m ? NaN : s * Infinity;
		return s * (1 + m / 1024) * 2 ** (e - 15);
	}
	return null;
}

const numero = (x) => (Number.isNaN(x) ? 'NaN' : !Number.isFinite(x) ? (x < 0 ? '−∞' : '∞') : String(Number(x.toPrecision(9))).replace('.', ','));

// ------------------------------------------------------------------ salidas
const agrupar = (s, n) => s.replace(new RegExp(`(.{${n}})(?=.)`, 'g'), '$1 ');
const bytesDe = (valor, ancho) => Array.from({ length: ancho / 8 }, (_, i) => Number((valor >> BigInt(8 * (ancho / 8 - 1 - i))) & 0xffn));
const hex2 = (b) => b.toString(16).toUpperCase().padStart(2, '0');

/**
 * Todas las formas de un valor. Devuelve una lista [{ id, nombre, valor, nota? }] lista para mostrar y copiar.
 */
export function formas(valor, ancho) {
	const sinSigno = valor & MASCARA(ancho);
	const conSigno = sinSigno >= 1n << BigInt(ancho - 1) ? sinSigno - (1n << BigInt(ancho)) : sinSigno;
	const bytes = bytesDe(sinSigno, ancho);
	const unos = [...sinSigno.toString(2)].reduce((a, c) => a + (c === '1' ? 1 : 0), 0);
	const posiciones = [];
	for (let i = ancho - 1; i >= 0; i--) if ((sinSigno >> BigInt(i)) & 1n) posiciones.push(`b${i}`);
	const imprimible = bytes.every((b) => b >= 32 && b < 127);
	const texto = bytes.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : b === 10 ? '\\n' : b === 13 ? '\\r' : b === 9 ? '\\t' : b === 0 ? '\\0' : `\\x${hex2(b)}`)).join('');
	const lista = [
		{ id: 'hex', nombre: 'Hexadecimal', valor: `0x${sinSigno.toString(16).toUpperCase().padStart(ancho / 4, '0')}` },
		{ id: 'dec', nombre: 'Decimal', valor: sinSigno.toString() },
		{ id: 'decs', nombre: 'Decimal con signo', valor: conSigno.toString(), nota: 'complemento a dos' },
		{ id: 'bin', nombre: 'Binario', valor: agrupar(sinSigno.toString(2).padStart(ancho, '0'), 4) },
		{ id: 'oct', nombre: 'Octal', valor: `0o${sinSigno.toString(8)}` },
		{ id: 'ascii', nombre: 'Texto ASCII', valor: texto, nota: imprimible ? '' : 'hay caracteres que no se imprimen' },
		{ id: 'be', nombre: 'Bytes (el más significativo primero)', valor: bytes.map(hex2).join(' '), nota: 'big-endian' },
		{ id: 'le', nombre: 'Bytes (el menos significativo primero)', valor: [...bytes].reverse().map(hex2).join(' '), nota: 'little-endian' },
		{ id: 'unos', nombre: 'Bits en 1', valor: `${unos}${posiciones.length ? ` (${posiciones.join(', ')})` : ''}` },
	];
	if ([16, 32, 64].includes(ancho)) {
		const x = bitsAFloat(sinSigno, ancho);
		const campos = ancho === 16 ? [1, 5, 10] : ancho === 32 ? [1, 8, 23] : [1, 11, 52];
		const b = sinSigno.toString(2).padStart(ancho, '0');
		lista.push({ id: 'float', nombre: `Flotante de ${ancho} bits`, valor: numero(x), nota: `signo ${b.slice(0, 1)} · exponente ${b.slice(1, 1 + campos[1])} · mantisa ${b.slice(1 + campos[1])}` });
	}
	return lista;
}

/** Cambia un bit (0 = el menos significativo). */
export const girarBit = (valor, i, ancho) => (valor ^ (1n << BigInt(i))) & MASCARA(ancho);

/** El valor en hexadecimal listo para volver a escribirlo como entrada. */
export const comoHex = (valor, ancho) => valor.toString(16).toUpperCase().padStart(ancho / 4, '0');
