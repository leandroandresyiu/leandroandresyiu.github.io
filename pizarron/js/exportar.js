// Exportación: SVG (con la tipografía incrustada), PNG, PDF vectorial de varias páginas (jsPDF + svg2pdf.js) y un .zip de SVG.
// La hoja siempre sale de svg.js: es la misma geometría que se ve en pantalla.
import { paginaSVG, usaCursiva, usaTexto } from './svg.js';

const NS = 'http://www.w3.org/2000/svg';
// Para el PDF se usan las tipografías completas (jsPDF solo incrusta las letras que se usan); para el SVG y el PNG, las
// versiones chicas (solo letras latinas, griegas y símbolos comunes, en WOFF) que pesan casi la décima parte.
const URL_RECTA = '../compartido/fonts/lmroman10-regular.ttf';
const URL_CURSIVA = '../compartido/fonts/cmunti.ttf';
const WOFF_RECTA = 'fonts/lmroman10-latin.woff';
const WOFF_CURSIVA = 'fonts/cmuserif-italic-latin.woff';
const PT = 0.75; // 1 px de la hoja (96 por pulgada) = 0,75 pt de PDF (72 por pulgada)

const cache = {};
const base64 = (url) =>
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

/** SVG de una hoja con las tipografías incrustadas si hacen falta. */
export async function svgDePagina(pagina, { fondo = true, recursos = null } = {}) {
	const fuentes = usaTexto(pagina) ? { recta: await base64(WOFF_RECTA), cursiva: usaCursiva(pagina) ? await base64(WOFF_CURSIVA) : null } : null;
	return `<?xml version="1.0" encoding="UTF-8"?>\n${paginaSVG(pagina, { fondo, fuentes, recursos })}`;
}

export async function pngDePagina(pagina, { fondo = true, escala = 2, recursos = null } = {}) {
	const texto = await svgDePagina(pagina, { fondo, recursos });
	const w = Math.max(1, Math.round(pagina.ancho * escala));
	const h = Math.max(1, Math.round(pagina.alto * escala));
	if (w * h > 120e6) throw new Error('La imagen sería demasiado grande: bajá la resolución.');
	const url = URL.createObjectURL(new Blob([texto], { type: 'image/svg+xml;charset=utf-8' }));
	try {
		const img = new Image();
		img.width = w;
		img.height = h;
		img.src = url;
		await img.decode();
		await new Promise((r) => setTimeout(r, 60)); // las tipografías incrustadas terminan de cargar
		const cv = document.createElement('canvas');
		cv.width = w;
		cv.height = h;
		cv.getContext('2d').drawImage(img, 0, 0, w, h);
		return await new Promise((ok, mal) => cv.toBlob((b) => (b ? ok(b) : mal(new Error('No se pudo crear la imagen'))), 'image/png'));
	} finally {
		URL.revokeObjectURL(url);
	}
}

/** PDF con una página por hoja. `indices`: cuáles hojas (por defecto todas). Cada hoja conserva su tamaño. */
export async function pdfDeDoc(doc, { indices = null, host = document.body } = {}) {
	const lista = (indices ?? doc.paginas.map((_, i) => i)).map((i) => doc.paginas[i]).filter(Boolean);
	if (!lista.length) throw new Error('No hay páginas para exportar.');
	const { jsPDF } = window.jspdf;
	const formato = (p) => [p.ancho * PT, p.alto * PT];
	const orientacion = (p) => (p.ancho > p.alto ? 'landscape' : 'portrait');
	const pdf = new jsPDF({ unit: 'pt', format: formato(lista[0]), orientation: orientacion(lista[0]), compress: true });
	pdf.setProperties({ title: doc.titulo, subject: 'Pizarrón de kumOS', creator: 'kumOS · Pizarrón' });
	pdf.addFileToVFS('lmroman10-regular.ttf', await base64(URL_RECTA));
	pdf.addFont('lmroman10-regular.ttf', 'LM Roman 10', 'normal');
	pdf.addFont('lmroman10-regular.ttf', 'LM Roman 10', 'bold');
	pdf.addFileToVFS('cmunti.ttf', await base64(URL_CURSIVA));
	pdf.addFont('cmunti.ttf', 'LM Roman 10', 'italic');
	for (let i = 0; i < lista.length; i++) {
		const p = lista[i];
		if (i) pdf.addPage(formato(p), orientacion(p));
		const svg = new DOMParser().parseFromString(paginaSVG(p, { fondo: true, recursos: doc.recursos }), 'image/svg+xml').documentElement;
		const el = document.importNode(svg, true);
		host.appendChild(el);
		try {
			await window.svg2pdf.svg2pdf(el, pdf, { x: 0, y: 0, width: p.ancho * PT, height: p.alto * PT });
		} finally {
			el.remove();
		}
	}
	return pdf.output('blob');
}

/** Todas las hojas como SVG sueltos, en un .zip. */
export async function zipDeSVG(doc, nombreBase) {
	const archivos = {};
	for (let i = 0; i < doc.paginas.length; i++) {
		const n = `${nombreBase} - página ${String(i + 1).padStart(2, '0')}.svg`;
		archivos[n] = new TextEncoder().encode(await svgDePagina(doc.paginas[i], { recursos: doc.recursos }));
	}
	const zip = window.fflate.zipSync(archivos, { level: 6 });
	return new Blob([zip], { type: 'application/zip' });
}

export { NS };
