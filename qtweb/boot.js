// Arranque de las herramientas de escritorio (PlotTool, FilterTool): carga Python (Pyodide) desde esta carpeta,
// copia el código compartido (la capa que imita PyQt5) y el de la herramienta, y abre su ventana.
// Todo local: no se pide nada a servidores externos.
//
// La página de cada herramienta define antes de cargar este archivo:
//   window.QTWEB = { nombre: 'PlotTool', ancho: 980 }
// y tiene un manifest.json (lista de archivos de su carpeta app/).

const SCRIPT_URL = document.currentScript.src;

// En pantallas angostas la ventana se achica entera (como una captura), en vez de recortarse.
const ANCHO_MIN = (window.QTWEB && window.QTWEB.ancho) || 980;
function ajustar() {
	const app = document.getElementById('app');
	if (innerWidth >= ANCHO_MIN) {
		app.style.cssText = '';
		return;
	}
	const k = innerWidth / ANCHO_MIN;
	app.style.cssText = `inset:auto;left:0;top:0;width:${ANCHO_MIN}px;height:${innerHeight / k}px;transform:scale(${k});transform-origin:0 0`;
}
addEventListener('resize', ajustar);
ajustar();
if (window.QTWEB && window.QTWEB.estilo) {
	const st = document.createElement('style');
	st.textContent = window.QTWEB.estilo;
	document.head.appendChild(st);
}

(async () => {
	const $ = (id) => document.getElementById(id);
	const decir = (t, p) => {
		$('msg').textContent = t;
		if (p != null) $('prog').style.width = `${p}%`;
	};
	try {
		const nombre = (window.QTWEB && window.QTWEB.nombre) || 'la herramienta';
		const compartida = new URL('.', SCRIPT_URL).href;
		const propia = new URL('.', location.href).href;
		window.__py = null;
		decir(`Iniciando Python…`, 5);
		const py = await loadPyodide({ indexURL: `${compartida}pyodide/` });
		window.__py = py; // (para depurar desde la consola)
		decir('Cargando numpy, scipy, matplotlib y sympy…', 20);
		await py.loadPackage(['numpy', 'scipy', 'matplotlib', 'sympy']);
		decir(`Copiando ${nombre}…`, 75);
		const copiar = async (base, carpetaDestino, lista) => {
			for (const ruta of lista) {
				const buf = new Uint8Array(await (await fetch(`${base}${ruta}`, { cache: 'no-cache' })).arrayBuffer());
				const dir = `${carpetaDestino}/${ruta}`.split('/').slice(0, -1).join('/');
				py.FS.mkdirTree(dir);
				py.FS.writeFile(`${carpetaDestino}/${ruta}`, buf);
			}
		};
		const libs = await (await fetch(`${compartida}manifest.json`, { cache: 'no-cache' })).json();
		await copiar(compartida, '/app', libs);
		const lista = await (await fetch(`${propia}manifest.json`, { cache: 'no-cache' })).json();
		await copiar(`${propia}app/`, '/app', lista);
		decir('Armando la ventana…', 90);
		await py.runPythonAsync("import sys; sys.path.insert(0, '/app'); import boot; boot.main()");
		decir('', 100);
		$('cargando').remove();
	} catch (e) {
		console.error(e);
		decir('No se pudo abrir la herramienta.', 0);
		const d = $('detalle');
		d.style.whiteSpace = 'pre-wrap';
		d.style.textAlign = 'left';
		d.style.maxWidth = '90vw';
		d.style.maxHeight = '60vh';
		d.style.overflow = 'auto';
		d.textContent = String(e && e.message ? e.message : e).slice(-2500);
	}
})();
