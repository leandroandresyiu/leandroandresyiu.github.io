// Puente con la app Archivo de kumOS: py snippets corre en un iframe del mismo sitio y comparte el IndexedDB "kumos-archivo"
// (mismo esquema que src/scripts/archivo/store.ts). Los cuadernos se guardan como .ipynb en la carpeta "Cuadernos".
export const CARPETA = 'Cuadernos';
const DB = 'kumos-archivo';

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
function avisar() {
	try {
		const p = window.parent;
		if (p && p !== window) p.dispatchEvent(new p.CustomEvent('kumos:archivo'));
	} catch {
		/* otro origen */
	}
}
export const limpiarNombre = (n) => String(n).replace(/[\/:*?"<>|]/g, '-').trim().slice(0, 90);

/** Los archivos con esa extensión, en cualquier carpeta, el más reciente primero. */
export async function listar(ext) {
	const todos = await tx('archivos', 'readonly', (t) => t.getAll());
	return todos
		.filter((a) => a.nombre?.toLowerCase().endsWith(ext))
		.map((a) => ({ id: a.id, carpeta: a.carpeta, nombre: a.nombre, tam: a.tam ?? a.datos?.size ?? 0, mod: a.mod ?? 0 }))
		.sort((a, b) => b.mod - a.mod);
}

export async function leerBytes(id) {
	const a = await tx('archivos', 'readonly', (t) => t.get(id));
	if (!a) return null;
	const bytes = a.datos instanceof Blob ? new Uint8Array(await a.datos.arrayBuffer()) : new TextEncoder().encode(a.texto ?? '');
	return { id: a.id, carpeta: a.carpeta, nombre: a.nombre, bytes };
}

/** Un .asc de LTspice puede venir en UTF-16 (con o sin BOM), UTF-8 o ANSI. */
export function decodificar(bytes) {
	if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
	if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
	if (bytes.length > 3 && bytes[1] === 0 && bytes[3] === 0) return new TextDecoder('utf-16le').decode(bytes);
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes[0] === 0xef ? bytes.subarray(3) : bytes);
	} catch {
		return new TextDecoder('windows-1252').decode(bytes);
	}
}

export async function guardar(carpeta, nombre, texto) {
	const n = limpiarNombre(nombre) || 'cuaderno.ipynb';
	const blob = new Blob([texto], { type: 'application/json' });
	const id = `${carpeta}/${n}`;
	await tx('carpetas', 'readwrite', (t) => t.put({ nombre: carpeta }));
	await tx('archivos', 'readwrite', (t) => t.put({ id, carpeta, nombre: n, tipo: 'application/json', tam: blob.size, mod: Date.now(), datos: blob }));
	avisar();
	return id;
}
