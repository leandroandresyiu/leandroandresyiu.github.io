// py snippets: cuaderno de celdas con Python (Pyodide), galería de snippets con datos por completar, Archivo y .ipynb.
import { crearEditor } from '../vendor/cm.js';
import { GRUPOS, SNIPPETS, CUADERNO_INICIAL } from './snippets.js';
import * as Archivo from './archivo.js';

const VERSION = '1';
const $ = (id) => document.getElementById(id);
const el = (tag, cls, txt) => {
	const e = document.createElement(tag);
	if (cls) e.className = cls;
	if (txt != null) e.textContent = txt;
	return e;
};
const ICONOS = {
	correr: '<path d="M7 5l12 7-12 7z"/>',
	arriba: '<path d="M12 19V5M6 11l6-6 6 6"/>',
	abajo: '<path d="M12 5v14M6 13l6 6 6-6"/>',
	copiar: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
	borrar: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
	tipo: '<path d="M5 6h14M12 6v13M9 19h6"/>',
};
const icono = (n, titulo, cls = '') => {
	const b = el('button', `ic ${cls}`);
	b.type = 'button';
	b.title = titulo;
	b.setAttribute('aria-label', titulo);
	b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONOS[n]}</svg>`;
	return b;
};

function aviso(txt, ms = 2600) {
	const a = $('aviso');
	a.textContent = txt;
	a.hidden = false;
	clearTimeout(aviso.t);
	aviso.t = setTimeout(() => (a.hidden = true), ms);
}

// ------------------------------------------------------------------------------------------------ Python (worker)
const py = { worker: null, listo: false, lcapy: false, pend: new Map(), id: 0 };

function estado(tipo, txt) {
	$('estado').dataset.estado = tipo;
	$('estado-t').textContent = txt;
}

function arrancarPython() {
	py.listo = false;
	py.lcapy = false;
	synced.clear();
	py.worker = new Worker(new URL(`worker.js?v=${VERSION}`, import.meta.url), { type: 'module', name: VERSION });
	py.listo$ = new Promise((ok) => (py.resolverListo = ok));
	py.worker.onmessage = (ev) => {
		const m = ev.data;
		if (m.t === 'estado') estado('carga', m.v);
		else if (m.t === 'listo') {
			py.listo = true;
			estado('listo', 'Python listo · cargando Lcapy…');
			py.resolverListo();
			cargarEjemplo();
		} else if (m.t === 'lcapy') {
			py.lcapy = true;
			if (!py.pend.size) estado('listo', 'Python y Lcapy listos');
		} else if (m.id != null && py.pend.has(m.id)) {
			const p = py.pend.get(m.id);
			py.pend.delete(m.id);
			if (m.t === 'fallo') p.mal(new Error(m.mensaje));
			else p.ok(m);
		} else if (m.t === 'fallo') estado('mal', 'Error al cargar Python: ' + m.mensaje.slice(0, 120));
	};
	py.worker.onerror = (e) => estado('mal', 'No pude iniciar Python: ' + (e.message || 'error'));
	py.worker.postMessage({ t: 'iniciar' });
}
function llamar(msg) {
	return new Promise((ok, mal) => {
		const id = ++py.id;
		py.pend.set(id, { ok, mal });
		py.worker.postMessage({ ...msg, id });
	});
}

/** Los .asc que el código nombra se mandan a Python (desde lo subido o desde Archivo). */
const synced = new Set();
const subidos = new Map(); // nombre → texto
async function sincronizarArchivos(codigo) {
	const nombres = [...codigo.matchAll(/["']([^"'\n]+\.asc)["']/gi)].map((m) => m[1].split(/[\\/]/).pop());
	for (const n of nombres) {
		if (synced.has(n.toLowerCase())) continue;
		let texto = subidos.get(n.toLowerCase());
		if (texto == null) {
			try {
				const lista = await Archivo.listar('.asc');
				const f = lista.find((a) => a.nombre.toLowerCase() === n.toLowerCase());
				if (f) texto = Archivo.decodificar((await Archivo.leerBytes(f.id)).bytes);
			} catch {
				/* sin Archivo */
			}
		}
		if (texto == null) continue;
		await llamar({ t: 'archivo', nombre: n, texto });
		synced.add(n.toLowerCase());
	}
}
async function cargarEjemplo() {
	try {
		const r = await fetch(new URL(`../ejemplos/amplificador_ce.asc?v=${VERSION}`, import.meta.url));
		subidos.set('amplificador_ce.asc', await r.text());
	} catch {
		/* sin ejemplo */
	}
}

// ------------------------------------------------------------------------------------------------ cuaderno
let celdas = [];
let activa = null;
let contador = 0;
let cadena = Promise.resolve();
const lista = $('cuaderno');

const nuevoId = () => 'c' + Math.random().toString(36).slice(2, 9);

function crearCelda(tipo, texto = '', salidas = [], n = null) {
	return { id: nuevoId(), tipo, texto, salidas, n, el: null, editor: null };
}

function mdSimple(t) {
	const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\*([^*]+)\*/g, '<i>$1</i>');
	const out = [];
	let enLista = false;
	for (const ln of t.split('\n')) {
		const h = /^(#{1,3})\s+(.*)$/.exec(ln);
		const li = /^\s*[-*]\s+(.*)$/.exec(ln);
		if (enLista && !li) {
			out.push('</ul>');
			enLista = false;
		}
		if (h) out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
		else if (li) {
			if (!enLista) out.push('<ul>');
			enLista = true;
			out.push(`<li>${inline(li[1])}</li>`);
		} else if (ln.trim()) out.push(`<p>${inline(ln)}</p>`);
	}
	if (enLista) out.push('</ul>');
	return out.join('');
}

function pintarSalidas(c) {
	const caja = c.el.querySelector('.salidas');
	caja.replaceChildren();
	for (const o of c.salidas) {
		if (o.t === 'texto') caja.append(el('pre', 'o-texto', o.v.replace(/\n$/, '')));
		else if (o.t === 'aviso') caja.append(el('pre', 'o-aviso', o.v.replace(/\n$/, '')));
		else if (o.t === 'error') caja.append(el('pre', 'o-error', o.v));
		else if (o.t === 'latex') {
			const d = el('div', 'o-latex');
			try {
				window.katex.render(o.v, d, { displayMode: true, throwOnError: false, maxSize: 30, maxExpand: 2000 });
			} catch {
				d.textContent = o.v;
			}
			caja.append(d);
		} else if (o.t === 'png') {
			const i = el('img', 'o-img');
			i.src = 'data:image/png;base64,' + o.v;
			i.alt = 'Gráfico generado por la celda';
			caja.append(i);
		} else if (o.t === 'pie') caja.append(el('div', 'o-pie', o.v));
	}
}

function montarCelda(c) {
	const raiz = el('div', `celda celda--${c.tipo}`);
	raiz.dataset.id = c.id;
	const n = el('div', 'celda__n', c.tipo === 'codigo' ? `[${c.n ?? ' '}]` : '');
	const caja = el('div', 'celda__caja');
	const barra = el('div', 'celda__barra');
	if (c.tipo === 'codigo') {
		const correr = icono('correr', 'Ejecutar (Shift+Enter)', 'ic--correr');
		correr.onclick = () => ejecutarCelda(c);
		barra.append(correr);
	}
	const cambiar = icono('tipo', c.tipo === 'codigo' ? 'Pasar a texto' : 'Pasar a código');
	cambiar.onclick = () => {
		c.tipo = c.tipo === 'codigo' ? 'texto' : 'codigo';
		c.salidas = [];
		c.n = null;
		remontar(c);
		guardarBorrador();
	};
	const arr = icono('arriba', 'Subir celda');
	arr.onclick = () => mover(c, -1);
	const aba = icono('abajo', 'Bajar celda');
	aba.onclick = () => mover(c, 1);
	const dup = icono('copiar', 'Duplicar celda');
	dup.onclick = () => insertar(crearCelda(c.tipo, textoDe(c)), c, false);
	const bor = icono('borrar', 'Borrar celda');
	bor.onclick = () => borrar(c);
	barra.append(cambiar, arr, aba, dup, bor);
	caja.append(barra);

	if (c.tipo === 'codigo') {
		const ed = el('div', 'celda__editor');
		caja.append(ed, el('div', 'salidas'));
		c.editor = crearEditor(ed, {
			texto: c.texto,
			vacio: 'Escribí código de Python, o sumá un snippet →',
			alCambiar: (t) => {
				c.texto = t;
				guardarBorrador();
			},
			alEjecutar: () => ejecutarYSeguir(c),
			alEjecutarYSeguir: () => ejecutarCelda(c),
		});
		ed.addEventListener('focusin', () => marcarActiva(c));
	} else {
		const vista = el('div', 'texto__vista');
		vista.innerHTML = mdSimple(c.texto) || '<p style="color:var(--fg-d)">Tocá para escribir una nota (admite # títulos, **negrita**, `código` y listas con -)</p>';
		const area = el('textarea', 'texto__area');
		area.hidden = true;
		area.spellcheck = true;
		const abrir = () => {
			vista.hidden = true;
			area.hidden = false;
			area.value = c.texto;
			area.style.height = 'auto';
			area.style.height = Math.max(70, area.scrollHeight) + 'px';
			area.focus();
		};
		const cerrar = () => {
			c.texto = area.value;
			vista.innerHTML = mdSimple(c.texto) || '<p style="color:var(--fg-d)">Nota vacía</p>';
			area.hidden = true;
			vista.hidden = false;
			guardarBorrador();
		};
		vista.onclick = abrir;
		area.oninput = () => {
			area.style.height = 'auto';
			area.style.height = Math.max(70, area.scrollHeight) + 'px';
		};
		area.onblur = cerrar;
		area.onkeydown = (e) => {
			if (e.key === 'Escape' || (e.key === 'Enter' && (e.shiftKey || e.ctrlKey))) {
				e.preventDefault();
				area.blur();
			}
		};
		caja.append(vista, area);
		c.abrirTexto = abrir;
		area.addEventListener('focusin', () => marcarActiva(c));
	}
	raiz.append(n, caja);
	c.el = raiz;
	if (c.tipo === 'codigo') pintarSalidas(c);
	return raiz;
}

const textoDe = (c) => (c.editor ? c.editor.texto() : c.texto);

function marcarActiva(c) {
	activa = c;
	for (const x of celdas) x.el?.toggleAttribute('data-activa', x === c);
}

function remontar(c) {
	const viejo = c.el;
	c.editor?.destruir();
	c.editor = null;
	const nuevo = montarCelda(c);
	viejo.replaceWith(nuevo);
}

function dibujarTodo() {
	for (const c of celdas) c.editor?.destruir();
	lista.replaceChildren();
	for (const c of celdas) lista.append(montarCelda(c));
	lista.append(botonesAgregar());
}

function botonesAgregar() {
	const d = el('div', 'agregar');
	d.id = 'agregar';
	const a = el('button', 'btn btn--chico', '+ Código');
	a.type = 'button';
	a.onclick = () => {
		const c = crearCelda('codigo');
		insertar(c, celdas[celdas.length - 1] ?? null, true);
		c.editor?.enfocar();
	};
	const b = el('button', 'btn btn--chico', '+ Texto');
	b.type = 'button';
	b.onclick = () => {
		const c = crearCelda('texto');
		insertar(c, celdas[celdas.length - 1] ?? null, true);
		c.abrirTexto?.();
	};
	d.append(a, b);
	return d;
}

/** Inserta después de `ref` (o al final si no hay). */
function insertar(c, ref, enfocar) {
	const i = ref ? celdas.indexOf(ref) + 1 : celdas.length;
	celdas.splice(i, 0, c);
	const nodo = montarCelda(c);
	const siguiente = celdas[i + 1];
	lista.insertBefore(nodo, siguiente ? siguiente.el : $('agregar'));
	marcarActiva(c);
	if (enfocar) nodo.scrollIntoView({ block: 'nearest' });
	guardarBorrador();
	return c;
}

function mover(c, d) {
	const i = celdas.indexOf(c);
	const j = i + d;
	if (j < 0 || j >= celdas.length) return;
	[celdas[i], celdas[j]] = [celdas[j], celdas[i]];
	for (const x of celdas) lista.insertBefore(x.el, $('agregar')); // se reordena el DOM según el arreglo
	c.el.scrollIntoView({ block: 'nearest' });
	guardarBorrador();
}

function borrar(c) {
	const i = celdas.indexOf(c);
	c.editor?.destruir();
	c.el.remove();
	celdas.splice(i, 1);
	if (!celdas.length) insertar(crearCelda('codigo'), null, true);
	guardarBorrador();
}

// ------------------------------------------------------------------------------------------------ ejecución
function ejecutarCelda(c) {
	if (c.tipo !== 'codigo') return Promise.resolve();
	const codigo = textoDe(c);
	c.el.dataset.corriendo = '1';
	c.el.querySelector('.celda__n').textContent = '[*]';
	cadena = cadena.then(async () => {
		try {
			await py.listo$;
			estado('calculando', 'Calculando…');
			$('b-detener').hidden = false;
			await sincronizarArchivos(codigo);
			const r = await llamar({ t: 'ejecutar', codigo });
			c.n = ++contador;
			c.salidas = r.salidas;
			if (r.ms > 1500) c.salidas = [...r.salidas, { t: 'pie', v: `${(r.ms / 1000).toFixed(1)} s` }];
		} catch (e) {
			c.salidas = [{ t: 'error', v: 'No se pudo ejecutar: ' + e.message }];
			if (!py.worker) c.salidas = [{ t: 'error', v: 'Se detuvo el cálculo.' }];
		}
		delete c.el.dataset.corriendo;
		c.el.querySelector('.celda__n').textContent = c.n != null ? `[${c.n}]` : '[ ]';
		pintarSalidas(c);
		if (!py.pend.size) {
			$('b-detener').hidden = true;
			if (py.listo) estado('listo', py.lcapy ? 'Python y Lcapy listos' : 'Python listo · cargando Lcapy…');
		}
		guardarBorrador();
	});
	return cadena;
}

async function ejecutarYSeguir(c) {
	const i = celdas.indexOf(c);
	let sig = celdas.slice(i + 1).find((x) => x.tipo === 'codigo');
	if (!sig) sig = insertar(crearCelda('codigo'), celdas[celdas.length - 1], false);
	sig.editor?.enfocar();
	await ejecutarCelda(c);
}

$('b-todo').onclick = async () => {
	for (const c of [...celdas]) if (c.tipo === 'codigo') await ejecutarCelda(c);
};
$('b-reiniciar').onclick = async () => {
	await py.listo$;
	await llamar({ t: 'reiniciar' });
	contador = 0;
	for (const c of celdas) {
		c.n = null;
		c.salidas = [];
		if (c.el && c.tipo === 'codigo') {
			c.el.querySelector('.celda__n').textContent = '[ ]';
			pintarSalidas(c);
		}
	}
	aviso('Python reiniciado: las variables se borraron.');
};
$('b-detener').onclick = () => {
	py.worker.terminate();
	for (const p of py.pend.values()) p.mal(new Error('detenido'));
	py.pend.clear();
	py.worker = null;
	$('b-detener').hidden = true;
	estado('carga', 'Reiniciando Python…');
	aviso('Cálculo detenido. Se pierden las variables: volvé a ejecutar las celdas.');
	arrancarPython();
	cadena = Promise.resolve();
};

// ------------------------------------------------------------------------------------------------ borrador, guardado y .ipynb
const CLAVE = 'kumos:pysnippets:borrador';
let temporizador = 0;
function guardarBorrador() {
	clearTimeout(temporizador);
	temporizador = setTimeout(() => {
		try {
			localStorage.setItem(CLAVE, JSON.stringify({ titulo: $('titulo').value, celdas: celdas.map((c) => ({ tipo: c.tipo, texto: textoDe(c) })) }));
		} catch {
			/* sin almacenamiento */
		}
	}, 500);
}
function leerBorrador() {
	try {
		const d = JSON.parse(localStorage.getItem(CLAVE) ?? 'null');
		if (d?.celdas?.length) return d;
	} catch {
		/* nada */
	}
	return null;
}
$('titulo').addEventListener('input', guardarBorrador);

const fuente = (t) => {
	const l = t.split('\n');
	return l.map((x, i) => (i < l.length - 1 ? x + '\n' : x));
};
function aIpynb() {
	let n = 0;
	const cells = celdas.map((c) => {
		const texto = textoDe(c);
		if (c.tipo === 'texto') return { cell_type: 'markdown', metadata: {}, source: fuente(texto) };
		const outputs = [];
		for (const o of c.salidas) {
			if (o.t === 'texto' || o.t === 'aviso') outputs.push({ output_type: 'stream', name: o.t === 'texto' ? 'stdout' : 'stderr', text: fuente(o.v) });
			else if (o.t === 'error') outputs.push({ output_type: 'error', ename: 'Error', evalue: o.v, traceback: [o.v] });
			else if (o.t === 'latex') outputs.push({ output_type: 'display_data', metadata: {}, data: { 'text/latex': fuente(`$$${o.v}$$`), 'text/plain': [o.v] } });
			else if (o.t === 'png') outputs.push({ output_type: 'display_data', metadata: {}, data: { 'image/png': o.v, 'text/plain': ['<imagen>'] } });
		}
		return { cell_type: 'code', metadata: {}, source: fuente(texto), outputs, execution_count: c.n ?? (c.salidas.length ? ++n : null) };
	});
	return JSON.stringify(
		{
			nbformat: 4,
			nbformat_minor: 4,
			metadata: {
				kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
				language_info: { name: 'python' },
				kumos: { herramienta: 'py snippets', requiere: 'kumolib.py (junto al cuaderno) y pip install lcapy' },
			},
			cells,
		},
		null,
		1,
	);
}
function deIpynb(texto) {
	const nb = JSON.parse(texto);
	if (!Array.isArray(nb.cells)) throw new Error('no es un cuaderno de Jupyter');
	const join = (s) => (Array.isArray(s) ? s.join('') : String(s ?? ''));
	return nb.cells
		.filter((c) => c.cell_type === 'code' || c.cell_type === 'markdown' || c.cell_type === 'raw')
		.map((c) => {
			if (c.cell_type !== 'code') return crearCelda('texto', join(c.source));
			const salidas = [];
			for (const o of c.outputs ?? []) {
				if (o.output_type === 'stream') salidas.push({ t: o.name === 'stderr' ? 'aviso' : 'texto', v: join(o.text) });
				else if (o.output_type === 'error') salidas.push({ t: 'error', v: join(o.evalue) });
				else if (o.data) {
					if (o.data['image/png']) salidas.push({ t: 'png', v: join(o.data['image/png']).replace(/\s/g, '') });
					else if (o.data['text/latex']) salidas.push({ t: 'latex', v: join(o.data['text/latex']).replace(/^\s*\$\$|\$\$\s*$/g, '').replace(/^\$|\$$/g, '') });
					else if (o.data['text/plain']) salidas.push({ t: 'texto', v: join(o.data['text/plain']) + '\n' });
				}
			}
			return crearCelda('codigo', join(c.source), salidas, null);
		});
}
function cargarCeldas(lista_, titulo) {
	celdas = lista_.length ? lista_ : [crearCelda('codigo')];
	if (titulo) $('titulo').value = titulo;
	contador = 0;
	dibujarTodo();
	guardarBorrador();
}
const nombreArchivo = () => (($('titulo').value || 'Cuaderno').trim() || 'Cuaderno').replace(/[\\/:*?"<>|]/g, '-') + '.ipynb';

$('b-exportar').onclick = () => {
	const url = URL.createObjectURL(new Blob([aIpynb()], { type: 'application/json' }));
	const a = el('a');
	a.href = url;
	a.download = nombreArchivo();
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 2000);
};
$('b-guardar').onclick = async () => {
	try {
		await Archivo.guardar(Archivo.CARPETA, nombreArchivo(), aIpynb());
		aviso(`Guardado en Archivo → ${Archivo.CARPETA} → ${nombreArchivo()}`);
	} catch (e) {
		aviso('No pude guardar: ' + e.message);
	}
};
$('b-abrir').onclick = async () => {
	const caja = $('abrir-lista');
	caja.replaceChildren();
	let lista_ = [];
	try {
		lista_ = await Archivo.listar('.ipynb');
	} catch {
		/* sin Archivo */
	}
	if (!lista_.length) caja.append(el('p', 'vacio-g', 'Todavía no guardaste cuadernos en Archivo.'));
	for (const f of lista_) {
		const b = el('button', 'fila');
		b.type = 'button';
		b.append(el('span', '', f.nombre.replace(/\.ipynb$/i, '')), el('small', '', `${f.carpeta} · ${new Date(f.mod).toLocaleDateString('es-AR')}`));
		b.onclick = async () => {
			try {
				const r = await Archivo.leerBytes(f.id);
				cargarCeldas(deIpynb(Archivo.decodificar(r.bytes)), f.nombre.replace(/\.ipynb$/i, ''));
				$('dlg-abrir').close();
			} catch (e) {
				aviso('No pude abrirlo: ' + e.message);
			}
		};
		caja.append(b);
	}
	$('dlg-abrir').showModal();
};
$('abrir-archivo').onclick = () => $('f-nb').click();
$('f-nb').onchange = async (e) => {
	const f = e.target.files[0];
	e.target.value = '';
	if (!f) return;
	try {
		cargarCeldas(deIpynb(await f.text()), f.name.replace(/\.ipynb$/i, ''));
		$('dlg-abrir').close();
	} catch (err) {
		aviso('No pude abrirlo: ' + err.message);
	}
};
$('b-asc').onclick = () => $('f-asc').click();
$('f-asc').onchange = async (e) => {
	const f = e.target.files[0];
	e.target.value = '';
	if (!f) return;
	const nombre = f.name.endsWith('.asc') ? f.name : f.name + '.asc';
	subidos.set(nombre.toLowerCase(), Archivo.decodificar(new Uint8Array(await f.arrayBuffer())));
	synced.delete(nombre.toLowerCase());
	aviso(`Subido: ${nombre}. Usalo con cargar_asc("${nombre}")`, 4000);
};
$('b-info').onclick = () => $('dlg-info').showModal();

// ------------------------------------------------------------------------------------------------ galería
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function dibujarGaleria(filtro = '') {
	const caja = $('g-lista');
	caja.replaceChildren();
	const q = norm(filtro.trim());
	let total = 0;
	for (const g of GRUPOS) {
		const items = SNIPPETS.filter((s) => s.g === g.id && (!q || norm(`${s.titulo} ${s.desc} ${s.claves} ${s.codigo}`).includes(q)));
		if (!items.length) continue;
		total += items.length;
		const d = el('details', 'grupo');
		d.open = true;
		d.append(el('summary', '', g.titulo));
		if (!q) d.append(el('p', 'grupo__nota', g.nota));
		for (const s of items) {
			const b = el('button', 'snip');
			b.type = 'button';
			b.append(el('b', '', s.titulo), el('span', '', s.desc), el('pre', '', s.codigo));
			b.onclick = () => {
				const c = insertar(crearCelda('codigo', s.codigo), activa ?? celdas[celdas.length - 1] ?? null, true);
				$('galeria').removeAttribute('data-abierta');
				$('b-snip').setAttribute('aria-expanded', 'false');
				setTimeout(() => c.editor?.primerHueco(), 60);
			};
			d.append(b);
		}
		caja.append(d);
	}
	if (!total) caja.append(el('p', 'vacio-g', 'No hay snippets con esa búsqueda.'));
}
$('buscar').oninput = (e) => dibujarGaleria(e.target.value);
const alternarGaleria = (abrir) => {
	const g = $('galeria');
	const v = abrir ?? !g.hasAttribute('data-abierta');
	g.toggleAttribute('data-abierta', v);
	$('b-snip').setAttribute('aria-expanded', String(v));
};
$('b-snip').onclick = () => alternarGaleria();
$('g-cerrar').onclick = () => alternarGaleria(false);

// ------------------------------------------------------------------------------------------------ arranque
const borrador = leerBorrador();
$('titulo').value = borrador?.titulo || 'Cuaderno';
celdas = (borrador?.celdas ?? CUADERNO_INICIAL).map((c) => crearCelda(c.tipo, c.texto));
dibujarTodo();
dibujarGaleria();
arrancarPython();
window.pysnippets = { celdas: () => celdas, ejecutarCelda, aIpynb, deIpynb, py }; // para las pruebas
