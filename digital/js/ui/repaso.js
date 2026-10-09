// "Repaso": una ficha corta de cada norma (qué es, trama, tiempos, valores típicos, errores comunes) con un diagrama de ejemplo.
import { hex } from '../bits.js';
import * as can from '../can.js';
import { h } from '../dom.js';
import * as i2c from '../i2c.js';
import { aVista } from '../modelo.js';
import * as spi from '../spi.js';
import * as uart from '../uart.js';
import { campo, conDefectos, selector, tabla } from './comun.js';

const FICHAS = {
	uart: {
		titulo: 'UART',
		secciones: [
			['Qué es', '<p>Comunicación serie <b>asincrónica</b> entre dos equipos. No hay línea de reloj: ambos extremos acuerdan de antemano la velocidad (<b>baudios</b>) y el formato de la trama.</p>'],
			['Líneas', '<ul><li><b>TX</b> y <b>RX</b>, más masa común (GND). El TX de un lado va al RX del otro: se cruzan.</li><li>Niveles: <b>TTL/CMOS</b> (0 V y 3,3 o 5 V, reposo en alto), <b>RS-232</b> (±3 a ±15 V, <i>invertido</i>: el 1 es negativo) o <b>RS-485</b> (diferencial, varios equipos).</li></ul>'],
			['La trama', '<ul><li>En reposo la línea está en <b>1</b>.</li><li><b>START</b>: un bit en 0.</li><li><b>Datos</b>: de 5 a 9 bits (casi siempre 8), el <b>menos significativo primero</b>.</li><li><b>Paridad</b> (opcional): par = la cantidad total de unos, datos y paridad, es par.</li><li><b>STOP</b>: 1, 1,5 o 2 bits en 1.</li></ul><p><b>8N1</b> = 8 datos, sin paridad, 1 stop: son <b>10 bits por byte</b>.</p>'],
			['Tiempos y reglas', '<ul><li>Un bit dura <b>1 / baudios</b>: a 9600 son 104,2 µs.</li><li>El receptor detecta el flanco de bajada del START, espera <b>medio bit</b> y muestrea cada bit en su mitad.</li><li>Los relojes de los extremos no pueden diferir más de ~2 %: el error se acumula a lo largo de los 10 bits.</li></ul>'],
			['Valores típicos', '<p><b>9600</b> y <b>115200</b> baudios son los más usados; 8N1 casi siempre. En una PC, los conversores USB-serie llegan a 1 Mbaud o más.</p>'],
			['Errores comunes', '<ul><li>Velocidad distinta en los extremos: llegan caracteres basura.</li><li>TX con TX y RX con RX (falta cruzar).</li><li>Sin masa común, o 5 V en una entrada de 3,3 V.</li><li><b>Error de trama</b> (framing): el STOP se leyó en 0, casi siempre por velocidad o formato distinto.</li><li><b>Break</b>: la línea queda en 0 más de una trama completa.</li></ul>'],
		],
	},
	spi: {
		titulo: 'SPI',
		secciones: [
			['Qué es', '<p>Bus serie <b>sincrónico</b> y <b>full-duplex</b> con un maestro y uno o más esclavos. El maestro genera el reloj, y en cada pulso sale un bit hacia el esclavo y entra otro desde el esclavo.</p>'],
			['Líneas', '<ul><li><b>SCLK</b>: reloj.</li><li><b>MOSI</b> (o COPI): del maestro al esclavo. <b>MISO</b> (o CIPO): del esclavo al maestro.</li><li><b>CS</b> (o SS): selección del esclavo, normalmente <b>activo en bajo</b>. Hace falta uno por esclavo.</li></ul>'],
			['Modos', '<p><b>CPOL</b> es el nivel del reloj en reposo y <b>CPHA</b> dice en qué flanco se toma el dato. Hay que usar el modo que pide la hoja de datos del esclavo.</p><table class="tabla"><thead><tr><th>Modo</th><th>CPOL</th><th>CPHA</th><th>Reposo</th><th>Muestrea</th></tr></thead><tbody><tr><td>0</td><td>0</td><td>0</td><td>bajo</td><td>subida</td></tr><tr><td>1</td><td>0</td><td>1</td><td>bajo</td><td>bajada</td></tr><tr><td>2</td><td>1</td><td>0</td><td>alto</td><td>bajada</td></tr><tr><td>3</td><td>1</td><td>1</td><td>alto</td><td>subida</td></tr></tbody></table>'],
			['La transacción', '<ul><li>CS baja, el maestro da <b>n pulsos</b> de reloj (8, 16 o 24 bits: depende del chip) y CS vuelve a subir.</li><li>Casi siempre el <b>bit más significativo sale primero</b>.</li><li>Una transacción puede tener varios bytes sin subir CS entre ellos.</li></ul>'],
			['Tiempos y reglas', '<ul><li>La frecuencia máxima la fija el esclavo (de unos pocos kHz a decenas de MHz).</li><li>Hay que respetar los tiempos de preparación y retención (<i>setup</i> y <i>hold</i>) de CS y de los datos respecto del reloj.</li></ul>'],
			['Errores comunes', '<ul><li>Modo equivocado: los datos llegan corridos un bit o con basura.</li><li>Orden de bits invertido (MSB contra LSB).</li><li>Para <b>leer</b> hay que enviar bytes de relleno: sin pulsos de reloj no sale nada por MISO.</li><li>CS que sube entre bytes cuando el chip espera una sola transacción.</li><li>Un esclavo no seleccionado que no deja MISO en alta impedancia.</li></ul>'],
		],
	},
	i2c: {
		titulo: 'I²C',
		secciones: [
			['Qué es', '<p>Bus serie sincrónico de <b>dos hilos</b> con varios maestros y varios esclavos. Cada esclavo tiene una <b>dirección</b> de 7 bits (o 10).</p>'],
			['Líneas', '<ul><li><b>SDA</b> (datos) y <b>SCL</b> (reloj), las dos de <b>colector abierto</b> con resistencias de <b>pull-up</b> a la alimentación.</li><li>Nadie maneja el 1: la línea sube sola por la resistencia, y cualquiera puede bajarla a 0.</li></ul>'],
			['La trama', '<ul><li><b>START (S)</b>: SDA baja mientras SCL está alto.</li><li>Primer byte: <b>dirección de 7 bits + R/W</b> (0 = el maestro escribe, 1 = lee).</li><li>Cada byte son <b>8 bits, el más significativo primero</b>, y un noveno pulso de <b>ACK</b>: el receptor baja SDA (0 = ACK, 1 = NACK).</li><li><b>STOP (P)</b>: SDA sube mientras SCL está alto.</li><li><b>START repetido (Sr)</b>: un nuevo START sin soltar el bus; se usa para escribir un registro y leer enseguida.</li></ul>'],
			['Tiempos y reglas', '<ul><li>SDA solo cambia cuando SCL está <b>bajo</b>; se lee con SCL <b>alto</b>. Las únicas excepciones son START y STOP.</li><li>Un esclavo puede mantener SCL bajo para pedir más tiempo (<i>clock stretching</i>).</li><li>Direcciones reservadas: 0x00–0x07 y 0x78–0x7F; <b>11110xx</b> anuncia una dirección de 10 bits.</li></ul>'],
			['Valores típicos', '<table class="tabla"><thead><tr><th>Modo</th><th>Frecuencia</th></tr></thead><tbody><tr><td>Standard</td><td>100 kHz</td></tr><tr><td>Fast</td><td>400 kHz</td></tr><tr><td>Fast-mode Plus</td><td>1 MHz</td></tr><tr><td>High-speed</td><td>3,4 MHz</td></tr></tbody></table><p>Pull-ups habituales: <b>4,7 kΩ</b> a 100 kHz y <b>2,2 kΩ</b> a 400 kHz. Mientras más capacidad tiene el bus (máximo 400 pF), más chica tiene que ser la resistencia.</p>'],
			['Errores comunes', '<ul><li>Falta de pull-ups, o pull-ups a una tensión distinta de la del chip.</li><li><b>Dirección de 7 bits contra byte de 8 bits</b>: el chip se llama 0x50 pero en el cable se ve 0xA0 (escritura) o 0xA1 (lectura).</li><li>NACK en la dirección: dirección equivocada o el esclavo no está.</li><li>Dos esclavos con la misma dirección.</li><li>Bus colgado con SDA en 0: se libera mandando hasta 9 pulsos de reloj y un STOP.</li></ul>'],
		],
	},
	can: {
		titulo: 'CAN',
		secciones: [
			['Qué es', '<p>Bus serie <b>multimaestro</b> y <b>diferencial</b> muy usado en automotor e industria. Los mensajes no llevan dirección de destino: llevan un <b>identificador</b> que dice qué contienen y qué prioridad tienen (el número menor gana).</p>'],
			['Líneas', '<ul><li><b>CANH</b> y <b>CANL</b>, un par trenzado con una resistencia de <b>120 Ω en cada extremo</b> del bus.</li><li><b>Dominante</b> (lógico 0): CANH ≈ 3,5 V y CANL ≈ 1,5 V. <b>Recesivo</b> (lógico 1): los dos en ≈ 2,5 V.</li><li>Si dos nodos hablan a la vez, <b>el dominante gana</b>: así se resuelve el arbitraje sin perder tiempo.</li></ul>'],
			['La trama de datos', '<ul><li><b>SOF</b> (1 bit dominante), <b>ID</b> (11 bits; 29 en la trama extendida), <b>RTR</b>, <b>IDE</b>, <b>r0</b>, <b>DLC</b> (4 bits: cantidad de bytes), <b>datos</b> (0 a 8 bytes), <b>CRC</b> (15 bits) y su delimitador.</li><li><b>ACK</b>: el emisor deja 1 y cualquier receptor que recibió bien lo baja a 0. Luego el delimitador de ACK, <b>EOF</b> (7 bits en 1) y 3 bits de espacio entre tramas.</li><li><b>Trama remota</b>: igual pero con RTR = 1 y sin datos; pide que otro nodo conteste.</li></ul>'],
			['Relleno de bits (stuffing)', '<p>Desde el SOF hasta el final del CRC, después de <b>5 bits iguales seguidos</b> el emisor inserta uno de valor contrario. Así hay flancos suficientes para que los receptores se resincronicen. Seis bits iguales seguidos son un <b>error de relleno</b>.</p>'],
			['Tiempos y valores típicos', '<table class="tabla"><thead><tr><th>Velocidad</th><th>Largo máximo aprox.</th></tr></thead><tbody><tr><td>1 Mbit/s</td><td>40 m</td></tr><tr><td>500 kbit/s</td><td>100 m</td></tr><tr><td>250 kbit/s</td><td>250 m</td></tr><tr><td>125 kbit/s</td><td>500 m</td></tr></tbody></table><p>El punto de muestreo suele estar entre el 75 y el 87 % del bit. Todos los nodos tienen que usar la <b>misma velocidad</b>.</p>'],
			['Errores comunes', '<ul><li>Sin terminación, o con tres resistencias: con el bus apagado deberían medirse <b>60 Ω</b> entre CANH y CANL.</li><li>Velocidades distintas entre nodos.</li><li>Un nodo solo en el bus: nadie manda el ACK y reintenta sin parar.</li><li>CANH y CANL cruzados, o sin masa de referencia.</li></ul>'],
		],
	},
};

/** Filas "campo / bits / qué es" para la tabla de abajo. */
const colsCampos = [
	{ t: 'Campo', k: 'campo' },
	{ t: 'Valor', k: 'valor', clase: 'mono' },
	{ t: 'Qué es', k: 'nota', clase: 'ajusta' },
];

// ------------------------------------------------------------------ ejemplos por protocolo
function ejemploUart() {
	const { diagrama } = uart.construirDiagrama([0x41], { baud: 9600, reposoIni: 2, reposoFin: 3 });
	diagrama.titulo = 'UART 9600 8N1: se envía "A" (0x41)';
	const filas = [
		{ campo: 'START', valor: '0', nota: 'La línea baja: avisa que viene un byte.' },
		{ campo: 'D0 … D7', valor: '1 0 0 0 0 0 1 0', nota: '0x41 = 0100 0001, enviado al revés: el bit menos significativo primero.' },
		{ campo: 'STOP', valor: '1', nota: 'La línea vuelve a reposo. Cada bit dura 104,2 µs.' },
	];
	return { diagrama, filas };
}
function ejemploSpi(est) {
	const modo = est.modo;
	const { diagrama } = spi.construirDiagrama([0xa5], [0x3c], { modo });
	const filas = [
		{ campo: `Modo ${modo}`, valor: `CPOL=${modo >> 1} CPHA=${modo & 1}`, nota: `El reloj reposa en ${modo >> 1 ? 'alto' : 'bajo'} y el dato se toma en el flanco de ${spi.muestreaEnSubida(modo) ? 'subida' : 'bajada'} (círculos rojos).` },
		{ campo: 'MOSI', valor: '0xA5 = 1010 0101', nota: 'El maestro envía primero el bit más significativo.' },
		{ campo: 'MISO', valor: '0x3C = 0011 1100', nota: 'El esclavo contesta en los mismos 8 pulsos.' },
	];
	return { diagrama, filas };
}
const EJEMPLOS_I2C = {
	escribir: ['Escribir 2 bytes', { dir: 0x50, rw: 'W', escribir: [0x10, 0xab] }],
	leer: ['Leer 2 bytes', { dir: 0x50, rw: 'R', leer: [0x12, 0x34] }],
	registro: ['Escribir un registro y leer', { dir: 0x68, rw: 'WR', escribir: [0x75], leer: [0x68] }],
};
function ejemploI2c(est) {
	const [nombre, form] = EJEMPLOS_I2C[est.tipo];
	const ev = i2c.secuenciaDesdeForm(form);
	const diagrama = i2c.construirDiagrama(ev, { fHz: 100000 });
	diagrama.titulo = `I²C: ${nombre.toLowerCase()} (dirección 0x${hex(form.dir)})`;
	const filas = i2c.describir(ev).map((f) => ({ campo: f.campo, valor: f.valor, nota: f.nota }));
	return { diagrama, filas };
}
const EJEMPLOS_CAN = {
	estandar: ['Trama estándar de datos', { id: 0x123, datos: [0xde, 0xad] }],
	extendida: ['Trama extendida (29 bits)', { ext: true, id: 0x18daf110, datos: [0x02, 0x10, 0x03] }],
	remota: ['Trama remota (pide datos)', { id: 0x321, rtr: true, dlc: 4 }],
};
function ejemploCan(est) {
	const [nombre, f] = EJEMPLOS_CAN[est.tipo];
	const tr = can.codificar(f);
	const diagrama = can.construirDiagrama(tr, { bitrate: 500000 });
	diagrama.titulo = `CAN: ${nombre.toLowerCase()}`;
	const filas = tr.campos.map((c) => ({ campo: c.nombre, valor: c.valor, nota: c.nota }));
	return { diagrama, filas, rellenos: tr.rellenos.length };
}

const OPCIONES = {
	uart: null,
	spi: { clave: 'modo', etiqueta: 'Modo de SPI', defecto: 0, lista: [[0, 'Modo 0'], [1, 'Modo 1'], [2, 'Modo 2'], [3, 'Modo 3']] },
	i2c: { clave: 'tipo', etiqueta: 'Ejemplo', defecto: 'escribir', lista: Object.entries(EJEMPLOS_I2C).map(([k, v]) => [k, v[0]]) },
	can: { clave: 'tipo', etiqueta: 'Ejemplo', defecto: 'estandar', lista: Object.entries(EJEMPLOS_CAN).map(([k, v]) => [k, v[0]]) },
};
const EJEMPLO = { uart: ejemploUart, spi: ejemploSpi, i2c: ejemploI2c, can: ejemploCan };

/** Monta la ficha de un protocolo en el panel y su diagrama de ejemplo en la vista previa. */
export function montarRepaso(id, ctx) {
	const ficha = FICHAS[id];
	const op = OPCIONES[id];
	const est = ctx.est;
	if (op) conDefectos(est, { [op.clave]: op.defecto });

	const dibujar = () => {
		const { diagrama, filas, rellenos } = EJEMPLO[id](est);
		ctx.diagrama = diagrama;
		ctx.mostrar({ m: aVista(diagrama), px: diagrama.pxSugerido, nombre: `${id}-ejemplo`, resumen: `Ejemplo de ${ficha.titulo}` });
		const extra = rellenos ? h('p', { class: 'nota' }, `Hay ${rellenos} bit${rellenos === 1 ? '' : 's'} de relleno (marcados con S): se insertan tras 5 bits iguales.`) : null;
		ctx.resultados(h('div', {}, h('h3', {}, 'Qué se ve en el diagrama'), tabla(colsCampos, filas), extra));
	};

	const cuerpo = h('div', { class: 'repaso' });
	for (const [titulo, html] of ficha.secciones) {
		cuerpo.append(h('h3', {}, titulo));
		const caja = h('div', { html });
		cuerpo.append(caja);
	}
	ctx.panel.replaceChildren(
		h('section', { class: 'sec' }, op ? campo(op.etiqueta, selector(op.lista, est[op.clave], (v) => ((est[op.clave] = v), ctx.guardar(), dibujar()))) : null, h('div', { class: 'fila-botones fila-botones--arriba' }, h('button', { type: 'button', class: 'btn btn--chico', onclick: () => ctx.diagrama && ctx.alEditor(ctx.diagrama) }, 'Enviar el ejemplo al editor')), cuerpo),
	);
	dibujar();
	return { redibujar: dibujar };
}
