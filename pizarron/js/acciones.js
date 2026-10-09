// Abrir, guardar y exportar: lo que conecta el pizarrón con Archivo, con el equipo y con los PDF/SVG/PNG.
import { $, descargar, h, mensajeError } from './dom.js';
import { E, emitir, pagina, ponerDoc } from './estado.js';
import { aPagina, ajustar } from './vista.js';
import { imagenDe, insertarImagen } from './imagenes.js';
import { deserializar, docNuevo, nombreSeguro, resumen, serializar } from './modelo.js';
import * as archivo from './archivo.js';
import { pdfDeDoc, pngDePagina, svgDePagina, zipDeSVG } from './exportar.js';

const hayContenido = () => E.doc.paginas.some((p) => p.objetos.length > 0);
const confirmarPerdida = (que) => !(E.sucio && hayContenido()) || window.confirm(`Hay cambios que no guardaste. ¿${que} igual?`);

const aviso = (t, ms) => emitir('aviso', t, ms);

/** Muestra un mensaje de "trabajando…" mientras corre `f` y avisa cómo terminó. */
async function conTrabajo(texto, f, listo = 'Listo') {
	aviso(texto, 60000);
	try {
		const r = await f();
		aviso(listo);
		return r;
	} catch (e) {
		aviso(`No se pudo: ${mensajeError(e)}`, 6000);
		return null;
	}
}

// ---------------------------------------------------------------------------------------------- abrir
export function nuevoPizarron() {
	if (!confirmarPerdida('Empezar uno nuevo')) return;
	ponerDoc(docNuevo(), { reiniciar: true });
	E.origen = null;
	E.sucio = false;
	ajustar();
	emitir('titulo');
}

/** Abre el texto de un archivo .pizarron. `origen` es el id en Archivo (si vino de ahí). */
export function abrirTexto(texto, origen = null) {
	let doc;
	try {
		doc = deserializar(texto);
	} catch (e) {
		aviso(mensajeError(e), 5000);
		return false;
	}
	ponerDoc(doc, { reiniciar: true });
	E.origen = origen ? { id: origen } : null;
	E.sucio = false;
	ajustar();
	emitir('titulo');
	const r = resumen(doc);
	aviso(`Abierto: ${doc.titulo} (${r.paginas} ${r.paginas === 1 ? 'página' : 'páginas'})`);
	return true;
}

export async function abrirDeArchivo(id, { confirmar = true } = {}) {
	if (confirmar && E.origen?.id !== id && !confirmarPerdida('Abrir otro')) return false;
	try {
		const a = await archivo.leer(id);
		if (!a) throw new Error('El archivo ya no está en Archivo.');
		return abrirTexto(a.texto, id);
	} catch (e) {
		aviso(mensajeError(e), 5000);
		return false;
	}
}

export function abrirDelEquipo() {
	if (!confirmarPerdida('Abrir otro')) return;
	const entrada = $('#in-archivo');
	entrada.value = '';
	entrada.onchange = async () => {
		const f = entrada.files?.[0];
		if (!f) return;
		if (f.size > 80 * 1024 * 1024) return aviso('El archivo es demasiado grande.', 4000);
		abrirTexto(await f.text(), null);
	};
	entrada.click();
}

/** Arrastrar sobre la ventana: un .pizarron se abre y una imagen se pone en la hoja, donde se la suelta. */
export function permitirSoltar() {
	addEventListener('dragover', (e) => e.preventDefault());
	addEventListener('drop', async (e) => {
		e.preventDefault();
		const img = imagenDe(e.dataTransfer);
		if (img) {
			const r = document.getElementById('lienzo').getBoundingClientRect();
			try {
				await insertarImagen(img, aPagina(e.clientX - r.left, e.clientY - r.top));
			} catch (err) {
				aviso(err.message, 5000);
			}
			return;
		}
		const f = [...(e.dataTransfer?.files ?? [])].find((x) => /\.(pizarron|json)$/i.test(x.name));
		if (!f) return aviso('Soltá un archivo .pizarron para abrirlo, o una imagen para ponerla en la hoja.', 3500);
		if (confirmarPerdida('Abrir otro')) abrirTexto(await f.text(), null);
	});
}

// ---------------------------------------------------------------------------------------------- guardar en Archivo
function tiempo(ms) {
	return new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(ms).replace(/\./g, '');
}
const tamano = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1).replace('.', ',')} KB` : `${(n / 1048576).toFixed(1).replace('.', ',')} MB`);

/** Guardado rápido (Ctrl+S): si el pizarrón ya vino de Archivo, lo reemplaza; si no, abre el cuadro de guardar. */
export async function guardarRapido() {
	if (!E.origen) return dialogoGuardar();
	const i = E.origen.id.indexOf('/');
	const carpeta = E.origen.id.slice(0, i);
	const nombre = E.origen.id.slice(i + 1);
	await conTrabajo(
		'Guardando…',
		async () => {
			await archivo.guardar(carpeta, nombre, serializar(E.doc));
			E.sucio = false;
			emitir('doc-guardado');
		},
		`Guardado en Archivo › ${carpeta}`,
	);
}

export async function dialogoGuardar() {
	const dlg = $('#dlg-guardar');
	let carpetas = [];
	try {
		carpetas = await archivo.carpetas();
	} catch {
		/* sin Archivo: se muestra solo la carpeta por defecto */
	}
	if (!carpetas.includes(archivo.CARPETA)) carpetas = [archivo.CARPETA, ...carpetas];
	const nombre = h('input', { type: 'text', class: 'campo', maxlength: '80', value: E.doc.titulo, 'aria-label': 'Nombre' });
	const carpeta = h('select', { class: 'sel', 'aria-label': 'Carpeta' }, [...carpetas.map((c) => h('option', { value: c, selected: E.origen ? E.origen.id.startsWith(`${c}/`) : c === archivo.CARPETA }, c)), h('option', { value: '__nueva' }, 'Carpeta nueva…')]);
	const nuevaCarpeta = h('input', { type: 'text', class: 'campo', maxlength: '60', placeholder: 'Nombre de la carpeta nueva', hidden: true, 'aria-label': 'Carpeta nueva' });
	carpeta.addEventListener('change', () => {
		nuevaCarpeta.hidden = carpeta.value !== '__nueva';
		if (!nuevaCarpeta.hidden) nuevaCarpeta.focus();
	});
	const chk = (rotulo, marcado) => {
		const i = h('input', { type: 'checkbox', checked: marcado });
		return { i, el: h('label', { class: 'check' }, i, rotulo) };
	};
	const cPiz = chk('Pizarrón para seguir editándolo (.pizarron)', true);
	const cPdf = chk(`PDF de todas las páginas`, false);
	const cSvg = chk('SVG de la página que estás viendo', false);
	const msg = h('p', { class: 'error', role: 'alert' });
	const guardar = h('button', { type: 'button', class: 'btn btn--primario' }, 'Guardar en Archivo');
	guardar.addEventListener('click', async () => {
		const base = nombreSeguro(nombre.value);
		let dir = carpeta.value;
		if (dir === '__nueva') dir = (await archivo.crearCarpeta(nuevaCarpeta.value)) ?? '';
		if (!dir) {
			msg.textContent = 'Poné un nombre para la carpeta nueva.';
			return;
		}
		if (!cPiz.i.checked && !cPdf.i.checked && !cSvg.i.checked) {
			msg.textContent = 'Elegí al menos un formato.';
			return;
		}
		guardar.disabled = true;
		msg.textContent = '';
		try {
			const hechos = [];
			E.doc.titulo = base;
			if (cPiz.i.checked) {
				const id = await archivo.guardar(dir, `${base}${archivo.EXT}`, serializar(E.doc));
				E.origen = { id };
				E.sucio = false;
				hechos.push('pizarrón');
			}
			if (cPdf.i.checked) {
				aviso('Armando el PDF…', 60000);
				await archivo.guardar(dir, `${base}.pdf`, await pdfDeDoc(E.doc, { host: $('#host') }));
				hechos.push('PDF');
			}
			if (cSvg.i.checked) {
				const n = E.doc.paginas.length > 1 ? `${base} - página ${E.idx + 1}` : base;
				await archivo.guardar(dir, `${n}.svg`, new Blob([await svgDePagina(pagina(), { recursos: E.doc.recursos })], { type: 'image/svg+xml' }));
				hechos.push('SVG');
			}
			emitir('titulo');
			emitir('doc-guardado');
			dlg.close();
			aviso(`Guardado en Archivo › ${dir}: ${hechos.join(', ')}`, 4000);
		} catch (e) {
			msg.textContent = `No se pudo guardar: ${mensajeError(e)}`;
		} finally {
			guardar.disabled = false;
		}
	});
	dlg.replaceChildren(
		h('div', { class: 'dlg__bar' }, h('span', { id: 't-guardar' }, 'Guardar en Archivo'), h('button', { type: 'button', class: 'btn btn--icon', 'aria-label': 'Cerrar', onclick: () => dlg.close() }, '×')),
		h('div', { class: 'dlg__cuerpo form' }, h('label', {}, 'Nombre', nombre), h('label', {}, 'Carpeta', carpeta, nuevaCarpeta), h('div', { class: 'form' }, cPiz.el, cPdf.el, cSvg.el), msg, h('p', { class: 'nota' }, 'Los archivos quedan en la app Archivo de kumOS, en este navegador. Si guardás el .pizarron podés abrirlo más tarde y seguir editando: cada trazo sigue siendo un objeto que se puede borrar o mover.')),
		h('div', { class: 'dlg__pie' }, h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancelar'), guardar),
	);
	dlg.showModal();
	nombre.focus();
	nombre.select();
}

export async function dialogoAbrir() {
	const dlg = $('#dlg-abrir');
	let lista = [];
	let error = '';
	try {
		lista = await archivo.listarPizarrones();
	} catch (e) {
		error = mensajeError(e);
	}
	const cuerpo = h('div', { class: 'dlg__cuerpo' });
	if (error) cuerpo.append(h('p', { class: 'error' }, `No se pudo leer Archivo: ${error}`));
	else if (!lista.length) cuerpo.append(h('p', {}, 'Todavía no hay pizarrones en Archivo. Guardá uno con “Guardar en Archivo” y va a aparecer acá.'));
	else
		cuerpo.append(
			h(
				'ul',
				{ class: 'lista-arch' },
				lista.map((a) =>
					h(
						'li',
						{},
						h(
							'button',
							{
								type: 'button',
								onclick: async () => {
									if (!confirmarPerdida('Abrir otro')) return;
									dlg.close();
									await abrirDeArchivo(a.id, { confirmar: false });
								},
							},
							h('span', {}, a.nombre.replace(/\.pizarron$/i, '')),
							h('small', {}, `${a.carpeta} · ${tiempo(a.mod)} · ${tamano(a.tam)}`),
						),
					),
				),
			),
		);
	dlg.replaceChildren(
		h('div', { class: 'dlg__bar' }, h('span', { id: 't-abrir' }, 'Abrir de Archivo'), h('button', { type: 'button', class: 'btn btn--icon', 'aria-label': 'Cerrar', onclick: () => dlg.close() }, '×')),
		cuerpo,
		h('div', { class: 'dlg__pie' }, h('button', { type: 'button', class: 'btn', onclick: () => (dlg.close(), abrirDelEquipo()) }, 'Abrir del equipo…'), h('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cerrar')),
	);
	dlg.showModal();
}

// ---------------------------------------------------------------------------------------------- descargar
const nombreBase = () => nombreSeguro(E.doc.titulo);

export function bajarPizarron() {
	descargar(new Blob([serializar(E.doc)], { type: 'application/json' }), `${nombreBase()}${archivo.EXT}`);
	E.sucio = false;
	emitir('doc-guardado');
}
export const bajarPDF = (soloPagina = false) =>
	conTrabajo('Armando el PDF…', async () => {
		const blob = await pdfDeDoc(E.doc, { indices: soloPagina ? [E.idx] : null, host: $('#host') });
		descargar(blob, `${nombreBase()}${soloPagina ? ` - página ${E.idx + 1}` : ''}.pdf`);
	});
export const bajarSVG = () =>
	conTrabajo('Armando el SVG…', async () => {
		descargar(new Blob([await svgDePagina(pagina(), { recursos: E.doc.recursos })], { type: 'image/svg+xml' }), `${nombreBase()}${E.doc.paginas.length > 1 ? ` - página ${E.idx + 1}` : ''}.svg`);
	});
export const bajarZip = () =>
	conTrabajo('Armando el .zip…', async () => {
		descargar(await zipDeSVG(E.doc, nombreBase()), `${nombreBase()} (SVG).zip`);
	});
export const bajarPNG = () =>
	conTrabajo('Armando la imagen…', async () => {
		descargar(await pngDePagina(pagina(), { escala: 2, recursos: E.doc.recursos }), `${nombreBase()}${E.doc.paginas.length > 1 ? ` - página ${E.idx + 1}` : ''}.png`);
	});
