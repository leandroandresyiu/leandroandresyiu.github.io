// Lápiz, dedo y mouse sobre la hoja: trazos, borrador, selección, formas, texto, zoom y desplazamiento.
// Todo entra por Pointer Events. La presión del lápiz NO se usa: el grosor lo elige la persona, así que el trazo es parejo.
//
// Botones del lápiz (Pointer Events): la punta de atrás / borrador de la TCL llega como `buttons & 32` (o `button === 5`);
// los botones laterales de un Wacom llegan como `buttons & 2` y `buttons & 4`. Qué hace cada uno se elige en Ajustes.
import { base, cajaDe, cajaDeTodos, dTrazo, distancia, esquinasImagen, escalar, fraccionDentro, mover, nuevoId, recortar, simplificar } from './geometria.js';
import { objetoDeForma, reconocer } from './formas.js';
import { conIdNuevo } from './modelo.js';
import { imagenDe, insertarImagen } from './imagenes.js';
import { E, cambiar, deshacer, emitir, en, guardarAjustes, objetosSel, pagina, ponerObjetos, rehacer, reemplazar, seleccionar, usarHerramienta } from './estado.js';
import { aPagina, aPantalla, desplazar, dibujarObjeto, pedir, pedirVivo, pintorVivo, zoomEn } from './vista.js';

const ACENTO = '#ff4d1f';
let cv; // lienzo vivo: recibe los eventos
const punteros = new Map(); // pointerId → { x, y, tipo } (en px del lienzo)
let gesto = null;
let ultimoPen = 0;
let espacio = false;
let cursor = null; // dónde está el lápiz o el mouse (en px del lienzo), para el círculo del borrador

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const ahora = () => performance.now();
const redondear2 = (p) => p.map((v) => Math.round(v * 100) / 100);

function posEn(e) {
	const r = cv.getBoundingClientRect();
	return { x: e.clientX - r.left, y: e.clientY - r.top };
}

// ---------------------------------------------------------------------------------------------- qué hace cada botón
const TRADUCCION = { borrar: 'borrador', lazo: 'lazo', seleccionar: 'seleccion', mano: 'mano', nada: null };

/**
 * Las "firmas" identifican un botón sin importar cómo lo mande el navegador: "pen:m2" (el bit 2 de `buttons` de un lápiz),
 * "pen:b1" (`button` = 1), "mouse:b1" (rueda apretada), "tecla:Alt"… Así se puede asignar cualquier botón, incluso uno que el
 * driver de la tableta mande como clic del medio o como la tecla Alt (el botón "Detectar botón" de Ajustes las aprende).
 */
export function firmasDe(e) {
	const t = e.pointerType;
	const f = [];
	for (const bit of [2, 4, 8, 16, 32]) if (e.buttons & bit) f.push(`${t}:m${bit}`);
	if (e.button > 0) f.push(`${t}:b${e.button}`);
	if (e.altKey) f.push('tecla:Alt');
	return f;
}

/** Botones que ya conoce, con las firmas que los identifican y la clave del ajuste que dice qué hacen. */
export const BOTONES_BASE = [
	{ clave: 'cola', nombre: 'Punta de atrás del lápiz (borrador)', ayuda: 'también el borrador de la TCL', firmas: ['pen:m32', 'pen:b5'] },
	{ clave: 'boton1', nombre: 'Botón lateral 1 del lápiz', ayuda: '', firmas: ['pen:m2', 'pen:b2'] },
	{ clave: 'boton2', nombre: 'Botón lateral 2 del lápiz', ayuda: '', firmas: ['pen:m4', 'pen:b1'] },
	{ clave: 'mouseMedio', nombre: 'Rueda apretada del mouse (clic del medio)', ayuda: 'algunas tabletas mandan así el 2.º botón', firmas: ['mouse:b1', 'mouse:m4'] },
	{ clave: 'mouseDer', nombre: 'Clic derecho del mouse', ayuda: 'algunas tabletas mandan así un botón', firmas: ['mouse:b2', 'mouse:m2'] },
	{ clave: 'teclaAlt', nombre: 'Tecla Alt apretada', ayuda: 'si el driver convierte un botón en Alt', firmas: ['tecla:Alt'] },
];

/** Nombre entendible de una firma. */
export function nombreDeFirma(f) {
	const base = BOTONES_BASE.find((b) => b.firmas.includes(f));
	if (base) return base.nombre;
	const [t, c] = f.split(':');
	if (t === 'tecla') return `Tecla ${c}`;
	const quien = t === 'pen' ? 'Lápiz' : t === 'mouse' ? 'Mouse' : t === 'touch' ? 'Dedo' : t;
	return `${quien}: ${c[0] === 'm' ? `botón (buttons ${c.slice(1)})` : `botón número ${c.slice(1)}`}`;
}

/** Herramienta que manda en este gesto según los botones del lápiz, del mouse o la tecla Alt (o null: la que está elegida). */
function herramientaDe(e) {
	const fs = firmasDe(e);
	if (!fs.length) return null;
	for (const f of fs) if (f in E.aj.extra) return TRADUCCION[E.aj.extra[f]] ?? null;
	for (const b of BOTONES_BASE) if (b.firmas.some((f) => fs.includes(f))) return TRADUCCION[E.aj[b.clave]] ?? null;
	return null;
}

/** Descripción de lo que mandó el puntero (para el recuadro de prueba de Ajustes). */
export function describirPuntero(e) {
	const t = e.pointerType === 'pen' ? 'lápiz' : e.pointerType === 'touch' ? 'dedo' : e.pointerType === 'mouse' ? 'mouse' : (e.pointerType ?? e.type);
	return `${e.type} · ${t} · button=${e.button} · buttons=${e.buttons}${e.altKey ? ' · Alt' : ''}${e.ctrlKey ? ' · Ctrl' : ''}${e.shiftKey ? ' · Mayús' : ''}`;
}

// ---------------------------------------------------------------------------------------------- consulta de objetos
function objetoEn(p, tol) {
	const lista = pagina().objetos;
	for (let i = lista.length - 1; i >= 0; i--) {
		const o = E.previa?.get(lista[i].id) ?? lista[i];
		if (distancia(o, p.x, p.y) <= tol) return lista[i];
	}
	return null;
}

const cajaSeleccion = () => {
	const sel = objetosSel().map((o) => E.previa?.get(o.id) ?? o);
	return sel.length ? cajaDeTodos(sel) : null;
};

const MANIJAS = [
	['nw', 0, 0],
	['n', 0.5, 0],
	['ne', 1, 0],
	['e', 1, 0.5],
	['se', 1, 1],
	['s', 0.5, 1],
	['sw', 0, 1],
	['w', 0, 0.5],
];
/** Si lo seleccionado es una sola imagen, la imagen (tal como se ve ahora, con los cambios en curso). */
function imagenUnica() {
	if (E.sel.length !== 1) return null;
	const o = pagina().objetos.find((x) => x.id === E.sel[0]);
	if (!o || o.t !== 'imagen') return null;
	return E.previa?.get(o.id) ?? o;
}

const MANIJAS_IMG = [
	['nw', 0, 0],
	['n', 0.5, 0],
	['ne', 1, 0],
	['e', 1, 0.5],
	['se', 1, 1],
	['s', 0.5, 1],
	['sw', 0, 1],
	['w', 0, 0.5],
];
const DIST_GIRO = 26; // px de pantalla entre el borde de arriba y la manija de giro

/** Posición en la hoja de un punto de la imagen dado en su propio marco (centro 0,0, ya girada). */
function dePropio(o, lx, ly) {
	const c = Math.cos(o.rot || 0);
	const s = Math.sin(o.rot || 0);
	return { x: o.cx + lx * c - ly * s, y: o.cy + lx * s + ly * c };
}

function manijaImagenEn(o, sx, sy, radio) {
	const girar = aPantalla(...Object.values(dePropio(o, 0, -o.alto / 2)));
	const arr = { x: Math.sin(o.rot || 0), y: -Math.cos(o.rot || 0) };
	const gx = girar.x + arr.x * DIST_GIRO;
	const gy = girar.y + arr.y * DIST_GIRO;
	if (Math.hypot(sx - gx, sy - gy) <= radio + 2) return ['giro', 0, 0];
	let mejor = null;
	let md = radio;
	const chica = Math.min(o.ancho, o.alto) * E.vista.z < 34;
	for (const m of MANIJAS_IMG) {
		if (chica && m[0].length === 1) continue;
		const q = aPantalla(...Object.values(dePropio(o, (m[1] - 0.5) * o.ancho, (m[2] - 0.5) * o.alto)));
		const d = Math.hypot(sx - q.x, sy - q.y);
		if (d <= md) {
			md = d;
			mejor = m;
		}
	}
	return mejor;
}

function manijaEn(sx, sy, radio) {
	const b = cajaSeleccion();
	if (!b) return null;
	const a = aPantalla(b.x0, b.y0);
	const c = aPantalla(b.x1, b.y1);
	const chica = c.x - a.x < 36 || c.y - a.y < 36;
	let mejor = null;
	let md = radio;
	for (const m of MANIJAS) {
		if (chica && m[0].length === 1) continue;
		const d = Math.hypot(sx - (a.x + (c.x - a.x) * m[1]), sy - (a.y + (c.y - a.y) * m[2]));
		if (d <= md) {
			md = d;
			mejor = m;
		}
	}
	return mejor;
}

// ---------------------------------------------------------------------------------------------- trazo a mano
const ESTILO_TRAZO = (resalta) => {
	const s = resalta ? E.resalt : E.estilo;
	return { c: s.c, g: s.g, e: s.e, op: resalta ? s.op : 1 };
};

function iniciarTrazo(e, p, s, resalta) {
	gesto = { tipo: 'trazo', id: e.pointerId, pts: [p.x, p.y], ult: s, ancla: s, est: ESTILO_TRAZO(resalta), resalta, snap: null, snapEn: null, timer: 0, desde: ahora() };
	armarEspera();
}

function armarEspera() {
	clearTimeout(gesto.timer);
	gesto.desde = ahora();
	if (!E.aj.formaAuto || gesto.snap) return;
	gesto.timer = window.setTimeout(() => {
		if (!gesto || gesto.tipo !== 'trazo' || gesto.snap) return;
		const f = reconocer(gesto.pts);
		if (!f) return;
		gesto.snap = f;
		gesto.snapEn = gesto.ult;
		emitir('forma', f.nombre);
		navigator.vibrate?.(10);
		pedirVivo();
	}, E.aj.tiempoForma * 1000);
	animarEspera();
}

/** Mientras se espera, se dibuja un anillo que se va llenando: avisa que el lápiz quieto va a corregir la forma. */
function animarEspera() {
	const paso = () => {
		if (!gesto || gesto.tipo !== 'trazo' || gesto.snap || !E.aj.formaAuto) return;
		pedirVivo();
		requestAnimationFrame(paso);
	};
	requestAnimationFrame(paso);
}

function moverTrazo(e) {
	const g = gesto;
	const evs = e.getCoalescedEvents?.() ?? [];
	const lista = evs.length ? evs : [e];
	for (const ev of lista) {
		const s = posEn(ev);
		if (g.snap) {
			if (g.snap.tipo === 'linea' && dist(s, g.snapEn) > 5) {
				// Con la línea ya corregida, seguir moviendo la lleva: el extremo sigue al lápiz (con topes a 0°, 45° y 90°).
				const q = aPagina(s.x, s.y);
				g.snap = { ...g.snap, ...extremoLinea(g.snap.x1, g.snap.y1, q.x, q.y) };
			} else if (g.snap.tipo !== 'linea' && dist(s, g.snapEn) > 18) {
				g.snap = null; // se movió bastante: se cancela la corrección y sigue el trazo a mano
				emitir('forma', null);
			}
			g.ult = s;
			continue;
		}
		if (dist(s, g.ult) < 1.1) continue;
		const q = aPagina(s.x, s.y);
		g.pts.push(q.x, q.y);
		g.ult = s;
		if (dist(s, g.ancla) > 4) {
			g.ancla = s;
			armarEspera();
		}
	}
}

/** Extremo de una línea que va de (x1, y1) hacia (x, y), enderezado si cae muy cerca de 0°, 45° o 90°. */
function extremoLinea(x1, y1, x, y, tol = 4) {
	const len = Math.hypot(x - x1, y - y1);
	let ang = Math.atan2(y - y1, x - x1) * (180 / Math.PI);
	const c = Math.round(ang / 45) * 45;
	if (Math.abs(ang - c) <= tol) ang = c;
	const a = (ang * Math.PI) / 180;
	return { x2: x1 + len * Math.cos(a), y2: y1 + len * Math.sin(a) };
}

function terminarTrazo() {
	const g = gesto;
	clearTimeout(g.timer);
	let obj;
	if (g.snap) obj = objetoDeForma(g.snap, g.est);
	else {
		const todosIguales = g.pts.every((v, i) => v === g.pts[i % 2]);
		let p = g.pts.length <= 2 || todosIguales ? [g.pts[0], g.pts[1]] : simplificar(g.pts, Math.min(0.6, Math.max(0.05, 0.3 / E.vista.z)));
		p = redondear2(p);
		obj = base('trazo', { ...g.est, p, ...(g.resalta ? { res: true } : {}) });
	}
	cambiar(() => ponerObjetos([...pagina().objetos, obj]));
}

// ---------------------------------------------------------------------------------------------- borrador
function iniciarBorrar(e, p) {
	gesto = { tipo: 'borrar', id: e.pointerId, ult: p, abierto: false };
	borrarSegmento(p, p);
}

function borrarSegmento(a, b) {
	const r = E.estilo.borrador / E.vista.z;
	const largo = Math.hypot(b.x - a.x, b.y - a.y);
	const pasos = Math.max(1, Math.ceil(largo / (r * 0.5)));
	for (let i = 1; i <= pasos; i++) borrarEn(a.x + ((b.x - a.x) * i) / pasos, a.y + ((b.y - a.y) * i) / pasos, r);
}

function borrarEn(x, y, r) {
	const lista = pagina().objetos;
	const parcial = E.estilo.borrarModo === 'parcial';
	let nueva = null;
	for (let i = 0; i < lista.length; i++) {
		const o = lista[i];
		const b = cajaDe(o);
		const m = r + (o.g || 0) / 2;
		const toca = !(x < b.x0 - m || x > b.x1 + m || y < b.y0 - m || y > b.y1 + m) && distancia(o, x, y) <= r;
		if (!toca) {
			nueva?.push(o);
			continue;
		}
		nueva ??= lista.slice(0, i);
		// Parcial: de un trazo a mano se borra solo lo tocado y quedan los pedazos. Una figura se borra entera.
		if (parcial && o.t === 'trazo' && o.p.length >= 4) {
			let k = 0;
			for (const pieza of recortar(o.p, x, y, r + o.g / 2)) nueva.push({ ...o, id: k++ === 0 ? o.id : nuevoId(), p: redondear2(pieza) });
		}
	}
	if (!nueva) return;
	if (!gesto.abierto) {
		E.hist.antes(E.doc);
		gesto.abierto = true;
	}
	ponerObjetos(nueva);
	E.sucio = true;
	if (E.sel.length) {
		const vivos = new Set(nueva.map((o) => o.id));
		E.sel = E.sel.filter((id) => vivos.has(id));
	}
	pedir();
}

// ---------------------------------------------------------------------------------------------- selección
function iniciarSeleccion(e, p, s, modo /* 'seleccion' | 'lazo' */) {
	const tactil = e.pointerType !== 'mouse';
	const radioManija = tactil ? 20 : 11;
	const img = imagenUnica();
	if (img) {
		const mi = manijaImagenEn(img, s.x, s.y, radioManija);
		if (mi) {
			const orig = pagina().objetos.find((x) => x.id === img.id);
			gesto = mi[0] === 'giro' ? { tipo: 'rotarImg', id: e.pointerId, orig, huboCambio: false } : { tipo: 'redimImg', id: e.pointerId, orig, fx: mi[1], fy: mi[2], huboCambio: false };
			return;
		}
	}
	const m = img ? null : manijaEn(s.x, s.y, radioManija);
	if (m) {
		const b = cajaSeleccion();
		const [nombre, fx, fy] = m;
		gesto = { tipo: 'redim', id: e.pointerId, nombre, fx, fy, caja: b, orig: new Map(objetosSel().map((o) => [o.id, o])), huboCambio: false };
		return;
	}
	const tol = (tactil ? 14 : 8) / E.vista.z;
	const o = objetoEn(p, tol);
	if (o) {
		if (!E.sel.includes(o.id)) seleccionar(e.shiftKey || e.ctrlKey ? [...E.sel, o.id] : [o.id]);
		gesto = { tipo: 'mover', id: e.pointerId, desde: p, orig: new Map(objetosSel().map((x) => [x.id, x])), mov: false, objeto: o, sx: s.x, sy: s.y };
		return;
	}
	if (!e.shiftKey && !e.ctrlKey) seleccionar([]);
	gesto = { tipo: modo === 'lazo' ? 'lazo' : 'marco', id: e.pointerId, pts: [p.x, p.y], a: p, b: p, sumar: e.shiftKey || e.ctrlKey, previos: [...E.sel] };
}

function moverSeleccion(p, s) {
	const g = gesto;
	if (!g.mov && Math.hypot(s.x - g.sx, s.y - g.sy) < 3) return;
	g.mov = true;
	const dx = p.x - g.desde.x;
	const dy = p.y - g.desde.y;
	E.previa = new Map([...g.orig].map(([id, o]) => [id, mover(o, dx, dy)]));
}

function redimensionar(p, e) {
	const g = gesto;
	const { x0, y0, x1, y1 } = g.caja;
	const w = x1 - x0;
	const h = y1 - y0;
	const ax = g.fx === 0 ? x1 : g.fx === 1 ? x0 : (x0 + x1) / 2;
	const ay = g.fy === 0 ? y1 : g.fy === 1 ? y0 : (y0 + y1) / 2;
	const hx = g.fx === 0 ? x0 : x1;
	const hy = g.fy === 0 ? y0 : y1;
	let sx = g.fx === 0.5 || Math.abs(hx - ax) < 1e-6 ? 1 : (p.x - ax) / (hx - ax);
	let sy = g.fy === 0.5 || Math.abs(hy - ay) < 1e-6 ? 1 : (p.y - ay) / (hy - ay);
	if (g.nombre.length === 2 && !e.shiftKey) {
		// En las esquinas se agranda parejo (mantiene la proporción); con Shift apretado se deforma libremente.
		const s = (w > 1e-6 && h > 1e-6 ? (sx + sy) / 2 : w > 1e-6 ? sx : sy) || 1;
		sx = sy = s;
	}
	const piso = 0.04;
	if (Math.abs(sx) < piso) sx = sx < 0 ? -piso : piso;
	if (Math.abs(sy) < piso) sy = sy < 0 ? -piso : piso;
	g.huboCambio = true;
	E.previa = new Map([...g.orig].map(([id, o]) => [id, escalar(o, sx, sy, ax, ay)]));
}

/** Agranda o achica la imagen desde una manija, en su propio marco (aunque esté girada): las esquinas conservan la proporción. */
function redimensionarImagen(p, e) {
	const g = gesto;
	const o = g.orig;
	const c = Math.cos(o.rot || 0);
	const sn = Math.sin(o.rot || 0);
	const dx = p.x - o.cx;
	const dy = p.y - o.cy;
	const q = { x: dx * c + dy * sn, y: -dx * sn + dy * c }; // el puntero en el marco de la imagen
	const hx = (g.fx - 0.5) * o.ancho;
	const hy = (g.fy - 0.5) * o.alto;
	const ax = -hx;
	const ay = -hy;
	const MIN = 10;
	let ancho = o.ancho;
	let alto = o.alto;
	let ccx = 0;
	let ccy = 0;
	if (g.fx !== 0.5 && g.fy !== 0.5) {
		if (!e.shiftKey) {
			const vx = hx - ax;
			const vy = hy - ay;
			let k = ((q.x - ax) * vx + (q.y - ay) * vy) / (vx * vx + vy * vy);
			k = Math.max(k, MIN / Math.min(o.ancho, o.alto));
			ancho = o.ancho * k;
			alto = o.alto * k;
			ccx = ax + (vx * k) / 2;
			ccy = ay + (vy * k) / 2;
		} else {
			const sx = g.fx === 1 ? 1 : -1;
			const sy = g.fy === 1 ? 1 : -1;
			ancho = Math.max(MIN, sx * (q.x - ax));
			alto = Math.max(MIN, sy * (q.y - ay));
			ccx = ax + (sx * ancho) / 2;
			ccy = ay + (sy * alto) / 2;
		}
	} else if (g.fy === 0.5) {
		const sx = g.fx === 1 ? 1 : -1;
		ancho = Math.max(MIN, sx * (q.x - ax));
		ccx = ax + (sx * ancho) / 2;
	} else {
		const sy = g.fy === 1 ? 1 : -1;
		alto = Math.max(MIN, sy * (q.y - ay));
		ccy = ay + (sy * alto) / 2;
	}
	g.huboCambio = true;
	const w = dePropio(o, ccx, ccy);
	E.previa = new Map([[o.id, { ...o, cx: w.x, cy: w.y, ancho, alto }]]);
}

/** Gira la imagen con la manija de arriba; se pega a los múltiplos de 15° (siempre con Mayús). */
function girarImagen(p, e) {
	const g = gesto;
	const o = g.orig;
	let a = Math.atan2(p.y - o.cy, p.x - o.cx) + Math.PI / 2;
	const paso = Math.PI / 12;
	const cerca = Math.round(a / paso) * paso;
	if (e.shiftKey || Math.abs(a - cerca) < 0.06) a = cerca;
	a = Math.atan2(Math.sin(a), Math.cos(a));
	g.huboCambio = true;
	E.previa = new Map([[o.id, { ...o, rot: a }]]);
}

function terminarSeleccion() {
	const g = gesto;
	if (g.tipo === 'mover' || g.tipo === 'redim' || g.tipo === 'redimImg' || g.tipo === 'rotarImg') {
		const hay = g.tipo === 'mover' ? g.mov : g.huboCambio;
		if (hay && E.previa) {
			const mapa = new Map(E.previa);
			E.previa = null;
			cambiar(() => reemplazar(mapa));
		} else {
			E.previa = null;
			// Tocar dos veces un texto lo edita.
			if (g.tipo === 'mover' && g.objeto?.t === 'texto') {
				const t = ahora();
				if (ultimoToque.id === g.objeto.id && t - ultimoToque.t < 450) {
					ultimoToque = { id: null, t: 0 };
					editarTexto(g.objeto);
				} else ultimoToque = { id: g.objeto.id, t };
			}
		}
		return;
	}
	// marco o lazo: se eligen los objetos que quedan (en su mayoría) adentro
	let poli;
	if (g.tipo === 'marco') {
		if (dist(g.a, g.b) * E.vista.z < 4) return;
		poli = [g.a.x, g.a.y, g.b.x, g.a.y, g.b.x, g.b.y, g.a.x, g.b.y];
	} else {
		if (g.pts.length < 6) return;
		poli = g.pts;
	}
	const ids = pagina()
		.objetos.filter((o) => fraccionDentro(o, poli) >= 0.6)
		.map((o) => o.id);
	seleccionar(g.sumar ? [...g.previos, ...ids] : ids);
	// Si el lazo fue con el botón del lápiz, la herramienta pasa a Seleccionar hasta que se suelte la selección.
	if (g.conBoton && E.sel.length) usarHerramienta('seleccion', { previa: true });
}
let ultimoToque = { id: null, t: 0 };

// ---------------------------------------------------------------------------------------------- formas
export const FORMAS = ['linea', 'flecha', 'flecha2', 'rect', 'elipse', 'triangulo', 'rombo', 'ejes', 'ejesCruz'];
export const NOMBRE_FORMA = { linea: 'Línea', flecha: 'Flecha', flecha2: 'Flecha doble', rect: 'Rectángulo', elipse: 'Elipse', triangulo: 'Triángulo', rombo: 'Rombo', ejes: 'Ejes', ejesCruz: 'Ejes (cruz)' };

/** Objeto de la forma pedida, entre dos puntos opuestos. `parejo` fuerza cuadrado, círculo o línea a 45°. */
export function crearForma(tipo, x0, y0, x1, y1, parejo = false) {
	const est = { c: E.estilo.c, g: E.estilo.g, e: E.estilo.e, op: 1 };
	if (parejo && tipo !== 'linea' && tipo !== 'flecha' && tipo !== 'flecha2') {
		const lado = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
		x1 = x0 + Math.sign(x1 - x0 || 1) * lado;
		y1 = y0 + Math.sign(y1 - y0 || 1) * lado;
	}
	const x = Math.min(x0, x1);
	const y = Math.min(y0, y1);
	const ancho = Math.abs(x1 - x0);
	const alto = Math.abs(y1 - y0);
	const rel = E.estilo.rel;
	switch (tipo) {
		case 'linea':
		case 'flecha':
		case 'flecha2': {
			const q = extremoLinea(x0, y0, x1, y1, parejo ? 23 : 2.5);
			return base('linea', { ...est, x1: x0, y1: y0, ...q, fi: tipo === 'flecha2' ? 1 : 0, ff: tipo === 'linea' ? 0 : 1 });
		}
		case 'rect':
			return base('rect', { ...est, x, y, ancho, alto, r: rel });
		case 'elipse':
			return base('elipse', { ...est, cx: x + ancho / 2, cy: y + alto / 2, rx: ancho / 2, ry: alto / 2, r: rel });
		case 'triangulo':
			return base('poli', { ...est, p: [x + ancho / 2, y, x + ancho, y + alto, x, y + alto], cerrado: true, r: rel });
		case 'rombo':
			return base('poli', { ...est, p: [x + ancho / 2, y, x + ancho, y + alto / 2, x + ancho / 2, y + alto, x, y + alto / 2], cerrado: true, r: rel });
		case 'ejes':
		case 'ejesCruz':
			return base('ejes', { ...est, x, y, ancho: Math.max(ancho, 30), alto: Math.max(alto, 30), modo: tipo === 'ejes' ? 'L' : 'cruz', marcas: true, etq: true, paso: 32 });
		default:
			return null;
	}
}

function tamanoPorDefecto(tipo) {
	if (tipo === 'linea' || tipo === 'flecha' || tipo === 'flecha2') return [160, 0];
	if (tipo === 'ejes' || tipo === 'ejesCruz') return [220, 160];
	return [150, 100];
}

function iniciarForma(e, p, s) {
	gesto = { tipo: 'forma', id: e.pointerId, a: p, b: p, sa: s, mov: false, forma: E.estilo.forma };
}

function terminarForma(e) {
	const g = gesto;
	let obj;
	if (!g.mov) {
		const [w, h] = tamanoPorDefecto(g.forma);
		const lineal = h === 0;
		obj = crearForma(g.forma, g.a.x - (lineal ? w / 2 : w / 2), g.a.y - h / 2, g.a.x + w / 2, g.a.y + h / 2);
	} else obj = crearForma(g.forma, g.a.x, g.a.y, g.b.x, g.b.y, e.shiftKey);
	if (!obj) return;
	cambiar(() => ponerObjetos([...pagina().objetos, obj]));
	E.sel = [obj.id];
	emitir('sel');
}

// ---------------------------------------------------------------------------------------------- texto
let editor = null;
const elEditor = () => document.getElementById('texto-ed');

/** Abre el cuadro para escribir. Con `obj` edita un texto que ya está; sin `obj`, crea uno nuevo en (x, y) de la hoja. */
export function editarTexto(obj, x = 0, y = 0) {
	const ta = elEditor();
	if (!ta) return;
	cerrarEditor(true);
	const px = obj ? obj.x : x;
	const py = obj ? obj.y : y;
	const tam = obj ? obj.tam : E.estilo.tam;
	const cur = obj ? !!obj.cur : E.estilo.cur;
	const color = obj ? obj.c : E.estilo.c;
	editor = { obj, x: px, y: py, tam, cur, color, ta };
	if (obj) {
		E.ocultos = new Set([obj.id]);
		pedir();
	}
	ta.hidden = false;
	ta.value = obj ? obj.s : '';
	ajustarEditor();
	ta.focus();
	ta.setSelectionRange(ta.value.length, ta.value.length);
}

function ajustarEditor() {
	if (!editor) return;
	const { ta, x, y, tam, cur, color } = editor;
	const z = E.vista.z;
	const s = aPantalla(x, y);
	ta.style.left = `${s.x}px`;
	ta.style.top = `${s.y}px`;
	ta.style.fontSize = `${tam * z}px`;
	ta.style.lineHeight = '1.25';
	ta.style.fontStyle = cur ? 'italic' : 'normal';
	ta.style.color = color;
	ta.style.width = '10px';
	ta.style.height = '10px';
	ta.style.width = `${Math.max(tam * z * 3, ta.scrollWidth + 6)}px`;
	ta.style.height = `${Math.max(tam * z * 1.25, ta.scrollHeight)}px`;
}

export function cerrarEditor(guardar = true) {
	if (!editor) return;
	const { ta, obj, x, y, tam, cur, color } = editor;
	const texto = ta.value.replace(/\s+$/g, '');
	editor = null;
	ta.hidden = true;
	E.ocultos = null;
	if (guardar) {
		if (obj) {
			if (!texto) cambiar(() => reemplazar(new Map([[obj.id, null]])));
			else if (texto !== obj.s) cambiar(() => reemplazar(new Map([[obj.id, { ...obj, s: texto }]])));
		} else if (texto.trim()) {
			const nuevo = base('texto', { x, y, s: texto, tam, cur, c: color });
			cambiar(() => ponerObjetos([...pagina().objetos, nuevo]));
		}
	}
	pedir();
}
export const editando = () => !!editor;

// ---------------------------------------------------------------------------------------------- mano y pinza
function iniciarMano(e, s) {
	gesto = { tipo: 'mano', id: e.pointerId, ult: s };
	cv.style.cursor = 'grabbing';
}

function iniciarPinza() {
	const [a, b] = [...punteros.values()].filter((q) => q.tipo === 'touch');
	gesto = { tipo: 'pinza', d0: Math.max(10, dist(a, b)), z0: E.vista.z, centro: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
}

function moverPinza() {
	const [a, b] = [...punteros.values()].filter((q) => q.tipo === 'touch');
	if (!a || !b) return;
	const centro = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
	const z = gesto.z0 * (dist(a, b) / gesto.d0);
	desplazar(centro.x - gesto.centro.x, centro.y - gesto.centro.y);
	zoomEn(z, centro.x, centro.y);
	gesto.centro = centro;
}

// ---------------------------------------------------------------------------------------------- eventos
function cancelarGesto() {
	if (gesto?.timer) clearTimeout(gesto.timer);
	if (gesto?.tipo === 'borrar' && gesto.abierto) emitir('doc');
	E.previa = null;
	gesto = null;
	actualizarCursor();
	pedir();
}

function alBajar(e) {
	if (editor) cerrarEditor(true);
	e.preventDefault();
	// Con preventDefault el navegador no le da el foco a la hoja: se lo damos nosotros, para que anden Supr, Retroceso, Ctrl+C…
	if (!document.hasFocus()) {
		try {
			window.focus();
		} catch {
			/* sin permiso */
		}
	}
	cv.focus({ preventScroll: true });
	const s = posEn(e);
	const tipo = e.pointerType;
	if (tipo === 'pen') {
		ultimoPen = ahora();
		if (!E.aj.penVisto) {
			E.aj.penVisto = true;
			if (!E.aj.dedoElegido && E.aj.dedo === 'dibujar') {
				E.aj.dedo = 'mover';
				emitir('aviso', 'Detecté un lápiz: ahora el dedo mueve la hoja (se cambia en Ajustes)');
			}
			guardarAjustes();
		}
	}
	// La palma apoyada mientras se escribe con el lápiz no hace nada.
	if (tipo === 'touch' && ahora() - ultimoPen < 800) return;
	try {
		cv.setPointerCapture(e.pointerId);
	} catch {
		/* puntero que ya no está activo */
	}
	punteros.set(e.pointerId, { ...s, tipo });
	if (tipo === 'touch') {
		const dedos = [...punteros.values()].filter((q) => q.tipo === 'touch').length;
		if (dedos >= 2) {
			if (gesto && gesto.tipo !== 'pinza' && gesto.tipo !== 'mano') cancelarGesto();
			iniciarPinza();
			return;
		}
		if (E.aj.dedo === 'ignorar') return;
		if (E.aj.dedo === 'mover') {
			iniciarMano(e, s);
			return;
		}
	}
	if (gesto) return;
	const p = aPagina(s.x, s.y);
	let herr = herramientaDe(e);
	// Algunos navegadores avisan "pointerdown" al apretar un botón del lápiz aunque no toque la hoja: si ese botón no tiene
	// ninguna función asignada, no se empieza a dibujar en el aire.
	if (!herr && tipo === 'pen' && !(e.buttons & 1) && e.buttons & 6) return;
	const conBoton = !!herr && e.pointerType === 'pen';
	if (!herr && espacio) herr = 'mano';
	herr ??= E.herr;
	switch (herr) {
		case 'lapiz':
		case 'resaltador':
			if (E.sel.length) seleccionar([]);
			iniciarTrazo(e, p, s, herr === 'resaltador');
			break;
		case 'borrador':
			iniciarBorrar(e, p);
			break;
		case 'seleccion':
		case 'lazo':
			iniciarSeleccion(e, p, s, herr);
			if (gesto) gesto.conBoton = conBoton;
			break;
		case 'forma':
			if (E.sel.length) seleccionar([]);
			iniciarForma(e, p, s);
			break;
		case 'texto': {
			const o = objetoEn(p, 6 / E.vista.z);
			gesto = { tipo: 'texto', id: e.pointerId, p, objeto: o?.t === 'texto' ? o : null, s };
			break;
		}
		case 'mano':
			iniciarMano(e, s);
			break;
		default:
			break;
	}
	pedir();
}

function alMover(e) {
	const s = posEn(e);
	if (e.pointerType === 'pen') ultimoPen = ahora();
	const q = punteros.get(e.pointerId);
	if (q) {
		q.x = s.x;
		q.y = s.y;
	}
	if (e.pointerType !== 'touch') {
		cursor = s;
		emitir('puntero', e);
	}
	if (!gesto) {
		if (E.herr === 'borrador' || herramientaDe(e) === 'borrador') pedirVivo();
		return;
	}
	if (gesto.tipo === 'pinza') {
		moverPinza();
		return;
	}
	if (gesto.id !== undefined && gesto.id !== e.pointerId) return;
	const p = aPagina(s.x, s.y);
	switch (gesto.tipo) {
		case 'trazo':
			moverTrazo(e);
			break;
		case 'borrar':
			for (const ev of e.getCoalescedEvents?.() ?? [e]) {
				const sp = posEn(ev);
				const pp = aPagina(sp.x, sp.y);
				borrarSegmento(gesto.ult, pp);
				gesto.ult = pp;
			}
			break;
		case 'mover':
			moverSeleccion(p, s);
			break;
		case 'redim':
			redimensionar(p, e);
			break;
		case 'redimImg':
			redimensionarImagen(p, e);
			break;
		case 'rotarImg':
			girarImagen(p, e);
			break;
		case 'marco':
			gesto.b = p;
			break;
		case 'lazo':
			gesto.pts.push(p.x, p.y);
			break;
		case 'forma':
			gesto.b = p;
			if (!gesto.mov && dist(s, gesto.sa) > 5) gesto.mov = true;
			gesto.shift = e.shiftKey;
			break;
		case 'mano':
			desplazar(s.x - gesto.ult.x, s.y - gesto.ult.y);
			gesto.ult = s;
			break;
		default:
			break;
	}
	// Con trazos, recuadros, lazos y formas en curso solo cambia lo de encima; moviendo objetos o borrando, la hoja también.
	if (['trazo', 'marco', 'lazo', 'forma'].includes(gesto.tipo)) pedirVivo();
	else pedir();
}

function alSoltar(e) {
	punteros.delete(e.pointerId);
	if (gesto?.tipo === 'pinza') {
		if ([...punteros.values()].filter((q) => q.tipo === 'touch').length < 2) gesto = null;
		return;
	}
	if (!gesto || (gesto.id !== undefined && gesto.id !== e.pointerId)) return;
	if (e.type === 'pointercancel') {
		cancelarGesto();
		return;
	}
	const g = gesto;
	try {
		switch (g.tipo) {
			case 'trazo':
				terminarTrazo();
				break;
			case 'borrar':
				if (g.abierto) emitir('doc');
				break;
			case 'mover':
			case 'redim':
			case 'redimImg':
			case 'rotarImg':
			case 'marco':
			case 'lazo':
				terminarSeleccion();
				break;
			case 'forma':
				terminarForma(e);
				break;
			case 'texto':
				if (dist(g.s, posEn(e)) < 8) editarTexto(g.objeto, g.p.x, g.p.y);
				break;
			default:
				break;
		}
	} finally {
		gesto = null;
		actualizarCursor();
		pedir();
	}
}

function alRueda(e) {
	e.preventDefault();
	const s = posEn(e);
	if (e.ctrlKey) {
		// Con la rueda de un mouse (saltos grandes) cada muesca agranda o achica un 10 %; con el pellizco de un panel táctil (pasos
		// chiquitos) el zoom acompaña el dedo.
		const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
		const escalon = Math.abs(dy) >= 50;
		const k = escalon ? Math.sign(dy) * Math.log(1.1) : dy * 0.0035;
		zoomEn(E.vista.z * Math.exp(-k), s.x, s.y);
	} else if (e.shiftKey) desplazar(-(e.deltaY || e.deltaX), 0);
	else desplazar(-e.deltaX, -e.deltaY);
}

const CURSORES = { lapiz: 'crosshair', resaltador: 'crosshair', borrador: 'none', seleccion: 'default', lazo: 'crosshair', forma: 'crosshair', texto: 'text', mano: 'grab' };
function actualizarCursor() {
	if (cv) cv.style.cursor = espacio ? 'grab' : (CURSORES[E.herr] ?? 'default');
}

// ---------------------------------------------------------------------------------------------- lo que se dibuja encima
function pintarVivo(ctx, { z, px }) {
	const g = gesto;
	if (g?.tipo === 'trazo') {
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		if (g.snap) {
			dibujarObjeto(ctx, objetoDeForma(g.snap, g.est));
		} else {
			ctx.globalAlpha = g.est.op;
			ctx.strokeStyle = g.est.c;
			ctx.lineWidth = g.est.g;
			if (g.pts.length >= 4) {
				const d = dTrazo(g.pts);
				const dash = { guiones: [Math.max(g.est.g, 1.6) * 4, Math.max(g.est.g, 1.6) * 2.6], puntos: [0.01, Math.max(g.est.g, 1.6) * 2.4], guionpunto: [Math.max(g.est.g, 1.6) * 5, Math.max(g.est.g, 1.6) * 2.2, 0.01, Math.max(g.est.g, 1.6) * 2.2] }[g.est.e];
				ctx.setLineDash(dash ?? []);
				ctx.stroke(new Path2D(d));
			} else {
				ctx.fillStyle = g.est.c;
				ctx.beginPath();
				ctx.arc(g.pts[0], g.pts[1], g.est.g / 2, 0, Math.PI * 2);
				ctx.fill();
			}
			ctx.globalAlpha = 1;
			// anillo que se llena mientras el lápiz está quieto
			if (E.aj.formaAuto) {
				const t = (ahora() - g.desde) / (E.aj.tiempoForma * 1000);
				if (t > 0.25 && t < 1) {
					const x = g.pts[g.pts.length - 2];
					const y = g.pts[g.pts.length - 1];
					ctx.setLineDash([]);
					ctx.strokeStyle = ACENTO;
					ctx.lineWidth = px(2.5);
					ctx.beginPath();
					ctx.arc(x, y, px(16), -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t);
					ctx.stroke();
				}
			}
		}
	}
	if (g?.tipo === 'forma' && g.mov) {
		const o = crearForma(g.forma, g.a.x, g.a.y, g.b.x, g.b.y, g.shift);
		if (o) dibujarObjeto(ctx, o);
	}
	if (g?.tipo === 'marco' || g?.tipo === 'lazo') {
		ctx.lineWidth = px(1.5);
		ctx.setLineDash([px(6), px(4)]);
		ctx.strokeStyle = ACENTO;
		ctx.fillStyle = 'rgba(255,77,31,0.08)';
		ctx.beginPath();
		if (g.tipo === 'marco') ctx.rect(g.a.x, g.a.y, g.b.x - g.a.x, g.b.y - g.a.y);
		else {
			ctx.moveTo(g.pts[0], g.pts[1]);
			for (let i = 2; i < g.pts.length; i += 2) ctx.lineTo(g.pts[i], g.pts[i + 1]);
			ctx.closePath();
		}
		ctx.fill();
		ctx.stroke();
		ctx.setLineDash([]);
	}
	// una imagen sola: marco girado con sus manijas y la de giro
	const im = imagenUnica();
	if (im && g?.tipo !== 'trazo') {
		const esq = esquinasImagen(im);
		ctx.lineWidth = px(1.4);
		ctx.strokeStyle = ACENTO;
		ctx.setLineDash([px(5), px(3)]);
		ctx.beginPath();
		ctx.moveTo(esq[0], esq[1]);
		for (let k = 2; k < 8; k += 2) ctx.lineTo(esq[k], esq[k + 1]);
		ctx.closePath();
		ctx.stroke();
		ctx.setLineDash([]);
		if (E.herr === 'seleccion' || E.herr === 'lazo') {
			const t = px(9);
			const chica = Math.min(im.ancho, im.alto) * z < 34;
			const caja = (x, y, redondo = false) => {
				ctx.fillStyle = '#fff';
				ctx.strokeStyle = ACENTO;
				ctx.lineWidth = px(1.6);
				ctx.beginPath();
				if (redondo) ctx.arc(x, y, t * 0.62, 0, Math.PI * 2);
				else ctx.rect(x - t / 2, y - t / 2, t, t);
				ctx.fill();
				ctx.stroke();
			};
			for (const [nombre, fx, fy] of MANIJAS_IMG) {
				if (chica && nombre.length === 1) continue;
				const w = dePropio(im, (fx - 0.5) * im.ancho, (fy - 0.5) * im.alto);
				caja(w.x, w.y);
			}
			const arriba = dePropio(im, 0, -im.alto / 2);
			const sx = Math.sin(im.rot || 0);
			const sy = -Math.cos(im.rot || 0);
			const d = px(DIST_GIRO);
			ctx.beginPath();
			ctx.moveTo(arriba.x, arriba.y);
			ctx.lineTo(arriba.x + sx * d, arriba.y + sy * d);
			ctx.strokeStyle = ACENTO;
			ctx.lineWidth = px(1.2);
			ctx.stroke();
			caja(arriba.x + sx * d, arriba.y + sy * d, true);
		}
	}
	// selección: caja punteada y manijas
	const b = im ? null : cajaSeleccion();
	if (b && g?.tipo !== 'trazo') {
		const m = px(4);
		ctx.lineWidth = px(1.4);
		ctx.strokeStyle = ACENTO;
		ctx.setLineDash([px(5), px(3)]);
		ctx.strokeRect(b.x0 - m, b.y0 - m, b.x1 - b.x0 + 2 * m, b.y1 - b.y0 + 2 * m);
		ctx.setLineDash([]);
		if (E.herr === 'seleccion' || E.herr === 'lazo') {
			const chica = (b.x1 - b.x0) * z < 36 || (b.y1 - b.y0) * z < 36;
			const t = px(9);
			for (const [nombre, fx, fy] of MANIJAS) {
				if (chica && nombre.length === 1) continue;
				const x = b.x0 - m + (b.x1 - b.x0 + 2 * m) * fx;
				const y = b.y0 - m + (b.y1 - b.y0 + 2 * m) * fy;
				ctx.fillStyle = '#fff';
				ctx.strokeStyle = ACENTO;
				ctx.lineWidth = px(1.6);
				ctx.beginPath();
				ctx.rect(x - t / 2, y - t / 2, t, t);
				ctx.fill();
				ctx.stroke();
			}
		}
	}
	// círculo del borrador
	const usandoBorrador = g?.tipo === 'borrar' || (!g && E.herr === 'borrador');
	if (usandoBorrador && cursor) {
		const c = aPagina(cursor.x, cursor.y);
		const r = E.estilo.borrador / z;
		ctx.lineWidth = px(1.2);
		ctx.strokeStyle = '#000';
		ctx.fillStyle = 'rgba(255,255,255,0.18)';
		ctx.beginPath();
		ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();
		ctx.strokeStyle = '#fff';
		ctx.beginPath();
		ctx.arc(c.x, c.y, r + px(1.2), 0, Math.PI * 2);
		ctx.stroke();
	}
}

// ---------------------------------------------------------------------------------------------- acciones sobre la selección
export function borrarSeleccion() {
	if (!E.sel.length) return;
	const ids = new Set(E.sel);
	cambiar(() => ponerObjetos(pagina().objetos.filter((o) => !ids.has(o.id))));
	seleccionar([]);
}

export function copiarSeleccion() {
	E.portapapeles = objetosSel();
	return E.portapapeles.length;
}

export function cortarSeleccion() {
	if (copiarSeleccion()) borrarSeleccion();
}

export function pegar(desplazamiento = 24) {
	if (!E.portapapeles.length) return;
	const nuevos = E.portapapeles.map((o) => mover(conIdNuevo(o), desplazamiento, desplazamiento));
	cambiar(() => ponerObjetos([...pagina().objetos, ...nuevos]));
	E.portapapeles = E.portapapeles.map((o) => mover(o, desplazamiento, desplazamiento));
	seleccionar(nuevos.map((o) => o.id));
}

export function duplicarSeleccion() {
	const sel = objetosSel();
	if (!sel.length) return;
	const nuevos = sel.map((o) => mover(conIdNuevo(o), 24, 24));
	cambiar(() => ponerObjetos([...pagina().objetos, ...nuevos]));
	seleccionar(nuevos.map((o) => o.id));
}

export function seleccionarTodo() {
	seleccionar(pagina().objetos.map((o) => o.id));
}

/** Pasa la selección por delante (arriba de todo) o por detrás (abajo de todo). */
export function ordenarSeleccion(adelante) {
	if (!E.sel.length) return;
	const ids = new Set(E.sel);
	const lista = pagina().objetos;
	const parte = lista.filter((o) => ids.has(o.id));
	const resto = lista.filter((o) => !ids.has(o.id));
	cambiar(() => ponerObjetos(adelante ? [...resto, ...parte] : [...parte, ...resto]));
}

/** Cambia color, grosor, estilo, relleno, tamaño de letra o cursiva de lo seleccionado (solo donde corresponde). */
export function aplicarASeleccion(props) {
	const sel = objetosSel();
	if (!sel.length) return false;
	const mapa = new Map();
	for (const o of sel) {
		const n = { ...o };
		let cambio = false;
		const poner = (k, v) => {
			if (n[k] !== v) {
				n[k] = v;
				cambio = true;
			}
		};
		if ('c' in props) poner('c', props.c);
		if ('g' in props && o.t !== 'texto') poner('g', props.g);
		if ('e' in props && o.t !== 'texto') poner('e', props.e);
		if ('r' in props && (o.t === 'rect' || o.t === 'elipse' || (o.t === 'poli' && o.cerrado))) poner('r', props.r);
		if ('tam' in props && o.t === 'texto') poner('tam', props.tam);
		if ('cur' in props && o.t === 'texto') poner('cur', props.cur);
		if ('op' in props && o.t !== 'texto') poner('op', props.op);
		if (cambio) mapa.set(o.id, n);
	}
	if (!mapa.size) return false;
	cambiar(() => reemplazar(mapa));
	return true;
}

/** Gira las imágenes seleccionadas (los otros objetos no tienen giro). */
export function girarSeleccion(delta) {
	const mapa = new Map();
	for (const o of objetosSel()) if (o.t === 'imagen') mapa.set(o.id, { ...o, rot: Math.atan2(Math.sin((o.rot || 0) + delta), Math.cos((o.rot || 0) + delta)) });
	if (mapa.size) cambiar(() => reemplazar(mapa));
}

/** Da vuelta las imágenes seleccionadas como en un espejo ('h' izquierda-derecha, 'v' arriba-abajo). */
export function voltearSeleccion(eje) {
	const mapa = new Map();
	for (const o of objetosSel()) if (o.t === 'imagen') mapa.set(o.id, eje === 'h' ? { ...o, fx: o.fx ? 0 : 1 } : { ...o, fy: o.fy ? 0 : 1 });
	if (mapa.size) cambiar(() => reemplazar(mapa));
}

/** Vuelve cada imagen a su tamaño original (sin cambiar el centro ni el giro). */
export function tamanoOriginalSeleccion() {
	const mapa = new Map();
	for (const o of objetosSel()) {
		const r = E.doc.recursos?.[o.img];
		if (o.t === 'imagen' && r?.w && r?.h) mapa.set(o.id, { ...o, ancho: r.w, alto: r.h });
	}
	if (mapa.size) cambiar(() => reemplazar(mapa));
}

/** Mueve la selección con las flechas del teclado. */
function empujar(dx, dy) {
	const sel = objetosSel();
	if (!sel.length) return;
	cambiar(() => reemplazar(new Map(sel.map((o) => [o.id, mover(o, dx, dy)]))));
}

// ---------------------------------------------------------------------------------------------- copiar, cortar y pegar
// Se usan los eventos del navegador (copy, cut y paste) y no las teclas: así se puede pegar lo que haya en el portapapeles del
// sistema (una captura de pantalla, una imagen copiada de la web) y, al copiar objetos, el portapapeles lleva una marca que
// tapa lo que hubiera antes (si no, un Ctrl+V pegaría una imagen vieja en lugar de los objetos recién copiados).
const MARCA = 'Pizarrón de kumOS: objetos copiados';

function alCopiar(e, cortar) {
	if (escribiendo(e) || !E.sel.length) return;
	copiarSeleccion();
	e.clipboardData?.setData('text/plain', MARCA);
	e.preventDefault();
	if (cortar) borrarSeleccion();
	else emitir('aviso', E.sel.length === 1 ? 'Copiado' : `Copiados ${E.sel.length} objetos`);
}

async function alPegar(e) {
	if (escribiendo(e) || document.querySelector('dialog[open]')) return;
	e.preventDefault();
	const dt = e.clipboardData;
	const img = imagenDe(dt);
	if (img) {
		try {
			await insertarImagen(img);
		} catch (err) {
			emitir('aviso', err.message, 5000);
		}
		return;
	}
	const texto = dt?.getData('text/plain') ?? '';
	if ((texto === MARCA || !texto.trim()) && E.portapapeles.length) pegar();
	else if (texto.trim() && texto !== MARCA) {
		// texto de otro lado: queda como un cuadro de texto en el centro de lo que se ve
		const c = aPagina(cv.clientWidth / 2, cv.clientHeight / 2);
		const nuevo = base('texto', { x: c.x, y: c.y, s: texto.slice(0, 2000), tam: E.estilo.tam, cur: E.estilo.cur, c: E.estilo.c });
		cambiar(() => ponerObjetos([...pagina().objetos, nuevo]));
		seleccionar([nuevo.id]);
	}
}

// ---------------------------------------------------------------------------------------------- teclado
const escribiendo = (e) => {
	const t = e.target;
	return t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
};

export const ATAJOS = { p: 'lapiz', h: 'resaltador', e: 'borrador', v: 'seleccion', l: 'lazo', s: 'forma', t: 'texto', m: 'mano' };

function alTeclaAbajo(e) {
	if (e.key === 'Escape') {
		if (editor) {
			e.preventDefault();
			cerrarEditor(true);
			return;
		}
		if (gesto) cancelarGesto();
		else if (E.sel.length) seleccionar([]);
		return;
	}
	if (escribiendo(e) || document.querySelector('dialog[open]')) return;
	const ctrl = e.ctrlKey || e.metaKey;
	if (e.code === 'Space' && !espacio) {
		espacio = true;
		actualizarCursor();
		e.preventDefault();
		return;
	}
	if (ctrl) {
		const k = e.key.toLowerCase();
		if (k === 'z') {
			e.preventDefault();
			if (e.shiftKey) rehacer();
			else deshacer();
		} else if (k === 'y') {
			e.preventDefault();
			rehacer();
		} else if (k === 'a') {
			e.preventDefault();
			seleccionarTodo();
		} else if (k === 'd') {
			e.preventDefault();
			duplicarSeleccion();
		} else if (k === 's') {
			e.preventDefault();
			emitir('guardar');
		}
		return;
	}
	if (e.key === 'Delete' || e.key === 'Backspace') {
		if (E.sel.length) {
			e.preventDefault();
			borrarSeleccion();
		}
		return;
	}
	if (e.key.startsWith('Arrow') && E.sel.length) {
		e.preventDefault();
		const d = e.shiftKey ? 10 : 1;
		empujar(e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0);
		return;
	}
	if (e.key === '+' || e.key === '=') zoomEn(E.vista.z * 1.1);
	else if (e.key === '-') zoomEn(E.vista.z / 1.1);
	else if (e.key === 'PageDown') emitir('pagina-sig');
	else if (e.key === 'PageUp') emitir('pagina-ant');
	else if (ATAJOS[e.key.toLowerCase()]) usarHerramienta(ATAJOS[e.key.toLowerCase()]);
}

function alTeclaArriba(e) {
	if (e.code === 'Space') {
		espacio = false;
		actualizarCursor();
	}
}

// ---------------------------------------------------------------------------------------------- arranque
export function iniciarDibujo(canvasVivo) {
	cv = canvasVivo;
	cv.style.touchAction = 'none';
	cv.tabIndex = -1; // puede recibir el foco (pero no se llega con Tab)
	cv.style.outline = 'none';
	cv.addEventListener('pointerdown', alBajar);
	cv.addEventListener('pointermove', alMover);
	cv.addEventListener('pointerup', alSoltar);
	cv.addEventListener('pointercancel', alSoltar);
	cv.addEventListener('pointerleave', () => {
		if (!gesto) {
			cursor = null;
			pedirVivo();
		}
	});
	cv.addEventListener('wheel', alRueda, { passive: false });
	// El botón del lápiz (clic derecho en Windows) no debe abrir el menú del navegador.
	window.addEventListener('contextmenu', (e) => e.preventDefault());
	document.addEventListener('keydown', alTeclaAbajo);
	document.addEventListener('copy', (e) => alCopiar(e, false));
	document.addEventListener('cut', (e) => alCopiar(e, true));
	document.addEventListener('paste', alPegar);
	document.addEventListener('keyup', alTeclaArriba);
	elEditor()?.addEventListener('input', ajustarEditor);
	elEditor()?.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			cerrarEditor(true);
		}
		e.stopPropagation();
		if (e.key === 'Escape') cerrarEditor(true);
	});
	elEditor()?.addEventListener('blur', () => cerrarEditor(true));
	pintorVivo(pintarVivo);
	en('herr', actualizarCursor);
	en('vista', ajustarEditor);
	en('sel', pedirVivo);
	en('doc', pedir);
	en('pagina', () => {
		cancelarGesto();
		cerrarEditor(true);
	});
	actualizarCursor();
}
