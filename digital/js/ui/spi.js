// Panel de SPI: codificar palabras en un diagrama (CS, SCLK, MOSI, MISO), decodificar bits recibidos y repasar la norma.
import { bin, hex, FORMATOS, parseBits, parseDatos } from '../bits.js';
import { h, porCuadro } from '../dom.js';
import { aVista, fmtFrecuencia, fmtTiempo } from '../modelo.js';
import * as spi from '../spi.js';
import { aviso, areaTexto, botonCopiar, campo, campoFrecuencia, casilla, conDefectos, fila, nota, numero, resumenDe, selector, seccion, tabla } from './comun.js';
import { montarRepaso } from './repaso.js';

const MAX_PALABRAS = 16;
const BASE = { modo: 0, bits: 8, orden: 'msb', csActivoBajo: true, conCS: true, sclkHz: 1e6 };

/** Texto -> lista de palabras de `bits` bits. { palabras, error } */
export function parsePalabras(txt, formato, bits) {
	const tope = 2 ** bits;
	const digitos = Math.ceil(bits / 4);
	const palabras = [];
	try {
		if (formato === 'ascii') {
			const { bytes, error } = parseDatos(txt, 'ascii');
			if (error) throw new Error(error);
			palabras.push(...bytes);
		} else {
			for (let tok of String(txt ?? '').split(/[\s,;:]+/).filter(Boolean)) {
				if (formato === 'hex') {
					tok = tok.replace(/^0x/i, '');
					if (!tok) continue;
					if (!/^[0-9a-fA-F]+$/.test(tok)) throw new Error(`"${tok}" no es hexadecimal`);
					for (let i = 0; i < tok.length; i += digitos) palabras.push(parseInt(tok.slice(i, i + digitos), 16));
				} else if (formato === 'dec') {
					if (!/^\d+$/.test(tok)) throw new Error(`"${tok}" no es un número decimal`);
					palabras.push(parseInt(tok, 10));
				} else {
					tok = tok.replace(/^0b/i, '');
					if (!/^[01]+$/.test(tok)) throw new Error(`"${tok}" no es binario`);
					for (let i = 0; i < tok.length; i += bits) palabras.push(parseInt(tok.slice(i, i + bits), 2));
				}
			}
		}
		const mala = palabras.find((p) => p >= tope);
		if (mala !== undefined) throw new Error(`${mala} no entra en ${bits} bits (el máximo es ${tope - 1})`);
	} catch (e) {
		return { palabras: [], error: e.message };
	}
	return { palabras, error: null };
}

/** Controles de modo, tamaño de palabra, orden y CS. */
function controlesSpi(est, cambio, rearmar) {
	conDefectos(est, BASE);
	return [
		campo('Modo (CPOL / CPHA)', selector(Object.entries(spi.MODOS).map(([k, t]) => [Number(k), t]), est.modo, (v) => ((est.modo = v), cambio()))),
		fila(
			campo('Bits por palabra', numero(est.bits, (v) => ((est.bits = Math.max(2, Math.min(32, Math.round(v)))), cambio()), { min: 2, max: 32, ancho: '100%' })),
			campo('Sale primero', selector([['msb', 'El más significativo'], ['lsb', 'El menos significativo']], est.orden, (v) => ((est.orden = v), cambio()))),
		),
		casilla('Dibujar la línea CS', '', est.conCS, (v) => ((est.conCS = v), cambio(), rearmar())),
		est.conCS ? campo('CS se activa en', selector([[true, 'Nivel bajo (lo normal)'], [false, 'Nivel alto']], est.csActivoBajo, (v) => ((est.csActivoBajo = v === true || v === 'true'), cambio()))) : null,
	];
}
const opcionesDe = (est) => ({ modo: est.modo, bits: est.bits, orden: est.orden, csActivoBajo: est.csActivoBajo, conCS: est.conCS, sclkHz: est.sclkHz });
const hx = (v, bits) => (v === null || v === undefined ? '—' : `0x${hex(v, Math.ceil(bits / 4))}`);
const bn = (v, bits) => (v === null || v === undefined ? '—' : bin(v, bits));

// ------------------------------------------------------------------ codificar
function codificar(ctx) {
	const est = conDefectos(ctx.est, { ...BASE, formato: 'hex', mosi: 'A5 3C', miso: '5A C3' });
	const avisos = h('div');
	let botonEditor;
	const cambio = porCuadro(() => {
		ctx.guardar();
		calcular();
	});
	const rearmar = () => armar();

	function calcular() {
		avisos.replaceChildren();
		const a = parsePalabras(est.mosi, est.formato, est.bits);
		const b = parsePalabras(est.miso, est.formato, est.bits);
		const error = a.error ? `MOSI: ${a.error}` : b.error ? `MISO: ${b.error}` : null;
		if (error) {
			avisos.append(aviso(error, 'error'));
			ctx.mostrar(null, { titulo: 'No se pudo leer el dato', texto: error });
			ctx.resultados(null);
			return;
		}
		if (!a.palabras.length && !b.palabras.length) {
			ctx.mostrar(null, { titulo: 'Escribí qué enviar', texto: 'Por ejemplo A5 3C en hexadecimal. Si solo escribís MOSI, MISO queda desconectado (Z).' });
			ctx.resultados(null);
			return;
		}
		let mosi = a.palabras;
		let miso = b.palabras.length ? b.palabras : null;
		if (Math.max(mosi.length, miso ? miso.length : 0) > MAX_PALABRAS) {
			avisos.append(aviso(`Se dibujan las primeras ${MAX_PALABRAS} palabras.`, 'aviso'));
			mosi = mosi.slice(0, MAX_PALABRAS);
			miso = miso && miso.slice(0, MAX_PALABRAS);
		}
		const { diagrama, palabras } = spi.construirDiagrama(mosi, miso, opcionesDe(est));
		ctx.mostrar({ m: aVista(diagrama), px: diagrama.pxSugerido, nombre: `spi-modo${est.modo}`, resumen: `SPI modo ${est.modo} · ${palabras.length} palabra${palabras.length === 1 ? '' : 's'} de ${est.bits} bits` });
		ctx.diagrama = diagrama;
		botonEditor.disabled = false;
		const f = est.sclkHz;
		const n = palabras.length;
		ctx.resultados(
			h(
				'div',
				{},
				resumenDe([
					['Reloj SCLK', fmtFrecuencia(f)],
					['Período', fmtTiempo(1 / f)],
					['Cada palabra', fmtTiempo(est.bits / f)],
					['Transacción', fmtTiempo((n * est.bits) / f)],
				]),
				h('div', { class: 'fila-botones' }, botonCopiar('Copiar MOSI', () => palabras.filter((p) => p.mosi !== null).map((p) => hx(p.mosi, est.bits)).join(' ')), miso ? botonCopiar('Copiar MISO', () => palabras.filter((p) => p.miso !== null).map((p) => hx(p.miso, est.bits)).join(' ')) : null),
				tabla(
					[
						{ t: '#', k: (p) => p.n + 1 },
						{ t: 'MOSI hex', k: (p) => hx(p.mosi, est.bits), clase: 'mono' },
						{ t: 'MOSI bin', k: (p) => bn(p.mosi, est.bits), clase: 'mono' },
						{ t: 'MISO hex', k: (p) => hx(p.miso, est.bits), clase: 'mono' },
						{ t: 'MISO bin', k: (p) => bn(p.miso, est.bits), clase: 'mono' },
					],
					palabras,
				),
			),
		);
	}

	function armar() {
		botonEditor = h('button', { type: 'button', class: 'btn btn--chico', disabled: true, onclick: () => ctx.diagrama && ctx.alEditor(ctx.diagrama) }, 'Enviar al editor');
		ctx.panel.replaceChildren(
			seccion(
				'Qué enviar',
				campo('Formato', selector(Object.entries(FORMATOS), est.formato, (v) => ((est.formato = v), cambio()))),
				campo('MOSI (maestro → esclavo)', areaTexto(est.mosi, (v) => ((est.mosi = v), cambio()), { filas: 2, placeholder: 'A5 3C' })),
				campo('MISO (esclavo → maestro, opcional)', areaTexto(est.miso, (v) => ((est.miso = v), cambio()), { filas: 2, placeholder: 'vacío = desconectado' })),
				avisos,
				nota('Cada palabra es una transferencia de ese ancho. Con más de 8 bits escribí los números con todos sus dígitos (por ejemplo 12AB para 16 bits).'),
			),
			seccion('Bus', ...controlesSpi(est, cambio, rearmar), campoFrecuencia('Frecuencia de SCLK', est, 'sclkHz', cambio)),
			seccion('Dibujo', h('div', { class: 'fila-botones' }, botonEditor)),
		);
		calcular();
	}
	armar();
	return { redibujar: calcular };
}

// ------------------------------------------------------------------ decodificar
function decodificar(ctx) {
	const est = conDefectos(ctx.est, { ...BASE, bitsMosi: '', bitsMiso: '' });
	const avisos = h('div');
	let botonEditor;
	let areaMosi;
	let areaMiso;
	const cambio = porCuadro(() => {
		ctx.guardar();
		calcular();
	});
	const rearmar = () => armar();

	const aPalabras = (txt, bits, orden) => {
		const b = parseBits(txt);
		const out = [];
		for (let i = 0; i + bits <= b.length; i += bits) {
			const g = b.slice(i, i + bits);
			if (orden === 'lsb') g.reverse();
			out.push(g.reduce((acc, x) => acc * 2 + x, 0));
		}
		return { palabras: out, sobran: b.length % bits, total: b.length };
	};

	function calcular() {
		avisos.replaceChildren();
		for (const t of [est.bitsMosi, est.bitsMiso]) {
			if (/[^01\s,._|-]/.test(t)) {
				avisos.append(aviso('Solo se aceptan unos y ceros (los espacios y las comas se ignoran).', 'error'));
				ctx.mostrar(null, { titulo: 'Hay caracteres que no son bits', texto: 'Solo 0 y 1.' });
				ctx.resultados(null);
				return;
			}
		}
		const a = aPalabras(est.bitsMosi, est.bits, est.orden);
		const b = aPalabras(est.bitsMiso, est.bits, est.orden);
		if (!a.palabras.length && !b.palabras.length) {
			ctx.mostrar(null, { titulo: 'Pegá los bits de MOSI y/o de MISO', texto: `Un dígito por bit, en el orden del cable; se agrupan de a ${est.bits}. Si no tenés un ejemplo a mano, tocá "Cargar ejemplo".` });
			ctx.resultados(null);
			return;
		}
		for (const [nombre, x] of [['MOSI', a], ['MISO', b]]) if (x.sobran) avisos.append(aviso(`${nombre}: sobran ${x.sobran} bit${x.sobran === 1 ? '' : 's'} que no completan una palabra de ${est.bits}.`, 'aviso'));
		if (a.palabras.length && b.palabras.length && a.palabras.length !== b.palabras.length) avisos.append(aviso('MOSI y MISO tienen distinta cantidad de palabras: en SPI se transfieren al mismo tiempo.', 'aviso'));
		let mosi = a.palabras;
		let miso = b.palabras.length ? b.palabras : null;
		const largo = Math.max(mosi.length, miso ? miso.length : 0);
		if (largo > MAX_PALABRAS) {
			avisos.append(aviso(`Se dibujan las primeras ${MAX_PALABRAS} palabras (la tabla muestra todas).`, 'aviso'));
		}
		const { diagrama } = spi.construirDiagrama(mosi.slice(0, MAX_PALABRAS), miso && miso.slice(0, MAX_PALABRAS), opcionesDe(est));
		ctx.mostrar({ m: aVista(diagrama), px: diagrama.pxSugerido, nombre: 'spi-recibido', resumen: `${largo} palabra${largo === 1 ? '' : 's'} de ${est.bits} bits` });
		ctx.diagrama = diagrama;
		botonEditor.disabled = false;
		const filas = Array.from({ length: largo }, (_, i) => ({ n: i + 1, mosi: mosi[i] ?? null, miso: miso ? (miso[i] ?? null) : null }));
		ctx.resultados(
			h(
				'div',
				{},
				resumenDe([['Palabras', String(largo)], ['Bits por palabra', String(est.bits)]]),
				h('div', { class: 'fila-botones' }, mosi.length ? botonCopiar('Copiar MOSI', () => mosi.map((p) => hx(p, est.bits)).join(' ')) : null, miso ? botonCopiar('Copiar MISO', () => miso.map((p) => hx(p, est.bits)).join(' ')) : null),
				tabla(
					[
						{ t: '#', k: 'n' },
						{ t: 'MOSI hex', k: (p) => hx(p.mosi, est.bits), clase: 'mono' },
						{ t: 'Dec', k: (p) => (p.mosi === null ? '—' : String(p.mosi)), clase: 'mono' },
						{ t: 'MISO hex', k: (p) => hx(p.miso, est.bits), clase: 'mono' },
						{ t: 'Dec', k: (p) => (p.miso === null ? '—' : String(p.miso)), clase: 'mono' },
					],
					filas,
				),
			),
		);
	}

	function armar() {
		botonEditor = h('button', { type: 'button', class: 'btn btn--chico', disabled: true, onclick: () => ctx.diagrama && ctx.alEditor(ctx.diagrama) }, 'Enviar al editor');
		areaMosi = areaTexto(est.bitsMosi, (v) => ((est.bitsMosi = v), cambio()), { filas: 3, placeholder: '1010 0101 0011 1100' });
		areaMiso = areaTexto(est.bitsMiso, (v) => ((est.bitsMiso = v), cambio()), { filas: 3, placeholder: 'opcional' });
		ctx.panel.replaceChildren(
			seccion(
				'Bits recibidos',
				campo('MOSI', areaMosi),
				campo('MISO (opcional)', areaMiso),
				avisos,
				nota('Un bit por pulso de reloj, ya muestreados (no hace falta saber el modo para esto). Se agrupan de a la cantidad de bits de cada palabra.'),
				h('div', { class: 'fila-botones' },
					h('button', { type: 'button', class: 'btn btn--chico', onclick: () => {
						const pal = (arr) => arr.map((v) => bin(v, est.bits)).join(' ');
						est.bitsMosi = est.orden === 'msb' ? pal([0xa5, 0x3c]) : pal([0xa5, 0x3c].map((v) => parseInt(bin(v, 8).split('').reverse().join(''), 2)));
						est.bitsMiso = est.orden === 'msb' ? pal([0x5a, 0xc3]) : pal([0x5a, 0xc3].map((v) => parseInt(bin(v, 8).split('').reverse().join(''), 2)));
						est.bits = 8;
						armar();
						ctx.guardar();
					} }, 'Cargar ejemplo'),
					h('button', { type: 'button', class: 'btn btn--chico', onclick: () => {
						est.bitsMosi = est.bitsMiso = '';
						armar();
						ctx.guardar();
					} }, 'Borrar'),
				),
			),
			seccion('Formato', ...controlesSpi(est, cambio, rearmar), nota('El modo solo cambia el dibujo; los bits ya vienen muestreados.')),
			seccion('Resultado', h('div', { class: 'fila-botones' }, botonEditor)),
		);
		calcular();
	}
	armar();
	return { redibujar: calcular };
}

export const SPI = {
	id: 'spi',
	nombre: 'SPI',
	sub: 'Bus serie sincrónico con selección de esclavo (CS).',
	modos: [
		['codificar', 'Codificar', 'De las palabras al diagrama'],
		['decodificar', 'Decodificar', 'De los bits a las palabras'],
		['repaso', 'Repaso', 'La norma en una pantalla'],
	],
	montar(modo, ctx) {
		if (modo === 'codificar') return codificar(ctx);
		if (modo === 'decodificar') return decodificar(ctx);
		if (modo === 'repaso') return montarRepaso('spi', ctx);
		return null;
	},
};
