// Una hoja del pizarrón como SVG (texto). Lo usan la exportación a SVG, a PNG y a PDF (con svg2pdf.js).
// No toca el DOM: se prueba con Node. Todo lo que se escribe al archivo pasa por `esc` o es un número o un color validado.
import { partesDe, patron, num, TEXTO, textosDe, tramos } from './geometria.js';
import { fondoDe } from './fondo.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const COLOR = /^#[0-9a-f]{3,8}$/i;
const col = (c, def = '#000000') => (typeof c === 'string' && COLOR.test(c) ? c : def);
const FUENTE = 'LM Roman 10';

function trazoSVG(o, parte) {
	const op = o.op < 1 ? ` stroke-opacity="${num(o.op)}" fill-opacity="${num(o.op)}"` : '';
	if (parte.modo === 'relleno') return `<path d="${parte.d}" fill="${col(o.c)}" stroke="none"${op}/>`;
	const dash = parte.solida ? null : patron(o.e, o.g);
	const a = dash ? ` stroke-dasharray="${dash.map(num).join(' ')}"` : '';
	const fill = parte.modo === 'ambos' && o.r ? col(o.r) : 'none';
	return `<path d="${parte.d}" fill="${fill}" stroke="${col(o.c)}" stroke-width="${num(o.g)}" stroke-linecap="round" stroke-linejoin="round"${a}${op}/>`;
}

function textoSVG(o, t) {
	const op = o.op < 1 ? ` fill-opacity="${num(o.op)}"` : '';
	let s = `<text font-family="${FUENTE}" font-size="${num(t.tam)}" fill="${col(t.c)}"${op} xml:space="preserve">`;
	t.lineas.forEach((linea, i) => {
		const y = t.y + t.tam * TEXTO.base + i * t.tam * TEXTO.interlinea;
		for (const tr of tramos(linea, t.tam, t.cur)) {
			if (!tr.s) continue;
			s += `<tspan x="${num(t.x + tr.x)}" y="${num(y)}"${tr.it ? ' font-style="italic"' : ''}>${esc(tr.s)}</tspan>`;
		}
	});
	return `${s}</text>`;
}

function imagenSVG(o, recursos) {
	const rec = recursos?.[o.img];
	if (!rec) return '';
	const op = o.op < 1 ? ` opacity="${num(o.op)}"` : '';
	const giro = o.rot ? ` rotate(${num((o.rot * 180) / Math.PI)})` : '';
	const volteo = o.fx || o.fy ? ` scale(${o.fx ? -1 : 1} ${o.fy ? -1 : 1})` : '';
	return `<image href="data:${rec.mime};base64,${rec.datos}" x="${num(-o.ancho / 2)}" y="${num(-o.alto / 2)}" width="${num(o.ancho)}" height="${num(o.alto)}" preserveAspectRatio="none" transform="translate(${num(o.cx)} ${num(o.cy)})${giro}${volteo}"${op}/>`;
}

/** Un objeto como elementos SVG. */
export function objetoSVG(o, recursos = null) {
	if (o.t === 'imagen') return imagenSVG(o, recursos);
	let s = '';
	for (const p of partesDe(o)) s += trazoSVG(o, p);
	for (const t of textosDe(o)) s += textoSVG(o, t);
	return s;
}

/** ¿La hoja usa texto? (para saber si hay que incrustar las tipografías) */
export const usaTexto = (pagina) => pagina.objetos.some((o) => o.t === 'texto' || (o.t === 'ejes' && o.etq));
/** ¿Alguno de los textos usa cursiva (o letras que solo tiene la cursiva)? */
export const usaCursiva = (pagina) =>
	pagina.objetos.some((o) => textosDe(o).some((t) => t.lineas.some((l) => tramos(l, t.tam, t.cur).some((x) => x.it))));

/**
 * La hoja entera como texto SVG.
 *  - fondo: dibuja el color de la hoja y el rayado/cuadriculado (si no, queda transparente).
 *  - recursos: las imágenes del documento ({ id: { mime, datos } })
 *  - fuentes: { recta, cursiva } en base64 para incrustar las tipografías (para SVG sueltos); sin esto el texto usa la que haya.
 */
export function paginaSVG(pagina, { fondo = true, fuentes = null, recursos = null } = {}) {
	const { ancho, alto } = pagina;
	let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${num(ancho)}" height="${num(alto)}" viewBox="0 0 ${num(ancho)} ${num(alto)}">`;
	if (fuentes && usaTexto(pagina)) {
		let css = `@font-face{font-family:"${FUENTE}";font-style:normal;src:url(data:font/woff;base64,${fuentes.recta}) format("woff")}`;
		if (fuentes.cursiva && usaCursiva(pagina)) css += `@font-face{font-family:"${FUENTE}";font-style:italic;src:url(data:font/woff;base64,${fuentes.cursiva}) format("woff")}`;
		s += `<style>${css}</style>`;
	}
	if (fondo) {
		s += `<rect width="${num(ancho)}" height="${num(alto)}" fill="${col(pagina.color, '#ffffff')}"/>`;
		const f = fondoDe(pagina);
		if (f.lineas) s += `<path d="${f.lineas.d}" fill="none" stroke="${f.lineas.color}" stroke-width="${num(f.lineas.g)}"/>`;
		if (f.puntos) s += `<path d="${f.puntos.d}" fill="none" stroke="${f.puntos.color}" stroke-width="${num(f.puntos.g)}" stroke-linecap="round"/>`;
	}
	for (const o of pagina.objetos) s += objetoSVG(o, recursos);
	return `${s}</svg>`;
}

