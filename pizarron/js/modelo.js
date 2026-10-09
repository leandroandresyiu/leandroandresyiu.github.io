// El documento del pizarrón: páginas (hojas de tamaño fijo) con objetos, historial de deshacer y archivo .pizarron.
// Sin DOM: se prueba con Node (kumOS-diseno/pizarron-pruebas.mjs).
//
// Regla de oro: lo que ya está en el documento no se modifica "en el lugar". Para cambiar un objeto se pone otro en su
// lugar, y para cambiar la lista de objetos de una página se crea otra lista. Así una "instantánea" para deshacer es
// solo una copia de las listas (referencias), no de los objetos.
import { ESTILOS, nuevoId } from './geometria.js';

export const FORMATO = 'kumos-pizarron';
export const VERSION = 1;
export const MAX_PAGINAS = 300;
export const MAX_OBJETOS = 40000;
export const MAX_PUNTOS = 30000; // por objeto

/** Hojas: tamaño en px a 96 por pulgada (1 px = 1/96 in), en vertical. */
export const FORMATOS = {
	a4: { nombre: 'A4', ancho: 794, alto: 1123 },
	a5: { nombre: 'A5', ancho: 559, alto: 794 },
	a3: { nombre: 'A3', ancho: 1123, alto: 1587 },
	carta: { nombre: 'Carta', ancho: 816, alto: 1056 },
	'16:9': { nombre: 'Pantalla 16:9', ancho: 720, alto: 1280 },
	'4:3': { nombre: 'Pantalla 4:3', ancho: 768, alto: 1024 },
	cuadrada: { nombre: 'Cuadrada', ancho: 900, alto: 900 },
};
export const FONDOS = ['liso', 'rayado', 'cuadriculado', 'puntos'];
export const PASOS_MM = [4, 5, 6, 7, 8, 10];
export const mmAPx = (mm) => (mm * 96) / 25.4;

export const COLORES_PAGINA = ['#ffffff', '#fbf6e8', '#eceef1', '#dcebf7', '#222428', '#17352a'];

/** Medidas de una hoja según formato y orientación ('v' vertical, 'h' horizontal). */
export function medidasHoja(formato, orient) {
	const f = FORMATOS[formato] ?? FORMATOS.a4;
	return orient === 'h' ? { ancho: f.alto, alto: f.ancho } : { ancho: f.ancho, alto: f.alto };
}

export function paginaNueva(ref = null) {
	const formato = ref?.formato ?? 'a4';
	const orient = ref?.orient ?? 'h';
	return { id: nuevoId(), formato, orient, ...medidasHoja(formato, orient), fondo: ref?.fondo ?? 'puntos', pasoMm: ref?.pasoMm ?? 5, color: ref?.color ?? '#ffffff', objetos: [] };
}

export function docNuevo() {
	const ahora = Date.now();
	return { titulo: 'Pizarrón sin título', creado: ahora, modificado: ahora, paginas: [paginaNueva()], recursos: {} };
}

/** Copia barata del documento: las listas de objetos se comparten porque nunca se modifican en el lugar. */
export const instantanea = (doc) => ({ ...doc, paginas: doc.paginas.map((p) => ({ ...p })) });

// ---------------------------------------------------------------------------------------------- historial
export class Historial {
	constructor(max = 200) {
		this.max = max;
		this.pasado = [];
		this.futuro = [];
	}
	/** Se llama justo antes de cambiar algo: guarda cómo estaba. */
	antes(doc) {
		this.pasado.push(instantanea(doc));
		if (this.pasado.length > this.max) this.pasado.shift();
		this.futuro.length = 0;
	}
	get puedeDeshacer() {
		return this.pasado.length > 0;
	}
	get puedeRehacer() {
		return this.futuro.length > 0;
	}
	deshacer(doc) {
		if (!this.pasado.length) return null;
		this.futuro.push(instantanea(doc));
		return this.pasado.pop();
	}
	rehacer(doc) {
		if (!this.futuro.length) return null;
		this.pasado.push(instantanea(doc));
		return this.futuro.pop();
	}
	limpiar() {
		this.pasado.length = 0;
		this.futuro.length = 0;
	}
}

// ---------------------------------------------------------------------------------------------- archivo
const COLOR = /^#[0-9a-f]{3,8}$/i;
export const ID_RECURSO = /^[a-z0-9]{4,40}$/i;
const MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
export const MAX_BYTES_RECURSOS = 60 * 1024 * 1024;
const color = (v, def) => (typeof v === 'string' && COLOR.test(v) ? v : def);
const numero = (v, def, min = -1e5, max = 1e5) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def);
const decimas = (v) => Math.round(v * 10) / 10;

/** Puntos [x,y,…] → [x0,y0,dx,dy,…] en décimas de px (enteros chicos: el archivo pesa mucho menos). */
export function codificarPuntos(p) {
	const out = new Array(p.length);
	let ax = 0;
	let ay = 0;
	for (let i = 0; i < p.length; i += 2) {
		const x = Math.round(p[i] * 10);
		const y = Math.round(p[i + 1] * 10);
		out[i] = x - ax;
		out[i + 1] = y - ay;
		ax = x;
		ay = y;
	}
	return out;
}
export function decodificarPuntos(c) {
	const out = new Array(c.length);
	let ax = 0;
	let ay = 0;
	for (let i = 0; i < c.length; i += 2) {
		ax += c[i];
		ay += c[i + 1];
		out[i] = ax / 10;
		out[i + 1] = ay / 10;
	}
	return out;
}

const esLista = (v) => Array.isArray(v) && v.length % 2 === 0 && v.length <= MAX_PUNTOS * 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

/** Pasa un objeto leído de un archivo (que puede venir de cualquier lado) a uno válido, o devuelve null. */
export function limpiarObjeto(r, recursos = null) {
	if (!r || typeof r !== 'object') return null;
	const comun = {
		id: typeof r.id === 'string' && r.id ? r.id.slice(0, 40) : nuevoId(),
		c: color(r.c, '#111111'),
		g: numero(r.g, 3, 0.2, 200),
		e: ESTILOS.includes(r.e) ? r.e : 'continua',
		op: numero(r.op, 1, 0.05, 1),
	};
	const relleno = r.r === null || r.r === undefined ? null : color(r.r, null);
	const n = (k, def = 0, min, max) => numero(r[k], def, min, max);
	switch (r.t) {
		case 'trazo': {
			const p = r.pc !== undefined ? (esLista(r.pc) ? decodificarPuntos(r.pc) : null) : esLista(r.p) ? r.p : null;
			if (!p || p.length < 2) return null;
			return { ...comun, t: 'trazo', p, ...(r.res ? { res: true } : {}) };
		}
		case 'linea':
			return { ...comun, t: 'linea', x1: n('x1'), y1: n('y1'), x2: n('x2'), y2: n('y2'), fi: r.fi ? 1 : 0, ff: r.ff ? 1 : 0 };
		case 'rect':
			return { ...comun, t: 'rect', x: n('x'), y: n('y'), ancho: n('ancho', 1, 0), alto: n('alto', 1, 0), r: relleno };
		case 'elipse':
			return { ...comun, t: 'elipse', cx: n('cx'), cy: n('cy'), rx: n('rx', 1, 0), ry: n('ry', 1, 0), r: relleno };
		case 'poli': {
			const p = r.pc !== undefined ? (esLista(r.pc) ? decodificarPuntos(r.pc) : null) : esLista(r.p) ? r.p : null;
			if (!p || p.length < 4) return null;
			return { ...comun, t: 'poli', p, cerrado: !!r.cerrado, r: relleno };
		}
		case 'ejes':
			return { ...comun, t: 'ejes', x: n('x'), y: n('y'), ancho: n('ancho', 100, 10), alto: n('alto', 100, 10), modo: r.modo === 'cruz' ? 'cruz' : 'L', marcas: !!r.marcas, etq: !!r.etq, paso: n('paso', 32, 8, 400) };
		case 'texto': {
			if (typeof r.s !== 'string' || !r.s.trim()) return null;
			return { ...comun, t: 'texto', x: n('x'), y: n('y'), s: r.s.slice(0, 5000), tam: n('tam', 24, 6, 400), cur: !!r.cur };
		}
		case 'imagen': {
			// solo si la imagen está en los recursos del archivo (o no se está comprobando)
			if (typeof r.img !== 'string' || !ID_RECURSO.test(r.img) || (recursos && !recursos[r.img])) return null;
			return { ...comun, t: 'imagen', img: r.img, cx: n('cx'), cy: n('cy'), ancho: n('ancho', 100, 4, 20000), alto: n('alto', 100, 4, 20000), rot: n('rot', 0, -1000, 1000), fx: r.fx ? 1 : 0, fy: r.fy ? 1 : 0 };
		}
		default:
			return null;
	}
}

function limpiarPagina(r, recursos) {
	if (!r || typeof r !== 'object') return null;
	const formato = FORMATOS[r.formato] ? r.formato : 'a4';
	const orient = r.orient === 'h' ? 'h' : 'v';
	const ancho = numero(r.ancho, medidasHoja(formato, orient).ancho, 100, 6000);
	const alto = numero(r.alto, medidasHoja(formato, orient).alto, 100, 6000);
	const objetos = [];
	for (const o of Array.isArray(r.objetos) ? r.objetos : []) {
		if (objetos.length >= MAX_OBJETOS) break;
		const l = limpiarObjeto(o, recursos);
		if (l) objetos.push(l);
	}
	return {
		id: typeof r.id === 'string' && r.id ? r.id.slice(0, 40) : nuevoId(),
		formato,
		orient,
		ancho,
		alto,
		fondo: FONDOS.includes(r.fondo) ? r.fondo : 'liso',
		pasoMm: numero(r.pasoMm, 5, 2, 30),
		color: color(r.color, '#ffffff'),
		objetos,
	};
}

/** Aplana un objeto para guardarlo: los puntos van codificados en décimas y los números con un decimal. */
function aplanar(o) {
	const r = { ...o };
	if (o.t === 'trazo' || o.t === 'poli') {
		delete r.p;
		r.pc = codificarPuntos(o.p);
	}
	for (const k of ['x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'rx', 'ry', 'ancho', 'alto']) if (typeof r[k] === 'number') r[k] = decimas(r[k]);
	if (typeof r.rot === 'number') r.rot = Math.round(r.rot * 1000) / 1000;
	if (r.fx === 0) delete r.fx;
	if (r.fy === 0) delete r.fy;
	if (r.rot === 0) delete r.rot;
	if (r.op === 1) delete r.op;
	if (r.e === 'continua') delete r.e;
	if (r.r === null) delete r.r;
	return r;
}

/** Los recursos (imágenes) que alguna página usa de verdad. */
export function recursosUsados(doc) {
	const usados = {};
	for (const p of doc.paginas) for (const o of p.objetos) if (o.t === 'imagen' && doc.recursos?.[o.img]) usados[o.img] = doc.recursos[o.img];
	return usados;
}

export function serializar(doc, espacios = 0) {
	const salida = {
		formato: FORMATO,
		version: VERSION,
		titulo: doc.titulo,
		creado: doc.creado,
		modificado: doc.modificado,
		recursos: recursosUsados(doc),
		paginas: doc.paginas.map((p) => ({ ...p, objetos: p.objetos.map(aplanar) })),
	};
	return JSON.stringify(salida, null, espacios || undefined);
}

/** Lee el texto de un archivo .pizarron. Lanza un Error con un mensaje en castellano si no sirve. */
export function deserializar(texto) {
	let r;
	try {
		r = JSON.parse(texto);
	} catch {
		throw new Error('El archivo no tiene el formato de un pizarrón (no se pudo leer).');
	}
	if (!r || r.formato !== FORMATO) throw new Error('Este archivo no es un pizarrón de kumOS.');
	if (!(r.version <= VERSION)) throw new Error('Este pizarrón se guardó con una versión más nueva; actualizá kumOS.');
	// imágenes: solo tipos conocidos y datos en base64 (todo lo demás se descarta)
	const recursos = {};
	let total = 0;
	for (const [id, v] of Object.entries(r.recursos && typeof r.recursos === 'object' ? r.recursos : {})) {
		if (!ID_RECURSO.test(id) || !v || !MIMES.has(v.mime) || typeof v.datos !== 'string' || !BASE64.test(v.datos)) continue;
		total += v.datos.length;
		if (total > MAX_BYTES_RECURSOS) break;
		recursos[id] = { mime: v.mime, datos: v.datos };
	}
	const paginas = (Array.isArray(r.paginas) ? r.paginas : []).slice(0, MAX_PAGINAS).map((x) => limpiarPagina(x, recursos)).filter(Boolean);
	if (!paginas.length) paginas.push(paginaNueva());
	const ahora = Date.now();
	return { titulo: typeof r.titulo === 'string' && r.titulo.trim() ? r.titulo.slice(0, 90) : 'Pizarrón sin título', creado: numero(r.creado, ahora, 0, 1e14), modificado: numero(r.modificado, ahora, 0, 1e14), paginas, recursos };
}

/** Estadística rápida para mostrar y para avisar si el archivo se va a poner pesado. */
export function resumen(doc) {
	let objetos = 0;
	for (const p of doc.paginas) objetos += p.objetos.length;
	return { paginas: doc.paginas.length, objetos };
}

/** Pone ids nuevos a los objetos (para pegar o duplicar sin que se pisen con los originales). */
export const conIdNuevo = (o) => ({ ...o, id: nuevoId() });

/** Nombre de archivo seguro a partir del título. */
export const nombreSeguro = (t) => (String(t || 'Pizarrón').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim().slice(0, 80) || 'Pizarrón');
