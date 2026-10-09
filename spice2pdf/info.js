// Texto de la ventana "i" de Spice2PDF.
window.AYUDA = `
<h3>Spice2PDF</h3>
<p>Convierte un esquemático de <b>LTspice</b> (archivo <code>.asc</code>) en una figura <b>vectorial y prolija</b> para tus informes: líneas finas
y parejas, símbolos de libro de texto y la misma tipografía que usa LaTeX. Sale como <b>PDF</b> (el texto sigue siendo texto), <b>SVG</b> o <b>PNG</b>.</p>

<h4>Primeros pasos</h4>
<ol>
<li><b>Cargá el esquemático</b>: tocá <b>Abrir .asc</b> o arrastrá el archivo (o varios) a la ventana. Para ver qué símbolos hay, tocá <b>Ver catálogo</b>: abre un esquemático con todos los componentes disponibles, cada uno con su nombre.</li>
<li>Mirá la <b>vista previa</b>. Se puede mover arrastrando, acercar con los botones <b>+ / −</b> o con <kbd>Ctrl</kbd> + rueda, y volver con <b>Ajustar</b>.</li>
<li>Si hace falta, cambiá las <b>opciones</b> de la izquierda: la vista previa se actualiza sola.</li>
<li>Apretá <b>Descargar PDF</b>. Con varios archivos cargados, <b>Todos (.zip)</b> baja un PDF de cada uno. Para llevarlo directo a un informe de Word, Docs o PowerPoint, apretá <b>Copiar imagen</b> (o <kbd>Ctrl</kbd> + <kbd>C</kbd> con el dibujo a la vista) y pegalo con <kbd>Ctrl</kbd> + <kbd>V</kbd>: se copia como imagen PNG con fondo blanco.</li>
</ol>
<p>Todo ocurre en tu navegador: los archivos <b>no se suben a ningún servidor</b>.</p>

<h4>Cómo preparar el esquemático en LTspice</h4>
<ul>
<li>Dibujalo con los símbolos de la librería <b>TCLib</b> de la cátedra (también andan los símbolos básicos de LTspice: <code>res</code>, <code>cap</code>, <code>ind</code>, <code>diode</code>, <code>npn</code>, <code>pnp</code>, <code>voltage</code>, <code>current</code>…). El programa reconoce el símbolo por su <b>nombre</b>.</li>
<li>Los <b>nombres</b> (R1, C2…) y los <b>valores</b> (10k, 100n…) se leen del esquemático; a los valores numéricos se les agrega la unidad (Ω, F, H, V, A).</li>
<li>Para exportar <b>solo una parte</b>, dibujá un <b>rectángulo</b> alrededor (<i>Draw → Rectangle</i>). Todo lo que quede afuera se descarta.</li>
<li>Los textos que empiezan con <code>;</code> (<i>Comment</i>) se dibujan en azul como anotaciones. Las directivas de simulación (<code>.tran</code>, <code>.ac</code>…) no se dibujan.</li>
</ul>

<h4>Opciones</h4>
<ul>
<li><b>Recorte</b>: <i>Automático</i> usa el rectángulo del <code>.asc</code> si existe y, si no, se ajusta al dibujo. <i>Ajustar al dibujo</i> recorta justo lo dibujado más el <b>margen</b>. <i>Rectángulo del .asc</i> respeta ese rectángulo tal cual.</li>
<li><b>Escala del PDF</b>: tamaño de la figura en la página. 75 % es el tamaño que daba el programa original (letra de 15 pt). Al insertar el PDF en LaTeX con <code>\\includegraphics[width=…]</code> se vuelve a escalar, así que lo que importa es la proporción entre el texto y el dibujo.</li>
<li><b>Tamaño de letra</b> y <b>Grosor de líneas</b>: cambian todo el dibujo a la vez, sin mover nada de lugar.</li>
<li><b>Mostrar</b>: podés ocultar los nombres, los valores, las etiquetas de nodo (Vin, 15V…), los comentarios, los puntos de unión o los recuadros de símbolos sin dibujo.</li>
<li><b>Fondo blanco</b>: agrega un fondo blanco al PDF, SVG y PNG (por defecto son transparentes). <b>Resolución del PNG</b>: 300 dpi sirve para imprimir.</li>
<li>Tus opciones quedan guardadas en este navegador.</li>
</ul>

<h4>Mover los textos</h4>
<p>Cualquier texto del dibujo (nombres, valores, etiquetas de nodo y comentarios) se puede <b>agarrar y arrastrar</b> con el mouse o el dedo para ubicarlo donde quieras. Al pasar el cursor por encima aparece un recuadro naranja. Con <kbd>Mayús</kbd> se mueve en línea recta; <b>doble clic</b> sobre un texto lo devuelve a su lugar; <b>Deshacer</b> (o <kbd>Ctrl</kbd> + <kbd>Z</kbd>) vuelve atrás de a un movimiento, y <b>Devolver todos</b> restaura todo. El PDF, el SVG, el PNG y la imagen copiada salen con los textos donde los dejaste. Las posiciones quedan guardadas en este navegador, por archivo: si volvés a abrir el mismo esquemático, están como las dejaste.</p>

<h4>Símbolos sin dibujo</h4>
<p>Si el esquemático usa un símbolo que el programa no conoce, <b>no se saltea en silencio</b>: aparece un recuadro rojo punteado con el nombre del símbolo y se lista en <b>Avisos</b>. Usá un símbolo de TCLib equivalente o pedí que se agregue el que falta.</p>

<h4>Qué no hace (todavía)</h4>
<ul>
<li>No dibuja las líneas libres de LTspice que no sean rectas (<i>Arc</i>, <i>Circle</i>) ni las directivas de simulación.</li>
<li>Los símbolos son los de la librería TCLib; el dibujo de cada uno no se puede editar acá.</li>
</ul>

<h4>Créditos y licencias</h4>
<p><b>Spice-a-PDF</b> es de <b>Javier Petrucci y colaboradores</b> (Teoría de Circuitos II): el programa original en Python, los símbolos y las posiciones de cada texto. Repositorio: <a href="https://github.com/TC-II/Spice-a-PDF" target="_blank" rel="noopener">github.com/TC-II/Spice-a-PDF</a>. El repositorio original no declara una licencia.</p>
<p>Acá corre ese mismo código dentro del navegador con <b>Pyodide</b> (MPL-2.0). Se agregaron: la interfaz, el recorte automático, las opciones, el aviso de símbolos sin dibujo y la exportación a PDF, SVG y PNG con <b>jsPDF</b> y <b>svg2pdf.js</b> (MIT, yWorks / James Hall) y <b>fflate</b> (MIT, Arjun Barrett).</p>
<p>Tipografías: <b>Latin Modern Roman 10</b> (licencia GUST, la de LaTeX) para el dibujo y <b>CMU Serif Italic</b> (SIL OFL); la interfaz usa Archivo y JetBrains Mono (SIL OFL).</p>
`;
