// Arranque del Pizarrón: junta la vista, el dibujo y la interfaz, recupera el trabajo anterior y expone `window.Pizarron`.
import { $ } from './dom.js';
import { E, emitir, en, pagina, ponerDoc } from './estado.js';
import { ajustar, iniciarVista, pedir } from './vista.js';
import { iniciarDibujo } from './dibujo.js';
import { montarInterfaz } from './interfaz.js';
import { abrirDeArchivo, abrirTexto, permitirSoltar } from './acciones.js';
import { leerSesion, programarGuardado, vaciar } from './persistencia.js';

async function fuentesListas() {
	// El texto se mide con la tipografía real: hay que esperar a que cargue antes de crear o leer objetos de texto.
	try {
		await Promise.race([Promise.all([document.fonts.load('20px "LM Roman 10"'), document.fonts.load('italic 20px "LM Roman 10"')]), new Promise((r) => setTimeout(r, 2500))]);
	} catch {
		/* se sigue con la tipografía de reemplazo */
	}
}

async function arrancar() {
	await fuentesListas();
	iniciarVista($('#lienzo'), $('#cv-base'), $('#cv-vivo'));
	iniciarDibujo($('#cv-vivo'));
	montarInterfaz();
	permitirSoltar();

	// Qué abrir: lo que pidió la app Archivo (si vino de ahí) o el trabajo anterior de este navegador.
	let pendiente = null;
	try {
		pendiente = window.parent?.kumosPizarronPendiente ?? null;
		if (window.parent && pendiente) window.parent.kumosPizarronPendiente = null;
	} catch {
		pendiente = null;
	}
	if (pendiente) await abrirDeArchivo(pendiente);
	else {
		const s = await leerSesion();
		// una sesión sin nada dibujado no se restaura: así el pizarrón nuevo arranca siempre con la hoja por defecto (A4 horizontal de puntos)
		const vacia = s && s.doc.paginas.every((p) => p.objetos.length === 0) && !s.origen;
		if (s && !vacia) {
			ponerDoc(s.doc, { reiniciar: true });
			E.origen = s.origen;
			E.sucio = false;
			ajustar('pagina');
			emitir('titulo');
		}
	}

	const guardar = () => programarGuardado(() => ({ doc: E.doc, origen: E.origen }));
	en('doc', guardar);
	en('titulo', guardar);
	document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && vaciar());
	addEventListener('pagehide', () => vaciar());
	pedir();

	// Para que la app Archivo (u otra ventana de kumOS) pueda pedirle cosas al pizarrón.
	window.Pizarron = {
		abrirTexto: (texto, origen = null) => abrirTexto(texto, origen),
		abrirDeArchivo: (id) => abrirDeArchivo(id),
		estado: () => ({ paginas: E.doc.paginas.length, pagina: E.idx + 1, objetos: pagina().objetos.length, herramienta: E.herr, titulo: E.doc.titulo }),
	};
	document.documentElement.dataset.listo = '1';
}

arrancar();
