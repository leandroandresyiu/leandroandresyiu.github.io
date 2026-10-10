// Capturas de osciloscopio de ejemplo (sintéticas): sirven para probar la herramienta sin tener un archivo a mano.
// Se arman con los mismos codificadores de Digital, se suaviza el pasaje de un nivel al otro (tiempo de subida)
// y se agrega un poco de ruido, para que el decodificador trabaje como con una captura real.
import { nivelEn, senalDesdeBits } from './bits.js';
import * as can from './can.js';
import * as i2c from './i2c.js';
import * as spi from './spi.js';
import * as uart from './uart.js';

const aBits = (celdas) => celdas.map((c) => (c === '1' ? 1 : 0));

function azarSemilla(n) {
	let a = n >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Señal por flancos -> muestras (volts) con tiempo de subida (filtro RC) y ruido. */
export function analogico(sig, { t0, dt, n, bajo = 0, alto = 3.3, subida = 20e-9, ruido = 0.03, semilla = 7 }) {
	const azar = azarSemilla(semilla);
	const gauss = () => Math.sqrt(-2 * Math.log(1 - azar())) * Math.cos(2 * Math.PI * azar());
	const v = new Float64Array(n);
	const a = 1 - Math.exp(-dt / (subida / 2.2));
	let y = nivelEn(sig, t0) ? alto : bajo;
	for (let i = 0; i < n; i++) {
		const objetivo = nivelEn(sig, t0 + i * dt) ? alto : bajo;
		y += (objetivo - y) * a;
		v[i] = y + ruido * gauss();
	}
	return v;
}

/** Texto CSV con el formato de un Rigol DS1000Z (X, CH1…, Start, Increment). */
export function csvRigol(canales, t0, dt) {
	const n = canales[0].length;
	const cab = ['X', ...canales.map((_, i) => `CH${i + 1}`), 'Start', 'Increment'].join(',') + ',';
	const par = ['Sequence', ...canales.map(() => 'Volt'), t0.toExponential(6), dt.toExponential(6)].join(',') + ',';
	const filas = new Array(n);
	for (let i = 0; i < n; i++) filas[i] = [i, ...canales.map((c) => c[i].toFixed(3)), '', ''].join(',') + ',';
	return [cab, par, ...filas].join('\n');
}

const EJEMPLOS = {
	uart() {
		const baud = 9600;
		const bytes = [...'Hola kumOS\r\n'].map((c) => c.charCodeAt(0));
		const { diagrama } = uart.construirDiagrama(bytes, { reposoIni: 8, reposoFin: 8 });
		const Tt = 1 / (2 * baud);
		const dt = 2e-6;
		const n = Math.round((diagrama.ticks * Tt + 300e-6) / dt);
		const v = analogico(senalDesdeBits(aBits(diagrama.senales[0].celdas), Tt, 150e-6), { t0: 0, dt, n, subida: 12e-6 });
		return { texto: csvRigol([v], -150e-6, dt), nombre: 'ejemplo-uart.csv' };
	},
	spi() {
		const o = { modo: 0, bits: 8, orden: 'msb', sclkHz: 1e6 };
		const { diagrama } = spi.construirDiagrama([0x9f, 0x00, 0x00, 0x00], [0xff, 0xef, 0x40, 0x18], o);
		const Tt = 1 / (2 * o.sclkHz);
		const dt = 5e-8;
		const n = Math.round((diagrama.ticks * Tt + 20e-6) / dt);
		const por = (nombre, k) => analogico(senalDesdeBits(aBits(diagrama.senales.find((x) => x.nombre === nombre).celdas), Tt, 10e-6), { t0: 0, dt, n, subida: 15e-9, semilla: k });
		return { texto: csvRigol([por('CS', 1), por('SCLK', 2), por('MOSI', 3), por('MISO', 4)], -10e-6, dt), nombre: 'ejemplo-spi.csv' };
	},
	i2c() {
		const ev = i2c.secuenciaDesdeForm({ dir: 0x68, rw: 'WR', escribir: [0x75], leer: [0x68] });
		const d = i2c.construirDiagrama(ev, { fHz: 100000 });
		const Tt = 1 / (4 * 100000);
		const dt = 2e-7;
		const n = Math.round((d.ticks * Tt + 80e-6) / dt);
		const por = (k, s) => analogico(senalDesdeBits(aBits(d.senales[k].celdas), Tt, 40e-6), { t0: 0, dt, n, subida: 300e-9, semilla: s });
		return { texto: csvRigol([por(1, 1), por(0, 2)], -40e-6, dt), nombre: 'ejemplo-i2c.csv' }; // CH1 = SDA, CH2 = SCL
	},
	can() {
		const tramas = [{ id: 0x123, datos: [0xde, 0xad, 0xbe, 0xef] }, { id: 0x7e8, datos: [0x03, 0x41, 0x0c, 0x1a, 0xf8] }, { id: 0x18daf110, ext: true, datos: [0x02, 0x10, 0x03] }];
		const bits = Array(12).fill(1);
		for (const f of tramas) bits.push(...can.codificar(f).bits);
		bits.push(...Array(12).fill(1));
		const T = 1 / 500000;
		const dt = 1e-7;
		const n = Math.round((bits.length * T + 60e-6) / dt);
		const v = analogico(senalDesdeBits(bits, T, 30e-6), { t0: 0, dt, n, subida: 100e-9 });
		return { texto: csvRigol([v], -30e-6, dt), nombre: 'ejemplo-can.csv' };
	},
};

export const ejemploCSV = (id) => EJEMPLOS[id]();
