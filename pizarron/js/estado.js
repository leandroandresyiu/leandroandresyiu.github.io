// Estado compartido del pizarrón: el documento, la herramienta, el estilo, la selección y un avisador de cambios.
// Los módulos de pantalla (vista, dibujo, interfaz) leen y escriben acá; la lógica pura vive en modelo.js y geometria.js.
import { docNuevo, Historial, instantanea } from './modelo.js';
import { memoria } from './dom.js';

const CLAVE_AJ = 'pizarron.ajustes';
const CLAVE_EST = 'pizarron.estilo';

export const AJUSTES_BASE = {
	dedo: 'dibujar', // dibujar | mover | ignorar
	dedoElegido: false, // si la persona lo cambió a mano (para no pisárselo al detectar un lápiz)
	cola: 'borrar', // la punta de atrás del lápiz (o el borrador de la TCL)
	boton1: 'lazo', // botón lateral 1 del lápiz (buttons & 2)
	boton2: 'borrar', // botón lateral 2 (buttons & 4)
	formaAuto: true, // corregir formas al dejar el lápiz quieto
	tiempoForma: 0.9, // segundos quieto
	penVisto: false,
	// qué hace cada botón extra (borrar, lazo, seleccionar, mano o nada)
	mouseMedio: 'mano', // rueda apretada del mouse
	mouseDer: 'mano', // clic derecho del mouse
	teclaAlt: 'nada', // tecla Alt apretada (algunos drivers de tableta mandan un botón como Alt)
	extra: {}, // botones aprendidos con "Detectar botón": firma → acción
};
export const ESTILO_BASE = {
	c: '#111111',
	g: 3,
	e: 'continua',
	rel: null,
	tam: 28,
	cur: false,
	forma: 'rect',
	borrador: 16,
	borrarModo: 'objeto', // objeto | parcial
};
export const RESALTADOR_BASE = { c: '#ffd400', g: 18, op: 0.4, e: 'continua' };

export const E = {
	doc: docNuevo(),
	hist: new Historial(),
	idx: 0, // página abierta
	vista: { z: 1, x: 0, y: 0 }, // zoom y desplazamiento de la hoja en pantalla (px)
	herr: 'lapiz', // lapiz | resaltador | borrador | seleccion | lazo | forma | texto | mano
	herrPrevia: null, // herramienta a la que se vuelve al soltar la selección hecha con el botón del lápiz
	sel: [], // ids de los objetos seleccionados (de la página abierta)
	previa: null, // Map id → objeto: cómo se ven los objetos mientras se arrastran
	ocultos: null, // Set de ids que no se dibujan (el texto que se está editando)
	aj: { ...AJUSTES_BASE, ...memoria.leer(CLAVE_AJ, {}) },
	estilo: { ...ESTILO_BASE, ...memoria.leer(CLAVE_EST, {}).estilo },
	resalt: { ...RESALTADOR_BASE, ...memoria.leer(CLAVE_EST, {}).resalt },
	portapapeles: [],
	origen: null, // { id: 'Carpeta/nombre.pizarron' } si se abrió de Archivo o se guardó ahí
	sucio: false, // hay cambios sin guardar en un archivo
};

export const pagina = () => E.doc.paginas[E.idx];
export const objetosSel = () => {
	const ids = new Set(E.sel);
	return pagina().objetos.filter((o) => ids.has(o.id));
};

// ---------------------------------------------------------------------------------------------- avisos
const oyentes = new Map();
export const en = (ev, f) => {
	if (!oyentes.has(ev)) oyentes.set(ev, new Set());
	oyentes.get(ev).add(f);
	return () => oyentes.get(ev).delete(f);
};
export const emitir = (ev, d, extra) => oyentes.get(ev)?.forEach((f) => f(d, extra));

export function guardarAjustes() {
	memoria.escribir(CLAVE_AJ, E.aj);
	memoria.escribir(CLAVE_EST, { estilo: E.estilo, resalt: E.resalt });
}

// ---------------------------------------------------------------------------------------------- cambios en el documento
/** Cambia el documento con una entrada en el historial: `f` reemplaza listas y objetos (nunca los modifica en el lugar). */
export function cambiar(f) {
	E.hist.antes(E.doc);
	f();
	E.doc.modificado = Date.now();
	E.sucio = true;
	emitir('doc');
}

/** Reemplaza la lista de objetos de la página abierta. */
export function ponerObjetos(lista) {
	const p = pagina();
	p.objetos = lista;
}

/** Sustituye los objetos cuyos ids están en `mapa` (id → objeto nuevo); null en el mapa los elimina. */
export function reemplazar(mapa) {
	ponerObjetos(
		pagina()
			.objetos.map((o) => (mapa.has(o.id) ? mapa.get(o.id) : o))
			.filter(Boolean),
	);
}

export function seleccionar(ids) {
	const a = [...new Set(ids)];
	if (a.length === E.sel.length && a.every((id, i) => id === E.sel[i])) return;
	E.sel = a;
	emitir('sel');
	if (!a.length && E.herrPrevia) {
		const h = E.herrPrevia;
		E.herrPrevia = null;
		usarHerramienta(h);
	}
}

export function usarHerramienta(h, { previa = false } = {}) {
	if (E.herr === h) return;
	if (previa) E.herrPrevia = E.herr;
	else E.herrPrevia = null;
	E.herr = h;
	if (h !== 'seleccion' && h !== 'lazo' && !previa && E.sel.length) {
		E.sel = [];
		emitir('sel');
	}
	emitir('herr');
}

export function irAPagina(i) {
	const n = Math.max(0, Math.min(E.doc.paginas.length - 1, i));
	if (n === E.idx) return;
	E.idx = n;
	E.sel = [];
	E.previa = null;
	emitir('pagina');
	emitir('sel');
}

/** Reemplaza todo el documento (abrir, deshacer, rehacer): mantiene la página si existe y limpia lo que ya no está. */
export function ponerDoc(doc, { reiniciar = false } = {}) {
	E.doc = doc;
	if (reiniciar) {
		E.idx = 0;
		E.hist.limpiar();
	}
	E.idx = Math.max(0, Math.min(E.idx, doc.paginas.length - 1));
	const ids = new Set(pagina().objetos.map((o) => o.id));
	E.sel = E.sel.filter((id) => ids.has(id));
	E.previa = null;
	emitir('doc');
	emitir('sel');
	emitir('pagina');
}

export function deshacer() {
	const d = E.hist.deshacer(E.doc);
	if (!d) return false;
	E.sucio = true;
	ponerDoc(d);
	return true;
}
export function rehacer() {
	const d = E.hist.rehacer(E.doc);
	if (!d) return false;
	E.sucio = true;
	ponerDoc(d);
	return true;
}

export { instantanea };
