// Texto de la ventana "i" de Digital.
export default `
<h3>Digital</h3>
<p>Para <b>dibujar diagramas de tiempos</b> sin escribir código y para <b>armar y leer tramas</b> de comunicación (UART, SPI, I²C y CAN). Todo sale como <b>PDF vectorial</b> (con la tipografía de LaTeX), SVG o PNG, listo para un informe. Todo ocurre en tu navegador: nada se sube a ningún servidor.</p>

<h4>Qué hay en cada pestaña</h4>
<ul>
<li><b>Diagrama</b>: un editor libre. Pintás los niveles con el mouse sobre una grilla, agregás señales, relojes y buses, ponés etiquetas y medís tiempos con cursores.</li>
<li><b>UART · SPI · I²C · CAN</b>: cada una tiene tres modos.
  <ul>
  <li><b>Codificar</b>: escribís el dato (en hexadecimal, texto, decimal o binario) y los parámetros del bus, y se dibuja la trama con cada campo rotulado y una tabla con el detalle.</li>
  <li><b>Decodificar</b> (en I²C, <b>Leer texto</b>): pegás la trama que recibís y se ve qué dice.</li>
  <li><b>Repaso</b>: una ficha corta de la norma con un diagrama de ejemplo.</li>
  </ul>
</li>
</ul>
<p>El botón <b>Enviar al editor</b> pasa cualquier trama a la pestaña Diagrama para retocarla a mano (Ctrl + Z deshace el cambio).</p>

<h4>El editor de diagramas</h4>
<ol>
<li>Elegí la herramienta <b>Pincel</b> y un nivel: <b>0</b>, <b>1</b>, <b>X</b> (no importa), <b>Z</b> (desconectado) o <b>Dato</b> (un bloque de bus con texto). También podés usar las teclas <kbd>0</kbd> <kbd>1</kbd> <kbd>X</kbd> <kbd>Z</kbd> <kbd>D</kbd>.</li>
<li>Hacé clic o <b>arrastrá</b> sobre la grilla. Con <b>Dato</b>, un clic doble sobre un bloque cambia su texto.</li>
<li><b>Etiqueta</b>: arrastrá sobre unos ticks y escribí un texto; queda una llave con el texto arriba (por ejemplo "Dirección").</li>
<li><b>Cursor</b>: un clic pone A, otro pone B, y se lee la diferencia. Si en <i>Tiempo y grilla</i> ponés cuánto dura un tick, se muestran Δt y la frecuencia 1/Δt.</li>
<li><b>Mano</b> solo mueve la vista (útil con el dedo en el celular).</li>
<li>En <i>Señales</i> cambiás el nombre, el orden y la cantidad de filas, y podés rellenar una fila con un reloj o con un nivel fijo.</li>
</ol>
<p><kbd>Ctrl</kbd> + <kbd>Z</kbd> deshace y <kbd>Ctrl</kbd> + <kbd>Y</kbd> rehace. El diagrama queda guardado en este navegador.</p>

<h4>Mover los textos</h4>
<p>Cualquier texto del dibujo (título, nombres de señales, etiquetas, medidas) se puede <b>agarrar y arrastrar</b> para ubicarlo mejor. Con <kbd>Mayús</kbd> se mueve en línea recta; <b>doble clic</b> sobre un texto lo devuelve a su lugar. El PDF, el SVG y el PNG salen con los textos donde los dejaste.</p>

<h4>Exportar</h4>
<p>Abajo a la derecha: <b>Descargar PDF</b> (el texto sigue siendo texto), <b>SVG</b>, <b>PNG</b> y <b>Copiar imagen</b> (o <kbd>Ctrl</kbd> + <kbd>C</kbd>), que copia un PNG con fondo blanco para pegarlo directo en Word, Docs o PowerPoint. En <i>Aspecto y exportación</i> (abajo del panel) se cambian el ancho del dibujo, el alto de las filas, la letra, el grosor, la grilla, el fondo y la resolución del PNG.</p>

<h4>Conversor de bits</h4>
<p>El botón <b>Conversor</b> (arriba a la derecha) abre un desplegable que sirve en cualquier pestaña, también en medio de una trama de UART o de I²C. Escribís un valor y elegís en qué formato está (hexadecimal, decimal, binario, octal, texto ASCII o flotante IEEE 754) y se ven todas las demás formas: hexadecimal, decimal sin y con signo (complemento a dos), binario, octal, texto, los bytes en los dos órdenes (big y little endian), qué bits están en 1 y el valor como flotante de 16, 32 o 64 bits. El ancho se detecta solo (los ceros de la izquierda cuentan: <code>0x00FF</code> son 16 bits) o se fija en 8, 16, 32 o 64. Los bits aparecen como botones: tocá uno para invertirlo, útil para armar o leer un registro. Cada fila tiene <b>Copiar</b> (o tocá el valor), y <b>Copiar todo</b> copia la lista completa. Se cierra con <kbd>Esc</kbd> o tocando afuera, y se acuerda de lo último que escribiste.</p>

<h4>Tramas largas: dividir en renglones</h4>
<p>Si una trama no entra en una línea, tocá <b>Renglones</b> (arriba de la vista previa): el dibujo se corta en renglones, uno debajo del otro, como un texto que no entra en el ancho. Se corta siempre entre bits y cada renglón repite los nombres de las señales y su propia regla de tiempo. En <i>Aspecto y exportación</i> se elige el ancho máximo de cada renglón, y el PDF, el SVG y el PNG salen también en renglones. En el editor del diagrama no se usa.</p>

<h4>WaveJSON (compatible con WaveDrom)</h4>
<p>En el editor, <b>Importar…</b> acepta el código de <a href="https://wavedrom.com" target="_blank" rel="noopener">WaveDrom</a> (<code>{ "signal": [ { "name": "clk", "wave": "p...." } ] }</code>) y <b>Copiar</b> o <b>Descargar .json</b> lo exporta, así que podés ir y venir entre los dos. Los relojes <code>p</code> y <code>n</code> usan dos ticks por período. También se puede soltar un archivo <code>.json</code> sobre la ventana.</p>

<h4>Cómo se arman las tramas</h4>
<ul>
<li><b>UART</b>: reposo en 1, START en 0, datos con el bit menos significativo primero, paridad opcional y STOP. Los círculos rojos marcan dónde muestrea el receptor (en la mitad de cada bit).</li>
<li><b>SPI</b>: los cuatro modos (CPOL y CPHA), de 2 a 32 bits por palabra, MSB o LSB primero y CS opcional. Los círculos rojos marcan el flanco en que se toma el dato.</li>
<li><b>I²C</b>: START, dirección de 7 o 10 bits con R/W, bytes con ACK o NACK, START repetido y STOP. La notación de texto es la de los analizadores: <code>S 50 W A 00 A Sr 50 R A FF N P</code>.</li>
<li><b>CAN</b>: tramas estándar (11 bits) y extendidas (29), de datos y remotas, con relleno de bits y CRC-15 calculados. Al decodificar se avisa si el relleno o el CRC no cierran.</li>
</ul>
<div class="aviso">CAN FD no está soportado: solo CAN clásico (2.0A y 2.0B).</div>

<h4>Créditos y licencias</h4>
<p>El formato <b>WaveJSON</b> es el de <a href="https://github.com/wavedrom/wavedrom" target="_blank" rel="noopener">WaveDrom</a> (MIT); Digital no usa su código, solo lee y escribe el mismo formato. El PDF se arma con <b>jsPDF</b> y <b>svg2pdf.js</b> (MIT, yWorks / James Hall). Tipografías: <b>Latin Modern Roman 10</b> (licencia GUST, la de LaTeX) para el dibujo, y Archivo y JetBrains Mono (SIL OFL) para la interfaz.</p>
`;
