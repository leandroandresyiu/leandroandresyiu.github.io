// Puente con la app Archivo de kumOS. El Pizarrón corre en un iframe del mismo sitio, así que comparte el IndexedDB
// "kumos-archivo" con la app Archivo (mismo esquema que src/scripts/archivo/store.ts): lo que se guarda acá aparece allá.
export const CARPETA = 'Pizarrón';
export const EXT = '.pizarron';
const DB = 'kumos-archivo';
export const CARPETA_CIRCUITOS = 'Circuitos LTspice';
const TIPOS = { pizarron: 'application/json', pdf: 'application/pdf', svg: 'image/svg+xml', png: 'image/png', asc: 'text/plain' };

let abierta = null;
function db() {
	abierta ??= new Promise((ok, mal) => {
		const r = indexedDB.open(DB, 2);
		r.onupgradeneeded = () => {
			const d = r.result;
			if (!d.objectStoreNames.contains('archivos')) d.createObjectStore('archivos', { keyPath: 'id' });
			if (!d.objectStoreNames.contains('carpetas')) d.createObjectStore('carpetas', { keyPath: 'nombre' });
		};
		r.onsuccess = () => ok(r.result);
		r.onerror = () => mal(r.error);
	});
	return abierta;
}

async function tx(tabla, modo, f) {
	const d = await db();
	return new Promise((ok, mal) => {
		const r = f(d.transaction(tabla, modo).objectStore(tabla));
		r.onsuccess = () => ok(r.result);
		r.onerror = () => mal(r.error);
	});
}

/** Le avisa a la app Archivo (la ventana de afuera) que cambió algo, para que se actualice. */
function avisar() {
	try {
		const p = window.parent;
		if (p && p !== window) p.dispatchEvent(new p.CustomEvent('kumos:archivo'));
	} catch {
		/* otro origen: no hay nada que avisar */
	}
}

export const limpiarNombre = (n) => String(n).replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 90);
const extension = (nombre) => (nombre.split('.').pop() ?? '').toLowerCase();

export async function carpetas() {
	const lista = await tx('carpetas', 'readonly', (t) => t.getAll());
	return lista.map((c) => c.nombre).sort((a, b) => (a === CARPETA ? -1 : b === CARPETA ? 1 : a.localeCompare(b, 'es')));
}

/** Los pizarrones (.pizarron) guardados en cualquier carpeta, el más reciente primero. */
export async function listarPizarrones() {
	const todos = await tx('archivos', 'readonly', (t) => t.getAll());
	return todos
		.filter((a) => a.nombre?.toLowerCase().endsWith(EXT))
		.map((a) => ({ id: a.id, carpeta: a.carpeta, nombre: a.nombre, tam: a.tam ?? a.datos?.size ?? 0, mod: a.mod ?? 0 }))
		.sort((a, b) => b.mod - a.mod);
}

export async function leer(id) {
	const a = await tx('archivos', 'readonly', (t) => t.get(id));
	if (!a) return null;
	const texto = a.datos instanceof Blob ? await a.datos.text() : (a.texto ?? '');
	return { id: a.id, carpeta: a.carpeta, nombre: a.nombre, texto };
}

/** Guarda (o reemplaza, si ya hay uno con ese nombre en la carpeta). Devuelve el id: "carpeta/nombre". */
export async function guardar(carpeta, nombre, datos) {
	const n = limpiarNombre(nombre) || 'archivo';
	const blob = typeof datos === 'string' ? new Blob([datos], { type: 'application/json' }) : datos;
	const id = `${carpeta}/${n}`;
	await tx('carpetas', 'readwrite', (t) => t.put({ nombre: carpeta }));
	await tx('archivos', 'readwrite', (t) => t.put({ id, carpeta, nombre: n, tipo: blob.type || TIPOS[extension(n)] || 'application/octet-stream', tam: blob.size, mod: Date.now(), datos: blob }));
	avisar();
	return id;
}

export async function crearCarpeta(nombre) {
	const n = limpiarNombre(nombre);
	if (!n) return null;
	await tx('carpetas', 'readwrite', (t) => t.put({ nombre: n }));
	avisar();
	return n;
}

/** Los esquemas de LTspice (.asc) guardados en cualquier carpeta, el más reciente primero. */
export async function listarASC() {
	const todos = await tx('archivos', 'readonly', (t) => t.getAll());
	return todos
		.filter((a) => a.nombre?.toLowerCase().endsWith('.asc'))
		.map((a) => ({ id: a.id, carpeta: a.carpeta, nombre: a.nombre, tam: a.tam ?? a.datos?.size ?? 0, mod: a.mod ?? 0 }))
		.sort((a, b) => b.mod - a.mod);
}

/** Los bytes de un archivo (para leer con su codificación, que en los .asc de LTspice puede ser ANSI, UTF-8 o UTF-16). */
export async function leerBytes(id) {
	const a = await tx('archivos', 'readonly', (t) => t.get(id));
	if (!a) return null;
	const bytes = a.datos instanceof Blob ? new Uint8Array(await a.datos.arrayBuffer()) : new TextEncoder().encode(a.texto ?? '');
	return { id: a.id, carpeta: a.carpeta, nombre: a.nombre, bytes };
}

/** Un nombre que no pise ningún archivo de la carpeta: "circuito.asc", "circuito (2).asc"… */
export async function nombreLibre(carpeta, base, ext) {
	const usados = new Set((await tx('archivos', 'readonly', (t) => t.getAll())).filter((a) => a.carpeta === carpeta).map((a) => a.nombre.toLowerCase()));
	const limpio = limpiarNombre(base) || 'archivo';
	let n = 1;
	let nombre = `${limpio}${ext}`;
	while (usados.has(nombre.toLowerCase())) nombre = `${limpio} (${++n})${ext}`;
	return nombre;
}

export const sinExtension = (nombre) => nombre.replace(/\.pizarron$/i, '');
