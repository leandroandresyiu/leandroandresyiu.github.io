// Lo que se ve: la hoja con su fondo y sus objetos en un canvas, y encima otro canvas "vivo" para lo que cambia seguido
// (el trazo que se está haciendo, la selección, el cursor del borrador). También el zoom y el desplazamiento.
import { cajaDe, partesDe, patron, ponerMedidor, TEXTO, textosDe, tramos } from './geometria.js';
import { fondoDe } from './fondo.js';
import { E, emitir, pagina } from './estado.js';

const FUENTE = 'LM Roman 10';
const MESA = '#1b1c20';
const MARGEN = 40;
export const ZOOM_MIN = 0.2;
export const ZOOM_MAX = 8;

// ---------------------------------------------------------------------------------------------- dibujo de objetos
const cachePartes = new WeakMap();
const cacheFondo = new Map();

/** Los trazos de un objeto como Path2D (se arman una sola vez por objeto; los objetos no cambian, se reemplazan). */
function partes(o) {
	let c = cachePartes.get(o);
	if (!c) {
		c = partesDe(o).map((p) => ({ ...p, path: new Path2D(p.d) }));
		cachePartes.set(o, c);
	}
	return c;
}
const path = (d) => {
	let p = cacheFondo.get(d);
	if (!p) {
		p = new Path2D(d);
		if (cacheFondo.size > 400) cacheFondo.clear();
		cacheFondo.set(d, p);
	}
	return p;
};

function dibujarTexto(ctx, t) {
	ctx.fillStyle = t.c;
	ctx.textBaseline = 'alphabetic';
	t.lineas.forEach((linea, i) => {
		const y = t.y + t.tam * TEXTO.base + i * t.tam * TEXTO.interlinea;
		for (const tr of tramos(linea, t.tam, t.cur)) {
			ctx.font = `${tr.it ? 'italic ' : ''}${t.tam}px "${FUENTE}"`;
			ctx.fillText(tr.s, t.x + tr.x, y);
		}
	});
}

// ---- imágenes: se decodifican una sola vez por recurso y, hasta que estén listas, se dibuja un marcador gris
const imagenes = new Map(); // id del recurso → { img, listo }
function imagenDe(id) {
	let r = imagenes.get(id);
	if (!r) {
		const rec = E.doc.recursos?.[id];
		if (!rec) return null;
		const img = new Image();
		r = { img, listo: false };
		img.onload = () => {
			r.listo = true;
			emitir('imagenes');
			pedir();
		};
		img.onerror = () => (r.falla = true);
		img.src = `data:${rec.mime};base64,${rec.datos}`;
		imagenes.set(id, r);
	}
	return r;
}

function dibujarImagen(ctx, o) {
	const r = imagenDe(o.img);
	ctx.save();
	ctx.globalAlpha = o.op ?? 1;
	ctx.translate(o.cx, o.cy);
	ctx.rotate(o.rot || 0);
	ctx.scale(o.fx ? -1 : 1, o.fy ? -1 : 1);
	if (r?.listo) {
		ctx.imageSmoothingQuality = 'high';
		ctx.drawImage(r.img, -o.ancho / 2, -o.alto / 2, o.ancho, o.alto);
	} else {
		ctx.fillStyle = 'rgba(128,128,128,0.22)';
		ctx.fillRect(-o.ancho / 2, -o.alto / 2, o.ancho, o.alto);
	}
	ctx.restore();
}

/** Dibuja un objeto (con el sistema de coordenadas de la hoja ya puesto en `ctx`). */
export function dibujarObjeto(ctx, o) {
	if (o.t === 'imagen') return dibujarImagen(ctx, o);
	ctx.globalAlpha = o.op ?? 1;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	for (const p of partes(o)) {
		if (p.modo === 'relleno') {
			ctx.fillStyle = o.c;
			ctx.fill(p.path);
			continue;
		}
		if (p.modo === 'ambos' && o.r) {
			ctx.fillStyle = o.r;
			ctx.fill(p.path);
		}
		ctx.strokeStyle = o.c;
		ctx.lineWidth = o.g;
		ctx.setLineDash(p.solida ? [] : (patron(o.e, o.g) ?? []));
		ctx.stroke(p.path);
	}
	ctx.setLineDash([]);
	for (const t of textosDe(o)) dibujarTexto(ctx, { ...t, c: o.c });
	ctx.globalAlpha = 1;
}

/**
 * Dibuja la hoja entera: color, fondo y objetos. Opciones:
 *  - previa: Map id → objeto, para mostrar objetos que se están arrastrando
 *  - ocultos: Set de ids que no se dibujan
 *  - region: { x0, y0, x1, y1 } en coordenadas de la hoja; lo que queda afuera no se dibuja
 */
export function dibujarPagina(ctx, pg, { previa = null, ocultos = null, region = null, fondo = true } = {}) {
	ctx.save();
	ctx.beginPath();
	ctx.rect(0, 0, pg.ancho, pg.alto);
	ctx.clip();
	if (fondo) {
		ctx.fillStyle = pg.color;
		ctx.fillRect(0, 0, pg.ancho, pg.alto);
		const f = fondoDe(pg);
		if (f.lineas) {
			ctx.strokeStyle = f.lineas.color;
			ctx.lineWidth = f.lineas.g;
			ctx.stroke(path(f.lineas.d));
		}
		if (f.puntos) {
			ctx.strokeStyle = f.puntos.color;
			ctx.lineWidth = f.puntos.g;
			ctx.lineCap = 'round';
			ctx.stroke(path(f.puntos.d));
		}
	}
	for (const base of pg.objetos) {
		if (ocultos?.has(base.id)) continue;
		const o = previa?.get(base.id) ?? base;
		if (region) {
			const b = cajaDe(o);
			const m = (o.g || 0) / 2 + 2;
			if (b.x1 + m < region.x0 || b.x0 - m > region.x1 || b.y1 + m < region.y0 || b.y0 - m > region.y1) continue;
		}
		dibujarObjeto(ctx, o);
	}
	ctx.restore();
}

// ---------------------------------------------------------------------------------------------- lienzo
let host;
let cvB;
let cvV;
let cb;
let cv;
let W = 1;
let H = 1;
let dpr = 1;
let pendiente = false;
let iniciada = false;
let ajusteAuto = true; // mientras nadie haya hecho zoom ni movido la hoja, al cambiar el tamaño de la ventana se vuelve a ajustar
let modoAjuste = 'pagina';
const pintoresVivos = [];

export const tamano = () => ({ W, H });
/** Registra una función que dibuja sobre el lienzo vivo: f(ctx, { z, px }) con ctx en coordenadas de la hoja. */
export const pintorVivo = (f) => pintoresVivos.push(f);

let sucioBase = true;
/** Pide repintar todo (la hoja y lo de encima) en el próximo cuadro. */
export function pedir() {
	sucioBase = true;
	pedirVivo();
}
/** Pide repintar solo lo de encima (el trazo en curso, la selección, el cursor): es mucho más barato que la hoja entera. */
export function pedirVivo() {
	if (pendiente) return;
	pendiente = true;
	requestAnimationFrame(() => {
		pendiente = false;
		pintar();
	});
}

function pintar() {
	if (sucioBase) {
		sucioBase = false;
		pintarBase();
	}
	pintarEncima();
}

function pintarBase() {
	const { z, x, y } = E.vista;
	const pg = pagina();
	cb.setTransform(1, 0, 0, 1, 0, 0);
	cb.fillStyle = MESA;
	cb.fillRect(0, 0, cvB.width, cvB.height);
	cb.setTransform(dpr * z, 0, 0, dpr * z, dpr * x, dpr * y);
	// sombra de la hoja
	cb.save();
	cb.shadowColor = 'rgba(0,0,0,0.5)';
	cb.shadowBlur = 24 * dpr;
	cb.shadowOffsetY = 5 * dpr;
	cb.fillStyle = pg.color;
	cb.fillRect(0, 0, pg.ancho, pg.alto);
	cb.restore();
	dibujarPagina(cb, pg, { previa: E.previa, ocultos: E.ocultos, region: { x0: -x / z, y0: -y / z, x1: (W - x) / z, y1: (H - y) / z } });
}

function pintarEncima() {
	const { z, x, y } = E.vista;
	cv.setTransform(1, 0, 0, 1, 0, 0);
	cv.clearRect(0, 0, cvV.width, cvV.height);
	cv.setTransform(dpr * z, 0, 0, dpr * z, dpr * x, dpr * y);
	for (const f of pintoresVivos) {
		cv.save();
		f(cv, { z, px: (n) => n / z, W, H, dpr });
		cv.restore();
	}
}

export function iniciarVista(contenedor, canvasBase, canvasVivo) {
	host = contenedor;
	cvB = canvasBase;
	cvV = canvasVivo;
	cb = cvB.getContext('2d', { alpha: false });
	cv = cvV.getContext('2d');
	// Medidor de texto: el mismo canvas que dibuja, para que lo medido coincida con lo dibujado.
	const m = document.createElement('canvas').getContext('2d');
	ponerMedidor((s, tam, it) => {
		m.font = `${it ? 'italic ' : ''}${tam}px "${FUENTE}"`;
		return m.measureText(s).width;
	});
	const medir = () => {
		const r = host.getBoundingClientRect();
		const w = Math.max(1, Math.round(r.width));
		const h = Math.max(1, Math.round(r.height));
		const d = Math.min(window.devicePixelRatio || 1, 2.5);
		if (iniciada && w === W && h === H && d === dpr) return;
		const primera = !iniciada;
		iniciada = true;
		// Se conserva el centro de lo que se ve al cambiar de tamaño (girar la tablet, partir la pantalla).
		const centro = primera ? null : { x: (W / 2 - E.vista.x) / E.vista.z, y: (H / 2 - E.vista.y) / E.vista.z };
		W = w;
		H = h;
		dpr = d;
		for (const c of [cvB, cvV]) {
			c.width = Math.round(W * dpr);
			c.height = Math.round(H * dpr);
			c.style.width = `${W}px`;
			c.style.height = `${H}px`;
		}
		if (primera || ajusteAuto) ajustar(modoAjuste);
		else if (centro) {
			E.vista.x = W / 2 - centro.x * E.vista.z;
			E.vista.y = H / 2 - centro.y * E.vista.z;
			limitar();
		}
		emitir('vista');
		pedir();
	};
	new ResizeObserver(medir).observe(host);
	medir();
}

// ---------------------------------------------------------------------------------------------- zoom y desplazamiento
export const aPagina = (sx, sy) => ({ x: (sx - E.vista.x) / E.vista.z, y: (sy - E.vista.y) / E.vista.z });
export const aPantalla = (x, y) => ({ x: x * E.vista.z + E.vista.x, y: y * E.vista.z + E.vista.y });

/** Mantiene la hoja a la vista: centrada si entra, y sin poder irse muy lejos si no. */
export function limitar() {
	const pg = pagina();
	const v = E.vista;
	const pw = pg.ancho * v.z;
	const ph = pg.alto * v.z;
	v.x = pw <= W - MARGEN ? (W - pw) / 2 : Math.min(MARGEN, Math.max(W - pw - MARGEN, v.x));
	v.y = ph <= H - MARGEN ? (H - ph) / 2 : Math.min(MARGEN, Math.max(H - ph - MARGEN, v.y));
}

export function ajustar(modo = 'pagina') {
	ajusteAuto = true;
	modoAjuste = modo;
	const pg = pagina();
	const m = W < 600 ? 10 : 24;
	const zAncho = (W - 2 * m) / pg.ancho;
	const zPag = Math.min(zAncho, (H - 2 * m) / pg.alto);
	E.vista.z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, modo === 'ancho' ? zAncho : zPag));
	E.vista.x = 0;
	E.vista.y = modo === 'ancho' ? m : 0;
	limitar();
	if (modo === 'ancho') E.vista.y = m;
	emitir('vista');
	pedir();
}

export function zoomEn(nz, sx = W / 2, sy = H / 2) {
	ajusteAuto = false;
	const v = E.vista;
	const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, nz));
	const px = (sx - v.x) / v.z;
	const py = (sy - v.y) / v.z;
	v.z = z;
	v.x = sx - px * z;
	v.y = sy - py * z;
	limitar();
	emitir('vista');
	pedir();
}

export function desplazar(dx, dy) {
	ajusteAuto = false;
	E.vista.x += dx;
	E.vista.y += dy;
	limitar();
	emitir('vista');
	pedir();
}

// ---------------------------------------------------------------------------------------------- miniaturas
export function miniatura(pg, ancho = 112) {
	const k = ancho / pg.ancho;
	const c = document.createElement('canvas');
	const d = Math.min(window.devicePixelRatio || 1, 2);
	c.width = Math.round(ancho * d);
	c.height = Math.round(pg.alto * k * d);
	c.style.width = `${ancho}px`;
	c.style.height = `${Math.round(pg.alto * k)}px`;
	const x = c.getContext('2d');
	x.setTransform(k * d, 0, 0, k * d, 0, 0);
	dibujarPagina(x, pg);
	return c;
}
