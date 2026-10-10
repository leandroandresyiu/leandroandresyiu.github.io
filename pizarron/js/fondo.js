// Fondos de las hojas: liso, rayado, cuadriculado y cuadriculado de puntos. No toca el DOM.
// Devuelve caminos SVG: el canvas los dibuja con Path2D y la exportación los pone tal cual en el SVG o el PDF.
import { mmAPx } from './modelo.js';
import { num } from './geometria.js';

const rgb = (hex) => {
	let h = String(hex).replace('#', '');
	if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
	const n = parseInt(h.slice(0, 6), 16);
	return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [255, 255, 255];
};
const hex = (c) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

/** Brillo percibido de un color, de 0 (negro) a 1 (blanco). */
export const luminancia = (color) => {
	const [r, g, b] = rgb(color);
	return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};
/** Mezcla `a` con `b` en la proporción t (0 = a, 1 = b). */
export const mezclar = (a, b, t) => {
	const x = rgb(a);
	const y = rgb(b);
	return hex(x.map((v, i) => v + (y[i] - v) * t));
};

/** Color de las líneas del fondo: azulado en las hojas claras, claro en las oscuras. */
export const colorLineas = (colorPagina) => (luminancia(colorPagina) > 0.5 ? mezclar(colorPagina, '#3a66b0', 0.34) : mezclar(colorPagina, '#ffffff', 0.2));
export const colorPuntos = (colorPagina) => (luminancia(colorPagina) > 0.5 ? mezclar(colorPagina, '#2a3342', 0.5) : mezclar(colorPagina, '#ffffff', 0.38));

const cache = new Map();

/**
 * Elementos del fondo de una hoja: { lineas: { d, g, color } | null, puntos: { d, g, color } | null }.
 * `puntos.g` es el diámetro de cada punto (se dibujan como rayitas casi nulas con extremos redondos).
 */
export function fondoDe(pagina) {
	const clave = `${pagina.fondo}|${pagina.pasoMm}|${pagina.ancho}|${pagina.alto}|${pagina.color}`;
	const guardado = cache.get(clave);
	if (guardado) return guardado;
	const paso = mmAPx(pagina.pasoMm);
	const { ancho, alto } = pagina;
	// El dibujo queda centrado: lo que sobra se reparte entre los dos bordes.
	const ox = (ancho % paso) / 2;
	const oy = (alto % paso) / 2;
	let r = { lineas: null, puntos: null };
	if (pagina.fondo === 'rayado') {
		let d = '';
		for (let y = oy + paso * 2; y < alto - 2; y += paso) d += `M0 ${num(y)}H${num(ancho)}`;
		r = { lineas: { d, g: 0.7, color: colorLineas(pagina.color) }, puntos: null };
	} else if (pagina.fondo === 'cuadriculado') {
		let d = '';
		for (let y = oy; y < alto; y += paso) if (y > 0.5 && y < alto - 0.5) d += `M0 ${num(y)}H${num(ancho)}`;
		for (let x = ox; x < ancho; x += paso) if (x > 0.5 && x < ancho - 0.5) d += `M${num(x)} 0V${num(alto)}`;
		r = { lineas: { d, g: 0.6, color: colorLineas(pagina.color) }, puntos: null };
	} else if (pagina.fondo === 'puntos') {
		let d = '';
		for (let y = oy + paso; y < alto - 2; y += paso) for (let x = ox + paso; x < ancho - 2; x += paso) d += `M${num(x)} ${num(y)}h.01`;
		r = { lineas: null, puntos: { d, g: 2.2, color: colorPuntos(pagina.color) } };
	}
	if (cache.size > 40) cache.clear();
	cache.set(clave, r);
	return r;
}
