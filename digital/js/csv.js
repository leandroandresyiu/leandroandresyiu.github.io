// Lectura de capturas de osciloscopio en CSV (Rigol, Keysight, Tektronix, Siglent y archivos genéricos con una columna de tiempo).
// Sin DOM: se puede probar con Node.

const MAX_FILAS = 20e6;

const esNumero = (s) => s !== '' && s !== undefined && Number.isFinite(Number(s.replace(',', '.')));
const aNumero = (s) => Number(s.replace(',', '.'));

/** Elige el separador (coma, punto y coma o tabulación) mirando las primeras líneas con datos. */
function separador(lineas) {
	const util = lineas.filter((l) => l.trim() && !l.startsWith('#')).slice(0, 80);
	let mejor = ',';
	let mejorPuntaje = -1;
	for (const c of [',', ';', '\t']) {
		const cuentas = util.map((l) => l.split(c).length);
		const frecuente = cuentas.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {});
		const [campos, veces] = Object.entries(frecuente).sort((a, b) => b[1] - a[1])[0] || [1, 0];
		const puntaje = Number(campos) >= 2 ? veces * 1000 + Number(campos) : -1;
		if (puntaje > mejorPuntaje) {
			mejorPuntaje = puntaje;
			mejor = c;
		}
	}
	return mejor;
}

const campos = (linea, sep) => linea.split(sep).map((c) => c.trim().replace(/^"|"$/g, ''));

/** Factor para llevar el tiempo de una columna a segundos, según la unidad que diga el encabezado. */
function factorTiempo(nombre) {
	const n = String(nombre || '').toLowerCase();
	if (/\(?\bns\b\)?|nano/.test(n)) return 1e-9;
	if (/\(?\bus\b\)?|µs|μs|micro/.test(n)) return 1e-6;
	if (/\(?\bms\b\)?|milli/.test(n)) return 1e-3;
	return 1;
}

/**
 * Lee un CSV de osciloscopio.
 * Devuelve { formato, nombre, n, t0, dt, t (Float64Array o null si el muestreo es uniforme), canales: [{ nombre, v: Float64Array }], avisos }.
 * Lanza Error con un mensaje claro si no se entiende el archivo.
 */
export function parsearCSV(texto, nombre = '') {
	let txt = String(texto);
	if (txt.charCodeAt(0) === 0xfeff) txt = txt.slice(1);
	const lineas = txt.split(/\r?\n/);
	const sep = separador(lineas);
	const avisos = [];

	// primera fila de datos: los dos primeros campos son números
	let ini = -1;
	let columnas = 0;
	for (let i = 0; i < lineas.length; i++) {
		const l = lineas[i];
		if (!l.trim() || l.startsWith('#')) continue;
		const c = campos(l, sep);
		if (c.length >= 2 && esNumero(c[0]) && esNumero(c[1])) {
			ini = i;
			columnas = c.length;
			break;
		}
	}
	if (ini < 0) throw new Error('No encontré datos numéricos. El archivo tiene que ser un CSV con al menos dos columnas (tiempo y señal).');

	// filas previas con texto: encabezado, unidades, parámetros
	const previas = [];
	for (let i = 0; i < ini; i++) {
		const l = lineas[i];
		if (!l.trim() || l.startsWith('#')) continue;
		const c = campos(l, sep);
		if (c.length >= 2) previas.push(c);
	}
	const cabecera = previas.find((c) => c.length >= columnas - 1) || null;
	const nombres = Array.from({ length: columnas }, (_, i) => {
		const x = cabecera ? cabecera[i] : '';
		if (x && !esNumero(x)) return x;
		if (x && esNumero(x)) return `Canal ${x}`;
		return '';
	});

	// Rigol: X, CH1.., Start, Increment; la fila siguiente a los nombres trae Start e Increment
	const minus = nombres.map((n) => n.toLowerCase());
	const iStart = minus.indexOf('start');
	const iIncr = minus.indexOf('increment');
	let rigol = null;
	if (iStart >= 0 && iIncr >= 0) {
		const filaParam = previas.find((c) => c !== cabecera && esNumero(c[iStart] ?? '') && esNumero(c[iIncr] ?? ''));
		if (filaParam) rigol = { start: aNumero(filaParam[iStart]), incr: aNumero(filaParam[iIncr]) };
		else {
			// a veces Start e Increment están en la primera fila de datos
			const c0 = campos(lineas[ini], sep);
			if (esNumero(c0[iStart] ?? '') && esNumero(c0[iIncr] ?? '')) rigol = { start: aNumero(c0[iStart]), incr: aNumero(c0[iIncr]) };
		}
	}

	// cuántas filas hay (cota superior)
	const total = Math.min(lineas.length - ini, MAX_FILAS);
	if (lineas.length - ini > MAX_FILAS) avisos.push(`El archivo tiene más de ${MAX_FILAS.toLocaleString('es-AR')} filas: se leyeron las primeras.`);
	const datos = Array.from({ length: columnas }, () => new Float64Array(total));
	let n = 0;
	for (let i = ini; i < lineas.length && n < total; i++) {
		const l = lineas[i];
		if (!l.trim()) continue;
		const c = sep === ',' ? l.split(',') : l.split(sep);
		if (c.length < 2) continue;
		const primero = c[0].trim();
		if (!esNumero(primero)) continue;
		for (let k = 0; k < columnas; k++) {
			const s = c[k];
			const v = s === undefined || s.trim() === '' ? NaN : aNumero(s.trim());
			datos[k][n] = v;
		}
		n++;
	}
	if (n < 8) throw new Error(`Solo se leyeron ${n} filas con datos: es muy poco para decodificar.`);

	let tiempo = null; // Float64Array
	let t0;
	let dt;
	let colsCanal;
	let formato;
	if (rigol) {
		formato = 'Rigol';
		t0 = rigol.start;
		dt = rigol.incr;
		colsCanal = nombres.map((_, k) => k).filter((k) => k !== 0 && k !== iStart && k !== iIncr && nombres[k] !== '');
		if (!(dt > 0)) throw new Error('El intervalo de muestreo (Increment) del archivo no es válido.');
	} else {
		// primera columna = tiempo
		formato = cabecera && /^(x-axis|time|tiempo|second|seconds|s|t|x)\b/i.test(cabecera[0] || '') ? 'Columna de tiempo' : 'Columna de tiempo (supuesta)';
		const t = datos[0].subarray(0, n);
		const f = factorTiempo(cabecera ? cabecera[0] : '');
		let creciente = true;
		for (let i = 1; i < n && creciente; i++) if (!(t[i] > t[i - 1])) creciente = false;
		if (!creciente) throw new Error('La primera columna no crece: espero que sea el tiempo. Si el archivo no tiene columna de tiempo, abrilo con un editor y agregala.');
		t0 = t[0] * f;
		dt = ((t[n - 1] - t[0]) * f) / (n - 1);
		// ¿muestreo uniforme?
		let desvio = 0;
		const paso = Math.max(1, Math.floor(n / 5000));
		for (let i = paso; i < n; i += paso) desvio = Math.max(desvio, Math.abs(t[i] * f - (t0 + i * dt)));
		if (desvio > dt * 0.25) {
			tiempo = new Float64Array(n);
			for (let i = 0; i < n; i++) tiempo[i] = t[i] * f;
			avisos.push('El muestreo no es uniforme: se usan los instantes de la columna de tiempo tal cual.');
		}
		colsCanal = nombres.map((_, k) => k).filter((k) => k !== 0);
	}
	const canales = colsCanal.map((k, j) => {
		const v = datos[k].slice(0, n);
		// los huecos (celdas vacías) repiten el valor anterior
		let ult = 0;
		let huecos = 0;
		for (let i = 0; i < n; i++) {
			if (Number.isNaN(v[i])) {
				v[i] = ult;
				huecos++;
			} else ult = v[i];
		}
		if (huecos > n * 0.01) avisos.push(`El canal "${nombres[k] || `Canal ${j + 1}`}" tiene ${huecos} celdas vacías.`);
		return { nombre: nombres[k] || `Canal ${j + 1}`, v };
	});
	if (!canales.length) throw new Error('No encontré ninguna columna con señal además del tiempo.');
	if (!(dt > 0)) throw new Error('No pude calcular el intervalo de muestreo: revisá la columna de tiempo.');
	return { formato, nombre, n, t0, dt, t: tiempo, canales, duracion: (tiempo ? tiempo[n - 1] : t0 + (n - 1) * dt) - t0, avisos };
}

/** Instante de la muestra i. */
export const instante = (csv, i) => (csv.t ? csv.t[i] : csv.t0 + i * csv.dt);

/** Índice de la primera muestra con instante >= t (acotado). */
export function indiceDe(csv, t) {
	if (!csv.t) return Math.max(0, Math.min(csv.n, Math.ceil((t - csv.t0) / csv.dt - 1e-9)));
	let lo = 0;
	let hi = csv.n;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (csv.t[mid] < t) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}
