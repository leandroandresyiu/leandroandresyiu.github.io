// Controles de los parámetros de una línea UART: los comparten Codificar, Decodificar y Osciloscopio.
import { BAUDIOS_COMUNES, PARIDADES } from '../uart.js';
import { campo, casilla, conDefectos, fila, numero, selector } from './comun.js';

export const BASE_UART = { baud: 9600, baudOtro: false, datos: 8, paridad: 'N', stop: 1, orden: 'lsb', invertida: false };

export function controlesUart(est, { cambio, rearmar, conBaud = true }) {
	conDefectos(est, BASE_UART);
	const baudios = conBaud
		? [
				campo('Velocidad (baudios)', selector([...BAUDIOS_COMUNES.map((b) => [b, b.toLocaleString('es-AR')]), ['otro', 'Otra…']], est.baudOtro ? 'otro' : est.baud, (v) => {
					if (v === 'otro') est.baudOtro = true;
					else {
						est.baudOtro = false;
						est.baud = v;
					}
					cambio();
					rearmar();
				})),
				est.baudOtro ? campo('Baudios', numero(est.baud, (v) => ((est.baud = Math.max(1, Math.round(v))), cambio()), { min: 1, max: 50e6 })) : null,
			]
		: [];
	return [
		...baudios,
		fila(
			campo('Bits de datos', selector([5, 6, 7, 8, 9].map((n) => [n, String(n)]), est.datos, (v) => ((est.datos = v), cambio()))),
			campo('Bits de stop', selector([[1, '1'], [1.5, '1,5'], [2, '2']], est.stop, (v) => ((est.stop = v), cambio()))),
		),
		fila(
			campo('Paridad', selector(Object.entries(PARIDADES), est.paridad, (v) => ((est.paridad = v), cambio()))),
			campo('Bit que sale primero', selector([['lsb', 'El menos significativo (lo normal)'], ['msb', 'El más significativo']], est.orden, (v) => ((est.orden = v), cambio()))),
		),
		casilla('Línea invertida', 'reposo en 0 (RS-232 visto en el cable)', est.invertida, (v) => ((est.invertida = v), cambio())),
	];
}
