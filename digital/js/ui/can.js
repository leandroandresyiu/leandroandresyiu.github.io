// Panel de CAN: codificar una trama (relleno de bits y CRC-15), decodificar bits o líneas de candump y repasar la norma.
import { FORMATOS, hex, parseBits, parseDatos } from '../bits.js';
import * as can from '../can.js';
import { h, porCuadro } from '../dom.js';
import { aVista, fmtTiempo } from '../modelo.js';
import { aviso, areaTexto, botonCopiar, campo, casilla, conDefectos, nota, numero, resumenDe, segmentado, selector, seccion, tabla, textoLinea } from './comun.js';
import { montarRepaso } from './repaso.js';

const BASE = { bitrate: 500000 };
const LISTA_BITRATES = can.BITRATES.map((b) => [b, b >= 1e6 ? `${b / 1e6} Mbit/s` : `${(b / 1000).toLocaleString('es-AR')} kbit/s`]);

const cadenaBits = (bits) => bits.join('');
const colsCampos = [
	{ t: 'Campo', k: 'nombre', clase: 'nowrap' },
	{ t: 'Valor', k: 'valor', clase: 'mono nowrap' },
	{ t: 'Bits', k: (c) => cadenaBits(c.bits), clase: 'mono' },
	{ t: 'Qué es', k: 'nota', clase: 'ajusta' },
];
const hexId = (f) => hex(f.id, f.ext ? 8 : 3);
/** Notación de can-utils: 123#DEADBEEF, 123#R, 1F334455#11223344. */
const candump = (f) => `${hexId(f)}#${f.rtr ? 'R' : f.datos.map((b) => hex(b)).join('')}`;

// ------------------------------------------------------------------ codificar
function codificar(ctx) {
	const est = conDefectos(ctx.est, { ...BASE, ext: false, id: '123', rtr: false, formato: 'hex', datos: 'DE AD BE EF', dlc: 0, ack: true });
	const avisos = h('div');
	let botonEditor;
	const cambio = porCuadro(() => {
		ctx.guardar();
		calcular();
	});
	const rearmar = () => armar();

	function calcular() {
		avisos.replaceChildren();
		const idTxt = String(est.id).trim().replace(/^0x/i, '');
		const vacio = (titulo, texto) => {
			ctx.mostrar(null, { titulo, texto });
			ctx.resultados(null);
			botonEditor && (botonEditor.disabled = true);
		};
		if (!/^[0-9a-fA-F]{1,8}$/.test(idTxt)) {
			avisos.append(aviso('El identificador va en hexadecimal (por ejemplo 123).', 'error'));
			return vacio('Revisá el identificador', 'Hexadecimal, hasta 0x7FF en la trama estándar y 0x1FFFFFFF en la extendida.');
		}
		const id = parseInt(idTxt, 16);
		let datos = [];
		if (!est.rtr) {
			const r = parseDatos(est.datos, est.formato, 64);
			if (r.error) {
				avisos.append(aviso(r.error, 'error'));
				return vacio('No se pudo leer el dato', r.error);
			}
			datos = r.bytes;
			if (datos.length > 8) {
				avisos.append(aviso(`CAN clásico lleva como máximo 8 bytes de datos (hay ${datos.length}). Se usan los primeros 8.`, 'aviso'));
				datos = datos.slice(0, 8);
			}
		}
		let tr;
		try {
			tr = can.codificar({ ext: est.ext, id, rtr: est.rtr, datos, dlc: est.rtr ? est.dlc : undefined, ack: est.ack });
		} catch (e) {
			avisos.append(aviso(e.message, 'error'));
			return vacio('No se pudo armar la trama', e.message);
		}
		const diagrama = can.construirDiagrama(tr, { bitrate: est.bitrate });
		ctx.mostrar({ m: aVista(diagrama), px: diagrama.pxSugerido, nombre: `can-${hexId(tr)}`, resumen: `CAN ${tr.ext ? 'extendida' : 'estándar'} · ID 0x${hexId(tr)} · ${tr.bits.length - 3} bits en el bus` });
		ctx.diagrama = diagrama;
		botonEditor.disabled = false;
		const tBit = 1 / est.bitrate;
		const enBus = tr.bits.length - 3; // sin el espacio entre tramas
		const texto = candump(tr);
		ctx.resultados(
			h(
				'div',
				{},
				resumenDe([
					['CRC-15', `0x${hex(tr.crc, 4)}`],
					['Bits sin relleno', String(tr.bitsSinRelleno.length + 10)],
					['Bits de relleno', String(tr.rellenos.length)],
					['Bits en el bus', String(enBus)],
					['Duración', fmtTiempo(enBus * tBit)],
				]),
				h('p', { class: 'nota' }, 'Notación candump: ', h('code', {}, texto)),
				h('div', { class: 'fila-botones' }, botonCopiar('Copiar candump', () => texto), botonCopiar('Copiar bits', () => cadenaBits(tr.bits.slice(0, enBus)))),
				tabla(colsCampos, tr.campos.filter((c) => c.nombre !== 'IFS')),
			),
		);
	}

	function armar() {
		botonEditor = h('button', { type: 'button', class: 'btn btn--chico', disabled: true, onclick: () => ctx.diagrama && ctx.alEditor(ctx.diagrama) }, 'Enviar al editor');
		ctx.panel.replaceChildren(
			seccion(
				'Trama',
				segmentado(
					[
						[false, 'Estándar (11 bits)', 'CAN 2.0A'],
						[true, 'Extendida (29 bits)', 'CAN 2.0B'],
					],
					est.ext,
					(v) => {
						est.ext = v;
						cambio();
						rearmar();
					},
					'Formato del identificador',
				),
				campo('Identificador (hex)', textoLinea(est.id, (v) => ((est.id = v), cambio()), { placeholder: est.ext ? '18DAF110' : '123' }), est.ext ? 'Hasta 0x1FFFFFFF.' : 'Hasta 0x7FF. Menor número = más prioridad.'),
				casilla('Trama remota (RTR)', 'pide datos, no lleva', est.rtr, (v) => ((est.rtr = v), cambio(), rearmar())),
				est.rtr
					? campo('Bytes que se piden (DLC)', numero(est.dlc, (v) => ((est.dlc = Math.max(0, Math.min(15, Math.round(v)))), cambio()), { min: 0, max: 15, ancho: '100%' }))
					: [campo('Formato de los datos', selector(Object.entries(FORMATOS), est.formato, (v) => ((est.formato = v), cambio()))), areaTexto(est.datos, (v) => ((est.datos = v), cambio()), { filas: 2, placeholder: 'DE AD BE EF' }), nota('De 0 a 8 bytes. El DLC se calcula solo.')],
				avisos,
			),
			seccion(
				'Bus',
				campo('Velocidad', selector(LISTA_BITRATES, est.bitrate, (v) => ((est.bitrate = v), cambio()))),
				casilla('Un receptor confirma la trama', 'ACK en 0', est.ack, (v) => ((est.ack = v), cambio())),
			),
			seccion('Dibujo', h('div', { class: 'fila-botones' }, botonEditor)),
		);
		calcular();
	}
	armar();
	return { redibujar: calcular };
}

// ------------------------------------------------------------------ decodificar
function ejemploBits() {
	const tr = can.codificar({ id: 0x123, datos: [0xde, 0xad, 0xbe, 0xef] });
	return tr.bits
		.slice(0, tr.bits.length - 3)
		.join('')
		.replace(/(.{8})/g, '$1 ')
		.trim();
}

function decodificar(ctx) {
	const est = conDefectos(ctx.est, { ...BASE, texto: '', sel: 0 });
	const avisos = h('div');
	let botonEditor;
	let area;
	const cambio = porCuadro(() => {
		ctx.guardar();
		calcular();
	});

	function calcular() {
		avisos.replaceChildren();
		const texto = est.texto.trim();
		if (!texto) {
			ctx.mostrar(null, { titulo: 'Pegá una trama', texto: 'Una línea de candump (123#DEADBEEF) o los bits tal como pasan por el bus, con el relleno incluido.' });
			ctx.resultados(null);
			botonEditor.disabled = true;
			return;
		}
		if (texto.includes('#')) return desdeCandump(texto);
		return desdeBits(texto);
	}

	function resultadoCampos(tr, extra = []) {
		return h('div', {}, ...extra, tabla(colsCampos, tr.campos.filter((c) => c.nombre !== 'IFS')));
	}

	function desdeCandump(texto) {
		const lineas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
		const items = lineas.map((l) => ({ linea: l, f: can.parsearCandump(l) }));
		const buenos = items.filter((x) => x.f);
		if (!buenos.length) {
			avisos.append(aviso('No se entendió ninguna línea. El formato es ID#DATOS, por ejemplo 123#DEADBEEF, 1F334455#11.22 o 7FF#R.', 'error'));
			ctx.mostrar(null, { titulo: 'No se entiende el formato', texto: 'Probá con 123#DEADBEEF.' });
			ctx.resultados(null);
			return;
		}
		if (buenos.length < items.length) avisos.append(aviso(`${items.length - buenos.length} línea(s) no se entendieron y se omitieron.`, 'aviso'));
		const sel = Math.min(est.sel, buenos.length - 1);
		const f = buenos[sel].f;
		const tr = can.codificar({ ...f, ack: true });
		const diagrama = can.construirDiagrama(tr, { bitrate: est.bitrate });
		ctx.mostrar({ m: aVista(diagrama), px: diagrama.pxSugerido, nombre: `can-${hexId(tr)}`, resumen: `CAN ${tr.ext ? 'extendida' : 'estándar'} · ID 0x${hexId(tr)} · ${tr.bits.length - 3} bits en el bus` });
		ctx.diagrama = diagrama;
		botonEditor.disabled = false;
		const lista =
			buenos.length > 1
				? tabla(
						[
							{ t: '#', k: (_, i) => i + 1 },
							{ t: 'ID', k: (x) => `0x${hexId(x.f)}`, clase: 'mono' },
							{ t: 'Formato', k: (x) => (x.f.ext ? 'extendida' : 'estándar') },
							{ t: 'DLC', k: (x) => x.f.dlc, clase: 'mono' },
							{ t: 'Datos', k: (x) => (x.f.rtr ? 'remota' : x.f.datos.map((b) => hex(b)).join(' ')), clase: 'mono' },
						],
						buenos,
						{ alElegir: (_, i) => ((est.sel = i), ctx.guardar(), calcular()) },
					)
				: null;
		const enBus = tr.bits.length - 3;
		ctx.resultados(
			h(
				'div',
				{},
				resumenDe([
					['Trama', `${sel + 1} de ${buenos.length}`],
					['CRC-15 calculado', `0x${hex(tr.crc, 4)}`],
					['Bits en el bus', String(enBus)],
					['Bits de relleno', String(tr.rellenos.length)],
					['Duración', fmtTiempo(enBus / est.bitrate)],
				]),
				h('div', { class: 'fila-botones' }, botonCopiar('Copiar bits de esta trama', () => cadenaBits(tr.bits.slice(0, enBus)))),
				lista,
				h('h3', {}, 'Campos de la trama'),
				resultadoCampos(tr),
			),
		);
	}

	function desdeBits(texto) {
		if (/[^01\s,._|-]/.test(texto)) {
			avisos.append(aviso('Para bits solo se aceptan unos y ceros. Para una línea de candump usá el formato ID#DATOS.', 'error'));
			ctx.mostrar(null, { titulo: 'Hay caracteres que no son bits', texto: 'Solo 0 y 1.' });
			ctx.resultados(null);
			return;
		}
		const bits = parseBits(texto);
		// la trama empieza en el primer 0 (SOF); lo anterior es reposo
		const ini = bits.indexOf(0);
		if (ini < 0) {
			avisos.append(aviso('No hay ningún bit dominante (0): no se ve el comienzo de una trama.', 'error'));
			ctx.mostrar(null, { titulo: 'No se encuentra el SOF', texto: 'La trama empieza con un bit en 0.' });
			ctx.resultados(null);
			return;
		}
		const r = can.decodificarBits(bits.slice(ini));
		const trVista = { ext: !!r.ext, id: r.id ?? 0, campos: r.campos, rellenos: r.rellenos, bits: bits.slice(ini, ini + Math.max(1, r.consumidos)) };
		const diagrama = can.construirDiagrama(trVista, { bitrate: est.bitrate });
		ctx.mostrar({ m: aVista(diagrama), px: diagrama.pxSugerido, nombre: 'can-recibida', resumen: r.ok ? `CAN ${r.ext ? 'extendida' : 'estándar'} · ID 0x${hexId(r)} · correcta` : `CAN · con errores (${r.errores.length})` });
		ctx.diagrama = diagrama;
		botonEditor.disabled = false;
		const estado = [];
		for (const e of r.errores) estado.push(aviso(e, 'error'));
		for (const w of r.advertencias) estado.push(aviso(w, 'aviso'));
		if (r.ok && !r.advertencias.length) estado.push(aviso('Trama correcta: el relleno de bits y el CRC-15 coinciden.', 'ok'));
		const info = r.id === undefined ? [] : [['ID', `0x${hexId(r)}`], ['Formato', r.ext ? 'extendida' : 'estándar'], ['Tipo', r.rtr ? 'remota' : 'de datos'], ['DLC', String(r.dlc)], r.datos && r.datos.length ? ['Datos', r.datos.map((b) => hex(b)).join(' ')] : null, r.crcRx !== undefined ? ['CRC', r.crcOk ? 'correcto' : 'ERROR'] : null, ['Bits de relleno', String(r.rellenos.length)]];
		ctx.resultados(
			h(
				'div',
				{},
				resumenDe(info),
				...estado,
				r.id !== undefined && !r.rtr && r.datos && r.ok ? h('div', { class: 'fila-botones' }, botonCopiar('Copiar candump', () => candump({ ...r, datos: r.datos }))) : null,
				h('h3', {}, 'Campos de la trama'),
				resultadoCampos({ campos: r.campos }),
			),
		);
	}

	function armar() {
		botonEditor = h('button', { type: 'button', class: 'btn btn--chico', disabled: true, onclick: () => ctx.diagrama && ctx.alEditor(ctx.diagrama) }, 'Enviar al editor');
		area = areaTexto(est.texto, (v) => ((est.texto = v), (est.sel = 0), cambio()), { filas: 6, placeholder: '123#DEADBEEF\n\no bits con relleno:\n0 00100100011 0 0 0 0010 …' });
		ctx.panel.replaceChildren(
			seccion(
				'Trama recibida',
				area,
				avisos,
				nota('Dos formas: una o varias líneas de candump (ID#DATOS) o los bits del bus desde el SOF, con el relleno incluido. Con bits se comprueban el relleno y el CRC; con candump se arma la trama completa.'),
				h('div', { class: 'fila-botones' },
					h('button', { type: 'button', class: 'btn btn--chico', onclick: () => {
						est.texto = ejemploBits();
						area.value = est.texto;
						est.sel = 0;
						cambio();
					} }, 'Cargar ejemplo (bits)'),
					h('button', { type: 'button', class: 'btn btn--chico', onclick: () => {
						est.texto = '123#DEADBEEF\n18DAF110#021003\n321#R';
						area.value = est.texto;
						est.sel = 0;
						cambio();
					} }, 'Cargar ejemplo (candump)'),
					h('button', { type: 'button', class: 'btn btn--chico', onclick: () => {
						est.texto = '';
						area.value = '';
						cambio();
					} }, 'Borrar'),
				),
			),
			seccion('Bus', campo('Velocidad (para los tiempos)', selector(LISTA_BITRATES, est.bitrate, (v) => ((est.bitrate = v), cambio())))),
			seccion('Dibujo', h('div', { class: 'fila-botones' }, botonEditor)),
		);
		calcular();
	}
	armar();
	return { redibujar: calcular };
}

export const CAN = {
	id: 'can',
	nombre: 'CAN',
	sub: 'Bus diferencial multimaestro (CAN clásico 2.0A y 2.0B).',
	modos: [
		['codificar', 'Codificar', 'Del mensaje a los bits del bus'],
		['decodificar', 'Decodificar', 'De los bits o del candump al mensaje'],
		['repaso', 'Repaso', 'La norma en una pantalla'],
	],
	montar(modo, ctx) {
		if (modo === 'codificar') return codificar(ctx);
		if (modo === 'decodificar') return decodificar(ctx);
		if (modo === 'repaso') return montarRepaso('can', ctx);
		return null;
	},
};

