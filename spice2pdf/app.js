// Spice2PDF para kumOS: interfaz, vista previa y exportación.
// El dibujo lo arma el Python original del programa (carpeta python/) corriendo en el navegador con Pyodide;
// acá se lo recorta, se aplican las opciones y se exporta a PDF (jsPDF + svg2pdf.js), SVG o PNG.
(() => {
	'use strict';
	const NS = 'http://www.w3.org/2000/svg';
	const $ = (s, r = document) => r.querySelector(s);
	const $$ = (s, r = document) => [...r.querySelectorAll(s)];

	// ---------------------------------------------------------------- opciones
	const POR_DEFECTO = { encuadre: 'auto', margen: 24, escala: 75, letra: 100, grosor: 100, nombres: true, valores: true, etiquetas: true, comentarios: true, nodos: true, faltantes: true, fondo: false, dpi: 300 };
	const CLAVE = 'kumos.spice2pdf.opciones';
	const cargarOpciones = () => {
		try {
			return { ...POR_DEFECTO, ...JSON.parse(localStorage.getItem(CLAVE) || '{}') };
		} catch {
			return { ...POR_DEFECTO };
		}
	};
	const guardarOpciones = () => {
		try {
			localStorage.setItem(CLAVE, JSON.stringify(opts));
		} catch {
			/* sin almacenamiento: no pasa nada */
		}
	};
	let opts = cargarOpciones();

	// ---------------------------------------------------------------- posiciones de los textos (se recuerdan por archivo)
	const CLAVE_POS = 'kumos.spice2pdf.posiciones';
	const hashDe = (s) => {
		let h = 5381;
		for (let k = 0; k < s.length; k++) h = ((h << 5) + h + s.charCodeAt(k)) | 0;
		return `${(h >>> 0).toString(36)}-${s.length}`;
	};
	const leerPosiciones = () => {
		try {
			return JSON.parse(localStorage.getItem(CLAVE_POS) || '{}');
		} catch {
			return {};
		}
	};
	function guardarPosiciones(f) {
		try {
			const todo = leerPosiciones();
			if (Object.keys(f.movidos).length) todo[f.hash] = { t: Date.now(), m: f.movidos };
			else delete todo[f.hash];
			const salida = {};
			Object.keys(todo)
				.sort((a, b) => todo[b].t - todo[a].t)
				.slice(0, 40)
				.forEach((k) => (salida[k] = todo[k]));
			localStorage.setItem(CLAVE_POS, JSON.stringify(salida));
		} catch {
			/* sin almacenamiento: las posiciones valen solo mientras la página está abierta */
		}
	}

	// ---------------------------------------------------------------- estado
	const archivos = [];
	let actual = -1;
	let zoom = 'fit'; // 'fit' o un número (píxeles de pantalla por unidad del dibujo)
	let vistaVB = null; // viewBox de lo que se está mostrando
	let ficha = 0; // para descartar renders viejos
	let uid = 0;
	let modulo = null;

	const lienzo = $('#lienzo');
	const paper = $('#paper');
	const host = $('#host');

	// ---------------------------------------------------------------- Python
	const decir = (t, p) => {
		$('#msg').textContent = t;
		if (p != null) $('#prog').style.width = `${p}%`;
	};

	async function iniciarPython() {
		decir('Iniciando Python…', 8);
		const py = await loadPyodide({ indexURL: new URL('../qtweb/pyodide/', location.href).href });
		window.__py = py; // para depurar desde la consola
		decir('Copiando Spice-a-PDF…', 55);
		const lista = await (await fetch('python/manifest.json', { cache: 'no-cache' })).json();
		const bufs = await Promise.all(lista.map(async (r) => new Uint8Array(await (await fetch(`python/${r}`, { cache: 'no-cache' })).arrayBuffer())));
		lista.forEach((r, i) => {
			const dir = `/app/${r}`.split('/').slice(0, -1).join('/');
			py.FS.mkdirTree(dir);
			py.FS.writeFile(`/app/${r}`, bufs[i]);
		});
		decir('Preparando…', 85);
		py.runPython("import sys; sys.path.insert(0, '/app'); import spice2pdf");
		modulo = py.pyimport('spice2pdf');
	}

	const mensajeError = (e) => {
		const lineas = String((e && e.message) || e).split('\n').map((s) => s.trim()).filter(Boolean);
		return lineas[lineas.length - 1] || 'Error desconocido';
	};

	function decodificar(buf) {
		const u = new Uint8Array(buf);
		if (u[0] === 0xff && u[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
		try {
			return new TextDecoder('utf-8', { fatal: true }).decode(buf);
		} catch {
			return new TextDecoder('windows-1252').decode(buf); // LTspice guarda en ANSI
		}
	}

	function procesar(nombre, texto) {
		const f = { id: ++uid, nombre, base: nombre.replace(/\.[^.]+$/, '') || 'esquematico', texto, r: null, error: null, hash: hashDe(texto), pila: [] };
		f.movidos = leerPosiciones()[f.hash]?.m || {}; // { índice del texto: {x, y} }: desplazamientos en unidades del dibujo
		if (/^\s*SymbolType\b/m.test(texto)) f.error = 'Este archivo es un símbolo (.asy), no un esquemático (.asc).';
		else if (!/^\s*(WIRE|SYMBOL|FLAG|SHEET|Version)\b/m.test(texto)) f.error = 'No parece un esquemático de LTspice (.asc).';
		else {
			try {
				const p = modulo.convertir(texto);
				f.r = p.toJs({ dict_converter: Object.fromEntries });
				p.destroy();
			} catch (e) {
				f.error = `No se pudo leer: ${mensajeError(e)}`;
			}
		}
		return f;
	}

	// ---------------------------------------------------------------- armar el dibujo con las opciones
	/** Devuelve { svg, vb, modo, nota }: el SVG final (suelto, sin colgar del documento) con recorte y opciones aplicados. */
	function armar(f, o) {
		const doc = new DOMParser().parseFromString(f.r.svg, 'image/svg+xml');
		if (doc.querySelector('parsererror')) throw new Error('El dibujo generado no es válido');
		const raiz = doc.documentElement;
		raiz.querySelectorAll('text').forEach((t, i) => t.setAttribute('data-i', String(i))); // identifica cada texto (para moverlo)
		const quitar = (sel) => raiz.querySelectorAll(sel).forEach((n) => n.remove());
		if (!o.nombres) quitar('text.nombre');
		if (!o.valores) quitar('text.valor');
		if (!o.etiquetas) quitar('text.flag');
		if (!o.comentarios) quitar('text.comentario');
		if (!o.nodos) quitar('circle.nodo');
		if (!o.faltantes) quitar('.faltante');

		const kl = o.letra / 100;
		const kg = o.grosor / 100;
		if (kl !== 1) {
			raiz.querySelectorAll('text').forEach((t) => {
				if (t.closest('.simbolo')) return; // los textos que son parte del dibujo de un símbolo (A₀·ε, rᵢ…) no se tocan
				const s = parseFloat(t.getAttribute('font-size'));
				if (s) t.setAttribute('font-size', String(+(s * kl).toFixed(3)));
			});
		}
		if (kg !== 1) {
			raiz.querySelectorAll('[stroke-width]').forEach((e) => e.setAttribute('stroke-width', String(+(parseFloat(e.getAttribute('stroke-width')) * kg).toFixed(3))));
			raiz.querySelectorAll('circle.nodo').forEach((c) => c.setAttribute('r', String(+(parseFloat(c.getAttribute('r')) * kg).toFixed(3))));
		}

		// textos movidos por el usuario: un desplazamiento antes de su giro propio
		raiz.querySelectorAll('text[data-i]').forEach((t) => {
			const base = t.getAttribute('transform') || '';
			t.setAttribute('data-base', base);
			const m = f.movidos[t.getAttribute('data-i')];
			if (m) t.setAttribute('transform', `translate(${m.x} ${m.y})${base ? ' ' + base : ''}`);
		});
		const g = document.createElementNS(NS, 'g');
		g.setAttribute('id', 'contenido');
		while (raiz.firstChild) g.appendChild(raiz.firstChild);
		raiz.appendChild(g);
		raiz.removeAttribute('viewBox');
		raiz.setAttribute('width', '100');
		raiz.setAttribute('height', '100');
		const svg = document.importNode(raiz, true);
		host.appendChild(svg);
		let bb;
		try {
			bb = svg.querySelector('#contenido').getBBox();
		} finally {
			svg.remove();
		}

		let modo = o.encuadre;
		let nota = '';
		if (modo === 'auto') modo = f.r.rectangulo ? 'rect' : 'contenido';
		if (modo === 'rect' && !f.r.rectangulo) {
			modo = 'contenido';
			nota = 'Este archivo no tiene rectángulo: se ajustó al dibujo.';
		}
		let vb;
		if (modo === 'rect') {
			vb = [f.r.x, f.r.y, f.r.ancho, f.r.alto];
		} else if (bb.width > 0 && bb.height > 0) {
			const pad = o.margen + 1.2 * kg;
			vb = [bb.x - pad, bb.y - pad, bb.width + 2 * pad, bb.height + 2 * pad].map((v) => +v.toFixed(2));
		} else {
			vb = [0, 0, 240, 120];
			nota = 'El esquemático no tiene nada para dibujar.';
		}
		svg.setAttribute('viewBox', vb.join(' '));
		svg.setAttribute('width', String(vb[2]));
		svg.setAttribute('height', String(vb[3]));
		return { svg, vb, modo, nota };
	}

	function conFondo(svg, vb) {
		const r = document.createElementNS(NS, 'rect');
		['x', 'y', 'width', 'height'].forEach((k, i) => r.setAttribute(k, String(vb[i])));
		r.setAttribute('fill', '#ffffff');
		svg.insertBefore(r, svg.firstChild);
	}

	// ---------------------------------------------------------------- vista previa
	function aplicarZoom() {
		const svg = paper.firstElementChild;
		if (!svg || !vistaVB) return;
		const [, , w, h] = vistaVB;
		let z = zoom;
		if (zoom === 'fit') {
			const aw = Math.max(40, lienzo.clientWidth - 48);
			const ah = Math.max(40, lienzo.clientHeight - 48);
			z = Math.min(aw / w, ah / h, 4);
		}
		svg.style.width = `${w * z}px`;
		svg.style.height = `${h * z}px`;
		$('#z-valor').textContent = zoom === 'fit' ? `Ajustar` : `${Math.round(z * 100)} %`;
		$('#z-valor').title = zoom === 'fit' ? `Ajustado a la ventana (${Math.round(z * 100)} %)` : 'Ajustar a la ventana';
		paper.dataset.z = String(z);
	}
	const zoomActual = () => parseFloat(paper.dataset.z || '1') || 1;
	function cambiarZoom(factor) {
		const z = Math.min(8, Math.max(0.03, zoomActual() * factor));
		const cx = (lienzo.scrollLeft + lienzo.clientWidth / 2) / (paper.scrollWidth || 1);
		const cy = (lienzo.scrollTop + lienzo.clientHeight / 2) / (paper.scrollHeight || 1);
		zoom = z;
		aplicarZoom();
		lienzo.scrollLeft = cx * paper.scrollWidth - lienzo.clientWidth / 2;
		lienzo.scrollTop = cy * paper.scrollHeight - lienzo.clientHeight / 2;
	}

	async function render() {
		const mia = ++ficha;
		pintarLista();
		const f = archivos[actual];
		$('#vacio').hidden = !!(f && !f.error);
		const hay = !!(f && !f.error);
		['#d-pdf', '#d-svg', '#d-png', '#d-copiar'].forEach((s) => ($(s).disabled = !hay));
		$('#d-todos').hidden = archivos.filter((a) => !a.error).length < 2;
		pintarMovidos(f && !f.error ? f : null);
		if (!f) {
			paper.hidden = true;
			paper.replaceChildren();
			vistaVB = null;
			$('#dim').textContent = '';
			$('#resumen').innerHTML = '&nbsp;';
			pintarAvisos(null);
			pintarVacio(null);
			return;
		}
		pintarAvisos(f);
		if (f.error) {
			paper.hidden = true;
			paper.replaceChildren();
			vistaVB = null;
			$('#dim').textContent = '';
			$('#resumen').textContent = f.nombre;
			pintarVacio(f);
			return;
		}
		pintarVacio(null);
		let v;
		try {
			v = armar(f, opts);
		} catch (e) {
			f.error = `No se pudo dibujar: ${mensajeError(e)}`;
			return render();
		}
		if (mia !== ficha) return;
		paper.replaceChildren(v.svg);
		paper.hidden = false;
		vistaVB = v.vb;
		aplicarZoom();
		ponerAgarres(v.svg, f);
		pintarMovidos(f);
		const s = opts.escala / 100;
		const wpt = v.vb[2] * s;
		const hpt = v.vb[3] * s;
		$('#dim').textContent = `PDF ${Math.round(wpt)} × ${Math.round(hpt)} pt · ${Math.round((wpt * 25.4) / 72)} × ${Math.round((hpt * 25.4) / 72)} mm`;
		$('#resumen').textContent = `${f.nombre} · ${f.r.componentes} componentes · ${f.r.cables} cables${v.nota ? ' · ' + v.nota : ''}`;
		$('#nota-encuadre').textContent = v.nota || (opts.encuadre === 'auto' ? (v.modo === 'rect' ? 'Usando el rectángulo del .asc.' : 'Sin rectángulo en el .asc: se ajustó al dibujo.') : '');
	}

	// ---------------------------------------------------------------- mover textos
	/** Áreas invisibles sobre cada texto (solo en la vista previa, no se exportan) para poder agarrarlos. */
	function ponerAgarres(svg, f) {
		const g = document.createElementNS(NS, 'g');
		g.setAttribute('class', 'agarres');
		svg.querySelectorAll('text[data-i]').forEach((t) => {
			if (t.closest('.simbolo')) return; // los textos que forman parte del dibujo de un símbolo no se mueven
			let bb;
			try {
				bb = t.getBBox();
			} catch {
				return;
			}
			if (!bb.width || !bb.height) return;
			const r = document.createElementNS(NS, 'rect');
			const p = 4;
			r.setAttribute('x', String(bb.x - p));
			r.setAttribute('y', String(bb.y - p));
			r.setAttribute('width', String(bb.width + 2 * p));
			r.setAttribute('height', String(bb.height + 2 * p));
			r.setAttribute('class', 'agarre' + (f.movidos[t.getAttribute('data-i')] ? ' movido' : ''));
			r.setAttribute('data-i', t.getAttribute('data-i'));
			const tr = t.getAttribute('transform');
			if (tr) r.setAttribute('transform', tr);
			g.appendChild(r);
		});
		svg.appendChild(g);
	}

	function pintarMovidos(f) {
		const n = f ? Object.keys(f.movidos).length : 0;
		$('#t-n').textContent = n ? `(${n})` : '';
		$('#t-restaurar').disabled = !n;
		$('#t-deshacer').disabled = !f || !f.pila.length;
	}

	function recordar(f) {
		f.pila.push(JSON.stringify(f.movidos));
		if (f.pila.length > 100) f.pila.shift();
	}
	function deshacerMovimiento() {
		const f = archivos[actual];
		if (!f || f.error || !f.pila.length) return;
		f.movidos = JSON.parse(f.pila.pop());
		guardarPosiciones(f);
		render();
	}
	function devolverTextos(indice) {
		const f = archivos[actual];
		if (!f || f.error) return;
		if (indice != null) {
			if (!f.movidos[indice]) return;
			recordar(f);
			delete f.movidos[indice];
		} else {
			if (!Object.keys(f.movidos).length) return;
			recordar(f);
			f.movidos = {};
		}
		guardarPosiciones(f);
		render();
	}

	function enlazarTextos() {
		let d = null;
		const aUsuario = (svg, e) => {
			const pt = svg.createSVGPoint();
			pt.x = e.clientX;
			pt.y = e.clientY;
			return pt.matrixTransform(svg.getScreenCTM().inverse());
		};
		lienzo.addEventListener('pointerdown', (e) => {
			const r = e.target.closest?.('.agarre');
			if (!r || e.button !== 0) return;
			const f = archivos[actual];
			const svg = paper.firstElementChild;
			if (!f || !svg) return;
			const i = r.getAttribute('data-i');
			const t = svg.querySelector(`text[data-i="${i}"]`);
			if (!t) return;
			e.preventDefault();
			d = { f, svg, i, t, r, base: t.getAttribute('data-base') || '', m0: f.movidos[i] || { x: 0, y: 0 }, p0: aUsuario(svg, e), moved: false, nx: 0, ny: 0 };
			d.nx = d.m0.x;
			d.ny = d.m0.y;
			lienzo.setPointerCapture(e.pointerId);
			r.classList.add('moviendo');
			lienzo.classList.add('moviendo-texto');
		});
		lienzo.addEventListener('pointermove', (e) => {
			if (!d) return;
			const p = aUsuario(d.svg, e);
			let dx = p.x - d.p0.x;
			let dy = p.y - d.p0.y;
			if (e.shiftKey) {
				if (Math.abs(dx) > Math.abs(dy)) dy = 0;
				else dx = 0;
			}
			d.nx = +(d.m0.x + dx).toFixed(2);
			d.ny = +(d.m0.y + dy).toFixed(2);
			d.moved = d.moved || Math.abs(dx) + Math.abs(dy) > 0.5;
			const tr = `translate(${d.nx} ${d.ny})${d.base ? ' ' + d.base : ''}`;
			d.t.setAttribute('transform', tr);
			d.r.setAttribute('transform', tr);
		});
		const fin = () => {
			if (!d) return;
			const { f, i, moved, nx, ny, m0 } = d;
			d = null;
			lienzo.classList.remove('moviendo-texto');
			if (moved && (nx !== m0.x || ny !== m0.y)) {
				recordar(f);
				if (Math.abs(nx) < 0.01 && Math.abs(ny) < 0.01) delete f.movidos[i];
				else f.movidos[i] = { x: nx, y: ny };
				guardarPosiciones(f);
			}
			render(); // (también quita la marca de "moviendo" y recalcula el recorte)
		};
		lienzo.addEventListener('pointerup', fin);
		lienzo.addEventListener('pointercancel', fin);
		lienzo.addEventListener('dblclick', (e) => {
			const r = e.target.closest?.('.agarre');
			if (r) devolverTextos(r.getAttribute('data-i'));
		});
		$('#t-deshacer').addEventListener('click', deshacerMovimiento);
		$('#t-restaurar').addEventListener('click', () => devolverTextos(null));
		addEventListener('keydown', (e) => {
			if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') || e.shiftKey) return;
			if (e.target.closest?.('input, textarea, select, dialog')) return;
			e.preventDefault();
			deshacerMovimiento();
		});
	}

	function pintarVacio(f) {
		const v = $('#vacio');
		if (!f) {
			v.innerHTML = `<svg viewBox="0 0 48 48" width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h22l10 10v26H8z"/><path d="M30 6v10h10"/><path d="M14 30h5l2-6 4 10 3-8 2 4h4"/></svg>
				<h3>Soltá un archivo .asc de LTspice</h3>
				<p>o tocá <b>Abrir .asc</b>. Podés cargar varios a la vez. Los archivos se procesan en tu navegador: no se suben a ningún lado.</p>
				<button class="btn" id="abrir2" type="button">Elegir archivos…</button>`;
			$('#abrir2').addEventListener('click', () => $('#archivo').click());
			return;
		}
		if (f.error) {
			v.hidden = false;
			v.innerHTML = '';
			const h = document.createElement('h3');
			h.textContent = f.nombre;
			const p = document.createElement('p');
			p.textContent = f.error;
			v.append(h, p);
		}
	}

	function pintarLista() {
		const ul = $('#lista');
		ul.replaceChildren();
		archivos.forEach((f, i) => {
			const li = document.createElement('li');
			if (i === actual) li.setAttribute('aria-current', 'true');
			if (f.error) li.dataset.error = '1';
			const n = document.createElement('span');
			n.className = 'nombre';
			n.textContent = f.nombre;
			n.title = f.nombre;
			const meta = document.createElement('span');
			meta.className = 'meta' + (f.error ? ' mal' : '');
			meta.textContent = f.error ? f.error : `${f.r.componentes} componentes${f.r.desconocidos.length ? ` · ${f.r.desconocidos.length} sin dibujo` : ''}`;
			const x = document.createElement('button');
			x.type = 'button';
			x.className = 'quitar';
			x.title = 'Quitar de la lista';
			x.textContent = '×';
			x.addEventListener('click', (e) => {
				e.stopPropagation();
				quitar(i);
			});
			li.append(n, meta, x);
			li.addEventListener('click', () => {
				if (actual !== i) {
					actual = i;
					render();
				}
			});
			ul.append(li);
		});
		$('#lista-vacia').hidden = archivos.length > 0;
	}

	function pintarAvisos(f) {
		const s = $('#avisos');
		const items = [];
		if (f && f.r) {
			if (f.r.desconocidos.length) items.push(`Símbolos sin dibujo (se muestran como recuadro rojo): ${f.r.desconocidos.map((t) => `<code>${esc(t)}</code>`).join(' ')}. No están en la librería de Spice-a-PDF (TCLib).`);
			if (f.r.skins_faltantes.length) items.push(`Falta el dibujo de: ${f.r.skins_faltantes.map((t) => `<code>${esc(t)}</code>`).join(' ')}.`);
		}
		s.hidden = !items.length;
		s.innerHTML = items.length ? `<h2>Avisos</h2><ul>${items.map((t) => `<li>${t}</li>`).join('')}</ul>` : '';
	}
	const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

	function quitar(i) {
		archivos.splice(i, 1);
		if (actual >= archivos.length) actual = archivos.length - 1;
		if (i < actual) actual -= 1;
		render();
	}

	// ---------------------------------------------------------------- cargar archivos
	async function agregarTexto(nombre, texto, seleccionar = true) {
		const previo = archivos.findIndex((a) => a.nombre === nombre && a.texto === texto);
		if (previo >= 0) {
			actual = previo;
			return render();
		}
		let n = nombre;
		for (let k = 2; archivos.some((a) => a.nombre === n); k++) n = nombre.replace(/(\.[^.]+)?$/, ` (${k})$1`);
		archivos.push(procesar(n, texto));
		if (seleccionar) actual = archivos.length - 1;
		return render();
	}
	async function agregarArchivos(lista) {
		const fs = [...lista];
		if (!fs.length) return;
		for (const file of fs) {
			try {
				await agregarTexto(file.name, decodificar(await file.arrayBuffer()));
			} catch (e) {
				avisar(`No se pudo abrir ${file.name}: ${mensajeError(e)}`);
			}
		}
	}
	async function abrirEjemplo(url, nombre) { // el catálogo: un esquemático con todos los símbolos disponibles
		try {
			await agregarTexto(nombre, decodificar(await (await fetch(url)).arrayBuffer()));
		} catch (e) {
			avisar(`No se pudo abrir el catálogo: ${mensajeError(e)}`);
		}
	}
	let temporizador = 0;
	function avisar(t) {
		$('#resumen').textContent = t;
		clearTimeout(temporizador);
		temporizador = setTimeout(() => render(), 4500);
	}

	// ---------------------------------------------------------------- exportar
	const cacheFuentes = {};
	const fuenteB64 = (url) =>
		(cacheFuentes[url] ??= fetch(url)
			.then((r) => r.arrayBuffer())
			.then((b) => {
				const u = new Uint8Array(b);
				let s = '';
				for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
				return btoa(s);
			}));

	async function pdfDe(f) {
		const v = armar(f, opts);
		if (opts.fondo) conFondo(v.svg, v.vb);
		host.appendChild(v.svg);
		try {
			const s = opts.escala / 100;
			const w = v.vb[2] * s;
			const h = v.vb[3] * s;
			const { jsPDF } = window.jspdf;
			const doc = new jsPDF({ unit: 'pt', format: [w, h], orientation: w > h ? 'landscape' : 'portrait', compress: true });
			doc.setProperties({ title: f.base, subject: 'Esquemático de LTspice', creator: 'kumOS · Spice2PDF' });
			const [reg, ita] = await Promise.all([fuenteB64('../compartido/fonts/lmroman10-regular.ttf'), fuenteB64('../compartido/fonts/cmunti.ttf')]);
			doc.addFileToVFS('lmroman10-regular.ttf', reg);
			doc.addFont('lmroman10-regular.ttf', 'LM Roman 10', 'normal');
			doc.addFileToVFS('cmunti.ttf', ita);
			doc.addFont('cmunti.ttf', 'LM Roman 10', 'italic');
			await window.svg2pdf.svg2pdf(v.svg, doc, { x: 0, y: 0, width: w, height: h });
			return doc.output('blob');
		} finally {
			v.svg.remove();
		}
	}

	async function svgTexto(f, fondoBlanco = false) {
		const v = armar(f, opts);
		if (opts.fondo || fondoBlanco) conFondo(v.svg, v.vb);
		v.svg.querySelectorAll('[data-i],[data-base]').forEach((e) => {
			e.removeAttribute('data-i');
			e.removeAttribute('data-base');
		});
		const [reg, ita] = await Promise.all([fuenteB64('../compartido/fonts/lmroman10-regular.ttf'), fuenteB64('../compartido/fonts/cmunti.ttf')]);
		const st = document.createElementNS(NS, 'style');
		st.textContent =
			`@font-face{font-family:"LM Roman 10";font-style:normal;src:url(data:font/ttf;base64,${reg}) format("truetype")}` +
			(v.svg.querySelector('[font-style="italic"]') ? `@font-face{font-family:"LM Roman 10";font-style:italic;src:url(data:font/ttf;base64,${ita}) format("truetype")}` : '');
		v.svg.insertBefore(st, v.svg.firstChild);
		v.svg.setAttribute('xmlns', NS);
		return { texto: '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(v.svg), vb: v.vb };
	}

	async function pngDe(f, fondoBlanco = false) {
		const { texto, vb } = await svgTexto(f, fondoBlanco);
		const px = (opts.escala / 100) * (opts.dpi / 72); // píxeles por unidad del dibujo
		const w = Math.max(1, Math.round(vb[2] * px));
		const h = Math.max(1, Math.round(vb[3] * px));
		if (w * h > 120e6) throw new Error('La imagen sería demasiado grande: bajá la resolución o la escala.');
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
			const ctx = cv.getContext('2d');
			ctx.drawImage(img, 0, 0, w, h);
			return await new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo crear la imagen'))), 'image/png'));
		} finally {
			URL.revokeObjectURL(url);
		}
	}

	/** Copia el dibujo como imagen al portapapeles (con fondo blanco, para que se pegue bien en cualquier lado). */
	async function copiarImagen(boton) {
		const f = archivos[actual];
		if (!f || f.error) return;
		if (!navigator.clipboard || !window.ClipboardItem) {
			avisar('Este navegador no deja copiar imágenes: usá el botón PNG.');
			return;
		}
		// El permiso del clic se conserva si la imagen se entrega como promesa (hace falta en Safari).
		const item = new ClipboardItem({ 'image/png': pngDe(f, true) });
		const hacer = () => navigator.clipboard.write([item]).then(() => avisar('Imagen copiada: pegala en tu informe con Ctrl+V.'));
		if (boton) await conEspera(boton, 'Copiando…', hacer);
		else await hacer().catch((e) => avisar(`No se pudo copiar: ${mensajeError(e)}`));
	}

	function descargar(blob, nombre) {
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = nombre;
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(a.href), 4000);
	}

	async function conEspera(boton, texto, tarea) {
		const previo = boton.innerHTML;
		const previoDis = boton.disabled;
		boton.disabled = true;
		if (texto) boton.textContent = texto;
		try {
			await tarea();
		} catch (e) {
			avisar(`No se pudo exportar: ${mensajeError(e)}`);
			console.error(e);
		} finally {
			boton.innerHTML = previo;
			boton.disabled = previoDis;
		}
	}

	// ---------------------------------------------------------------- interfaz
	const CAMPOS = [
		['encuadre', 'o-encuadre', 'sel'],
		['margen', 'o-margen', 'num', 'v-margen', (v) => `${v}`],
		['escala', 'o-escala', 'num', 'v-escala', (v) => `${v} %`],
		['letra', 'o-letra', 'num', 'v-letra', (v) => `${v} %`],
		['grosor', 'o-grosor', 'num', 'v-grosor', (v) => `${v} %`],
		['nombres', 'o-nombres', 'chk'],
		['valores', 'o-valores', 'chk'],
		['etiquetas', 'o-etiquetas', 'chk'],
		['comentarios', 'o-comentarios', 'chk'],
		['nodos', 'o-nodos', 'chk'],
		['faltantes', 'o-faltantes', 'chk'],
		['fondo', 'o-fondo', 'chk'],
		['dpi', 'o-dpi', 'sel'],
	];
	function pintarCampos() {
		for (const [k, id, tipo, out, fmt] of CAMPOS) {
			const el = $(`#${id}`);
			if (tipo === 'chk') el.checked = !!opts[k];
			else el.value = String(opts[k]);
			if (out) $(`#${out}`).textContent = fmt(opts[k]);
		}
	}
	function enlazarCampos() {
		let t = 0;
		for (const [k, id, tipo, out, fmt] of CAMPOS) {
			const el = $(`#${id}`);
			el.addEventListener(tipo === 'num' ? 'input' : 'change', () => {
				opts[k] = tipo === 'chk' ? el.checked : tipo === 'num' ? Number(el.value) : tipo === 'sel' && /^\d+$/.test(el.value) ? Number(el.value) : el.value;
				if (out) $(`#${out}`).textContent = fmt(opts[k]);
				guardarOpciones();
				clearTimeout(t);
				t = setTimeout(render, 60);
			});
		}
		$('#restaurar').addEventListener('click', () => {
			opts = { ...POR_DEFECTO };
			guardarOpciones();
			pintarCampos();
			render();
		});
	}

	function enlazarArrastre() {
		let activo = false;
		let x0 = 0;
		let y0 = 0;
		let sx = 0;
		let sy = 0;
		lienzo.addEventListener('pointerdown', (e) => {
			if (e.button !== 0 || e.target.closest('button') || e.target.closest('.agarre')) return;
			activo = true;
			x0 = e.clientX;
			y0 = e.clientY;
			sx = lienzo.scrollLeft;
			sy = lienzo.scrollTop;
			lienzo.setPointerCapture(e.pointerId);
			lienzo.classList.add('arrastrando');
		});
		lienzo.addEventListener('pointermove', (e) => {
			if (!activo) return;
			lienzo.scrollLeft = sx - (e.clientX - x0);
			lienzo.scrollTop = sy - (e.clientY - y0);
		});
		const fin = () => {
			activo = false;
			lienzo.classList.remove('arrastrando');
		};
		lienzo.addEventListener('pointerup', fin);
		lienzo.addEventListener('pointercancel', fin);
		lienzo.addEventListener(
			'wheel',
			(e) => {
				if (!(e.ctrlKey || e.metaKey) || paper.hidden) return;
				e.preventDefault();
				cambiarZoom(e.deltaY < 0 ? 1.15 : 1 / 1.15);
			},
			{ passive: false },
		);
		lienzo.addEventListener('dblclick', (e) => {
			if (e.target.closest('.agarre')) return; // doble clic sobre un texto: lo devuelve a su lugar
			zoom = 'fit';
			aplicarZoom();
		});
	}

	function enlazarSoltar() {
		const capa = $('#soltar');
		let n = 0;
		const tieneArchivos = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
		addEventListener('dragenter', (e) => {
			if (!tieneArchivos(e)) return;
			e.preventDefault();
			n++;
			capa.hidden = false;
		});
		addEventListener('dragover', (e) => {
			if (tieneArchivos(e)) e.preventDefault();
		});
		addEventListener('dragleave', () => {
			n = Math.max(0, n - 1);
			if (!n) capa.hidden = true;
		});
		addEventListener('drop', (e) => {
			if (!tieneArchivos(e)) return;
			e.preventDefault();
			n = 0;
			capa.hidden = true;
			agregarArchivos(e.dataTransfer.files);
		});
	}

	function enlazarBotones() {
		const sel = $('#archivo');
		$('#abrir').addEventListener('click', () => sel.click());
		sel.addEventListener('change', async () => {
			await agregarArchivos(sel.files);
			sel.value = '';
		});

		$('#catalogo').addEventListener('click', () => abrirEjemplo('catalogo/catalogo.asc', 'catalogo.asc'));

		$('#z-menos').addEventListener('click', () => cambiarZoom(1 / 1.25));
		$('#z-mas').addEventListener('click', () => cambiarZoom(1.25));
		$('#z-valor').addEventListener('click', () => {
			zoom = 'fit';
			aplicarZoom();
		});
		$('#z-uno').addEventListener('click', () => {
			zoom = 1;
			aplicarZoom();
		});
		new ResizeObserver(() => {
			if (zoom === 'fit') aplicarZoom();
		}).observe(lienzo);

		$('#d-pdf').addEventListener('click', (e) => {
			const f = archivos[actual];
			conEspera(e.currentTarget, 'Generando…', async () => descargar(await pdfDe(f), `${f.base}.pdf`));
		});
		$('#d-svg').addEventListener('click', (e) => {
			const f = archivos[actual];
			conEspera(e.currentTarget, 'Generando…', async () => descargar(new Blob([(await svgTexto(f)).texto], { type: 'image/svg+xml' }), `${f.base}.svg`));
		});
		$('#d-copiar').addEventListener('click', (e) => copiarImagen(e.currentTarget));
		// Ctrl+C con el dibujo a la vista (si no hay texto seleccionado ni se está escribiendo en un campo)
		addEventListener('keydown', (e) => {
			if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') || e.shiftKey || e.altKey) return;
			const t = e.target;
			if (t && (t.closest?.('input, textarea, select, dialog') || t.isContentEditable)) return;
			if (String(getSelection() || '') || paper.hidden) return;
			e.preventDefault();
			copiarImagen(null);
		});
		$('#d-png').addEventListener('click', (e) => {
			const f = archivos[actual];
			conEspera(e.currentTarget, 'Generando…', async () => descargar(await pngDe(f), `${f.base}.png`));
		});
		$('#d-todos').addEventListener('click', (e) => {
			const boton = e.currentTarget; // (después de un await el evento ya no tiene currentTarget)
			const buenos = archivos.filter((a) => !a.error);
			conEspera(boton, '', async () => {
				const zip = {};
				const usados = new Set();
				for (let i = 0; i < buenos.length; i++) {
					boton.textContent = `Generando ${i + 1}/${buenos.length}…`;
					const f = buenos[i];
					let n = `${f.base}.pdf`;
					for (let k = 2; usados.has(n); k++) n = `${f.base} (${k}).pdf`;
					usados.add(n);
					zip[n] = new Uint8Array(await (await pdfDe(f)).arrayBuffer());
					await new Promise((r) => setTimeout(r)); // deja respirar a la página
				}
				descargar(new Blob([window.fflate.zipSync(zip)], { type: 'application/zip' }), 'esquematicos.zip');
			});
		});

		const dlg = $('#dlg-info');
		let lleno = false;
		$('#info').addEventListener('click', () => {
			if (!lleno) {
				$('#info-cuerpo').innerHTML = window.AYUDA;
				lleno = true;
			}
			dlg.showModal();
			$('#info-cuerpo').focus();
		});
		$('[data-cerrar]', dlg).addEventListener('click', () => dlg.close());
		dlg.addEventListener('pointerdown', (e) => {
			if (e.target === dlg) dlg.close();
		});
	}

	// ---------------------------------------------------------------- arranque
	async function iniciar() {
		pintarCampos();
		enlazarCampos();
		enlazarBotones();
		enlazarArrastre();
		enlazarTextos();
		enlazarSoltar();
		pintarLista();
		$('#abrir2')?.addEventListener('click', () => $('#archivo').click());
		try {
			await Promise.all([iniciarPython(), document.fonts.load('20px "LM Roman 10"'), document.fonts.load('italic 20px "LM Roman 10"')]);
			$('#cargando').remove();
		} catch (e) {
			console.error(e);
			decir(`No se pudo iniciar: ${mensajeError(e)}`, 100);
			return;
		}
		// Interfaz para quien incruste la herramienta (por ejemplo, la app Archivo de kumOS).
		window.Spice2PDF = { abrirTexto: (nombre, texto) => agregarTexto(nombre, texto), pdf: async () => (archivos[actual] ? pdfDe(archivos[actual]) : null) };
		render();
	}
	iniciar();
})();
