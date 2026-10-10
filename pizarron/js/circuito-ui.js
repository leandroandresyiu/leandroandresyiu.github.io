// "Copiar como circuito": toma lo seleccionado, lo convierte en un esquema de LTspice (.asc) y deja copiarlo, guardarlo en Archivo,
// bajarlo o sumarlo a un .asc que ya existe. La conversión (reconocer, conectar, verificar) está en circuito.js y asc.js.
import { $, descargar, h, mensajeError } from './dom.js';
import { E, emitir, objetosSel } from './estado.js';
import { nombreSeguro } from './modelo.js';
import { codificarASC, convertir, decodificarASC, dibujarASC, sumarAASC } from './asc.js';
import * as archivo from './archivo.js';

const NOMBRE_TIPO = { res: 'Resistencia', cap: 'Capacitor', ind: 'Inductor', voltage: 'Fuente de tensión', opamp: 'Operacional' };
const aviso = (t, ms) => emitir('aviso', t, ms);
const tiempo = (ms) => new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(ms).replace(/\./g, '');

/** ¿Lo seleccionado puede ser un circuito? (algo que no sea solo texto o imágenes) */
export const puedeSerCircuito = (sel) => sel.some((o) => o.t !== 'texto' && o.t !== 'imagen');

async function copiarTexto(texto) {
	try {
		await navigator.clipboard.writeText(texto);
		return true;
	} catch {
		// sin permiso del portapapeles: se prueba con un campo de texto oculto
		const t = h('textarea', { style: 'position:fixed;left:-9999px;top:0', 'aria-hidden': 'true' });
		t.value = texto;
		document.body.append(t);
		t.select();
		let ok = false;
		try {
			ok = document.execCommand('copy');
		} catch {
			ok = false;
		}
		t.remove();
		return ok;
	}
}
const blobASC = (texto, codificacion = 'utf-8') => new Blob([codificarASC(texto, codificacion)], { type: 'text/plain' });

/** Abre la ventana con el circuito de lo seleccionado. */
export function abrirCircuito() {
	const sel = objetosSel();
	if (!sel.length) return aviso('Seleccioná primero el circuito (con el recuadro o el lazo).', 3500);
	const dlg = $('#dlg-circuito');
	const r = convertir(sel);
	let nombre = `${nombreSeguro(E.doc.titulo)} - circuito`;
	const cerrar = () => dlg.close();
	const barra = (titulo) => h('div', { class: 'dlg__bar' }, h('span', { id: 't-circuito' }, titulo), h('button', { type: 'button', class: 'btn btn--icon', 'aria-label': 'Cerrar', onclick: cerrar }, '×'));
	const boton = (texto, onclick, clase = 'btn') => h('button', { type: 'button', class: clase, onclick }, texto);

	// ------------------------------------------------------------------ el resultado
	const verResultado = () => {
		if (r.error) {
			dlg.replaceChildren(
				barra('Copiar como circuito'),
				h('div', { class: 'dlg__cuerpo' }, h('p', { class: 'error' }, r.error), h('p', { class: 'nota' }, 'Los textos cerca de cada componente le ponen nombre y valor (R1, 10k, C1, 100n…), y un nombre solo (Vout) marca una red. Una tierra es un triángulo chico y un operacional, un triángulo grande con + y −.')),
				h('div', { class: 'dlg__pie' }, boton('Cerrar', cerrar)),
			);
			return;
		}
		const campoNombre = h('input', { type: 'text', class: 'campo', maxlength: '80', value: nombre, 'aria-label': 'Nombre del archivo', spellcheck: 'false' });
		campoNombre.addEventListener('input', () => (nombre = campoNombre.value));
		const base = () => nombreSeguro(campoNombre.value || 'circuito');
		const comps = h('ul', { class: 'circ__comps' }, r.comps.map((c) => h('li', {}, h('b', {}, c.nombre), ` ${NOMBRE_TIPO[c.tipo]}`, c.valor ? h('span', { class: 'circ__valor' }, c.valor) : null)));
		const ign = [...new Set(r.ignorados.map((i) => i.motivo))];
		const avisos = [...r.avisos.map((a) => a.texto), ...(ign.length ? [`${r.ignorados.length} ${r.ignorados.length === 1 ? 'trazo' : 'trazos'} sin usar: ${ign.join('; ')}.`] : [])];
		const estado = r.verificado
			? h('p', { class: 'circ__estado circ__estado--ok', role: 'status' }, 'Revisé el archivo: cada pata queda conectada igual que en tu dibujo.')
			: h('p', { class: 'circ__estado circ__estado--mal', role: 'alert' }, 'No pude comprobar que las conexiones coincidan con el dibujo. Revisalo antes de usarlo.');
		const guardar = boton('Guardar en Archivo', async (e) => {
			const b = e.currentTarget;
			b.disabled = true;
			try {
				const n = await archivo.nombreLibre(archivo.CARPETA_CIRCUITOS, base(), '.asc');
				await archivo.guardar(archivo.CARPETA_CIRCUITOS, n, blobASC(r.texto));
				aviso(`Guardado en Archivo › ${archivo.CARPETA_CIRCUITOS}: ${n}`, 4500);
			} catch (err) {
				aviso(`No se pudo guardar: ${mensajeError(err)}`, 6000);
			} finally {
				b.disabled = false;
			}
		});
		dlg.replaceChildren(
			barra('Copiar como circuito (LTspice)'),
			h(
				'div',
				{ class: 'dlg__cuerpo circ' },
				estado,
				h('div', { class: 'circ__vista', html: dibujarASC(r.texto) }),
				h('div', {}, h('h3', {}, `Componentes (${r.comps.length})`), comps),
				avisos.length ? h('div', {}, h('h3', {}, 'Para tener en cuenta'), h('ul', { class: 'circ__avisos' }, avisos.map((t) => h('li', {}, t)))) : null,
				h('label', { class: 'circ__nombre' }, 'Nombre del archivo', campoNombre),
				h('details', {}, h('summary', {}, 'Ver el texto del .asc'), h('pre', { class: 'circ__pre', tabindex: '0' }, r.texto)),
				h('p', { class: 'nota' }, 'Lo más seguro es guardar el .asc y abrirlo en LTspice, o sumarlo a un esquema que ya tengas. “Copiar” deja el texto en el portapapeles por si tu versión de LTspice acepta pegarlo, pero no todas lo hacen.'),
			),
			h(
				'div',
				{ class: 'dlg__pie circ__pie' },
				boton('Copiar', async () => aviso((await copiarTexto(r.texto)) ? 'Texto del circuito copiado' : 'No se pudo copiar: usá “Descargar”.', 3500)),
				guardar,
				boton('Descargar .asc', () => descargar(blobASC(r.texto), `${base()}.asc`)),
				boton('Sumar a un .asc…', verSumar, 'btn btn--primario'),
				boton('Cerrar', cerrar),
			),
		);
	};

	// ------------------------------------------------------------------ elegir a qué esquema sumarlo
	async function verSumar() {
		let lista = [];
		let error = '';
		try {
			lista = await archivo.listarASC();
		} catch (e) {
			error = mensajeError(e);
		}
		const entrada = h('input', { type: 'file', accept: '.asc,text/plain', hidden: true });
		entrada.addEventListener('change', async () => {
			const f = entrada.files?.[0];
			if (!f) return;
			if (f.size > 20 * 1024 * 1024) return aviso('El archivo es demasiado grande.', 4000);
			const d = decodificarASC(new Uint8Array(await f.arrayBuffer()));
			verSumado({ nombre: f.name, texto: d.texto, codificacion: d.codificacion, origen: null });
		});
		const cuerpo = h('div', { class: 'dlg__cuerpo' }, h('p', {}, 'Elegí el esquema al que querés agregar el circuito. Queda a la derecha de lo que ya tiene, sin tocar nada de lo anterior. Los nombres que se repiten (R1, C1…) se cambian solos.'));
		if (error) cuerpo.append(h('p', { class: 'error' }, `No se pudo leer Archivo: ${error}`));
		else if (!lista.length) cuerpo.append(h('p', { class: 'nota' }, 'No hay archivos .asc en Archivo. Podés elegir uno de tu equipo.'));
		else
			cuerpo.append(
				h(
					'ul',
					{ class: 'lista-arch' },
					lista.map((a) =>
						h(
							'li',
							{},
							h(
								'button',
								{
									type: 'button',
									onclick: async () => {
										try {
											const f = await archivo.leerBytes(a.id);
											if (!f) throw new Error('El archivo ya no está en Archivo.');
											const d = decodificarASC(f.bytes);
											verSumado({ nombre: a.nombre, texto: d.texto, codificacion: d.codificacion, origen: a });
										} catch (e) {
											aviso(mensajeError(e), 5000);
										}
									},
								},
								h('span', {}, a.nombre),
								h('small', {}, `${a.carpeta} · ${tiempo(a.mod)}`),
							),
						),
					),
				),
			);
		dlg.replaceChildren(barra('Sumar a un esquema de LTspice'), cuerpo, h('div', { class: 'dlg__pie' }, boton('Volver', verResultado), boton('Elegir del equipo…', () => entrada.click()), entrada));
	}

	// ------------------------------------------------------------------ el esquema ya sumado
	function verSumado({ nombre: nombreOrigen, texto, codificacion, origen }) {
		let m;
		try {
			m = sumarAASC(texto, r.texto);
		} catch (e) {
			aviso(`No se pudo sumar: ${mensajeError(e)}`, 6000);
			return;
		}
		const sinExt = nombreOrigen.replace(/\.asc$/i, '');
		const nombreNuevo = `${sinExt} + circuito.asc`;
		const bytes = () => blobASC(m.texto, codificacion);
		const copia = boton(
			origen ? 'Guardar como copia en Archivo' : 'Guardar en Archivo',
			async (e) => {
				const b = e.currentTarget;
				b.disabled = true;
				try {
					const carpeta = origen?.carpeta ?? archivo.CARPETA_CIRCUITOS;
					const n = await archivo.nombreLibre(carpeta, `${sinExt} + circuito`, '.asc');
					await archivo.guardar(carpeta, n, bytes());
					aviso(`Guardado en Archivo › ${carpeta}: ${n}`, 4500);
				} catch (err) {
					aviso(`No se pudo guardar: ${mensajeError(err)}`, 6000);
				} finally {
					b.disabled = false;
				}
			},
			'btn btn--primario',
		);
		const reemplazar = origen
			? boton('Reemplazar el original', async (e) => {
					if (!window.confirm(`Esto reemplaza «${origen.nombre}» en Archivo por el esquema con el circuito sumado. ¿Seguro?`)) return;
					const b = e.currentTarget;
					b.disabled = true;
					try {
						await archivo.guardar(origen.carpeta, origen.nombre, bytes());
						aviso(`Reemplazado en Archivo › ${origen.carpeta}: ${origen.nombre}`, 4500);
					} catch (err) {
						aviso(`No se pudo guardar: ${mensajeError(err)}`, 6000);
					} finally {
						b.disabled = false;
					}
				})
			: null;
		dlg.replaceChildren(
			barra('Esquema con el circuito sumado'),
			h(
				'div',
				{ class: 'dlg__cuerpo circ' },
				h('p', { class: 'circ__estado circ__estado--ok', role: 'status' }, `Sumé ${r.comps.length === 1 ? 'el componente' : `los ${r.comps.length} componentes`} a la derecha de «${nombreOrigen}».`),
				m.renombrados.length ? h('p', { class: 'nota' }, `Nombres cambiados porque ya estaban en uso: ${m.renombrados.map(([a, b]) => `${a} → ${b}`).join(', ')}.`) : null,
				h('div', { class: 'circ__vista circ__vista--grande', html: dibujarASC(m.texto) }),
				origen ? null : h('p', { class: 'nota' }, 'El navegador no puede reemplazar el archivo de tu equipo: bajá el nuevo y usalo en lugar del original.'),
			),
			h('div', { class: 'dlg__pie circ__pie' }, boton('Volver', verSumar), boton('Descargar', () => descargar(bytes(), nombreNuevo)), reemplazar, copia, boton('Cerrar', cerrar)),
		);
	}

	verResultado();
	dlg.showModal();
}
