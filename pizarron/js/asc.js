// Del circuito reconocido (circuito.js) al archivo .asc de LTspice, y de ahí a sumarlo a un esquema que ya existe.
// No toca el DOM: se prueba con Node (kumOS-diseno/pizarron-circuito-pruebas.mjs).
//
// Lo que se sabe de LTspice (de los archivos .asy de sus símbolos):
//  - Las patas están sobre una grilla de 16: res (16,16)-(16,96), cap (16,0)-(16,64), ind (16,16)-(16,96),
//    voltage (0,16)[+]-(0,96)[−] y el operacional OpAmps\opamp: invin (−32,48), noninvin (−32,80), out (32,64) (necesita ".lib opamp.sub").
//  - Giros: R90 lleva (x, y) a (−y, x), R180 a (−x, −y), R270 a (y, −x); M0 espeja la x y M180 espeja la y (así los lee Spice2PDF).
//  - Un cable conecta por sus extremos (y con lo que cae justo sobre él); dos cables que se cruzan, no.
//    Todas las banderas "0" son la misma tierra y las banderas con el mismo nombre son la misma red.
// Antes de dar el .asc por bueno se lo vuelve a leer y se comprueba que cada pata quede en la misma red que en el dibujo.
import { distSegmento } from './geometria.js';
import { conectar, detectar, primitivas } from './circuito.js';

const hip = Math.hypot;
const G = 16; // grilla de LTspice

// ---------------------------------------------------------------------------------------------- símbolos
/** Patas de cada símbolo sin girar. Voltage: la primera es el +. Operacional: entrada −, entrada +, salida. */
export const SIMBOLOS = {
	res: { simbolo: 'res', pines: [[16, 16], [16, 96]], prefijo: 'R', valor: '1k' },
	cap: { simbolo: 'cap', pines: [[16, 0], [16, 64]], prefijo: 'C', valor: '1u' },
	ind: { simbolo: 'ind', pines: [[16, 16], [16, 96]], prefijo: 'L', valor: '1m' },
	voltage: { simbolo: 'voltage', pines: [[0, 16], [0, 96]], prefijo: 'V', valor: '5' },
	opamp: { simbolo: 'OpAmps\\\\opamp', pines: [[-32, 48], [-32, 80], [32, 64]], prefijo: 'U', valor: null },
};
const claveSimbolo = (s) => String(s).replace(/\\+/g, '/').toLowerCase();
const PATAS_OPAMP = ['in-', 'in+', 'out'];

/** Giro o espejo de un punto respecto del origen del símbolo. */
export function girar(rot, x, y) {
	switch (rot) {
		case 'R0':
			return [x, y];
		case 'R90':
			return [-y, x];
		case 'R180':
			return [-x, -y];
		case 'R270':
			return [y, -x];
		case 'M0':
			return [-x, y];
		case 'M180':
			return [x, -y];
		default:
			throw new Error(`giro no soportado: ${rot}`);
	}
}

// ---------------------------------------------------------------------------------------------- valores
function prefijoDe(s) {
	if (s.toLowerCase() === 'meg' || s === 'M') return 'Meg';
	switch (s) {
		case 'm':
			return 'm';
		case 'k':
		case 'K':
			return 'k';
		case 'u':
		case 'µ':
		case 'μ':
			return 'u';
		case 'n':
		case 'p':
		case 'f':
		case 'G':
		case 'T':
			return s;
		default:
			return null;
	}
}
const TIPO_DE_UNIDAD = { 'Ω': 'res', ohm: 'res', ohms: 'res', F: 'cap', H: 'ind', V: 'voltage' };

/**
 * Lo que se escribió ("4,7kΩ", "100nF", "2M2", "1 uF", "5V") como valor de LTspice y la unidad si la tenía.
 * Ojo: en LTspice "M" es mili y "Meg" es mega; quien escribe "1M" en una resistencia piensa en mega, así que se lo pasa a "Meg".
 * Devuelve null si no parece un valor.
 */
export function analizarValor(texto) {
	let t = String(texto).trim().replace(/\s+/g, '').replace(/,/g, '.').replace(/[−–—]/g, '-');
	if (!t) return null;
	let unidad = null;
	const u = t.match(/^(.*?)(Hz|Ω|ohms?|[FHVA])$/);
	if (u && u[1]) {
		t = u[1];
		unidad = TIPO_DE_UNIDAD[u[2]] ?? null;
	}
	// 4k7, 2M2: el prefijo hace de coma
	let m = t.match(/^(\d+)(meg|[pnuµμmkKMGTf])(\d+)$/i);
	if (m) {
		const p = prefijoDe(m[2]);
		if (p) return { valor: `${m[1]}.${m[3]}${p}`, unidad };
	}
	m = t.match(/^([+-]?)(\d+\.?\d*|\.\d+)(e[+-]?\d+)?([A-Za-zµμ]*)$/);
	if (!m) return null;
	let num = m[2].replace(/\.$/, '');
	if (num.startsWith('.')) num = `0${num}`;
	num = `${m[1] === '-' ? '-' : ''}${num}${m[3] ?? ''}`;
	if (!m[4]) return { valor: num, unidad };
	const p = prefijoDe(m[4]);
	return p ? { valor: `${num}${p}`, unidad } : null;
}
export const valorLTspice = (texto) => analizarValor(texto)?.valor ?? null;

// ---------------------------------------------------------------------------------------------- textos del dibujo
const distCaja = (b, x, y) => hip(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.y0 - y, 0, y - b.y1));
const esNombre = (t) => /^[A-Za-z]{1,2}\d{1,4}$/.test(t);
const esIdent = (t) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(t);
const PIEZAS_CON_VALOR = ['res', 'cap', 'ind', 'voltage'];

/**
 * Reparte los textos del dibujo: nombres (R1) y valores (10k) a los componentes más cercanos, fuentes (SINE(0 1 1k)),
 * directivas (.tran 10m) y nombres de red (Vout) al cable más cercano.
 */
export function etiquetar(det, grafo, piezas) {
	for (const c of piezas) {
		c.nombre = null;
		c.valorEscrito = null;
	}
	const directivas = [];
	const sinUsar = [];
	const fichas = [];
	for (const t of det.textos) {
		if (t.usado) continue;
		const completo = t.s.trim().replace(/\s+/g, ' ');
		if (!completo) continue;
		if (/^\.[A-Za-z]/.test(completo)) {
			directivas.push(completo);
			continue;
		}
		if (/^(SINE|PULSE|PWL|EXP|SFFM|AC|DC)\b/i.test(completo)) {
			fichas.push({ t, tipo: 'fuente', texto: completo });
			continue;
		}
		for (const f of completo.split(/[\s=:;]+/).filter(Boolean)) {
			const v = analizarValor(f);
			if (esNombre(f) && !v) fichas.push({ t, tipo: 'nombre', texto: f, letra: f[0].toUpperCase() });
			else if (v) fichas.push({ t, tipo: 'valor', texto: f, valor: v.valor, unidad: v.unidad });
			// Rin, Rf, Cout: empiezan con la letra de un componente; si hay uno cerca, es su nombre y si no, el de una red
			else if (esIdent(f) && f.length <= 8 && 'RCLVU'.includes(f[0].toUpperCase())) fichas.push({ t, tipo: 'nombre', texto: f, letra: f[0].toUpperCase(), suave: true });
			else if (esIdent(f)) fichas.push({ t, tipo: 'red', texto: f });
			else sinUsar.push(f);
		}
	}
	// reparto uno a uno, de menor a mayor distancia
	const alcance = 0.9 * det.ref;
	const pares = [];
	fichas.forEach((f, i) => {
		for (const c of piezas) {
			if (f.tipo === 'nombre' && SIMBOLOS[c.tipo].prefijo !== f.letra) continue;
			if (f.tipo === 'valor' && (!PIEZAS_CON_VALOR.includes(c.tipo) || (f.unidad && f.unidad !== c.tipo))) continue;
			if (f.tipo === 'fuente' && c.tipo !== 'voltage') continue;
			if (f.tipo === 'red') continue;
			const d = distCaja(c.caja, f.t.cx, f.t.cy);
			if (d <= (f.suave ? 0.6 : 1) * alcance) pares.push({ i, c, d });
		}
	});
	pares.sort((a, b) => a.d - b.d);
	const usada = new Set();
	for (const { i, c } of pares) {
		const f = fichas[i];
		if (usada.has(i)) continue;
		if (f.tipo === 'nombre') {
			if (c.nombre) continue;
			c.nombre = f.texto[0].toUpperCase() + f.texto.slice(1);
		} else {
			if (c.valorEscrito) continue;
			c.valorEscrito = f.tipo === 'fuente' ? f.texto : f.valor;
		}
		usada.add(i);
	}
	// un nombre "suave" (Vin, Rout…) que no le tocó a ningún componente es el nombre de una red
	fichas.forEach((f, i) => {
		if (!usada.has(i) && f.suave) f.tipo = 'red';
		else if (!usada.has(i) && f.tipo !== 'red') sinUsar.push(f.texto);
	});

	// nombres de red: al cable (o nodo) más cercano
	const etiquetas = [];
	for (const f of fichas) {
		if (f.tipo !== 'red') continue;
		let mejor = null;
		for (const a of grafo.aristas) {
			const A = grafo.nodos[a.a];
			const B = grafo.nodos[a.b];
			const d = distSegmento(f.t.cx, f.t.cy, A.x, A.y, B.x, B.y);
			if (!mejor || d < mejor.d) mejor = { d, nodo: hip(f.t.cx - A.x, f.t.cy - A.y) <= hip(f.t.cx - B.x, f.t.cy - B.y) ? a.a : a.b };
		}
		for (const n of grafo.nodos) {
			const d = hip(f.t.cx - n.x, f.t.cy - n.y);
			if (!mejor || d < mejor.d) mejor = { d, nodo: n.id };
		}
		if (mejor && mejor.d <= 0.8 * det.ref) etiquetas.push({ nombre: /^gnd$/i.test(f.texto) ? '0' : f.texto, nodo: mejor.nodo });
		else sinUsar.push(f.texto);
	}
	return { etiquetas, directivas, sinUsar };
}

/** Nombres: los escritos en el dibujo si no se repiten y, si no, R1, R2… */
function numerar(piezas) {
	const usados = new Set();
	for (const c of piezas) {
		if (c.nombre && !usados.has(c.nombre.toUpperCase())) usados.add(c.nombre.toUpperCase());
		else c.nombre = null;
	}
	const cuenta = {};
	for (const c of piezas) {
		if (c.nombre) continue;
		const p = SIMBOLOS[c.tipo].prefijo;
		let k = cuenta[p] ?? 0;
		let nombre;
		do nombre = `${p}${++k}`;
		while (usados.has(nombre.toUpperCase()));
		cuenta[p] = k;
		usados.add(nombre.toUpperCase());
		c.nombre = nombre;
	}
}

// ---------------------------------------------------------------------------------------------- armado en la grilla
function agrupar(vals, tol) {
	// agrupa valores parecidos (la distancia entre vecinos ordenados es menor que `tol`) y da el promedio de cada grupo
	const orden = vals.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
	const out = new Array(vals.length);
	let grupo = [];
	const cerrar = () => {
		if (!grupo.length) return;
		const m = grupo.reduce((s, g) => s + g[0], 0) / grupo.length;
		for (const g of grupo) out[g[1]] = m;
		grupo = [];
	};
	for (const par of orden) {
		if (grupo.length && par[0] - grupo[grupo.length - 1][0] > tol) cerrar();
		grupo.push(par);
	}
	cerrar();
	return out;
}
const aGrilla = (v) => Math.round(v / G) * G;

/** Ruta en L entre dos puntos, empezando por el eje 'x' o 'y'. Devuelve segmentos [x1,y1,x2,y2]. */
function rutaL(a, b, primero) {
	if (a[0] === b[0] && a[1] === b[1]) return [];
	if (a[0] === b[0] || a[1] === b[1]) return [[a[0], a[1], b[0], b[1]]];
	const c = primero === 'x' ? [b[0], a[1]] : [a[0], b[1]];
	return [
		[a[0], a[1], c[0], c[1]],
		[c[0], c[1], b[0], b[1]],
	];
}

/**
 * Pone cada componente en la grilla de LTspice y tiende los cables. `escala` agranda el dibujo (los símbolos de LTspice tienen
 * tamaño fijo y las líneas del dibujo se separan lo que haga falta); `variante` cambia de qué lado van los codos de los cables; `modo` 'cables' une con cables y 'nombres' pone una
 * banderita con el nombre de la red en cada pata (siempre queda bien, aunque se lee peor).
 * Deja en cada componente: rot, origen, pinDe (pata del dibujo → pin del símbolo) y pines (posición de cada pin).
 */
export function armar(det, grafo, etiq, piezas, { escala, variante = 0, modo = 'cables' }) {
	const avisos = [];
	const nodos = grafo.nodos;
	const tierras = det.comps.filter((c) => c.tipo === 'gnd');
	const xs = agrupar(nodos.map((n) => n.x), 0.6 * grafo.tol);
	const ys = agrupar(nodos.map((n) => n.y), 0.6 * grafo.tol);
	const refs = [...nodos.map((_, i) => [xs[i], ys[i]]), ...piezas.flatMap((c) => c.terminales.map((t) => t.p)), ...tierras.flatMap((g) => g.terminales.map((t) => t.p))];
	const minX = Math.min(...refs.map((p) => p[0]));
	const minY = Math.min(...refs.map((p) => p[1]));

	// filas y columnas: los nodos que están en una misma línea del dibujo comparten coordenada; las líneas se separan al menos
	// lo que pide cada componente (los símbolos de LTspice tienen tamaño fijo) y todo lo demás se corre junto
	const filasDe = (vals) => {
		const u = [...new Set(vals)].sort((a, b) => a - b);
		return { u, idx: vals.map((v) => u.indexOf(v)) };
	};
	const cx = filasDe(xs);
	const cy = filasDe(ys);
	const necesidades = { x: [], y: [] }; // { i, j, d }: la fila j tiene que estar al menos d después de la fila i
	const nodoDe = new Map();
	for (const u of grafo.uniones) if (!nodoDe.has(`${u.comp}:${u.pata}`)) nodoDe.set(`${u.comp}:${u.pata}`, u.nodo);
	const SEPARACION = { res: 80, ind: 80, cap: 64, voltage: 80 };
	for (const c of piezas) {
		if (c.tipo === 'opamp') {
			const ni = nodoDe.get(`${c.id}:in-`) ?? nodoDe.get(`${c.id}:in+`);
			const no = nodoDe.get(`${c.id}:out`);
			if (ni === undefined || no === undefined || cx.idx[ni] === cx.idx[no]) continue;
			const [i, j] = cx.idx[ni] < cx.idx[no] ? [cx.idx[ni], cx.idx[no]] : [cx.idx[no], cx.idx[ni]];
			necesidades.x.push({ i, j, d: 4 * G });
			continue;
		}
		const d = SEPARACION[c.tipo];
		const na = nodoDe.get(`${c.id}:${c.terminales[0].nombre}`);
		const nb = nodoDe.get(`${c.id}:${c.terminales[1].nombre}`);
		if (!d || na === undefined || nb === undefined) continue;
		const filas = c.eje === 'v' ? cy.idx : cx.idx;
		if (filas[na] === filas[nb]) continue;
		const [i, j] = filas[na] < filas[nb] ? [filas[na], filas[nb]] : [filas[nb], filas[na]];
		necesidades[c.eje === 'v' ? 'y' : 'x'].push({ i, j, d });
	}
	const estirar = (u, min0, esc, reglas) => {
		const F = [];
		for (let k = 0; k < u.length; k++) {
			let v = k ? F[k - 1] + Math.max(G, (u[k] - u[k - 1]) * esc) : 3 * G + (u[k] - min0) * esc;
			for (const r of reglas) if (r.j === k) v = Math.max(v, F[r.i] + r.d);
			F.push(aGrilla(v));
		}
		return F;
	};
	const FX = estirar(cx.u, minX, escala, necesidades.x);
	const FY = estirar(cy.u, minY, escala, necesidades.y);
	// un lugar cualquiera del dibujo (una pata suelta, una tierra) a la grilla, siguiendo el corrimiento de las filas más cercanas
	const interpolar = (u, F, v, esc, min0) => {
		if (!u.length) return aGrilla((v - min0) * esc + 3 * G);
		let k = 0;
		for (let i = 0; i < u.length; i++) if (Math.abs(u[i] - v) < Math.abs(u[k] - v)) k = i;
		return aGrilla(F[k] + (v - u[k]) * esc);
	};
	const aX = (x) => interpolar(cx.u, FX, x, escala, minX);
	const aY = (y) => interpolar(cy.u, FY, y, escala, minY);
	const pos = nodos.map((_, i) => [FX[cx.idx[i]], FY[cy.idx[i]]]);

	const uniones = new Map(); // "comp:pata" → [nodos]
	for (const u of grafo.uniones) {
		const k = `${u.comp}:${u.pata}`;
		if (!uniones.has(k)) uniones.set(k, []);
		uniones.get(k).push(u.nodo);
	}
	/** Dónde está la pata en el dibujo escalado: el promedio de los nodos a los que llega, o su lugar dibujado. */
	const ancla = (c, t) => {
		const ns = uniones.get(`${c.id}:${t.nombre}`);
		if (ns?.length) return [ns.reduce((s, n) => s + pos[n][0], 0) / ns.length, ns.reduce((s, n) => s + pos[n][1], 0) / ns.length];
		return [aX(t.p[0]), aY(t.p[1])];
	};

	const pinesPorPata = new Map(); // "comp:pata" → [x, y]
	const simbolos = [];
	for (const c of piezas) {
		const def = SIMBOLOS[c.tipo];
		const patas = c.terminales;
		const anclas = patas.map((t) => ancla(c, t));
		let rot = 'R0';
		let rp;
		const pinDe = {};
		if (c.tipo === 'opamp') {
			// entradas a un lado y salida al otro; el + arriba o abajo
			let elegido = null;
			for (const r of ['R0', 'M180', 'M0', 'R180']) {
				const q = def.pines.map(([x, y]) => girar(r, x, y));
				const salidaDerecha = q[2][0] > (q[0][0] + q[1][0]) / 2;
				const masArriba = q[1][1] < q[0][1];
				if (salidaDerecha === !!c.derecha && masArriba === !!c.masArriba) {
					elegido = { r, q };
					break;
				}
			}
			rot = elegido.r;
			rp = elegido.q;
			PATAS_OPAMP.forEach((n, i) => (pinDe[n] = i));
		} else {
			const vertical = c.eje === 'v';
			const i0 = (vertical ? patas[0].p[1] <= patas[1].p[1] : patas[0].p[0] <= patas[1].p[0]) ? 0 : 1; // la de arriba / izquierda
			const giros = vertical ? ['R0', 'R180'] : ['R90', 'R270'];
			let hecho = null;
			for (const r of giros) {
				const q = def.pines.map(([x, y]) => girar(r, x, y));
				// el pin de arriba (o de la izquierda) es el que va a la pata i0
				const pinPrimero = (vertical ? q[0][1] <= q[1][1] : q[0][0] <= q[1][0]) ? 0 : 1;
				const mapa = { [patas[i0].nombre]: pinPrimero, [patas[1 - i0].nombre]: 1 - pinPrimero };
				if (c.tipo === 'voltage') {
					const mas = c.masEnA === false ? 'b' : 'a';
					if (mapa[mas] !== 0) continue; // el + tiene que quedar en la pata marcada con +
				}
				hecho = { r, q, mapa };
				break;
			}
			if (!hecho) hecho = { r: giros[0], q: def.pines.map(([x, y]) => girar(giros[0], x, y)), mapa: { [patas[0].nombre]: 0, [patas[1].nombre]: 1 } };
			rot = hecho.r;
			rp = hecho.q;
			Object.assign(pinDe, hecho.mapa);
		}
		// el origen: lo que mejor lleve cada pin a su pata
		let ox = 0;
		let oy = 0;
		patas.forEach((t, i) => {
			const pin = pinDe[t.nombre];
			ox += anclas[i][0] - rp[pin][0];
			oy += anclas[i][1] - rp[pin][1];
		});
		const O = [aGrilla(ox / patas.length), aGrilla(oy / patas.length)];
		c.rot = rot;
		c.origen = O;
		c.pinDe = pinDe;
		c.pines = rp.map(([x, y]) => [O[0] + x, O[1] + y]);
		for (const t of patas) pinesPorPata.set(`${c.id}:${t.nombre}`, c.pines[pinDe[t.nombre]]);
		simbolos.push({ comp: c, simbolo: def.simbolo, x: O[0], y: O[1], rot });
	}

	const cables = [];
	const banderas = [];
	const sumar = (segs) => {
		for (const s of segs) if (s[0] !== s[2] || s[1] !== s[3]) cables.push(s);
	};
	const piezaDe = new Map(piezas.map((c) => [c.id, c]));

	if (modo === 'cables') {
		const primero = variante % 2 === 0 ? 'x' : 'y';
		for (const a of grafo.aristas) sumar(rutaL(pos[a.a], pos[a.b], primero));
		for (const u of grafo.uniones) {
			const c = piezaDe.get(u.comp);
			if (!c) continue; // las tierras no tienen pin
			const pin = pinesPorPata.get(`${u.comp}:${u.pata}`);
			if (!pin) continue;
			const eje = c.tipo === 'opamp' ? 'x' : c.eje === 'v' ? 'y' : 'x'; // sale de la pata a lo largo de su eje
			sumar(rutaL(pin, pos[u.nodo], variante % 2 === 0 ? eje : eje === 'x' ? 'y' : 'x'));
		}
		for (const k of grafo.contactos) {
			const pa = pinesPorPata.get(`${k.a[0]}:${k.a[1]}`);
			const pb = pinesPorPata.get(`${k.b[0]}:${k.b[1]}`);
			if (pa && pb) sumar(rutaL(pa, pb, primero));
		}
		// tierras
		const redDeNodo = new Map();
		grafo.redes.forEach((r, i) => r.nodos.forEach((n) => redDeNodo.set(n, i)));
		for (const g of tierras) {
			// una sola bandera por red: en el nodo más cercano al triángulo
			const porRed = new Map();
			for (const u of grafo.uniones) {
				if (u.comp !== g.id) continue;
				const d = hip(nodos[u.nodo].x - g.terminales[0].p[0], nodos[u.nodo].y - g.terminales[0].p[1]);
				const r = redDeNodo.get(u.nodo);
				if (!porRed.has(r) || d < porRed.get(r).d) porRed.set(r, { d, nodo: u.nodo });
			}
			const lugares = [...porRed.values()].map((q) => pos[q.nodo]);
			for (const k of grafo.contactos) {
				if (k.a[0] !== g.id && k.b[0] !== g.id) continue;
				const otra = k.a[0] === g.id ? k.b : k.a;
				const p = pinesPorPata.get(`${otra[0]}:${otra[1]}`);
				if (p) lugares.push(p);
			}
			if (!lugares.length) avisos.push({ de: g.de, texto: 'Una tierra (triángulo) no está conectada a nada.' });
			for (const p of lugares) if (!banderas.some((b) => b.x === p[0] && b.y === p[1] && b.texto === '0')) banderas.push({ x: p[0], y: p[1], texto: '0' });
		}
		for (const e of etiq.etiquetas) banderas.push({ x: pos[e.nodo][0], y: pos[e.nodo][1], texto: e.nombre });
	} else {
		// por nombres: cada pata con otra en su red (o con tierra, o con nombre) lleva un cablecito corto y una bandera
		const nombresRed = new Map();
		let k = 0;
		const redDeNodo = new Map();
		grafo.redes.forEach((r, i) => r.nodos.forEach((n) => redDeNodo.set(n, i)));
		const nombreDeRed = (r, i) => {
			if (nombresRed.has(i)) return nombresRed.get(i);
			let n = null;
			if (r.tierra) n = '0';
			else {
				const e = etiq.etiquetas.find((q) => redDeNodo.get(q.nodo) === i);
				n = e ? e.nombre : `NET${++k}`;
			}
			nombresRed.set(i, n);
			return n;
		};
		grafo.redes.forEach((r, i) => {
			const patasValidas = r.patas.filter((p) => piezaDe.has(p.comp));
			const conectada = patasValidas.length + (r.tierra ? 1 : 0) + etiq.etiquetas.filter((q) => redDeNodo.get(q.nodo) === i).length;
			if (conectada < 2) return;
			const nombre = nombreDeRed(r, i);
			for (const p of patasValidas) {
				const c = piezaDe.get(p.comp);
				const pin = pinesPorPata.get(`${p.comp}:${p.pata}`);
				// hacia afuera del símbolo, siguiendo el eje que más se aleja del centro de sus pines
				const cx = c.pines.reduce((s, q) => s + q[0], 0) / c.pines.length;
				const cy = c.pines.reduce((s, q) => s + q[1], 0) / c.pines.length;
				const dx = pin[0] - cx;
				const dy = pin[1] - cy;
				const fin = Math.abs(dx) >= Math.abs(dy) ? [pin[0] + Math.sign(dx || 1) * G, pin[1]] : [pin[0], pin[1] + Math.sign(dy || 1) * G];
				cables.push([pin[0], pin[1], fin[0], fin[1]]);
				banderas.push({ x: fin[0], y: fin[1], texto: nombre });
			}
		});
	}
	return { cables, banderas, simbolos, pines: pinesPorPata, avisos };
}

// ---------------------------------------------------------------------------------------------- texto del archivo
/** Junta los cables que se pisan en la misma línea (los codos suelen repetirse). */
function limpiarCables(cables) {
	const horiz = new Map();
	const vert = new Map();
	for (const [x1, y1, x2, y2] of cables) {
		if (y1 === y2) {
			if (!horiz.has(y1)) horiz.set(y1, []);
			horiz.get(y1).push([Math.min(x1, x2), Math.max(x1, x2)]);
		} else if (x1 === x2) {
			if (!vert.has(x1)) vert.set(x1, []);
			vert.get(x1).push([Math.min(y1, y2), Math.max(y1, y2)]);
		}
	}
	const fusion = (rs) => {
		rs.sort((a, b) => a[0] - b[0]);
		const out = [];
		for (const r of rs) {
			const u = out[out.length - 1];
			if (u && r[0] <= u[1]) u[1] = Math.max(u[1], r[1]);
			else out.push([...r]);
		}
		return out;
	};
	const res = [];
	for (const [y, rs] of horiz) for (const [a, b] of fusion(rs)) res.push([a, y, b, y]);
	for (const [x, rs] of vert) for (const [a, b] of fusion(rs)) res.push([x, a, x, b]);
	return res;
}

/** Parte los cables donde algo (una pata, una bandera o el extremo de otro cable) cae en su cuerpo: así toda conexión es de extremo a extremo. */
function partirCables(cables, puntos) {
	const out = [];
	for (const [x1, y1, x2, y2] of cables) {
		const hs = y1 === y2;
		const ini = hs ? Math.min(x1, x2) : Math.min(y1, y2);
		const fin = hs ? Math.max(x1, x2) : Math.max(y1, y2);
		const cortes = new Set();
		for (const [px, py] of puntos) {
			if (hs && py === y1 && px > ini && px < fin) cortes.add(px);
			if (!hs && px === x1 && py > ini && py < fin) cortes.add(py);
		}
		const pts = [ini, ...[...cortes].sort((a, b) => a - b), fin];
		for (let k = 0; k < pts.length - 1; k++) out.push(hs ? [pts[k], y1, pts[k + 1], y1] : [x1, pts[k], x1, pts[k + 1]]);
	}
	return out;
}

/** El texto del .asc. Mueve todo para que nada quede en coordenadas negativas o pegado al borde. */
export function escribirASC(armado, { directivas = [], usaOpamp = false, fin = '\r\n' } = {}) {
	const puntosDeSimbolo = armado.simbolos.flatMap((s) => [...s.comp.pines, [s.x, s.y]]);
	const todos = [...armado.cables.flatMap(([a, b, c, d]) => [[a, b], [c, d]]), ...armado.banderas.map((b) => [b.x, b.y]), ...puntosDeSimbolo];
	let minX = Infinity;
	let minY = Infinity;
	for (const [x, y] of todos) {
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
	}
	const dx = minX < 3 * G ? 3 * G - minX : 0;
	const dy = minY < 3 * G ? 3 * G - minY : 0;
	const mx = (x) => x + dx;
	const my = (y) => y + dy;
	const cables = partirCables(
		limpiarCables(armado.cables.map(([a, b, c, d]) => [mx(a), my(b), mx(c), my(d)])),
		todos.map(([x, y]) => [mx(x), my(y)]),
	);
	let maxX = 0;
	let maxY = 0;
	for (const [x, y] of todos) {
		maxX = Math.max(maxX, mx(x));
		maxY = Math.max(maxY, my(y));
	}
	const textos = [...(usaOpamp ? ['.lib opamp.sub'] : []), ...directivas];
	const L = ['Version 4'];
	L.push(`SHEET 1 ${Math.max(880, Math.ceil((maxX + 5 * G) / G) * G)} ${Math.max(680, Math.ceil((maxY + 5 * G + textos.length * 2 * G) / G) * G)}`);
	for (const [a, b, c, d] of cables) L.push(`WIRE ${a} ${b} ${c} ${d}`);
	for (const f of armado.banderas) L.push(`FLAG ${mx(f.x)} ${my(f.y)} ${f.texto}`);
	for (const s of armado.simbolos) {
		L.push(`SYMBOL ${s.simbolo} ${mx(s.x)} ${my(s.y)} ${s.rot}`);
		L.push(`SYMATTR InstName ${s.comp.nombre}`);
		if (s.comp.valor !== null && s.comp.valor !== undefined) L.push(`SYMATTR Value ${s.comp.valor}`);
	}
	textos.forEach((t, i) => L.push(`TEXT ${3 * G} ${maxY + 3 * G + i * 2 * G} Left 2 !${t}`));
	return L.join(fin) + fin;
}

// ---------------------------------------------------------------------------------------------- leer y verificar
/** Lee las partes de un .asc que importan para las conexiones y para sumar circuitos. */
export function leerASC(texto) {
	const r = { cables: [], banderas: [], simbolos: [], textos: [], nombres: new Set(), version: null, hoja: null };
	let actual = null;
	for (const linea of String(texto).split(/\r?\n/)) {
		const p = linea.trim().split(/\s+/);
		switch (p[0]) {
			case 'Version':
				r.version = p[1];
				break;
			case 'SHEET':
				r.hoja = [Number(p[2]), Number(p[3])];
				break;
			case 'WIRE':
				r.cables.push(p.slice(1, 5).map(Number));
				break;
			case 'FLAG':
				r.banderas.push({ x: Number(p[1]), y: Number(p[2]), texto: p.slice(3).join(' ') });
				break;
			case 'SYMBOL':
				actual = { simbolo: p[1], x: Number(p[2]), y: Number(p[3]), rot: p[4] ?? 'R0', attr: {} };
				r.simbolos.push(actual);
				break;
			case 'SYMATTR':
				if (actual) {
					actual.attr[p[1]] = p.slice(2).join(' ');
					if (p[1] === 'InstName') r.nombres.add(p.slice(2).join(' ').toUpperCase());
				}
				break;
			case 'TEXT':
				r.textos.push({ x: Number(p[1]), y: Number(p[2]), resto: p.slice(3).join(' ') });
				break;
			default:
				break;
		}
	}
	return r;
}

/**
 * Las redes de un .asc como las ve LTspice, para los símbolos que conocemos. Con `sobreCuerpo`, un extremo de cable, una pata o una
 * bandera que cae justo sobre otro cable también lo une. Cada red: { pines: ["R1:0", …], tierra: bool }.
 */
export function redesDeASC(asc, sobreCuerpo = true) {
	const padre = new Map();
	const raiz = (k) => {
		if (!padre.has(k)) padre.set(k, k);
		let r = k;
		while (padre.get(r) !== r) r = padre.get(r);
		return r;
	};
	const une = (a, b) => padre.set(raiz(a), raiz(b));
	const kp = (x, y) => `${x},${y}`;
	const pines = [];
	for (const s of asc.simbolos) {
		const def = Object.values(SIMBOLOS).find((d) => claveSimbolo(d.simbolo) === claveSimbolo(s.simbolo));
		if (!def) continue;
		def.pines.forEach(([x, y], i) => {
			const [rx, ry] = girar(s.rot, x, y);
			pines.push({ k: kp(s.x + rx, s.y + ry), nombre: `${s.attr.InstName ?? s.simbolo}:${i}`, x: s.x + rx, y: s.y + ry });
		});
	}
	for (const [x1, y1, x2, y2] of asc.cables) une(kp(x1, y1), kp(x2, y2));
	for (const p of pines) raiz(p.k);
	for (const f of asc.banderas) {
		raiz(kp(f.x, f.y));
		une(kp(f.x, f.y), `#${/^(0|gnd)$/i.test(f.texto) ? '0' : f.texto}`);
	}
	if (sobreCuerpo) {
		const puntos = [...pines.map((p) => [p.x, p.y]), ...asc.banderas.map((f) => [f.x, f.y]), ...asc.cables.flatMap((c) => [[c[0], c[1]], [c[2], c[3]]])];
		for (const [x1, y1, x2, y2] of asc.cables) {
			for (const [px, py] of puntos) {
				const sobre = y1 === y2 ? py === y1 && px >= Math.min(x1, x2) && px <= Math.max(x1, x2) : x1 === x2 ? px === x1 && py >= Math.min(y1, y2) && py <= Math.max(y1, y2) : false;
				if (sobre) une(kp(px, py), kp(x1, y1));
			}
		}
	}
	const grupos = new Map();
	for (const p of pines) {
		const r = raiz(p.k);
		if (!grupos.has(r)) grupos.set(r, []);
		grupos.get(r).push(p.nombre);
	}
	const tierra = raiz('#0');
	return [...grupos].map(([r, ps]) => ({ pines: ps.sort(), tierra: r === tierra }));
}

/** Lo que tendría que salir: las redes del dibujo con las tierras juntas y las banderas con el mismo nombre unidas. */
function redesEsperadas(grafo, etiq, piezas) {
	const porId = new Map(piezas.map((c) => [c.id, c]));
	const padre = new Map();
	const raiz = (k) => {
		if (!padre.has(k)) padre.set(k, k);
		let r = k;
		while (padre.get(r) !== r) r = padre.get(r);
		return r;
	};
	const une = (a, b) => padre.set(raiz(a), raiz(b));
	const redDeNodo = new Map();
	grafo.redes.forEach((r, i) => {
		raiz(`red${i}`);
		r.nodos.forEach((n) => redDeNodo.set(n, i));
		if (r.tierra) une(`red${i}`, '#0');
	});
	for (const e of etiq.etiquetas) if (redDeNodo.has(e.nodo)) une(`red${redDeNodo.get(e.nodo)}`, `#${e.nombre}`);
	const tierra = raiz('#0');
	const grupos = new Map();
	grafo.redes.forEach((r, i) => {
		const g = raiz(`red${i}`);
		if (!grupos.has(g)) grupos.set(g, []);
		for (const p of r.patas) {
			const c = porId.get(p.comp);
			if (c) grupos.get(g).push(`${c.nombre}:${c.pinDe[p.pata]}`);
		}
	});
	return [...grupos].map(([g, ps]) => ({ pines: ps.sort(), tierra: g === tierra }));
}
const firma = (redes) =>
	redes
		.filter((r) => r.pines.length)
		.map((r) => `${r.tierra ? 'T:' : ''}${r.pines.join('|')}`)
		.sort()
		.join(' ; ');

// ---------------------------------------------------------------------------------------------- todo junto
/**
 * Convierte el circuito reconocido en .asc. Prueba con distintos tamaños y codos hasta que, al volver a leer el archivo, cada pata
 * queda en la misma red que en el dibujo; si los cables no alcanzan, une por nombres de red. Devuelve
 * { texto, comps, avisos, verificado, modo, escala, directivas } o { error }.
 */
export function aASC(det, grafo, { fin = '\r\n' } = {}) {
	const validas = det.comps.filter((c) => c.tipo !== 'gnd' && c.terminales.length >= 2);
	const sinPatas = det.comps.filter((c) => c.tipo !== 'gnd' && c.terminales.length < 2);
	const avisos = [...det.avisos];
	if (!validas.length) return { error: 'No encontré ningún componente. Dibujá resistencias (rectángulos), capacitores (dos rayitas), inductores (bobinas), fuentes (círculos) u operacionales (triángulos con + y −).', avisos };
	for (const c of sinPatas) if (!avisos.some((a) => a.de === c.de)) avisos.push({ de: c.de, texto: 'Una fuente sin cables no se incluyó.' });
	const etiq = etiquetar(det, grafo, validas);
	numerar(validas);
	for (const c of validas) {
		const def = SIMBOLOS[c.tipo];
		if (c.tipo === 'opamp') c.valor = null;
		else if (c.valorEscrito) c.valor = c.valorEscrito;
		else {
			c.valor = def.valor;
			avisos.push({ de: c.de, texto: `${c.nombre} no tiene valor escrito: puse ${def.valor}.` });
		}
	}
	const usaOpamp = validas.some((c) => c.tipo === 'opamp');
	// patas sin conectar y falta de tierra
	for (const r of grafo.redes) {
		const patas = r.patas.filter((p) => validas.some((c) => c.id === p.comp));
		if (patas.length === 1 && !r.tierra && !r.nodos.length) {
			const c = validas.find((x) => x.id === patas[0].comp);
			avisos.push({ de: c.de, texto: `${c.nombre}: una pata no está conectada a nada.` });
		}
	}
	if (!det.comps.some((c) => c.tipo === 'gnd')) avisos.push({ de: [], texto: 'No hay ninguna tierra (triángulo chico): LTspice necesita una para simular.' });
	if (etiq.sinUsar.length) avisos.push({ de: [], texto: `Textos que no se usaron: ${etiq.sinUsar.join(', ')}.` });

	// escala: lo típico de un componente dibujado pasa a unos 96 de LTspice; las líneas se estiran solas donde un símbolo lo pida
	const base = Math.min(2.5, Math.max(0.6, 96 / Math.max(40, det.ref)));
	const intentos = [];
	for (const mult of [1, 1.25, 1.6, 2, 2.6]) for (const variante of [0, 1]) intentos.push({ escala: base * mult, variante, modo: 'cables' });
	intentos.push({ escala: base * 1.5, variante: 0, modo: 'nombres' }, { escala: base * 2.6, variante: 0, modo: 'nombres' });
	let ultimo = null;
	for (const it of intentos) {
		const armado = armar(det, grafo, etiq, validas, it);
		const texto = escribirASC(armado, { directivas: etiq.directivas, usaOpamp, fin });
		const leido = leerASC(texto);
		const esperado = firma(redesEsperadas(grafo, etiq, validas));
		const obtenido = firma(redesDeASC(leido, true));
		const estricto = firma(redesDeASC(leido, false));
		const ok = esperado === obtenido && esperado === estricto;
		ultimo = { texto, armado, esperado, obtenido, estricto, it };
		if (ok) {
			if (it.modo === 'nombres') avisos.push({ de: [], texto: 'Los cables se pisaban en la hoja: las conexiones van por nombres de red (NET1, NET2…). Es el mismo circuito, solo se lee distinto.' });
			return { texto, comps: validas, avisos: [...avisos, ...armado.avisos], verificado: true, modo: it.modo, escala: it.escala, directivas: etiq.directivas, etiquetas: etiq.etiquetas };
		}
	}
	avisos.push({ de: [], texto: 'No pude comprobar que las conexiones del archivo coincidan con el dibujo (cables muy pegados): revisalo en LTspice o dibujalo con más aire entre cables.' });
	return { texto: ultimo.texto, comps: validas, avisos: [...avisos, ...ultimo.armado.avisos], verificado: false, modo: ultimo.it.modo, escala: ultimo.it.escala, directivas: etiq.directivas, etiquetas: etiq.etiquetas, detalle: { esperado: ultimo.esperado, obtenido: ultimo.obtenido, estricto: ultimo.estricto } };
}

/** De los objetos del Pizarrón al .asc: reconoce el circuito, lo conecta y lo escribe. */
export function convertir(objetos, opciones = {}) {
	const P = primitivas(objetos);
	const det = detectar(P);
	const grafo = conectar(det);
	const r = aASC(det, grafo, opciones);
	return { ...r, det, grafo, ignorados: det.ignorados };
}

// ---------------------------------------------------------------------------------------------- leer y escribir archivos
/** Bytes de un .asc a texto: LTspice los guarda en ANSI (Windows-1252), en UTF-8 o, las versiones nuevas, en UTF-16. */
export function decodificarASC(bytes) {
	const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	if (u.length >= 2 && u[0] === 0xff && u[1] === 0xfe) return { texto: new TextDecoder('utf-16le').decode(u.subarray(2)), codificacion: 'utf-16le' };
	if (u.length >= 2 && u[0] === 0xfe && u[1] === 0xff) return { texto: new TextDecoder('utf-16be').decode(u.subarray(2)), codificacion: 'utf-16be' };
	try {
		return { texto: new TextDecoder('utf-8', { fatal: true }).decode(u), codificacion: 'utf-8' };
	} catch {
		return { texto: new TextDecoder('windows-1252').decode(u), codificacion: 'windows-1252' };
	}
}
/** Texto de un .asc a bytes, en la misma codificación en que se lo leyó. */
export function codificarASC(texto, codificacion = 'utf-8') {
	if (codificacion === 'utf-16le' || codificacion === 'utf-16be') {
		const b = new Uint8Array(2 + texto.length * 2);
		const le = codificacion === 'utf-16le';
		b[0] = le ? 0xff : 0xfe;
		b[1] = le ? 0xfe : 0xff;
		for (let i = 0; i < texto.length; i++) {
			const c = texto.charCodeAt(i);
			b[2 + 2 * i] = le ? c & 255 : c >> 8;
			b[3 + 2 * i] = le ? c >> 8 : c & 255;
		}
		return b;
	}
	if (codificacion === 'windows-1252') {
		const b = new Uint8Array(texto.length);
		for (let i = 0; i < texto.length; i++) {
			const c = texto.charCodeAt(i);
			b[i] = c < 256 ? c : 63;
		}
		return b;
	}
	return new TextEncoder().encode(texto);
}

// ---------------------------------------------------------------------------------------------- sumar a un .asc que ya existe
/**
 * Suma el circuito a un esquema existente: lo pone a la derecha de lo que ya hay (alineado arriba, en la grilla), cambia los nombres
 * de componentes que se repiten (R1 → R4), cambia las banderas NETn que ya se usan, agranda la hoja y no repite ".lib opamp.sub".
 * Las banderas con el mismo nombre del esquema y del circuito nuevo quedan unidas, como hace LTspice (las tierras, también).
 */
export function sumarAASC(existente, nuevo) {
	const fin = existente.includes('\r\n') || !existente.includes('\n') ? '\r\n' : '\n';
	const A = leerASC(existente);
	const B = leerASC(nuevo);
	let maxX = 0;
	let minY = Infinity;
	const ver = (x, y) => {
		if (Number.isFinite(x) && Number.isFinite(y)) {
			maxX = Math.max(maxX, x);
			minY = Math.min(minY, y);
		}
	};
	for (const c of A.cables) {
		ver(c[0], c[1]);
		ver(c[2], c[3]);
	}
	for (const f of A.banderas) ver(f.x, f.y);
	for (const s of A.simbolos) ver(s.x + 64, s.y);
	for (const t of A.textos) ver(t.x, t.y);
	if (!Number.isFinite(minY)) minY = 3 * G;
	let bMinX = Infinity;
	let bMinY = Infinity;
	for (const c of B.cables) {
		bMinX = Math.min(bMinX, c[0], c[2]);
		bMinY = Math.min(bMinY, c[1], c[3]);
	}
	for (const s of B.simbolos) {
		bMinX = Math.min(bMinX, s.x - 2 * G);
		bMinY = Math.min(bMinY, s.y);
	}
	if (!Number.isFinite(bMinX)) bMinX = 0;
	if (!Number.isFinite(bMinY)) bMinY = 0;
	const dx = Math.ceil((maxX + 6 * G - bMinX) / G) * G;
	const dy = Math.round((minY - bMinY) / G) * G;

	const usados = new Set(A.nombres);
	const renombre = new Map();
	for (const s of B.simbolos) {
		const n = s.attr.InstName;
		if (!n) continue;
		if (!usados.has(n.toUpperCase())) {
			usados.add(n.toUpperCase());
			continue;
		}
		const p = n.match(/^[A-Za-z]+/)?.[0] ?? 'X';
		let k = 1;
		while (usados.has(`${p}${k}`.toUpperCase())) k++;
		renombre.set(n, `${p}${k}`);
		usados.add(`${p}${k}`.toUpperCase());
	}
	const redesViejas = new Set(A.banderas.map((f) => f.texto));
	const renombreRed = new Map();
	for (const f of B.banderas) {
		if (!/^NET\d+$/.test(f.texto) || renombreRed.has(f.texto) || !redesViejas.has(f.texto)) continue;
		let k = 1;
		while (redesViejas.has(`NET${k}`) || B.banderas.some((q) => q.texto === `NET${k}`)) k++;
		renombreRed.set(f.texto, `NET${k}`);
		redesViejas.add(`NET${k}`);
	}
	const yaTieneLib = /opamp\.sub/i.test(existente);

	const L = [];
	for (const linea of String(nuevo).split(/\r?\n/)) {
		const p = linea.trim().split(/\s+/);
		if (p[0] === 'WIRE') L.push(`WIRE ${Number(p[1]) + dx} ${Number(p[2]) + dy} ${Number(p[3]) + dx} ${Number(p[4]) + dy}`);
		else if (p[0] === 'FLAG') {
			const nombre = p.slice(3).join(' ');
			L.push(`FLAG ${Number(p[1]) + dx} ${Number(p[2]) + dy} ${renombreRed.get(nombre) ?? nombre}`);
		} else if (p[0] === 'SYMBOL') L.push(`SYMBOL ${p[1]} ${Number(p[2]) + dx} ${Number(p[3]) + dy} ${p[4] ?? 'R0'}`);
		else if (p[0] === 'SYMATTR') {
			const v = p.slice(2).join(' ');
			L.push(`SYMATTR ${p[1]} ${p[1] === 'InstName' && renombre.has(v) ? renombre.get(v) : v}`);
		} else if (p[0] === 'TEXT') {
			const resto = p.slice(3).join(' ');
			if (yaTieneLib && /opamp\.sub/i.test(resto)) continue;
			L.push(`TEXT ${Number(p[1]) + dx} ${Number(p[2]) + dy} ${resto}`);
		}
	}
	let maxXn = 0;
	let maxYn = 0;
	for (const linea of L) {
		const p = linea.split(/\s+/);
		if (p[0] === 'WIRE') {
			maxXn = Math.max(maxXn, Number(p[1]), Number(p[3]));
			maxYn = Math.max(maxYn, Number(p[2]), Number(p[4]));
		} else if (p[0] === 'FLAG' || p[0] === 'TEXT') {
			maxXn = Math.max(maxXn, Number(p[1]));
			maxYn = Math.max(maxYn, Number(p[2]));
		} else if (p[0] === 'SYMBOL') {
			maxXn = Math.max(maxXn, Number(p[2]));
			maxYn = Math.max(maxYn, Number(p[3]));
		}
	}
	const [aw, ah] = A.hoja ?? [880, 680];
	const hoja = `SHEET 1 ${Math.max(aw, Math.ceil((maxXn + 5 * G) / G) * G)} ${Math.max(ah, Math.ceil((maxYn + 5 * G) / G) * G)}`;
	const lineas = String(existente).split(/\r?\n/);
	while (lineas.length && lineas[lineas.length - 1] === '') lineas.pop();
	let puesta = false;
	const salida = lineas.map((l) => {
		if (/^SHEET\b/.test(l.trim())) {
			puesta = true;
			return hoja;
		}
		return l;
	});
	if (!puesta) salida.splice(Math.min(1, salida.length), 0, hoja);
	return { texto: [...salida, ...L].join(fin) + fin, renombrados: [...renombre], desplazamiento: [dx, dy] };
}

// ---------------------------------------------------------------------------------------------- vista previa
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Dibujo de cada símbolo con sus coordenadas locales (sin girar), parecido al de LTspice, y la caja que ocupa. */
const FORMA = {
	res: { caja: [0, 16, 32, 96], d: 'M16 16V32L24 36L8 44L24 52L8 60L24 68L8 76L16 80V96' },
	cap: { caja: [0, 0, 32, 64], d: 'M16 0V24M16 40V64M0 24H32M0 40H32' },
	ind: { caja: [4, 16, 28, 96], d: 'M16 16V32A8 6 0 0 1 16 44A8 6 0 0 1 16 56A8 6 0 0 1 16 68A8 6 0 0 1 16 80V96' },
	voltage: { caja: [-24, 16, 24, 96], d: 'M0 16V32M0 80V96M-6 46H6M0 40V52M-6 68H6', circulo: [0, 56, 24] },
	opamp: { caja: [-32, 32, 32, 96], d: 'M-32 32L32 64L-32 96Z M-28 48H-20M-28 80H-20M-24 76V84' },
};
/**
 * Dibuja un .asc como SVG (para ver cómo va a quedar en LTspice): cables, símbolos conocidos con su nombre y valor, tierras y nombres de red.
 * `color`: { cable, simbolo, texto, fondo }.
 */
export function dibujarASC(texto, color = {}) {
	const c = { cable: '#1a3fa8', simbolo: '#8b1a1a', texto: '#111111', directiva: '#2a5db0', fondo: '#ffffff', ...color };
	const a = leerASC(texto);
	const piezas = [];
	let x0 = Infinity;
	let y0 = Infinity;
	let x1 = -Infinity;
	let y1 = -Infinity;
	const ver = (x, y) => {
		x0 = Math.min(x0, x);
		y0 = Math.min(y0, y);
		x1 = Math.max(x1, x);
		y1 = Math.max(y1, y);
	};
	for (const [ax, ay, bx, by] of a.cables) {
		piezas.push(`<path d="M${ax} ${ay}L${bx} ${by}" stroke="${c.cable}" stroke-width="2" fill="none" stroke-linecap="round"/>`);
		ver(ax, ay);
		ver(bx, by);
	}
	for (const s of a.simbolos) {
		const clave = Object.keys(SIMBOLOS).find((k) => claveSimbolo(SIMBOLOS[k].simbolo) === claveSimbolo(s.simbolo));
		const f = clave && FORMA[clave];
		if (!f) {
			ver(s.x - 16, s.y - 16);
			ver(s.x + 48, s.y + 48);
			piezas.push(`<rect x="${s.x}" y="${s.y}" width="48" height="48" fill="none" stroke="${c.simbolo}" stroke-dasharray="4 3"/><text x="${s.x + 2}" y="${s.y + 28}" font-size="12" fill="${c.texto}">${esc(s.attr.InstName ?? s.simbolo)}</text>`);
			continue;
		}
		const [ux, uy] = girar(s.rot, 1, 0);
		const [vx, vy] = girar(s.rot, 0, 1);
		const esq = [[f.caja[0], f.caja[1]], [f.caja[2], f.caja[1]], [f.caja[2], f.caja[3]], [f.caja[0], f.caja[3]]].map(([x, y]) => girar(s.rot, x, y)).map(([x, y]) => [s.x + x, s.y + y]);
		const bx0 = Math.min(...esq.map((p) => p[0]));
		const bx1 = Math.max(...esq.map((p) => p[0]));
		const by0 = Math.min(...esq.map((p) => p[1]));
		const by1 = Math.max(...esq.map((p) => p[1]));
		ver(bx0, by0);
		ver(bx1, by1);
		const circ = f.circulo ? `<circle cx="${f.circulo[0]}" cy="${f.circulo[1]}" r="${f.circulo[2]}" fill="${c.fondo}" stroke="${c.simbolo}" stroke-width="2"/>` : '';
		piezas.push(`<g transform="matrix(${ux} ${uy} ${vx} ${vy} ${s.x} ${s.y})">${circ}<path d="${f.d}" stroke="${c.simbolo}" stroke-width="2" fill="none" stroke-linejoin="round" stroke-linecap="round"/></g>`);
		// nombre y valor: a la derecha del símbolo si es vertical y arriba si es horizontal
		const ancho = bx1 - bx0;
		const alto = by1 - by0;
		const lineas = [s.attr.InstName, s.attr.Value].filter(Boolean);
		const arriba = ancho > alto;
		lineas.forEach((t, i) => {
			const tx = arriba ? (bx0 + bx1) / 2 : bx1 + 8;
			const ty = arriba ? by0 - 8 - (lineas.length - 1 - i) * 15 : (by0 + by1) / 2 + (i - (lineas.length - 1) / 2) * 15 + 4;
			piezas.push(`<text x="${tx}" y="${ty}" font-size="13" font-family="monospace" text-anchor="${arriba ? 'middle' : 'start'}" fill="${c.texto}">${esc(t)}</text>`);
			ver(tx + (arriba ? 0 : String(t).length * 8), ty - 12);
		});
	}
	for (const f of a.banderas) {
		ver(f.x - 10, f.y);
		ver(f.x + 10, f.y + 18);
		if (/^(0|gnd)$/i.test(f.texto)) piezas.push(`<path d="M${f.x} ${f.y}V${f.y + 6}M${f.x - 10} ${f.y + 6}H${f.x + 10}M${f.x - 6} ${f.y + 11}H${f.x + 6}M${f.x - 2} ${f.y + 16}H${f.x + 2}" stroke="${c.cable}" stroke-width="2" fill="none"/>`);
		else piezas.push(`<path d="M${f.x} ${f.y}l8 -6h${Math.max(16, f.texto.length * 8)}v12h-${Math.max(16, f.texto.length * 8)}z" fill="${c.fondo}" stroke="${c.cable}" stroke-width="1.5"/><text x="${f.x + 11}" y="${f.y + 4}" font-size="12" font-family="monospace" fill="${c.texto}">${esc(f.texto)}</text>`);
		if (!/^(0|gnd)$/i.test(f.texto)) ver(f.x + 8 + Math.max(16, f.texto.length * 8), f.y);
	}
	for (const t of a.textos) {
		const directiva = t.resto.match(/^Left\s+\d+\s+([!;])(.*)$/);
		const cuerpo = directiva ? directiva[2] : t.resto;
		piezas.push(`<text x="${t.x}" y="${t.y}" font-size="13" font-family="monospace" fill="${directiva?.[1] === '!' ? c.directiva : c.texto}">${esc(cuerpo)}</text>`);
		ver(t.x, t.y - 12);
		ver(t.x + cuerpo.length * 8, t.y + 4);
	}
	if (!Number.isFinite(x0)) return '';
	const m = 24;
	const w = x1 - x0 + 2 * m;
	const hh = y1 - y0 + 2 * m;
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0 - m} ${y0 - m} ${w} ${hh}" width="${w}" height="${hh}" role="img" aria-label="Vista previa del circuito"><rect x="${x0 - m}" y="${y0 - m}" width="${w}" height="${hh}" fill="${c.fondo}"/>${piezas.join('')}</svg>`;
}
