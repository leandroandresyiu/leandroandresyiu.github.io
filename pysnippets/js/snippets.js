// Galería de snippets de py snippets. Los ___ son los datos que hay que completar: se tocan (o Tab) y se escribe encima.
// Todo el código es propio de kumOS; los temas siguen el temario de Teoría de Circuitos II (SymPy y SciPy para el análisis de circuitos).
export const GRUPOS = [
	{ id: 'circuitos', titulo: 'Circuitos (LTspice)', nota: 'Leen el esquema .asc, reemplazan los transistores por su modelo de pequeña señal y calculan con Lcapy.' },
	{ id: 'sympy', titulo: 'Álgebra con SymPy', nota: 'Cálculo simbólico: simplificar, despejar, polinomios, Laplace.' },
	{ id: 'scipy', titulo: 'Señales con SciPy', nota: 'Sistemas LTI numéricos: Bode, escalón, simulación.' },
	{ id: 'graficos', titulo: 'Gráficos', nota: 'Matplotlib para informes.' },
];

export const SNIPPETS = [
	// ------------------------------------------------------------------------------------------ circuitos
	{
		g: 'circuitos',
		titulo: 'Cargar un esquema .asc',
		desc: 'Lee el esquema de LTspice, calcula la continua y arma el circuito de pequeña señal.',
		claves: 'asc ltspice esquema cargar circuito punto de operación',
		codigo: `# Lee el esquema (los .asc de Archivo y los que subís están disponibles por su nombre)
c = cargar_asc("___.asc")
c`,
	},
	{
		g: 'circuitos',
		titulo: 'Transferencia H(s)',
		desc: 'Vsalida / Ventrada entre una fuente (o un nodo) y un nodo de salida.',
		claves: 'transferencia h(s) ganancia función transferencia lcapy',
		codigo: `# entrada: nombre de la fuente (V1) o de un nodo. salida: nodo, o dos nodos para una tensión diferencial
H = c.H("___", "___")
bonito(H)`,
	},
	{
		g: 'circuitos',
		titulo: 'Impedancia vista desde un nodo',
		desc: 'Lo que se ve mirando desde un nodo hacia el resto del circuito, con las fuentes anuladas.',
		claves: 'impedancia z vista entrada salida nodo thevenin',
		codigo: `Z = c.Z_visto("___")
bonito(Z)`,
	},
	{
		g: 'circuitos',
		titulo: 'Impedancia vista hacia una rama',
		desc: 'Como la anterior, pero contando solo una rama: por ejemplo hacia="Q1" es lo que ve la fuente mirando la base.',
		claves: 'impedancia hacia rama transistor base emisor colector z de entrada',
		codigo: `# nodo: donde se mira. hacia: componente que se deja (R3, C1, Q1...). Los demás que tocan ese nodo se sacan.
Z = c.Z_visto("___", hacia="___")
bonito(Z)`,
	},
	{
		g: 'circuitos',
		titulo: 'Impedancia entre dos nodos',
		desc: 'Z entre dos nodos cualesquiera con las fuentes anuladas.',
		claves: 'impedancia entre dos nodos z',
		codigo: `Z = c.Z("___", "___")
bonito(Z)`,
	},
	{
		g: 'circuitos',
		titulo: 'Bode de H(s)',
		desc: 'Módulo en dB y fase. Los límites de frecuencia son opcionales.',
		claves: 'bode diagrama módulo fase respuesta en frecuencia',
		codigo: `bode(H, fmin=___, fmax=___)   # en Hz; sacalos para que se elijan solos`,
	},
	{
		g: 'circuitos',
		titulo: 'Polos y ceros',
		desc: 'Los polos y ceros en rad/s y los polos también en Hz.',
		claves: 'polos ceros raíces estabilidad',
		codigo: `ceros, polos = polos_ceros(H)`,
	},
	{
		g: 'circuitos',
		titulo: 'Respuesta al escalón',
		desc: 'Salida cuando la entrada pasa de 0 a 1 en t = 0.',
		claves: 'escalón step respuesta temporal transitorio',
		codigo: `escalon(H, tmax=___)   # en segundos`,
	},
	{
		g: 'circuitos',
		titulo: 'Ganancia en una frecuencia',
		desc: 'Módulo en dB y fase de H a una frecuencia (o varias).',
		claves: 'ganancia frecuencia módulo fase evaluar valor numérico',
		codigo: `f = ___   # Hz (un número o np.array([...]))
Hf = evaluar(H, f)
print("módulo:", 20*np.log10(abs(Hf)), "dB")
print("fase:", np.angle(Hf, deg=True), "°")`,
	},
	{
		g: 'circuitos',
		titulo: 'Punto de operación y pequeña señal del transistor',
		desc: 'Ic, Vce, gm, rπ, ro y las capacidades que se usaron en el modelo.',
		claves: 'transistor bjt gm rpi ro punto de operación polarización pequeña señal modelo híbrido',
		codigo: `q = c.bjt["___"]   # nombre del transistor: Q1
for k in ("Ic", "Vce", "gm", "rpi", "ro", "Cpi", "Cmu"):
    print(f"{k:4s} = {q[k]:.4g}")`,
	},
	{
		g: 'circuitos',
		titulo: 'Tensión continua de un nodo',
		desc: 'El valor en el punto de operación.',
		claves: 'continua dc tensión nodo polarización',
		codigo: `c.tension_dc("___")`,
	},
	{
		g: 'circuitos',
		titulo: 'Netlist de pequeña señal',
		desc: 'El circuito lineal que usa Lcapy, para revisar que está bien armado.',
		claves: 'netlist lcapy circuito linealizado',
		codigo: `print(c.netlist)`,
	},
	// ------------------------------------------------------------------------------------------ sympy
	{
		g: 'sympy',
		titulo: 'Variables simbólicas',
		desc: 'Crear símbolos para trabajar con fórmulas.',
		claves: 'symbols símbolos variables',
		codigo: `s, w, R, C = sp.symbols("s w R C", positive=True)
H = 1 / (1 + s*R*C)
H`,
	},
	{
		g: 'sympy',
		titulo: 'Simplificar, factorizar y expandir',
		desc: 'Ordenar una expresión de distintas maneras.',
		claves: 'simplify cancel factor expand simplificar',
		codigo: `expr = ___
sp.simplify(expr)   # probá también sp.factor(expr), sp.expand(expr) o sp.cancel(expr)`,
	},
	{
		g: 'sympy',
		titulo: 'Resolver una ecuación',
		desc: 'Despejar una incógnita.',
		claves: 'solve ecuación despejar igualdad',
		codigo: `x = sp.Symbol("___")
sp.solve(sp.Eq(___, ___), x)`,
	},
	{
		g: 'sympy',
		titulo: 'Sistema de ecuaciones (mallas o nodos)',
		desc: 'Resuelve varias ecuaciones a la vez.',
		claves: 'sistema ecuaciones mallas nodos kirchhoff solve',
		codigo: `V1, V2 = sp.symbols("V1 V2")
sp.solve([
    sp.Eq(___, ___),
    sp.Eq(___, ___),
], [V1, V2])`,
	},
	{
		g: 'sympy',
		titulo: 'Polinomio: coeficientes y raíces',
		desc: 'Raíces numéricas de un polinomio en s.',
		claves: 'poly raíces coeficientes polinomio roots nroots',
		codigo: `s = sp.Symbol("s")
p = sp.Poly(___, s)
print(p.all_coeffs())
p.nroots()`,
	},
	{
		g: 'sympy',
		titulo: 'Fracciones parciales',
		desc: 'Descomponer una transferencia para antitransformar.',
		claves: 'apart fracciones parciales descomponer',
		codigo: `s = sp.Symbol("s")
sp.apart(___, s)`,
	},
	{
		g: 'sympy',
		titulo: 'Transformada inversa de Laplace',
		desc: 'De F(s) a f(t).',
		claves: 'laplace inversa antitransformada tiempo',
		codigo: `s = sp.Symbol("s")
t = sp.Symbol("t", positive=True)
sp.inverse_laplace_transform(___, s, t)`,
	},
	{
		g: 'sympy',
		titulo: 'Reemplazar valores',
		desc: 'Evaluar una fórmula con números.',
		claves: 'subs sustituir reemplazar valores numérico evalf',
		codigo: `valores = {R: ___, C: ___}
H.subs(valores).evalf(5)`,
	},
	{
		g: 'sympy',
		titulo: 'Límite',
		desc: 'Comportamiento cuando una variable tiende a un valor.',
		claves: 'limit límite infinito tiende',
		codigo: `sp.limit(___, ___, ___)   # expresión, variable, a dónde tiende (sp.oo es infinito)`,
	},
	{
		g: 'sympy',
		titulo: 'Derivada e integral',
		desc: 'Derivar e integrar una expresión.',
		claves: 'diff integrate derivada integral',
		codigo: `x = sp.Symbol("x")
f = ___
print(sp.diff(f, x))
sp.integrate(f, x)`,
	},
	// ------------------------------------------------------------------------------------------ scipy
	{
		g: 'scipy',
		titulo: 'Sistema a partir de numerador y denominador',
		desc: 'Los coeficientes van de la potencia más alta a la más baja.',
		claves: 'lti transferfunction transferencia coeficientes numerador denominador',
		codigo: `# H(s) = (b0 s^m + ... ) / (a0 s^n + ...)
sistema = signal.TransferFunction([___], [___, ___, ___])`,
	},
	{
		g: 'scipy',
		titulo: 'Sistema a partir de polos y ceros',
		desc: 'Con la ganancia k.',
		claves: 'zpk polos ceros ganancia zerospolesgain',
		codigo: `sistema = signal.ZerosPolesGain([___], [___, ___], ___)   # ceros, polos (rad/s), ganancia`,
	},
	{
		g: 'scipy',
		titulo: 'Bode numérico',
		desc: 'Módulo y fase de un sistema en un barrido de frecuencias.',
		claves: 'bode freqs módulo fase barrido',
		codigo: `f = np.logspace(___, ___, 400)   # exponentes: 1 a 6 es de 10 Hz a 1 MHz
w, mag, fase = signal.bode(sistema, 2*np.pi*f)
plt.figure(figsize=(7, 4))
plt.semilogx(f, mag)
plt.xlabel("f [Hz]"); plt.ylabel("|H| [dB]")
plt.grid(True, which="both", alpha=0.3)`,
	},
	{
		g: 'scipy',
		titulo: 'Respuesta al escalón o al impulso',
		desc: 'Respuesta temporal de un sistema.',
		claves: 'step impulse escalón impulso respuesta temporal',
		codigo: `t, y = signal.step(sistema, T=np.linspace(0, ___, 600))   # segundos; signal.impulse para el impulso
plt.figure(figsize=(7, 3.5))
plt.plot(t, y)
plt.xlabel("t [s]"); plt.grid(True, alpha=0.3)`,
	},
	{
		g: 'scipy',
		titulo: 'Respuesta a una señal cualquiera',
		desc: 'Simula la salida para una entrada que definís vos (lsim).',
		claves: 'lsim simular señal entrada senoidal cuadrada',
		codigo: `t = np.linspace(0, ___, 2000)
entrada = np.sin(2*np.pi*___*t)   # frecuencia en Hz
t, salida, _ = signal.lsim(sistema, entrada, t)
plt.figure(figsize=(7, 3.5))
plt.plot(t, entrada, label="entrada")
plt.plot(t, salida, label="salida")
plt.legend(); plt.xlabel("t [s]"); plt.grid(True, alpha=0.3)`,
	},
	{
		g: 'scipy',
		titulo: 'Polos y ceros de un sistema',
		desc: 'Raíces del numerador y del denominador.',
		claves: 'polos ceros roots sistema',
		codigo: `print("ceros:", sistema.zeros)
print("polos:", sistema.poles)`,
	},
	// ------------------------------------------------------------------------------------------ gráficos
	{
		g: 'graficos',
		titulo: 'Gráfico x–y',
		desc: 'Una curva con ejes y rejilla.',
		claves: 'plot gráfico curva matplotlib',
		codigo: `x = np.linspace(___, ___, 400)
y = ___
plt.figure(figsize=(7, 3.8))
plt.plot(x, y)
plt.xlabel("___"); plt.ylabel("___")
plt.grid(True, alpha=0.3)`,
	},
	{
		g: 'graficos',
		titulo: 'Gráfico con eje de frecuencia logarítmico',
		desc: 'Para respuestas en frecuencia.',
		claves: 'semilogx logarítmico frecuencia db',
		codigo: `f = np.logspace(1, 6, 400)
y = 20*np.log10(abs(evaluar(___, f)))   # evaluar(H, f) da H(j2πf)
plt.figure(figsize=(7, 3.8))
plt.semilogx(f, y)
plt.xlabel("f [Hz]"); plt.ylabel("|H| [dB]")
plt.grid(True, which="both", alpha=0.3)`,
	},
	{
		g: 'graficos',
		titulo: 'Dos curvas para comparar',
		desc: 'Con leyenda.',
		claves: 'comparar curvas leyenda dos gráficos',
		codigo: `x = np.linspace(___, ___, 400)
plt.figure(figsize=(7, 3.8))
plt.plot(x, ___, label="___")
plt.plot(x, ___, label="___")
plt.legend(); plt.grid(True, alpha=0.3)`,
	},
];

/** Cuaderno con el que se abre la herramienta la primera vez. */
export const CUADERNO_INICIAL = [
	{ tipo: 'texto', texto: '# py snippets\nCada celda es código de Python. **Shift + Enter** la ejecuta. Los recuadros naranjas `___` son datos para completar: tocalos y escribí encima; con **Tab** saltás al siguiente.\nA la derecha están los snippets: tocá uno para sumarlo como celda nueva.' },
	{ tipo: 'texto', texto: '## Ejemplo: amplificador de emisor común\nEl esquema `amplificador_ce.asc` ya está cargado. Se lee, se calcula el punto de operación y el transistor se reemplaza por su modelo de pequeña señal.' },
	{ tipo: 'codigo', texto: 'c = cargar_asc("amplificador_ce.asc")\nc' },
	{ tipo: 'codigo', texto: '# Ganancia de tensión de la fuente V1 al nodo OUT\nH = c.H("V1", "OUT")\nbonito(H)' },
	{ tipo: 'codigo', texto: 'bode(H)' },
	{ tipo: 'codigo', texto: '# Qué ve la fuente mirando la base del transistor\nZb = c.Z_visto("B", hacia="Q1")\nbonito(Zb)' },
];
