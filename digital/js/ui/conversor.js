// Conversor de bits: un desplegable que se abre desde cualquier pestaña (UART, I²C, SPI…) para pasar un valor de un
// formato a otro y copiar el resultado. La lógica (sin DOM) está en ../convertir.js.
import { ANCHOS, FORMATOS, comoHex, formas, girarBit, leerEntrada } from '../convertir.js';
import { $, h, memoria } from '../dom.js';

const CLAVE = 'digital.conversor';

/** Copia con la API del portapapeles y, si el navegador no la deja, con un área de texto escondida. */
async function copiarTexto(texto) {
	try {
		await navigator.clipboard.writeText(texto);
		return true;
	} catch {
		const a = h('textarea', { style: 'position:fixed;left:-9999px;top:0' });
		a.value = texto;
		document.body.append(a);
		a.select();
		let ok = false;
		try {
			ok = document.execCommand('copy');
		} catch {
			ok = false;
		}
		a.remove();
		return ok;
	}
}

export function montarConversor() {
	const boton = $('#conversor');
	const panel = $('#conv');
	if (!boton || !panel) return;
	const est = { texto: '0x48', formato: 'hex', ancho: 'auto', ...memoria.leer(CLAVE, {}) };
	const guardar = () => memoria.escribir(CLAVE, est);

	const entrada = h('input', { type: 'text', class: 'conv__entrada', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Valor a convertir', placeholder: '0x48, 72, 0100 1000…' });
	entrada.value = est.texto;
	const formato = h('select', { 'aria-label': 'Formato de lo que escribís' }, Object.entries(FORMATOS).map(([k, t]) => h('option', { value: k, selected: k === est.formato }, t)));
	const ancho = h('select', { 'aria-label': 'Cantidad de bits' }, ANCHOS.map((a) => h('option', { value: String(a), selected: String(a) === String(est.ancho) }, a === 'auto' ? 'Ancho automático' : `${a} bits`)));
	const aviso = h('div', { class: 'conv__aviso', role: 'status' });
	const bitsCaja = h('div', { class: 'conv__bits', role: 'group', 'aria-label': 'Bits: tocá uno para invertirlo' });
	const lista = h('div', { class: 'conv__lista' });
	const todo = h('button', { type: 'button', class: 'btn btn--chico', onclick: async (e) => {
		const b = e.currentTarget;
		const previo = b.textContent;
		b.textContent = (await copiarTexto(ultimasFormas.map((f) => `${f.nombre}: ${f.valor}`).join('\n'))) ? 'Copiado' : 'No se pudo copiar';
		setTimeout(() => (b.textContent = previo), 1200);
	} }, 'Copiar todo');
	let ultimasFormas = [];
	let actual = null; // { valor, ancho }

	panel.replaceChildren(
		h('div', { class: 'conv__bar' }, h('strong', {}, 'Conversor de bits'), h('button', { type: 'button', class: 'btn btn--icon btn--chico', 'aria-label': 'Cerrar', onclick: () => cerrar(true) }, '×')),
		h('div', { class: 'conv__fila-entrada' }, entrada, formato),
		h('div', { class: 'conv__fila-opciones' }, ancho, h('span', { class: 'conv__tip' }, 'Tocá un valor para copiarlo.')),
		aviso,
		bitsCaja,
		lista,
		h('div', { class: 'conv__pie' }, todo),
	);

	function actualizar() {
		est.texto = entrada.value;
		est.formato = formato.value;
		est.ancho = ancho.value === 'auto' ? 'auto' : Number(ancho.value);
		guardar();
		const r = leerEntrada(est.texto, est.formato, est.ancho);
		aviso.replaceChildren();
		bitsCaja.replaceChildren();
		lista.replaceChildren();
		todo.disabled = true;
		actual = null;
		ultimasFormas = [];
		if (r.vacio) return;
		if (r.error) {
			aviso.append(h('p', { class: 'aviso aviso--error' }, r.error));
			return;
		}
		for (const t of r.avisos) aviso.append(h('p', { class: 'aviso aviso--aviso' }, t));
		actual = { valor: r.valor, ancho: r.ancho };
		pintarBits(r.valor, r.ancho);
		ultimasFormas = formas(r.valor, r.ancho);
		todo.disabled = false;
		for (const f of ultimasFormas) {
			const val = h('button', { type: 'button', class: 'conv__val', title: 'Copiar' }, f.valor);
			const cop = h('button', { type: 'button', class: 'conv__cop', 'aria-label': `Copiar ${f.nombre}` }, 'Copiar');
			const hacer = async () => {
				const ok = await copiarTexto(f.valor);
				cop.textContent = ok ? 'Copiado' : 'No se pudo';
				cop.classList.toggle('es-ok', ok);
				setTimeout(() => {
					cop.textContent = 'Copiar';
					cop.classList.remove('es-ok');
				}, 1200);
			};
			val.addEventListener('click', hacer);
			cop.addEventListener('click', hacer);
			lista.append(h('div', { class: 'conv__fila' }, h('span', { class: 'conv__nom' }, f.nombre, f.nota ? h('small', {}, ` ${f.nota}`) : null), val, cop));
		}
	}

	/** Los bits como botones, en grupos de un byte: sirve para armar o mirar un registro. */
	function pintarBits(valor, w) {
		const bytes = w / 8;
		for (let by = bytes - 1; by >= 0; by--) {
			const grupo = h('div', { class: 'conv__byte' });
			for (let b = 7; b >= 0; b--) {
				const i = by * 8 + b;
				const uno = ((valor >> BigInt(i)) & 1n) === 1n;
				grupo.append(
					h('button', { type: 'button', class: 'conv__bit', 'aria-pressed': String(uno), 'aria-label': `Bit ${i}: ${uno ? 1 : 0}`, onclick: () => {
						if (!actual) return;
						const nuevo = girarBit(actual.valor, i, actual.ancho);
						entrada.value = comoHex(nuevo, actual.ancho);
						formato.value = 'hex';
						ancho.value = String(actual.ancho);
						actualizar();
					} }, h('i', {}, String(i)), uno ? '1' : '0'),
				);
			}
			bitsCaja.append(grupo);
		}
	}

	entrada.addEventListener('input', actualizar);
	formato.addEventListener('change', actualizar);
	ancho.addEventListener('change', actualizar);

	function ubicar() {
		const barra = document.querySelector('.top');
		panel.style.top = `${Math.round((barra ? barra.getBoundingClientRect().bottom : 48) + 6)}px`;
	}
	function abrir() {
		ubicar();
		panel.hidden = false;
		boton.setAttribute('aria-expanded', 'true');
		actualizar();
		entrada.focus();
		entrada.select();
	}
	function cerrar(devolverFoco = false) {
		if (panel.hidden) return;
		panel.hidden = true;
		boton.setAttribute('aria-expanded', 'false');
		if (devolverFoco) boton.focus();
	}
	boton.addEventListener('click', () => (panel.hidden ? abrir() : cerrar(true)));
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape' && !panel.hidden) {
			e.preventDefault();
			cerrar(true);
		}
	});
	document.addEventListener('pointerdown', (e) => {
		if (panel.hidden || panel.contains(e.target) || boton.contains(e.target)) return;
		cerrar();
	});
	addEventListener('resize', () => !panel.hidden && ubicar());
	actualizar();
}
