"""Ayuda de FilterTool para kumOS (botón "i" de la ventana). No es parte del programa original."""

TITULO = 'FilterTool: cómo se usa'

AJUSTES = [
    ('Proyecto', 'botones', [('Abrir proyecto…', 'actionLoad_2'), ('Guardar proyecto…', 'actionSave_2')]),
    ('Unidades de frecuencia', 'radio', [('Hz', 'actionUse_Hz'), ('rad/s', 'actionUse_rad_s')]),
    ('Colores de los filtros', 'radio', [('Canónicos', 'actionColorsCanonical'), ('Al azar', 'actionColorsRandom')]),
    ('Etapas', 'check', [('Forzar la ganancia del filtro', 'actionForce_filter_gain')]),
]

HTML = """
<h3>FilterTool</h3>
<p>Sirve para <b>diseñar filtros analógicos</b>: le decís qué tipo de filtro querés y qué atenuación necesitás, y calcula la
función de transferencia (con sus polos y ceros) y muestra sus gráficos. Después te ayuda a <b>repartir el filtro en etapas</b>
de primer y segundo orden, que son las que se arman con circuitos reales.</p>

<h4>Diseñar un filtro (pestaña Filters)</h4>
<ol>
<li>Elegí el <b>Type</b> (pasa-bajos, pasa-altos, pasa-banda, rechaza-banda o retardo de grupo) y la <b>Approximation</b>
(Butterworth, Chebyshev, Chebyshev 2, Cauer, Legendre, Bessel o Gauss).</li>
<li>Completá la plantilla (<i>Template</i>) de abajo a la izquierda: la atenuación máxima en la banda de paso
(<b>Ap</b>, por ejemplo 3 dB), la mínima en la banda de rechazo (<b>Aa</b>) y las frecuencias <b>fp</b> y <b>fa</b>.
Para filtros de banda se piden las frecuencias de los dos bordes; con <i>Define with</i> podés dar el centro y el ancho de
banda (<b>f0, Bw</b>) y <i>Symmetrize to tightest template</i> simetriza la plantilla. Para retardo de grupo se piden el retardo
<b>τ0</b>, la frecuencia hasta la que debe mantenerse (<b>fRG</b>) y la tolerancia.</li>
<li>Poné un <b>Name</b> y apretá <b>New filter</b>. El programa busca el <b>orden más bajo</b> (entre <i>Min. order</i> y
<i>Max. order</i>) que cumple la plantilla y dibuja el resultado. Si la plantilla no se puede cumplir, avisa.</li>
</ol>
<p>Datos que calcula: <b>Order</b> (el orden elegido), <b>Max Q</b> (el mayor factor de calidad de sus polos), <b>DR loss</b>
(pérdida de rango dinámico) y los gráficos de la derecha: <i>Attenuation</i> (con la plantilla sombreada), <i>Magnitude</i>,
<i>Phase</i>, <i>Group delay</i>, <i>PZ map</i> (polos y ceros), <i>Step response</i> e <i>Impulse response</i>.</p>

<h4>Otras opciones del filtro</h4>
<ul>
<li><b>Gain</b>: ganancia total en dB.</li>
<li><b>Denormalization</b>: desplaza la respuesta dentro del margen que permite la plantilla (0 % y 100 % son los dos extremos).</li>
<li><b>Compare</b> y <b>Comp. order</b>: dibuja otras aproximaciones al mismo tiempo para compararlas.
<i>Comp. order</i> = <code>-1</code> usa el mismo rango Min/Max de orden, <code>0</code> el mismo orden que el filtro, y un número
positivo fija ese orden.</li>
<li><b>Legends</b>: muestra las leyendas. <b>Relevant circles</b>: dibuja en el mapa de polos y ceros los círculos de las
frecuencias relevantes.</li>
<li><b>Selected</b>: elige entre los filtros ya creados. <b>Change filter</b> aplica los valores actuales al filtro elegido.</li>
<li><b>Copy H(s) (human)</b> y <b>(LaTeX)</b>: copian la función de transferencia al portapapeles, para pegarla en un informe o en
PlotTool.</li>
</ul>

<h4>Armar las etapas (pestaña Stages)</h4>
<p>Un filtro de orden alto se construye con etapas de primer o segundo orden en cascada. Acá repartís los polos y ceros:</p>
<ol>
<li>Elegí el filtro en <b>Selected filter</b>. En las listas <b>Zeroes</b> y <b>Poles</b> aparecen sus ceros y polos.</li>
<li>Elegí uno o dos polos (un par de polos complejos tiene que ir junto) y los ceros que le corresponden, poné la
<b>Stage gain</b> y a qué se normaliza (<b>Normalized to</b>: continua, alta frecuencia o centro de banda) y apretá
<b>New stage</b>. Los polos usados quedan en gris.</li>
<li>O apretá <b>Auto select (scipy)</b> para que reparta todo lo que falte automáticamente.</li>
<li>En la lista <b>Stages</b> podés reordenarlas con las flechas, o quitar una con <b>Remove stage</b>.
<b>Symmetrize DR loss</b> reparte la pérdida de rango dinámico y <b>Remaining gain</b> / <b>Total DR loss</b> te muestran lo que
queda y el total.</li>
<li>Con una etapa elegida, <b>Impl</b> lista las implementaciones posibles según su tipo (las que no sirven para esa etapa quedan
deshabilitadas). Por ahora <b>Calculate values</b> solo tiene calculadora para la <b>Fleischer-Tow</b>: da los componentes de la
celda. <b>Cpy H(s)</b> copia la transferencia de la etapa.</li>
</ol>
<p>Los gráficos de la derecha muestran el filtro y las etapas: mapas de polos y ceros, ganancia y fase acumuladas, ganancia de
cada etapa, y sus respuestas al escalón y al impulso.</p>

<h4>Comparar con mediciones (pestaña Plotting)</h4>
<p>Cada filtro que creás aparece también como <i>dataset</i> en la pestaña Plotting. Ahí podés importar una simulación de LTspice o
una medición del osciloscopio y <b>superponerla con la respuesta del filtro</b> en los mismos gráficos. Funciona igual que
PlotTool: Add line crea una curva, a la derecha elegís en qué gráfico se dibuja y cómo, y los archivos se importan con
<b>Import files</b> (<code>.csv</code>, <code>.raw</code> o <code>.txt</code>).</p>

<h4>La barra de cada gráfico</h4>
<ul>
<li><b>Casa</b>: vista original. <b>Flechas</b>: vista anterior y siguiente. <b>Cruz</b>: mover. <b>Lupa</b>: zoom.
<b>Controles</b>: márgenes. <b>Curva con lápiz</b>: títulos, ejes y estilo de las curvas.</li>
<li><b>Cruz punteada</b> (<i>Marks</i>): cursores, puntos y textos (ver abajo).</li>
<li><b>Disquete</b>: guarda el gráfico como imagen <code>PNG</code>, <code>PDF</code>, <code>SVG</code> o <code>JPG</code>.</li>
</ul>

<h4>Cursores, puntos y textos para el informe</h4>
<p>Con el botón <b>Marks</b> (cruz punteada) se abre una ventana para marcar lo importante del gráfico. Todo se dibuja en el
gráfico y <b>sale en la imagen cuando guardás</b>.</p>
<ul>
<li><b>Cursores</b>: líneas horizontales o verticales, <i>absolutas</i> (en un valor de los ejes) o <i>relativas a los datos</i>
(pegadas al mínimo, máximo o promedio de una curva, o a su valor en un punto). Por ejemplo, un cursor vertical en la frecuencia
de corte o uno horizontal en −3 dB. Pueden escribir su valor al lado de la línea.</li>
<li><b>Puntos</b>: X, círculo, estrella, triángulo o cuadrado, en una posición absoluta o sobre una curva.</li>
<li><b>Textos</b>: etiquetas con el tamaño y el color que elijas (admiten fórmulas como <code>$f_0$</code>); <b>Elegir en el
gráfico</b> te deja ubicarlas con un clic.</li>
<li>Cursores y puntos pueden aparecer o no en la <b>leyenda</b>. Si el gráfico no tiene leyenda, se crea una con ellos.</li>
</ul>

<h4>Engranaje (arriba a la derecha)</h4>
<ul>
<li><b>Proyecto</b>: guarda o abre un archivo <code>.fto</code> con tus filtros y líneas (las marcas van en la imagen, no en el proyecto).</li>
<li><b>Unidades de frecuencia</b>: Hz o rad/s en toda la herramienta.</li>
<li><b>Colores de los filtros</b>: cada aproximación con su color fijo o colores al azar.</li>
<li><b>Forzar la ganancia del filtro</b>: al agregar la última etapa, ajusta su ganancia para que el conjunto tenga justo la
ganancia del filtro.</li>
</ul>

<p class="nota">Esta es la versión de FilterTool que corre en el navegador (Python con NumPy, SciPy, SymPy y Matplotlib). Es el
programa original de Teoría de Circuitos II; la única opción que no funciona es exportar a LaTeX.</p>
"""
