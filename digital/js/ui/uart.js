// Panel de UART: codificar bytes en una trama, decodificar una cadena de bits y repasar la norma.
import { car, hex, FORMATOS, parseBits, parseDatos } from '../bits.js';
import { h, porCuadro } from '../dom.js';
import { aVista, fmtTiempo } from '../modelo.js';
import { construirDiagrama, decodificarBits, diagramaDeBits } from '../uart.js';
import { aviso, areaTexto, botonCopiar, campo, casilla, chip, conDefectos, hexLista, nota, numero, resumenDe, selector, seccion, tabla } from './comun.js';
import { montarRepaso } from './repaso.js';
import { BASE_UART, controlesUart } from './uart-controles.js';

const MAX_DIBUJADOS = 64;
const BASE = BASE_UART;

const opcionesDe = (est) => ({ baud: est.baud, datos: est.datos, paridad: est.paridad, stop: est.stop, orden: est.orden, invertida: est.invertida });
const nombreConfig = (est) => `${est.datos}${est.paridad === 'N' ? 'N' : est.paridad}${est.stop === 1.5 ? '1.5' : est.stop}`;
const asciiDe = (v, datos) => (datos <= 8 ? car(v) : '');

// ------------------------------------------------------------------ codificar
function codificar(ctx) {
	const est = conDefectos(ctx.est, { ...BASE, formato: 'ascii', texto: 'Hola', entre: 0, marcas: true });
	const avisos = h('div');
	const cambio = porCuadro(() => {
		ctx.guardar();
		calcular();
	});
	const rearmar = () => armar();

	function calcular() {
		avisos.replaceChildren();
		const { bytes, error } = parseDatos(est.texto, est.formato);
		if (error) {
			avisos.append(aviso(error, 'error'));
			ctx.mostrar(null, { titulo: 'No se pudo leer el dato', texto: error });
			ctx.resultados(null);
			return;
		}
		if (!bytes.length) {
			ctx.mostrar(null, { titulo: 'Escribí algo para enviar', texto: 'Por ejemplo "Hola" en texto, o 41 42 en hexadecimal.' });
			ctx.resultados(null);
			return;
		}
		const mascara = (1 << est.datos) - 1;
		if (est.datos < 8 && bytes.some((b) => b > mascara)) avisos.append(aviso(`Con ${est.datos} bits de datos solo se envían los ${est.datos} bits de menor peso de cada byte.`, 'aviso'));
		if (bytes.length > MAX_DIBUJADOS) avisos.append(aviso(`Se dibujan los primeros ${MAX_DIBUJADOS} bytes de ${bytes.length}.`, 'aviso'));
		const { diagrama, tramas } = construirDiagrama(bytes.slice(0, MAX_DIBUJADOS), { ...opcionesDe(est), reposoEntre: est.entre, marcas: est.marcas });
		ctx.mostrar({ m: aVista(diagrama), px: diagrama.pxSugerido, nombre: `uart-${est.baud}-${nombreConfig(est)}`, resumen: `${bytes.length} byte${bytes.length === 1 ? '' : 's'} · ${est.baud} baudios · ${nombreConfig(est)}` });
		ctx.diagrama = diagrama;
		botonEditor.disabled = false;

		const bitsTrama = 1 + est.datos + (est.paridad === 'N' ? 0 : 1) + est.stop;
		const tBit = 1 / est.baud;
		const total = (bitsTrama * bytes.length + est.entre * (bytes.length - 1)) * tBit;
		const filas = tramas.map((t) => ({
			n: t.n + 1,
			hex: '0x' + hex(t.valor, Math.ceil(est.datos / 4)),
			dec: String(t.valor),
			asc: asciiDe(t.valor, est.datos),
			bits: [`0`, t.bits.slice(1, 1 + est.datos).join(''), t.paridad !== null ? String(t.paridad) : null, '1'].filter((x) => x !== null).join(' '),
		}));
		ctx.resultados(
			h(
				'div',
				{},
				resumenDe([
					['Tiempo de un bit', fmtTiempo(tBit)],
					['Bits por trama', `${bitsTrama.toString().replace('.', ',')}`],
					['Duración de la trama', fmtTiempo(bitsTrama * tBit)],
					['Total', fmtTiempo(total)],
					['Velocidad útil', `${Math.round(est.baud / bitsTrama).toLocaleString('es-AR')} bytes/s`],
				]),
				h('div', { class: 'fila-botones' }, botonCopiar('Copiar hex', () => hexLista(bytes)), botonCopiar('Copiar bits', () => filas.map((f) => f.bits).join('  '))),
				tabla(
					[
						{ t: '#', k: 'n' },
						{ t: 'Hex', k: 'hex', clase: 'mono' },
						{ t: 'Dec', k: 'dec', clase: 'mono' },
						{ t: 'ASCII', k: 'asc', clase: 'mono' },
						{ t: 'Bits en la línea (START · datos · paridad · STOP)', k: 'bits', clase: 'mono nowrap' },
					],
					filas,
				),
			),
		);
	}

	let botonEditor;
	function armar() {
		botonEditor = h('button', { type: 'button', class: 'btn btn--chico', disabled: true, onclick: () => ctx.diagrama && ctx.alEditor(ctx.diagrama) }, 'Enviar al editor');
		ctx.panel.replaceChildren(
			seccion(
				'Qué enviar',
				campo('Formato', selector(Object.entries(FORMATOS), est.formato, (v) => ((est.formato = v), cambio()))),
				areaTexto(est.texto, (v) => ((est.texto = v), cambio()), { filas: 3, placeholder: est.formato === 'ascii' ? 'Hola mundo' : est.formato === 'hex' ? '48 6F 6C 61' : est.formato === 'dec' ? '72 111 108 97' : '01001000 01101111' }),
				avisos,
				est.formato === 'ascii' ? nota('Se pueden usar \\n, \\r, \\t y \\x41 para caracteres especiales.') : null,
			),
			seccion('Línea', ...controlesUart(est, { cambio, rearmar })),
			seccion(
				'Dibujo',
				campo('Reposo entre bytes (bits)', numero(est.entre, (v) => ((est.entre = Math.max(0, Math.min(50, Math.round(v)))), cambio()), { min: 0, max: 50, ancho: '100%' })),
				casilla('Marcar dónde muestrea el receptor', 'círculos rojos', est.marcas, (v) => ((est.marcas = v), cambio())),
				h('div', { class: 'fila-botones' }, botonEditor),
			),
		);
		calcular();
	}
	armar();
	return { redibujar: calcular };
}

// ------------------------------------------------------------------ decodificar
function ejemploBits(est) {
	const { diagrama } = construirDiagrama([...'Hi'].map((c) => c.charCodeAt(0)), { ...opcionesDe(est), reposoIni: 2, reposoFin: 2 });
	return diagrama.senales[0].celdas
		.filter((_, i) => i % 2 === 0)
		.join('')
		.replace(/(.{8})/g, '$1 ')
		.trim();
}

function decodificar(ctx) {
	const est = conDefectos(ctx.est, { ...BASE, bits: '', k: 1 });
	const avisos = h('div');
	let area;
	const cambio = porCuadro(() => {
		ctx.guardar();
		calcular();
	});
	const rearmar = () => armar();

	function calcular() {
		avisos.replaceChildren();
		if (/[^01\s,._|-]/.test(est.bits)) {
			avisos.append(aviso('Solo se aceptan unos y ceros (los espacios y las comas se ignoran). Para texto o hexadecimal usá la pestaña Codificar.', 'error'));
			ctx.mostrar(null, { titulo: 'Hay caracteres que no son bits', texto: 'Solo 0 y 1.' });
			ctx.resultados(null);
			return;
		}
		const bits = parseBits(est.bits);
		if (bits.length < 2) {
			ctx.mostrar(null, { titulo: 'Pegá los bits que recibís', texto: 'Una muestra por bit, en el orden en que aparecen en la línea. Si no tenés un ejemplo a mano, tocá "Cargar ejemplo".' });
			ctx.resultados(null);
			return;
		}
		const k = Math.max(1, Math.min(64, Math.round(est.k)));
		const tramas = decodificarBits(bits, opcionesDe(est), k);
		const { diagrama, truncado } = diagramaDeBits(bits, k, tramas, opcionesDe(est));
		if (truncado) avisos.append(aviso('La cadena es larga: se dibujan solo los primeros bits (la tabla muestra todas las tramas).', 'aviso'));
		ctx.mostrar({ m: aVista(diagrama), px: diagrama.pxSugerido, nombre: `uart-recibido`, resumen: `${tramas.length} trama${tramas.length === 1 ? '' : 's'} en ${bits.length} muestras` });
		ctx.diagrama = diagrama;
		botonEditor.disabled = false;
		if (!tramas.length) {
			ctx.resultados(h('div', {}, aviso('No se encontró ninguna trama: busco un flanco de bajada (START) seguido de los bits configurados y un STOP en 1. Revisá los baudios (muestras por bit), los bits de datos, la paridad y si la línea está invertida.', 'aviso')));
			return;
		}
		const malas = tramas.filter((t) => t.error).length;
		const texto = tramas.map((t) => (t.error ? '·' : car(t.valor))).join('');
		const filas = tramas.map((t, i) => ({
			n: i + 1,
			clase: t.error ? 'mala' : '',
			hex: '0x' + hex(t.valor, Math.ceil(est.datos / 4)),
			dec: String(t.valor),
			asc: asciiDe(t.valor, est.datos),
			bits: t.bits.join(''),
			estado: t.error ? chip(t.error === 'paridad' ? 'error de paridad' : t.error === 'stop' ? 'STOP no es 1' : t.error, 'mal') : chip('correcta', 'ok'),
			pos: `bit ${Math.round(t.t0 * 100) / 100}`,
		}));
		ctx.resultados(
			h(
				'div',
				{},
				resumenDe([
					['Tramas', String(tramas.length)],
					['Con error', String(malas)],
					est.datos <= 8 ? ['Texto', texto.length > 60 ? texto.slice(0, 60) + '…' : texto] : null,
				]),
				h('div', { class: 'fila-botones' }, botonCopiar('Copiar hex', () => hexLista(tramas.map((t) => t.valor))), est.datos <= 8 ? botonCopiar('Copiar texto', () => String.fromCharCode(...tramas.map((t) => t.valor))) : null),
				tabla(
					[
						{ t: '#', k: 'n' },
						{ t: 'Hex', k: 'hex', clase: 'mono' },
						{ t: 'Dec', k: 'dec', clase: 'mono' },
						{ t: 'ASCII', k: 'asc', clase: 'mono' },
						{ t: 'Bits (en el orden recibido)', k: 'bits', clase: 'mono' },
						{ t: 'Posición', k: 'pos', clase: 'mono nowrap' },
						{ t: 'Estado', k: 'estado' },
					],
					filas,
				),
			),
		);
	}

	let botonEditor;
	function armar() {
		botonEditor = h('button', { type: 'button', class: 'btn btn--chico', disabled: true, onclick: () => ctx.diagrama && ctx.alEditor(ctx.diagrama) }, 'Enviar al editor');
		area = areaTexto(est.bits, (v) => ((est.bits = v), cambio()), { filas: 5, placeholder: '1 0 1 0 0 0 0 0 1 0 1 1 …' });
		ctx.panel.replaceChildren(
			seccion(
				'Bits recibidos',
				area,
				avisos,
				nota('Un bit por muestra, en el orden en que pasan por la línea. Se buscan tramas con el START en 0 (o en 1 si la línea está invertida).'),
				h('div', { class: 'fila-botones' }, h('button', { type: 'button', class: 'btn btn--chico', onclick: () => {
					est.bits = ejemploBits(est);
					area.value = est.bits;
					cambio();
				} }, 'Cargar ejemplo'), h('button', { type: 'button', class: 'btn btn--chico', onclick: () => {
					est.bits = '';
					area.value = '';
					cambio();
				} }, 'Borrar')),
			),
			seccion(
				'Línea',
				campo('Muestras por bit', numero(est.k, (v) => ((est.k = Math.max(1, Math.min(64, Math.round(v)))), cambio()), { min: 1, max: 64, ancho: '100%' }), 'Con 1, cada dígito es un bit. Si la captura está sobremuestreada (por ejemplo 8 muestras por bit), ponelo acá.'),
				...controlesUart(est, { cambio, rearmar }),
			),
			seccion('Resultado', h('div', { class: 'fila-botones' }, botonEditor)),
		);
		calcular();
	}
	armar();
	return { redibujar: calcular };
}

export const UART = {
	id: 'uart',
	nombre: 'UART',
	sub: 'Comunicación serie asincrónica (RS-232, RS-485, USB-serie).',
	modos: [
		['codificar', 'Codificar', 'Del dato a la trama'],
		['decodificar', 'Decodificar', 'De la trama al dato'],
		['repaso', 'Repaso', 'La norma en una pantalla'],
	],
	montar(modo, ctx) {
		if (modo === 'codificar') return codificar(ctx);
		if (modo === 'decodificar') return decodificar(ctx);
		if (modo === 'repaso') return montarRepaso('uart', ctx);
		return null;
	},
};

