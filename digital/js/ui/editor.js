// Editor libre de diagramas de tiempos: se pinta con el mouse sobre la grilla, sin escribir código.
import { h, descargar, mensajeError } from '../dom.js';
import { aVista, aWaveJSON, cambiarTicks, clonar, deWaveJSON, esBus, nuevoDiagrama, parseWaveJSONTexto, relojCeldas, senalVacia } from '../modelo.js';
import { campo, nota, numero, segmentado, selector, seccion, textoLinea } from './comun.js';

const COLORES_CAMPO = ['#1f6feb', '#c0392b', '#2e7d32', '#b7791f', '#8e44ad', '#0f9d8a'];
const MAX_TICKS = 400;

// ------------------------------------------------------------------ plantillas
// Celdas de un bus a partir de trozos [[largo, 'x' | 'z' | 'texto'], ...]; cada trozo con texto es un bloque propio.
const bus = (trozos) => {
	const celdas = [];
	let k = 1;
	for (const [largo, v] of trozos) {
		const simple = ['x', 'z', '0', '1'].includes(v);
		for (let i = 0; i < largo; i++) celdas.push(simple ? v : { d: v, k });
		if (!simple) k++;
	}
	return celdas;
};

export const PLANTILLAS = {
	basico: {
		nombre: 'Reloj, selección y dato',
		crear() {
			const d = nuevoDiagrama(16);
			d.titulo = 'Lectura de un dato';
			d.senales = [
				{ nombre: 'clk', celdas: relojCeldas(16, 1, '0') },
				{ nombre: 'cs', celdas: ['1', '1', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '1', '1'] },
				{ nombre: 'dato', celdas: bus([[2, 'x'], [2, 'z'], [4, 'D0'], [4, 'D1'], [2, 'z'], [2, 'x']]) },
			];
			d.rejilla = 1;
			return d;
		},
	},
	handshake: {
		nombre: 'Intercambio req / ack',
		crear() {
			const d = nuevoDiagrama(14);
			d.titulo = 'Intercambio req / ack';
			d.senales = [
				{ nombre: 'req', celdas: ['0', '0', '1', '1', '1', '1', '1', '1', '1', '0', '0', '0', '0', '0'] },
				{ nombre: 'ack', celdas: ['0', '0', '0', '0', '1', '1', '1', '1', '1', '1', '1', '0', '0', '0'] },
				{ nombre: 'dato', celdas: bus([[2, 'x'], [8, 'válido'], [4, 'x']]) },
			];
			d.campos = [
				{ a: 2, b: 4, texto: 'espera', color: '#b7791f', nivel: 0 },
				{ a: 4, b: 9, texto: 'transferencia', color: '#1f6feb', nivel: 0 },
			];
			return d;
		},
	},
	vacio: {
		nombre: 'En blanco',
		crear() {
			const d = nuevoDiagrama(16);
			d.senales = [senalVacia('S1', 16, '0')];
			return d;
		},
	},
};

// ------------------------------------------------------------------ historial (deshacer / rehacer)
const HIST = { pasado: [], futuro: [] };
const instantanea = (est) => JSON.stringify(est.d);
function registrar(est) {
	HIST.pasado.push(instantanea(est));
	if (HIST.pasado.length > 200) HIST.pasado.shift();
	HIST.futuro.length = 0;
}
function deshacer(est) {
	if (!HIST.pasado.length) return false;
	HIST.futuro.push(instantanea(est));
	est.d = JSON.parse(HIST.pasado.pop());
	return true;
}
function rehacer(est) {
	if (!HIST.futuro.length) return false;
	HIST.pasado.push(instantanea(est));
	est.d = JSON.parse(HIST.futuro.pop());
	return true;
}

/** Estado inicial del editor. */
export function estadoEditor(est) {
	if (!est.d || !Array.isArray(est.d.senales)) est.d = PLANTILLAS.basico.crear();
	est.d.desplaz ??= {};
	est.pincel ??= '1';
	est.textoDato ??= 'D0';
	est.herramienta ??= 'pincel';
	est.contadorK ??= 100;
	est.unidad ??= 'us';
	return est;
}

/** Reemplaza el diagrama del editor (se puede deshacer). Lo usan los paneles de protocolos ("Enviar al editor"). */
export function cargarEnEditor(est, diagrama) {
	estadoEditor(est);
	registrar(est);
	est.d = clonar(diagrama);
	est.d.desplaz = {};
	delete est.d.pxSugerido;
}

const UNIDADES = { ns: 1e-9, us: 1e-6, ms: 1e-3, s: 1 };
const nombreUnico = (d, base) => {
	let n = base;
	for (let k = 2; d.senales.some((s) => s.nombre === n); k++) n = `${base}${k}`;
	return n;
};
const slug = (t) =>
	String(t || '')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-zA-Z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.toLowerCase();

// ------------------------------------------------------------------ montaje
/**
 * ctx: { panel, est, guardar, mostrar(vista) -> svg, svg(), lienzo, paper, senal (AbortSignal), avisar, zoom() }
 */
export function montarEditor(ctx) {
	const est = estadoEditor(ctx.est);
	let hover = null; // { fi, i }
	let trazo = null; // pintura en curso
	let seleccion = null; // rango de ticks de una etiqueta nueva
	let arrastreCursor = null;
	let editando = null; // input en línea abierto

	const vista = () => {
		const d = est.d;
		d.desplaz ??= {};
		const m = aVista(d);
		return { m, px: 28, nombre: slug(d.titulo) || 'diagrama', sinRenglones: true, desplaz: d.desplaz, antesDeMover: () => registrar(est), alMover: confirmar };
	};
	const dibujar = () => {
		const svg = ctx.mostrar(vista());
		superponer(svg);
		return svg;
	};
	const confirmar = () => {
		ctx.guardar();
		pintarLeyendas();
	};
	/** Cambio con historial: `f` modifica est.d. */
	const cambiar = (f, { reconstruir = false } = {}) => {
		registrar(est);
		f(est.d);
		ctx.guardar();
		dibujar();
		if (reconstruir) armarPanel();
		else pintarLeyendas();
	};

	// ---------------------------------------------------------------- geometría y puntería
	const geom = () => ctx.svg()?.geom;
	function aCoordenadas(e) {
		const svg = ctx.svg();
		if (!svg || !svg.geom) return null;
		const r = svg.getBoundingClientRect();
		const k = svg.geom.ancho / r.width;
		return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k, k };
	}
	function celdaEn(c, acotar = false) {
		const g = geom();
		if (!c || !g) return null;
		let i = Math.floor((c.x - g.L) / g.px);
		const fi = Math.floor((c.y - g.yFilas) / g.filaH);
		const n = est.d.senales.length;
		if (acotar) i = Math.max(0, Math.min(est.d.ticks - 1, i));
		else if (c.x < g.L || i < 0 || i >= est.d.ticks) return null;
		if (fi < 0 || fi >= n) return acotar ? { fi: Math.max(0, Math.min(n - 1, fi)), i } : null;
		return { fi, i };
	}
	const tickEn = (c) => {
		const g = geom();
		return Math.max(0, Math.min(est.d.ticks, Math.round((c.x - g.L) / g.px)));
	};

	// ---------------------------------------------------------------- pintura
	function pintarCelda(fi, i) {
		const s = est.d.senales[fi];
		if (!s) return;
		const p = est.pincel;
		s.celdas[i] = p === 'd' ? { d: est.textoDato, k: trazo.k } : p;
	}
	function pintarTramo(fi, desde, hasta) {
		const paso = hasta >= desde ? 1 : -1;
		for (let i = desde; i !== hasta + paso; i += paso) pintarCelda(fi, i);
	}

	// ---------------------------------------------------------------- superposición (pasar el mouse, selección)
	function superponer(svg) {
		if (!svg || !svg.geom) return;
		const g = svg.geom;
		const NS = 'http://www.w3.org/2000/svg';
		const grupo = document.createElementNS(NS, 'g');
		grupo.setAttribute('class', 'editor-extra');
		grupo.setAttribute('pointer-events', 'none');
		const rect = (x, y, w, hh, at) => {
			const r = document.createElementNS(NS, 'rect');
			const base = { x, y, width: w, height: hh };
			for (const [k, v] of Object.entries({ ...base, ...at })) r.setAttribute(k, String(v));
			grupo.appendChild(r);
		};
		if (est.herramienta === 'pincel' && hover && hover.fi < g.filas.length && hover.i < est.d.ticks) {
			const f = g.filas[hover.fi];
			rect(g.X(hover.i), f.y + 1, g.px, g.filaH - 2, { fill: 'rgba(255,77,31,0.14)', stroke: '#ff4d1f', 'stroke-width': 1, 'stroke-dasharray': '3 2' });
		}
		if (seleccion) {
			const a = Math.min(seleccion.a, seleccion.b);
			const b = Math.max(seleccion.a, seleccion.b) + 1;
			rect(g.X(a), g.yFilas - 4, (b - a) * g.px, est.d.senales.length * g.filaH + 4, { fill: 'rgba(91,200,255,0.22)', stroke: '#5bc8ff', 'stroke-width': 1 });
		}
		if (est.herramienta === 'cursor' && hover) {
			const x = g.X(Math.round((hover.xs - g.L) / g.px));
			const l = document.createElementNS(NS, 'line');
			for (const [k, v] of Object.entries({ x1: x, x2: x, y1: g.yFilas - 4, y2: g.yFilas + est.d.senales.length * g.filaH, stroke: '#0a7c5a', 'stroke-width': 1, 'stroke-dasharray': '2 3', opacity: 0.7 })) l.setAttribute(k, String(v));
			grupo.appendChild(l);
		}
		svg.appendChild(grupo);
	}
	const repintarSuperposicion = () => {
		const svg = ctx.svg();
		if (!svg) return;
		svg.querySelector('.editor-extra')?.remove();
		superponer(svg);
	};

	// ---------------------------------------------------------------- edición en línea (nombre de un bloque, texto de una etiqueta)
	function editarEnLinea({ xs, ys, ancho, valor, alAceptar, alCancelar }) {
		cerrarEdicion();
		const svg = ctx.svg();
		if (!svg) return;
		const r = svg.getBoundingClientRect();
		const rc = ctx.lienzo.getBoundingClientRect();
		const k = r.width / svg.geom.ancho;
		const i = h('input', { type: 'text', class: 'inline-edit', value: valor ?? '', 'aria-label': 'Texto' });
		const w = Math.max(90, ancho * k);
		i.style.width = `${w}px`;
		i.style.left = `${r.left - rc.left + ctx.lienzo.scrollLeft + xs * k - w / 2}px`;
		i.style.top = `${r.top - rc.top + ctx.lienzo.scrollTop + ys * k - 13}px`;
		let hecho = false;
		const terminar = (ok) => {
			if (hecho) return;
			hecho = true;
			const v = i.value;
			i.remove();
			editando = null;
			if (ok) alAceptar(v);
			else alCancelar?.();
		};
		i.addEventListener('keydown', (e) => {
			e.stopPropagation();
			if (e.key === 'Enter') terminar(true);
			else if (e.key === 'Escape') terminar(false);
		});
		i.addEventListener('blur', () => terminar(true));
		ctx.lienzo.append(i);
		editando = i;
		i.focus();
		i.select();
	}
	function cerrarEdicion() {
		if (editando) editando.blur();
	}

	// ---------------------------------------------------------------- eventos del lienzo
	const { paper, senal } = ctx;
	paper.addEventListener(
		'pointerdown',
		(e) => {
			if (e.button !== 0 || e.target.closest?.('.agarre') || est.herramienta === 'mano') return;
			cerrarEdicion();
			const c = aCoordenadas(e);
			if (!c) return;
			if (est.herramienta === 'pincel') {
				const q = celdaEn(c);
				if (!q) return;
				registrar(est);
				trazo = { fi: q.fi, ult: q.i, k: ++est.contadorK };
				pintarTramo(q.fi, q.i, q.i);
				paper.setPointerCapture(e.pointerId);
				dibujar();
				e.preventDefault();
			} else if (est.herramienta === 'cursor') {
				const g = geom();
				const t = tickEn(c);
				const cur = est.d.cursores;
				const cerca = cur.findIndex((q) => Math.abs(g.X(q.t) - c.x) <= 7);
				if (cerca >= 0) {
					registrar(est);
					arrastreCursor = cerca;
				} else if (c.x >= g.L - g.px && c.x <= g.L + g.W + g.px) {
					registrar(est);
					if (cur.length < 2) {
						cur.push({ t, nombre: cur.length ? 'B' : 'A' });
						arrastreCursor = cur.length - 1;
					} else {
						arrastreCursor = Math.abs(cur[0].t - t) <= Math.abs(cur[1].t - t) ? 0 : 1;
						cur[arrastreCursor].t = t;
					}
				} else return;
				paper.setPointerCapture(e.pointerId);
				dibujar();
				e.preventDefault();
			} else if (est.herramienta === 'etiqueta') {
				const q = celdaEn(c, true);
				seleccion = { a: q.i, b: q.i };
				paper.setPointerCapture(e.pointerId);
				repintarSuperposicion();
				e.preventDefault();
			}
		},
		{ signal: senal },
	);
	paper.addEventListener(
		'pointermove',
		(e) => {
			const c = aCoordenadas(e);
			if (!c) return;
			if (trazo) {
				const q = celdaEn(c, true);
				if (q.i !== trazo.ult) {
					pintarTramo(trazo.fi, trazo.ult, q.i);
					trazo.ult = q.i;
					dibujar();
				}
			} else if (arrastreCursor !== null) {
				const t = tickEn(c);
				if (est.d.cursores[arrastreCursor].t !== t) {
					est.d.cursores[arrastreCursor].t = t;
					dibujar();
				}
			} else if (seleccion) {
				const q = celdaEn(c, true);
				if (q.i !== seleccion.b) {
					seleccion.b = q.i;
					repintarSuperposicion();
				}
			} else {
				const q = celdaEn(c);
				const nuevo = q ? { ...q, xs: c.x } : est.herramienta === 'cursor' ? { fi: 0, i: 0, xs: c.x } : null;
				if (JSON.stringify(nuevo) !== JSON.stringify(hover)) {
					hover = nuevo;
					repintarSuperposicion();
				}
			}
		},
		{ signal: senal },
	);
	const soltar = (e) => {
		if (trazo) {
			trazo = null;
			confirmar();
			dibujar();
		} else if (arrastreCursor !== null) {
			arrastreCursor = null;
			confirmar();
			dibujar();
		} else if (seleccion) {
			const a = Math.min(seleccion.a, seleccion.b);
			const b = Math.max(seleccion.a, seleccion.b) + 1;
			seleccion = null;
			crearEtiqueta(a, b);
		}
		if (e && paper.hasPointerCapture?.(e.pointerId)) paper.releasePointerCapture(e.pointerId);
	};
	paper.addEventListener('pointerup', soltar, { signal: senal });
	paper.addEventListener('pointercancel', soltar, { signal: senal });
	paper.addEventListener(
		'pointerleave',
		() => {
			if (hover && !trazo && !seleccion) {
				hover = null;
				repintarSuperposicion();
			}
		},
		{ signal: senal },
	);
	paper.addEventListener(
		'dblclick',
		(e) => {
			if (est.herramienta === 'cursor') {
				const c = aCoordenadas(e);
				const g = geom();
				const cerca = c && est.d.cursores.findIndex((q) => Math.abs(g.X(q.t) - c.x) <= 7);
				if (cerca >= 0) {
					cambiar((d) => d.cursores.splice(cerca, 1));
					e.preventDefault();
				}
				return;
			}
			if (est.herramienta !== 'pincel' || e.target.closest?.('.agarre')) return;
			const c = aCoordenadas(e);
			const q = c && celdaEn(c);
			if (!q) return;
			const celda = est.d.senales[q.fi].celdas[q.i];
			if (!esBus(celda)) return;
			// el bloque completo: celdas contiguas con el mismo texto y k
			const celdas = est.d.senales[q.fi].celdas;
			let a = q.i;
			let b = q.i;
			const igual = (x) => esBus(x) && x.d === celda.d && x.k === celda.k;
			while (a > 0 && igual(celdas[a - 1])) a--;
			while (b < celdas.length - 1 && igual(celdas[b + 1])) b++;
			const g = geom();
			const f = g.filas[q.fi];
			editarEnLinea({
				xs: (g.X(a) + g.X(b + 1)) / 2,
				ys: f.yMed,
				ancho: (b + 1 - a) * g.px,
				valor: celda.d,
				alAceptar: (v) =>
					cambiar((d) => {
						for (let i = a; i <= b; i++) d.senales[q.fi].celdas[i] = { d: v, k: celda.k };
					}),
			});
			est.textoDato = celda.d;
			e.preventDefault();
		},
		{ signal: senal },
	);

	function crearEtiqueta(a, b) {
		registrar(est);
		const d = est.d;
		let nivel = 0;
		while (d.campos.some((c) => (c.nivel ?? 0) === nivel && c.a < b && c.b > a)) nivel++;
		const nuevo = { a, b, texto: '', color: COLORES_CAMPO[d.campos.length % COLORES_CAMPO.length], nivel };
		d.campos.push(nuevo);
		const idx = d.campos.length - 1;
		dibujar();
		const g = geom();
		const yCampo = g.yFilas - 6 - (Math.max(0, d.campos.reduce((n, c) => Math.max(n, (c.nivel ?? 0) + 1), 0) - 1 - nivel) * 24 + 8);
		editarEnLinea({
			xs: (g.X(a) + g.X(b)) / 2,
			ys: Math.max(20, yCampo - 12),
			ancho: (b - a) * g.px,
			valor: '',
			alAceptar: (v) => {
				if (!v.trim()) {
					d.campos.splice(idx, 1);
					HIST.pasado.pop();
				} else d.campos[idx].texto = v.trim();
				ctx.guardar();
				dibujar();
				armarPanel();
			},
			alCancelar: () => {
				d.campos.splice(idx, 1);
				HIST.pasado.pop();
				dibujar();
			},
		});
	}

	// ---------------------------------------------------------------- teclado
	addEventListener(
		'keydown',
		(e) => {
			const t = e.target;
			if (t && (t.closest?.('input, textarea, select, dialog') || t.isContentEditable)) return;
			const k = e.key.toLowerCase();
			if ((e.ctrlKey || e.metaKey) && !e.altKey && (k === 'z' || k === 'y')) {
				e.preventDefault();
				const hecho = k === 'y' || e.shiftKey ? rehacer(est) : deshacer(est);
				if (hecho) {
					ctx.guardar();
					dibujar();
					armarPanel();
				}
				return;
			}
			if (e.ctrlKey || e.metaKey || e.altKey) return;
			const pincel = { 0: '0', 1: '1', x: 'x', z: 'z', d: 'd' }[k];
			if (pincel) {
				est.pincel = pincel;
				est.herramienta = 'pincel';
				ctx.guardar();
				armarPanel();
			}
		},
		{ signal: senal },
	);

	// ---------------------------------------------------------------- panel
	let leyendaCursores;
	let botonDeshacer;
	let botonRehacer;
	function pintarLeyendas() {
		if (botonDeshacer) {
			botonDeshacer.disabled = !HIST.pasado.length;
			botonRehacer.disabled = !HIST.futuro.length;
		}
		if (leyendaCursores) {
			const cs = est.d.cursores;
			if (cs.length < 2) leyendaCursores.textContent = cs.length ? 'Falta el segundo cursor para medir.' : 'Con la herramienta Cursor hacé clic en el diagrama para medir tiempos.';
			else {
				const dt = Math.abs(cs[1].t - cs[0].t);
				const k = est.d.tickTime;
				leyendaCursores.textContent = k ? `Δ = ${dt} ticks` : `Δ = ${dt} ticks (poné la duración de un tick para ver el tiempo)`;
			}
		}
	}

	function armarPanel() {
		const d = est.d;
		const p = ctx.panel;
		p.replaceChildren();

		// --- barra de herramientas
		botonDeshacer = h('button', { type: 'button', class: 'btn btn--chico', title: 'Deshacer (Ctrl+Z)', onclick: () => deshacerClic() }, '↶ Deshacer');
		botonRehacer = h('button', { type: 'button', class: 'btn btn--chico', title: 'Rehacer (Ctrl+Y)', onclick: () => rehacerClic() }, '↷ Rehacer');
		const deshacerClic = () => {
			if (deshacer(est)) {
				ctx.guardar();
				dibujar();
				armarPanel();
			}
		};
		const rehacerClic = () => {
			if (rehacer(est)) {
				ctx.guardar();
				dibujar();
				armarPanel();
			}
		};
		const plantilla = selector([['', 'Plantilla…'], ...Object.entries(PLANTILLAS).map(([k, v]) => [k, v.nombre])], '', (v) => {
			if (!v) return;
			if (!confirmarReemplazo()) return armarPanel();
			cambiar(() => {
				est.d = PLANTILLAS[v].crear();
				est.d.desplaz = {};
			}, { reconstruir: true });
		});
		p.append(seccion('Diagrama', h('div', { class: 'fila-botones fila-botones--arriba' }, botonDeshacer, botonRehacer), campo('Título', textoLinea(d.titulo, (v) => {
			d.titulo = v;
			ctx.guardar();
			dibujar();
		}, { placeholder: 'Sin título' })), campo('Empezar desde', plantilla)));

		p.append(
			seccion(
				'Herramienta',
				segmentado(
					[
						['pincel', 'Pincel', 'Pintar niveles sobre la grilla'],
						['etiqueta', 'Etiqueta', 'Arrastrá sobre unos ticks para ponerles un texto'],
						['cursor', 'Cursor', 'Medir tiempos entre dos puntos'],
						['mano', 'Mano', 'Solo mover la vista (útil en pantallas táctiles)'],
					],
					est.herramienta,
					(v) => {
						est.herramienta = v;
						ctx.guardar();
						armarPanel();
						ctx.lienzo.dataset.herramienta = v;
						repintarSuperposicion();
					},
					'Herramienta',
				),
				est.herramienta === 'pincel'
					? h(
							'div',
							{},
							h('div', { class: 'paleta', role: 'group', 'aria-label': 'Pincel' }, [
								['0', '0', 'Nivel bajo (0)'],
								['1', '1', 'Nivel alto (1)'],
								['x', 'X', 'Indefinido, no importa (X)'],
								['z', 'Z', 'Alta impedancia, desconectado (Z)'],
								['d', 'Dato', 'Bloque de bus con texto'],
								['-', 'Vacío', 'Sin dibujo'],
							].map(([v, t, titulo]) =>
								h('button', { type: 'button', class: 'paleta__b', 'aria-pressed': String(est.pincel === v), title: `${titulo}${'01xzd'.includes(v) ? ` · tecla ${v.toUpperCase()}` : ''}`, onclick: () => {
									est.pincel = v;
									ctx.guardar();
									armarPanel();
								} }, t),
							)),
							est.pincel === 'd' ? campo('Texto del bloque', textoLinea(est.textoDato, (v) => (est.textoDato = v), { placeholder: 'D0, 0x3F, ADDR…' }), 'Doble clic sobre un bloque para cambiar su texto.') : null,
							nota('Hacé clic o arrastrá sobre la grilla. Teclas: 0 1 X Z D.'),
						)
					: est.herramienta === 'etiqueta'
						? nota('Arrastrá sobre los ticks que querés agrupar y escribí el texto (por ejemplo "START" o "Dirección").')
						: est.herramienta === 'cursor'
							? h('div', {}, nota('Clic para poner A y B; arrastrá un cursor para moverlo; doble clic lo quita.'), (leyendaCursores = h('p', { class: 'nota nota--medida' })), h('div', { class: 'fila-botones' }, h('button', { type: 'button', class: 'btn btn--chico', onclick: () => cambiar((dd) => (dd.cursores = []), { reconstruir: true }) }, 'Quitar cursores')))
							: nota('La vista se mueve arrastrando. Para volver a dibujar elegí Pincel.'),
			),
		);

		// --- señales
		const lista = h('div', { class: 'filas' });
		d.senales.forEach((s, fi) => {
			const accion = selector(
				[
					['', 'Rellenar…'],
					['clk1', 'Reloj (medio período 1)'],
					['clk2', 'Reloj (medio período 2)'],
					['clk4', 'Reloj (medio período 4)'],
					['0', 'Todo en 0'],
					['1', 'Todo en 1'],
					['z', 'Todo en Z'],
					['dup', 'Duplicar fila'],
				],
				'',
				(v) => {
					if (!v) return;
					cambiar(
						(dd) => {
							const t = dd.senales[fi];
							if (v.startsWith('clk')) t.celdas = relojCeldas(dd.ticks, Number(v.slice(3)), '0');
							else if (v === 'dup') dd.senales.splice(fi + 1, 0, { nombre: nombreUnico(dd, t.nombre), celdas: clonar(t.celdas) });
							else t.celdas = Array.from({ length: dd.ticks }, () => v);
						},
						{ reconstruir: true },
					);
				},
				{ 'aria-label': `Rellenar la señal ${s.nombre}`, class: 'fila-sel' },
			);
			const nombre = textoLinea(s.nombre, (v) => {
				s.nombre = v;
				ctx.guardar();
				dibujar();
			}, { 'aria-label': 'Nombre de la señal' });
			nombre.addEventListener('focus', () => registrar(est), { once: true });
			lista.append(
				h(
					'div',
					{ class: 'fila-senal' },
					nombre,
					h('button', { type: 'button', class: 'btn btn--icon btn--chico', title: 'Subir', 'aria-label': 'Subir', disabled: fi === 0, onclick: () => cambiar((dd) => dd.senales.splice(fi - 1, 0, dd.senales.splice(fi, 1)[0]), { reconstruir: true }) }, '↑'),
					h('button', { type: 'button', class: 'btn btn--icon btn--chico', title: 'Bajar', 'aria-label': 'Bajar', disabled: fi === d.senales.length - 1, onclick: () => cambiar((dd) => dd.senales.splice(fi + 1, 0, dd.senales.splice(fi, 1)[0]), { reconstruir: true }) }, '↓'),
					h('button', { type: 'button', class: 'btn btn--icon btn--chico btn--peligro', title: 'Quitar', 'aria-label': 'Quitar señal', onclick: () => cambiar((dd) => {
						dd.senales.splice(fi, 1);
						dd.marcas = dd.marcas.filter((m) => m.fila !== fi).map((m) => (m.fila > fi ? { ...m, fila: m.fila - 1 } : m));
					}, { reconstruir: true }) }, '×'),
					accion,
				),
			);
		});
		const agregar = (base, celdas) => cambiar((dd) => dd.senales.push({ nombre: nombreUnico(dd, base), celdas: celdas(dd.ticks) }), { reconstruir: true });
		p.append(
			seccion(
				'Señales',
				lista,
				h('div', { class: 'fila-botones' },
					h('button', { type: 'button', class: 'btn btn--chico', onclick: () => agregar('S', (n) => Array.from({ length: n }, () => '0')) }, '+ Señal'),
					h('button', { type: 'button', class: 'btn btn--chico', onclick: () => agregar('clk', (n) => relojCeldas(n, 1, '0')) }, '+ Reloj'),
					h('button', { type: 'button', class: 'btn btn--chico', onclick: () => agregar('bus', (n) => Array.from({ length: n }, () => 'x')) }, '+ Bus'),
				),
			),
		);

		// --- etiquetas
		if (d.campos.length) {
			const ls = h('div', { class: 'filas' });
			d.campos.forEach((c, ci) => {
				const t = textoLinea(c.texto, (v) => {
					c.texto = v;
					ctx.guardar();
					dibujar();
				}, { 'aria-label': `Texto de la etiqueta ${ci + 1}` });
				t.addEventListener('focus', () => registrar(est), { once: true });
				ls.append(
					h('div', { class: 'fila-etiqueta' }, h('span', { class: 'rango', style: `border-color:${c.color}` }, `${c.a}–${c.b}`), t, h('button', { type: 'button', class: 'btn btn--icon btn--chico btn--peligro', 'aria-label': 'Quitar etiqueta', title: 'Quitar', onclick: () => cambiar((dd) => dd.campos.splice(ci, 1), { reconstruir: true }) }, '×')),
				);
			});
			p.append(seccion('Etiquetas', ls));
		}

		// --- tiempo y grilla
		const unidad = est.unidad;
		const duracion = d.tickTime ? Number((d.tickTime / UNIDADES[unidad]).toPrecision(6)) : '';
		const regla = selector(
			[
				['ticks', 'Numerar ticks'],
				['tiempo', 'Mostrar tiempo'],
				['ninguna', 'Sin regla'],
			],
			d.regla,
			(v) => cambiar((dd) => (dd.regla = v)),
		);
		const durInput = numero(duracion === '' ? '' : duracion, (v) => {
			d.tickTime = v > 0 ? v * UNIDADES[est.unidad] : null;
			if (d.tickTime && d.regla === 'ticks') d.regla = 'tiempo';
			ctx.guardar();
			dibujar();
		}, { min: 0, step: 'any', ancho: '100%', placeholder: 'sin tiempo' });
		durInput.addEventListener('focus', () => registrar(est), { once: true });
		durInput.addEventListener('change', () => armarPanel());
		p.append(
			seccion(
				'Tiempo y grilla',
				campo('Cantidad de ticks', [numero(d.ticks, (v) => {
					if (v >= 1 && v <= MAX_TICKS && v !== d.ticks) cambiar((dd) => cambiarTicks(dd, v));
				}, { min: 1, max: MAX_TICKS, ancho: '100%' })], `Hasta ${MAX_TICKS}. Los ticks nuevos copian el último valor.`),
				h('div', { class: 'campo' }, h('span', {}, 'Duración de un tick'), h('div', { class: 'campo__fila' }, durInput, selector([['ns', 'ns'], ['us', 'µs'], ['ms', 'ms'], ['s', 's']], unidad, (u) => {
					est.unidad = u;
					if (d.tickTime) {
						// mantiene el número que se ve y cambia el valor real
						const v = parseFloat(durInput.value);
						if (v > 0) d.tickTime = v * UNIDADES[u];
					}
					ctx.guardar();
					dibujar();
				}))),
				campo('Regla de arriba', regla),
				campo('Grilla vertical cada', selector([[1, '1 tick'], [2, '2 ticks'], [4, '4 ticks'], [8, '8 ticks']], d.rejilla || 1, (v) => cambiar((dd) => (dd.rejilla = v)))),
			),
		);

		// --- intercambio
		p.append(
			seccion(
				'WaveJSON (WaveDrom)',
				nota('Formato de WaveDrom: sirve para llevar diagramas a otros programas o traer los que ya tenés.'),
				h('div', { class: 'fila-botones' },
					h('button', { type: 'button', class: 'btn btn--chico', onclick: abrirImportar }, 'Importar…'),
					h('button', { type: 'button', class: 'btn btn--chico', onclick: copiarJSON }, 'Copiar'),
					h('button', { type: 'button', class: 'btn btn--chico', onclick: () => descargar(new Blob([textoJSON()], { type: 'application/json' }), `${slug(d.titulo) || 'diagrama'}.json`) }, 'Descargar .json'),
				),
			),
		);
		pintarLeyendas();
	}

	const confirmarReemplazo = () => !est.d.senales.some((s) => s.celdas.length) || confirm('Se va a reemplazar el diagrama actual (se puede deshacer con Ctrl+Z). ¿Seguir?');
	const textoJSON = () => JSON.stringify(aWaveJSON(est.d), null, 2);
	async function copiarJSON() {
		try {
			await navigator.clipboard.writeText(textoJSON());
			ctx.avisar('WaveJSON copiado al portapapeles.');
		} catch (e) {
			ctx.avisar(`No se pudo copiar: ${mensajeError(e)}`);
		}
	}

	// --- importar WaveJSON (ventana con área de texto)
	let dlg = null;
	function abrirImportar() {
		if (!dlg) {
			const area = h('textarea', { rows: 12, class: 'json-area', spellcheck: 'false', placeholder: '{ "signal": [\n  { "name": "clk", "wave": "p...." },\n  { "name": "dato", "wave": "x.34x", "data": ["A", "B"] }\n] }' });
			const error = h('p', { class: 'aviso aviso--error', hidden: true });
			const archivo = h('input', { type: 'file', accept: '.json,.js,text/plain,application/json', hidden: true });
			archivo.addEventListener('change', async () => {
				const f = archivo.files[0];
				if (f) area.value = await f.text();
				archivo.value = '';
			});
			const aceptar = () => {
				try {
					const nuevo = deWaveJSON(parseWaveJSONTexto(area.value));
					if (nuevo.ticks > MAX_TICKS) throw new Error(`El diagrama tiene ${nuevo.ticks} ticks y el máximo es ${MAX_TICKS}.`);
					cambiar(() => {
						est.d = nuevo;
						est.d.desplaz = {};
					}, { reconstruir: true });
					dlg.close();
				} catch (e) {
					error.hidden = false;
					error.textContent = `No se pudo leer: ${mensajeError(e)}`;
				}
			};
			dlg = h('dialog', { class: 'dlg dlg--chico' },
				h('div', { class: 'dlg__bar' }, h('span', {}, 'Importar WaveJSON'), h('button', { type: 'button', class: 'btn btn--icon', 'aria-label': 'Cerrar', onclick: () => dlg.close() }, '×')),
				h('div', { class: 'dlg__cuerpo dlg__cuerpo--form' },
					h('p', {}, 'Pegá el código de WaveDrom (el contenido de ', h('code', {}, 'signal'), ') o abrí un archivo. Los relojes ', h('code', {}, 'p'), ' y ', h('code', {}, 'n'), ' usan dos ticks por período.'),
					area, error,
					h('div', { class: 'fila-botones' }, h('button', { type: 'button', class: 'btn btn--chico', onclick: () => archivo.click() }, 'Abrir archivo…'), h('span', { class: 'grow' }), h('button', { type: 'button', class: 'btn btn--chico', onclick: () => dlg.close() }, 'Cancelar'), h('button', { type: 'button', class: 'btn btn--primario btn--chico', onclick: aceptar }, 'Importar')),
					archivo,
				),
			);
			dlg.addEventListener('pointerdown', (e) => {
				if (e.target === dlg) dlg.close();
			});
			document.body.append(dlg);
			dlg._error = error;
		}
		dlg._error.hidden = true;
		dlg.showModal();
	}
	senal.addEventListener('abort', () => {
		dlg?.remove();
		dlg = null;
		cerrarEdicion();
	});

	ctx.lienzo.dataset.herramienta = est.herramienta;
	armarPanel();
	dibujar();
	// la interfaz de afuera puede pedir un redibujado (por ejemplo al cambiar el aspecto)
	return { redibujar: dibujar, deshacer: deshacerExterno, rehacer: rehacerExterno };

	function deshacerExterno() {
		if (deshacer(est)) {
			ctx.guardar();
			dibujar();
			armarPanel();
		}
	}
	function rehacerExterno() {
		if (rehacer(est)) {
			ctx.guardar();
			dibujar();
			armarPanel();
		}
	}
}

