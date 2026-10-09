// Controles de formulario y tablas que comparten todos los paneles.
import { h } from '../dom.js';

/** <select> con opciones [[valor, texto]]; conserva el tipo (número o texto) del valor elegido. */
export function selector(opciones, valor, alCambiar, atr = {}) {
	const s = h('select', atr);
	opciones.forEach(([v, t]) => s.append(h('option', { value: String(v), selected: String(v) === String(valor) }, t)));
	s.addEventListener('change', () => {
		const par = opciones.find(([v]) => String(v) === s.value);
		alCambiar(par ? par[0] : s.value);
	});
	return s;
}

export function numero(valor, alCambiar, { min, max, step = 1, ancho, ...resto } = {}) {
	const i = h('input', { type: 'number', value: String(valor), min, max, step, inputmode: 'decimal', ...resto });
	if (ancho) i.style.width = ancho;
	i.addEventListener('input', () => {
		const v = parseFloat(i.value.replace(',', '.'));
		if (Number.isFinite(v)) alCambiar(v);
	});
	return i;
}

export function textoLinea(valor, alCambiar, atr = {}) {
	const i = h('input', { type: 'text', value: valor ?? '', autocomplete: 'off', spellcheck: 'false', ...atr });
	i.addEventListener('input', () => alCambiar(i.value));
	return i;
}

export function areaTexto(valor, alCambiar, { filas = 3, placeholder = '', ...resto } = {}) {
	const a = h('textarea', { rows: filas, placeholder, spellcheck: 'false', autocomplete: 'off', ...resto });
	a.value = valor ?? '';
	a.addEventListener('input', () => alCambiar(a.value));
	return a;
}

/** Casilla con texto y una nota chica opcional. */
export function casilla(texto, nota, valor, alCambiar) {
	const i = h('input', { type: 'checkbox', checked: !!valor });
	i.addEventListener('change', () => alCambiar(i.checked));
	return h('label', { class: 'check' }, i, h('span', {}, texto, nota ? h('small', {}, ' ' + nota) : null));
}

/** <label> con un título y uno o más controles. `nota` va debajo, en chico. */
export function campo(etiqueta, controles, nota) {
	const lista = Array.isArray(controles) ? controles : [controles];
	return h('label', { class: 'campo' }, h('span', {}, etiqueta), lista.length > 1 ? h('div', { class: 'campo__fila' }, lista) : lista[0], nota ? h('small', { class: 'campo__nota' }, nota) : null);
}

/** Dos o tres campos cortos en una misma línea. */
export const fila = (...campos) => h('div', { class: 'fila-campos' }, campos);

/** Sección del panel con título. */
export const seccion = (titulo, ...hijos) => h('section', { class: 'sec' }, titulo ? h('h2', {}, titulo) : null, hijos);

/** Botones excluyentes (una sola opción activa). */
export function segmentado(opciones, valor, alCambiar, etiquetaAria = '') {
	const caja = h('div', { class: 'seg', role: 'tablist', 'aria-label': etiquetaAria });
	opciones.forEach(([v, t, titulo]) => {
		const b = h('button', { type: 'button', role: 'tab', class: 'seg__b', 'aria-selected': String(v === valor), title: titulo, onclick: () => alCambiar(v) }, t);
		caja.append(b);
	});
	return caja;
}

export const nota = (texto, clase = '') => h('p', { class: `nota ${clase}`.trim() }, texto);
export const aviso = (texto, tipo = 'info') => h('div', { class: `aviso aviso--${tipo}`, role: tipo === 'error' ? 'alert' : 'status' }, texto);

/**
 * Tabla. columnas: [{ t: 'Título', k: 'clave' | (fila, i) => contenido, clase? }]. opc.alElegir(fila, i) hace las filas clicables.
 */
export function tabla(columnas, filas, opc = {}) {
	const cuerpo = h('tbody');
	filas.forEach((f, i) => {
		const tr = h('tr', opc.alElegir ? { tabindex: '0', class: 'clicable' } : {});
		if (f && f.clase) tr.classList.add(f.clase);
		columnas.forEach((c) => {
			const v = typeof c.k === 'function' ? c.k(f, i) : f[c.k];
			tr.append(h('td', { class: c.clase || '' }, v === undefined || v === null ? '' : v));
		});
		if (opc.alElegir) {
			const elegir = () => {
				cuerpo.querySelectorAll('tr[aria-selected]').forEach((x) => x.removeAttribute('aria-selected'));
				tr.setAttribute('aria-selected', 'true');
				opc.alElegir(f, i);
			};
			tr.addEventListener('click', elegir);
			tr.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					elegir();
				}
			});
		}
		cuerpo.append(tr);
	});
	return h('div', { class: 'tabla-caja' }, h('table', { class: 'tabla' }, h('thead', {}, h('tr', {}, columnas.map((c) => h('th', { class: c.clase || '' }, c.t)))), cuerpo));
}

/** Botón para copiar un texto al portapapeles; avisa con el propio rótulo. */
export function botonCopiar(rotulo, obtenerTexto, atr = {}) {
	const b = h('button', { type: 'button', class: 'btn btn--chico', ...atr }, rotulo);
	b.addEventListener('click', async () => {
		const previo = b.textContent;
		try {
			await navigator.clipboard.writeText(obtenerTexto());
			b.textContent = 'Copiado';
		} catch {
			b.textContent = 'No se pudo copiar';
		}
		setTimeout(() => (b.textContent = previo), 1400);
	});
	return b;
}

/** Hexadecimal con espacios: [222, 173] -> "DE AD". */
export const hexLista = (bytes) => bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');

/** Línea de datos sueltos: [['Tiempo de bit', '104 µs'], ...] */
export const resumenDe = (pares) => h('div', { class: 'resumen' }, pares.filter(Boolean).map(([k, v]) => h('span', {}, `${k}: `, h('b', {}, v))));

/** Completa en `est` lo que falte con los valores de `base` (sin pisar lo que ya hay). */
export function conDefectos(est, base) {
	for (const [k, v] of Object.entries(base)) if (est[k] === undefined) est[k] = v;
	return est;
}

export const chip = (texto, tipo = '') => h('span', { class: `chip ${tipo ? `chip--${tipo}` : ''}`.trim() }, texto);

const MULT_HZ = { Hz: 1, kHz: 1e3, MHz: 1e6 };
/** Frecuencia con número y unidad (Hz, kHz, MHz). El valor se guarda en Hz en est[clave]. */
export function campoFrecuencia(etiqueta, est, clave, cambio, nota) {
	est[`${clave}U`] ??= est[clave] >= 1e6 ? 'MHz' : est[clave] >= 1e3 ? 'kHz' : 'Hz';
	const u = () => MULT_HZ[est[`${clave}U`]];
	const valor = numero(Number((est[clave] / u()).toPrecision(6)), (v) => {
		if (v > 0) {
			est[clave] = v * u();
			cambio();
		}
	}, { min: 0, step: 'any' });
	const unidad = selector(Object.keys(MULT_HZ).map((k) => [k, k]), est[`${clave}U`], (k) => {
		const actual = parseFloat(valor.value.replace(',', '.'));
		est[`${clave}U`] = k;
		if (actual > 0) est[clave] = actual * MULT_HZ[k];
		cambio();
	});
	return campo(etiqueta, [valor, unidad], nota);
}
