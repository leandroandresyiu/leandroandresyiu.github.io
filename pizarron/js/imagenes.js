// Imágenes en el pizarrón: se pegan del portapapeles (Ctrl+V), se sueltan sobre la hoja o se eligen del equipo. Si son enormes se
// achican, y se guardan dentro del propio pizarrón (en `doc.recursos`) para que el archivo .pizarron sea autosuficiente.
// En la hoja son objetos "imagen" (centro, tamaño, giro y volteo), así que se pueden mover, agrandar y girar como todo lo demás.
import { E, cambiar, emitir, pagina, ponerObjetos, seleccionar, usarHerramienta } from './estado.js';
import { base, nuevoId } from './geometria.js';
import { aPagina, tamano } from './vista.js';

const MAX_LADO = 1800; // las fotos más grandes se achican a esto
const DIRECTOS = new Set(['image/png', 'image/jpeg']); // se guardan tal cual si no son enormes
const MAX_DIRECTO = 1.5e6;
const MAX_PNG = 2.5e6; // un PNG más pesado se pasa a JPEG

function aBase64(buf) {
	const u = new Uint8Array(buf);
	let s = '';
	for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
	return btoa(s);
}

async function decodificar(blob) {
	const url = URL.createObjectURL(blob);
	try {
		const img = new Image();
		img.src = url;
		await img.decode();
		return img;
	} catch {
		throw new Error('No se pudo leer la imagen (¿es un formato que el navegador no abre?).');
	} finally {
		URL.revokeObjectURL(url);
	}
}

const aBlob = (cv, mime, calidad) => new Promise((ok, mal) => cv.toBlob((b) => (b ? ok(b) : mal(new Error('No se pudo achicar la imagen.'))), mime, calidad));

/** Deja la imagen lista para guardar: { mime, datos (base64), w, h }. */
export async function prepararImagen(blob) {
	const img = await decodificar(blob);
	const w0 = img.naturalWidth || img.width;
	const h0 = img.naturalHeight || img.height;
	if (!w0 || !h0) throw new Error('La imagen está vacía.');
	const k = Math.min(1, MAX_LADO / Math.max(w0, h0));
	let w = w0;
	let h = h0;
	let mime = blob.type;
	let final = blob;
	if (k < 1 || !DIRECTOS.has(blob.type) || blob.size > MAX_DIRECTO) {
		w = Math.max(1, Math.round(w0 * k));
		h = Math.max(1, Math.round(h0 * k));
		const dibujar = (sobreBlanco) => {
			const cv = document.createElement('canvas');
			cv.width = w;
			cv.height = h;
			const cx = cv.getContext('2d');
			if (sobreBlanco) {
				cx.fillStyle = '#ffffff';
				cx.fillRect(0, 0, w, h);
			}
			cx.imageSmoothingQuality = 'high';
			cx.drawImage(img, 0, 0, w, h);
			return cv;
		};
		const jpeg = blob.type === 'image/jpeg';
		mime = jpeg ? 'image/jpeg' : 'image/png';
		final = await aBlob(dibujar(jpeg), mime, 0.88);
		// una captura o una foto en PNG puede pesar muchísimo: se guarda como JPEG
		if (mime === 'image/png' && final.size > MAX_PNG) {
			mime = 'image/jpeg';
			final = await aBlob(dibujar(true), mime, 0.88);
		}
	}
	const datos = aBase64(await final.arrayBuffer());
	if (datos.length > 24e6) throw new Error('La imagen es demasiado pesada.');
	return { mime, datos, w, h };
}

/**
 * Pone una imagen en la hoja: del tamaño que entre cómodo, en el centro de lo que se ve (o en `donde`, un punto de la hoja) y
 * seleccionada, lista para mover, agrandar o girar.
 */
export async function insertarImagen(blob, donde = null) {
	const r = await prepararImagen(blob);
	const id = nuevoId();
	E.doc.recursos ??= {};
	E.doc.recursos[id] = { mime: r.mime, datos: r.datos, w: r.w, h: r.h };
	const pg = pagina();
	const fit = Math.min(1, (pg.ancho * 0.6) / r.w, (pg.alto * 0.6) / r.h);
	const ancho = Math.max(8, r.w * fit);
	const alto = Math.max(8, r.h * fit);
	const t = tamano();
	const c = donde ?? aPagina(t.W / 2, t.H / 2);
	const cx = Math.min(pg.ancho - ancho / 2, Math.max(ancho / 2, c.x));
	const cy = Math.min(pg.alto - alto / 2, Math.max(alto / 2, c.y));
	const obj = base('imagen', { g: 0, img: id, cx, cy, ancho, alto, rot: 0, fx: 0, fy: 0 });
	cambiar(() => ponerObjetos([...pagina().objetos, obj]));
	usarHerramienta('seleccion');
	seleccionar([obj.id]);
	emitir('aviso', 'Imagen puesta: arrastrala, agrandala con las esquinas o girala con la manija de arriba');
	return obj;
}

/** La primera imagen que haya en lo que pegó o soltó la persona (archivos o portapapeles), o null. */
export function imagenDe(dt) {
	if (!dt) return null;
	for (const it of dt.items ?? []) if (it.kind === 'file' && it.type.startsWith('image/')) return it.getAsFile();
	for (const f of dt.files ?? []) if (f.type.startsWith('image/')) return f;
	return null;
}

/** Botón "Pegar imagen": lee el portapapeles (el navegador pide permiso la primera vez). */
export async function pegarDelPortapapeles() {
	if (!navigator.clipboard?.read) throw new Error('Este navegador no deja leer el portapapeles: usá Ctrl+V.');
	let items;
	try {
		items = await navigator.clipboard.read();
	} catch {
		throw new Error('No se pudo leer el portapapeles (falta el permiso). Probá con Ctrl+V.');
	}
	for (const it of items) {
		const tipo = it.types.find((t) => t.startsWith('image/'));
		if (tipo) return insertarImagen(await it.getType(tipo));
	}
	throw new Error('No hay ninguna imagen en el portapapeles.');
}

/** Botón "Imagen del equipo…". */
export function elegirImagenDelEquipo() {
	const entrada = document.createElement('input');
	entrada.type = 'file';
	entrada.accept = 'image/*';
	entrada.addEventListener('change', async () => {
		const f = entrada.files?.[0];
		if (!f) return;
		try {
			await insertarImagen(f);
		} catch (e) {
			emitir('aviso', e.message, 5000);
		}
	});
	entrada.click();
}
