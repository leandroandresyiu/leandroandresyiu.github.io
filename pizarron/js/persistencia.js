// Autoguardado: el pizarrón en el que se está trabajando se guarda solo en el navegador (IndexedDB) y se recupera al volver.
// No es el archivo "de verdad": para eso están Guardar en Archivo y Descargar. Es la red de seguridad si se cierra la pestaña.
import { deserializar, serializar } from './modelo.js';

const DB = 'kumos-pizarron';
let abierta = null;
function db() {
	abierta ??= new Promise((ok, mal) => {
		const r = indexedDB.open(DB, 1);
		r.onupgradeneeded = () => r.result.createObjectStore('sesion', { keyPath: 'k' });
		r.onsuccess = () => ok(r.result);
		r.onerror = () => mal(r.error);
	});
	return abierta;
}
async function tx(modo, f) {
	const d = await db();
	return new Promise((ok, mal) => {
		const r = f(d.transaction('sesion', modo).objectStore('sesion'));
		r.onsuccess = () => ok(r.result);
		r.onerror = () => mal(r.error);
	});
}

export async function guardarSesion(doc, origen) {
	await tx('readwrite', (t) => t.put({ k: 'actual', texto: serializar(doc), origen: origen ?? null, t: Date.now() }));
}

/** Devuelve { doc, origen } o null si no hay nada guardado (o está dañado). */
export async function leerSesion() {
	try {
		const r = await tx('readonly', (t) => t.get('actual'));
		if (!r) return null;
		return { doc: deserializar(r.texto), origen: r.origen ?? null };
	} catch {
		return null;
	}
}

let reloj = 0;
let pendiente = null;
/** Pide guardar dentro de un rato (se junta con otros pedidos seguidos). `dame` devuelve { doc, origen }. */
export function programarGuardado(dame, espera = 1200) {
	pendiente = dame;
	clearTimeout(reloj);
	reloj = window.setTimeout(vaciar, espera);
}
export async function vaciar() {
	clearTimeout(reloj);
	const dame = pendiente;
	pendiente = null;
	if (!dame) return;
	try {
		const { doc, origen } = dame();
		await guardarSesion(doc, origen);
	} catch {
		/* sin permiso de almacenamiento: se sigue trabajando igual */
	}
}
