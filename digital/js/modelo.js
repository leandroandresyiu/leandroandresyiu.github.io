// Modelo de datos de Digital: diagramas de tiempos editables (por casillas) y su conversión a segmentos y a WaveJSON.
//
// Un diagrama editable tiene una grilla de "ticks" (instantes). Cada señal es un arreglo de casillas, una por tick:
//   '0' | '1' | 'x' (indefinido) | 'z' (alta impedancia) | '-' (vacío, no se dibuja) | { d: 'texto', k: n } (dato de un bus)
// Casillas contiguas de bus con el mismo texto y el mismo k forman un solo bloque.

export const NIVELES = ['0', '1', 'x', 'z', '-'];

export const esBus = (c) => c !== null && typeof c === 'object';

/** Diagrama nuevo con unas señales de ejemplo. */
export function nuevoDiagrama(ticks = 16) {
	const d = { titulo: '', ticks, tickTime: null, rejilla: 1, regla: 'ticks', bandas: true, senales: [], campos: [], marcas: [], cursores: [] };
	return d;
}

export function senalVacia(nombre, ticks, valor = '0') {
	return { nombre, celdas: Array.from({ length: ticks }, () => valor) };
}

export function relojCeldas(ticks, medio = 1, empiezaEn = '1') {
	const a = empiezaEn === '1' ? '1' : '0';
	const b = a === '1' ? '0' : '1';
	return Array.from({ length: ticks }, (_, i) => (Math.floor(i / Math.max(1, medio)) % 2 === 0 ? a : b));
}

export const clonar = (o) => JSON.parse(JSON.stringify(o));

/** Casillas -> segmentos [{a, b, v, d?}] (a y b en ticks; b excluido). Junta casillas iguales contiguas. */
export function celdasASegs(celdas, desde = 0) {
	const segs = [];
	for (let i = 0; i < celdas.length; i++) {
		const c = celdas[i];
		if (c === '-' || c === undefined) continue;
		const bus = esBus(c);
		const v = bus ? 'd' : c;
		const ult = segs[segs.length - 1];
		const igual = ult && ult.b === desde + i && ult.v === v && (!bus || (ult.d === c.d && ult.k === (c.k ?? 0)));
		if (igual) ult.b = desde + i + 1;
		else segs.push(bus ? { a: desde + i, b: desde + i + 1, v, d: c.d, k: c.k ?? 0 } : { a: desde + i, b: desde + i + 1, v });
	}
	return segs;
}

/** Diagrama editable -> descripción para el dibujo. */
export function aVista(d) {
	return {
		titulo: d.titulo,
		unidad: 'ticks',
		tickTime: d.tickTime,
		t0: 0,
		t1: d.ticks,
		regla: d.regla,
		rejilla: d.rejilla ? { paso: d.rejilla, origen: 0 } : null,
		bandas: d.bandas,
		senales: d.senales.map((s) => ({ nombre: s.nombre, segs: celdasASegs(s.celdas), color: s.color })),
		campos: d.campos,
		marcas: d.marcas,
		cursores: d.cursores,
	};
}

/** Cambia la cantidad de ticks, completando con el último valor simple (o 'z' en buses). */
export function cambiarTicks(d, n) {
	n = Math.max(1, Math.min(2000, Math.round(n)));
	for (const s of d.senales) {
		if (s.celdas.length > n) s.celdas.length = n;
		else {
			const ult = s.celdas[s.celdas.length - 1];
			const relleno = esBus(ult) || ult === undefined || ult === '-' ? 'z' : ult;
			while (s.celdas.length < n) s.celdas.push(relleno);
		}
	}
	d.campos = d.campos.filter((c) => c.a < n).map((c) => ({ ...c, b: Math.min(c.b, n) }));
	d.marcas = d.marcas.filter((m) => m.t < n);
	d.cursores = d.cursores.filter((c) => c.t <= n);
	d.ticks = n;
}

// ------------------------------------------------------------------ formato de tiempos
const UNIDADES = [
	[1, 's'],
	[1e-3, 'ms'],
	[1e-6, 'µs'],
	[1e-9, 'ns'],
	[1e-12, 'ps'],
];
const limpiar = (x) => {
	let s = Number(x.toPrecision(3)).toString();
	if (/e/.test(s)) s = x.toFixed(3);
	return s.replace('.', ','); // coma decimal
};
/** 0.0000025 -> "2.5 µs" */
export function fmtTiempo(seg) {
	const a = Math.abs(seg);
	if (a === 0) return '0 s';
	for (const [f, u] of UNIDADES) if (a >= f * 0.9995) return `${limpiar(seg / f)} ${u}`;
	return `${limpiar(seg / 1e-12)} ps`;
}
export function fmtFrecuencia(hz) {
	const a = Math.abs(hz);
	if (!isFinite(hz) || a === 0) return '—';
	if (a >= 1e9) return `${limpiar(hz / 1e9)} GHz`;
	if (a >= 1e6) return `${limpiar(hz / 1e6)} MHz`;
	if (a >= 1e3) return `${limpiar(hz / 1e3)} kHz`;
	return `${limpiar(hz)} Hz`;
}

// ------------------------------------------------------------------ WaveJSON (el formato de WaveDrom)
/** Diagrama -> objeto WaveJSON (cada tick pasa a ser una casilla). */
export function aWaveJSON(d) {
	const signal = d.senales.map((s) => {
		let wave = '';
		const data = [];
		let ult = null;
		for (const c of s.celdas) {
			if (esBus(c)) {
				if (ult && esBus(ult) && ult.d === c.d && (ult.k ?? 0) === (c.k ?? 0)) wave += '.';
				else {
					wave += '=';
					data.push(c.d);
				}
			} else wave += c === '-' ? 'z' : c;
			ult = c;
		}
		const o = { name: s.nombre, wave };
		if (data.length) o.data = data;
		return o;
	});
	const j = { signal };
	if (d.titulo) j.head = { text: d.titulo };
	return j;
}

/** Objeto WaveJSON -> diagrama. Acepta 0 1 x z l h L H u d p P n N = 2-9 . | (lo demás se ignora). */
export function deWaveJSON(j) {
	if (typeof j === 'string') j = parseWaveJSONTexto(j);
	if (!j || !Array.isArray(j.signal)) throw new Error('No es un WaveJSON válido (falta "signal").');
	const filas = [];
	const aplanar = (arr) => {
		for (const it of arr) {
			if (Array.isArray(it)) aplanar(it.slice(typeof it[0] === 'string' ? 1 : 0));
			else if (it && typeof it === 'object' && typeof it.wave === 'string') filas.push(it);
		}
	};
	aplanar(j.signal);
	if (!filas.length) throw new Error('El WaveJSON no tiene señales con "wave".');
	const usaReloj = filas.some((f) => /[pPnN]/.test(f.wave));
	const exp = usaReloj ? 2 : 1;
	const d = nuevoDiagrama(1);
	let maxLen = 0;
	for (const f of filas) {
		const datos = Array.isArray(f.data) ? f.data.map(String) : typeof f.data === 'string' ? f.data.trim().split(/\s+/) : [];
		let di = 0;
		let bloque = 0;
		const celdas = [];
		let prev = null; // último carácter con significado
		let ultCelda = '0';
		for (const ch of f.wave) {
			let c = ch;
			if (c === '.' || c === '|') c = prev === null ? '0' : prev;
			else if (c !== ' ') prev = c;
			if (c === ' ') continue;
			if ('pPnN'.includes(c)) {
				const par = c === 'p' || c === 'P' ? ['1', '0'] : ['0', '1'];
				celdas.push(par[0], par[1]);
				ultCelda = par[1];
			} else if (c === '=' || /[2-9]/.test(c)) {
				// '=' nuevo dato; si vino de un '.', sigue el mismo bloque
				const nuevo = ch !== '.' && ch !== '|';
				if (nuevo) bloque++;
				const txt = nuevo ? (datos[di++] ?? '') : (celdas.length && esBus(celdas[celdas.length - 1]) ? celdas[celdas.length - 1].d : '');
				for (let k = 0; k < exp; k++) celdas.push({ d: txt, k: bloque });
				ultCelda = celdas[celdas.length - 1];
			} else {
				const v = { l: '0', L: '0', h: '1', H: '1', u: '1', d: '0' }[c] ?? c;
				const val = '01xz'.includes(v) ? v : 'x';
				for (let k = 0; k < exp; k++) celdas.push(val);
				ultCelda = val;
			}
		}
		if (usaReloj) {
			/* los relojes ya ocupan 2 ticks; el resto ocupa exp ticks: queda consistente */
		}
		d.senales.push({ nombre: String(f.name ?? ''), celdas });
		maxLen = Math.max(maxLen, celdas.length);
	}
	for (const s of d.senales) while (s.celdas.length < maxLen) s.celdas.push(esBus(s.celdas[s.celdas.length - 1]) ? 'z' : (s.celdas[s.celdas.length - 1] ?? '0'));
	d.ticks = maxLen || 1;
	if (j.head && j.head.text) d.titulo = String(j.head.text);
	return d;
}

/** WaveDrom admite JSON "relajado" (comillas simples, claves sin comillas): se intenta ordenar. */
export function parseWaveJSONTexto(txt) {
	const t = String(txt).trim();
	try {
		return JSON.parse(t);
	} catch {
		const arreglado = t
			.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')
			.replace(/'/g, '"')
			.replace(/,\s*([}\]])/g, '$1');
		return JSON.parse(arreglado);
	}
}
