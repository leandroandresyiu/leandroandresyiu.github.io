// Dibujo de diagramas de tiempos en SVG (sin librerías). Sirve para la vista previa, el editor y la exportación.
import { esBus, fmtFrecuencia, fmtTiempo } from './modelo.js';

const NS = 'http://www.w3.org/2000/svg';
const FUENTE = "'LM Roman 10'";

function el(tag, at = {}, txt) {
	const e = document.createElementNS(NS, tag);
	for (const [k, v] of Object.entries(at)) if (v !== undefined && v !== null) e.setAttribute(k, String(v));
	if (txt !== undefined) e.textContent = txt;
	return e;
}
const r2 = (n) => Math.round(n * 100) / 100;
/** Texto del dibujo con identificador (`data-tid`): m.desplaz[id] = [dx, dy] lo corre de su lugar. */
function txtMov(m, id0, at, s) {
	const id = (m.prefijoTid || '') + id0; // con varios renglones, cada uno tiene sus propios textos
	const d = m.desplaz && m.desplaz[id];
	return el('text', { ...at, x: r2(at.x + (d ? d[0] : 0)), y: r2(at.y + (d ? d[1] : 0)), 'data-tid': id }, s);
}

let ctx = null;
/** Ancho de un texto en píxeles, con la fuente del dibujo. */
export function medir(txt, tam = 14, estilo = '') {
	if (!ctx) ctx = document.createElement('canvas').getContext('2d');
	ctx.font = `${estilo} ${tam}px "LM Roman 10", serif`;
	return ctx.measureText(String(txt)).width;
}

/** Paso "redondo" (1, 2, 5 × 10^n) para repartir un rango en unas `n` marcas. */
export function pasoRedondo(rango, n) {
	const bruto = rango / Math.max(1, n);
	const e = Math.pow(10, Math.floor(Math.log10(bruto)));
	const f = bruto / e;
	return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * e;
}

export const OPC = {
	px: 28, // píxeles por unidad de tiempo
	filaH: 40,
	amp: 22,
	tam: 14,
	linea: 1.6,
	color: '#000',
};

/**
 * m = { titulo, unidad: 'ticks'|'s', tickTime, t0, t1, regla: 'ticks'|'tiempo'|'ninguna', rejilla: {paso, origen}|null, bandas,
 *       senales: [{ nombre, segs: [{a, b, v: '0'|'1'|'x'|'z'|'d', d?, k?}], color? }],
 *       campos: [{ a, b, texto, color?, nivel? }], marcas: [{ t, fila }], cursores: [{ t, nombre }] }
 * Devuelve un <svg> con .geom (para ubicar clics en el editor).
 */
export function render(m, o = {}) {
	const O = { ...OPC, ...o };
	const { px, filaH, amp, tam, linea, color } = O;
	const t0 = m.t0;
	const t1 = m.t1;
	const W = Math.max(1, (t1 - t0) * px);
	const nombres = O.nombres !== false;
	const L = nombres ? Math.ceil(Math.max(30, ...m.senales.map((s) => medir(s.nombre, tam))) + 22) : 12;
	const R = 18;
	const X = (t) => L + (t - t0) * px;
	const niveles = m.campos.reduce((n, c) => Math.max(n, (c.nivel ?? 0) + 1), 0);
	const alturaTitulo = m.titulo ? 28 : 0;
	const hayCursores = (m.cursores || []).length > 0;
	const alturaInfo = hayCursores ? 22 : 0;
	const alturaCampos = niveles ? niveles * 24 + 6 : 0;
	const alturaRegla = m.regla && m.regla !== 'ninguna' ? 22 : 0;
	const yTitulo = 4;
	const yInfo = yTitulo + alturaTitulo;
	const yCampos = yInfo + alturaInfo;
	const yRegla = yCampos + alturaCampos;
	const yFilas = yRegla + alturaRegla + 6;
	const H = yFilas + m.senales.length * filaH + 10;
	const svg = el('svg', { xmlns: NS, version: '1.1', width: r2(L + W + R), height: H, viewBox: `0 0 ${r2(L + W + R)} ${H}` });
	const geom = { L, px, t0, t1, W, yFilas, filaH, amp, alto: H, ancho: L + W + R, X, filas: [] };
	svg.geom = geom;
	const txtAt = { 'font-family': FUENTE, fill: color };

	// ---- bandas de color detrás de las señales
	if (m.bandas !== false && m.campos.length) {
		const g = el('g', { class: 'bandas' });
		for (const c of m.campos) {
			if (!c.color || c.sinBanda) continue;
			const a = Math.max(c.a, t0);
			const b = Math.min(c.b, t1);
			if (b <= a) continue;
			g.appendChild(el('rect', { x: r2(X(a)), y: yFilas - 4, width: r2((b - a) * px), height: m.senales.length * filaH + 4, fill: c.color, 'fill-opacity': 0.1 }));
		}
		svg.appendChild(g);
	}

	// ---- rejilla
	if (m.rejilla) {
		const g = el('g', { class: 'rejilla' });
		const { paso, origen = 0 } = m.rejilla;
		const primero = Math.ceil((t0 - origen) / paso - 1e-9);
		for (let k = primero; origen + k * paso <= t1 + 1e-9; k++) {
			const x = r2(X(origen + k * paso));
			g.appendChild(el('line', { x1: x, y1: yFilas - 4, x2: x, y2: yFilas + m.senales.length * filaH, stroke: '#cfcfcf', 'stroke-width': 0.8 }));
		}
		svg.appendChild(g);
	}

	// ---- título
	if (m.titulo) svg.appendChild(txtMov(m, 'titulo', { ...txtAt, x: L, y: yTitulo + 18, 'font-size': tam + 4, 'font-weight': 'bold' }, m.titulo));

	// ---- campos (llaves con texto arriba de las señales)
	if (m.campos.length) {
		const g = el('g', { class: 'campos' });
		m.campos.forEach((c, ci) => {
			const a = Math.max(c.a, t0);
			const b = Math.min(c.b, t1);
			if (b <= a) return;
			const y = yCampos + (c.nivel ?? 0) * 24 + 22;
			const xa = X(a) + 1;
			const xb = X(b) - 1;
			const col = c.color || '#444';
			g.appendChild(el('path', { d: `M${r2(xa)} ${y - 6} V${y} H${r2(xb)} V${y - 6}`, fill: 'none', stroke: col, 'stroke-width': 1.2 }));
			if (c.texto) {
				// el texto se achica para entrar en su llave (hasta un mínimo legible)
				let tamC = c.tam || tam - 1;
				const w = medir(c.texto, tamC);
				const lugar = xb - xa - 2;
				if (w > lugar && lugar > 8) tamC = Math.max(6.5, (tamC * lugar) / w);
				g.appendChild(txtMov(m, `campo:${ci}`, { ...txtAt, x: (xa + xb) / 2, y: y - 8, 'text-anchor': 'middle', 'font-size': r2(tamC) }, c.texto));
			}
		});
		svg.appendChild(g);
	}

	// ---- regla de tiempo
	if (alturaRegla) {
		const g = el('g', { class: 'regla' });
		const y = yRegla + 14;
		const modoTiempo = m.regla === 'tiempo' && (m.unidad === 's' || m.tickTime);
		const k = m.unidad === 's' ? 1 : m.tickTime || 1; // segundos por unidad
		const paso = pasoRedondo(t1 - t0, Math.max(2, W / 90));
		const primero = Math.ceil(t0 / paso - 1e-9);
		for (let i = primero; i * paso <= t1 + 1e-9; i++) {
			const t = i * paso;
			const x = r2(X(t));
			g.appendChild(el('line', { x1: x, y1: y + 1, x2: x, y2: y + 6, stroke: '#666', 'stroke-width': 0.9 }));
			const et = modoTiempo ? fmtTiempo(t * k) : String(Number(t.toFixed(6)));
			g.appendChild(el('text', { ...txtAt, x, y: y - 3, 'text-anchor': 'middle', 'font-size': tam - 3, fill: '#555' }, et));
		}
		g.appendChild(el('line', { x1: r2(L), y1: y + 1, x2: r2(L + W), y2: y + 1, stroke: '#999', 'stroke-width': 0.8 }));
		svg.appendChild(g);
	}

	// ---- señales
	const gs = el('g', { class: 'senales' });
	m.senales.forEach((s, fi) => {
		const y0 = yFilas + fi * filaH;
		const yTop = y0 + (filaH - amp) / 2;
		const yBot = yTop + amp;
		const yMed = (yTop + yBot) / 2;
		geom.filas.push({ y: y0, h: filaH, yTop, yBot, yMed });
		const g = el('g', { class: 'senal', 'data-fila': fi });
		// la señal analógica de la captura, de fondo y en gris (nivel 0 = bajo, 1 = alto)
		if (s.analog && s.analog.length > 1) {
			const pts = s.analog
				.filter(([t]) => t >= t0 && t <= t1)
				.map(([t, n]) => `${r2(X(t))},${r2(yBot - n * (yBot - yTop))}`)
				.join(' ');
			g.appendChild(el('polyline', { points: pts, fill: 'none', stroke: '#8fa3b8', 'stroke-width': 0.9, 'stroke-linejoin': 'round', opacity: 0.9, class: 'analogica' }));
		}
		const col = s.color || color;
		const lw = linea;
		const st = { stroke: col, 'stroke-width': lw, fill: 'none', 'stroke-linejoin': 'miter', 'stroke-linecap': 'butt' };
		if (nombres) g.appendChild(txtMov(m, `nombre:${fi}`, { ...txtAt, x: L - 10, y: yMed + 5, 'text-anchor': 'end', 'font-size': tam, class: 'nombre' }, s.nombre));
		const segs = s.segs.filter((q) => q.b > t0 && q.a < t1).map((q) => ({ ...q, a: Math.max(q.a, t0), b: Math.min(q.b, t1) }));
		const ytv = (v) => (v === '1' ? yTop : v === '0' ? yBot : yMed);
		const digital = (v) => v === '0' || v === '1';
		segs.forEach((q, i) => {
			const xa = X(q.a);
			const xb = X(q.b);
			const prev = segs[i - 1] && Math.abs(segs[i - 1].b - q.a) < 1e-9 ? segs[i - 1] : null;
			const sig = segs[i + 1] && Math.abs(segs[i + 1].a - q.b) < 1e-9 ? segs[i + 1] : null;
			if (digital(q.v)) {
				g.appendChild(el('line', { x1: r2(xa), y1: ytv(q.v), x2: r2(xb), y2: ytv(q.v), ...st }));
				if (prev && digital(prev.v) && prev.v !== q.v) g.appendChild(el('line', { x1: r2(xa), y1: yTop, x2: r2(xa), y2: yBot, ...st }));
				else if (prev && !digital(prev.v)) g.appendChild(el('line', { x1: r2(xa), y1: ytv(q.v), x2: r2(xa), y2: yMed, ...st }));
			} else if (q.v === 'z') {
				g.appendChild(el('line', { x1: r2(xa), y1: yMed, x2: r2(xb), y2: yMed, ...st, 'stroke-dasharray': '4 3' }));
				if (prev && digital(prev.v)) g.appendChild(el('line', { x1: r2(xa), y1: ytv(prev.v), x2: r2(xa), y2: yMed, ...st }));
			} else if (q.v === 'x') {
				g.appendChild(el('rect', { x: r2(xa), y: yTop, width: r2(xb - xa), height: amp, fill: '#d6d6d6', stroke: 'none' }));
				g.appendChild(el('line', { x1: r2(xa), y1: yTop, x2: r2(xb), y2: yTop, ...st, 'stroke-width': lw * 0.7 }));
				g.appendChild(el('line', { x1: r2(xa), y1: yBot, x2: r2(xb), y2: yBot, ...st, 'stroke-width': lw * 0.7 }));
				if (prev && digital(prev.v)) g.appendChild(el('line', { x1: r2(xa), y1: ytv(prev.v), x2: r2(xa), y2: yMed, ...st }));
			} else if (q.v === 'd') {
				const ch = Math.min(6, (xb - xa) / 3);
				const cI = prev && prev.v === 'd' ? ch : prev ? 0 : ch;
				const cD = sig && sig.v === 'd' ? ch : sig ? 0 : ch;
				const pts = [
					[xa + cI, yTop],
					[xb - cD, yTop],
					[xb, cD ? yMed : yTop],
					...(cD ? [] : [[xb, yBot]]),
					[xb - cD, yBot],
					[xa + cI, yBot],
					[xa, cI ? yMed : yBot],
					...(cI ? [] : [[xa, yTop]]),
				];
				g.appendChild(el('polygon', { points: pts.map(([x, y]) => `${r2(x)},${r2(y)}`).join(' '), ...st, fill: '#fff', 'fill-opacity': 0.0 }));
				const ancho = xb - xa - 2 * ch;
				const texto = q.d ?? '';
				if (texto) {
					const w = medir(texto, tam);
					const tamT = w > ancho && ancho > 14 ? Math.max(8, (tam * ancho) / w) : tam;
					g.appendChild(el('text', { ...txtAt, x: r2((xa + xb) / 2), y: yMed + tamT * 0.35, 'text-anchor': 'middle', 'font-size': r2(tamT) }, texto));
				}
			}
		});
		svg.appendChild(g);
		gs.appendChild(g);
	});
	svg.appendChild(gs);

	// ---- marcas (puntos de muestreo) sobre una señal
	if ((m.marcas || []).length) {
		const g = el('g', { class: 'marcas' });
		for (const mk of m.marcas) {
			if (mk.t < t0 || mk.t > t1) continue;
			const f = geom.filas[mk.fila];
			if (!f) continue;
			const segs = m.senales[mk.fila].segs;
			const seg = segs.find((q) => q.a <= mk.t + 1e-9 && mk.t < q.b - 1e-9) || segs.find((q) => q.a <= mk.t + 1e-9 && mk.t <= q.b + 1e-9);
			const v = seg ? seg.v : '1';
			const yy = v === '1' ? f.yTop : v === '0' ? f.yBot : f.yMed;
			g.appendChild(el('circle', { cx: r2(X(mk.t)), cy: yy, r: 3.2, fill: '#c0392b', stroke: '#fff', 'stroke-width': 0.8 }));
		}
		svg.appendChild(g);
	}

	// ---- cursores
	if (hayCursores) {
		const g = el('g', { class: 'cursores' });
		const fin = yFilas + m.senales.length * filaH;
		const verde = '#0a7c5a';
		const cs = m.cursores;
		cs.forEach((c, ci) => {
			if (c.t < t0 || c.t > t1) return;
			const x = r2(X(c.t));
			g.appendChild(el('line', { x1: x, y1: yInfo + 4, x2: x, y2: fin, stroke: verde, 'stroke-width': 1.1, 'stroke-dasharray': '5 3', 'data-cursor': ci }));
			// con dos cursores las letras quedan hacia afuera y la medida entre ellos
			const ancla = cs.length >= 2 ? (ci === 0 ? 'end' : 'start') : 'middle';
			const dx = ancla === 'end' ? -4 : ancla === 'start' ? 4 : 0;
			g.appendChild(txtMov(m, `cursor:${ci}`, { ...txtAt, x: x + dx, y: yInfo + 15, 'text-anchor': ancla, 'font-size': tam - 1, fill: verde, 'font-weight': 'bold' }, c.nombre));
		});
		if (cs.length >= 2) {
			const dt = cs[1].t - cs[0].t;
			const k = m.unidad === 's' ? 1 : m.tickTime;
			let txt = `Δ = ${Math.abs(dt).toLocaleString('es-AR', { maximumFractionDigits: 3 })} ${m.unidad === 's' ? 's' : 'ticks'}`;
			if (k) txt = `Δt = ${fmtTiempo(Math.abs(dt) * k)}  ·  1/Δt = ${fmtFrecuencia(1 / (Math.abs(dt) * k))}`;
			const xa = X(cs[0].t);
			const xb = X(cs[1].t);
			const entre = Math.abs(xb - xa);
			const cabe = medir(txt, tam - 1) + 24 < entre;
			const xm = cabe ? (xa + xb) / 2 : Math.max(L, Math.min(xa, xb));
			g.appendChild(txtMov(m, 'medida', { ...txtAt, x: xm, y: yInfo + 15, 'text-anchor': cabe ? 'middle' : 'start', 'font-size': tam - 1, fill: verde }, txt));
		}
		svg.appendChild(g);
	}
	return svg;
}

/** Sale de un SVG de render: lo que hace falta para exportarlo (fondo opcional). */
export function conFondo(svg, color = '#ffffff') {
	const w = svg.getAttribute('width');
	const h = svg.getAttribute('height');
	svg.insertBefore(el('rect', { x: 0, y: 0, width: w, height: h, fill: color }), svg.firstChild);
	return svg;
}

export { esBus };

/**
 * Igual que render(), pero si el dibujo es más ancho que `maxAncho` lo parte en renglones (uno debajo del otro) cortando
 * en múltiplos de un bit (m.rejilla.paso), como un texto que no entra en una línea. El título va solo en el primero.
 */
export function renderRenglones(m, o = {}, maxAncho = 0) {
	const base = render(m, o);
	if (!maxAncho || base.geom.ancho <= maxAncho) return base;
	const g = base.geom;
	const unidad = (m.rejilla && m.rejilla.paso) || 1;
	const util = Math.max(g.px * unidad, maxAncho - g.L - 18);
	const porRenglon = Math.max(unidad, Math.floor(util / (g.px * unidad)) * unidad);
	const n = Math.ceil((m.t1 - m.t0) / porRenglon - 1e-9);
	if (n <= 1) return base;
	const GAP = 14;
	const partes = [];
	for (let k = 0; k < n; k++) {
		const mk = { ...m, t0: m.t0 + k * porRenglon, t1: Math.min(m.t1, m.t0 + (k + 1) * porRenglon), titulo: k ? '' : m.titulo, prefijoTid: `r${k}:` };
		partes.push(render(mk, o));
	}
	const ancho = Math.max(...partes.map((p) => parseFloat(p.getAttribute('width'))));
	const alto = partes.reduce((a, p) => a + parseFloat(p.getAttribute('height')), 0) + GAP * (n - 1);
	const svg = el('svg', { xmlns: NS, version: '1.1', width: r2(ancho), height: r2(alto), viewBox: `0 0 ${r2(ancho)} ${r2(alto)}` });
	let y = 0;
	partes.forEach((p, k) => {
		const gk = el('g', { transform: `translate(0 ${r2(y)})`, class: 'renglon' });
		while (p.firstChild) gk.appendChild(p.firstChild);
		svg.appendChild(gk);
		y += parseFloat(p.getAttribute('height')) + GAP;
		void k;
	});
	svg.geom = { ...g, ancho, alto, renglones: n };
	return svg;
}
