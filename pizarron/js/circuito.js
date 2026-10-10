// Reconocimiento de circuitos dibujados a mano. No toca el DOM: se prueba con Node.
//
// Se dibujan los símbolos de forma simple: resistencia = rectángulo alargado, capacitor = dos rayitas paralelas, inductor
// = bobina (ondas, jorobas o rulos; un zigzag también), tierra = triángulo chico, operacional = triángulo grande con un + y un −, fuente de tensión = círculo,
// y los cables son rayas. De ahí sale la lista de componentes, a qué punto (nodo) va cada pata y los avisos de lo que no se entendió.
// Luego asc.js lo convierte en un archivo de LTspice.
import { reconocer } from './formas.js';
import { dentroPoligono, dimTexto, distSegmento, simplificar } from './geometria.js';

const hip = Math.hypot;
const GRAD = 180 / Math.PI;
const mediana = (a) => {
	if (!a.length) return 0;
	const s = [...a].sort((x, y) => x - y);
	const m = s.length >> 1;
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const largoSeg = (s) => hip(s.b[0] - s.a[0], s.b[1] - s.a[1]);
const medio = (s) => [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2];
const angSeg = (s) => Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]) * GRAD;
/** Diferencia entre dos direcciones de rectas (0 a 90°). */
const difAng = (a, b) => {
	let d = Math.abs(a - b) % 180;
	if (d > 90) d = 180 - d;
	return d;
};

function cajaPts(p) {
	let x0 = Infinity;
	let y0 = Infinity;
	let x1 = -Infinity;
	let y1 = -Infinity;
	for (let i = 0; i < p.length; i += 2) {
		x0 = Math.min(x0, p[i]);
		x1 = Math.max(x1, p[i]);
		y0 = Math.min(y0, p[i + 1]);
		y1 = Math.max(y1, p[i + 1]);
	}
	return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}
function longitud(p) {
	let s = 0;
	for (let i = 2; i < p.length; i += 2) s += hip(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
	return s;
}
/** Desvío máximo de los puntos respecto de la cuerda (la recta del primero al último). */
function desvioCuerda(p) {
	let m = 0;
	for (let i = 2; i < p.length - 2; i += 2) m = Math.max(m, distSegmento(p[i], p[i + 1], p[0], p[1], p[p.length - 2], p[p.length - 1]));
	return m;
}

// ---------------------------------------------------------------------------------------------- primitivas
const rectDe = (x0, y0, x1, y1, de) => {
	const a = Math.min(x0, x1);
	const b = Math.min(y0, y1);
	const c = Math.max(x0, x1);
	const d = Math.max(y0, y1);
	return { tipo: 'rect', x0: a, y0: b, x1: c, y1: d, cx: (a + c) / 2, cy: (b + d) / 2, w: c - a, h: d - b, de };
};

/**
 * ¿Es una bobina? Una línea abierta casi recta de punta a punta que ondula: ondas, bumps o rulos. Se cuentan los máximos y mínimos
 * del desvío lateral respecto de la cuerda (con un umbral para no contar el temblor).
 */
export function esBobina(p) {
	const n = p.length / 2;
	if (n < 12) return null;
	const c = hip(p[p.length - 2] - p[0], p[p.length - 1] - p[1]);
	const L = longitud(p);
	if (c < 16 || L / c < 1.3) return null;
	const ux = (p[p.length - 2] - p[0]) / c;
	const uy = (p[p.length - 1] - p[1]) / c;
	const d = [];
	for (let i = 0; i < n; i++) d.push(-(p[2 * i] - p[0]) * uy + (p[2 * i + 1] - p[1]) * ux);
	const amp = Math.max(...d) - Math.min(...d);
	if (amp < 0.12 * c || amp > 1.1 * c) return null;
	// extremos con prominencia (una vez que el desvío baja o sube más de un tercio de la amplitud, se cuenta el extremo)
	const umbral = amp / 3;
	let extremos = 0;
	let dir = 0;
	let ref = d[0];
	for (let i = 1; i < n; i++) {
		if (dir >= 0 && d[i] < ref - umbral) {
			if (dir === 1) extremos++;
			dir = -1;
			ref = d[i];
		} else if (dir <= 0 && d[i] > ref + umbral) {
			if (dir === -1) extremos++;
			dir = 1;
			ref = d[i];
		} else if ((dir === 1 && d[i] > ref) || (dir === -1 && d[i] < ref) || dir === 0) {
			ref = dir === 0 ? ref : d[i];
		}
	}
	if (extremos < 3) return null;
	// ya se contaron los cambios de sentido; con 3 o más hay al menos 2 vueltas completas
	return { a: [p[0], p[1]], b: [p[p.length - 2], p[p.length - 1]], extremos, amplitud: amp, largo: c };
}

/** ¿Una poligonal abierta es un zigzag (5 o más tramos con giros que se alternan, casi nada horizontal ni vertical)? */
function esZigzag(v) {
	const k = v.length / 2;
	if (k < 6) return false;
	let signo = 0;
	let alternados = 0;
	let axiales = 0;
	for (let i = 0; i < k - 1; i++) {
		const a = Math.abs(Math.atan2(v[2 * i + 3] - v[2 * i + 1], v[2 * i + 2] - v[2 * i]) * GRAD);
		if (a < 10 || a > 170 || Math.abs(a - 90) < 10) axiales++;
	}
	for (let i = 1; i < k - 1; i++) {
		const ax = v[2 * i] - v[2 * i - 2];
		const ay = v[2 * i + 1] - v[2 * i - 1];
		const bx = v[2 * i + 2] - v[2 * i];
		const by = v[2 * i + 3] - v[2 * i + 1];
		const s = Math.sign(ax * by - ay * bx);
		if (s !== 0 && signo !== 0 && s !== signo) alternados++;
		if (s !== 0) signo = s;
	}
	// los dos tramos de los extremos pueden ser de cable (axiales); el resto debe ser diagonal
	return alternados >= k - 3 && axiales <= 3;
}

function cuadrilatero(v, de) {
	// ¿cuatro vértices con ángulos rectos y lados paralelos a los ejes? → rectángulo
	const xs = [v[0], v[2], v[4], v[6]];
	const ys = [v[1], v[3], v[5], v[7]];
	const c = cajaPts(v);
	const pegados = (a, b) => Math.abs(a - b) < 0.2 * Math.max(c.w, c.h);
	const ejes = xs.every((x) => pegados(x, c.x0) || pegados(x, c.x1)) && ys.every((y) => pegados(y, c.y0) || pegados(y, c.y1));
	return ejes ? rectDe(c.x0, c.y0, c.x1, c.y1, de) : null;
}

function agregarPoligonal(v, de, P) {
	// una línea quebrada de punta a punta (zigzag) se toma como inductor: las resistencias se dibujan como rectángulos
	if (esZigzag(v)) {
		P.bobinas.push({ tipo: 'bobina', forma: 'zigzag', a: [v[0], v[1]], b: [v[v.length - 2], v[v.length - 1]], largo: hip(v[v.length - 2] - v[0], v[v.length - 1] - v[1]), de });
		return;
	}
	for (let i = 0; i < v.length - 2; i += 2) {
		const s = { a: [v[i], v[i + 1]], b: [v[i + 2], v[i + 3]], de };
		if (largoSeg(s) > 1) P.segs.push(s);
	}
}

/**
 * Respaldo para un rectángulo que el corrector de formas no aceptó (los alargados con el cierre desprolijo): casi todos los
 * puntos tienen que estar sobre el borde de la caja que los contiene y los cuatro lados tienen que tener trazo.
 */
function pareceRect(p, c) {
	const corto = Math.min(c.w, c.h);
	if (corto < 6 || Math.max(c.w, c.h) < 14) return null;
	const tol = Math.max(3, 0.2 * corto);
	const lados = [0, 0, 0, 0];
	let sobre = 0;
	const n = p.length / 2;
	for (let i = 0; i < n; i++) {
		const x = p[2 * i];
		const y = p[2 * i + 1];
		const d = [Math.abs(y - c.y0), Math.abs(x - c.x1), Math.abs(y - c.y1), Math.abs(x - c.x0)];
		const m = Math.min(...d);
		if (m <= tol) {
			sobre++;
			lados[d.indexOf(m)]++;
		}
	}
	return sobre >= 0.93 * n && lados.every((k) => k >= 3) ? c : null;
}

function desdeTrazo(o, P) {
	const p = o.p;
	const c = cajaPts(p);
	const D = hip(c.w, c.h);
	const L = longitud(p);
	const de = [o.id];
	if (p.length < 4 || D < 9) {
		P.puntos.push({ x: c.cx, y: c.cy, de });
		return;
	}
	const cerrado = hip(p[p.length - 2] - p[0], p[p.length - 1] - p[1]) < 0.2 * L;
	if (!cerrado) {
		// una onda de punta a punta es una bobina (el corrector de formas la haría un zigzag)
		const b = esBobina(p);
		if (b) return void P.bobinas.push({ tipo: 'bobina', ...b, de });
	}
	const f = reconocer(p);
	if (f) {
		if (f.tipo === 'linea') return void P.segs.push({ a: [f.x1, f.y1], b: [f.x2, f.y2], de });
		if (f.tipo === 'rect') return void P.rects.push(rectDe(f.x, f.y, f.x + f.ancho, f.y + f.alto, de));
		if (f.tipo === 'elipse') {
			if (Math.abs(f.rx - f.ry) > 0.4 * Math.max(f.rx, f.ry)) return void P.ignorados.push({ de, motivo: 'una elipse (se esperaba un círculo para una fuente)' });
			if (f.rx < 7) return void P.puntos.push({ x: f.cx, y: f.cy, de });
			return void P.circs.push({ tipo: 'circ', cx: f.cx, cy: f.cy, r: (f.rx + f.ry) / 2, de });
		}
		if (f.tipo === 'poli') {
			if (f.cerrado) {
				if (f.p.length === 6) return void P.tris.push({ tipo: 'tri', v: f.p.slice(), de });
				if (f.p.length === 8) {
					const r = cuadrilatero(f.p, de);
					if (r) return void P.rects.push(r);
				}
				return void P.ignorados.push({ de, motivo: 'una figura cerrada que no es rectángulo, triángulo ni círculo' });
			}
			return void agregarPoligonal(f.p, de, P);
		}
	}
	// no lo reconoció el corrector de formas: rayitas cortas, bobinas, cables flojos…
	if (!cerrado) {
		const dev = desvioCuerda(p);
		const cuerda = hip(p[p.length - 2] - p[0], p[p.length - 1] - p[1]);
		if (dev <= 0.12 * cuerda + 1.5) return void P.segs.push({ a: [p[0], p[1]], b: [p[p.length - 2], p[p.length - 1]], de });
		const b = esBobina(p);
		if (b) return void P.bobinas.push({ tipo: 'bobina', ...b, de });
		const v = simplificar(p, Math.max(3, 0.05 * D));
		if (v.length / 2 <= 10) return void agregarPoligonal(v, de, P);
		return void P.ignorados.push({ de, motivo: 'un trazo que no se entiende (ni cable, ni bobina)' });
	}
	if (D < 16) return void P.puntos.push({ x: c.cx, y: c.cy, de });
	const r = pareceRect(p, c);
	if (r) return void P.rects.push(rectDe(r.x0, r.y0, r.x1, r.y1, de));
	P.ignorados.push({ de, motivo: 'una figura cerrada que no se reconoce' });
}

/** Pasa los objetos del pizarrón a primitivas geométricas: segmentos, rectángulos, triángulos, círculos, bobinas, textos y puntos. */
export function primitivas(objetos) {
	const P = { segs: [], rects: [], tris: [], circs: [], bobinas: [], textos: [], puntos: [], ignorados: [] };
	for (const o of objetos) {
		const de = [o.id];
		switch (o.t) {
			case 'linea':
				P.segs.push({ a: [o.x1, o.y1], b: [o.x2, o.y2], de });
				break;
			case 'rect':
				P.rects.push(rectDe(o.x, o.y, o.x + o.ancho, o.y + o.alto, de));
				break;
			case 'elipse':
				if (Math.abs(o.rx - o.ry) <= 0.4 * Math.max(o.rx, o.ry)) {
					if (o.rx < 7) P.puntos.push({ x: o.cx, y: o.cy, de });
					else P.circs.push({ tipo: 'circ', cx: o.cx, cy: o.cy, r: (o.rx + o.ry) / 2, de });
				} else P.ignorados.push({ de, motivo: 'una elipse' });
				break;
			case 'poli':
				if (o.cerrado) {
					if (o.p.length === 6) P.tris.push({ tipo: 'tri', v: o.p.slice(), de });
					else if (o.p.length === 8) {
						const r = cuadrilatero(o.p, de);
						if (r) P.rects.push(r);
						else P.ignorados.push({ de, motivo: 'un cuadrilátero que no es rectángulo' });
					} else P.ignorados.push({ de, motivo: 'un polígono' });
				} else agregarPoligonal(o.p, de, P);
				break;
			case 'texto': {
				const d = dimTexto(o);
				P.textos.push({ s: o.s, x0: o.x, y0: o.y, x1: o.x + d.ancho, y1: o.y + d.alto, cx: o.x + d.ancho / 2, cy: o.y + d.alto / 2, de });
				break;
			}
			case 'trazo':
				desdeTrazo(o, P);
				break;
			default:
				P.ignorados.push({ de, motivo: o.t === 'imagen' ? 'una imagen' : o.t === 'ejes' ? 'unos ejes' : 'un objeto que no es parte del circuito' });
		}
	}
	return P;
}

// ---------------------------------------------------------------------------------------------- símbolos
const tamanoTri = (t) => {
	const v = t.v;
	return Math.max(hip(v[2] - v[0], v[3] - v[1]), hip(v[4] - v[2], v[5] - v[3]), hip(v[0] - v[4], v[1] - v[5]));
};
const areaTri = (v) => Math.abs((v[2] - v[0]) * (v[5] - v[1]) - (v[4] - v[0]) * (v[3] - v[1])) / 2;
const centroTri = (v) => [(v[0] + v[2] + v[4]) / 3, (v[1] + v[3] + v[5]) / 3];

/** Distancia de un punto al contorno de un polígono (v = [x,y,…], cerrado). */
function distContorno(x, y, v) {
	let m = Infinity;
	const n = v.length / 2;
	for (let i = 0; i < n; i++) {
		const j = (i + 1) % n;
		m = Math.min(m, distSegmento(x, y, v[2 * i], v[2 * i + 1], v[2 * j], v[2 * j + 1]));
	}
	return m;
}

/** Marcas (+ y −) dentro de un triángulo: rayitas y textos adentro, agrupados. Devuelve [{ clase: '+' | '-', cx, cy, usados }]. */
function marcasEn(tri, segs, textos) {
	const inside = (x, y) => dentroPoligono(x, y, tri.v);
	const cb = cajaPts(tri.v);
	const lado = tri.v.length === 6 ? tamanoTri(tri) : Math.max(cb.w, cb.h) * 1.4;
	const rayas = [];
	segs.forEach((s, i) => {
		if (s.usado) return;
		const [mx, my] = medio(s);
		if (inside(s.a[0], s.a[1]) && inside(s.b[0], s.b[1]) && inside(mx, my) && largoSeg(s) <= 0.45 * lado) rayas.push(i);
	});
	const grupos = [];
	for (const i of rayas) {
		const s = segs[i];
		const g = grupos.find((gr) => gr.idx.some((j) => segs[j] && separacion(segs[j], s) <= 0.18 * lado));
		if (g) g.idx.push(i);
		else grupos.push({ idx: [i] });
	}
	const marcas = [];
	for (const g of grupos) {
		const ss = g.idx.map((i) => segs[i]);
		let cx = 0;
		let cy = 0;
		for (const s of ss) {
			const m = medio(s);
			cx += m[0];
			cy += m[1];
		}
		cx /= ss.length;
		cy /= ss.length;
		// un + son dos rayitas que se cruzan (casi perpendiculares); un − es una sola (o dos paralelas, que se tratan como una)
		let cruz = false;
		for (let i = 0; i < ss.length; i++) for (let j = i + 1; j < ss.length; j++) if (difAng(angSeg(ss[i]), angSeg(ss[j])) > 55) cruz = true;
		marcas.push({ clase: cruz ? '+' : '-', cx, cy, usados: g.idx });
	}
	// textos "+" y "−" también valen
	for (const t of textos) {
		const s = t.s.trim();
		if (!/^[+\-−–—]$/.test(s) || !inside(t.cx, t.cy) || t.usado) continue;
		marcas.push({ clase: s === '+' ? '+' : '-', cx: t.cx, cy: t.cy, texto: t });
	}
	return marcas;
}

/** Distancia mínima entre dos segmentos. */
function separacion(a, b) {
	return Math.min(distSegmento(a.a[0], a.a[1], b.a[0], b.a[1], b.b[0], b.b[1]), distSegmento(a.b[0], a.b[1], b.a[0], b.a[1], b.b[0], b.b[1]), distSegmento(b.a[0], b.a[1], a.a[0], a.a[1], a.b[0], a.b[1]), distSegmento(b.b[0], b.b[1], a.a[0], a.a[1], a.b[0], a.b[1]));
}

let contadorComp = 0;
const comp = (tipo, extra) => ({ id: ++contadorComp, tipo, ...extra });

/**
 * Busca los componentes entre las primitivas. Devuelve { comps, cables, avisos, ref, tol } donde `cables` son los segmentos que
 * quedaron sin usar. Cada componente trae sus patas ("terminales"): { nombre, p: [x,y] (punto dibujado), region } donde `region`
 * dice a qué distancia de un cable se considera conectada: { seg: [x1,y1,x2,y2] } o { pt: [x,y] } o { circ: [cx,cy,r] } o { poli: v }.
 */
export function detectar(P) {
	contadorComp = 0;
	const avisos = [];
	const comps = [];
	const segs = P.segs.map((s) => ({ ...s, usado: false }));
	const textos = P.textos.map((t) => ({ ...t, usado: false }));

	// tamaño de referencia: lo típico de un componente dibujado
	const medidas = [];
	for (const r of P.rects) if (Math.max(r.w, r.h) >= 1.5 * Math.min(r.w, r.h)) medidas.push(Math.max(r.w, r.h));
	for (const b of P.bobinas) medidas.push(b.largo);
	for (const c of P.circs) medidas.push(2 * c.r);
	for (const t of P.tris) medidas.push(tamanoTri(t) * 0.8);
	let ref = mediana(medidas);
	if (!ref) ref = mediana(segs.map(largoSeg)) * 0.8 || 60;
	const tol = Math.min(18, Math.max(7, 0.2 * ref));

	// ---- operacionales y tierras (triángulos)
	for (const t of P.tris) {
		const marcas = marcasEn(t, segs, textos);
		const grande = tamanoTri(t) > 1.35 * ref;
		if (marcas.length || (grande && areaTri(t.v) > 0.6 * ref * ref)) {
			const o = operacional(t, marcas, avisos);
			if (o) {
				for (const m of marcas) {
					for (const i of m.usados ?? []) segs[i].usado = true;
					if (m.texto) m.texto.usado = true;
				}
				comps.push(o);
				continue;
			}
		}
		const c = centroTri(t.v);
		comps.push(comp('gnd', { terminales: [{ nombre: 'g', p: c, region: { poli: t.v } }], caja: cajaPts(t.v), de: t.de }));
	}

	// ---- resistencias: rectángulos alargados
	for (const r of P.rects) {
		const largo = Math.max(r.w, r.h);
		const corto = Math.min(r.w, r.h);
		if (largo < 1.45 * corto) {
			avisos.push({ de: r.de, texto: 'Un rectángulo casi cuadrado no se usó (una resistencia es más alargada que ancha).' });
			continue;
		}
		const horiz = r.w >= r.h;
		const t0 = horiz ? { p: [r.x0, r.cy], seg: [r.x0, r.y0, r.x0, r.y1] } : { p: [r.cx, r.y0], seg: [r.x0, r.y0, r.x1, r.y0] };
		const t1 = horiz ? { p: [r.x1, r.cy], seg: [r.x1, r.y0, r.x1, r.y1] } : { p: [r.cx, r.y1], seg: [r.x0, r.y1, r.x1, r.y1] };
		comps.push(comp('res', { eje: horiz ? 'h' : 'v', terminales: [{ nombre: 'a', p: t0.p, region: { seg: t0.seg } }, { nombre: 'b', p: t1.p, region: { seg: t1.seg } }], caja: { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 }, de: r.de }));
	}

	// ---- inductores
	for (const b of P.bobinas) comps.push(parDePatas('ind', b, 'bobina'));
	if (P.bobinas.some((b) => b.forma === 'zigzag')) avisos.push({ de: P.bobinas.filter((b) => b.forma === 'zigzag').flatMap((b) => b.de), texto: 'Una línea en zigzag se tomó como inductor: las resistencias se dibujan como rectángulos.' });

	// ---- fuentes de tensión
	for (const c of P.circs) {
		if (2 * c.r < 0.45 * ref) {
			avisos.push({ de: c.de, texto: 'Un círculo muy chico no se usó como fuente.' });
			continue;
		}
		const caja = { x0: c.cx - c.r, y0: c.cy - c.r, x1: c.cx + c.r, y1: c.cy + c.r };
		// marcas + y − adentro del círculo (si las hay) dicen cuál pata es la positiva
		const poli = [];
		for (let k = 0; k < 16; k++) poli.push(c.cx + 0.92 * c.r * Math.cos((k * Math.PI) / 8), c.cy + 0.92 * c.r * Math.sin((k * Math.PI) / 8));
		const marcas = marcasEn({ v: poli }, segs, textos);
		for (const m of marcas) {
			for (const i of m.usados ?? []) segs[i].usado = true;
			if (m.texto) m.texto.usado = true;
		}
		comps.push(comp('voltage', { centro: [c.cx, c.cy], r: c.r, terminales: [], caja, de: c.de, porDetectar: true, marcas }));
	}

	// ---- capacitores: dos rayitas paralelas y cortas, con cables que llegan a cada una
	const libres = () => segs.filter((s) => !s.usado);
	const cand = libres().filter((s) => largoSeg(s) >= 8 && largoSeg(s) <= 2.4 * ref);
	const pares = [];
	for (let i = 0; i < cand.length; i++) {
		for (let j = i + 1; j < cand.length; j++) {
			const a = cand[i];
			const b = cand[j];
			const la = largoSeg(a);
			const lb = largoSeg(b);
			if (difAng(angSeg(a), angSeg(b)) > 18) continue;
			const r = Math.min(la, lb) / Math.max(la, lb);
			if (r < 0.5) continue;
			// ejes: dirección de la más larga; separación entre las rectas y solape a lo largo
			const largoMax = Math.max(la, lb);
			const ang = (angSeg(la >= lb ? a : b) / GRAD) | 0;
			void ang;
			const ref2 = la >= lb ? a : b;
			const ux = (ref2.b[0] - ref2.a[0]) / largoMax;
			const uy = (ref2.b[1] - ref2.a[1]) / largoMax;
			const ma = medio(a);
			const mb = medio(b);
			const sep = Math.abs(-(mb[0] - ma[0]) * uy + (mb[1] - ma[1]) * ux);
			const along = (s, k) => (s[k][0] - ma[0]) * ux + (s[k][1] - ma[1]) * uy;
			const a0 = Math.min(along(a, 'a'), along(a, 'b'));
			const a1 = Math.max(along(a, 'a'), along(a, 'b'));
			const b0 = Math.min(along(b, 'a'), along(b, 'b'));
			const b1 = Math.max(along(b, 'a'), along(b, 'b'));
			const solape = Math.min(a1, b1) - Math.max(a0, b0);
			if (solape < 0.6 * Math.min(la, lb)) continue;
			if (sep < 4 || sep > 0.75 * largoMax) continue;
			pares.push({ a, b, sep, largoMax, puntaje: sep / largoMax + Math.abs(1 - r) * 0.3 });
		}
	}
	pares.sort((x, y) => x.puntaje - y.puntaje);
	/**
	 * ¿Es una placa de capacitor? Por el medio le entra un cable (o una pata) y las puntas quedan libres: si en las puntas llega otro
	 * cable, es un cable más. `pareja` es la otra placa, que no cuenta.
	 */
	const conexos = (s, otros, pareja) => {
		const m = medio(s);
		const L = largoSeg(s);
		for (const q of [s.a, s.b]) {
			for (const o of otros) {
				if (o === s || o === pareja || o.usado) continue;
				// un cable que llega a la punta (más cerca de la punta que del medio) hace de esto un cable más
				for (const e of [o.a, o.b]) if (hip(e[0] - q[0], e[1] - q[1]) <= tol && hip(e[0] - q[0], e[1] - q[1]) < 0.7 * hip(e[0] - m[0], e[1] - m[1])) return false;
			}
			for (const c of comps) for (const t of c.terminales) if (regionDist(t.region, q[0], q[1]) <= tol * 0.5) return false;
		}
		for (const o of otros) {
			if (o === s || o === pareja || o.usado) continue;
			for (const q of [o.a, o.b]) if (distSegmento(q[0], q[1], s.a[0], s.a[1], s.b[0], s.b[1]) <= tol && hip(q[0] - m[0], q[1] - m[1]) <= 0.4 * L + tol) return true;
		}
		for (const c of comps) for (const t of c.terminales) if (regionDist(t.region, m[0], m[1]) <= tol + 0.3 * L) return true;
		return false;
	};
	for (const par of pares) {
		if (par.a.usado || par.b.usado) continue;
		if (!conexos(par.a, segs, par.b) || !conexos(par.b, segs, par.a)) continue;
		par.a.usado = par.b.usado = true;
		const ma = medio(par.a);
		const mb = medio(par.b);
		comps.push(
			comp('cap', {
				eje: Math.abs(mb[1] - ma[1]) > Math.abs(mb[0] - ma[0]) ? 'v' : 'h',
				terminales: [
					{ nombre: 'a', p: ma, region: { seg: [par.a.a[0], par.a.a[1], par.a.b[0], par.a.b[1]] } },
					{ nombre: 'b', p: mb, region: { seg: [par.b.a[0], par.b.a[1], par.b.b[0], par.b.b[1]] } },
				],
				caja: cajaDeSegs([par.a, par.b]),
				de: [...par.a.de, ...par.b.de],
			}),
		);
	}

	// ---- lo que quedó: cables
	const cables = segs.filter((s) => !s.usado && largoSeg(s) >= 3);
	const sueltos = segs.filter((s) => !s.usado && largoSeg(s) < 3).length;
	void sueltos;
	return { comps, cables, textos, puntos: P.puntos, ignorados: P.ignorados, avisos, ref, tol };
}

function cajaDeSegs(ss) {
	let x0 = Infinity;
	let y0 = Infinity;
	let x1 = -Infinity;
	let y1 = -Infinity;
	for (const s of ss)
		for (const q of [s.a, s.b]) {
			x0 = Math.min(x0, q[0]);
			x1 = Math.max(x1, q[0]);
			y0 = Math.min(y0, q[1]);
			y1 = Math.max(y1, q[1]);
		}
	return { x0, y0, x1, y1 };
}

/** Componente de dos patas que está dibujado como una sola línea (bobina o zigzag): las patas son los extremos. */
function parDePatas(tipo, f, forma) {
	const dx = f.b[0] - f.a[0];
	const dy = f.b[1] - f.a[1];
	const horiz = Math.abs(dx) >= Math.abs(dy);
	return comp(tipo, {
		forma,
		eje: horiz ? 'h' : 'v',
		terminales: [
			{ nombre: 'a', p: f.a, region: { pt: f.a } },
			{ nombre: 'b', p: f.b, region: { pt: f.b } },
		],
		caja: { x0: Math.min(f.a[0], f.b[0]), y0: Math.min(f.a[1], f.b[1]), x1: Math.max(f.a[0], f.b[0]), y1: Math.max(f.a[1], f.b[1]) },
		de: f.de,
	});
}

/**
 * Un triángulo grande es un operacional. La base es el lado más parecido a una vertical; el vértice de enfrente es la salida.
 * Las marcas + y − dicen cuál entrada es cuál (por altura). Solo se entienden los que apuntan a la derecha o a la izquierda.
 */
function operacional(t, marcas, avisos) {
	const v = t.v;
	// elegimos la base: el lado más vertical
	let mejor = null;
	for (let i = 0; i < 3; i++) {
		const j = (i + 1) % 3;
		const k = (i + 2) % 3;
		const dx = v[2 * j] - v[2 * i];
		const dy = v[2 * j + 1] - v[2 * i + 1];
		const vert = Math.abs(Math.abs(Math.atan2(dy, dx) * GRAD) - 90);
		if (!mejor || vert < mejor.vert) mejor = { i, j, k, vert };
	}
	if (mejor.vert > 35) {
		avisos.push({ de: t.de, texto: 'Un operacional que apunta hacia arriba o abajo no se entiende: dibujalo apuntando a la derecha o a la izquierda.' });
		return null;
	}
	const bx = (v[2 * mejor.i] + v[2 * mejor.j]) / 2;
	const by = (v[2 * mejor.i + 1] + v[2 * mejor.j + 1]) / 2;
	const ax = v[2 * mejor.k];
	const ay = v[2 * mejor.k + 1];
	const apuntaDerecha = ax > bx;
	const arriba = v[2 * mejor.i + 1] < v[2 * mejor.j + 1] ? [v[2 * mejor.i], v[2 * mejor.i + 1]] : [v[2 * mejor.j], v[2 * mejor.j + 1]];
	const abajo = v[2 * mejor.i + 1] < v[2 * mejor.j + 1] ? [v[2 * mejor.j], v[2 * mejor.j + 1]] : [v[2 * mejor.i], v[2 * mejor.i + 1]];
	let masArriba = false; // ¿el + está arriba?
	const mas = marcas.find((m) => m.clase === '+');
	const menos = marcas.find((m) => m.clase === '-');
	if (mas && menos) masArriba = mas.cy < menos.cy;
	else if (mas) masArriba = mas.cy < by;
	else if (menos) masArriba = menos.cy > by;
	else avisos.push({ de: t.de, texto: 'El operacional no tiene marcas + y −: se supuso el − arriba y el + abajo.' });
	if ((mas && !menos) || (!mas && menos)) avisos.push({ de: t.de, texto: 'Al operacional le falta una de las marcas (+ o −): se dedujo la otra.' });
	// patas: las entradas a la altura de cada marca sobre la base; la salida, en la punta
	const xb = (arriba[0] + abajo[0]) / 2;
	const altoBase = abajo[1] - arriba[1];
	const yMas = mas ? mas.cy : masArriba ? arriba[1] + 0.3 * altoBase : abajo[1] - 0.3 * altoBase;
	const yMenos = menos ? menos.cy : masArriba ? abajo[1] - 0.3 * altoBase : arriba[1] + 0.3 * altoBase;
	// cada entrada tiene su propia zona sobre la base (una rayita vertical centrada en su marca), para no mezclar los cables de + y de −
	const mitad = Math.max(6, 0.42 * Math.abs(yMas - yMenos));
	const zona = (y) => ({ seg: [xb, Math.max(arriba[1], y - mitad), xb, Math.min(abajo[1], y + mitad)] });
	return comp('opamp', {
		derecha: apuntaDerecha,
		masArriba,
		terminales: [
			{ nombre: 'in-', p: [xb, yMenos], region: zona(yMenos) },
			{ nombre: 'in+', p: [xb, yMas], region: zona(yMas) },
			{ nombre: 'out', p: [ax, ay], region: { pt: [ax, ay] } },
		],
		caja: cajaPts(v),
		de: t.de,
	});
}

// ---------------------------------------------------------------------------------------------- patas y regiones
/** Distancia de un punto a la región de una pata. */
export function regionDist(r, x, y) {
	if (r.seg) return distSegmento(x, y, r.seg[0], r.seg[1], r.seg[2], r.seg[3]);
	if (r.pt) return hip(x - r.pt[0], y - r.pt[1]);
	if (r.circ) return Math.abs(hip(x - r.circ[0], y - r.circ[1]) - r.circ[2]);
	if (r.poli) return distContorno(x, y, r.poli);
	return Infinity;
}

/** Punto de la región más cercano a (x, y). */
function puntoEnRegion(r, x, y) {
	if (r.seg) {
		const [x1, y1, x2, y2] = r.seg;
		const dx = x2 - x1;
		const dy = y2 - y1;
		const l2 = dx * dx + dy * dy;
		const t = l2 ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / l2)) : 0;
		return [x1 + t * dx, y1 + t * dy];
	}
	if (r.pt) return r.pt;
	if (r.circ) {
		const l = hip(x - r.circ[0], y - r.circ[1]) || 1;
		return [r.circ[0] + ((x - r.circ[0]) / l) * r.circ[2], r.circ[1] + ((y - r.circ[1]) / l) * r.circ[2]];
	}
	return [x, y];
}

// ---------------------------------------------------------------------------------------------- conexiones
/**
 * Arma el grafo de conexiones: nodos (puntos donde se juntan cables), aristas (cables) y a qué nodo llega cada pata.
 * Convenciones de un esquema dibujado: un cable que termina en el medio de otro se conecta (T); dos cables que se cruzan solo se
 * conectan si hay un puntito en el cruce.
 * Devuelve { nodos: [{ id, x, y }], aristas: [{ a, b }], uniones: [{ comp, pata, nodo }], redes: [{ nodos, patas, tierra, etiquetas }] }.
 */
export function conectar(det) {
	const { comps, tol } = det;
	let cables = det.cables.map((s) => ({ a: [...s.a], b: [...s.b], de: s.de }));
	const puntos = det.puntos;

	// ---- fuentes: las patas son donde llegan cables al contorno del círculo
	for (const c of comps) if (c.porDetectar) patasDeFuente(c, cables, tol, det.avisos);

	// ---- 1) puntos donde se parten los cables: T (extremo sobre el cuerpo de otro), cruces con puntito y patas apoyadas sobre un cable
	const cortes = cables.map(() => []);
	const sobre = (px, py, i) => {
		const s = cables[i];
		const l = hip(s.b[0] - s.a[0], s.b[1] - s.a[1]);
		if (l < 1e-6) return null;
		const t = ((px - s.a[0]) * (s.b[0] - s.a[0]) + (py - s.a[1]) * (s.b[1] - s.a[1])) / (l * l);
		const d = distSegmento(px, py, s.a[0], s.a[1], s.b[0], s.b[1]);
		const loDeLosExtremos = Math.min(hip(px - s.a[0], py - s.a[1]), hip(px - s.b[0], py - s.b[1]));
		if (d <= tol && loDeLosExtremos > tol) return [s.a[0] + t * (s.b[0] - s.a[0]), s.a[1] + t * (s.b[1] - s.a[1])];
		return null;
	};
	cables.forEach((s, i) => {
		for (const q of [s.a, s.b]) {
			for (let j = 0; j < cables.length; j++) {
				if (j === i) continue;
				const p = sobre(q[0], q[1], j);
				if (p) cortes[j].push(p);
			}
		}
	});
	// cruces
	for (let i = 0; i < cables.length; i++) {
		for (let j = i + 1; j < cables.length; j++) {
			const x = cruce(cables[i], cables[j]);
			if (!x) continue;
			const hayPunto = puntos.some((p) => hip(p.x - x[0], p.y - x[1]) <= 1.6 * tol);
			if (hayPunto) {
				cortes[i].push(x);
				cortes[j].push(x);
			}
		}
	}
	// patas apoyadas sobre el cuerpo de un cable (el cable pasa por la pata en vez de terminar en ella); de un triángulo (la tierra)
	// vale cualquiera de sus vértices o el medio de sus lados
	for (const c of comps) {
		for (const t of c.terminales) {
			let qs = [];
			if (t.region.poli) {
				const v = t.region.poli;
				const k = v.length / 2;
				for (let i = 0; i < k; i++) {
					const j = (i + 1) % k;
					const dx = v[2 * j] - v[2 * i];
					const dy = v[2 * j + 1] - v[2 * i + 1];
					qs.push([(v[2 * i] + v[2 * j]) / 2, (v[2 * i + 1] + v[2 * j + 1]) / 2]);
					// el lado horizontal o vertical (donde se apoya la tierra) cuenta también por sus puntas
					const ang = Math.abs(Math.atan2(dy, dx) * GRAD) % 90;
					if (Math.min(ang, 90 - ang) < 15) qs.push([v[2 * i], v[2 * i + 1]], [v[2 * j], v[2 * j + 1]]);
				}
			} else {
				const q = t.region.pt ?? (t.region.seg ? [(t.region.seg[0] + t.region.seg[2]) / 2, (t.region.seg[1] + t.region.seg[3]) / 2] : null);
				if (q) qs = [q];
			}
			for (const q of qs) {
				for (let j = 0; j < cables.length; j++) {
					const p = sobre(q[0], q[1], j);
					if (p) cortes[j].push(p);
				}
			}
		}
	}
	// partir los cables
	const piezas = [];
	cables.forEach((s, i) => {
		const pts = [[...s.a], ...cortes[i].sort((p, q) => hip(p[0] - s.a[0], p[1] - s.a[1]) - hip(q[0] - s.a[0], q[1] - s.a[1])), [...s.b]];
		for (let k = 0; k < pts.length - 1; k++) if (hip(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]) > 0.5) piezas.push({ a: pts[k], b: pts[k + 1], de: s.de });
	});

	// ---- 2) nodos: los extremos que están a menos de `tol` se juntan (con encadenamiento), salvo si van a patas distintas del mismo
	//         componente (los dos cables de un capacitor terminan a 10 px uno del otro y no son el mismo punto)
	const ext = [];
	piezas.forEach((s, i) => {
		ext.push({ p: s.a, pieza: i, lado: 'a' }, { p: s.b, pieza: i, lado: 'b' });
	});
	/** Para cada extremo, a qué pata de cada componente llega (la más cercana si alcanza a más de una). */
	const pataDe = ext.map((e) => {
		const m = new Map();
		for (const c of comps) {
			let mejor = null;
			for (const t of c.terminales) {
				const d = regionDist(t.region, e.p[0], e.p[1]);
				if (d <= tol * 1.15 && (!mejor || d < mejor.d)) mejor = { d, nombre: t.nombre };
			}
			if (mejor) m.set(c.id, mejor.nombre);
		}
		return m;
	});
	const grupoDe = ext.map((_, i) => i);
	const raiz = (i) => (grupoDe[i] === i ? i : (grupoDe[i] = raiz(grupoDe[i])));
	const patasDe = ext.map((_, i) => new Map([...pataDe[i]].map(([c, n]) => [c, new Set([n])])));
	const cercanos = [];
	for (let i = 0; i < ext.length; i++) for (let j = i + 1; j < ext.length; j++) {
		const d = hip(ext[i].p[0] - ext[j].p[0], ext[i].p[1] - ext[j].p[1]);
		if (d <= tol) cercanos.push([d, i, j]);
	}
	cercanos.sort((a, b) => a[0] - b[0]);
	for (const [, i, j] of cercanos) {
		const a = raiz(i);
		const b = raiz(j);
		if (a === b) continue;
		let choca = false;
		for (const [c, nombres] of patasDe[b]) {
			const otros = patasDe[a].get(c);
			if (otros && [...nombres, ...otros].some((x, _, v) => x !== v[0])) choca = true;
		}
		if (choca) continue;
		grupoDe[b] = a;
		for (const [c, nombres] of patasDe[b]) {
			if (!patasDe[a].has(c)) patasDe[a].set(c, new Set());
			for (const x of nombres) patasDe[a].get(c).add(x);
		}
	}
	const grupos = new Map();
	ext.forEach((e, i) => {
		const r = raiz(i);
		if (!grupos.has(r)) grupos.set(r, []);
		grupos.get(r).push(i);
	});
	const nodos = [];
	const nodoDe = new Array(ext.length);
	for (const [, idx] of grupos) {
		let x = 0;
		let y = 0;
		for (const i of idx) {
			x += ext[i].p[0];
			y += ext[i].p[1];
		}
		const nodo = { id: nodos.length, x: x / idx.length, y: y / idx.length, ext: idx };
		nodos.push(nodo);
		for (const i of idx) nodoDe[i] = nodo.id;
	}
	const aristas = [];
	piezas.forEach((s, i) => {
		const a = nodoDe[2 * i];
		const b = nodoDe[2 * i + 1];
		if (a !== b) aristas.push({ a, b, de: s.de });
	});

	// ---- 3) a qué nodo llega cada pata: la que le corresponde a alguno de los extremos del nodo
	const uniones = [];
	for (const c of comps) {
		for (const n of nodos) {
			const patas = new Set();
			for (const i of n.ext) {
				const nombre = pataDe[i].get(c.id);
				if (nombre) patas.add(nombre);
			}
			for (const pata of patas) uniones.push({ comp: c.id, pata, nodo: n.id });
		}
	}

	// ---- 4) patas que se tocan entre sí sin cable (una resistencia pegada a otra)
	const contactos = [];
	for (let i = 0; i < comps.length; i++) {
		for (let j = i + 1; j < comps.length; j++) {
			for (const a of comps[i].terminales) {
				for (const b of comps[j].terminales) {
					if (a.region.poli || b.region.poli || a.region.circ || b.region.circ) continue;
					if (hip(a.p[0] - b.p[0], a.p[1] - b.p[1]) <= 1.4 * tol || regionDist(a.region, b.p[0], b.p[1]) <= tol * 0.6 || regionDist(b.region, a.p[0], a.p[1]) <= tol * 0.6) contactos.push({ a: [comps[i].id, a.nombre], b: [comps[j].id, b.nombre] });
				}
			}
		}
	}
	// las tierras apoyadas sobre una pata también cuentan
	for (const g of comps.filter((c) => c.tipo === 'gnd')) {
		for (const c of comps) {
			if (c === g) continue;
			for (const t of c.terminales) if (regionDist(g.terminales[0].region, t.p[0], t.p[1]) <= tol) contactos.push({ a: [g.id, 'g'], b: [c.id, t.nombre] });
		}
	}

	// ---- 5) redes: nodos unidos por cables y por patas
	const idPata = (c, n) => `${c}:${n}`;
	const elementos = new Map(); // clave → índice
	const lista = [];
	const clave = (k) => {
		if (!elementos.has(k)) {
			elementos.set(k, lista.length);
			lista.push(k);
		}
		return elementos.get(k);
	};
	nodos.forEach((n) => clave(`n${n.id}`));
	for (const c of comps) for (const t of c.terminales) clave(idPata(c.id, t.nombre));
	const pad = lista.map((_, i) => i);
	const r2 = (i) => (pad[i] === i ? i : (pad[i] = r2(pad[i])));
	const une = (a, b) => (pad[r2(a)] = r2(b));
	for (const a of aristas) une(clave(`n${a.a}`), clave(`n${a.b}`));
	for (const u of uniones) une(clave(`n${u.nodo}`), clave(idPata(u.comp, u.pata)));
	for (const k of contactos) une(clave(idPata(...k.a)), clave(idPata(...k.b)));
	const redes = new Map();
	const red = (k) => {
		const r = r2(clave(k));
		if (!redes.has(r)) redes.set(r, { nodos: [], patas: [], tierra: false, etiquetas: [] });
		return redes.get(r);
	};
	nodos.forEach((n) => red(`n${n.id}`).nodos.push(n.id));
	for (const c of comps)
		for (const t of c.terminales) {
			const r = red(idPata(c.id, t.nombre));
			if (c.tipo === 'gnd') r.tierra = true;
			else r.patas.push({ comp: c.id, pata: t.nombre });
		}
	return { nodos, aristas, uniones, contactos, redes: [...redes.values()].filter((r) => r.patas.length || r.tierra || r.nodos.length), tol };
}

/** Punto donde se cruzan dos cables por adentro (o null). */
function cruce(a, b) {
	const x1 = a.a[0];
	const y1 = a.a[1];
	const x2 = a.b[0];
	const y2 = a.b[1];
	const x3 = b.a[0];
	const y3 = b.a[1];
	const x4 = b.b[0];
	const y4 = b.b[1];
	const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
	if (Math.abs(d) < 1e-9) return null;
	const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
	const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / d;
	if (t <= 0.08 || t >= 0.92 || u <= 0.08 || u >= 0.92) return null;
	return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
}

/** Las patas de una fuente (círculo): los dos lugares opuestos del contorno adonde llegan cables; el + está donde hay una marca. */
function patasDeFuente(c, cables, tol, avisos) {
	const [cx, cy] = c.centro;
	const cerca = [];
	for (const s of cables)
		for (const q of [s.a, s.b]) {
			const d = Math.abs(hip(q[0] - cx, q[1] - cy) - c.r);
			if (d <= tol * 1.4) cerca.push({ p: q, ang: Math.atan2(q[1] - cy, q[0] - cx) });
		}
	if (!cerca.length) {
		avisos.push({ de: c.de, texto: 'A una fuente (círculo) no le llegan cables.' });
		c.terminales = [];
		return;
	}
	// los dos más enfrentados
	let par = null;
	for (let i = 0; i < cerca.length; i++) for (let j = i + 1; j < cerca.length; j++) {
		const dif = Math.abs(Math.atan2(Math.sin(cerca[i].ang - cerca[j].ang), Math.cos(cerca[i].ang - cerca[j].ang)));
		if (!par || dif > par.dif) par = { i, j, dif };
	}
	let patas;
	if (par && par.dif > 2.2) patas = [cerca[par.i], cerca[par.j]];
	else {
		// una sola pata con cable: la otra queda en el lado opuesto, sin conectar
		const a = cerca[0];
		patas = [a, { p: [cx - (a.p[0] - cx), cy - (a.p[1] - cy)], ang: a.ang + Math.PI }];
		avisos.push({ de: c.de, texto: 'A una fuente solo le llega un cable: la otra pata queda sin conectar.' });
	}
	const vertical = Math.abs(Math.sin(patas[0].ang)) > Math.abs(Math.cos(patas[0].ang));
	c.eje = vertical ? 'v' : 'h';
	// la pata "a" es la de arriba (o la de la izquierda); el + se decide con una marca adentro o, si no hay, es la de arriba / izquierda
	patas.sort((p, q) => (vertical ? p.p[1] - q.p[1] : p.p[0] - q.p[0]));
	const mas = (c.marcas ?? []).find((m) => m.clase === '+');
	const menos = (c.marcas ?? []).find((m) => m.clase === '-');
	const pos = (m) => (vertical ? m.cy - cy : m.cx - cx);
	// masEnA: ¿el + está del lado de la pata "a" (arriba o izquierda)?
	c.masEnA = mas ? pos(mas) < 0 : menos ? pos(menos) > 0 : true;
	if (!mas && !menos) avisos.push({ de: c.de, texto: 'A una fuente le faltan las marcas + y −: se puso el + arriba (o a la izquierda).' });
	c.terminales = [
		{ nombre: 'a', p: patas[0].p, region: { pt: patas[0].p } },
		{ nombre: 'b', p: patas[1].p, region: { pt: patas[1].p } },
	];
	c.porDetectar = false;
}

export { puntoEnRegion };
