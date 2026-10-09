"""Ayuda de PlotTool para kumOS (botón "i" de la ventana). No es parte del programa original."""

TITULO = 'PlotTool: cómo se usa'

AJUSTES = [
    ('Proyecto', 'botones', [('Abrir proyecto…', 'actionLoad_2'), ('Guardar proyecto…', 'actionSave_2')]),
]

HTML = """
<h3>PlotTool</h3>
<p>Sirve para <b>graficar curvas</b>: funciones de transferencia que escribís vos, simulaciones de LTspice y mediciones del
osciloscopio. Podés superponer varias curvas, transformarlas (módulo, fase, dB…), ponerles nombre y color, y guardar el gráfico
como imagen lista para un informe.</p>

<h4>Primeros pasos</h4>
<ol>
<li><b>Cargá datos</b> en el panel izquierdo (<i>Dataset handling</i>). Cada archivo o función que agregás es un <i>dataset</i>
y aparece en la lista de arriba.</li>
<li>Con un dataset elegido, apretá <b>Add line</b>: se crea una <i>línea</i> (una curva) que aparece en la lista de la derecha
(<i>Dataline handling</i>).</li>
<li>Elegí la línea y, a la derecha, decidí <b>en qué gráfico</b> se dibuja (<i>Render</i>: Plot 1 a Plot 5) y qué se grafica.
El gráfico se actualiza solo.</li>
</ol>

<h4>De dónde salen los datos</h4>
<ul>
<li><b>Import files</b> (o arrastrar el archivo a la ventana): mediciones <code>.csv</code> del osciloscopio Rigol,
simulaciones de LTspice <code>.raw</code> y archivos de texto <code>.txt</code> exportados de LTspice
(con varios casos si usaste <code>.step</code>). Todo se procesa en tu navegador; los archivos no se suben a ningún lado.</li>
<li><b>Add transfer function</b>: escribís el nombre y la función en la variable <code>s</code>, por ejemplo
<code>1/(1+s/1000)**2</code> o <code>(s**2+1e6)/(s**2+300*s+1e6)</code>. Después podés ver sus polos y ceros
(<b>Show poles and zeros</b>).</li>
<li><b>Add time response to TF</b>: con una transferencia elegida, calcula su respuesta en el tiempo. Escribís un nombre, la
entrada (<code>step</code>, <code>delta</code> o una expresión en <code>t</code> como <code>np.sin(2*np.pi*1000*t)</code>) y el
rango de tiempo. Se agregan las columnas nuevas al dataset.</li>
</ul>

<h4>Dataset elegido (panel izquierdo)</h4>
<ul>
<li><b>Title</b>: el nombre que se ve en la lista.</li>
<li><b>Add line</b>: agrega una curva del dataset. <b>Cases</b> / <b>Add case lines</b>: si el archivo trae varios casos
(simulaciones con <code>.step</code>), crea una curva por caso, con colores automáticos.</li>
<li><b>Remove dataset</b>: lo borra con todas sus líneas.</li>
</ul>

<h4>Línea elegida (panel derecho)</h4>
<ul>
<li><b>Name</b>: nombre en la leyenda (si empieza con <code>_</code> no aparece en la leyenda).</li>
<li><b>Render</b>: en cuál de los gráficos (Plot 1 a 5) se dibuja. Los gráficos 2 y 4 tienen dos zonas (por ejemplo módulo y fase
de un Bode).</li>
<li><b>Transform</b>: qué se hace con el dato antes de graficar: <code>|.|</code> módulo, <code>Arg(.)</code> fase en grados,
<code>20log(|.|)</code> módulo en dB, <code>unwrap</code> fase continua, etc.</li>
<li><b>X data / Y data</b>: qué columna va en cada eje (por ejemplo <code>time</code> y <code>V(out)</code>).</li>
<li><b>X scale, X offset, Y scale, Y offset</b>: multiplican y desplazan los datos (por ejemplo, pasar de V a mV).</li>
<li><b>Color</b>, <b>Line style</b>, <b>Line width</b>, <b>Dot style</b>, <b>Dot size</b>: el aspecto de la curva.</li>
<li><b>Sav-Gol wlen / ord</b>: suavizado Savitzky-Golay (ventana impar y orden del polinomio). Útil para limpiar ruido de una
medición.</li>
</ul>

<h4>Opciones del gráfico (<i>Plot options</i>)</h4>
<ul>
<li>Tamaños de letra de títulos, ejes, marcas y leyenda; posición de la leyenda (<i>None</i> la oculta); grilla; márgenes.</li>
<li><b>Autoscale plot</b>: vuelve a ajustar los ejes a los datos.</li>
</ul>

<h4>La barra de cada gráfico</h4>
<ul>
<li><b>Casa</b>: vista original. <b>Flechas</b>: vista anterior y siguiente. <b>Cruz</b>: mover (con el botón derecho hace zoom).
<b>Lupa</b>: zoom a un rectángulo.</li>
<li><b>Controles deslizantes</b>: márgenes de la figura. <b>Curva con lápiz</b> (<i>Customize</i>): títulos, rótulos y escalas
de los ejes (lineal o logarítmica) y nombre, color y estilo de cada curva.</li>
<li><b>Cruz punteada</b> (<i>Marks</i>): cursores, puntos y textos (ver abajo).</li>
<li><b>Disquete</b>: guarda el gráfico como imagen <code>PNG</code>, <code>PDF</code>, <code>SVG</code> o <code>JPG</code>.</li>
</ul>

<h4>Cursores, puntos y textos para el informe</h4>
<p>Con el botón <b>Marks</b> (cruz punteada) se abre una ventana para marcar lo importante del gráfico. Todo se dibuja en el
gráfico y <b>sale en la imagen cuando guardás</b>.</p>
<ul>
<li><b>Cursores</b>: líneas horizontales o verticales. Pueden ser <i>absolutas</i> (en un valor de los ejes: por ejemplo
<code>t = 5e-3</code>) o <i>relativas a los datos</i>: pegadas al mínimo, al máximo o al promedio de una curva, o al valor de la
curva en un punto dado. Si los datos cambian, el cursor se mueve solo. Podés escribir el valor al lado de la línea.</li>
<li><b>Puntos</b>: una marca (X, círculo, estrella, triángulo o cuadrado) en una posición absoluta o sobre una curva
(su mínimo, su máximo, o el punto donde pasa por un valor). Opcionalmente escribe sus coordenadas.</li>
<li><b>Textos</b>: etiquetas libres con el tamaño y el color que elijas. Admiten fórmulas, por ejemplo
<code>$f_0 = 1\\,kHz$</code>. <b>Elegir en el gráfico</b> te deja hacer clic donde querés ubicar la marca.</li>
<li>Cursores y puntos pueden aparecer o no en la <b>leyenda</b> (con el nombre que les pongas).</li>
</ul>

<h4>Guardar y abrir tu trabajo</h4>
<ul>
<li>Para el informe, usá el <b>disquete</b> de la barra del gráfico (imagen).</li>
<li>Para seguir otro día, el engranaje (arriba a la derecha) tiene <b>Guardar proyecto…</b> y <b>Abrir proyecto…</b>: baja y carga
un archivo <code>.pto</code> con tus datasets y líneas. Las marcas (cursores, puntos y textos) no van en el proyecto: se
guardan en la imagen.</li>
</ul>

<p class="nota">Esta es la versión de PlotTool que corre en el navegador (Python con NumPy, SciPy, SymPy y Matplotlib). Es el
programa original de Teoría de Circuitos II; la única opción que no funciona es exportar a LaTeX.</p>
"""
