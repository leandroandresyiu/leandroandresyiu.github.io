// Reconocedor de formas: toma un trazo hecho a mano y, si parece una línea, un rectángulo, un círculo, un triángulo o
// una poligonal con esquinas (por ejemplo una onda cuadrada), devuelve la versión perfecta. No toca el DOM.
//
// Se usa cuando se deja el lápiz quieto unos segundos al terminar el dibujo (ver dibujo.js). Si no se reconoce nada,
// devuelve null y el trazo queda como está. Los umbrales son relativos al tamaño del dibujo, así que sirve igual para
// una figurita que para una que ocupa toda la hoja.
import { base, distSegmento, simplificar, simplificarIdx } from './geometria.js';

const RAD = 180 / Math.PI;
const hipot = Math.hypot;

/** Saca los puntos repetidos o casi pegados (menos de `min` px). */
function limpiar(p, min = 0.6) {
	const r = [];
	for (let i = 0; i < p.length; i += 2) {
		const n = r.length;
		if (!n || hipot(p[i] - r[n - 2], p[i + 1] - r[n - 1]) >= min) r.push(p[i], p[i + 1]);
	}
	return r;
}

const longitud = (p) => {
	let s = 0;
	for (let i = 2; i < p.length; i += 2) s += hipot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
	return s;
};

function caja(p) {
	const c = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
	for (let i = 0; i < p.length; i += 2) {
		c.x0 = Math.min(c.x0, p[i]);
		c.x1 = Math.max(c.x1, p[i]);
		c.y0 = Math.min(c.y0, p[i + 1]);
		c.y1 = Math.max(c.y1, p[i + 1]);
	}
	return c;
}

/** n puntos a la misma distancia a lo largo de la línea (para no darle más peso a donde el lápiz fue más despacio). */
function remuestrear(p, n) {
	const total = longitud(p);
	if (!total) return p.slice();
	const paso = total / n;
	const r = [p[0], p[1]];
	let acum = 0;
	let falta = paso;
	for (let i = 2; i < p.length; i += 2) {
		let x0 = p[i - 2];
		let y0 = p[i - 1];
		const x1 = p[i];
		const y1 = p[i + 1];
		let seg = hipot(x1 - x0, y1 - y0);
		while (seg >= falta && r.length < n * 2) {
			const t = falta / seg;
			x0 += (x1 - x0) * t;
			y0 += (y1 - y0) * t;
			r.push(x0, y0);
			seg = hipot(x1 - x0, y1 - y0);
			acum += falta;
			falta = paso;
		}
		falta -= seg;
	}
	return r;
}

/** Ángulo de giro (en grados, 0 a 180) en el vértice j de una poligonal. */
function giro(v, i, j, k) {
	const ax = v[j] - v[i];
	const ay = v[j + 1] - v[i + 1];
	const bx = v[k] - v[j];
	const by = v[k + 1] - v[j + 1];
	const la = hipot(ax, ay);
	const lb = hipot(bx, by);
	if (!la || !lb) return 0;
	return Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)))) * RAD;
}

/** Une los grupos de números parecidos (dentro de `tol`) y devuelve, para cada valor, el promedio de su grupo. */
function agrupar(valores, tol) {
	const orden = valores.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
	const salida = new Array(valores.length);
	let grupo = [];
	const cerrar = () => {
		if (!grupo.length) return;
		const m = grupo.reduce((s, g) => s + g[0], 0) / grupo.length;
		for (const g of grupo) salida[g[1]] = m;
		grupo = [];
	};
	for (const par of orden) {
		if (grupo.length && par[0] - grupo[grupo.length - 1][0] > tol) cerrar();
		grupo.push(par);
	}
	cerrar();
	return salida;
}

/**
 * Pone horizontales y verticales los lados que casi lo son (a menos de `tolGrados`) y hace que todos los lados
 * horizontales parecidos queden a la misma altura (y los verticales, en la misma columna). Sirve para ondas cuadradas.
 * `v` es la lista de vértices [x,y,…]; devuelve otra.
 */
function ortogonalizar(v, cerrado, tolGrados, tolPx) {
	const k = v.length / 2;
	const lados = [];
	for (let i = 0; i < (cerrado ? k : k - 1); i++) {
		const j = (i + 1) % k;
		const a = Math.abs(Math.atan2(v[2 * j + 1] - v[2 * i + 1], v[2 * j] - v[2 * i]) * RAD);
		if (a < tolGrados || a > 180 - tolGrados) lados.push({ i, j, h: true });
		else if (Math.abs(a - 90) < tolGrados) lados.push({ i, j, h: false });
	}
	const out = v.slice();
	for (const horiz of [true, false]) {
		const ls = lados.filter((l) => l.h === horiz);
		if (!ls.length) continue;
		const nivel = agrupar(
			ls.map((l) => (horiz ? (v[2 * l.i + 1] + v[2 * l.j + 1]) / 2 : (v[2 * l.i] + v[2 * l.j]) / 2)),
			tolPx,
		);
		ls.forEach((l, n) => {
			const d = horiz ? 1 : 0;
			out[2 * l.i + d] = nivel[n];
			out[2 * l.j + d] = nivel[n];
		});
	}
	return out;
}

/** Endereza una línea que casi es horizontal, vertical o de 45° girándola alrededor de su centro. */
function enderezarLinea(x1, y1, x2, y2) {
	const dx = x2 - x1;
	const dy = y2 - y1;
	const len = hipot(dx, dy);
	let ang = Math.atan2(dy, dx) * RAD;
	const cercano = Math.round(ang / 45) * 45;
	const tol = cercano % 90 === 0 ? 5 : 3;
	if (Math.abs(ang - cercano) <= tol) ang = cercano;
	else return { x1, y1, x2, y2 };
	const mx = (x1 + x2) / 2;
	const my = (y1 + y2) / 2;
	const a = ang / RAD;
	return { x1: mx - (len / 2) * Math.cos(a), y1: my - (len / 2) * Math.sin(a), x2: mx + (len / 2) * Math.cos(a), y2: my + (len / 2) * Math.sin(a) };
}

/**
 * ¿Los lados de la poligonal `v` son rectos de verdad? Cada punto del trazo original se asigna al lado más cercano y se
 * mira cuánto se aparta: una onda senoidal o una "D" tienen lados panzudos y no pasan; un lado dibujado con pulso firme sí.
 */
function ladosRectos(p, v, cerrado, rel, abs) {
	const k = v.length / 2;
	const nl = cerrado ? k : k - 1;
	const desvio = new Array(nl).fill(0);
	for (let i = 0; i < p.length; i += 2) {
		let mejor = Infinity;
		let cual = 0;
		for (let s = 0; s < nl; s++) {
			const j = (s + 1) % k;
			const d = distSegmento(p[i], p[i + 1], v[2 * s], v[2 * s + 1], v[2 * j], v[2 * j + 1]);
			if (d < mejor) {
				mejor = d;
				cual = s;
			}
		}
		desvio[cual] = Math.max(desvio[cual], mejor);
	}
	for (let s = 0; s < nl; s++) {
		const j = (s + 1) % k;
		if (desvio[s] > rel * hipot(v[2 * j] - v[2 * s], v[2 * j + 1] - v[2 * s + 1]) + abs) return false;
	}
	return true;
}

/**
 * ¿Las esquinas de la poligonal son esquinas de verdad? En cada vértice se compara cuánto gira la línea entre los dos
 * lados (giro global) con cuánto gira en una ventanita alrededor del vértice sobre el trazo original (giro local).
 * En una esquina el giro entero ocurre ahí mismo; en una curva (una onda senoidal) está repartido y el local es mucho menor.
 */
function esquinasAfiladas(p, idx) {
	const n = p.length / 2;
	for (let m = 1; m < idx.length - 1; m++) {
		const i = idx[m];
		const vx = p[2 * i];
		const vy = p[2 * i + 1];
		const ant = idx[m - 1];
		const sig = idx[m + 1];
		const lado = Math.min(hipot(vx - p[2 * ant], vy - p[2 * ant + 1]), hipot(p[2 * sig] - vx, p[2 * sig + 1] - vy));
		const s = Math.max(4, Math.min(10, 0.08 * lado));
		const caminar = (paso) => {
			let acum = 0;
			let k = i;
			let x = vx;
			let y = vy;
			while (k + paso >= 0 && k + paso < n && acum < s) {
				k += paso;
				acum += hipot(p[2 * k] - x, p[2 * k + 1] - y);
				x = p[2 * k];
				y = p[2 * k + 1];
			}
			return [x, y];
		};
		const [ax, ay] = caminar(-1);
		const [bx, by] = caminar(1);
		const local = giro([ax, ay, vx, vy, bx, by], 0, 2, 4);
		const global = giro(p, 2 * ant, 2 * i, 2 * sig);
		if (local < 0.55 * global) return false;
	}
	return true;
}

// ---------------------------------------------------------------------------------------------- abiertas
function reconocerAbierta(p, L, D, d0) {
	let desvio = 0;
	for (let i = 2; i < p.length - 2; i += 2) desvio = Math.max(desvio, distSegmento(p[i], p[i + 1], p[0], p[1], p[p.length - 2], p[p.length - 1]));
	if (d0 >= 20 && desvio <= 0.06 * d0 + 1.5 && L <= 1.3 * d0) {
		return { tipo: 'linea', nombre: 'Línea', ...enderezarLinea(p[0], p[1], p[p.length - 2], p[p.length - 1]) };
	}
	// Poligonal con esquinas bien marcadas (onda cuadrada, escalón, zigzag, "L"…). Una curva da giros suaves: no entra.
	let idx = simplificarIdx(p, Math.max(0.045 * D, 3));
	const punto = (i) => [p[2 * i], p[2 * i + 1]];
	// Rabitos del final (el pulso al levantar el lápiz): se descartan.
	for (let vuelta = 0; vuelta < 2; vuelta++) {
		if (idx.length > 3) {
			const [a, b] = [punto(idx[0]), punto(idx[1])];
			if (hipot(b[0] - a[0], b[1] - a[1]) < 0.06 * L) idx = idx.slice(1);
		}
		if (idx.length > 3) {
			const [a, b] = [punto(idx[idx.length - 2]), punto(idx[idx.length - 1])];
			if (hipot(b[0] - a[0], b[1] - a[1]) < 0.06 * L) idx = idx.slice(0, -1);
		}
	}
	const v = [];
	for (const i of idx) v.push(p[2 * i], p[2 * i + 1]);
	const k = v.length / 2;
	if (k < 3 || k > 14) return null;
	for (let i = 1; i < k - 1; i++) {
		const g = giro(v, 2 * (i - 1), 2 * i, 2 * (i + 1));
		if (g < 50 || g > 172) return null;
	}
	for (let i = 0; i < k - 1; i++) if (hipot(v[2 * i + 2] - v[2 * i], v[2 * i + 3] - v[2 * i + 1]) < 0.06 * L) return null;
	if (!ladosRectos(p, v, false, 0.08, 2) || !esquinasAfiladas(p, idx)) return null;
	const w = ortogonalizar(v, false, 10, 0.05 * D);
	return { tipo: 'poli', nombre: k === 3 ? 'Ángulo' : 'Poligonal', p: w, cerrado: false };
}

// ---------------------------------------------------------------------------------------------- cerradas
function reconocerElipse(p, c) {
	const w = c.x1 - c.x0;
	const h = c.y1 - c.y0;
	if (w < 14 || h < 14) return null;
	const cx = (c.x0 + c.x1) / 2;
	const cy = (c.y0 + c.y1) / 2;
	const rx = w / 2;
	const ry = h / 2;
	const q = remuestrear(p, 64);
	let suma = 0;
	let max = 0;
	const n = q.length / 2;
	for (let i = 0; i < q.length; i += 2) {
		const r = hipot((q[i] - cx) / rx, (q[i + 1] - cy) / ry);
		const e = Math.abs(r - 1);
		suma += e;
		max = Math.max(max, e);
	}
	if (suma / n > 0.09 || max > 0.3) return null;
	if (Math.abs(rx - ry) < 0.12 * Math.max(rx, ry)) {
		const r = (rx + ry) / 2;
		return { tipo: 'elipse', nombre: 'Círculo', cx, cy, rx: r, ry: r };
	}
	return { tipo: 'elipse', nombre: 'Elipse', cx, cy, rx, ry };
}

/** Vértices de un dibujo cerrado: [x,y,…] sin repetir el primero al final. */
function vertices(p, D) {
	// Se arranca de dos puntos opuestos para que el punto donde empezó el trazo no cuente como esquina.
	const n = p.length / 2;
	let lejos = 0;
	let mejor = 0;
	for (let i = 1; i < n; i++) {
		const d = hipot(p[2 * i] - p[0], p[2 * i + 1] - p[1]);
		if (d > lejos) {
			lejos = d;
			mejor = i;
		}
	}
	if (mejor === 0) return null;
	const eps = Math.max(0.05 * D, 3);
	const a = simplificar(p.slice(0, 2 * mejor + 2), eps);
	const b = simplificar(p.slice(2 * mejor).concat([p[0], p[1]]), eps);
	let v = a.concat(b.slice(2));
	// el último punto vuelve al primero
	if (v.length > 4 && hipot(v[v.length - 2] - v[0], v[v.length - 1] - v[1]) < 1e-6) v = v.slice(0, -2);
	// Vértices casi alineados (giro menor a 20°) o pegados a otro: no son esquinas.
	for (let vuelta = 0; vuelta < 12; vuelta++) {
		const k = v.length / 2;
		if (k <= 3) break;
		let peor = -1;
		let menor = Infinity;
		for (let i = 0; i < k; i++) {
			const ia = ((i + k - 1) % k) * 2;
			const ic = ((i + 1) % k) * 2;
			const g = giro(v, ia, 2 * i, ic);
			const cerca = Math.min(hipot(v[2 * i] - v[ia], v[2 * i + 1] - v[ia + 1]), hipot(v[2 * i] - v[ic], v[2 * i + 1] - v[ic + 1]));
			const puntaje = cerca < 0.1 * D ? cerca - 1e6 : g;
			if (puntaje < menor && (g < 25 || cerca < 0.1 * D)) {
				menor = puntaje;
				peor = i;
			}
		}
		if (peor < 0) break;
		v.splice(2 * peor, 2);
	}
	return v;
}

const angulosInteriores = (v) => {
	const k = v.length / 2;
	const r = [];
	for (let i = 0; i < k; i++) r.push(180 - giro(v, ((i + k - 1) % k) * 2, 2 * i, ((i + 1) % k) * 2));
	return r;
};

function reconocerCuadrilatero(v, D) {
	const ang = angulosInteriores(v);
	const lado = (i) => hipot(v[((i + 1) % 4) * 2] - v[2 * i], v[((i + 1) % 4) * 2 + 1] - v[2 * i + 1]);
	const rectangular = ang.every((a) => Math.abs(a - 90) <= 22) && Math.min(lado(0), lado(2)) / Math.max(lado(0), lado(2)) > 0.7 && Math.min(lado(1), lado(3)) / Math.max(lado(1), lado(3)) > 0.7;
	if (!rectangular) {
		const w = ortogonalizar(v, true, 10, 0.05 * D);
		return { tipo: 'poli', nombre: 'Cuadrilátero', p: w, cerrado: true };
	}
	// Orientación: promedio circular de las direcciones de los lados plegadas a un cuarto de vuelta.
	let sx = 0;
	let sy = 0;
	for (let i = 0; i < 4; i++) {
		const j = (i + 1) % 4;
		const f = Math.atan2(v[2 * j + 1] - v[2 * i + 1], v[2 * j] - v[2 * i]) * 4;
		const peso = lado(i);
		sx += peso * Math.cos(f);
		sy += peso * Math.sin(f);
	}
	const theta = Math.atan2(sy, sx) / 4; // en (-45°, 45°]
	const cx = (v[0] + v[2] + v[4] + v[6]) / 4;
	const cy = (v[1] + v[3] + v[5] + v[7]) / 4;
	const u = [Math.cos(theta), Math.sin(theta)];
	const w = [-Math.sin(theta), Math.cos(theta)];
	let u0 = Infinity;
	let u1 = -Infinity;
	let w0 = Infinity;
	let w1 = -Infinity;
	for (let i = 0; i < 8; i += 2) {
		const du = (v[i] - cx) * u[0] + (v[i + 1] - cy) * u[1];
		const dw = (v[i] - cx) * w[0] + (v[i + 1] - cy) * w[1];
		u0 = Math.min(u0, du);
		u1 = Math.max(u1, du);
		w0 = Math.min(w0, dw);
		w1 = Math.max(w1, dw);
	}
	let ancho = u1 - u0;
	let alto = w1 - w0;
	const cuadrado = Math.abs(ancho - alto) < 0.12 * Math.max(ancho, alto);
	if (cuadrado) ancho = alto = (ancho + alto) / 2;
	const mu = (u0 + u1) / 2;
	const mw = (w0 + w1) / 2;
	const ccx = cx + mu * u[0] + mw * w[0];
	const ccy = cy + mu * u[1] + mw * w[1];
	if (Math.abs(theta * RAD) < 8) {
		return { tipo: 'rect', nombre: cuadrado ? 'Cuadrado' : 'Rectángulo', x: ccx - ancho / 2, y: ccy - alto / 2, ancho, alto };
	}
	const esquinas = [
		[-ancho / 2, -alto / 2],
		[ancho / 2, -alto / 2],
		[ancho / 2, alto / 2],
		[-ancho / 2, alto / 2],
	];
	const p = [];
	for (const [a, b] of esquinas) p.push(ccx + a * u[0] + b * w[0], ccy + a * u[1] + b * w[1]);
	const rombo = Math.abs(Math.abs(theta * RAD) - 45) < 8 && cuadrado;
	return { tipo: 'poli', nombre: rombo ? 'Rombo' : cuadrado ? 'Cuadrado girado' : 'Rectángulo girado', p, cerrado: true };
}

function reconocerCerrada(p, D, c) {
	const e = reconocerElipse(p, c);
	if (e) return e;
	const v = vertices(p, D);
	if (!v) return null;
	const k = v.length / 2;
	if ((k === 3 || k === 4) && !ladosRectos(p, v, true, 0.07, 2)) return null;
	if (k === 3) {
		const area = Math.abs((v[2] - v[0]) * (v[5] - v[1]) - (v[4] - v[0]) * (v[3] - v[1])) / 2;
		if (area < 0.02 * D * D) return null;
		return { tipo: 'poli', nombre: 'Triángulo', p: ortogonalizar(v, true, 10, 0.05 * D), cerrado: true };
	}
	if (k === 4) return reconocerCuadrilatero(v, D);
	return null;
}

/**
 * Reconoce la forma de un trazo (puntos [x,y,…]). Devuelve { tipo, nombre, … } o null.
 *  - { tipo: 'linea', x1, y1, x2, y2 }
 *  - { tipo: 'rect', x, y, ancho, alto }
 *  - { tipo: 'elipse', cx, cy, rx, ry }
 *  - { tipo: 'poli', p, cerrado }
 */
export function reconocer(puntos) {
	const p = limpiar(puntos);
	if (p.length < 4) return null;
	const L = longitud(p);
	const c = caja(p);
	const D = hipot(c.x1 - c.x0, c.y1 - c.y0);
	if (L < 24 || D < 16) return null;
	const d0 = hipot(p[p.length - 2] - p[0], p[p.length - 1] - p[1]);
	return d0 < 0.2 * L ? reconocerCerrada(p, D, c) : reconocerAbierta(p, L, D, d0);
}

/** Convierte lo que devolvió `reconocer` en un objeto del documento, con el color, grosor y estilo del trazo original. */
export function objetoDeForma(f, trazo) {
	const est = { c: trazo.c, g: trazo.g, e: trazo.e, op: trazo.op };
	switch (f.tipo) {
		case 'linea':
			return base('linea', { ...est, x1: f.x1, y1: f.y1, x2: f.x2, y2: f.y2, fi: 0, ff: 0 });
		case 'rect':
			return base('rect', { ...est, x: f.x, y: f.y, ancho: f.ancho, alto: f.alto, r: null });
		case 'elipse':
			return base('elipse', { ...est, cx: f.cx, cy: f.cy, rx: f.rx, ry: f.ry, r: null });
		default:
			return base('poli', { ...est, p: f.p, cerrado: f.cerrado, r: null });
	}
}
