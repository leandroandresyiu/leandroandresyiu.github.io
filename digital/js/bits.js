// Utilidades de datos: conversión entre hexadecimal, ASCII, decimal y binario, y señales lógicas por flancos.

export const hex = (n, w = 2) => Math.round(n).toString(16).toUpperCase().padStart(w, '0');
export const bin = (n, w = 8) => Math.round(n).toString(2).padStart(w, '0');

/** Carácter para mostrar un byte (los no imprimibles salen como escape). */
export function car(b) {
	if (b >= 32 && b < 127) return String.fromCharCode(b);
	return { 0: 'NUL', 7: 'BEL', 8: 'BS', 9: '\\t', 10: '\\n', 13: '\\r', 27: 'ESC', 127: 'DEL' }[b] ?? '·';
}

export const FORMATOS = { hex: 'Hexadecimal', ascii: 'Texto (ASCII)', dec: 'Decimal', bin: 'Binario' };

/** Texto del usuario -> { bytes, error }. */
export function parseDatos(txt, formato = 'hex', maximo = 4096) {
	const bytes = [];
	const t = String(txt ?? '');
	try {
		if (formato === 'ascii') {
			const enc = new TextEncoder();
			for (let i = 0; i < t.length; i++) {
				if (t[i] === '\\' && i + 1 < t.length) {
					const n = t[i + 1];
					const mapa = { n: 10, r: 13, t: 9, '0': 0, '\\': 92 };
					if (n in mapa) {
						bytes.push(mapa[n]);
						i++;
						continue;
					}
					if (n === 'x' && /^[0-9a-fA-F]{2}$/.test(t.slice(i + 2, i + 4))) {
						bytes.push(parseInt(t.slice(i + 2, i + 4), 16));
						i += 3;
						continue;
					}
				}
				const cp = t.codePointAt(i);
				if (cp > 0xffff) i++;
				bytes.push(...enc.encode(String.fromCodePoint(cp)));
			}
		} else {
			const toks = t.split(/[\s,;:]+/).filter(Boolean);
			for (let tok of toks) {
				if (formato === 'hex') {
					tok = tok.replace(/^0x/i, '').replace(/^\\x/i, '');
					if (!tok) continue;
					if (!/^[0-9a-fA-F]+$/.test(tok)) throw new Error(`"${tok}" no es hexadecimal`);
					if (tok.length === 1) bytes.push(parseInt(tok, 16));
					else if (tok.length % 2) throw new Error(`"${tok}" tiene una cantidad impar de dígitos`);
					else for (let i = 0; i < tok.length; i += 2) bytes.push(parseInt(tok.slice(i, i + 2), 16));
				} else if (formato === 'dec') {
					if (!/^\d+$/.test(tok)) throw new Error(`"${tok}" no es un número decimal`);
					const v = parseInt(tok, 10);
					if (v > 255) throw new Error(`${v} no entra en un byte (0 a 255)`);
					bytes.push(v);
				} else if (formato === 'bin') {
					tok = tok.replace(/^0b/i, '');
					if (!/^[01]+$/.test(tok)) throw new Error(`"${tok}" no es binario`);
					for (let i = 0; i < tok.length; i += 8) bytes.push(parseInt(tok.slice(i, i + 8), 2));
				}
			}
		}
	} catch (e) {
		return { bytes: [], error: e.message };
	}
	if (bytes.length > maximo) return { bytes: bytes.slice(0, maximo), error: `Son demasiados datos (el máximo es ${maximo} bytes).` };
	return { bytes, error: null };
}

/** Texto de bits ("0101 1100", "1,0,1") -> arreglo de 0/1. */
export function parseBits(txt) {
	const s = String(txt ?? '').replace(/[^01xX]/g, '');
	return [...s].map((c) => (c === '1' ? 1 : 0));
}

// ------------------------------------------------------------------ señales lógicas por flancos
// { v0: nivel inicial (0|1), t: [instantes de cada flanco] } — cada flanco invierte el nivel.

/** Nivel de la señal en el instante t (el flanco cuenta desde su instante). */
export function nivelEn(s, t) {
	let lo = 0;
	let hi = s.t.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (s.t[mid] <= t) lo = mid + 1;
		else hi = mid;
	}
	return s.v0 ^ (lo & 1);
}

/** Primer índice con s.t[i] >= x. */
export function primerFlancoDesde(s, x) {
	let lo = 0;
	let hi = s.t.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (s.t[mid] < x) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}

/** Nivel después del flanco i. */
export const nivelDespues = (s, i) => s.v0 ^ ((i + 1) & 1);

/** Arreglo de bits (una muestra por posición, de duración T) -> señal por flancos. */
export function senalDesdeBits(bits, T = 1, t0 = 0) {
	const t = [];
	for (let i = 1; i < bits.length; i++) if (bits[i] !== bits[i - 1]) t.push(t0 + i * T);
	return { v0: bits.length ? bits[0] : 1, t };
}

/** Señal por flancos -> segmentos para dibujar [{a, b, v}] entre t0 y t1. */
export function senalASegs(s, t0, t1) {
	const segs = [];
	let a = t0;
	let v = nivelEn(s, t0);
	for (let i = primerFlancoDesde(s, t0 + 1e-15); i < s.t.length && s.t[i] < t1; i++) {
		if (s.t[i] > a) segs.push({ a, b: s.t[i], v: String(v) });
		a = s.t[i];
		v = nivelDespues(s, i);
	}
	if (t1 > a) segs.push({ a, b: t1, v: String(v) });
	return segs;
}
