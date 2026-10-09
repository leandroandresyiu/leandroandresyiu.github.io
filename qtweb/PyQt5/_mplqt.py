"""Reemplazo de matplotlib.backends.backend_qt5agg: el gráfico se dibuja en un <canvas> del navegador y la
barra de herramientas es la de matplotlib (Home, Back, Forward, Pan, Zoom...) con sus mismos íconos."""
import base64
import io
import os

import js
import matplotlib
from matplotlib.backend_bases import LocationEvent, MouseButton, MouseEvent, NavigationToolbar2, _Mode, cursors
from matplotlib.backends.backend_agg import FigureCanvasAgg

from . import _archivos, _marcas
from ._dom import E, document, frame, on
from .QtWidgets import QSizePolicy, QWidget

_ICONOS = {}

# Ícono propio del botón de cursores, puntos y textos (cruz punteada con un punto, en el estilo de los de matplotlib).
_SVG_MARCAS = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><g fill="none" stroke="#000" stroke-width="1.7">'
    '<path d="M2.5 12h19M12 2.5v19" stroke-dasharray="3 2.2"/><circle cx="12" cy="12" r="4.6" fill="#fff"/></g>'
    '<circle cx="12" cy="12" r="2" fill="#000"/></svg>'
)


def _icono(nombre):
    """Ícono de la barra como data-URL (usa los PNG grandes de matplotlib, o el SVG)."""
    if nombre in _ICONOS:
        return _ICONOS[nombre]
    if nombre == 'kum_marcas':
        _ICONOS[nombre] = 'data:image/svg+xml;base64,' + base64.b64encode(_SVG_MARCAS.encode()).decode()
        return _ICONOS[nombre]
    base = os.path.join(matplotlib.get_data_path(), 'images')
    for ext, mime in (('_large.png', 'image/png'), ('.svg', 'image/svg+xml'), ('.png', 'image/png')):
        ruta = os.path.join(base, nombre + ext)
        if os.path.exists(ruta):
            with open(ruta, 'rb') as f:
                url = f'data:{mime};base64,' + base64.b64encode(f.read()).decode()
            _ICONOS[nombre] = url
            return url
    _ICONOS[nombre] = ''
    return ''


class FigureCanvasQTAgg(FigureCanvasAgg, QWidget):
    """Canvas de matplotlib dentro de un widget."""

    def __init__(self, figure=None):
        FigureCanvasAgg.__init__(self, figure)
        QWidget.__init__(self, None)
        self._hp, self._vp = QSizePolicy.Expanding, QSizePolicy.Expanding
        self.el.className = 'qw qcanvas'
        self._cv = E('canvas', 'qcanvas-main')
        self._ov = E('canvas', 'qcanvas-over')
        self.el.appendChild(self._cv)
        self.el.appendChild(self._ov)
        self._ctx = self._cv.getContext('2d')
        self._pendiente = False
        self._tam = (0, 0)
        self._dpr = float(js.devicePixelRatio or 1)
        self._base_dpi = float(self.figure.dpi)
        self._set_device_pixel_ratio(self._dpr)
        self.toolbar = None
        _marcas.instalar(self)

        from pyodide.ffi import create_proxy

        obs = js.ResizeObserver.new(create_proxy(lambda *a: self._redimensionar()))
        obs.observe(self.el)
        on(self._cv, 'pointerdown', lambda e: self._raton('button_press_event', e))
        on(self._cv, 'pointerup', lambda e: self._raton('button_release_event', e))
        on(self._cv, 'pointermove', lambda e: self._raton('motion_notify_event', e))
        on(self._cv, 'pointerleave', lambda e: self._salio(e))
        on(self._cv, 'contextmenu', lambda e: e.preventDefault())
        on(self._cv, 'dblclick', lambda e: self._raton('button_press_event', e, doble=True))

    # ---- tamaño ----
    def _redimensionar(self):
        w, h = int(self.el.clientWidth), int(self.el.clientHeight)
        if w <= 0 or h <= 0 or (w, h) == self._tam:
            return
        self._tam = (w, h)
        self._cv.width = self._ov.width = int(round(w * self._dpr))
        self._cv.height = self._ov.height = int(round(h * self._dpr))
        self._cv.style.width = self._ov.style.width = f'{w}px'
        self._cv.style.height = self._ov.style.height = f'{h}px'
        self.figure.set_size_inches((w + 1e-3) / self._base_dpi, (h + 1e-3) / self._base_dpi, forward=False)
        self.draw_idle()

    def get_width_height(self, *, physical=False):
        w, h = self._tam
        return (int(w * self._dpr), int(h * self._dpr)) if physical else (w, h)

    # ---- dibujo ----
    def draw(self):
        try:
            _marcas.en_dibujo(self)  # cursores, puntos y textos del usuario
        except Exception as e:  # nunca debe impedir que se dibuje el gráfico
            js.console.warn('marcas: ' + str(e))
        FigureCanvasAgg.draw(self)
        self._pintar()

    def draw_idle(self, *a, **k):
        if self._pendiente:
            return
        self._pendiente = True

        def ahora(t=None):
            self._pendiente = False
            if self._tam[0] > 0:
                self.draw()

        frame(ahora)

    def _pintar(self):
        buf = self.buffer_rgba()
        h, w = buf.shape[0], buf.shape[1]
        if self._cv.width != w or self._cv.height != h:
            # matplotlib redondea hacia abajo (por ejemplo 1019 en vez de 1020): se ajusta el lienzo a lo dibujado.
            self._cv.width = w
            self._cv.height = h
        arr = js.Uint8ClampedArray.new(w * h * 4)
        arr.assign(buf)
        self._ctx.putImageData(js.ImageData.new(arr, w, h), 0, 0)

    # ---- mouse ----
    def _pos(self, e):
        r = self._cv.getBoundingClientRect()
        k = (r.width / self._cv.clientWidth) if self._cv.clientWidth else 1  # la ventana puede estar achicada
        x = (e.clientX - r.left) / k * self._dpr
        y = (r.height / k - (e.clientY - r.top) / k) * self._dpr
        return x, y

    def _raton(self, nombre, e, doble=False):
        x, y = self._pos(e)
        boton = {0: MouseButton.LEFT, 1: MouseButton.MIDDLE, 2: MouseButton.RIGHT}.get(int(e.button), MouseButton.LEFT)
        if nombre == 'button_press_event':
            try:
                self._cv.setPointerCapture(e.pointerId)
            except Exception:
                pass
        if nombre == 'motion_notify_event':
            botones = set()
            if int(e.buttons) & 1:
                botones.add(MouseButton.LEFT)
            if int(e.buttons) & 4:
                botones.add(MouseButton.MIDDLE)
            if int(e.buttons) & 2:
                botones.add(MouseButton.RIGHT)
            ev = MouseEvent(nombre, self, x, y, button=None, key=None, buttons=botones)
        else:
            ev = MouseEvent(nombre, self, x, y, button=boton, key=None, dblclick=doble)
        ev._process()

    def _salio(self, e):
        x, y = self._pos(e)
        LocationEvent('figure_leave_event', self, x, y)._process()

    # ---- compatibilidad con el canvas de Qt ----
    def resizeEvent(self, *a):
        self._redimensionar()

    def setSizePolicy(self, h, v=None, *a):
        QWidget.setSizePolicy(self, h, v)

    def get_default_filename(self):
        return 'plot'


class NavigationToolbar2QT(NavigationToolbar2, QWidget):
    """Barra de matplotlib: mismos botones e íconos que la versión de Qt."""

    toolitems = [*NavigationToolbar2.toolitems]
    toolitems.insert(
        [n for n, *_ in toolitems].index('Subplots') + 1,
        ('Customize', 'Edit axis, curve and image parameters', 'qt4_editor_options', 'edit_parameters'),
    )
    toolitems.insert(
        [n for n, *_ in toolitems].index('Customize') + 1,
        ('Marks', 'Cursors, points and text labels (they are saved with the figure)', 'kum_marcas', 'marcas'),
    )

    def __init__(self, canvas, parent=None, coordinates=True):
        QWidget.__init__(self, parent)
        self.el.className = 'qw qmpltb'
        self._btn = {}
        self._coord = E('span', 'qmpltb-msg')
        self._cvs = canvas
        self._init_toolbar()
        NavigationToolbar2.__init__(self, canvas)
        self.set_history_buttons()

    def _init_toolbar(self):
        for texto, tip, icono, callback in self.toolitems:
            if texto is None:
                self.el.appendChild(E('span', 'qmpltb-sep'))
                continue
            b = E('button', 'qmpltb-btn', type='button', title=tip)
            img = E('img')
            img.src = _icono(icono)
            img.alt = texto
            b.appendChild(img)
            b.dataset.accion = callback
            on(b, 'click', lambda e, cb=callback: getattr(self, cb)())
            self.el.appendChild(b)
            self._btn[callback] = b
        self.el.appendChild(E('span', 'qmpltb-fill'))
        self.el.appendChild(self._coord)

    # ---- hooks que pide matplotlib ----
    def set_message(self, s):
        self._coord.textContent = str(s).replace('\n', ' ')

    def draw_rubberband(self, event, x0, y0, x1, y1):
        c = self._cvs
        ctx = c._ov.getContext('2d')
        ctx.clearRect(0, 0, c._ov.width, c._ov.height)
        h = c._ov.height
        ctx.save()
        ctx.setLineDash(js.Array.of(4 * c._dpr, 4 * c._dpr))
        ctx.lineWidth = c._dpr
        ctx.strokeStyle = '#000'
        ctx.strokeRect(min(x0, x1), h - max(y0, y1), abs(x1 - x0), abs(y1 - y0))
        ctx.restore()

    def remove_rubberband(self):
        c = self._cvs
        c._ov.getContext('2d').clearRect(0, 0, c._ov.width, c._ov.height)

    def set_cursor(self, cursor):
        mapa = {
            cursors.MOVE: 'move',
            cursors.HAND: 'pointer',
            cursors.POINTER: 'default',
            cursors.SELECT_REGION: 'crosshair',
            cursors.WAIT: 'wait',
            cursors.RESIZE_HORIZONTAL: 'ew-resize',
            cursors.RESIZE_VERTICAL: 'ns-resize',
        }
        self._cvs._cv.style.cursor = mapa.get(cursor, 'default')

    def pan(self, *a):
        super().pan(*a)
        self._update_buttons_checked()

    def zoom(self, *a):
        super().zoom(*a)
        self._update_buttons_checked()

    def _update_buttons_checked(self):
        for nombre, modo in (('pan', _Mode.PAN), ('zoom', _Mode.ZOOM)):
            b = self._btn.get(nombre)
            if b is not None:
                b.classList.toggle('on', self.mode == modo)

    def set_history_buttons(self):
        pila = self._nav_stack
        atras = pila._pos > 0
        adelante = pila._pos < len(pila._elements) - 1
        if 'back' in self._btn:
            self._btn['back'].disabled = not atras
        if 'forward' in self._btn:
            self._btn['forward'].disabled = not adelante

    # ---- diálogos ----
    def save_figure(self, *a):
        from ._figdialogs import guardar

        guardar(self._cvs)

    def configure_subplots(self, *a):
        from ._figdialogs import subplots

        subplots(self._cvs)

    def marcas(self, *a):
        from ._marcas_ui import abrir_dialogo

        abrir_dialogo(self._cvs)

    def edit_parameters(self, *a):
        from ._figdialogs import parametros

        parametros(self._cvs)
