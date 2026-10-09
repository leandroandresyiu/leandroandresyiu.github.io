// Digital: diagramas de tiempos y tramas UART · SPI · I²C · CAN. Todo corre en el navegador.
import { $, descargar, h, memoria, mensajeError } from './dom.js';
import { copiarPNG, pdfDe, pngDe, svgTexto } from './exportar.js';
import { deWaveJSON, parseWaveJSONTexto } from './modelo.js';
import { OPC, renderRenglones } from './render.js';
import AYUDA from './ayuda.js';
import { casilla, segmentado } from './ui/comun.js';
import { cargarEnEditor, estadoEditor, montarEditor } from './ui/editor.js';
import { montarConversor } from './ui/conversor.js';
import { PROTOCOLOS } from './ui/protocolos.js';

const NS = 'http://www.w3.org/2000/svg';
const CLAVE = 'digital.v1';

const SECCIONES = [{ id: 'diagrama', nombre: 'Diagrama', sub: 'Editor libre de diagramas de tiempos: pintá los niveles con el mouse.', montar: (_modo, ctx) => montarEditor(ctx) }, ...PROTOCOLOS];

// ------------------------------------------------------------------ estado guardado
const ASPECTO_BASE = { ancho: 100, filaH: 40, tam: 14, linea: 1.6, nombres: true, rejilla: true, bandas: true, fondo: true, dpi: 300, escalaPdf: 75, renglones: false, anchoRenglon: 900 };
const ESTADO = memoria.leer(CLAVE, {}) || {};
ESTADO.tab = SECCIONES.some((s) => s.id === ESTADO.tab) ? ESTADO.tab : 'diagrama';
ESTADO.modos ??= {};
ESTADO.proto ??= {};
ESTADO.editor ??= {};
ESTADO.aspecto = { ...ASPECTO_BASE, ...(ESTADO.aspecto || {}) };

let pendiente = 0;
function guardar() {
	clearTimeout(pendiente);
	pendiente = setTimeout(() => memoria.escribir(CLAVE, ESTADO), 250);
}
addEventListener('pagehide', () => memoria.escribir(CLAVE, ESTADO));

// ------------------------------------------------------------------ elementos
const lienzo = $('#lienzo');
const paper = $('#paper');
const vacio = $('#vacio');
const panelEl = $('#panel');
const resultadosEl = $('#resultados');
const stageEl = $('.stage');
const resumen = $('#resumen');
const host = $('#host');

let zoom = 1; // 'fit' o un número
let ultimaVista = null; // lo último que se mostró: { vista, m, opc }
let svgActual = null;
let modulo = null; // lo que devolvió montar(): { redibujar?, ... }
let ctrl = null; // AbortController del panel montado
let claveActual = '';
let csvPendiente = null; // un CSV recién abierto que espera al modo Osciloscopio (no se guarda: pesa mucho)

// ------------------------------------------------------------------ vista previa
const desplazApp = {}; // clave -> { firma, obj, pila } para las pestañas que no guardan los textos movidos

function desplazDe(vista) {
	if (vista.desplaz) return { obj: vista.desplaz, pila: null };
	const firma = JSON.stringify([vista.m.titulo, vista.m.senales.map((s) => s.nombre), vista.m.campos.map((c) => c.texto)]);
	let e = desplazApp[claveActual];
	if (!e || e.firma !== firma) e = desplazApp[claveActual] = { firma, obj: {}, pila: [] };
	return e;
}

function mostrarVacio(titulo, texto) {
	paper.hidden = true;
	paper.replaceChildren();
	svgActual = null;
	ultimaVista = null;
	vacio.hidden = false;
	$('#vacio-t').textContent = titulo || 'Todavía no hay nada para dibujar';
	$('#vacio-p').textContent = texto || 'Completá los datos de la izquierda.';
	$('#dim').textContent = '';
	$('#t-devolver').hidden = true;
	$('#t-renglones').hidden = true;
	for (const id of ['d-copiar', 'd-png', 'd-svg', 'd-pdf']) $(`#${id}`).disabled = true;
	resumen.innerHTML = '&nbsp;';
}

/** Dibuja `vista` ({ m, px, nombre, desplaz? }) en la vista previa y devuelve el <svg>. Con null deja la pantalla vacía. */
function mostrar(vista, vacioInfo = {}) {
	if (!vista) {
		mostrarVacio(vacioInfo.titulo, vacioInfo.texto);
		return null;
	}
	const A = ESTADO.aspecto;
	const des = desplazDe(vista);
	const m = { ...vista.m, desplaz: des.obj, rejilla: A.rejilla ? vista.m.rejilla : null, bandas: A.bandas ? vista.m.bandas : false };
	const opc = { px: (vista.px || OPC.px) * (A.ancho / 100), filaH: A.filaH, tam: A.tam, linea: A.linea, nombres: A.nombres };
	const maxAncho = !vista.sinRenglones && A.renglones ? A.anchoRenglon : 0;
	const svg = renderRenglones(m, opc, maxAncho);
	ultimaVista = { vista, m, opc, des, maxAncho };
	svgActual = svg;
	vacio.hidden = true;
	paper.hidden = false;
	paper.replaceChildren(svg);
	aplicarZoom();
	if (!vista.sinAgarres) ponerAgarres(svg, m.desplaz);
	$('#dim').textContent = `${Math.round(svg.geom.ancho)} × ${Math.round(svg.geom.alto)} px${svg.geom.renglones ? ` · ${svg.geom.renglones} renglones` : ''}`;
	const bR = $('#t-renglones');
	bR.hidden = !!vista.sinRenglones;
	bR.setAttribute('aria-pressed', String(!!A.renglones));
	$('#t-devolver').hidden = !Object.keys(m.desplaz).length;
	for (const id of ['d-copiar', 'd-png', 'd-svg', 'd-pdf']) $(`#${id}`).disabled = false;
	if (!textoTemporal) resumen.textContent = vista.resumen || `${vista.m.senales.length} señal${vista.m.senales.length === 1 ? '' : 'es'}`;
	return svg;
}
const repintar = () => (modulo?.redibujar ? modulo.redibujar() : ultimaVista && mostrar(ultimaVista.vista));

function aplicarZoom() {
	const svg = svgActual;
	if (!svg) return;
	const { ancho, alto } = svg.geom;
	let z = zoom;
	if (zoom === 'fit') z = Math.min(Math.max(0.2, (lienzo.clientWidth - 48) / ancho), Math.max(0.2, (lienzo.clientHeight - 48) / alto), 3);
	svg.style.width = `${ancho * z}px`;
	svg.style.height = `${alto * z}px`;
	$('#z-valor').textContent = zoom === 'fit' ? 'Ajustar' : `${Math.round(z * 100)} %`;
	paper.dataset.z = String(z);
}
const zoomActual = () => parseFloat(paper.dataset.z || '1') || 1;
function cambiarZoom(factor) {
	const z = Math.min(6, Math.max(0.15, zoomActual() * factor));
	const cx = (lienzo.scrollLeft + lienzo.clientWidth / 2) / (paper.scrollWidth || 1);
	zoom = z;
	aplicarZoom();
	lienzo.scrollLeft = cx * paper.scrollWidth - lienzo.clientWidth / 2;
}

// ------------------------------------------------------------------ mover textos
function ponerAgarres(svg, desplaz) {
	const g = document.createElementNS(NS, 'g');
	g.setAttribute('class', 'agarres');
	svg.querySelectorAll('text[data-tid]').forEach((t) => {
		let bb;
		try {
			bb = t.getBBox();
		} catch {
			return;
		}
		if (!bb.width || !bb.height) return;
		const r = document.createElementNS(NS, 'rect');
		const p = 3;
		for (const [k, v] of Object.entries({ x: bb.x - p, y: bb.y - p, width: bb.width + 2 * p, height: bb.height + 2 * p, class: 'agarre' + (desplaz[t.dataset.tid] ? ' movido' : ''), 'data-tid': t.dataset.tid })) r.setAttribute(k, String(v));
		g.appendChild(r);
	});
	svg.appendChild(g);
}

function antesDeMover() {
	const { vista, des } = ultimaVista;
	if (vista.antesDeMover) vista.antesDeMover();
	else if (des.pila) {
		des.pila.push(JSON.stringify(des.obj));
		if (des.pila.length > 100) des.pila.shift();
	}
}
function despuesDeMover() {
	ultimaVista.vista.alMover?.();
	guardar();
	repintar();
}
function devolverTextos(tid) {
	if (!ultimaVista) return;
	const o = ultimaVista.des.obj;
	if (tid != null ? !o[tid] : !Object.keys(o).length) return;
	antesDeMover();
	if (tid != null) delete o[tid];
	else for (const k of Object.keys(o)) delete o[k];
	despuesDeMover();
}
function deshacerTextos() {
	if (!ultimaVista || !ultimaVista.des.pila || !ultimaVista.des.pila.length) return false;
	const e = ultimaVista.des;
	const ant = JSON.parse(e.pila.pop());
	for (const k of Object.keys(e.obj)) delete e.obj[k];
	Object.assign(e.obj, ant);
	repintar();
	return true;
}

function enlazarTextos() {
	let d = null;
	const aUsuario = (svg, e) => {
		const pt = svg.createSVGPoint();
		pt.x = e.clientX;
		pt.y = e.clientY;
		return pt.matrixTransform(svg.getScreenCTM().inverse());
	};
	lienzo.addEventListener('pointerdown', (e) => {
		const r = e.target.closest?.('.agarre');
		if (!r || e.button !== 0 || !svgActual || !ultimaVista) return;
		const tid = r.getAttribute('data-tid');
		const t = [...svgActual.querySelectorAll('text[data-tid]')].find((x) => x.dataset.tid === tid);
		if (!t) return;
		e.preventDefault();
		const m0 = ultimaVista.des.obj[tid] || [0, 0];
		d = { svg: svgActual, tid, t, r, m0, p0: aUsuario(svgActual, e), moved: false, nx: m0[0], ny: m0[1] };
		lienzo.setPointerCapture(e.pointerId);
		r.classList.add('moviendo');
		lienzo.classList.add('moviendo-texto');
	});
	lienzo.addEventListener('pointermove', (e) => {
		if (!d) return;
		const p = aUsuario(d.svg, e);
		let dx = p.x - d.p0.x;
		let dy = p.y - d.p0.y;
		if (e.shiftKey) {
			if (Math.abs(dx) > Math.abs(dy)) dy = 0;
			else dx = 0;
		}
		d.nx = +(d.m0[0] + dx).toFixed(2);
		d.ny = +(d.m0[1] + dy).toFixed(2);
		d.moved = d.moved || Math.abs(dx) + Math.abs(dy) > 0.5;
		const tr = `translate(${+dx.toFixed(2)} ${+dy.toFixed(2)})`;
		d.t.setAttribute('transform', tr);
		d.r.setAttribute('transform', tr);
	});
	const fin = () => {
		if (!d) return;
		const { tid, moved, nx, ny, m0 } = d;
		d = null;
		lienzo.classList.remove('moviendo-texto');
		if (moved && (nx !== m0[0] || ny !== m0[1])) {
			antesDeMover();
			if (Math.abs(nx) < 0.01 && Math.abs(ny) < 0.01) delete ultimaVista.des.obj[tid];
			else ultimaVista.des.obj[tid] = [nx, ny];
			despuesDeMover();
		} else repintar();
	};
	lienzo.addEventListener('pointerup', fin);
	lienzo.addEventListener('pointercancel', fin);
	lienzo.addEventListener('dblclick', (e) => {
		const r = e.target.closest?.('.agarre');
		if (r) devolverTextos(r.getAttribute('data-tid'));
	});
	$('#t-devolver').addEventListener('click', () => devolverTextos(null));
	$('#t-renglones').addEventListener('click', () => {
		ESTADO.aspecto.renglones = !ESTADO.aspecto.renglones;
		guardar();
		repintar();
	});
	addEventListener('keydown', (e) => {
		if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') || e.shiftKey) return;
		if (e.target.closest?.('input, textarea, select, dialog')) return;
		if (ESTADO.tab === 'diagrama') return; // el editor tiene su propio historial
		if (deshacerTextos()) e.preventDefault();
	});
}

function enlazarArrastre() {
	let activo = false;
	let x0 = 0;
	let y0 = 0;
	let sx = 0;
	let sy = 0;
	const puede = () => !lienzo.dataset.herramienta || lienzo.dataset.herramienta === 'mano';
	lienzo.addEventListener('pointerdown', (e) => {
		if (e.button !== 0 || !puede() || e.target.closest('button, input, .agarre')) return;
		activo = true;
		x0 = e.clientX;
		y0 = e.clientY;
		sx = lienzo.scrollLeft;
		sy = lienzo.scrollTop;
		lienzo.setPointerCapture(e.pointerId);
		lienzo.classList.add('arrastrando');
	});
	lienzo.addEventListener('pointermove', (e) => {
		if (!activo) return;
		lienzo.scrollLeft = sx - (e.clientX - x0);
		lienzo.scrollTop = sy - (e.clientY - y0);
	});
	const fin = () => {
		activo = false;
		lienzo.classList.remove('arrastrando');
	};
	lienzo.addEventListener('pointerup', fin);
	lienzo.addEventListener('pointercancel', fin);
	lienzo.addEventListener(
		'wheel',
		(e) => {
			if (!(e.ctrlKey || e.metaKey) || paper.hidden) return;
			e.preventDefault();
			cambiarZoom(e.deltaY < 0 ? 1.15 : 1 / 1.15);
		},
		{ passive: false },
	);
}

// ------------------------------------------------------------------ avisos
let textoTemporal = false;
let temporizador = 0;
function avisar(t) {
	resumen.textContent = t;
	textoTemporal = true;
	clearTimeout(temporizador);
	temporizador = setTimeout(() => {
		textoTemporal = false;
		if (ultimaVista) resumen.textContent = ultimaVista.vista.resumen || `${ultimaVista.vista.m.senales.length} señales`;
		else resumen.innerHTML = '&nbsp;';
	}, 4500);
}

// ------------------------------------------------------------------ exportar
const nombreArchivo = () => (ultimaVista?.vista.nombre || 'digital').replace(/[^\w.-]+/g, '-');
const svgExport = () => renderRenglones(ultimaVista.m, ultimaVista.opc, ultimaVista.maxAncho);

async function conEspera(boton, texto, tarea) {
	const previo = boton.innerHTML;
	const previoDis = boton.disabled;
	boton.disabled = true;
	if (texto) boton.textContent = texto;
	try {
		await tarea();
	} catch (e) {
		avisar(`No se pudo exportar: ${mensajeError(e)}`);
		console.error(e);
	} finally {
		boton.innerHTML = previo;
		boton.disabled = previoDis;
	}
}
function copiarImagen(boton) {
	if (!ultimaVista) return;
	const A = ESTADO.aspecto;
	const tarea = async () => {
		const p = pngDe(svgExport(), { fondo: true, escala: A.escalaPdf / 100, dpi: A.dpi });
		await copiarPNG(p);
		avisar('Imagen copiada: pegala en tu informe con Ctrl+V.');
	};
	if (boton) return conEspera(boton, 'Copiando…', tarea);
	return tarea().catch((e) => avisar(`No se pudo copiar: ${mensajeError(e)}`));
}
function enlazarExportar() {
	$('#d-pdf').addEventListener('click', (e) =>
		conEspera(e.currentTarget, 'Generando…', async () => {
			const A = ESTADO.aspecto;
			descargar(await pdfDe(svgExport(), { fondo: A.fondo, escala: A.escalaPdf / 100, titulo: ultimaVista.m.titulo || 'Digital', host }), `${nombreArchivo()}.pdf`);
		}),
	);
	$('#d-svg').addEventListener('click', (e) =>
		conEspera(e.currentTarget, 'Generando…', async () => {
			descargar(new Blob([(await svgTexto(svgExport(), ESTADO.aspecto.fondo)).texto], { type: 'image/svg+xml' }), `${nombreArchivo()}.svg`);
		}),
	);
	$('#d-png').addEventListener('click', (e) =>
		conEspera(e.currentTarget, 'Generando…', async () => {
			const A = ESTADO.aspecto;
			descargar(await pngDe(svgExport(), { fondo: A.fondo, escala: A.escalaPdf / 100, dpi: A.dpi }), `${nombreArchivo()}.png`);
		}),
	);
	$('#d-copiar').addEventListener('click', (e) => copiarImagen(e.currentTarget));
	addEventListener('keydown', (e) => {
		if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') || e.shiftKey || e.altKey) return;
		const t = e.target;
		if (t && (t.closest?.('input, textarea, select, dialog') || t.isContentEditable)) return;
		if (String(getSelection() || '') || paper.hidden) return;
		e.preventDefault();
		copiarImagen(null);
	});
}

// ------------------------------------------------------------------ panel: aspecto (común a todas las pestañas)
function panelAspecto() {
	const A = ESTADO.aspecto;
	const cambio = () => {
		guardar();
		repintar();
	};
	const rango = (etiqueta, clave, min, max, paso, fmt) => {
		const out = h('output', {}, fmt(A[clave]));
		const i = h('input', { type: 'range', min, max, step: paso, value: String(A[clave]), 'aria-label': etiqueta });
		i.addEventListener('input', () => {
			A[clave] = parseFloat(i.value);
			out.textContent = fmt(A[clave]);
			cambio();
		});
		return h('label', { class: 'campo' }, h('span', {}, etiqueta, out), i);
	};
	return h(
		'details',
		{ class: 'aspecto' },
		h('summary', {}, 'Aspecto y exportación'),
		rango('Ancho del dibujo', 'ancho', 40, 300, 5, (v) => `${v} %`),
		casilla('Dividir en renglones las tramas largas', 'también está el botón Renglones arriba', A.renglones, (v) => ((A.renglones = v), cambio())),
		rango('Ancho máximo de cada renglón', 'anchoRenglon', 400, 2000, 50, (v) => `${v} px`),
		rango('Alto de cada fila', 'filaH', 28, 80, 2, (v) => `${v}`),
		rango('Tamaño de letra', 'tam', 9, 24, 1, (v) => `${v}`),
		rango('Grosor de las líneas', 'linea', 0.8, 3.5, 0.1, (v) => v.toFixed(1)),
		casilla('Nombres de las señales', '', A.nombres, (v) => ((A.nombres = v), cambio())),
		casilla('Grilla vertical', '', A.rejilla, (v) => ((A.rejilla = v), cambio())),
		casilla('Bandas de color de las etiquetas', '', A.bandas, (v) => ((A.bandas = v), cambio())),
		casilla('Fondo blanco', 'en PDF, SVG y PNG', A.fondo, (v) => ((A.fondo = v), guardar())),
		rango('Escala del PDF y del PNG', 'escalaPdf', 40, 200, 5, (v) => `${v} %`),
		h('label', { class: 'campo' }, h('span', {}, 'Resolución del PNG'), h('select', { onchange: (e) => ((A.dpi = parseInt(e.target.value, 10)), guardar()) }, [150, 300, 600].map((v) => h('option', { value: String(v), selected: A.dpi === v }, `${v} dpi`)))),
		h('button', { type: 'button', class: 'btn btn--chico', onclick: () => {
			Object.assign(A, ASPECTO_BASE);
			guardar();
			montar();
		} }, 'Volver a los valores originales'),
	);
}

// ------------------------------------------------------------------ pestañas y paneles
function pintarTabs() {
	const nav = $('#tabs');
	nav.replaceChildren(
		...SECCIONES.map((s) =>
			h('button', { type: 'button', class: 'tab', role: 'tab', 'aria-selected': String(s.id === ESTADO.tab), onclick: () => irA(s.id) }, s.nombre),
		),
	);
}
function irA(id, modo) {
	if (!SECCIONES.some((s) => s.id === id)) return;
	ESTADO.tab = id;
	if (modo) ESTADO.modos[id] = modo;
	guardar();
	pintarTabs();
	montar();
}

function montar() {
	ctrl?.abort();
	ctrl = new AbortController();
	modulo = null;
	const sec = SECCIONES.find((s) => s.id === ESTADO.tab);
	const modo = sec.modos ? (sec.modos.some(([m]) => m === ESTADO.modos[sec.id]) ? ESTADO.modos[sec.id] : sec.modos[0][0]) : 'unico';
	claveActual = `${sec.id}.${modo}`;
	resultadosEl.hidden = true;
	resultadosEl.replaceChildren();
	stageEl.classList.remove('con-resultados');
	lienzo.dataset.herramienta = '';
	mostrar(null);

	const cab = h('section', { class: 'sec sec--cab' });
	if (sec.modos) {
		cab.append(
			segmentado(
				sec.modos.map(([m, t, titulo]) => [m, t, titulo]),
				modo,
				(m) => {
					ESTADO.modos[sec.id] = m;
					guardar();
					montar();
				},
				'Modo',
			),
		);
	}
	if (sec.sub) cab.append(h('p', { class: 'sub' }, sec.sub));
	const cuerpo = h('div', { class: 'cuerpo' });
	panelEl.replaceChildren(cab, cuerpo, panelAspecto());
	panelEl.scrollTop = 0;

	const est = sec.id === 'diagrama' ? estadoEditor(ESTADO.editor) : (ESTADO.proto[claveActual] ??= {});
	const ctx = {
		panel: cuerpo,
		est,
		guardar,
		mostrar,
		svg: () => svgActual,
		lienzo,
		paper,
		senal: ctrl.signal,
		avisar,
		aspecto: ESTADO.aspecto,
		resultados(nodo) {
			resultadosEl.replaceChildren();
			resultadosEl.hidden = !nodo;
			stageEl.classList.toggle('con-resultados', !!nodo);
			if (nodo) resultadosEl.append(nodo);
		},
		alEditor(diagrama) {
			cargarEnEditor(ESTADO.editor, diagrama);
			guardar();
			irA('diagrama');
			avisar('Diagrama enviado al editor: ahí podés cambiarlo a mano (Ctrl+Z para volver atrás).');
		},
		irA,
		zoomA: (z) => {
			zoom = z;
			aplicarZoom();
		},
		desplazarA: (x) => {
			lienzo.scrollLeft = x;
		},
		alSoltar: null,
		tomarCsv() {
			const c = csvPendiente;
			csvPendiente = null;
			return c;
		},
	};
	try {
		modulo = sec.montar(modo, ctx) || null;
	} catch (e) {
		console.error(e);
		panelEl.firstChild.after(h('div', { class: 'aviso aviso--error' }, `Algo falló al armar el panel: ${mensajeError(e)}`));
	}
	ctxActual = ctx;
}
let ctxActual = null;

// ------------------------------------------------------------------ archivos
async function abrirArchivos(lista) {
	const f = lista && lista[0];
	if (!f) return;
	try {
		const texto = await f.text();
		const t = texto.trimStart();
		if (/\.json$/i.test(f.name) || t.startsWith('{')) {
			const d = deWaveJSON(parseWaveJSONTexto(texto));
			if (!d.titulo) d.titulo = f.name.replace(/\.[^.]+$/, '');
			cargarEnEditor(ESTADO.editor, d);
			guardar();
			irA('diagrama');
			avisar(`Se abrió ${f.name} en el editor.`);
		} else if (ctxActual?.alSoltar) ctxActual.alSoltar(texto, f.name);
		else abrirCsv(texto, f.name);
	} catch (e) {
		avisar(`No se pudo abrir ${f.name}: ${mensajeError(e)}`);
	}
}
/** Un CSV va al modo "Osciloscopio" del protocolo que se esté viendo (UART si estás en otra pestaña). */
function abrirCsv(texto, nombre) {
	const sec = SECCIONES.find((s) => s.id === ESTADO.tab);
	const destino = sec.modos?.some(([m]) => m === 'csv') ? sec.id : 'uart';
	csvPendiente = { texto, nombre };
	irA(destino, 'csv');
}

function enlazarArchivos() {
	const sel = $('#archivo');
	$('#abrir').addEventListener('click', () => sel.click());
	sel.addEventListener('change', async () => {
		await abrirArchivos(sel.files);
		sel.value = '';
	});
	const capa = $('#soltar');
	let n = 0;
	const tiene = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
	addEventListener('dragenter', (e) => {
		if (!tiene(e)) return;
		e.preventDefault();
		n++;
		capa.hidden = false;
	});
	addEventListener('dragover', (e) => {
		if (tiene(e)) e.preventDefault();
	});
	addEventListener('dragleave', () => {
		n = Math.max(0, n - 1);
		if (!n) capa.hidden = true;
	});
	addEventListener('drop', (e) => {
		if (!tiene(e)) return;
		e.preventDefault();
		n = 0;
		capa.hidden = true;
		abrirArchivos(e.dataTransfer.files);
	});
}

function enlazarBotones() {
	$('#z-menos').addEventListener('click', () => cambiarZoom(1 / 1.25));
	$('#z-mas').addEventListener('click', () => cambiarZoom(1.25));
	$('#z-valor').addEventListener('click', () => {
		zoom = 'fit';
		aplicarZoom();
	});
	$('#z-uno').addEventListener('click', () => {
		zoom = 1;
		aplicarZoom();
	});
	new ResizeObserver(() => {
		if (zoom === 'fit') aplicarZoom();
	}).observe(lienzo);

	const dlg = $('#dlg-info');
	let lleno = false;
	$('#info').addEventListener('click', () => {
		if (!lleno) {
			$('#info-cuerpo').innerHTML = AYUDA;
			lleno = true;
		}
		dlg.showModal();
		$('#info-cuerpo').focus();
	});
	$('[data-cerrar]', dlg).addEventListener('click', () => dlg.close());
	dlg.addEventListener('pointerdown', (e) => {
		if (e.target === dlg) dlg.close();
	});
}

// ------------------------------------------------------------------ arranque
async function iniciar() {
	enlazarBotones();
	enlazarExportar();
	enlazarArrastre();
	enlazarTextos();
	enlazarArchivos();
	montarConversor();
	pintarTabs();
	try {
		await Promise.all([document.fonts.load('20px "LM Roman 10"'), document.fonts.ready]);
	} catch {
		/* sin tipografía el dibujo sale igual, con la de reserva */
	}
	montar();
	// Interfaz para quien incruste la herramienta (por ejemplo, la app Archivo de kumOS).
	window.Digital = { irA, avisar };
}
iniciar();

