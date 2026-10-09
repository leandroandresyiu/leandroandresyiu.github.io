// Geometría de los objetos del pizarrón. No toca el DOM: la usan la pantalla (canvas), el SVG, el PDF y las pruebas de Node.
// Una sola fuente de verdad: cada objeto se convierte en trazos de camino SVG (`partesDe`) y en textos (`textosDe`);
// el canvas los dibuja con Path2D y la exportación los escribe tal cual, así lo que se ve es lo que sale en el PDF.
//
// Los objetos son inmutables: para cambiar uno se crea otro (mover, escalar, {...o, c: '#f00'}). Eso hace que deshacer
// sea barato (se guardan referencias, no copias) y que las cachés por objeto (WeakMap) nunca queden viejas.
//
// Objetos: trazo (a mano), linea, rect, elipse, poli (polilínea o polígono), ejes, texto e imagen (centro, tamaño y giro).
// Campos comunes: id, t (tipo), c (color), g (grosor), e (estilo de línea), op (opacidad 0–1). Los cerrados tienen r (relleno).
import { trozos } from './fuentes.js';

/** Redondea para escribir en SVG o en archivos: 2 decimales y sin "-0". */
export const num = (v) => {
	const r = Math.round(v * 100) / 100;
	return Object.is(r, -0) ? '0' : String(r);
};

let contador = 0;
export const nuevoId = () => `o${Date.now().toString(36)}${(contador++).toString(36)}`;

export const ESTILOS = ['continua', 'guiones', 'puntos', 'guionpunto'];

/** Patrón de rayas (en px) para un estilo y un grosor; los puntos son rayas casi nulas con extremos redondos. */
export function patron(estilo, g) {
	const u = Math.max(g, 1.6);
	switch (estilo) {
		case 'guiones':
			return [u * 4, u * 2.6];
		case 'puntos':
			return [0.01, u * 2.4];
		case 'guionpunto':
			return [u * 5, u * 2.2, 0.01, u * 2.2];
		default:
			return null;
	}
}

// ---------------------------------------------------------------------------------------------- texto (medidas)
export const TEXTO = { interlinea: 1.25, base: 0.95 };

/** Medidor de ancho de texto (en px, para un tamaño y una cursiva). En el navegador se reemplaza por el del canvas. */
const medidor = { f: (s, tam) => s.length * tam * 0.5 };
export const ponerMedidor = (f) => (medidor.f = f);

export const anchoLinea = (linea, tam, cursiva) => trozos(linea, cursiva).reduce((a, t) => a + medidor.f(t.s, tam, t.it), 0);

/** Una línea de texto partida en tramos de una misma tipografía, cada uno con su posición x (desde el borde izquierdo). */
export function tramos(linea, tam, cursiva) {
	let x = 0;
	return trozos(linea, cursiva).map((t) => {
		const r = { s: t.s, it: t.it, x };
		x += medidor.f(t.s, tam, t.it);
		return r;
	});
}

const cacheTexto = new WeakMap();
/** Tamaño de la caja de un texto. */
export function dimTexto(o) {
	let d = cacheTexto.get(o);
	if (!d) {
		const lineas = String(o.s ?? '').split('\n');
		d = { ancho: Math.max(2, ...lineas.map((l) => anchoLinea(l, o.tam, o.cur))), alto: lineas.length * o.tam * TEXTO.interlinea, lineas };
		cacheTexto.set(o, d);
	}
	return d;
}

// ---------------------------------------------------------------------------------------------- caminos
const formatear = (v) => num(v);

/** Camino suave que pasa cerca de los puntos (curvas cuadráticas entre puntos medios). `p` es [x0,y0,x1,y1,…]. */
export function dTrazo(p) {
	const n = p.length / 2;
	if (n < 2) return '';
	let d = `M${formatear(p[0])} ${formatear(p[1])}`;
	if (n === 2) return `${d}L${formatear(p[2])} ${formatear(p[3])}`;
	for (let i = 1; i < n - 1; i++) {
		const x = p[2 * i];
		const y = p[2 * i + 1];
		d += `Q${formatear(x)} ${formatear(y)} ${formatear((x + p[2 * i + 2]) / 2)} ${formatear((y + p[2 * i + 3]) / 2)}`;
	}
	return `${d}L${formatear(p[2 * n - 2])} ${formatear(p[2 * n - 1])}`;
}

const dCirculo = (cx, cy, r) => `M${formatear(cx - r)} ${formatear(cy)}a${formatear(r)} ${formatear(r)} 0 1 0 ${formatear(2 * r)} 0a${formatear(r)} ${formatear(r)} 0 1 0 ${formatear(-2 * r)} 0Z`;
const dElipse = (cx, cy, rx, ry) => `M${formatear(cx - rx)} ${formatear(cy)}a${formatear(rx)} ${formatear(ry)} 0 1 0 ${formatear(2 * rx)} 0a${formatear(rx)} ${formatear(ry)} 0 1 0 ${formatear(-2 * rx)} 0Z`;
const dRect = (x, y, a, h) => `M${formatear(x)} ${formatear(y)}h${formatear(a)}v${formatear(h)}h${formatear(-a)}Z`;
const dPoli = (p, cerrado) => {
	let d = '';
	for (let i = 0; i < p.length; i += 2) d += `${i ? 'L' : 'M'}${formatear(p[i])} ${formatear(p[i + 1])}`;
	return cerrado ? `${d}Z` : d;
};

/** Largo de las puntas de flecha según el grosor. */
export const largoPunta = (g) => Math.max(10, g * 4 + 6);
/** Punta de flecha abierta (dos rayitas) con la punta en (x, y) apuntando hacia `ang`. */
function dPunta(x, y, ang, g) {
	const L = largoPunta(g);
	const a1 = ang + Math.PI - 0.5;
	const a2 = ang + Math.PI + 0.5;
	return `M${formatear(x + L * Math.cos(a1))} ${formatear(y + L * Math.sin(a1))}L${formatear(x)} ${formatear(y)}L${formatear(x + L * Math.cos(a2))} ${formatear(y + L * Math.sin(a2))}`;
}

export const PASO_MARCAS = 32;

/** Segmentos de los ejes: [[x1,y1,x2,y2], …] (los dos ejes). */
function segmentosEjes(o) {
	if (o.modo === 'cruz') {
		const cx = o.x + o.ancho / 2;
		const cy = o.y + o.alto / 2;
		return { h: [o.x, cy, o.x + o.ancho, cy], v: [cx, o.y + o.alto, cx, o.y], ox: cx, oy: cy };
	}
	return { h: [o.x, o.y + o.alto, o.x + o.ancho, o.y + o.alto], v: [o.x, o.y + o.alto, o.x, o.y], ox: o.x, oy: o.y + o.alto };
}

function dEjes(o) {
	const s = segmentosEjes(o);
	let d = `M${formatear(s.h[0])} ${formatear(s.h[1])}L${formatear(s.h[2])} ${formatear(s.h[3])}M${formatear(s.v[0])} ${formatear(s.v[1])}L${formatear(s.v[2])} ${formatear(s.v[3])}`;
	d += dPunta(s.h[2], s.h[3], 0, o.g) + dPunta(s.v[2], s.v[3], -Math.PI / 2, o.g);
	if (o.modo === 'cruz') d += dPunta(s.h[0], s.h[1], Math.PI, o.g) + dPunta(s.v[0], s.v[1], Math.PI / 2, o.g);
	if (o.marcas) {
		const paso = o.paso || PASO_MARCAS;
		const m = 4 + o.g;
		const tope = largoPunta(o.g);
		for (let x = s.ox + paso; x < s.h[2] - tope; x += paso) d += `M${formatear(x)} ${formatear(s.oy - m)}v${formatear(2 * m)}`;
		for (let y = s.oy - paso; y > s.v[3] + tope; y -= paso) d += `M${formatear(s.ox - m)} ${formatear(y)}h${formatear(2 * m)}`;
		if (o.modo === 'cruz') {
			for (let x = s.ox - paso; x > s.h[0] + tope; x -= paso) d += `M${formatear(x)} ${formatear(s.oy - m)}v${formatear(2 * m)}`;
			for (let y = s.oy + paso; y < s.v[1] - tope; y += paso) d += `M${formatear(s.ox - m)} ${formatear(y)}h${formatear(2 * m)}`;
		}
	}
	return d;
}

/** Ángulo de la rayita de una línea en su extremo (para las flechas). */
const anguloLinea = (o) => Math.atan2(o.y2 - o.y1, o.x2 - o.x1);

/**
 * Trazos del objeto como [{ d, modo }]. modo: 'trazo' (solo contorno), 'relleno' (solo relleno con el color del objeto,
 * para los puntitos) o 'ambos' (relleno `r` más contorno).
 */
export function partesDe(o) {
	switch (o.t) {
		case 'trazo': {
			if (o.p.length >= 4) return [{ d: dTrazo(o.p), modo: 'trazo' }];
			if (o.p.length >= 2) return [{ d: dCirculo(o.p[0], o.p[1], Math.max(0.5, o.g / 2)), modo: 'relleno' }];
			return [];
		}
		case 'linea': {
			const partes = [{ d: `M${formatear(o.x1)} ${formatear(o.y1)}L${formatear(o.x2)} ${formatear(o.y2)}`, modo: 'trazo' }];
			const a = anguloLinea(o);
			let p = '';
			if (o.ff) p += dPunta(o.x2, o.y2, a, o.g);
			if (o.fi) p += dPunta(o.x1, o.y1, a + Math.PI, o.g);
			if (p) partes.push({ d: p, modo: 'trazo', solida: true });
			return partes;
		}
		case 'rect':
			return [{ d: dRect(o.x, o.y, o.ancho, o.alto), modo: o.r ? 'ambos' : 'trazo' }];
		case 'elipse':
			return [{ d: dElipse(o.cx, o.cy, o.rx, o.ry), modo: o.r ? 'ambos' : 'trazo' }];
		case 'poli':
			return [{ d: dPoli(o.p, o.cerrado), modo: o.cerrado && o.r ? 'ambos' : 'trazo' }];
		case 'ejes': {
			const s = segmentosEjes(o);
			const ejes = `M${formatear(s.h[0])} ${formatear(s.h[1])}L${formatear(s.h[2])} ${formatear(s.h[3])}M${formatear(s.v[0])} ${formatear(s.v[1])}L${formatear(s.v[2])} ${formatear(s.v[3])}`;
			const resto = dEjes(o).slice(ejes.length);
			return [
				{ d: ejes, modo: 'trazo' },
				{ d: resto, modo: 'trazo', solida: true },
			];
		}
		default:
			return [];
	}
}

/** Textos que dibuja el objeto: [{ lineas, x, y, tam, cur, c, ancla }] (y = arriba de la primera línea). */
export function textosDe(o) {
	if (o.t === 'texto') return [{ lineas: dimTexto(o).lineas, x: o.x, y: o.y, tam: o.tam, cur: !!o.cur, c: o.c, ancla: 'start' }];
	if (o.t === 'ejes' && o.etq) {
		const s = segmentosEjes(o);
		const tam = 18;
		return [
			{ lineas: ['x'], x: s.h[2] + 4, y: s.h[3] - tam * 0.6, tam, cur: true, c: o.c, ancla: 'start' },
			{ lineas: ['y'], x: s.v[2] + 8, y: s.v[3] - tam * 0.2, tam, cur: true, c: o.c, ancla: 'start' },
		];
	}
	return [];
}

// ---------------------------------------------------------------------------------------------- contornos
/** Aproximación poligonal de una elipse. */
function poligonoElipse(cx, cy, rx, ry, n = 72) {
	const p = [];
	for (let i = 0; i < n; i++) {
		const a = (i / n) * Math.PI * 2;
		p.push(cx + rx * Math.cos(a), cy + ry * Math.sin(a));
	}
	return p;
}

/** Esquinas de una imagen (con su giro): [x,y, …] arriba-izquierda, arriba-derecha, abajo-derecha, abajo-izquierda. */
export function esquinasImagen(o) {
	const hw = o.ancho / 2;
	const hh = o.alto / 2;
	const c = Math.cos(o.rot || 0);
	const s = Math.sin(o.rot || 0);
	const p = [];
	for (const [x, y] of [
		[-hw, -hh],
		[hw, -hh],
		[hw, hh],
		[-hw, hh],
	])
		p.push(o.cx + x * c - y * s, o.cy + x * s + y * c);
	return p;
}

const cacheContornos = new WeakMap();
/** Líneas que forman el objeto, para tocarlo, seleccionarlo y borrarlo: [{ p: [x,y,…], cerrado }]. */
export function contornos(o) {
	let c = cacheContornos.get(o);
	if (c) return c;
	switch (o.t) {
		case 'trazo':
			c = [{ p: o.p.length === 2 ? [o.p[0], o.p[1], o.p[0], o.p[1]] : o.p, cerrado: false }];
			break;
		case 'linea':
			c = [{ p: [o.x1, o.y1, o.x2, o.y2], cerrado: false }];
			break;
		case 'rect':
			c = [{ p: [o.x, o.y, o.x + o.ancho, o.y, o.x + o.ancho, o.y + o.alto, o.x, o.y + o.alto], cerrado: true }];
			break;
		case 'elipse':
			c = [{ p: poligonoElipse(o.cx, o.cy, o.rx, o.ry), cerrado: true }];
			break;
		case 'poli':
			c = [{ p: o.p, cerrado: !!o.cerrado }];
			break;
		case 'ejes': {
			const s = segmentosEjes(o);
			c = [
				{ p: s.h, cerrado: false },
				{ p: s.v, cerrado: false },
			];
			break;
		}
		case 'texto': {
			const d = dimTexto(o);
			c = [{ p: [o.x, o.y, o.x + d.ancho, o.y, o.x + d.ancho, o.y + d.alto, o.x, o.y + d.alto], cerrado: true }];
			break;
		}
		case 'imagen':
			c = [{ p: esquinasImagen(o), cerrado: true }];
			break;
		default:
			c = [];
	}
	cacheContornos.set(o, c);
	return c;
}

const cacheCajas = new WeakMap();
/** Caja que encierra al objeto (sin contar el grosor): { x0, y0, x1, y1 }. */
export function cajaDe(o) {
	let b = cacheCajas.get(o);
	if (b) return b;
	b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
	for (const c of contornos(o)) {
		for (let i = 0; i < c.p.length; i += 2) {
			if (c.p[i] < b.x0) b.x0 = c.p[i];
			if (c.p[i] > b.x1) b.x1 = c.p[i];
			if (c.p[i + 1] < b.y0) b.y0 = c.p[i + 1];
			if (c.p[i + 1] > b.y1) b.y1 = c.p[i + 1];
		}
	}
	if (o.t === 'ejes') {
		const L = largoPunta(o.g);
		b = { x0: b.x0 - L, y0: b.y0 - L, x1: b.x1 + L + (o.etq ? 18 : 0), y1: b.y1 + L };
	}
	if (!isFinite(b.x0)) b = { x0: 0, y0: 0, x1: 0, y1: 0 };
	cacheCajas.set(o, b);
	return b;
}

/** Caja que encierra a varios objetos (o null si no hay). */
export function cajaDeTodos(lista) {
	let r = null;
	for (const o of lista) {
		const b = cajaDe(o);
		r = r ? { x0: Math.min(r.x0, b.x0), y0: Math.min(r.y0, b.y0), x1: Math.max(r.x1, b.x1), y1: Math.max(r.y1, b.y1) } : { ...b };
	}
	return r;
}

export const cajasSeCruzan = (a, b) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;

// ---------------------------------------------------------------------------------------------- distancias
/** Distancia de un punto a un segmento. */
export function distSegmento(px, py, x1, y1, x2, y2) {
	const dx = x2 - x1;
	const dy = y2 - y1;
	const l2 = dx * dx + dy * dy;
	let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
	t = t < 0 ? 0 : t > 1 ? 1 : t;
	return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** ¿El punto está dentro del polígono `p` ([x,y,…])? (regla par-impar) */
export function dentroPoligono(x, y, p) {
	let dentro = false;
	for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
		const xi = p[i];
		const yi = p[i + 1];
		const xj = p[j];
		const yj = p[j + 1];
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
	}
	return dentro;
}

/** Distancia del punto a la tinta del objeto (0 si está sobre ella o dentro de un relleno o de un texto). */
export function distancia(o, x, y) {
	const b = cajaDe(o);
	const m = (o.g || 0) / 2;
	// Descarte rápido: si está lejos de la caja no hace falta mirar los segmentos.
	const lejos = Math.max(b.x0 - x, x - b.x1, b.y0 - y, y - b.y1, 0);
	if (lejos > 400) return lejos;
	let mejor = Infinity;
	for (const c of contornos(o)) {
		const p = c.p;
		const n = p.length / 2;
		for (let i = 0; i < n - 1; i++) mejor = Math.min(mejor, distSegmento(x, y, p[2 * i], p[2 * i + 1], p[2 * i + 2], p[2 * i + 3]));
		if (c.cerrado && n > 2) mejor = Math.min(mejor, distSegmento(x, y, p[2 * n - 2], p[2 * n - 1], p[0], p[1]));
		if (n === 1) mejor = Math.min(mejor, Math.hypot(x - p[0], y - p[1]));
		if (c.cerrado && n > 2 && (o.t === 'texto' || o.t === 'imagen' || o.r) && dentroPoligono(x, y, p)) return 0;
	}
	return Math.max(0, mejor - m);
}

/** Puntos repartidos a lo largo del objeto (cada `paso` px como mucho): sirven para el lazo y la selección por recuadro. */
export function muestras(o, paso = 14) {
	const out = [];
	for (const c of contornos(o)) {
		const p = c.p;
		const n = p.length / 2;
		const tramo = (x1, y1, x2, y2) => {
			const k = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / paso));
			for (let j = 0; j < k; j++) out.push(x1 + ((x2 - x1) * j) / k, y1 + ((y2 - y1) * j) / k);
		};
		for (let i = 0; i < n - 1; i++) tramo(p[2 * i], p[2 * i + 1], p[2 * i + 2], p[2 * i + 3]);
		if (c.cerrado && n > 2) tramo(p[2 * n - 2], p[2 * n - 1], p[0], p[1]);
		out.push(p[2 * n - 2], p[2 * n - 1]);
	}
	if (o.t === 'texto' || o.t === 'imagen' || (o.r && contornos(o)[0]?.cerrado)) {
		const b = cajaDe(o);
		out.push((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
	}
	return out;
}

/** ¿Cuánto del objeto cae dentro del polígono `poli` ([x,y,…])? Va de 0 a 1. */
export function fraccionDentro(o, poli) {
	const m = muestras(o);
	let dentro = 0;
	for (let i = 0; i < m.length; i += 2) if (dentroPoligono(m[i], m[i + 1], poli)) dentro++;
	return m.length ? dentro / (m.length / 2) : 0;
}

// ---------------------------------------------------------------------------------------------- transformaciones
const mapa = (p, f) => {
	const r = new Array(p.length);
	for (let i = 0; i < p.length; i += 2) {
		const [x, y] = f(p[i], p[i + 1]);
		r[i] = x;
		r[i + 1] = y;
	}
	return r;
};

export function mover(o, dx, dy) {
	switch (o.t) {
		case 'trazo':
		case 'poli':
			return { ...o, p: mapa(o.p, (x, y) => [x + dx, y + dy]) };
		case 'linea':
			return { ...o, x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy };
		case 'rect':
		case 'ejes':
		case 'texto':
			return { ...o, x: o.x + dx, y: o.y + dy };
		case 'elipse':
		case 'imagen':
			return { ...o, cx: o.cx + dx, cy: o.cy + dy };
		default:
			return o;
	}
}

/** Escala el objeto respecto del punto (ox, oy). El grosor de la línea no cambia. */
export function escalar(o, sx, sy, ox, oy) {
	const X = (x) => ox + (x - ox) * sx;
	const Y = (y) => oy + (y - oy) * sy;
	switch (o.t) {
		case 'trazo':
		case 'poli':
			return { ...o, p: mapa(o.p, (x, y) => [X(x), Y(y)]) };
		case 'linea':
			return { ...o, x1: X(o.x1), y1: Y(o.y1), x2: X(o.x2), y2: Y(o.y2) };
		case 'rect':
		case 'ejes': {
			const x1 = X(o.x);
			const x2 = X(o.x + o.ancho);
			const y1 = Y(o.y);
			const y2 = Y(o.y + o.alto);
			return { ...o, x: Math.min(x1, x2), y: Math.min(y1, y2), ancho: Math.abs(x2 - x1), alto: Math.abs(y2 - y1) };
		}
		case 'elipse':
			return { ...o, cx: X(o.cx), cy: Y(o.cy), rx: Math.abs(o.rx * sx), ry: Math.abs(o.ry * sy) };
		case 'imagen': {
			// con giros de 0° o 180° las medidas se escalan cada una por su eje, con 90° o 270° al revés y con otro giro, parejo
			const q = (((o.rot || 0) % Math.PI) + Math.PI) % Math.PI;
			const cerca = (a) => Math.abs(q - a) < 0.02 || Math.abs(q - a - Math.PI) < 0.02;
			let kx = (Math.abs(sx) + Math.abs(sy)) / 2;
			let ky = kx;
			if (cerca(0)) {
				kx = Math.abs(sx);
				ky = Math.abs(sy);
			} else if (cerca(Math.PI / 2)) {
				kx = Math.abs(sy);
				ky = Math.abs(sx);
			}
			return { ...o, cx: X(o.cx), cy: Y(o.cy), ancho: Math.max(4, o.ancho * kx), alto: Math.max(4, o.alto * ky), fx: sx < 0 && cerca(0) ? (o.fx ? 0 : 1) : o.fx, fy: sy < 0 && cerca(0) ? (o.fy ? 0 : 1) : o.fy };
		}
		case 'texto':
			return { ...o, x: X(o.x), y: Y(o.y), tam: Math.max(6, Math.min(400, o.tam * ((Math.abs(sx) + Math.abs(sy)) / 2))) };
		default:
			return o;
	}
}

// ---------------------------------------------------------------------------------------------- trazos a mano
/** Borra de un trazo lo que cae dentro del círculo (cx, cy, r): devuelve los pedazos que quedan, como arreglos [x,y,…]. */
export function recortar(p, cx, cy, r) {
	const piezas = [];
	let actual = [];
	const cierra = () => {
		if (actual.length >= 4) piezas.push(actual);
		actual = [];
	};
	const n = p.length / 2;
	const dentro = (x, y) => (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r;
	if (n === 1) return dentro(p[0], p[1]) ? [] : [p];
	for (let i = 0; i < n - 1; i++) {
		const x1 = p[2 * i];
		const y1 = p[2 * i + 1];
		const x2 = p[2 * i + 2];
		const y2 = p[2 * i + 3];
		// t donde el segmento entra y sale del círculo: |P1 + t·D − C|² = r²
		const dx = x2 - x1;
		const dy = y2 - y1;
		const fx = x1 - cx;
		const fy = y1 - cy;
		const A = dx * dx + dy * dy;
		const B = 2 * (fx * dx + fy * dy);
		const C = fx * fx + fy * fy - r * r;
		let t0 = 1;
		let t1 = 0; // intervalo (t0, t1) dentro del círculo; vacío si t0 > t1
		if (A > 0) {
			const disc = B * B - 4 * A * C;
			if (disc > 0) {
				const s = Math.sqrt(disc);
				t0 = Math.max(0, (-B - s) / (2 * A));
				t1 = Math.min(1, (-B + s) / (2 * A));
			}
		} else if (C <= 0) {
			t0 = 0;
			t1 = 1;
		}
		const toca = t0 < t1;
		if (!toca) {
			if (!actual.length) actual.push(x1, y1);
			actual.push(x2, y2);
			continue;
		}
		if (t0 > 0) {
			if (!actual.length) actual.push(x1, y1);
			actual.push(x1 + dx * t0, y1 + dy * t0);
		}
		cierra();
		if (t1 < 1) actual.push(x1 + dx * t1, y1 + dy * t1, x2, y2);
	}
	cierra();
	return piezas;
}

/** Qué puntos de la línea hay que conservar al simplificarla (Douglas–Peucker): sus posiciones en la lista. */
export function simplificarIdx(p, eps) {
	const n = p.length / 2;
	if (n < 3) return Array.from({ length: n }, (_, i) => i);
	const mantener = new Uint8Array(n);
	mantener[0] = mantener[n - 1] = 1;
	const pila = [[0, n - 1]];
	while (pila.length) {
		const [a, b] = pila.pop();
		let max = 0;
		let idx = -1;
		for (let i = a + 1; i < b; i++) {
			const d = distSegmento(p[2 * i], p[2 * i + 1], p[2 * a], p[2 * a + 1], p[2 * b], p[2 * b + 1]);
			if (d > max) {
				max = d;
				idx = i;
			}
		}
		if (idx >= 0 && max > eps) {
			mantener[idx] = 1;
			pila.push([a, idx], [idx, b]);
		}
	}
	const r = [];
	for (let i = 0; i < n; i++) if (mantener[i]) r.push(i);
	return r;
}

/** Simplifica una línea quitando los puntos que sobran. `p` es plano; `eps` en las mismas unidades. */
export function simplificar(p, eps) {
	const r = [];
	for (const i of simplificarIdx(p, eps)) r.push(p[2 * i], p[2 * i + 1]);
	return r;
}

// ---------------------------------------------------------------------------------------------- fabricas de objetos
export const base = (t, extra) => ({ id: nuevoId(), t, c: '#111111', g: 3, e: 'continua', op: 1, ...extra });
