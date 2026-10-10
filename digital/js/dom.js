// Ayudas mínimas para armar elementos del DOM sin librerías.
export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

/**
 * h('div', { class: 'x', onclick: fn, dataset: { a: 1 } }, 'texto', otroNodo, [lista...])
 * Atributos: class, text, html, value, checked, disabled, hidden, on<evento>, dataset, el resto va como atributo.
 */
export function h(tag, at = {}, ...hijos) {
	const e = document.createElement(tag);
	for (const [k, v] of Object.entries(at || {})) {
		if (v === undefined || v === null || v === false) continue;
		if (k === 'class') e.className = v;
		else if (k === 'text') e.textContent = v;
		else if (k === 'html') e.innerHTML = v;
		else if (k === 'dataset') Object.assign(e.dataset, v);
		else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'hidden' || k === 'selected') e[k] = v;
		else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
		else e.setAttribute(k, v === true ? '' : String(v));
	}
	const poner = (x) => {
		if (x === undefined || x === null || x === false) return;
		if (Array.isArray(x)) x.forEach(poner);
		else e.append(x instanceof Node ? x : document.createTextNode(String(x)));
	};
	hijos.forEach(poner);
	return e;
}

/** Reemplaza todo el contenido de un nodo. */
export function vaciar(nodo, ...hijos) {
	nodo.replaceChildren();
	hijos.forEach((x) => x !== undefined && x !== null && x !== false && nodo.append(x instanceof Node ? x : document.createTextNode(String(x))));
	return nodo;
}

/** Ejecuta `f` a lo sumo una vez por cuadro de animación. */
export function porCuadro(f) {
	let pend = false;
	return (...a) => {
		if (pend) return;
		pend = true;
		requestAnimationFrame(() => {
			pend = false;
			f(...a);
		});
	};
}

/** Lectura y escritura tolerantes de localStorage (puede no existir o estar bloqueado). */
export const memoria = {
	leer(clave, defecto = null) {
		try {
			const t = localStorage.getItem(clave);
			return t === null ? defecto : JSON.parse(t);
		} catch {
			return defecto;
		}
	},
	escribir(clave, valor) {
		try {
			localStorage.setItem(clave, JSON.stringify(valor));
			return true;
		} catch {
			return false;
		}
	},
};

export function descargar(blob, nombre) {
	const a = document.createElement('a');
	a.href = URL.createObjectURL(blob);
	a.download = nombre;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export const mensajeError = (e) => (e && e.message ? e.message : String(e));
