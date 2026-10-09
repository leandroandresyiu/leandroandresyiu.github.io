// Exportación: SVG (con la tipografía incrustada), PDF vectorial (jsPDF + svg2pdf.js), PNG y copia al portapapeles.
import { conFondo } from './render.js';

const NS = 'http://www.w3.org/2000/svg';
const FUENTE_URL = '../compartido/fonts/lmroman10-regular.ttf';

const cache = {};
const fuenteB64 = (url) =>
	(cache[url] ??= fetch(url)
		.then((r) => {
			if (!r.ok) throw new Error(`No se pudo leer la tipografía (${r.status})`);
			return r.arrayBuffer();
		})
		.then((b) => {
			const u = new Uint8Array(b);
			let s = '';
			for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
			return btoa(s);
		}));

const medidas = (svg) => ({ ancho: parseFloat(svg.getAttribute('width')), alto: parseFloat(svg.getAttribute('height')) });

/** Prepara una copia exportable: sin atributos internos y con fondo si se pide. */
function preparar(svg, fondo) {
	const c = svg.cloneNode(true);
	c.querySelectorAll('[data-tid],[data-cursor],[data-fila]').forEach((e) => {
		e.removeAttribute('data-tid');
		e.removeAttribute('data-cursor');
		e.removeAttribute('data-fila');
	});
	c.querySelectorAll('.editor-extra').forEach((e) => e.remove());
	if (fondo) conFondo(c);
	return c;
}

export async function svgTexto(svg, fondo = false) {
	const c = preparar(svg, fondo);
	const reg = await fuenteB64(FUENTE_URL);
	const st = document.createElementNS(NS, 'style');
	st.textContent = `@font-face{font-family:"LM Roman 10";font-style:normal;src:url(data:font/ttf;base64,${reg}) format("truetype")}`;
	c.insertBefore(st, c.firstChild);
	c.setAttribute('xmlns', NS);
	return { texto: '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(c), ...medidas(c) };
}

export async function pdfDe(svg, { fondo = false, escala = 0.75, titulo = 'Digital', host = document.body } = {}) {
	const c = preparar(svg, fondo);
	const { ancho, alto } = medidas(c);
	const w = ancho * escala;
	const h = alto * escala;
	host.appendChild(c);
	try {
		const { jsPDF } = window.jspdf;
		const doc = new jsPDF({ unit: 'pt', format: [w, h], orientation: w > h ? 'landscape' : 'portrait', compress: true });
		doc.setProperties({ title: titulo, subject: 'Diagrama de tiempos', creator: 'kumOS · Digital' });
		const reg = await fuenteB64(FUENTE_URL);
		doc.addFileToVFS('lmroman10-regular.ttf', reg);
		doc.addFont('lmroman10-regular.ttf', 'LM Roman 10', 'normal');
		doc.addFont('lmroman10-regular.ttf', 'LM Roman 10', 'bold'); // el título va "en negrita": se usa la misma tipografía
		await window.svg2pdf.svg2pdf(c, doc, { x: 0, y: 0, width: w, height: h });
		return doc.output('blob');
	} finally {
		c.remove();
	}
}

export async function pngDe(svg, { fondo = false, escala = 0.75, dpi = 300 } = {}) {
	const { texto, ancho, alto } = await svgTexto(svg, fondo);
	const px = escala * (dpi / 72);
	const w = Math.max(1, Math.round(ancho * px));
	const h = Math.max(1, Math.round(alto * px));
	if (w * h > 120e6) throw new Error('La imagen sería demasiado grande: bajá la resolución o el ancho del dibujo.');
	const url = URL.createObjectURL(new Blob([texto], { type: 'image/svg+xml;charset=utf-8' }));
	try {
		const img = new Image();
		img.width = w;
		img.height = h;
		img.src = url;
		await img.decode();
		await new Promise((r) => setTimeout(r, 60)); // las fuentes incrustadas terminan de cargar
		const cv = document.createElement('canvas');
		cv.width = w;
		cv.height = h;
		cv.getContext('2d').drawImage(img, 0, 0, w, h);
		return await new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo crear la imagen'))), 'image/png'));
	} finally {
		URL.revokeObjectURL(url);
	}
}

/** Copia una imagen PNG (promesa de Blob) al portapapeles. El permiso del clic se conserva al entregarla como promesa. */
export function copiarPNG(promesaBlob) {
	if (!navigator.clipboard || !window.ClipboardItem) return Promise.reject(new Error('Este navegador no deja copiar imágenes: usá el botón PNG.'));
	return navigator.clipboard.write([new ClipboardItem({ 'image/png': promesaBlob })]);
}
