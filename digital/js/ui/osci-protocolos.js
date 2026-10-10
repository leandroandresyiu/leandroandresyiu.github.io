// Qué hace cada protocolo con una captura del osciloscopio: qué canales pide, cómo se decodifica y cómo se anota.
// Cada "analizar" devuelve lo que el motor (osciloscopio.js) dibuja y lista:
//   { T, titulo, filas: [{ nombre, canal? | segs? }], campos, marcas: [{ t, fila }], items, columnas, resumen, avisos, vacio? }
import { car, hex } from '../bits.js';
import * as can from '../can.js';
import * as i2c from '../i2c.js';
import { fmtFrecuencia, fmtTiempo } from '../modelo.js';
import * as spi from '../spi.js';
import * as uart from '../uart.js';
import { campo, chip, fila, nota, numero, segmentado, selector } from './comun.js';
import { controlesUart } from './uart-controles.js';

const mediana = (a) => {
	if (!a.length) return 0;
	const s = a.slice().sort((x, y) => x - y);
	return s[Math.floor(s.length / 2)];
};
const hx = (v, bits = 8) => `0x${hex(v, Math.ceil(bits / 4))}`;
const inicio = (csv, t) => fmtTiempo(t - csv.t0);

// ------------------------------------------------------------------ UART
const UART = {
	titulo: 'UART',
	ventanas: [20, 30, 60, 120, 300],
	ventanaBits: 30,
	defecto: { baudAuto: true, baud: 9600, baudOtro: false, datos: 8, paridad: 'N', stop: 1, orden: 'lsb', invertida: false },
	canales: () => [{ clave: 'rx', etiqueta: 'Línea de datos' }],
	controles(est, { cambio, rearmar }) {
		const lista = [['auto', 'Automática (se mide en la captura)'], ...uart.BAUDIOS_COMUNES.map((b) => [b, b.toLocaleString('es-AR')]), ['otro', 'Otra…']];
		const valor = est.baudAuto ? 'auto' : est.baudOtro ? 'otro' : est.baud;
		return [
			campo('Velocidad (baudios)', selector(lista, valor, (v) => {
				if (v === 'auto') est.baudAuto = true;
				else {
					est.baudAuto = false;
					est.baudOtro = v === 'otro';
					if (v !== 'otro') est.baud = v;
				}
				cambio();
				rearmar();
			})),
			!est.baudAuto && est.baudOtro ? campo('Baudios', numero(est.baud, (v) => ((est.baud = Math.max(1, Math.round(v))), cambio()), { min: 1, max: 50e6 })) : null,
			...controlesUart(est, { cambio, rearmar, conBaud: false }),
		];
	},
	analizar({ sigs, est, csv }) {
		const s = sigs.rx;
		const avisos = [];
		let baud = est.baud;
		if (est.baudAuto) {
			const e = uart.estimarBaudios(s.sig);
			if (!e) return { vacio: 'No hay suficientes flancos para medir la velocidad: revisá el canal elegido y el umbral.' };
			baud = e.baud;
			if (!e.exacto) avisos.push(`La velocidad medida (${Math.round(e.medido).toLocaleString('es-AR')} baudios) no coincide con ninguna estándar; se usa tal cual. Si no decodifica bien, elegí la velocidad a mano.`);
		}
		const T = 1 / baud;
		const o = { baud, datos: est.datos, paridad: est.paridad, stop: est.stop, orden: est.orden, invertida: est.invertida };
		const tr = uart.decodificar(s.sig, T, o, { t0: csv.t0, t1: csv.t0 + csv.duracion });
		const campos = [];
		const marcas = [];
		const bus = [];
		tr.forEach((f, n) => {
			campos.push(...uart.camposDeTrama({ ...f, t0: f.t0 / T }, o, T));
			const nb = 1 + o.datos + (f.paridad ? 1 : 0) + Math.ceil(o.stop);
			for (let i = 0; i < nb; i++) marcas.push({ t: f.t0 + (i + 0.5) * T, fila: 0 });
			bus.push({ a: f.t0 + T, b: f.t0 + (1 + o.datos) * T, v: 'd', d: uart.etiquetaValor(f.valor, o.datos) + (f.error ? ' ✗' : ''), k: n });
		});
		const malas = tr.filter((f) => f.error).length;
		const items = tr.map((f, i) => ({
			t0: f.t0,
			t1: f.t1,
			n: i + 1,
			inicio: inicio(csv, f.t0),
			hex: hx(f.valor, o.datos),
			dec: String(f.valor),
			asc: o.datos <= 8 ? car(f.valor) : '',
			estado: f.error ? chip(f.error === 'paridad' ? 'error de paridad' : f.error === 'stop' ? 'STOP no es 1' : f.error, 'mal') : chip('correcta', 'ok'),
			clase: f.error ? 'mala' : '',
		}));
		return {
			T,
			titulo: `UART ${baud.toLocaleString('es-AR')} baudios · ${o.datos}${o.paridad === 'N' ? 'N' : o.paridad}${o.stop}`,
			rejilla: true,
			filas: [{ nombre: 'RX', canal: 'rx' }, { nombre: 'Dato', segs: bus }],
			campos,
			marcas,
			items,
			columnas: [
				{ t: '#', k: 'n' },
				{ t: 'Inicio', k: 'inicio', clase: 'mono nowrap' },
				{ t: 'Hex', k: 'hex', clase: 'mono' },
				{ t: 'Dec', k: 'dec', clase: 'mono' },
				{ t: 'ASCII', k: 'asc', clase: 'mono' },
				{ t: 'Estado', k: 'estado' },
			],
			resumen: [['Velocidad', `${baud.toLocaleString('es-AR')} baudios${est.baudAuto ? ' (medida)' : ''}`], ['Tiempo de bit', fmtTiempo(T)], ['Tramas', String(tr.length)], ['Con error', String(malas)], o.datos <= 8 && tr.length ? ['Texto', tr.map((f) => (f.error ? '·' : car(f.valor))).join('').slice(0, 60)] : null],
			avisos,
			vacio: tr.length ? null : 'No se encontró ninguna trama. Revisá la velocidad, los bits de datos, la paridad, la polaridad (línea invertida) y el umbral.',
			texto: tr.length ? () => String.fromCharCode(...tr.map((f) => f.valor)) : null,
		};
	},
};

// ------------------------------------------------------------------ SPI
const SPI = {
	titulo: 'SPI',
	ventanas: [16, 24, 48, 96, 256],
	ventanaBits: 24,
	defecto: { modo: 0, bits: 8, orden: 'msb', csActivoBajo: true },
	canales: () => [
		{ clave: 'cs', etiqueta: 'CS (selección)', opcional: true },
		{ clave: 'sclk', etiqueta: 'SCLK (reloj)' },
		{ clave: 'mosi', etiqueta: 'MOSI (maestro → esclavo)' },
		{ clave: 'miso', etiqueta: 'MISO (esclavo → maestro)', opcional: true },
	],
	controles(est, { cambio }) {
		return [
			campo('Modo (CPOL / CPHA)', selector(Object.entries(spi.MODOS).map(([k, t]) => [Number(k), t]), est.modo, (v) => ((est.modo = v), cambio()))),
			fila(
				campo('Bits por palabra', numero(est.bits, (v) => ((est.bits = Math.max(2, Math.min(32, Math.round(v)))), cambio()), { min: 2, max: 32, ancho: '100%' })),
				campo('Sale primero', selector([['msb', 'El más significativo'], ['lsb', 'El menos significativo']], est.orden, (v) => ((est.orden = v), cambio()))),
			),
			campo('CS se activa en', selector([[true, 'Nivel bajo (lo normal)'], [false, 'Nivel alto']], est.csActivoBajo, (v) => ((est.csActivoBajo = v === true || v === 'true'), cambio()))),
		];
	},
	analizar({ sigs, est, csv }) {
		const { sclk, mosi, miso, cs } = sigs;
		const avisos = [];
		const o = { modo: est.modo, bits: est.bits, orden: est.orden, csActivoBajo: est.csActivoBajo };
		const tr = spi.decodificar({ sclk: sclk.sig, mosi: mosi.sig, miso: miso ? miso.sig : undefined, cs: cs ? cs.sig : undefined }, o, { t0: csv.t0, t1: csv.t0 + csv.duracion });
		const muestras = tr.flatMap((t) => t.palabras.flatMap((w) => w.tMuestras || []));
		const dif = muestras.slice(1).map((t, i) => t - muestras[i]);
		const tip = mediana(dif);
		const gaps = dif.filter((g) => g > 0 && g < tip * 3);
		const Tclk = mediana(gaps) || mediana(sclk.sig.t.slice(1).map((t, i) => t - sclk.sig.t[i])) * 2 || 1e-6;
		// ¿el reloj reposa en el nivel que dice el modo?
		const reposo = sclk.sig.v0;
		if (reposo !== (est.modo >> 1)) avisos.push(`El reloj reposa en ${reposo ? 'alto' : 'bajo'}: eso corresponde a los modos ${reposo ? '2 o 3' : '0 o 1'}, no al modo ${est.modo}.`);
		const filas = [];
		if (cs) filas.push({ nombre: 'CS', canal: 'cs' });
		filas.push({ nombre: 'SCLK', canal: 'sclk' });
		const fM = filas.length;
		filas.push({ nombre: 'MOSI', canal: 'mosi' });
		let fS = -1;
		if (miso) {
			fS = filas.length;
			filas.push({ nombre: 'MISO', canal: 'miso' });
		}
		const campos = [];
		const marcas = [];
		tr.forEach((t, ti) => {
			t.palabras.forEach((w, wi) => {
				if (!w.tMuestras || !w.tMuestras.length) return;
				const txt = [`MOSI ${hx(w.mosi, est.bits)}`, miso && w.miso !== null ? `MISO ${hx(w.miso, est.bits)}` : null].filter(Boolean).join('  ·  ');
				campos.push({ a: w.tMuestras[0] - Tclk / 2, b: w.tMuestras[w.tMuestras.length - 1] + Tclk / 2, texto: txt, color: wi % 2 ? '#2e7d32' : '#1f6feb', nivel: 0 });
				for (const m of w.tMuestras) {
					marcas.push({ t: m, fila: fM });
					if (fS >= 0) marcas.push({ t: m, fila: fS });
				}
			});
			if (t.palabras.length) campos.push({ a: t.palabras[0].t0 - Tclk / 2, b: t.palabras[t.palabras.length - 1].t1 + Tclk / 2, texto: `Transacción ${ti + 1}`, color: '#7a7a7a', nivel: 1, sinBanda: true });
		});
		const items = tr.map((t, i) => ({
			t0: t.t0,
			t1: Math.min(t.t1, t.palabras.length ? t.palabras[t.palabras.length - 1].t1 + Tclk : t.t1),
			n: i + 1,
			inicio: inicio(csv, t.t0),
			pal: t.palabras.length + (t.bitsSueltos ? ` (+${t.bitsSueltos} bits sueltos)` : ''),
			mosi: t.palabras.map((w) => hx(w.mosi, est.bits).replace('0x', '')).join(' '),
			miso: miso ? t.palabras.map((w) => (w.miso === null ? '—' : hx(w.miso, est.bits).replace('0x', ''))).join(' ') : '—',
			clase: t.bitsSueltos ? 'mala' : '',
		}));
		if (tr.some((t) => t.bitsSueltos)) avisos.push('Hay transacciones con bits que no completan una palabra: revisá los bits por palabra y el modo.');
		return {
			T: Tclk,
			titulo: `SPI modo ${est.modo} · ${est.bits} bits`,
			rejilla: false,
			filas,
			campos,
			marcas,
			items,
			columnas: [
				{ t: '#', k: 'n' },
				{ t: 'Inicio', k: 'inicio', clase: 'mono nowrap' },
				{ t: 'Palabras', k: 'pal', clase: 'nowrap' },
				{ t: 'MOSI (hex)', k: 'mosi', clase: 'mono ajusta' },
				{ t: 'MISO (hex)', k: 'miso', clase: 'mono ajusta' },
			],
			resumen: [['Reloj SCLK', fmtFrecuencia(1 / Tclk)], ['Período', fmtTiempo(Tclk)], ['Transacciones', String(tr.length)], ['Palabras', String(tr.reduce((a, t) => a + t.palabras.length, 0))]],
			avisos,
			vacio: tr.length ? null : 'No se encontró ninguna transacción. Revisá que los canales sean los correctos (SCLK, MOSI…), el modo y el CS.',
		};
	},
};

// ------------------------------------------------------------------ I²C
const I2C = {
	titulo: 'I²C',
	ventanas: [30, 45, 90, 180, 400],
	ventanaBits: 45,
	defecto: {},
	canales: () => [
		{ clave: 'sda', etiqueta: 'SDA (datos)' },
		{ clave: 'scl', etiqueta: 'SCL (reloj)' },
	],
	controles: () => [nota('Con SDA y SCL basta: el decodificador reconoce solo el START, las direcciones, los ACK y el STOP.')],
	analizar({ sigs, csv }) {
		const dec = i2c.decodificar(sigs.sda.sig, sigs.scl.sig, { t0: csv.t0, t1: csv.t0 + csv.duracion });
		const avisos = [];
		const todos = dec.eventos;
		const dts = [];
		for (const e of todos) if (e.tBits) for (let i = 1; i < e.tBits.length; i++) dts.push(e.tBits[i] - e.tBits[i - 1]);
		const T = mediana(dts) || mediana(sigs.scl.sig.t.slice(1).map((t, i) => t - sigs.scl.sig.t[i])) * 2 || 1e-5;
		const campos = [];
		const marcas = [];
		const COL = { m: '#1f6feb', e: '#d9730d', c: '#c0392b' };
		for (const e of todos) {
			if (e.tipo === 'S' || e.tipo === 'Sr' || e.tipo === 'P') campos.push({ a: e.t0 - T * 0.3, b: e.t0 + T * 0.3, texto: e.tipo, color: COL.c, nivel: 0 });
			else if (e.tipo === 'byte') {
				const b = e.tBits;
				const colorDato = e.esclavo ? COL.e : COL.m;
				let texto;
				if (e.rol === 'dir7') texto = `Dir ${hx(e.v >> 1)} ${e.rw === 'R' ? 'R' : 'W'}`;
				else if (e.rol === 'dir10a') texto = `10 bits ${e.rw === 'R' ? 'R' : 'W'}`;
				else if (e.rol === 'dir10b') texto = `A7:A0 ${hx(e.v)}`;
				else texto = `${e.esclavo ? 'Dato (esclavo)' : 'Dato'} ${hx(e.v)}`;
				campos.push({ a: b[0] - T / 2, b: b[7] + T / 2, texto, color: e.rol === 'dato' ? colorDato : COL.m, nivel: 0 });
				campos.push({ a: b[8] - T / 2, b: b[8] + T / 2, texto: e.ack ? 'A' : 'N', color: e.ack ? '#2e7d32' : '#c0392b', nivel: 0 });
				for (const t of b) marcas.push({ t, fila: 1 });
			} else if (e.tipo === 'incompleto') avisos.push(`Quedaron ${e.bitsSueltos} bit(s) sueltos cerca de ${fmtTiempo(e.t0 - csv.t0)}: la captura puede haberse cortado.`);
		}
		const items = dec.transacciones.map((tx, i) => {
			const bytes = tx.filter((e) => e.tipo === 'byte');
			const dir = bytes.find((e) => e.rol === 'dir7' || e.rol === 'dir10a');
			let dirTxt = '—';
			if (dir) {
				if (dir.rol === 'dir7') dirTxt = hx(dir.v >> 1);
				else {
					const b = bytes[bytes.indexOf(dir) + 1];
					dirTxt = b && b.rol === 'dir10b' ? '0x' + (((((dir.v >> 1) & 3) << 8) | b.v)).toString(16).toUpperCase().padStart(3, '0') + ' (10 bits)' : '10 bits';
				}
			}
			const datos = bytes.filter((e) => e.rol === 'dato');
			const nacks = bytes.filter((e) => !e.ack);
			const ult = tx[tx.length - 1];
			const cerrada = ult.tipo === 'P';
			return {
				t0: tx[0].t0,
				t1: ult.t1 ?? ult.t0,
				n: i + 1,
				inicio: inicio(csv, tx[0].t0),
				dir: dirTxt,
				rw: dir ? (dir.rw === 'R' ? 'Lectura' : 'Escritura') : '—',
				datos: datos.map((e) => hex(e.v)).join(' ') || '—',
				estado: nacks.length ? chip(nacks.some((e) => e.rol !== 'dato') ? 'NACK en la dirección' : `${nacks.length} NACK`, 'mal') : cerrada ? chip('correcta', 'ok') : chip('sin STOP', 'mal'),
				clase: nacks.length ? 'mala' : '',
			};
		});
		return {
			T,
			titulo: 'I²C',
			rejilla: false,
			filas: [{ nombre: 'SCL', canal: 'scl' }, { nombre: 'SDA', canal: 'sda' }],
			campos,
			marcas,
			items,
			columnas: [
				{ t: '#', k: 'n' },
				{ t: 'Inicio', k: 'inicio', clase: 'mono nowrap' },
				{ t: 'Dirección', k: 'dir', clase: 'mono nowrap' },
				{ t: 'Operación', k: 'rw', clase: 'nowrap' },
				{ t: 'Datos (hex)', k: 'datos', clase: 'mono ajusta' },
				{ t: 'Estado', k: 'estado' },
			],
			resumen: [['Reloj SCL', fmtFrecuencia(1 / T)], ['Transacciones', String(items.length)], ['Bytes', String(todos.filter((e) => e.tipo === 'byte').length)]],
			avisos,
			vacio: items.length ? null : 'No se encontró ningún START. Revisá que SDA y SCL no estén cambiados y el umbral.',
		};
	},
};

// ------------------------------------------------------------------ CAN
const CAN = {
	titulo: 'CAN',
	ventanas: [60, 130, 260, 520, 1000],
	ventanaBits: 130,
	defecto: { diferencial: false, bitrateAuto: true, bitrate: 500000 },
	canales: (est) => (est.diferencial ? [{ clave: 'can', etiqueta: 'CANH' }, { clave: 'canl', etiqueta: 'CANL' }] : [{ clave: 'can', etiqueta: 'Señal CAN (nivel alto = recesivo)' }]),
	controles(est, { cambio, rearmar }) {
		return [
			campo(
				'Cómo se midió',
				segmentado(
					[
						[false, 'Un canal (RX del transceptor)', 'Señal lógica: alto = recesivo'],
						[true, 'CANH y CANL', 'Dos canales: dominante cuando CANH − CANL sube'],
					],
					est.diferencial,
					(v) => {
						est.diferencial = v;
						cambio();
						rearmar();
					},
					'Conexión',
				),
			),
			campo('Velocidad (bit/s)', selector([['auto', 'Automática (se mide en la captura)'], ...can.BITRATES.map((b) => [b, b.toLocaleString('es-AR')])], est.bitrateAuto ? 'auto' : est.bitrate, (v) => {
				if (v === 'auto') est.bitrateAuto = true;
				else {
					est.bitrateAuto = false;
					est.bitrate = v;
				}
				cambio();
			})),
		];
	},
	fuentes(csv, est, v) {
		if (!est.diferencial || !v('can') || !v('canl')) return {};
		const H = v('can');
		const L = v('canl');
		return { can: { v: Float64Array.from(H, (x, i) => x - L[i]), invertir: true } };
	},
	analizar({ sigs, est, csv }) {
		const s = sigs.can;
		const avisos = [];
		let br = est.bitrate;
		if (est.bitrateAuto) {
			const e = can.estimarBitrate(s.sig);
			if (!e) return { vacio: 'No hay suficientes flancos para medir la velocidad: revisá el canal elegido y el umbral.' };
			br = e.bitrate;
			if (!e.exacto) avisos.push(`La velocidad medida (${Math.round(e.medido).toLocaleString('es-AR')} bit/s) no coincide con una estándar; se usa tal cual.`);
		}
		const T = 1 / br;
		const trs = can.decodificarSenal(s.sig, T, {}, { t0: csv.t0, t1: csv.t0 + csv.duracion });
		const campos = [];
		const marcas = [];
		const COLORES = can.COLORES;
		const MUESTREO = 0.75;
		trs.forEach((x) => {
			const r = x.resultado;
			const ini = (i) => (x.tMuestras[i] ?? x.tMuestras[x.tMuestras.length - 1]) - MUESTREO * T;
			const fin = (i) => (x.tMuestras[i - 1] ?? x.tMuestras[x.tMuestras.length - 1]) + (1 - MUESTREO) * T;
			for (const c of r.campos) {
				let texto = c.nombre;
				if (c.tipo === 'id' || c.nombre === 'DLC' || c.nombre === 'CRC') texto += ` ${c.valor}`;
				else if (c.tipo === 'datos') texto = `${c.nombre} ${c.valor}`;
				campos.push({ a: ini(c.a), b: fin(c.b), texto, color: COLORES[c.tipo] || '#444', nivel: 0, tam: 11 });
			}
			for (const i of r.rellenos) if (x.tMuestras[i] !== undefined) campos.push({ a: ini(i), b: fin(i + 1), texto: 'S', color: COLORES.relleno, nivel: 1, tam: 10, sinBanda: true });
			if (x.tMuestras.length < 700) for (const t of x.tMuestras) marcas.push({ t, fila: 0 });
		});
		const items = trs.map((x, i) => {
			const r = x.resultado;
			const ok = r.ok;
			return {
				t0: x.t0,
				t1: x.t1,
				n: i + 1,
				inicio: inicio(csv, x.t0),
				id: r.id !== undefined ? `0x${hex(r.id, r.ext ? 8 : 3)}` : '—',
				fmt: r.ext === undefined ? '—' : r.ext ? 'extendida' : 'estándar',
				tipo: r.rtr === undefined ? '—' : r.rtr ? 'remota' : 'datos',
				dlc: r.dlc !== undefined ? String(r.dlc) : '—',
				datos: r.datos && r.datos.length ? r.datos.map((b) => hex(b)).join(' ') : '—',
				estado: ok ? (r.ack ? chip('correcta', 'ok') : chip('sin ACK', 'mal')) : chip(r.errores[0] ? r.errores[0].slice(0, 46) : 'error', 'mal'),
				clase: ok && r.ack ? '' : 'mala',
			};
		});
		const buenas = trs.filter((x) => x.resultado.ok).length;
		return {
			T,
			titulo: `CAN ${(br / 1000).toLocaleString('es-AR')} kbit/s`,
			rejilla: false,
			filas: [{ nombre: est.diferencial ? 'CANH − CANL' : 'CAN', canal: 'can' }],
			campos,
			marcas,
			items,
			columnas: [
				{ t: '#', k: 'n' },
				{ t: 'Inicio', k: 'inicio', clase: 'mono nowrap' },
				{ t: 'ID', k: 'id', clase: 'mono' },
				{ t: 'Formato', k: 'fmt' },
				{ t: 'Tipo', k: 'tipo' },
				{ t: 'DLC', k: 'dlc', clase: 'mono' },
				{ t: 'Datos', k: 'datos', clase: 'mono ajusta' },
				{ t: 'Estado', k: 'estado', clase: 'ajusta' },
			],
			resumen: [['Velocidad', `${(br / 1000).toLocaleString('es-AR')} kbit/s${est.bitrateAuto ? ' (medida)' : ''}`], ['Tramas', String(trs.length)], ['Correctas', String(buenas)]],
			avisos,
			vacio: trs.length ? null : 'No se encontró ninguna trama. Revisá el canal, la velocidad y, si usás CANH y CANL, que no estén cambiados.',
		};
	},
};

export const OSCI = { uart: UART, spi: SPI, i2c: I2C, can: CAN };
