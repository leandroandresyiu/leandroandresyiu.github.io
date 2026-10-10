// Python de py snippets: corre en un worker para que la página no se trabe mientras se calcula.
// Usa el Pyodide que ya trae el sitio (/qtweb/pyodide/); Lcapy y sus dependencias van en ../ruedas/ (nada sale a internet).
const base = new URL('../', import.meta.url);
const pyodideUrl = new URL('../../qtweb/pyodide/', import.meta.url);
const VERSION = self.name || '1';
let py = null;
let lcapyListo = null;

const avisar = (m) => self.postMessage(m);

async function iniciar() {
	avisar({ t: 'estado', v: 'Cargando Python…' });
	const { loadPyodide } = await import(new URL('pyodide.mjs', pyodideUrl).href);
	py = await loadPyodide({ indexURL: pyodideUrl.href });
	await py.loadPackage(['numpy', 'scipy', 'matplotlib', 'sympy', 'micropip']);
	py.FS.mkdirTree('/home/pyodide/lib');
	py.FS.mkdirTree('/home/pyodide/archivos');
	for (const f of ['kumolib.py', 'kumo_runtime.py']) {
		const r = await fetch(new URL(`py/${f}?v=${VERSION}`, base));
		if (!r.ok) throw new Error(`No pude cargar ${f}`);
		py.FS.writeFile(`/home/pyodide/lib/${f}`, await r.text());
	}
	py.runPython("import sys; sys.path.insert(0, '/home/pyodide/lib')");
	py.runPython('import kumo_runtime');
	avisar({ t: 'listo' });
	lcapyListo = instalarLcapy().catch((e) => {
		avisar({ t: 'estado', v: 'No pude cargar Lcapy: ' + e.message });
		throw e;
	});
	lcapyListo.catch(() => {});
}

const PREPARAR = `
import sys, types
for _n in ['IPython', 'IPython.display', 'IPython.core', 'IPython.core.display']:
    sys.modules.setdefault(_n, types.ModuleType(_n))
_d = sys.modules['IPython.display']
for _a in ('display', 'Image', 'SVG', 'Latex', 'Math', 'HTML'):
    setattr(_d, _a, lambda *a, **k: None)
sys.modules['IPython'].get_ipython = lambda: None
import micropip
`;

// El reemplazo de IPython solo hace falta para importar Lcapy: si queda, Matplotlib cree que corre dentro de Jupyter.
const IMPORTAR = `
import lcapy
for _n in [k for k in sys.modules if k == 'IPython' or k.startswith('IPython.')]:
    del sys.modules[_n]
`;

async function instalarLcapy() {
	await py.runPythonAsync(PREPARAR);
	for (const w of ['property_cached-1.6.4-py2.py3-none-any.whl', 'networkx-3.6.1-py3-none-any.whl', 'lcapy-1.26-py3-none-any.whl']) {
		py.globals.set('_rueda', new URL(`ruedas/${w}`, base).href);
		await py.runPythonAsync('await micropip.install(_rueda, deps=False)');
	}
	await py.runPythonAsync(IMPORTAR);
	avisar({ t: 'lcapy' });
}

const NECESITA_LCAPY = /lcapy|cargar_asc|\.H\(|Z_visto|\.Z\(|\bnetlist\b|Circuit/;

self.onmessage = async (ev) => {
	const m = ev.data;
	try {
		if (m.t === 'iniciar') await iniciar();
		else if (m.t === 'archivo') {
			py.FS.writeFile(`/home/pyodide/archivos/${m.nombre}`, m.texto);
			avisar({ t: 'ok', id: m.id });
		} else if (m.t === 'ejecutar') {
			if (NECESITA_LCAPY.test(m.codigo)) {
				avisar({ t: 'estado', v: 'Cargando Lcapy…' });
				await lcapyListo;
			}
			py.globals.set('_codigo', m.codigo);
			const t0 = performance.now();
			const r = py.runPython('kumo_runtime.ejecutar(_codigo)');
			avisar({ t: 'resultado', id: m.id, salidas: JSON.parse(r), ms: Math.round(performance.now() - t0) });
		} else if (m.t === 'reiniciar') {
			py.runPython('kumo_runtime.reiniciar()');
			avisar({ t: 'ok', id: m.id });
		}
	} catch (e) {
		avisar({ t: 'fallo', id: m.id, mensaje: String(e?.message ?? e) });
	}
};
