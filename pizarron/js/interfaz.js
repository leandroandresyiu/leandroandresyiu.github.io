// Interfaz del pizarrón: barra de arriba, herramientas, opciones de cada herramienta, panel de páginas, menús y ventanas.
import { $, h } from './dom.js';
import { ICONOS } from './iconos.js';
import { E, cambiar, deshacer, emitir, en, guardarAjustes, irAPagina, objetosSel, pagina, rehacer, seleccionar, usarHerramienta } from './estado.js';
import { ajustar, desplazar, limitar, miniatura, pedir, zoomEn } from './vista.js';
import { elegirImagenDelEquipo, pegarDelPortapapeles } from './imagenes.js';
import { abrirCircuito, puedeSerCircuito } from './circuito-ui.js';
import { BOTONES_BASE, FORMAS, NOMBRE_FORMA, aplicarASeleccion, girarSeleccion, tamanoOriginalSeleccion, voltearSeleccion, borrarSeleccion, copiarSeleccion, describirPuntero, duplicarSeleccion, firmasDe, nombreDeFirma, ordenarSeleccion } from './dibujo.js';
import { COLORES_PAGINA, FONDOS, FORMATOS, PASOS_MM, medidasHoja, paginaNueva } from './modelo.js';
import { nuevoId, patron } from './geometria.js';
import { abrirDelEquipo, bajarPDF, bajarPizarron, bajarPNG, bajarSVG, bajarZip, dialogoAbrir, dialogoGuardar, guardarRapido, nuevoPizarron } from './acciones.js';

const ico = (n, t = 18) => h('span', { class: 'ico', html: `<svg viewBox="0 0 256 256" width="${t}" height="${t}" fill="currentColor" aria-hidden="true">${ICONOS[n] ?? ''}</svg>` });
const PALETA = ['#111111', '#1f5fbf', '#d62d20', '#1a8f3c', '#ff4d1f', '#7b3fc4', '#6b6f76', '#ffffff'];
const PALETA_RESALTADOR = ['#ffd400', '#7be07b', '#ff9ecb', '#6fd3ff', '#ffa94d'];
const PALETA_RELLENO = ['#ffffff', '#fff3b0', '#cdeccd', '#cfe3ff', '#ffd6d6', '#e4d6ff', '#d9dde2', '#222428'];
const ESTILOS = [
	['continua', 'Continua'],
	['guiones', 'Guiones'],
	['puntos', 'Puntos'],
	['guionpunto', 'Guion y punto'],
];
const ICONO_FORMA = { linea: 'linea-recta', flecha: 'flecha-recta', flecha2: 'flecha2', rect: 'rect-vacio', elipse: 'elipse-vacia', triangulo: 'triangulo-vacio', rombo: 'rombo', ejes: 'ejes', ejesCruz: 'ejes-cruz' };
const HERRAMIENTAS = [
	{ id: 'lapiz', icono: 'lapiz', nombre: 'Lápiz', tecla: 'P' },
	{ id: 'resaltador', icono: 'resaltador', nombre: 'Resaltador', tecla: 'H' },
	{ id: 'borrador', icono: 'borrar', nombre: 'Borrador', tecla: 'E' },
	{ sep: true },
	{ id: 'seleccion', icono: 'seleccionar', nombre: 'Seleccionar con recuadro: mover, cambiar de tamaño y editar', tecla: 'V' },
	{ id: 'lazo', icono: 'lazo', nombre: 'Lazo: rodeá lo que quieras seleccionar', tecla: 'L' },
	{ sep: true },
	{ id: 'forma', icono: 'rect-vacio', nombre: 'Formas y ejes', tecla: 'S' },
	{ id: 'texto', icono: 'texto', nombre: 'Texto', tecla: 'T' },
	{ id: 'mano', icono: 'mano', nombre: 'Mover la hoja', tecla: 'M' },
];
const compacta = () => matchMedia('(max-width: 760px)').matches;

// ---------------------------------------------------------------------------------------------- avisos
let relojAviso = 0;
export function aviso(texto, ms = 2400, forma = false) {
	const el = $('#aviso');
	clearTimeout(relojAviso);
	if (!texto) {
		el.hidden = true;
		return;
	}
	el.textContent = texto;
	el.className = forma ? 'aviso aviso--forma' : 'aviso';
	el.hidden = false;
	relojAviso = window.setTimeout(() => (el.hidden = true), ms);
}

// ---------------------------------------------------------------------------------------------- menús
let abierto = null;
function cerrarMenus() {
	if (!abierto) return;
	abierto.menu.hidden = true;
	abierto.ancla.setAttribute('aria-expanded', 'false');
	abierto = null;
}
function mostrarMenu(menu, ancla, lado = 'abajo') {
	cerrarMenus();
	menu.hidden = false;
	const r = ancla.getBoundingClientRect();
	const w = menu.offsetWidth;
	const hh = menu.offsetHeight;
	let x = lado === 'abajo' ? r.right - w : lado === 'derecha' ? r.right + 6 : r.left;
	let y = lado === 'abajo' ? r.bottom + 4 : lado === 'derecha' ? r.top : r.top - hh - 6;
	x = Math.max(6, Math.min(innerWidth - w - 6, x));
	y = Math.max(6, Math.min(innerHeight - hh - 6, y));
	menu.style.left = `${x}px`;
	menu.style.top = `${y}px`;
	ancla.setAttribute('aria-expanded', 'true');
	abierto = { menu, ancla };
	menu.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
}
document.addEventListener(
	'pointerdown',
	(e) => {
		if (abierto && !abierto.menu.contains(e.target) && !abierto.ancla.contains(e.target)) cerrarMenus();
	},
	true,
);
document.addEventListener('keydown', (e) => {
	if (e.key === 'Escape' && abierto) {
		const a = abierto.ancla;
		cerrarMenus();
		a.focus();
	}
});

// ---------------------------------------------------------------------------------------------- piezas de las opciones
const ig = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

function grupo(titulo, ...hijos) {
	return h('div', { class: 'grupo', role: 'group', 'aria-label': titulo }, ...hijos);
}

function selectorColor(actual, paleta, alElegir, { ninguno = false, rotulo = 'Color' } = {}) {
	const out = [];
	if (ninguno) out.push(h('button', { type: 'button', class: 'sw sw--ninguno', 'aria-label': 'Sin relleno', title: 'Sin relleno', 'aria-pressed': String(!actual), onclick: () => alElegir(null) }));
	for (const c of paleta) out.push(h('button', { type: 'button', class: 'sw', style: `background:${c}`, 'aria-label': `${rotulo} ${c}`, title: c, 'aria-pressed': String(ig(actual, c)), onclick: () => alElegir(c) }));
	const propio = h('input', { type: 'color', 'aria-label': `${rotulo} a elección`, value: /^#[0-9a-f]{6}$/i.test(actual ?? '') ? actual : '#1f5fbf' });
	propio.addEventListener('change', () => alElegir(propio.value));
	out.push(h('span', { class: 'sw sw--custom', title: 'Otro color' }, propio));
	return out;
}

function selectorGrosor(actual, alElegir, { min = 0.5, max = 40, presets = [1.5, 3, 5, 9, 16], rotulo = 'Grosor' } = {}) {
	const salida = h('output', {}, `${Math.round(actual * 10) / 10}`);
	const rango = h('input', { type: 'range', min, max, step: 0.5, value: actual, 'aria-label': rotulo });
	rango.addEventListener('input', () => {
		salida.textContent = rango.value;
		alElegir(Number(rango.value), false);
	});
	rango.addEventListener('change', () => alElegir(Number(rango.value), true));
	const botones = presets.map((g) => h('button', { type: 'button', class: 'gr', title: `${g} px`, 'aria-label': `${rotulo} ${g}`, 'aria-pressed': String(Math.abs(g - actual) < 0.01), onclick: () => alElegir(g, true) }, h('i', { style: `width:${Math.max(2, Math.min(g, 18))}px;height:${Math.max(2, Math.min(g, 18))}px` })));
	return [...botones, h('div', { class: 'rango' }, rango, salida)];
}

function selectorEstilo(actual, alElegir) {
	return ESTILOS.map(([id, nombre]) => {
		const dash = patron(id, 2.4);
		const svg = `<svg viewBox="0 0 40 10" width="34" height="10" aria-hidden="true"><path d="M3 5H37" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash.join(' ')}"` : ''}/></svg>`;
		return h('button', { type: 'button', class: 'estilo-l', title: nombre, 'aria-label': `Línea ${nombre.toLowerCase()}`, 'aria-pressed': String(actual === id), html: svg, onclick: () => alElegir(id) });
	});
}

function interruptor(texto, activo, alCambiar, icono = null, titulo = null) {
	return h('button', { type: 'button', class: 'btn btn--chico', 'aria-pressed': String(!!activo), title: titulo ?? undefined, onclick: () => alCambiar(!activo) }, icono ? ico(icono, 15) : null, texto);
}

// ---------------------------------------------------------------------------------------------- cambiar una propiedad
/** Cambia una propiedad del estilo actual y, si hay objetos seleccionados, también la de ellos. */
function fijar(prop, valor, definitivo = true) {
	const soloSeleccion = E.herr === 'seleccion' || E.herr === 'lazo';
	if (!soloSeleccion) {
		if (E.herr === 'resaltador' && (prop === 'c' || prop === 'g')) E.resalt[prop] = valor;
		else E.estilo[prop === 'r' ? 'rel' : prop] = valor;
		guardarAjustes();
	}
	if (E.sel.length && definitivo) aplicarASeleccion({ [prop]: valor });
	if (definitivo) pintarProps();
}

// ---------------------------------------------------------------------------------------------- barra de opciones
export function pintarProps() {
	const cont = $('#props');
	const enfoque = document.activeElement && cont.contains(document.activeElement) && document.activeElement.type === 'range' ? document.activeElement : null;
	if (enfoque && E.herr !== 'seleccion') return; // no se rehace la barra mientras se arrastra un deslizador
	const sel = objetosSel();
	const base = sel[0];
	const herr = E.herr;
	const hijos = [];
	const color = base ? base.c : herr === 'resaltador' ? E.resalt.c : E.estilo.c;
	const grosor = base && base.t !== 'texto' ? base.g : herr === 'resaltador' ? E.resalt.g : E.estilo.g;
	const estilo = base && base.t !== 'texto' ? base.e : E.estilo.e;
	const hayTrazo = !sel.length || sel.some((o) => o.t !== 'texto');
	const hayRelleno = sel.some((o) => o.t === 'rect' || o.t === 'elipse' || (o.t === 'poli' && o.cerrado));
	const hayTexto = sel.some((o) => o.t === 'texto');
	const hayImagen = sel.some((o) => o.t === 'imagen');
	const soloImagenes = sel.length > 0 && sel.every((o) => o.t === 'imagen');
	const relleno = base && 'r' in base ? base.r : E.estilo.rel;

	const acciones = () =>
		grupo(
			'Acciones',
			h('button', { type: 'button', class: 'btn btn--chico', onclick: duplicarSeleccion, title: 'Duplicar (Ctrl+D)' }, ico('copiar', 15), 'Duplicar'),
			h('button', { type: 'button', class: 'btn btn--icon btn--chico', onclick: () => ordenarSeleccion(true), title: 'Traer al frente', 'aria-label': 'Traer al frente' }, ico('arriba', 15)),
			h('button', { type: 'button', class: 'btn btn--icon btn--chico', onclick: () => ordenarSeleccion(false), title: 'Mandar al fondo', 'aria-label': 'Mandar al fondo' }, ico('abajo', 15)),
			h('button', { type: 'button', class: 'btn btn--chico btn--peligro', onclick: borrarSeleccion, title: 'Borrar (Supr)' }, ico('basura', 15), 'Borrar'),
		);

	switch (herr) {
		case 'lapiz':
			hijos.push(grupo('Color', ...selectorColor(color, PALETA, (c) => fijar('c', c))), grupo('Grosor', ...selectorGrosor(grosor, (g, fin) => fijar('g', g, fin))), grupo('Estilo de línea', ...selectorEstilo(estilo, (e) => fijar('e', e))));
			hijos.push(grupo('Corrección de formas', interruptor('Corregir formas', E.aj.formaAuto, (v) => ((E.aj.formaAuto = v), guardarAjustes(), pintarProps()), 'ok', `Dejá el lápiz quieto ${E.aj.tiempoForma.toLocaleString('es-AR')} s al terminar una línea, cuadrado o círculo y se corrige solo`)));
			break;
		case 'resaltador':
			hijos.push(grupo('Color', ...selectorColor(E.resalt.c, PALETA_RESALTADOR, (c) => fijar('c', c))), grupo('Grosor', ...selectorGrosor(E.resalt.g, (g, fin) => fijar('g', g, fin), { min: 6, max: 48, presets: [10, 18, 28] })));
			break;
		case 'borrador':
			hijos.push(
				grupo('Tamaño', h('div', { class: 'rango' }, rangoSimple('Tamaño del borrador', E.estilo.borrador, 4, 60, (v) => ((E.estilo.borrador = v), guardarAjustes(), pedir()), (v) => `${v} px`))),
				grupo(
					'Qué borra',
					h('button', { type: 'button', class: 'btn btn--chico', 'aria-pressed': String(E.estilo.borrarModo === 'objeto'), title: 'Borra el trazo entero que toques', onclick: () => ((E.estilo.borrarModo = 'objeto'), guardarAjustes(), pintarProps()) }, 'Trazo entero'),
					h('button', { type: 'button', class: 'btn btn--chico', 'aria-pressed': String(E.estilo.borrarModo === 'parcial'), title: 'Borra solo la parte que pasás por encima (en los trazos a mano)', onclick: () => ((E.estilo.borrarModo = 'parcial'), guardarAjustes(), pintarProps()) }, 'Solo lo tocado'),
				),
				h('span', { class: 'nota' }, 'También borra la punta de atrás del lápiz'),
			);
			break;
		case 'forma': {
			hijos.push(
				grupo(
					'Forma',
					h('button', { type: 'button', class: 'btn btn--chico', id: 'btn-forma', 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: (e) => abrirFormas(e.currentTarget, 'abajo') }, ico(ICONO_FORMA[E.estilo.forma], 16), NOMBRE_FORMA[E.estilo.forma], ico('abajo', 12)),
				),
				grupo('Color', ...selectorColor(color, PALETA, (c) => fijar('c', c))),
				grupo('Grosor', ...selectorGrosor(grosor, (g, fin) => fijar('g', g, fin), { presets: [1.5, 3, 5] })),
				grupo('Estilo de línea', ...selectorEstilo(estilo, (e) => fijar('e', e))),
			);
			if (!['linea', 'flecha', 'flecha2', 'ejes', 'ejesCruz'].includes(E.estilo.forma) || hayRelleno) hijos.push(grupo('Relleno', ...selectorColor(relleno, PALETA_RELLENO, (c) => fijar('r', c), { ninguno: true, rotulo: 'Relleno' })));
			hijos.push(h('span', { class: 'nota' }, 'Arrastrá para dibujarla, o tocá para ponerla del tamaño por defecto'));
			if (sel.length) hijos.push(acciones());
			break;
		}
		case 'texto':
			hijos.push(
				grupo('Color', ...selectorColor(E.estilo.c, PALETA, (c) => fijar('c', c))),
				grupo('Tamaño', h('div', { class: 'rango' }, rangoSimple('Tamaño del texto', E.estilo.tam, 10, 120, (v, fin) => fijar('tam', v, fin), (v) => `${v} px`))),
				grupo('Letra', interruptor('Cursiva', E.estilo.cur, (v) => fijar('cur', v), 'cursiva')),
				h('span', { class: 'nota' }, 'Tocá la hoja y escribí. Ctrl+Enter o tocar afuera termina. Tocá un texto para editarlo.'),
			);
			break;
		case 'seleccion':
		case 'lazo':
			if (!sel.length) {
				hijos.push(h('span', { class: 'nota' }, herr === 'lazo' ? 'Rodeá con el lápiz lo que quieras seleccionar (también con el botón lateral del lápiz).' : 'Tocá un objeto, o arrastrá un recuadro. Después podés moverlo, agrandarlo o cambiarle el color.'));
			} else {
				hijos.push(h('span', { class: 'grupo__t' }, `${sel.length} ${sel.length === 1 ? 'objeto' : 'objetos'}`));
				if (!soloImagenes) hijos.push(grupo('Color', ...selectorColor(color, PALETA, (c) => fijar('c', c))));
				if (hayImagen)
					hijos.push(
						grupo(
							'Imagen',
							h('button', { type: 'button', class: 'btn btn--icon btn--chico', title: 'Girar 90° a la izquierda', 'aria-label': 'Girar 90° a la izquierda', onclick: () => girarSeleccion(-Math.PI / 2) }, ico('girar-izq', 16)),
							h('button', { type: 'button', class: 'btn btn--icon btn--chico', title: 'Girar 90° a la derecha', 'aria-label': 'Girar 90° a la derecha', onclick: () => girarSeleccion(Math.PI / 2) }, ico('girar-der', 16)),
							h('button', { type: 'button', class: 'btn btn--icon btn--chico', title: 'Dar vuelta de izquierda a derecha', 'aria-label': 'Voltear horizontalmente', onclick: () => voltearSeleccion('h') }, ico('voltear-h', 16)),
							h('button', { type: 'button', class: 'btn btn--icon btn--chico', title: 'Dar vuelta de arriba hacia abajo', 'aria-label': 'Voltear verticalmente', onclick: () => voltearSeleccion('v') }, ico('voltear-v', 16)),
							h('button', { type: 'button', class: 'btn btn--chico', title: 'Volver al tamaño original de la imagen', onclick: tamanoOriginalSeleccion }, '1:1'),
							h('div', { class: 'rango' }, rangoSimple('Opacidad', Math.round((base.op ?? 1) * 100), 10, 100, (v, fin) => fijar('op', v / 100, fin), (v) => `${v}%`)),
						),
					);
				if (hayTrazo && !soloImagenes) hijos.push(grupo('Grosor', ...selectorGrosor(grosor, (g, fin) => fijar('g', g, fin), { presets: [1.5, 3, 5, 9] })), grupo('Estilo de línea', ...selectorEstilo(estilo, (e) => fijar('e', e))));
				if (hayRelleno) hijos.push(grupo('Relleno', ...selectorColor(relleno, PALETA_RELLENO, (c) => fijar('r', c), { ninguno: true, rotulo: 'Relleno' })));
				if (hayTexto) hijos.push(grupo('Texto', h('div', { class: 'rango' }, rangoSimple('Tamaño del texto', base.t === 'texto' ? base.tam : E.estilo.tam, 10, 120, (v, fin) => fijar('tam', v, fin), (v) => `${v} px`)), interruptor('Cursiva', base.t === 'texto' ? !!base.cur : E.estilo.cur, (v) => fijar('cur', v), 'cursiva')));
				if (puedeSerCircuito(sel)) hijos.push(grupo('Circuito', h('button', { type: 'button', class: 'btn btn--chico', title: 'Convierte lo seleccionado en un esquema de LTspice (.asc): se puede copiar, guardar o sumar a otro esquema', onclick: abrirCircuito }, ico('circuito', 15), 'Copiar como circuito')));
				hijos.push(acciones());
			}
			break;
		case 'mano':
			hijos.push(h('span', { class: 'nota' }, 'Arrastrá para mover la hoja. También con dos dedos (que además agrandan), con la rueda del mouse o con la barra espaciadora apretada.'));
			break;
		default:
			break;
	}
	cont.replaceChildren(...hijos);
}

function rangoSimple(rotulo, valor, min, max, alCambiar, formato = (v) => v) {
	const salida = h('output', {}, formato(valor));
	const r = h('input', { type: 'range', min, max, step: 1, value: valor, 'aria-label': rotulo });
	r.addEventListener('input', () => {
		salida.textContent = formato(Number(r.value));
		alCambiar(Number(r.value), false);
	});
	r.addEventListener('change', () => alCambiar(Number(r.value), true));
	return [r, salida];
}

// ---------------------------------------------------------------------------------------------- herramientas
function elegirFormaMenu() {
	const m = $('#menu-formas');
	m.replaceChildren(
		...FORMAS.map((f) =>
			h('button', {
				type: 'button',
				class: 'forma',
				role: 'menuitem',
				'aria-pressed': String(E.estilo.forma === f),
				onclick: () => {
					E.estilo.forma = f;
					guardarAjustes();
					cerrarMenus();
					usarHerramienta('forma');
					pintarHerramientas();
					pintarProps();
				},
			}, ico(ICONO_FORMA[f], 24), NOMBRE_FORMA[f]),
		),
	);
	return m;
}
function abrirFormas(ancla, lado) {
	const m = elegirFormaMenu();
	if (abierto?.menu === m) return cerrarMenus();
	mostrarMenu(m, ancla, lado);
}

function pintarHerramientas() {
	const rail = $('#herr');
	rail.replaceChildren(
		...HERRAMIENTAS.map((t) => {
			if (t.sep) return h('div', { class: 'sep', role: 'separator' });
			const icono = t.id === 'forma' ? ICONO_FORMA[E.estilo.forma] : t.icono;
			const b = h(
				'button',
				{
					type: 'button',
					class: 'tool',
					'data-id': t.id,
					title: `${t.nombre} (${t.tecla})`,
					'aria-label': t.nombre,
					'aria-pressed': String(E.herr === t.id),
					onclick: (e) => {
						const ya = E.herr === t.id;
						usarHerramienta(t.id);
						if (t.id === 'forma' && (!ya || true)) abrirFormas(e.currentTarget, compacta() ? 'arriba' : 'derecha');
					},
				},
				ico(icono, 22),
				h('span', { class: 'atajo', 'aria-hidden': 'true' }, t.tecla),
			);
			return b;
		}),
	);
}
function marcarHerramienta() {
	for (const b of document.querySelectorAll('#herr .tool')) b.setAttribute('aria-pressed', String(b.dataset.id === E.herr));
}

// ---------------------------------------------------------------------------------------------- barra de arriba
const miniaturas = new Map(); // id de página → { sig, canvas }

function actualizarTop() {
	$('#b-deshacer').disabled = !E.hist.puedeDeshacer;
	$('#b-rehacer').disabled = !E.hist.puedeRehacer;
	$('#p-num').textContent = `${E.idx + 1} / ${E.doc.paginas.length}`;
	$('#p-ant').disabled = E.idx === 0;
	$('#p-sig').disabled = E.idx === E.doc.paginas.length - 1;
	const t = $('#titulo');
	if (document.activeElement !== t) t.value = E.doc.titulo;
}

function montarTop() {
	const poner = (id, nombre, tam = 18) => $(id).replaceChildren(ico(nombre, tam));
	poner('#b-paginas', 'paginas');
	poner('#b-opciones', 'paleta');
	poner('#b-deshacer', 'deshacer');
	poner('#b-rehacer', 'rehacer');
	const girado = (id, grados) => {
		const i = ico('abajo', 16);
		i.firstChild.style.transform = `rotate(${grados}deg)`;
		$(id).replaceChildren(i);
	};
	girado('#p-ant', 90);
	girado('#p-sig', -90);
	poner('#p-nueva', 'mas');
	poner('#z-menos', 'zoom-menos');
	poner('#z-mas', 'zoom-mas');
	poner('#b-ajustar', 'ajustar');
	poner('#b-ajustes', 'ajustes');
	$('#b-archivo .ico-slot').replaceChildren(ico('guardar', 16));
	$('#b-deshacer').addEventListener('click', () => deshacer());
	$('#b-rehacer').addEventListener('click', () => rehacer());
	$('#p-ant').addEventListener('click', () => cambiarPagina(E.idx - 1));
	$('#p-sig').addEventListener('click', () => cambiarPagina(E.idx + 1));
	$('#p-nueva').addEventListener('click', agregarPagina);
	$('#z-menos').addEventListener('click', () => zoomEn(E.vista.z / 1.1));
	$('#z-mas').addEventListener('click', () => zoomEn(E.vista.z * 1.1));
	$('#z-valor').addEventListener('click', () => (Math.abs(E.vista.z - 1) < 0.01 ? ajustar('pagina') : zoomEn(1)));
	$('#b-ajustar').addEventListener('click', () => ajustar('pagina'));
	$('#b-paginas').addEventListener('click', alternarPaginas);
	$('#b-opciones').addEventListener('click', alternarOpciones);
	matchMedia('(max-height: 559px)').addEventListener('change', sincronizarOpciones);
	new ResizeObserver(sincronizarOpciones).observe($('#app'));
	sincronizarOpciones();
	$('#b-archivo').addEventListener('click', (e) => (abierto?.menu.id === 'menu-archivo' ? cerrarMenus() : mostrarMenu(armarMenuArchivo(), e.currentTarget, 'abajo')));
	$('#b-ajustes').addEventListener('click', abrirAjustes);
	$('#b-info').addEventListener('click', abrirInfo);
	const t = $('#titulo');
	t.addEventListener('input', () => {
		E.doc.titulo = t.value.slice(0, 80);
		E.sucio = true;
		emitir('titulo');
	});
	t.addEventListener('keydown', (e) => {
		e.stopPropagation();
		if (e.key === 'Enter') t.blur();
	});
	t.addEventListener('blur', () => {
		if (!t.value.trim()) t.value = E.doc.titulo = 'Pizarrón sin título';
	});
}

// Las opciones de la herramienta se ocultan solas en ventanas bajitas (pantalla dividida): lo decide el CSS según el alto.
// El botón las muestra u oculta a mano (data-opciones="1" o "0" en #app); en ventanas grandes el botón no se ve y siempre están.
function sincronizarOpciones() {
	$('#b-opciones').setAttribute('aria-pressed', String(getComputedStyle($('#props')).display !== 'none'));
}
function alternarOpciones() {
	const app = $('#app');
	const visibles = getComputedStyle($('#props')).display !== 'none';
	app.dataset.opciones = visibles ? '0' : '1';
	sincronizarOpciones();
}

function cambiarPagina(i) {
	const antes = pagina();
	irAPagina(i);
	const ahora = pagina();
	if (antes.ancho !== ahora.ancho || antes.alto !== ahora.alto) ajustar('pagina');
	else {
		limitar();
		pedir();
	}
}

function agregarPagina() {
	cambiar(() => {
		const p = paginaNueva(pagina());
		E.doc.paginas = [...E.doc.paginas.slice(0, E.idx + 1), p, ...E.doc.paginas.slice(E.idx + 1)];
	});
	cambiarPagina(E.idx + 1);
}

// ---------------------------------------------------------------------------------------------- menú Archivo
function armarMenuArchivo() {
	const m = $('#menu-archivo');
	const it = (icono, texto, f, tecla = null) =>
		h('button', { type: 'button', class: 'menu__it', role: 'menuitem', onclick: () => (cerrarMenus(), f()) }, ico(icono, 16), texto, tecla ? h('kbd', {}, tecla) : null);
	m.replaceChildren(
		it('nuevo', 'Pizarrón nuevo', nuevoPizarron),
		it('abrir', 'Abrir de Archivo…', dialogoAbrir),
		it('subir', 'Abrir del equipo…', abrirDelEquipo),
		h('div', { class: 'menu__sep' }),
		h('div', { class: 'menu__t' }, 'Insertar'),
		it('pegar', 'Imagen del portapapeles', () => pegarDelPortapapeles().catch((e) => aviso(e.message, 5000)), 'Ctrl+V'),
		it('imagen', 'Imagen del equipo…', elegirImagenDelEquipo),
		h('div', { class: 'menu__sep' }),
		h('div', { class: 'menu__t' }, 'Guardar en la app Archivo'),
		it('guardar', E.origen ? 'Guardar' : 'Guardar en Archivo…', guardarRapido, 'Ctrl+S'),
		E.origen ? it('guardar', 'Guardar como… (o PDF / SVG a Archivo)', dialogoGuardar) : null,
		h('div', { class: 'menu__sep' }),
		h('div', { class: 'menu__t' }, 'Descargar'),
		it('bajar', 'Pizarrón editable (.pizarron)', bajarPizarron),
		it('pdf', E.doc.paginas.length > 1 ? 'PDF de todas las páginas' : 'PDF', () => bajarPDF(false)),
		E.doc.paginas.length > 1 ? it('pdf', 'PDF de esta página', () => bajarPDF(true)) : null,
		it('svg', 'SVG de esta página', bajarSVG),
		E.doc.paginas.length > 1 ? it('svg', 'SVG de todas las páginas (.zip)', bajarZip) : null,
		it('imagen', 'Imagen PNG de esta página', bajarPNG),
		h('div', { class: 'menu__sep' }),
		it('ajustes', 'Ajustes del lápiz y del dedo…', abrirAjustes),
		it('ayuda', 'Cómo se usa', abrirInfo),
	);
	return m;
}

// ---------------------------------------------------------------------------------------------- panel de páginas
let panelAbierto = false;
let relojMini = 0;

function alternarPaginas() {
	panelAbierto = !panelAbierto;
	$('#paginas').hidden = !panelAbierto;
	$('#b-paginas').setAttribute('aria-pressed', String(panelAbierto));
	if (panelAbierto) pintarPaginas();
	// el lienzo cambia de ancho: la hoja se vuelve a acomodar sola (ResizeObserver en vista.js)
}

function firmaPagina(p) {
	return `${p.fondo}|${p.pasoMm}|${p.color}|${p.ancho}x${p.alto}`;
}

function pintarPaginas() {
	if (!panelAbierto) return;
	const panel = $('#paginas');
	const pg = pagina();
	const lista = E.doc.paginas.map((p, i) => {
		let m = miniaturas.get(p.id);
		if (!m || m.objetos !== p.objetos || m.sig !== firmaPagina(p)) {
			m = { objetos: p.objetos, sig: firmaPagina(p), canvas: miniatura(p, 112) };
			miniaturas.set(p.id, m);
		}
		const actual = i === E.idx;
		const acc = actual
			? h(
					'div',
					{ class: 'pag__acc' },
					h('button', { type: 'button', class: 'btn btn--icon', title: 'Subir una posición', 'aria-label': 'Mover la página hacia arriba', disabled: i === 0, onclick: (e) => (e.stopPropagation(), moverPagina(-1)) }, ico('arriba', 14)),
					h('button', { type: 'button', class: 'btn btn--icon', title: 'Bajar una posición', 'aria-label': 'Mover la página hacia abajo', disabled: i === E.doc.paginas.length - 1, onclick: (e) => (e.stopPropagation(), moverPagina(1)) }, ico('abajo', 14)),
					h('button', { type: 'button', class: 'btn btn--icon', title: 'Duplicar esta página', 'aria-label': 'Duplicar la página', onclick: (e) => (e.stopPropagation(), duplicarPagina()) }, ico('copiar', 14)),
					h('button', { type: 'button', class: 'btn btn--icon btn--peligro', title: E.doc.paginas.length > 1 ? 'Borrar esta página' : 'Vaciar esta página', 'aria-label': 'Borrar la página', onclick: (e) => (e.stopPropagation(), borrarPagina()) }, ico('basura', 14)),
				)
			: null;
		return h('li', {}, h('div', { class: 'pag', role: 'button', tabindex: '0', 'aria-current': String(actual), 'aria-label': `Página ${i + 1}`, onclick: () => cambiarPagina(i), onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), cambiarPagina(i)) }, m.canvas, h('span', { class: 'pag__n' }, `Página ${i + 1}`), acc));
	});
	// limpiar miniaturas de páginas que ya no están
	const vivos = new Set(E.doc.paginas.map((p) => p.id));
	for (const k of [...miniaturas.keys()]) if (!vivos.has(k)) miniaturas.delete(k);

	const formato = h('select', { class: 'sel', 'aria-label': 'Formato de la hoja' }, Object.entries(FORMATOS).map(([id, f]) => h('option', { value: id, selected: pg.formato === id }, f.nombre)));
	formato.addEventListener('change', () => cambiarHoja({ formato: formato.value, orient: ['16:9', '4:3'].includes(formato.value) ? 'h' : pg.orient }));
	const orient = (o, texto) => h('button', { type: 'button', class: 'btn btn--chico', 'aria-pressed': String(pg.orient === o), onclick: () => cambiarHoja({ orient: o }) }, texto);
	const fondos = h(
		'div',
		{ class: 'fondos', role: 'group', 'aria-label': 'Fondo de la hoja' },
		[
			['liso', 'Liso', 'liso'],
			['rayado', 'Rayado', 'rayado'],
			['cuadriculado', 'Cuadrícula', 'cuadricula'],
			['puntos', 'Puntos', 'puntos'],
		].map(([id, nombre, icono]) => h('button', { type: 'button', class: 'btn', 'aria-pressed': String(pg.fondo === id), title: nombre, onclick: () => cambiarHoja({ fondo: id }) }, ico(icono, 20), nombre)),
	);
	const paso = h('select', { class: 'sel', 'aria-label': 'Separación del rayado o la cuadrícula', disabled: pg.fondo === 'liso' }, PASOS_MM.map((mm) => h('option', { value: mm, selected: pg.pasoMm === mm }, `${mm} mm`)));
	paso.addEventListener('change', () => cambiarHoja({ pasoMm: Number(paso.value) }));
	const colores = h(
		'div',
		{ class: 'fila' },
		...selectorColor(pg.color, COLORES_PAGINA, (c) => cambiarHoja({ color: c }), { rotulo: 'Color de la hoja' }),
	);
	const todas = h('button', { type: 'button', class: 'btn btn--chico', title: 'Copia el fondo, la separación y el color de esta hoja a todas las demás', onclick: aplicarATodas }, 'Aplicar fondo y color a todas');

	panel.replaceChildren(
		h('div', { class: 'paginas__bar' }, h('span', {}, `Páginas (${E.doc.paginas.length})`), h('button', { type: 'button', class: 'btn btn--icon btn--chico', 'aria-label': 'Cerrar el panel', onclick: alternarPaginas }, ico('cerrar', 14))),
		h('ul', { class: 'paginas__lista' }, ...lista),
		h('div', { style: 'padding:0 10px 10px' }, h('button', { type: 'button', class: 'btn', style: 'width:100%', onclick: agregarPagina }, ico('mas', 16), 'Agregar página')),
		h(
			'div',
			{ class: 'paginas__cfg' },
			h('h3', {}, `Esta hoja (${E.idx + 1})`),
			h('div', { class: 'fila' }, h('label', {}, 'Formato'), formato),
			h('div', { class: 'fila' }, h('label', {}, 'Orientación'), orient('v', 'Vertical'), orient('h', 'Horizontal')),
			h('div', { class: 'fila' }, h('label', {}, 'Fondo'), fondos),
			h('div', { class: 'fila' }, h('label', {}, 'Separación'), paso),
			h('div', { class: 'fila' }, h('label', {}, 'Color'), colores),
			todas,
		),
	);
	panel.querySelector('.pag[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
}

function cambiarHoja(cambios) {
	cambiar(() => {
		const pg = pagina();
		const n = { ...pg, ...cambios };
		if ('formato' in cambios || 'orient' in cambios) Object.assign(n, medidasHoja(n.formato, n.orient));
		E.doc.paginas = E.doc.paginas.map((p, i) => (i === E.idx ? n : p));
	});
	if ('formato' in cambios || 'orient' in cambios) ajustar('pagina');
}

function aplicarATodas() {
	const { fondo, pasoMm, color } = pagina();
	cambiar(() => (E.doc.paginas = E.doc.paginas.map((p) => ({ ...p, fondo, pasoMm, color }))));
	aviso('Listo: todas las páginas tienen el mismo fondo y color');
}

function moverPagina(d) {
	const j = E.idx + d;
	if (j < 0 || j >= E.doc.paginas.length) return;
	cambiar(() => {
		const l = [...E.doc.paginas];
		[l[E.idx], l[j]] = [l[j], l[E.idx]];
		E.doc.paginas = l;
	});
	irAPagina(j);
}

function duplicarPagina() {
	cambiar(() => {
		const p = { ...pagina(), id: nuevoId(), objetos: pagina().objetos.slice() };
		E.doc.paginas = [...E.doc.paginas.slice(0, E.idx + 1), p, ...E.doc.paginas.slice(E.idx + 1)];
	});
	irAPagina(E.idx + 1);
}

function borrarPagina() {
	const n = E.doc.paginas.length;
	cambiar(() => {
		if (n === 1) E.doc.paginas = [{ ...pagina(), objetos: [] }];
		else E.doc.paginas = E.doc.paginas.filter((_, i) => i !== E.idx);
	});
	E.idx = Math.min(E.idx, E.doc.paginas.length - 1);
	E.sel = [];
	emitir('pagina');
	emitir('sel');
	aviso(n === 1 ? 'Página vaciada (se puede deshacer)' : 'Página borrada (se puede deshacer)');
}

// ---------------------------------------------------------------------------------------------- ajustes
const ACCIONES_BOTON = [
	['borrar', 'Borrar'],
	['lazo', 'Seleccionar con lazo'],
	['seleccionar', 'Seleccionar y mover (recuadro)'],
	['mano', 'Mover la hoja'],
	['nada', 'Nada (que dibuje normal)'],
];

function abrirAjustes() {
	const dlg = $('#dlg-ajustes');
	const selAccion = (valor, alCambiar, titulo) => {
		const s = h('select', { class: 'sel', 'aria-label': titulo }, ACCIONES_BOTON.map(([v, t]) => h('option', { value: v, selected: valor === v }, t)));
		s.addEventListener('change', () => alCambiar(s.value));
		return s;
	};
	const fila = (titulo, ayuda, control, extra = null) => h('div', { class: 'boton-fila' }, h('span', {}, titulo, ayuda ? h('small', { class: 'nota' }, ` · ${ayuda}`) : null), control, extra);
	const lista = h('div', { class: 'form' });
	const pintarBotones = () => {
		lista.replaceChildren(
			...BOTONES_BASE.map((b) => fila(b.nombre, b.ayuda, selAccion(E.aj[b.clave], (v) => ((E.aj[b.clave] = v), guardarAjustes()), b.nombre))),
			...Object.entries(E.aj.extra).map(([firma, accion]) =>
				fila(
					nombreDeFirma(firma),
					`aprendido (${firma})`,
					selAccion(accion, (v) => ((E.aj.extra[firma] = v), guardarAjustes()), firma),
					h('button', { type: 'button', class: 'btn btn--chico btn--peligro', 'aria-label': `Olvidar ${firma}`, onclick: () => (delete E.aj.extra[firma], guardarAjustes(), pintarBotones()) }, 'Olvidar'),
				),
			),
		);
	};
	pintarBotones();

	// Recuadro de prueba y detector: muestra lo que manda cada botón y deja aprender uno nuevo.
	const registro = h('pre', { class: 'registro', 'aria-live': 'off' }, 'Todavía no llegó nada.');
	const monitor = h('div', { class: 'monitor', tabindex: '0', role: 'status' }, 'Apoyá el lápiz acá y apretá un botón');
	const lineas = [];
	const anotar = (t) => {
		lineas.unshift(t);
		lineas.length = Math.min(lineas.length, 7);
		registro.textContent = lineas.join('\n');
	};
	let detectando = false;
	let ultimoButtons = -1;
	const detector = h('button', { type: 'button', class: 'btn btn--chico' }, 'Detectar botón…');
	const parar = () => {
		detectando = false;
		detector.textContent = 'Detectar botón…';
		detector.setAttribute('aria-pressed', 'false');
		monitor.textContent = 'Apoyá el lápiz acá y apretá un botón';
	};
	detector.addEventListener('click', () => {
		detectando = !detectando;
		detector.setAttribute('aria-pressed', String(detectando));
		detector.textContent = detectando ? 'Cancelar detección' : 'Detectar botón…';
		monitor.textContent = detectando ? 'Ahora apretá el botón que querés usar (sobre este recuadro)…' : 'Apoyá el lápiz acá y apretá un botón';
	});
	const alEvento = (e) => {
		if (e.type === 'pointermove' && e.buttons === ultimoButtons) return;
		if (e.type !== 'keydown') ultimoButtons = e.buttons;
		const fs = e.type === 'keydown' ? (e.key === 'Alt' ? ['tecla:Alt'] : []) : firmasDe(e);
		anotar(`${describirPuntero(e)}${fs.length ? `  →  ${fs.join(' ')}` : ''}`);
		if (!detectando || !fs.length || (e.type !== 'pointerdown' && e.type !== 'pointermove' && e.type !== 'keydown')) return;
		const nueva = fs.find((f) => !(f in E.aj.extra) && !BOTONES_BASE.some((b) => b.firmas.includes(f)));
		if (!nueva) {
			monitor.textContent = `Ese botón ya está en la lista (${nombreDeFirma(fs[0])}).`;
			parar();
			return;
		}
		E.aj.extra[nueva] = 'borrar';
		guardarAjustes();
		pintarBotones();
		parar();
		monitor.textContent = `Aprendido: ${nombreDeFirma(nueva)}. Elegí abajo qué hace.`;
	};
	for (const t of ['pointerdown', 'pointermove', 'pointerup']) monitor.addEventListener(t, alEvento);
	for (const t of ['mousedown', 'auxclick']) monitor.addEventListener(t, (e) => anotar(`${t} · button=${e.button} · buttons=${e.buttons}`));
	monitor.addEventListener('contextmenu', (e) => e.preventDefault());
	const teclas = (e) => dlg.open && e.key === 'Alt' && (e.preventDefault(), alEvento(e));
	document.addEventListener('keydown', teclas);
	dlg.addEventListener('close', () => document.removeEventListener('keydown', teclas), { once: true });

	const dedo = (v, t) => {
		const r = h('input', { type: 'radio', name: 'dedo', value: v, checked: E.aj.dedo === v });
		r.addEventListener('change', () => ((E.aj.dedo = v), (E.aj.dedoElegido = true), guardarAjustes()));
		return h('label', { class: 'check' }, r, t);
	};
	const auto = h('input', { type: 'checkbox', checked: E.aj.formaAuto });
	auto.addEventListener('change', () => ((E.aj.formaAuto = auto.checked), guardarAjustes(), pintarProps()));
	const salida = h('output', {}, `${E.aj.tiempoForma.toLocaleString('es-AR')} s`);
	const tiempo = h('input', { type: 'range', min: 0.4, max: 3, step: 0.1, value: E.aj.tiempoForma, 'aria-label': 'Segundos con el lápiz quieto' });
	tiempo.addEventListener('input', () => {
		E.aj.tiempoForma = Number(tiempo.value);
		salida.textContent = `${E.aj.tiempoForma.toLocaleString('es-AR')} s`;
		guardarAjustes();
	});
	tiempo.addEventListener('change', pintarProps);
	dlg.replaceChildren(
		h('div', { class: 'dlg__bar' }, h('span', { id: 't-ajustes' }, 'Ajustes'), h('button', { type: 'button', class: 'btn btn--icon', 'aria-label': 'Cerrar', onclick: () => dlg.close() }, '×')),
		h(
			'div',
			{ class: 'dlg__cuerpo' },
			h(
				'div',
				{ class: 'form' },
				h('h3', {}, 'Botones del lápiz y del mouse'),
				lista,
				h('div', { class: 'fila' }, detector, h('span', { class: 'nota' }, 'Si un botón no hace nada, detectalo y elegí qué querés que haga.')),
				monitor,
				registro,
				h('p', { class: 'nota' }, 'El recuadro muestra lo que manda cada botón: la punta de atrás del lápiz llega como buttons=32 y los botones laterales como 2 y 4; un driver de tableta puede mandarlos como clic del medio, clic derecho o la tecla Alt, y eso también se puede asignar. Si al apretar un botón no aparece nada, el driver lo está usando para otra cosa (en el panel de Wacom, asignale “Clic derecho”, “Clic del medio” o “Borrador”).'),
			),
			h('div', { class: 'form' }, h('h3', {}, 'Dedo'), dedo('dibujar', 'Dibuja'), dedo('mover', 'Mueve la hoja (con dos dedos siempre se mueve y se agranda)'), dedo('ignorar', 'No hace nada (solo el lápiz y el mouse)'), h('p', { class: 'nota' }, 'Al detectar un lápiz por primera vez, el dedo pasa solo a mover la hoja, para que la palma no dibuje.')),
			h('div', { class: 'form' }, h('h3', {}, 'Corrección de formas'), h('label', { class: 'check' }, auto, 'Si dejás el lápiz quieto después de una línea, cuadrado, círculo, triángulo u onda cuadrada, queda perfecto'), h('label', {}, 'Tiempo quieto', h('div', { class: 'rango' }, tiempo, salida))),
			h('p', { class: 'nota' }, 'La presión del lápiz no cambia el grosor: el trazo sale parejo y el grosor, el color y el estilo se eligen en la barra de opciones.'),
		),
		h('div', { class: 'dlg__pie' }, h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Listo')),
	);
	dlg.showModal();
}

// ---------------------------------------------------------------------------------------------- ayuda
function abrirInfo() {
	const dlg = $('#dlg-info');
	dlg.replaceChildren(
		h('div', { class: 'dlg__bar' }, h('span', { id: 't-info' }, 'Pizarrón: cómo se usa'), h('button', { type: 'button', class: 'btn btn--icon', 'aria-label': 'Cerrar', onclick: () => dlg.close() }, '×')),
		h('div', { class: 'dlg__cuerpo', tabindex: '0', html: AYUDA }),
		h('div', { class: 'dlg__pie' }, h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cerrar')),
	);
	dlg.showModal();
}
const AYUDA = `
<div><h3>Para dibujar</h3><p>Elegí una herramienta a la izquierda (o abajo, en pantallas angostas). Con el <b>Lápiz</b> el trazo sale siempre parejo: la presión no influye, y el color, el grosor y el estilo de línea (continua, guiones, puntos) se eligen en la barra de opciones.</p></div>
<div><h3>Botones del lápiz</h3><ul><li><b>Punta de atrás</b> (o el borrador de la TCL NXTPAPER, que se activa apretando): borra.</li><li><b>Botón lateral 1</b>: mientras lo apretás, dibujás un <b>lazo</b> alrededor de lo que querés seleccionar; al soltarlo, el lápiz pasa a Seleccionar y podés mover la selección (también agrandarla desde las manijas).</li><li><b>Botón lateral 2</b>: borra.</li></ul><p>Podés cambiar qué hace cada uno en <b>Ajustes</b> (el engranaje), donde también hay un recuadro para ver qué manda tu lápiz.</p></div>
<div><h3>Formas perfectas</h3><p>Dibujá una línea, un rectángulo, un cuadrado, un círculo, una elipse, un triángulo, un rombo o una onda cuadrada y <b>dejá el lápiz quieto</b> sin levantarlo: un anillo se va llenando y la forma se corrige sola (dice cuál reconoció). Si era una línea, podés seguir moviendo el lápiz para girarla. Si no se reconoce nada, el trazo queda como estaba. El tiempo y la opción se cambian en Ajustes.</p></div>
<div><h3>Formas y ejes</h3><p>La herramienta <b>Formas</b> inserta líneas, flechas, rectángulos, elipses, triángulos, rombos y ejes (con marcas y letras x e y). Arrastrá para dibujarlas, o tocá para ponerlas del tamaño por defecto. Con Mayús salen cuadradas, circulares o a 45°.</p></div>
<div><h3>Seleccionar y editar</h3><ul><li><b>Seleccionar</b>: tocá un objeto o arrastrá un recuadro. <b>Lazo</b>: rodeá lo que quieras.</li><li>Arrastrá lo seleccionado para <b>moverlo</b> y las manijas de las esquinas para <b>agrandarlo</b> (con Mayús se deforma).</li><li>En la barra de opciones cambiás color, grosor, estilo y relleno de lo seleccionado, lo duplicás, lo traés al frente o lo borrás (también con <kbd>Supr</kbd>).</li><li>Tocá dos veces un texto para editarlo.</li></ul></div>
<div><h3>Circuitos para LTspice</h3><p>Dibujá el circuito a mano: <b>resistencias</b> como rectángulos alargados, <b>capacitores</b> como dos rayitas paralelas, <b>inductores</b> como una onda o bobina, <b>fuentes</b> como un círculo con + y −, <b>operacionales</b> como un triángulo grande con + y − adentro (apuntando a un costado), <b>tierras</b> como un triángulo chico y los <b>cables</b> como rayas. Escribí al lado el nombre (R1) y el valor (10k, 4,7k, 100n) de cada uno, y el nombre de una red si querés (Vout). Un cable que termina en el medio de otro se conecta; dos que se cruzan solo se conectan si ponés un puntito.</p><p>Después seleccionalo (recuadro o lazo) y tocá <b>Copiar como circuito</b>: arma el esquema de LTspice (.asc), revisa que las conexiones queden igual que en tu dibujo y te deja copiarlo, guardarlo en Archivo, bajarlo o <b>sumarlo a un .asc que ya tengas</b> (queda a la derecha de lo que había).</p></div>
<div><h3>Páginas, fondo y color</h3><p>El botón de las hojas abre el panel de páginas: agregás, duplicás, ordenás y borrás páginas, y elegís el formato (A4, A5, A3, Carta, pantalla…), el fondo (<b>liso, rayado, cuadriculado o de puntos</b>), la separación y el color de cada hoja.</p></div>
<div><h3>Guardar y exportar</h3><ul><li><b>Guardar en Archivo</b> deja el pizarrón en la app Archivo (carpeta “Pizarrón”) como <code>.pizarron</code>: podés abrirlo más tarde y seguir editando, incluso borrar o mover trazos de otras sesiones. También podés guardar ahí el PDF o el SVG.</li><li><b>Descargar</b> baja el <code>.pizarron</code>, el PDF (una hoja por página), el SVG de la página, todos los SVG en un .zip o una imagen PNG.</li><li>El trabajo se autoguarda en este navegador: si cerrás la pestaña, lo recuperás al volver.</li></ul></div>
<div><h3>Teclado</h3><p><kbd>P</kbd> lápiz · <kbd>H</kbd> resaltador · <kbd>E</kbd> borrador · <kbd>V</kbd> seleccionar · <kbd>L</kbd> lazo · <kbd>S</kbd> formas · <kbd>T</kbd> texto · <kbd>M</kbd> mover la hoja (o barra espaciadora) · <kbd>Ctrl+Z</kbd> deshacer · <kbd>Ctrl+Mayús+Z</kbd> rehacer · <kbd>Ctrl+C</kbd>/<kbd>X</kbd>/<kbd>V</kbd>/<kbd>D</kbd> copiar, cortar, pegar, duplicar · <kbd>Ctrl+A</kbd> todo · <kbd>Ctrl+S</kbd> guardar · <kbd>+</kbd>/<kbd>−</kbd> zoom · <kbd>RePág</kbd>/<kbd>AvPág</kbd> página.</p></div>
<p class="nota">El texto usa Latin Modern; las letras griegas minúsculas salen en cursiva (como en las fórmulas de TeX). Algunos símbolos matemáticos (≤ ≥ ≈ ≠ ∫) no están en la tipografía: dibujalos con el lápiz.</p>
`;

// ---------------------------------------------------------------------------------------------- arranque
export function montarInterfaz() {
	montarTop();
	pintarHerramientas();
	pintarProps();
	actualizarTop();
	en('herr', () => {
		marcarHerramienta();
		cerrarMenus();
		pintarProps();
	});
	en('sel', pintarProps);
	en('pagina', () => {
		actualizarTop();
		pintarPaginas();
		pintarProps();
	});
	en('doc', () => {
		actualizarTop();
		clearTimeout(relojMini);
		relojMini = window.setTimeout(pintarPaginas, 250);
		if (E.sel.length) pintarProps();
	});
	en('titulo', actualizarTop);
	en('imagenes', () => {
		clearTimeout(relojMini);
		relojMini = window.setTimeout(() => {
			for (const m of miniaturas.values()) m.sig = '';
			pintarPaginas();
		}, 200);
	});
	en('doc-guardado', actualizarTop);
	en('vista', () => {
		$('#z-valor').textContent = `${Math.round(E.vista.z * 100)}%`;
	});
	en('aviso', (t, ms) => aviso(t, ms ?? 2400));
	en('forma', (t) => aviso(t, 1400, true));
	en('guardar', guardarRapido);
	en('deshacer', () => deshacer());
	$('#z-valor').textContent = `${Math.round(E.vista.z * 100)}%`;
	// Páginas siguiente y anterior con el teclado
	en('pagina-sig', () => cambiarPagina(E.idx + 1));
	en('pagina-ant', () => cambiarPagina(E.idx - 1));
	// Rueda sobre la barra de opciones: desplaza de costado
	$('#props').addEventListener('wheel', (e) => {
		if (e.deltaY && !e.shiftKey) {
			$('#props').scrollLeft += e.deltaY;
		}
	}, { passive: true });
	// Desplazar con las flechas en la hoja sin selección
	document.addEventListener('keydown', (e) => {
		if (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
		if (E.sel.length || document.querySelector('dialog[open]')) return;
		const d = e.shiftKey ? 120 : 40;
		if (e.key === 'ArrowUp') desplazar(0, d);
		else if (e.key === 'ArrowDown') desplazar(0, -d);
		else if (e.key === 'ArrowLeft') desplazar(d, 0);
		else if (e.key === 'ArrowRight') desplazar(-d, 0);
	});
	void copiarSeleccion;
	void seleccionar;
}
