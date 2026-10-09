// Panel de I²C: armar una transacción, leer una en notación de texto (S 50 W A 00 A P) y repasar la norma.
import { hex, parseDatos } from '../bits.js';
import { h, porCuadro } from '../dom.js';
import * as i2c from '../i2c.js';
import { aVista, fmtFrecuencia, fmtTiempo } from '../modelo.js';
import { aviso, areaTexto, botonCopiar, campo, campoFrecuencia, casilla, conDefectos, nota, resumenDe, segmentado, seccion, tabla, textoLinea } from './comun.js';
import { montarRepaso } from './repaso.js';

const BASE = { fHz: 100000 };
const MAX_EVENTOS = 80;

/** Texto hexadecimal "10 AB" -> bytes (o error). */
const bytesDe = (txt) => parseDatos(txt, 'hex', 64);
const dirDe = (txt, bits10) => {
	const t = String(txt ?? '').trim().replace(/^0x/i, '');
	if (!/^[0-9a-fA-F]{1,3}$/.test(t)) return { error: 'La dirección va en hexadecimal (por ejemplo 50 o 0x68).' };
	const v = parseInt(t, 16);
	const max = bits10 ? 0x3ff : 0x7f;
	if (v > max) return { error: `Con ${bits10 ? 10 : 7} bits la dirección llega hasta 0x${max.toString(16).toUpperCase()}. Si copiaste el byte con el bit R/W (por ejemplo A0), dividilo por 2: queda 0x${(v >> 1).toString(16).toUpperCase()}.` };
	return { v };
};

function avisosDeDireccion(v, bits10) {
	if (bits10) return null;
	if (v <= 7 || v >= 0x78) return `La dirección 0x${hex(v)} está reservada por la norma I²C (0x00–0x07 y 0x78–0x7F).`;
	return null;
}

/** Tabla de lo que significa cada evento. */
function tablaEventos(eventos) {
	return tabla(
		[
			{ t: 'Campo', k: 'campo', clase: 'nowrap' },
			{ t: 'Valor', k: 'valor', clase: 'mono nowrap' },
			{ t: 'Detalle', k: 'nota', clase: 'ajusta' },
		],
		i2c.describir(eventos),
	);
}

// ------------------------------------------------------------------ codificar
function codificar(ctx) {
	const est = conDefectos(ctx.est, { ...BASE, dir: '50', bits10: false, rw: 'W', escribir: '10 AB', leer: '12 34', nackDir: false, ultimoNack: true, sinStop: false });
	const avisos = h('div');
	let botonEditor;
	const cambio = porCuadro(() => {
		ctx.guardar();
		calcular();
	});
	const rearmar = () => armar();

	function calcular() {
		avisos.replaceChildren();
		const dir = dirDe(est.dir, est.bits10);
		const esc = est.rw !== 'R' ? bytesDe(est.escribir) : { bytes: [], error: null };
		const lee = est.rw !== 'W' ? bytesDe(est.leer) : { bytes: [], error: null };
		const error = dir.error || (esc.error && `Datos a escribir: ${esc.error}`) || (lee.error && `Datos a leer: ${lee.error}`);
		if (error) {
			avisos.append(aviso(error, 'error'));
			ctx.mostrar(null, { titulo: 'Revisá los datos', texto: error });
			ctx.resultados(null);
			return;
		}
		const res = avisosDeDireccion(dir.v, est.bits10);
		if (res) avisos.append(aviso(res, 'aviso'));
		if (est.rw === 'R' && !lee.bytes.length) avisos.append(aviso('Para una lectura escribí al menos un byte que contesta el esclavo.', 'aviso'));
		const ev = i2c.secuenciaDesdeForm({ dir: dir.v, bits10: est.bits10, rw: est.rw, escribir: esc.bytes, leer: lee.bytes, nackDir: est.nackDir, ultimoNack: est.ultimoNack, sinStop: est.sinStop });
		if (ev.length > MAX_EVENTOS) avisos.append(aviso('La transacción es larga; el dibujo puede quedar muy ancho.', 'aviso'));
		const diagrama = i2c.construirDiagrama(ev, { fHz: est.fHz });
		const texto = i2c.aTexto(ev);
		ctx.mostrar({ m: aVista(diagrama), px: diagrama.pxSugerido, nombre: `i2c-${hex(dir.v)}`, resumen: `I²C · ${texto.length > 70 ? texto.slice(0, 70) + '…' : texto}` });
		ctx.diagrama = diagrama;
		botonEditor.disabled = false;
		const bytes = ev.filter((e) => e.tipo === 'byte').length;
		ctx.resultados(
			h(
				'div',
				{},
				resumenDe([
					['Reloj SCL', fmtFrecuencia(est.fHz)],
					['Bytes en el bus', String(bytes)],
					['Duración', fmtTiempo((bytes * 9) / est.fHz + (ev.filter((e) => e.tipo !== 'byte').length * 1) / est.fHz)],
				]),
				h('p', { class: 'nota' }, 'Notación: ', h('code', {}, texto)),
				h('div', { class: 'fila-botones' }, botonCopiar('Copiar notación', () => texto)),
				tablaEventos(ev),
			),
		);
	}

	function armar() {
		botonEditor = h('button', { type: 'button', class: 'btn btn--chico', disabled: true, onclick: () => ctx.diagrama && ctx.alEditor(ctx.diagrama) }, 'Enviar al editor');
		const ayuda = est.bits10 ? 'Dirección de 10 bits, en hexadecimal (hasta 0x3FF).' : 'Dirección de 7 bits, en hexadecimal. Es la que figura en la hoja de datos (no el byte con R/W).';
		ctx.panel.replaceChildren(
			seccion(
				'Transacción',
				campo('Dirección del esclavo (hex)', textoLinea(est.dir, (v) => ((est.dir = v), cambio()), { placeholder: '50' }), ayuda),
				casilla('Dirección de 10 bits', '', est.bits10, (v) => ((est.bits10 = v), cambio(), rearmar())),
				segmentado(
					[
						['W', 'Escribir', 'El maestro manda datos'],
						['R', 'Leer', 'El esclavo manda datos'],
						['WR', 'Escribir y leer', 'Escribe un registro y lee enseguida con START repetido'],
					],
					est.rw,
					(v) => {
						est.rw = v;
						cambio();
						rearmar();
					},
					'Operación',
				),
				est.rw !== 'R' ? campo(est.rw === 'WR' ? 'Bytes a escribir (por ejemplo el registro)' : 'Bytes a escribir (hex)', areaTexto(est.escribir, (v) => ((est.escribir = v), cambio()), { filas: 2, placeholder: '10 AB' })) : null,
				est.rw !== 'W' ? campo('Bytes que contesta el esclavo (hex)', areaTexto(est.leer, (v) => ((est.leer = v), cambio()), { filas: 2, placeholder: '12 34' })) : null,
				avisos,
			),
			seccion(
				'Opciones',
				casilla('El esclavo no responde', 'NACK en la dirección', est.nackDir, (v) => ((est.nackDir = v), cambio())),
				est.rw !== 'W' ? casilla('El maestro cierra con NACK el último byte leído', 'es lo normal', est.ultimoNack, (v) => ((est.ultimoNack = v), cambio())) : null,
				casilla('No terminar con STOP', 'deja el bus tomado', est.sinStop, (v) => ((est.sinStop = v), cambio())),
				campoFrecuencia('Frecuencia de SCL', est, 'fHz', cambio),
			),
			seccion('Dibujo', h('div', { class: 'fila-botones' }, botonEditor)),
		);
		calcular();
	}
	armar();
	return { redibujar: calcular };
}

// ------------------------------------------------------------------ decodificar (notación de texto)
function decodificar(ctx) {
	const est = conDefectos(ctx.est, { ...BASE, texto: '' });
	const avisos = h('div');
	let area;
	let botonEditor;
	const cambio = porCuadro(() => {
		ctx.guardar();
		calcular();
	});

	function calcular() {
		avisos.replaceChildren();
		const { eventos, avisos: av } = i2c.parsearTexto(est.texto);
		if (!eventos.length) {
			ctx.mostrar(null, { titulo: 'Escribí o pegá la transacción', texto: 'Por ejemplo: S 50 W A 00 A Sr 50 R A FF N P. Si no tenés un ejemplo a mano, tocá "Cargar ejemplo".' });
			ctx.resultados(null);
			return;
		}
		av.forEach((t) => avisos.append(aviso(t, 'aviso')));
		if (eventos[0].tipo !== 'S') avisos.append(aviso('La transacción debería empezar con S (START).', 'aviso'));
		const ult = eventos[eventos.length - 1];
		if (ult.tipo !== 'P') avisos.append(aviso('Falta el P (STOP) al final: el bus quedaría tomado.', 'aviso'));
		const diagrama = i2c.construirDiagrama(eventos.slice(0, MAX_EVENTOS), { fHz: est.fHz });
		ctx.mostrar({ m: aVista(diagrama), px: diagrama.pxSugerido, nombre: 'i2c-leido', resumen: `${eventos.length} elementos` });
		ctx.diagrama = diagrama;
		botonEditor.disabled = false;
		const nacks = eventos.filter((e) => e.tipo === 'byte' && !e.ack).length;
		ctx.resultados(
			h(
				'div',
				{},
				resumenDe([['Bytes', String(eventos.filter((e) => e.tipo === 'byte').length)], ['NACK', String(nacks)], ['Reloj SCL', fmtFrecuencia(est.fHz)]]),
				h('div', { class: 'fila-botones' }, botonCopiar('Copiar notación ordenada', () => i2c.aTexto(eventos))),
				tablaEventos(eventos),
			),
		);
	}

	function armar() {
		botonEditor = h('button', { type: 'button', class: 'btn btn--chico', disabled: true, onclick: () => ctx.diagrama && ctx.alEditor(ctx.diagrama) }, 'Enviar al editor');
		area = areaTexto(est.texto, (v) => ((est.texto = v), cambio()), { filas: 5, placeholder: 'S 50 W A 00 A Sr 50 R A FF N P' });
		ctx.panel.replaceChildren(
			seccion(
				'Transacción',
				area,
				avisos,
				nota('Palabras que se entienden: S (START), Sr (START repetido), P (STOP), A (ACK), N (NACK), W y R. Los bytes van en hexadecimal con dos dígitos. Después de S, "50 W" es la dirección de 7 bits con escritura y "A0" es el byte completo.'),
				h('div', { class: 'fila-botones' },
					h('button', { type: 'button', class: 'btn btn--chico', onclick: () => {
						est.texto = 'S 50 W A 00 A Sr 50 R A 12 A 34 N P';
						area.value = est.texto;
						cambio();
					} }, 'Cargar ejemplo'),
					h('button', { type: 'button', class: 'btn btn--chico', onclick: () => {
						est.texto = '';
						area.value = '';
						cambio();
					} }, 'Borrar'),
				),
			),
			seccion('Dibujo', campoFrecuencia('Frecuencia de SCL', est, 'fHz', cambio), h('div', { class: 'fila-botones' }, botonEditor)),
		);
		calcular();
	}
	armar();
	return { redibujar: calcular };
}

export const I2C = {
	id: 'i2c',
	nombre: 'I²C',
	sub: 'Bus de dos hilos (SDA y SCL) con direcciones.',
	modos: [
		['codificar', 'Codificar', 'Del formulario a la señal'],
		['decodificar', 'Leer texto', 'De la notación S 50 W A … a la señal'],
		['repaso', 'Repaso', 'La norma en una pantalla'],
	],
	montar(modo, ctx) {
		if (modo === 'codificar') return codificar(ctx);
		if (modo === 'decodificar') return decodificar(ctx);
		if (modo === 'repaso') return montarRepaso('i2c', ctx);
		return null;
	},
};

