"""Diálogos de la barra de matplotlib: guardar, ajustar subplots y 'Customize' (ejes y curvas)."""
import io

import matplotlib
from matplotlib.colors import to_hex

from . import _archivos
from ._dom import E, on
from .QtWidgets import _montar

LINEAS = {'-': 'Solid', '--': 'Dashed', '-.': 'Dash-dot', ':': 'Dotted', 'None': 'None'}
MARCAS = {'None': 'None', '.': 'Point', ',': 'Pixel', 'o': 'Circle', 'v': 'Triangle down', '^': 'Triangle up', '<': 'Triangle left', '>': 'Triangle right', 's': 'Square', 'p': 'Pentagon', '*': 'Star', 'h': 'Hexagon', '+': 'Plus', 'x': 'x', 'D': 'Diamond', 'd': 'Diamond (thin)', '|': 'Vline', '_': 'Hline'}


def _modal(titulo, cuerpo, on_ok, texto_ok='OK'):
    marco = E('div', 'qdlg-overlay show')
    win = E('div', 'qdlg')
    barra = E('div', 'qdlg-bar')
    barra.appendChild(E('span', '', titulo))
    x = E('button', 'qdlg-x', type='button')
    x.textContent = '×'
    barra.appendChild(x)
    pie = E('div', 'qdlg-foot')
    ok = E('button', 'qbtn qbbox-btn', texto_ok, type='button')
    cancel = E('button', 'qbtn qbbox-btn', 'Cancel', type='button')
    pie.appendChild(ok)
    pie.appendChild(cancel)
    cuerpo.classList.add('qdlg-body')
    win.appendChild(barra)
    win.appendChild(cuerpo)
    win.appendChild(pie)
    marco.appendChild(win)
    _montar().appendChild(marco)

    def cerrar(e=None):
        marco.remove()

    def aceptar(e=None):
        try:
            on_ok()
        finally:
            cerrar()

    on(x, 'click', cerrar)
    on(cancel, 'click', cerrar)
    on(ok, 'click', aceptar)
    on(marco, 'keydown', lambda e: cerrar() if e.key == 'Escape' else None)
    return marco


def _fila(tabla, etiqueta, control):
    tabla.appendChild(E('label', 'qform-l', etiqueta))
    tabla.appendChild(control)


def _entrada(valor, tipo='text'):
    i = E('input', 'qform-i', type=tipo)
    i.value = str(valor)
    return i


def _lista(opciones, actual):
    s = E('select', 'qform-i')
    for o in opciones:
        op = E('option')
        op.textContent = o
        s.appendChild(op)
    s.value = actual
    return s


# ---------------------------------------------------------------------------
def guardar(canvas):
    fig = canvas.figure
    cuerpo = E('div', 'qform')
    nombre = _entrada('plot')
    fmt = _lista(['pdf', 'png', 'svg', 'jpg'], str(matplotlib.rcParams['savefig.format']) if str(matplotlib.rcParams['savefig.format']) in ('pdf', 'png', 'svg', 'jpg') else 'png')
    _fila(cuerpo, 'File name', nombre)
    _fila(cuerpo, 'Format', fmt)

    def hacer():
        f = str(fmt.value)
        buf = io.BytesIO()
        fig.savefig(buf, format=f, dpi=200 if f in ('png', 'jpg') else None)
        mime = {'pdf': 'application/pdf', 'png': 'image/png', 'svg': 'image/svg+xml', 'jpg': 'image/jpeg'}[f]
        _archivos.descargar(f'{str(nombre.value).strip() or "plot"}.{f}', buf.getvalue(), mime)

    _modal('Choose a filename to save to', cuerpo, hacer, 'Save')


def subplots(canvas):
    fig = canvas.figure
    cuerpo = E('div', 'qform')
    sp = fig.subplotpars
    campos = {}
    for k in ('left', 'bottom', 'right', 'top', 'wspace', 'hspace'):
        i = _entrada(f'{getattr(sp, k):.3f}', 'number')
        i.step = '0.01'
        campos[k] = i
        _fila(cuerpo, k, i)

    def hacer():
        try:
            fig.set_tight_layout(False)
            fig.subplots_adjust(**{k: float(v.value) for k, v in campos.items()})
        except Exception:
            pass
        canvas.draw_idle()

    _modal('Configure subplots', cuerpo, hacer)


def parametros(canvas):
    """Ejes (título, límites, etiquetas, escala) y curvas (nombre, estilo, color, marcador)."""
    fig = canvas.figure
    ax = fig.axes[0]
    cuerpo = E('div', 'qform qform-grande')
    cuerpo.appendChild(E('h4', 'qform-h', 'Axes'))
    t = E('div', 'qform')
    cuerpo.appendChild(t)
    titulo = _entrada(ax.get_title())
    _fila(t, 'Title', titulo)
    campos = {}
    for eje in ('x', 'y'):
        lo, hi = getattr(ax, f'get_{eje}lim')()
        escala = getattr(ax, f'get_{eje}scale')()
        t.appendChild(E('h4', 'qform-h qform-span', f'{eje.upper()}-Axis'))
        mn, mx = _entrada(f'{lo:g}'), _entrada(f'{hi:g}')
        lab = _entrada(getattr(ax, f'get_{eje}label')())
        esc = _lista(['linear', 'log', 'symlog', 'logit'], escala if escala in ('linear', 'log', 'symlog', 'logit') else 'linear')
        for etq, ctl in (('Min', mn), ('Max', mx), ('Label', lab), ('Scale', esc)):
            _fila(t, etq, ctl)
        campos[eje] = (mn, mx, lab, esc)

    curvas = []
    lineas = [l for l in ax.get_lines() if not getattr(l, '_kum_marca', False)]  # sin los cursores y puntos del usuario
    if lineas:
        cuerpo.appendChild(E('h4', 'qform-h', 'Curves'))
    for l in lineas:
        caja = E('div', 'qform qform-curva')
        cuerpo.appendChild(caja)
        nombre = _entrada(l.get_label())
        estilo = _lista(list(LINEAS.values()), LINEAS.get(l.get_linestyle(), 'Solid'))
        ancho = _entrada(f'{l.get_linewidth():g}', 'number')
        ancho.step = '0.1'
        try:
            col = to_hex(l.get_color())
        except Exception:
            col = '#000000'
        color = _entrada(col, 'color')
        marca = _lista(list(MARCAS.values()), MARCAS.get(l.get_marker(), 'None'))
        tam = _entrada(f'{l.get_markersize():g}', 'number')
        tam.step = '0.1'
        for etq, ctl in (('Label', nombre), ('Line style', estilo), ('Width', ancho), ('Color', color), ('Marker', marca), ('Size', tam)):
            _fila(caja, etq, ctl)
        curvas.append((l, nombre, estilo, ancho, color, marca, tam))

    leyenda = E('input', type='checkbox')
    fila_leyenda = E('label', 'qform-chk')
    fila_leyenda.appendChild(leyenda)
    fila_leyenda.appendChild(E('span', '', '(Re-)Generate automatic legend'))
    cuerpo.appendChild(fila_leyenda)

    def hacer():
        ax.set_title(str(titulo.value))
        for eje, (mn, mx, lab, esc) in campos.items():
            getattr(ax, f'set_{eje}scale')(str(esc.value))
            try:
                getattr(ax, f'set_{eje}lim')(float(mn.value), float(mx.value))
            except Exception:
                pass
            getattr(ax, f'set_{eje}label')(str(lab.value))
        inv_l = {v: k for k, v in LINEAS.items()}
        inv_m = {v: k for k, v in MARCAS.items()}
        for l, nombre, estilo, ancho, color, marca, tam in curvas:
            l.set_label(str(nombre.value))
            l.set_linestyle(inv_l.get(str(estilo.value), '-'))
            try:
                l.set_linewidth(float(ancho.value))
                l.set_markersize(float(tam.value))
            except Exception:
                pass
            l.set_color(str(color.value))
            l.set_marker(inv_m.get(str(marca.value), 'None'))
        if leyenda.checked:
            ax.legend()
        canvas.draw_idle()

    _modal('Figure options', cuerpo, hacer)
