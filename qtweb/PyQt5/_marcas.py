"""Cursores, puntos y textos sobre los gráficos de matplotlib.

Todo se dibuja como artistas del gráfico (líneas y textos), así que sale en la imagen cuando se aprieta "guardar".
Las marcas se describen con diccionarios (cursores, puntos, textos) que se guardan en el canvas; en cada dibujo se
vuelven a crear, de modo que sobreviven a que la aplicación borre y rehaga las curvas, y las marcas que dependen de
los datos (mínimo, máximo...) se recalculan solas.

La primera parte (motor) solo usa numpy y matplotlib; el diálogo (segunda parte) usa el navegador."""
import numpy as np
from matplotlib.lines import Line2D

ESTILOS = {'-': 'Continua', '--': 'Rayas', ':': 'Puntos', '-.': 'Raya y punto'}
MARCAS = {'x': 'X', 'o': 'Círculo', '*': 'Estrella', '^': 'Triángulo', 's': 'Cuadrado'}
COLORES = ['#d62728', '#2ca02c', '#9467bd', '#ff7f0e', '#17becf', '#8c564b']
RASGOS_H = {'min': 'Mínimo de la curva', 'max': 'Máximo de la curva', 'media': 'Promedio de la curva', 'en': 'Valor de la curva en x ='}
RASGOS_V = {'min': 'x del mínimo', 'max': 'x del máximo', 'en': 'x donde la curva vale y ='}
RASGOS_P = {'min': 'Mínimo de la curva', 'max': 'Máximo de la curva', 'en_x': 'Sobre la curva, en x =', 'en_y': 'Sobre la curva, donde vale y ='}
ZORDER = 8


# ---------------------------------------------------------------------------
# Estado
def estado(canvas):
    if getattr(canvas, '_kum', None) is None:
        canvas._kum = {'cursores': [], 'puntos': [], 'textos': []}
    return canvas._kum


def hay_marcas(canvas):
    e = getattr(canvas, '_kum', None)
    return bool(e and (e['cursores'] or e['puntos'] or e['textos']))


def _ax(canvas):
    axs = canvas.figure.axes
    return axs[0] if axs else None


def centro(ax, eje):
    lo, hi = ax.get_xlim() if eje == 'x' else ax.get_ylim()
    esc = ax.get_xscale() if eje == 'x' else ax.get_yscale()
    if esc == 'log' and lo > 0 and hi > 0:
        return float(np.sqrt(lo * hi))
    return float((lo + hi) / 2)


def nuevo_cursor(canvas):
    ax = _ax(canvas)
    n = len(estado(canvas)['cursores'])
    return {'dir': 'H', 'modo': 'abs', 'valor': f'{centro(ax, "y"):.6g}' if ax else '0', 'curva': '', 'rasgo': 'min', 'arg': '0',
            'color': COLORES[n % len(COLORES)], 'estilo': '--', 'ancho': 1.2, 'etiqueta': '', 'leyenda': False, 'mostrar': True}


def nuevo_punto(canvas):
    ax = _ax(canvas)
    n = len(estado(canvas)['puntos'])
    return {'modo': 'abs', 'x': f'{centro(ax, "x"):.6g}' if ax else '0', 'y': f'{centro(ax, "y"):.6g}' if ax else '0', 'curva': '',
            'rasgo': 'min', 'arg': '0', 'marca': 'x', 'tam': 10, 'color': COLORES[n % len(COLORES)], 'etiqueta': '', 'leyenda': False, 'mostrar': True}


def nuevo_texto(canvas):
    ax = _ax(canvas)
    return {'texto': 'Texto', 'coord': 'datos', 'x': f'{centro(ax, "x"):.6g}' if ax else '0', 'y': f'{centro(ax, "y"):.6g}' if ax else '0',
            'tam': 12, 'color': '#000000'}


# ---------------------------------------------------------------------------
# Datos de las curvas
def num(x):
    """Número escrito por el usuario (acepta coma decimal y notación científica); None si no es válido."""
    try:
        v = float(str(x).strip().replace(',', '.'))
    except (TypeError, ValueError):
        return None
    return v if np.isfinite(v) else None


def curvas(ax):
    return [l for l in ax.get_lines() if not getattr(l, '_kum_marca', False)]


def nombre_curva(l, i):
    n = str(l.get_label())
    return n if n and not n.startswith('_') else f'Curva {i + 1}'


def nombres_curvas(ax):
    return [nombre_curva(l, i) for i, l in enumerate(curvas(ax))]


def buscar(lineas, nombre):
    for i, l in enumerate(lineas):
        if nombre_curva(l, i) == nombre:
            return l
    return None


def datos(l):
    try:
        xs = np.real(np.asarray(l.get_xdata(orig=False))).astype(float)
        ys = np.real(np.asarray(l.get_ydata(orig=False))).astype(float)
        n = min(xs.size, ys.size)
        xs, ys = xs[:n], ys[:n]
        ok = np.isfinite(xs) & np.isfinite(ys)
        return xs[ok], ys[ok]
    except Exception:
        return np.array([]), np.array([])


def _en_x(xs, ys, x0):
    if xs.size == 0 or x0 < xs.min() or x0 > xs.max():
        return None
    o = np.argsort(xs, kind='stable')
    return float(np.interp(x0, xs[o], ys[o]))


def _cruce(xs, ys, y0):
    """Primer x (en el orden de los datos) donde la curva cruza el nivel y0."""
    if xs.size == 0:
        return None
    d = ys - y0
    exacto = np.where(d == 0)[0]
    cambio = np.where(d[:-1] * d[1:] < 0)[0]
    cand = []
    if exacto.size:
        cand.append((exacto[0], float(xs[exacto[0]])))
    if cambio.size:
        i = cambio[0]
        cand.append((i, float(xs[i] + (xs[i + 1] - xs[i]) * (0 - d[i]) / (d[i + 1] - d[i]))))
    if not cand:
        return None
    return min(cand)[1]


def valor_cursor(c, lineas):
    """Posición del cursor (y si es horizontal, x si es vertical) o None si no se puede calcular."""
    if c['modo'] == 'abs':
        return num(c['valor'])
    l = buscar(lineas, c.get('curva', ''))
    if l is None:
        return None
    xs, ys = datos(l)
    if xs.size == 0:
        return None
    r, a = c['rasgo'], num(c.get('arg'))
    if c['dir'] == 'H':
        if r == 'min':
            return float(ys.min())
        if r == 'max':
            return float(ys.max())
        if r == 'media':
            return float(ys.mean())
        return None if a is None else _en_x(xs, ys, a)
    if r == 'min':
        return float(xs[np.argmin(ys)])
    if r == 'max':
        return float(xs[np.argmax(ys)])
    return None if a is None else _cruce(xs, ys, a)


def valor_punto(p, lineas):
    """(x, y) del punto o None."""
    if p['modo'] == 'abs':
        x, y = num(p['x']), num(p['y'])
        return None if x is None or y is None else (x, y)
    l = buscar(lineas, p.get('curva', ''))
    if l is None:
        return None
    xs, ys = datos(l)
    if xs.size == 0:
        return None
    r, a = p['rasgo'], num(p.get('arg'))
    if r == 'min':
        i = int(np.argmin(ys))
        return float(xs[i]), float(ys[i])
    if r == 'max':
        i = int(np.argmax(ys))
        return float(xs[i]), float(ys[i])
    if a is None:
        return None
    if r == 'en_x':
        y = _en_x(xs, ys, a)
        return None if y is None else (a, y)
    x = _cruce(xs, ys, a)
    return None if x is None else (x, a)


# ---------------------------------------------------------------------------
# Dibujo
def _g(v):
    return f'{v:.4g}'


def _poner(ax, a, en_leyenda, etiqueta, leyenda, agregar=True):
    a._kum_marca = True
    a.set_zorder(ZORDER)
    if agregar:  # los textos de ax.text / ax.annotate ya quedaron agregados
        ax.add_artist(a)
    ax._kum_artistas.append(a)
    if hasattr(a, 'set_label'):
        a.set_label(etiqueta if leyenda else '_nolegend_')
    if leyenda:
        en_leyenda.append(a)


def aplicar(canvas, ax):
    """Quita las marcas anteriores y las vuelve a crear. Devuelve los artistas que van en la leyenda."""
    _asegurar(canvas, ax)
    for a in list(getattr(ax, '_kum_artistas', [])):
        try:
            a.remove()
        except Exception:
            pass
    ax._kum_artistas = []
    est = getattr(canvas, '_kum', None)
    en_leyenda = []
    if not est:
        return en_leyenda
    lineas = curvas(ax)
    res = {}
    for c in est['cursores']:
        v = valor_cursor(c, lineas)
        res[id(c)] = v
        if v is None:
            continue
        if c['dir'] == 'H':
            l = Line2D([0, 1], [v, v], transform=ax.get_yaxis_transform())
        else:
            l = Line2D([v, v], [0, 1], transform=ax.get_xaxis_transform())
        l.set_color(c['color'])
        l.set_linestyle(c['estilo'])
        l.set_linewidth(float(c['ancho']))
        _poner(ax, l, en_leyenda, c['etiqueta'] or (f'y = {_g(v)}' if c['dir'] == 'H' else f'x = {_g(v)}'), c['leyenda'])
        if c['mostrar']:
            if c['dir'] == 'H':
                t = ax.text(0.99, v, _g(v), transform=ax.get_yaxis_transform(), ha='right', va='bottom', color=c['color'], fontsize=10)
            else:
                t = ax.text(v, 0.99, _g(v), transform=ax.get_xaxis_transform(), ha='right', va='top', rotation=90, color=c['color'], fontsize=10)
            _poner(ax, t, en_leyenda, '', False, False)
    for p in est['puntos']:
        xy = valor_punto(p, lineas)
        res[id(p)] = xy
        if xy is None:
            continue
        x, y = xy
        m = Line2D([x], [y], linestyle='none', marker=p['marca'], markersize=float(p['tam']), color=p['color'], markeredgewidth=1.6)
        _poner(ax, m, en_leyenda, p['etiqueta'] or f'({_g(x)}, {_g(y)})', p['leyenda'])
        if p['mostrar']:
            t = ax.annotate(f'({_g(x)}, {_g(y)})', (x, y), xytext=(8, 8), textcoords='offset points', color=p['color'], fontsize=10, annotation_clip=False)
            _poner(ax, t, en_leyenda, '', False, False)
    for tx in est['textos']:
        x, y = num(tx['x']), num(tx['y'])
        res[id(tx)] = None if x is None or y is None else (x, y)
        if x is None or y is None or not str(tx['texto']).strip():
            continue
        tr = ax.transAxes if tx['coord'] == 'ejes' else ax.transData
        t = ax.text(x, y, str(tx['texto']), transform=tr, fontsize=float(tx['tam']), color=tx['color'], ha='left', va='bottom', clip_on=False)
        _poner(ax, t, en_leyenda, '', False, False)
    est['_res'] = res
    return en_leyenda


# ---------------------------------------------------------------------------
# Leyenda y enganche con el canvas
def _asegurar(canvas, ax):
    """Envuelve ax.legend para que la leyenda de la aplicación incluya las marcas que piden estar en ella."""
    if getattr(ax, '_kum_orig_legend', None) is not None:
        return
    orig = ax.legend
    ax._kum_orig_legend = orig
    ax._kum_artistas = []
    ax._kum_forzada = False
    ax._kum_leyenda_args = ((), {})

    def legend(*args, **kw):
        ax._kum_leyenda_args = (args, dict(kw))
        ax._kum_forzada = False
        marcas = aplicar(canvas, ax)
        if marcas and 'handles' in kw and not args:
            kw = dict(kw)
            kw['handles'] = list(kw['handles']) + [m for m in marcas if m not in kw['handles']]
        return orig(*args, **kw)

    ax.legend = legend


def instalar(canvas):
    for ax in canvas.figure.axes:
        _asegurar(canvas, ax)


def _sincronizar_leyenda(ax, marcas, reconstruir):
    leg = ax.get_legend()
    if marcas and leg is None:
        ax._kum_orig_legend(loc='best')
        ax._kum_forzada = True
    elif not marcas and leg is not None and ax._kum_forzada:
        leg.remove()
        ax._kum_forzada = False
    elif reconstruir and leg is not None and not ax._kum_forzada:
        args, kw = ax._kum_leyenda_args
        kw = dict(kw)
        if 'handles' in kw and not args:
            kw['handles'] = list(kw['handles']) + [m for m in marcas if m not in kw['handles']]
        ax._kum_orig_legend(*args, **kw)
    elif reconstruir and leg is not None and ax._kum_forzada:
        ax._kum_orig_legend(loc='best')


def en_dibujo(canvas):
    """Se llama antes de cada dibujo del canvas."""
    for ax in canvas.figure.axes:
        marcas = aplicar(canvas, ax)
        _sincronizar_leyenda(ax, marcas, False)


def refrescar(canvas):
    """Se llama después de cambiar las marcas desde el diálogo."""
    ax = _ax(canvas)
    if ax is None:
        return
    marcas = aplicar(canvas, ax)
    _sincronizar_leyenda(ax, marcas, True)
    canvas.draw_idle()
