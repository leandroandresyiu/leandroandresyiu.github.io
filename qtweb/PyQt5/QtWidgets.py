"""Widgets de Qt dibujados con elementos del navegador (solo lo que usa PlotTool)."""
import asyncio
import math

import js
from pyodide.ffi import create_proxy

from ._dom import E, document, frame, on, soon
from ._sig import Signal, pyqtSignal
from .QtCore import Qt, QObject
from .QtGui import QColor

LIBRE = 16777215
_TODOS = []  # todos los layouts (para el ajuste fino al montar la ventana)
PAD_ETIQUETAS = [16, 8]  # relleno a la derecha de las etiquetas de un formulario (se calibra por herramienta)


# ---------------------------------------------------------------------------
# Políticas de tamaño
class QSizePolicy:
    Fixed = 0
    Minimum = 1
    Maximum = 4
    Preferred = 5
    MinimumExpanding = 3
    Expanding = 7
    Ignored = 13

    def __init__(self, h=5, v=5):
        self.h, self.v = h, v


def _crece(p):  # bandera Grow
    return bool(p & 1)


def _expande(p):  # bandera Expand
    return bool(p & 2)


# ---------------------------------------------------------------------------
# Layouts
class QSpacerItem:
    def __init__(self, w=0, h=0, hp=QSizePolicy.Minimum, vp=QSizePolicy.Minimum):
        self.el = E('div', 'qspacer')
        self.hp, self.vp = hp, vp
        self._w, self._h = w, h

    def expanding(self):
        return _expande(self.hp), _expande(self.vp)


class _Layout(QObject):
    clase = 'ql-grid'

    def __init__(self, parent=None):
        super().__init__(None)
        self.el = E('div', 'ql ' + self.clase)
        self.items = []  # (objeto, fila, columna, filas, columnas)
        self._duenio = None
        self._padre_layout = None
        self._hint_h = 0
        self._vsp = 6
        _TODOS.append(self)
        if parent is not None and hasattr(parent, 'setLayout'):
            parent.setLayout(self)

    def setContentsMargins(self, l, t, r, b):
        # El espacio entre filas va como margen de cada elemento (así una fila oculta no deja huecos);
        # por eso al margen de arriba se le resta ese espacio.
        self.el.style.padding = f'{t}px {r}px {b}px {l}px'
        self._margen_propio = True

    def setSpacing(self, n):
        self.setHorizontalSpacing(n)
        self.setVerticalSpacing(n)

    def setHorizontalSpacing(self, n):
        self.el.style.columnGap = f'{int(n)}px'

    def setVerticalSpacing(self, n):
        self._vsp = int(n)  # el espacio entre filas va como margen de cada elemento
        self._aplicar()

    def setObjectName(self, n):
        self._nombre = n

    def _agregar(self, obj, fila=None, col=None, rs=1, cs=1):
        self.items.append((obj, fila, col, rs, cs))
        self.el.appendChild(obj.el)
        self._aplicar()

    def addWidget(self, w, *args, **kw):
        fila, col, rs, cs = self._pos(args)
        w._layout_padre = self
        self._agregar(w, fila, col, rs, cs)

    def addLayout(self, l, *args, **kw):
        fila, col, rs, cs = self._pos(args)
        l._padre_layout = self
        if not getattr(l, '_margen_propio', False):
            l.el.style.padding = '0'  # un layout anidado sin márgenes explícitos no los tiene
        self._agregar(l, fila, col, rs, cs)

    def addItem(self, it, *args, **kw):
        fila, col, rs, cs = self._pos(args)
        self._agregar(it, fila, col, rs, cs)

    def addStretch(self, n=0):
        self._agregar(QSpacerItem(0, 0, QSizePolicy.Expanding, QSizePolicy.Expanding))

    @staticmethod
    def _pos(args):
        a = [x for x in args if isinstance(x, int)]
        fila = a[0] if len(a) > 0 else None
        col = a[1] if len(a) > 1 else None
        rs = a[2] if len(a) > 2 else 1
        cs = a[3] if len(a) > 3 else 1
        return fila, col, rs, cs

    def expanding(self):
        h = v = False
        for obj, *_ in self.items:
            oh, ov = obj.expanding()
            h, v = h or oh, v or ov
        return h, v

    def _oculto(self):
        return all(_oculto(o) for o, *_ in self.items) if self.items else False

    def _chequear_vacio(self):
        self.el.style.display = 'none' if self._oculto() else ''
        if self._padre_layout is not None:
            self._padre_layout._chequear_vacio()

    def _aplicar(self):
        pass


def _oculto(o):
    if isinstance(o, _Layout):
        return o.el.style.display == 'none'
    if isinstance(o, QSpacerItem):
        return False
    return not o._visible


_CTX = []


def _medir(texto):
    """Ancho en píxeles de un texto con la fuente de la interfaz (12 px)."""
    if not _CTX:
        c = js.document.createElement('canvas').getContext('2d')
        c.font = '12px Arial, "Liberation Sans", Helvetica, sans-serif'
        _CTX.append(c)
    return _CTX[0].measureText(texto).width


def _hint(o, eje):
    """Peso con el que Qt reparte el espacio sobrante entre elementos que se expanden (su sizeHint)."""
    if isinstance(o, _Layout):
        return max([_hint(x, eje) for x, *_ in o.items] or [0])
    if isinstance(o, QSpacerItem):
        return 1
    return getattr(o, '_hint_' + eje, 0) or 1


class QGridLayout(_Layout):
    clase = 'ql-grid'

    def _aplicar(self):
        filas = columnas = 0
        for obj, fila, col, rs, cs in self.items:
            fila = 0 if fila is None else fila
            col = 0 if col is None else col
            filas = max(filas, fila + rs)
            columnas = max(columnas, col + cs)
        exp_c = [False] * columnas
        exp_f = [False] * filas
        min_c, max_c = [0] * columnas, [LIBRE] * columnas
        min_f, max_f = [0] * filas, [LIBRE] * filas
        pes_c, pes_f = [0] * columnas, [0] * filas
        for obj, fila, col, rs, cs in self.items:
            fila = 0 if fila is None else fila
            col = 0 if col is None else col
            h, v = obj.expanding()
            simple = not isinstance(obj, (_Layout, QSpacerItem))
            if simple and obj._maxh < LIBRE and not (_expande(obj._vp) and isinstance(obj, (QListWidget, QGroupBox, QScrollArea, QTextBrowser, QTabWidget))):
                v = False  # un campo de una línea con alto máximo no absorbe espacio; una lista o un grupo sí, hasta su máximo
            if cs == 1:
                exp_c[col] = exp_c[col] or h
                if simple:
                    min_c[col] = max(min_c[col], obj._minw)
                    max_c[col] = min(max_c[col], obj._maxw)
                    if isinstance(obj, QScrollArea) and obj._maxw < LIBRE:
                        # el sizeHint de un área con scroll es el de su contenido: suele pasar de su ancho máximo
                        min_c[col] = max(min_c[col], obj._maxw)
                if h:
                    pes_c[col] = max(pes_c[col], _hint(obj, 'w'))
            if rs == 1:
                exp_f[fila] = exp_f[fila] or v
                if simple:
                    min_f[fila] = max(min_f[fila], obj._minh)
                    if v:
                        max_f[fila] = min(max_f[fila], obj._maxh)
                if v:
                    # un elemento con alto máximo pesa lo que su máximo (su sizeHint no pasa de ahí)
                    tope = obj._maxh if simple and obj._maxh < LIBRE else 0
                    pes_f[fila] = max(pes_f[fila], tope or _hint(obj, 'h'))
            e = obj.el.style
            e.gridRow = f'{fila + 1} / span {rs}'
            e.gridColumn = f'{col + 1} / span {cs}'
            # El espacio entre filas va como margen (una fila oculta no deja huecos); los espaciadores no suman.
            e.marginTop = f'{self._vsp}px' if fila > 0 and not isinstance(obj, QSpacerItem) else '0'
            _colocar(obj)

        # Qt: si ninguna fila se expande, la grilla igual reparte el alto sobrante; con una sola fila y un
        # QTabWidget (Preferred) la pestaña ocupa toda la ventana.
        if filas == 1 and not exp_f[0] and any(isinstance(o, QTabWidget) for o, *_ in self.items):
            exp_f[0] = True
            pes_f[0] = 1

        # Qt (qGeomCalc): si ninguna columna se expande ni tiene stretch, el ancho se reparte parejo entre las que
        # pueden crecer, con su sizeHint como piso. Si alguna se expande, las demás quedan en su sizeHint.
        parejo = [False] * columnas
        if columnas >= 2 and not any(exp_c):
            for obj, fila, col, rs, cs in self.items:
                if cs == 1 and not isinstance(obj, (_Layout, QSpacerItem)) and _crece(obj._hp) and obj._maxw >= LIBRE:
                    parejo[col or 0] = True

        def pista(exp, mn, mx, peso, igual=False):
            lo = f'{mn}px' if mn else ('0' if exp else 'auto')
            if exp:
                return f'minmax({lo},{mx}px)' if mx < LIBRE else f'minmax({lo},{max(peso, 1)}fr)'
            if mx < LIBRE:
                return f'minmax({lo},{mx}px)'
            if igual:
                return f'minmax({lo},1fr)'
            return f'minmax({mn}px,auto)' if mn else 'auto'

        # Una fila que se expande pero tiene alto máximo comparte el espacio con las demás (y se frena en su máximo)
        # solo si hay otras filas sin tope que absorban lo que sobra.
        libres = any(exp_f[j] and max_f[j] >= LIBRE for j in range(filas))
        self.el.style.gridTemplateColumns = ' '.join(pista(exp_c[i], min_c[i], max_c[i], pes_c[i], parejo[i]) for i in range(columnas))
        self.el.style.gridTemplateRows = ' '.join(pista(exp_f[i], min_f[i], LIBRE if exp_f[i] and libres else max_f[i], pes_f[i]) for i in range(filas))
        self.el.style.alignContent = 'stretch' if any(exp_f) else 'start'
        self.el.style.justifyContent = 'stretch'
        self._fr_cols = any(exp_c)
        self._ncols = columnas
        self._cons = any(max_c[i] < LIBRE or min_c[i] for i in range(columnas))
        # En Qt las etiquetas de un formulario ocupan algo más que su texto (se calibró contra el programa original).
        for obj, fila, col, rs, cs in self.items:
            if isinstance(obj, QLabel) and (col or 0) == 0 and cs == 1 and columnas == 2:
                obj.el.style.paddingRight = f'{PAD_ETIQUETAS[1] if self._cons else PAD_ETIQUETAS[0]}px'


class QHBoxLayout(_Layout):
    clase = 'ql-h'

    def _aplicar(self):
        # Qt: el espacio que sobra se lo llevan los elementos que se expanden; si ninguno se expande,
        # se reparte parejo entre los que pueden crecer.
        hay = any(obj.expanding()[0] for obj, *_ in self.items)
        for obj, *_ in self.items:
            h, _v = obj.expanding()
            crece = isinstance(obj, QWidget) and _crece(obj._hp) or isinstance(obj, QSpacerItem)
            obj.el.style.flex = '1 1 0' if (h or (not hay and crece and not isinstance(obj, _Layout))) else '0 0 auto'
            _colocar(obj, flex=True)


class QVBoxLayout(_Layout):
    clase = 'ql-v'

    def _aplicar(self):
        for i, (obj, *_) in enumerate(self.items):
            _h, v = obj.expanding()
            obj.el.style.flex = '1 1 0' if v else '0 0 auto'
            obj.el.style.marginTop = f'{self._vsp}px' if i > 0 else '0'
            _colocar(obj, flex=True)


class QFormLayout(QGridLayout):
    def addRow(self, a, b=None):
        fila = len([1 for it in self.items if it[2] == 0])
        if b is None:
            self.addWidget(a, fila, 0, 1, 2)
        else:
            if isinstance(a, str):
                a = QLabel(a)
            self.addWidget(a, fila, 0)
            self.addWidget(b, fila, 1)


def _colocar(obj, flex=False):
    """Alineación de un elemento dentro de su celda: llena si puede crecer, si no queda arriba a la izquierda."""
    if isinstance(obj, (_Layout, QSpacerItem)):
        return
    hp, vp = obj._pol()
    s = obj.el.style
    s.justifySelf = 'stretch' if _crece(hp) or (isinstance(obj, QScrollArea) and obj._maxw < LIBRE) else 'start'
    s.alignSelf = 'stretch' if _crece(vp) else 'start'


# ---------------------------------------------------------------------------
# Widgets
class QWidget(QObject):
    clase = 'qw'
    hp0, vp0 = QSizePolicy.Preferred, QSizePolicy.Preferred

    def __init__(self, parent=None):
        super().__init__(parent)
        self.el = E('div', self.clase)
        self._layout = None
        self._hp, self._vp = self.hp0, self.vp0
        self._minw = self._minh = 0
        self._maxw = self._maxh = LIBRE
        self._hint_w = self._hint_h = 0
        self._enabled = True
        self._visible = True
        self._layout_padre = None
        self._hijos = []
        if parent is not None and hasattr(parent, '_hijos'):
            parent._hijos.append(self)

    # --- tamaño ---
    def _pol(self):
        return self._hp, self._vp

    def sizePolicy(self):
        return QSizePolicy(self._hp, self._vp)

    def setSizePolicy(self, h, v=None, *a):
        if isinstance(h, QSizePolicy):
            self._hp, self._vp = h.h, h.v
        else:
            self._hp, self._vp = h, v
        if self._vp == QSizePolicy.Expanding and self._maxh < LIBRE:
            self.el.style.minHeight = f'{self._maxh}px'
        self._reaplicar()

    def updateGeometry(self):
        self._reaplicar()

    def _reaplicar(self):
        lp = self._layout_padre
        if lp is not None:
            lp._aplicar()

    def expanding(self):
        h, v = _expande(self._hp), _expande(self._vp)
        if self._layout is not None:
            lh, lv = self._layout.expanding()
            if _crece(self._hp):
                h = h or lh
            if _crece(self._vp):
                v = v or lv
        return h, v

    def setMinimumSize(self, w, h=None):
        if h is None:
            w, h = w.width(), w.height()
        self._minw, self._minh = w, h
        self._reaplicar()
        s = self.el.style
        s.minWidth = f'{w}px' if w else ''
        s.minHeight = f'{h}px' if h else ''

    def setMaximumSize(self, w, h=None):
        if h is None:
            w, h = w.width(), w.height()
        self._maxw, self._maxh = w, h
        self._reaplicar()
        s = self.el.style
        if 20 <= h <= 30:
            s.minHeight = f'{h}px'  # en este estilo los campos con alto máximo llegan hasta él
        s.maxWidth = f'{w}px' if w < LIBRE else ''
        s.maxHeight = f'{h}px' if h < LIBRE else ''

    def setMinimumWidth(self, w):
        self._minw = w
        self.el.style.minWidth = f'{w}px'

    def setMinimumHeight(self, h):
        self._minh = h
        self.el.style.minHeight = f'{h}px'

    def setMaximumWidth(self, w):
        self._maxw = w
        self.el.style.maxWidth = f'{w}px' if w < LIBRE else ''

    def setMaximumHeight(self, h):
        self._maxh = h
        self.el.style.maxHeight = f'{h}px' if h < LIBRE else ''

    def resize(self, *a):
        pass

    def setGeometry(self, *a):
        pass

    # --- estado ---
    def setLayout(self, layout):
        self._layout = layout
        layout._duenio = self
        cont = self._contenedor()
        if cont is self.el:
            self.el.classList.add('qhas')
        cont.appendChild(layout.el)
        self._reaplicar()

    def layout(self):
        return self._layout

    def _contenedor(self):
        return self.el

    def setEnabled(self, b):
        self._enabled = bool(b)
        self.el.classList.toggle('qdis', not self._enabled)
        self._al_habilitar()

    def _al_habilitar(self):
        for tag in ('input', 'select', 'button', 'textarea'):
            for x in self.el.querySelectorAll(tag):
                x.disabled = not self._enabled if not self._enabled else bool(x.closest('.qdis'))

    def isEnabled(self):
        return self._enabled

    def setVisible(self, b):
        self._visible = bool(b)
        self.el.style.display = '' if b else 'none'
        lp = self._layout_padre
        if lp is not None:
            lp._chequear_vacio()

    def isVisible(self):
        return self._visible

    def _es_ventana_suelta(self):
        return self._parent is None and self._layout_padre is None and not isinstance(self, (QMainWindow, QDialog, QMenu, QMenuBar, QStatusBar)) and self.el.parentNode is None

    def show(self):
        if self._es_ventana_suelta() or getattr(self, '_ventana', None) is not None:
            _abrir_ventana(self)
        else:
            self.setVisible(True)

    def hide(self):
        if getattr(self, '_ventana', None) is not None:
            self._ventana.classList.remove('show')
        else:
            self.setVisible(False)

    def setFont(self, f):
        pass

    def setFocus(self, *a):
        x = self.el.querySelector('input, select, textarea, button')
        if x is not None:
            x.focus()

    def focusWidget(self):
        return self

    def setStyleSheet(self, css):
        """Solo entiende declaraciones simples (por ejemplo 'background-color: #fff').
        No toca el resto de los estilos (la posición en el layout, por ejemplo)."""
        for k in getattr(self, '_ss', []):
            self.el.style.removeProperty(k)
        self._ss = []
        for d in str(css).split(';'):
            if ':' in d:
                k, v = d.split(':', 1)
                self._estilo(k.strip(), v.strip())
                self._ss.append(k.strip())

    def _estilo(self, k, v):
        self.el.style.setProperty(k, v)

    def setWindowTitle(self, t):
        self._titulo = t

    def windowTitle(self):
        return getattr(self, '_titulo', '')

    def setAcceptDrops(self, b):
        pass

    def setToolTip(self, t):
        self.el.title = t

    def setObjectName(self, n):
        super().setObjectName(n)
        self.el.setAttribute('data-name', n)

    def style(self):
        return _Estilo()

    def close(self):
        self.hide()


class _Icono:
    def __init__(self, glifo=''):
        self.glifo = glifo


class _Estilo:
    def standardIcon(self, n=None, *a):
        return _Icono({'up': '\u25b2', 'down': '\u25bc'}.get(n, ''))


class QFrame(QWidget):
    pass


class QLabel(QWidget):
    clase = 'qw qlabel'
    hp0, vp0 = QSizePolicy.Preferred, QSizePolicy.Preferred

    def __init__(self, texto='', parent=None):
        if not isinstance(texto, str):
            parent, texto = texto, ''
        super().__init__(parent)
        self.setText(texto)

    def setText(self, t):
        self.el.textContent = str(t)

    def text(self):
        return str(self.el.textContent)

    def clear(self):
        self.el.textContent = ''

    def setWordWrap(self, b):
        self.el.classList.toggle('wrap', bool(b))

    def setAlignment(self, a):
        pass

    def setTextFormat(self, *a):
        pass


class QAbstractButton(QWidget):
    hp0, vp0 = QSizePolicy.Minimum, QSizePolicy.Fixed
    clicked = pyqtSignal(bool)

    def __init__(self, texto='', parent=None):
        if not isinstance(texto, str):
            parent, texto = texto, ''
        super().__init__(parent)
        self._texto = texto

    def setText(self, t):
        self._texto = str(t)
        self._pintar()

    def text(self):
        return self._texto

    def _pintar(self):
        pass

    def setCheckable(self, b):
        self._checkable = bool(b)

    def click(self):
        self.clicked.emit(False)

    def setIcon(self, icono=None, *a):
        g = getattr(icono, 'glifo', '')
        if g and not self._texto:
            self._texto = g
            self._pintar()


class QPushButton(QAbstractButton):
    clase = 'qw qbtn'

    def __init__(self, texto='', parent=None):
        super().__init__(texto, parent)
        self.el = E('button', 'qw qbtn', type='button')
        self.el.textContent = self._texto
        on(self.el, 'click', lambda e: self.clicked.emit(False))

    def _pintar(self):
        self.el.textContent = self._texto

    def _al_habilitar(self):
        self.el.disabled = not self._enabled


class QToolButton(QPushButton):
    def __init__(self, texto='', parent=None):
        super().__init__(texto, parent)
        self.el.className = 'qw qbtn qtool'


class QCheckBox(QAbstractButton):
    hp0, vp0 = QSizePolicy.Preferred, QSizePolicy.Fixed
    stateChanged = pyqtSignal(int)
    toggled = pyqtSignal(bool)

    def __init__(self, texto='', parent=None):
        super().__init__(texto, parent)
        self.el = E('label', 'qw qcheck')
        self._in = E('input', type='checkbox')
        self._tx = E('span')
        self._tx.textContent = self._texto
        self.el.appendChild(self._in)
        self.el.appendChild(E('i', 'qbox'))
        self.el.appendChild(self._tx)

        def cambio(e):
            self.stateChanged.emit(2 if self._in.checked else 0)
            self.toggled.emit(bool(self._in.checked))

        on(self._in, 'change', cambio)

    def _pintar(self):
        self._tx.textContent = self._texto

    def isChecked(self):
        return bool(self._in.checked)

    def setChecked(self, b):
        if bool(self._in.checked) != bool(b):
            self._in.checked = bool(b)
            self.stateChanged.emit(2 if b else 0)
            self.toggled.emit(bool(b))

    def _al_habilitar(self):
        self._in.disabled = not self._enabled


class QRadioButton(QCheckBox):
    _grupos = 0

    def __init__(self, texto='', parent=None):
        super().__init__(texto, parent)
        self._in.type = 'radio'
        self.el.className = 'qw qcheck qradio'
        self.el.replaceChild(E('i', 'qdot'), self.el.children[1])

    def _agrupar(self, nombre):
        self._in.name = nombre


class QGroupBox(QWidget):
    clase = 'qw qgb'

    def __init__(self, titulo='', parent=None):
        if not isinstance(titulo, str):
            parent, titulo = titulo, ''
        super().__init__(parent)
        self._t = E('div', 'qgb-title')
        self._caja = E('div', 'qgb-box')
        self.el.appendChild(self._t)
        self.el.appendChild(self._caja)
        self.setTitle(titulo)

    def setTitle(self, t):
        self._t.textContent = str(t)

    def title(self):
        return str(self._t.textContent)

    def _contenedor(self):
        return self._caja

    def setCheckable(self, b):
        pass


class QLineEdit(QWidget):
    clase = 'qw qedit'
    hp0, vp0 = QSizePolicy.Expanding, QSizePolicy.Fixed
    textEdited = pyqtSignal(str)
    textChanged = pyqtSignal(str)
    returnPressed = pyqtSignal()

    def __init__(self, texto='', parent=None):
        if not isinstance(texto, str):
            parent, texto = texto, ''
        super().__init__(parent)
        self._in = E('input', type='text', spellcheck='false', autocomplete='off', size='16')
        self.el.appendChild(self._in)
        self._in.value = texto
        on(self._in, 'input', lambda e: self._tipeo())
        on(self._in, 'keydown', lambda e: self.returnPressed.emit() if e.key == 'Enter' else None)

    def _tipeo(self):
        t = str(self._in.value)
        self.textEdited.emit(t)
        self.textChanged.emit(t)

    def text(self):
        return str(self._in.value)

    def setText(self, t):
        t = str(t)
        if str(self._in.value) != t:
            self._in.value = t
            self.textChanged.emit(t)

    def setPlaceholderText(self, t):
        self._in.placeholder = t

    def setReadOnly(self, b):
        self._in.readOnly = bool(b)

    def _al_habilitar(self):
        self._in.disabled = not self._enabled

    def clear(self):
        self.setText('')


class QComboBox(QWidget):
    clase = 'qw qcombo'
    hp0, vp0 = QSizePolicy.Preferred, QSizePolicy.Fixed
    activated = pyqtSignal(int)
    currentIndexChanged = pyqtSignal(int)
    currentTextChanged = pyqtSignal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._sel = E('select')
        self.el.appendChild(self._sel)
        self._ult = -1
        self._datos = []
        on(self._sel, 'change', lambda e: self._usuario())

    def _usuario(self):
        self._cambio()
        self.activated.emit(self.currentIndex())

    def _cambio(self):
        i = self.currentIndex()
        if i != self._ult:
            self._ult = i
            self.currentIndexChanged.emit(i)
            self.currentTextChanged.emit(self.currentText())

    def addItem(self, *args):
        # addItem(texto), addItem(texto, dato) o addItem(icono, texto, dato)
        args = [a for a in args if not (a is None and False)]
        if len(args) >= 2 and not isinstance(args[0], str):
            args = args[1:]
        texto = args[0] if args else ''
        dato = args[1] if len(args) > 1 else None
        o = E('option')
        o.textContent = str(texto)
        o.value = str(self.count())
        self._sel.appendChild(o)
        self._datos.append(dato)
        if self.count() == 1:
            self._sel.selectedIndex = 0
            self._cambio()

    def addItems(self, lista):
        for t in lista:
            self.addItem(t)

    def clear(self):
        self._sel.innerHTML = ''
        self._ult = -1
        self._datos = []

    def itemData(self, i, rol=None):
        return self._datos[i] if 0 <= i < len(self._datos) else None

    def setItemData(self, i, dato, rol=None):
        if 0 <= i < len(self._datos):
            self._datos[i] = dato

    def currentData(self, rol=None):
        return self.itemData(self.currentIndex())

    def findData(self, dato, *a):
        for i, d in enumerate(self._datos):
            if d is dato or d == dato:
                return i
        return -1

    def insertItem(self, i, *args):
        texto = next((a for a in args if isinstance(a, str)), '')
        dato = args[-1] if len(args) > 1 and not isinstance(args[-1], str) else None
        o = E('option')
        o.textContent = texto
        ref = self._sel.options.item(i) if i < self.count() else None
        self._sel.insertBefore(o, ref)
        self._datos.insert(i, dato)
        for k in range(self.count()):
            self._sel.options.item(k).value = str(k)

    def removeItem(self, i):
        if not 0 <= i < self.count():
            return
        actual = self.currentIndex()
        self._sel.removeChild(self._sel.options.item(i))
        self._datos.pop(i)
        for k in range(self.count()):
            self._sel.options.item(k).value = str(k)
        if self.count():
            nuevo = min(actual if actual < i else max(actual - (1 if actual >= i else 0), 0), self.count() - 1)
            self._sel.selectedIndex = nuevo
        self._ult = -2
        self._cambio()

    def model(self):
        return _ModeloCombo(self)

    def setEditable(self, b):
        pass

    def _habilitar(self, i, b):
        self._sel.options.item(i).disabled = not b

    def _habilitado(self, i):
        return not bool(self._sel.options.item(i).disabled)

    def _tildar(self, i, estado):
        pass

    def _tildado(self, i):
        return 0

    def count(self):
        return int(self._sel.options.length)

    def currentIndex(self):
        return int(self._sel.selectedIndex)

    def currentText(self):
        i = self.currentIndex()
        return str(self._sel.options.item(i).textContent) if i >= 0 else ''

    def itemText(self, i):
        return str(self._sel.options.item(i).textContent)

    def setItemText(self, i, t):
        self._sel.options.item(i).textContent = str(t)

    def setCurrentIndex(self, i):
        self._sel.selectedIndex = int(i)
        self._cambio()

    def setCurrentText(self, t):
        for i in range(self.count()):
            if self.itemText(i) == t:
                self.setCurrentIndex(i)
                return

    def findText(self, t):
        for i in range(self.count()):
            if self.itemText(i) == t:
                return i
        return -1

    def _al_habilitar(self):
        self._sel.disabled = not self._enabled


class _ItemCombo:
    def __init__(self, combo, i):
        self._c, self._i = combo, i

    def setEnabled(self, b):
        self._c._habilitar(self._i, bool(b))

    def isEnabled(self):
        return self._c._habilitado(self._i)

    def setCheckState(self, estado):
        self._c._tildar(self._i, estado)

    def checkState(self):
        return self._c._tildado(self._i)

    def text(self):
        return self._c.itemText(self._i)


class _ModeloCombo:
    def __init__(self, combo):
        self._c = combo

    def item(self, i, col=0):
        return _ItemCombo(self._c, i)

    def rowCount(self):
        return self._c.count()


class QAbstractSpinBox(QWidget):
    clase = 'qw qspin'
    _tipo = float
    hp0, vp0 = QSizePolicy.Minimum, QSizePolicy.Fixed
    valueChanged = pyqtSignal(float)
    editingFinished = pyqtSignal()
    NoButtons = 0
    UpDownArrows = 1

    def __init__(self, parent=None):
        super().__init__(parent)
        self._pre = ''
        self._suf = ''
        self._v = 0.0
        self._min, self._max = 0.0, 99.99
        self._dec = 2
        self._paso = 1.0
        self._in = E('input', type='text', spellcheck='false', autocomplete='off', inputmode='decimal', size='4')
        self._btns = E('div', 'qspin-btns')
        self._up = E('button', 'qspin-up', type='button', tabindex='-1')
        self._dn = E('button', 'qspin-dn', type='button', tabindex='-1')
        self._btns.appendChild(self._up)
        self._btns.appendChild(self._dn)
        self.el.appendChild(self._in)
        self.el.appendChild(self._btns)
        self._mostrar()
        on(self._in, 'change', lambda e: self._leer())
        on(self._in, 'keydown', lambda e: self._tecla(e))
        on(self._in, 'wheel', lambda e: self._rueda(e))
        on(self._up, 'click', lambda e: self._mover(1))
        on(self._dn, 'click', lambda e: self._mover(-1))

    # ---- formato y lectura (se redefinen en la versión científica) ----
    def _formato(self, v):
        return f'{v:.{self._dec}f}'

    def _parsear(self, texto):
        return float(texto.replace(',', '.'))

    def _mostrar(self):
        self._in.value = f'{self._pre}{self._formato(self._v)}{self._suf}'
        self._ancho_natural()

    def _ancho_natural(self):
        """Qt calcula el sizeHint del spinbox con el texto más largo posible (mínimo o máximo) más unos 30 px
        de marco y botones."""
        try:
            textos = [self._formato(self._min), self._formato(self._max)]
        except Exception:
            textos = ['0.00']
        textos = [f'{self._pre}{t[:14]}{self._suf}' for t in textos]
        ancho = max(_medir(t) for t in textos) + 30
        self._in.style.width = f'{ancho}px'

    def _leer(self):
        try:
            t = str(self._in.value).strip()
            if self._pre and t.startswith(self._pre):
                t = t[len(self._pre):]
            if self._suf and t.endswith(self._suf.strip()):
                t = t[: len(t) - len(self._suf.strip())]
            self._poner(self._parsear(t), True)
        except Exception:
            pass
        self._mostrar()
        self.editingFinished.emit()

    def _poner(self, v, emitir):
        v = min(max(float(v), self._min), self._max)
        if self._dec == 0:
            v = float(round(v))
        cambio = v != self._v
        self._v = v
        self._mostrar()
        if cambio and emitir:
            self.valueChanged.emit(self._tipo(v))

    def _mover(self, d):
        self._poner(self._v + d * self._paso, True)

    def _tecla(self, e):
        if e.key == 'ArrowUp':
            e.preventDefault()
            self._mover(1)
        elif e.key == 'ArrowDown':
            e.preventDefault()
            self._mover(-1)
        elif e.key == 'Enter':
            self._leer()

    def _rueda(self, e):
        if document.activeElement == self._in:
            e.preventDefault()
            self._mover(1 if e.deltaY < 0 else -1)

    # ---- API de Qt ----
    def value(self):
        return self._tipo(self._v)

    def setValue(self, v):
        self._poner(v, True)

    # Como en Qt: al cambiar el rango, el valor actual se acomoda dentro de él.
    def setMinimum(self, v):
        self._min = float(v)
        self._max = max(self._max, self._min)
        self._poner(self._v, True)

    def setMaximum(self, v):
        self._max = float(v)
        self._min = min(self._min, self._max)
        self._poner(self._v, True)

    def setRange(self, a, b):
        self._min, self._max = float(a), max(float(a), float(b))
        self._poner(self._v, True)

    def minimum(self):
        return self._tipo(self._min)

    def maximum(self):
        return self._tipo(self._max)

    def setDecimals(self, d):
        self._dec = int(d)
        self._mostrar()

    def setSingleStep(self, s):
        self._paso = float(s)

    def setButtonSymbols(self, s):
        self._btns.style.display = 'none' if s == 0 else ''

    def setSuffix(self, s):
        # Qt muestra el sufijo tal cual (los textos del .ui ya traen su espacio si lo necesitan)
        self._suf = str(s)
        self._mostrar()

    def setPrefix(self, s):
        self._pre = str(s)
        self._mostrar()

    def suffix(self):
        return self._suf

    def prefix(self):
        return self._pre

    def setKeyboardTracking(self, b):
        pass

    def _al_habilitar(self):
        self._in.disabled = not self._enabled
        self._up.disabled = self._dn.disabled = not self._enabled


class QDoubleSpinBox(QAbstractSpinBox):
    pass


class QSpinBox(QAbstractSpinBox):
    _tipo = int

    def __init__(self, parent=None):
        super().__init__(parent)
        self._dec = 0
        self._max = 99
        self._mostrar()

    valueChanged = pyqtSignal(int)


class QListWidgetItem:
    def __init__(self, texto='', lista=None):
        self._texto = texto
        self._datos = {}
        self.el = E('div', 'qli')
        self.el.textContent = texto
        self._lista = None
        self._sel = False
        self._flags = 53  # seleccionable, tildable, habilitado y arrastrable (lo de Qt por defecto)

    def isSelected(self):
        return self._sel

    def _seleccionable(self):
        return bool(self._flags & 1) and bool(self._flags & 32)

    def setSelected(self, b):
        l = self._lista
        if l is None:
            self._sel = bool(b)
            return
        if b and not self._seleccionable():
            return
        l._poner_sel(l._items.index(self), bool(b))

    def setFlags(self, flags):
        self._flags = int(flags)
        self.el.classList.toggle('dis', not self._flags & 32)
        if not self._seleccionable() and self._sel and self._lista is not None:
            self._lista._poner_sel(self._lista._items.index(self), False)

    def flags(self):
        return self._flags

    def text(self):
        return self._texto

    def setText(self, t):
        self._texto = str(t)
        self.el.textContent = self._texto

    def data(self, rol=Qt.UserRole):
        return self._datos.get(rol)

    def setData(self, rol, valor):
        self._datos[rol] = valor


class _Indice:
    def __init__(self, fila, item=None):
        self._f = fila
        self._it = item

    def row(self):
        return self._f

    def data(self, rol=256):
        return self._it.data(rol) if self._it is not None else None

    def column(self):
        return 0


class QListWidget(QWidget):
    clase = 'qw qlist'
    hp0, vp0 = QSizePolicy.Expanding, QSizePolicy.Expanding
    currentItemChanged = pyqtSignal(object, object)
    currentRowChanged = pyqtSignal(int)
    itemClicked = pyqtSignal(object)
    itemSelectionChanged = pyqtSignal()
    SingleSelection = 1
    MultiSelection = 2
    ExtendedSelection = 3
    NoSelection = 0

    def __init__(self, parent=None):
        super().__init__(parent)
        self._hint_w, self._hint_h = 256, 192  # sizeHint de QAbstractScrollArea
        self._items = []
        self._actual = -1
        self._modo = 'single'
        self._ancla = -1
        self.el.setAttribute('tabindex', '0')
        on(self.el, 'keydown', lambda e: self._tecla(e))

    def _tecla(self, e):
        if e.key == 'ArrowDown' and self._actual < len(self._items) - 1:
            e.preventDefault()
            self.setCurrentRow(self._actual + 1)
        elif e.key == 'ArrowUp' and self._actual > 0:
            e.preventDefault()
            self.setCurrentRow(self._actual - 1)

    def _enlazar(self, it):
        it._lista = self
        on(it.el, 'click', lambda e, it=it: self._click(it, e))

    def _click(self, it, e=None):
        if not it._seleccionable():
            return
        fila = self._items.index(it)
        ctrl = bool(e is not None and (e.ctrlKey or e.metaKey))
        shift = bool(e is not None and e.shiftKey)
        if self._modo == 'multi' or (self._modo == 'extended' and ctrl):
            self._poner_sel(fila, not it._sel)
            self._ancla = fila
            self._actual = fila
        elif self._modo == 'extended' and shift and self._ancla >= 0:
            a, b = sorted((self._ancla, fila))
            self._seleccion([i for i in range(a, b + 1)])
            self._actual = fila
        else:
            self._ancla = fila
            self.setCurrentRow(fila)
        self._repintar()
        self.itemClicked.emit(it)

    def _seleccion(self, filas):
        nuevo = set(filas)
        antes = {i for i, it in enumerate(self._items) if it._sel}
        for i, it in enumerate(self._items):
            it._sel = i in nuevo
        self._repintar()
        if antes != nuevo:
            self.itemSelectionChanged.emit()

    def _poner_sel(self, fila, valor):
        it = self._items[fila]
        if it._sel == valor:
            return
        if self._modo == 'single' and valor:
            for k, o in enumerate(self._items):
                o._sel = k == fila
        else:
            it._sel = valor
        self._repintar()
        self.itemSelectionChanged.emit()

    def setSelectionMode(self, modo):
        self._modo = {0: 'ninguno', 1: 'single', 2: 'multi', 3: 'extended', 4: 'extended'}.get(modo, 'single')

    def selectedIndexes(self):
        return [_Indice(i, it) for i, it in enumerate(self._items) if it._sel]

    def selectedItems(self):
        return [it for it in self._items if it._sel]

    def row(self, item):
        return self._items.index(item) if item in self._items else -1

    def clearSelection(self):
        self._seleccion([])

    def _repintar(self):
        for i, it in enumerate(self._items):
            marcado = it._sel if self._modo in ('multi', 'extended') else (i == self._actual or it._sel)
            it.el.classList.toggle('sel', bool(marcado))
            it.el.classList.toggle('alt', i % 2 == 1)

    def addItem(self, it):
        if isinstance(it, str):
            it = QListWidgetItem(it)
        self._items.append(it)
        self.el.appendChild(it.el)
        self._enlazar(it)
        self._repintar()

    def insertItem(self, fila, it):
        if isinstance(it, str):
            it = QListWidgetItem(it)
        fila = max(0, min(fila, len(self._items)))
        self._items.insert(fila, it)
        ref = self.el.children.item(fila + 1) if fila + 1 <= len(self._items) - 1 else None
        self.el.insertBefore(it.el, ref)
        self._enlazar(it)
        if self._actual >= fila:
            self._actual += 1
        self._repintar()

    def takeItem(self, fila):
        if not 0 <= fila < len(self._items):
            return None
        it = self._items.pop(fila)
        self.el.removeChild(it.el)
        previo = self._items[self._actual] if 0 <= self._actual < len(self._items) + 1 and False else None
        if fila == self._actual:
            self._actual = -1
            self._repintar()
            self.currentItemChanged.emit(None, it)
            self.currentRowChanged.emit(-1)
        else:
            if fila < self._actual:
                self._actual -= 1
            self._repintar()
        return it

    def count(self):
        return len(self._items)

    def item(self, i):
        return self._items[i] if 0 <= i < len(self._items) else None

    def currentRow(self):
        return self._actual

    def currentItem(self):
        return self._items[self._actual] if 0 <= self._actual < len(self._items) else None

    def setCurrentRow(self, fila):
        if not -1 <= fila < len(self._items):
            return
        previo = self.currentItem()
        self._actual = fila
        if self._modo in ('single', 'extended'):
            for k, o in enumerate(self._items):
                o._sel = k == fila
        self._repintar()
        nuevo = self.currentItem()
        if nuevo is not previo:
            self.currentItemChanged.emit(nuevo, previo)
            self.currentRowChanged.emit(fila)
            self.itemSelectionChanged.emit()
        if nuevo is not None:
            nuevo.el.scrollIntoView(js.Object.fromEntries([['block', 'nearest']]))

    def clear(self):
        for it in self._items:
            self.el.removeChild(it.el)
        self._items = []
        self._actual = -1

    def setAlternatingRowColors(self, b):
        pass


class QScrollArea(QWidget):
    clase = 'qw qsa'
    hp0, vp0 = QSizePolicy.Expanding, QSizePolicy.Expanding

    def __init__(self, parent=None):
        super().__init__(parent)
        self._hint_w, self._hint_h = 256, 335
        self._w = None

    def setWidget(self, w):
        self._w = w
        self.el.appendChild(w.el)

    def widget(self):
        return self._w

    def setWidgetResizable(self, b):
        pass

    def expanding(self):
        return _expande(self._hp) or _crece(self._hp), _expande(self._vp) or _crece(self._vp)


class QTabWidget(QWidget):
    clase = 'qw qtabs'
    hp0, vp0 = QSizePolicy.Expanding, QSizePolicy.Expanding
    currentChanged = pyqtSignal(int)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._bar = E('div', 'qtabs-bar')
        self._panel = E('div', 'qtabs-pane')
        # Como en Qt: si las pestañas no entran, se desplazan con dos flechitas.
        fila = E('div', 'qtabs-row')
        izq = E('button', 'qtabs-arrow izq', '◂', type='button')
        der = E('button', 'qtabs-arrow der', '▸', type='button')
        self._fila = fila
        fila.appendChild(self._bar)
        fila.appendChild(izq)
        fila.appendChild(der)
        self.el.appendChild(fila)
        self.el.appendChild(self._panel)
        on(izq, 'click', lambda e: self._bar.scrollBy(-120, 0))
        on(der, 'click', lambda e: self._bar.scrollBy(120, 0))

        def revisar(*a):
            fila.classList.toggle('desborda', self._bar.scrollWidth > self._bar.clientWidth + 1)

        obs = js.ResizeObserver.new(create_proxy(revisar))
        obs.observe(self._bar)
        self._revisar = revisar
        self._pags = []
        self._btns = []
        self._i = -1

    def addTab(self, widget, titulo=''):
        b = E('button', 'qtabs-tab', type='button')
        b.textContent = titulo
        n = len(self._pags)
        on(b, 'click', lambda e, n=n: self.setCurrentIndex(n))
        self._bar.appendChild(b)
        self._btns.append(b)
        widget.el.classList.add('qtabs-page')
        widget.el.style.display = 'none'
        self._panel.appendChild(widget.el)
        self._pags.append(widget)
        if self._i < 0:
            self.setCurrentIndex(0)

    def setTabText(self, i, t):
        self._btns[i].textContent = t

    def setCurrentIndex(self, i):
        if not 0 <= i < len(self._pags) or i == self._i:
            return
        self._i = i
        for k, (p, b) in enumerate(zip(self._pags, self._btns)):
            p.el.style.display = '' if k == i else 'none'
            b.classList.toggle('on', k == i)
        self._btns[i].scrollIntoView(js.Object.fromEntries([['block', 'nearest'], ['inline', 'nearest']]))
        self.currentChanged.emit(i)

    def currentIndex(self):
        return self._i

    def count(self):
        return len(self._pags)

    def currentWidget(self):
        return self._pags[self._i] if self._i >= 0 else None


class QTextBrowser(QWidget):
    clase = 'qw qtext'
    hp0, vp0 = QSizePolicy.Expanding, QSizePolicy.Expanding

    def setHtml(self, h):
        self.el.innerHTML = h

    def setText(self, t):
        self.el.textContent = t

    def setOpenExternalLinks(self, b):
        pass


# ---------------------------------------------------------------------------
# Acciones, barras y menús
class QAction(QObject):
    triggered = pyqtSignal(bool)
    toggled = pyqtSignal(bool)

    def __init__(self, *args, checkable=False, **kw):
        super().__init__(None)
        self._texto = next((a for a in args if isinstance(a, str)), '')
        self._checkable = checkable
        self._checked = False
        self._grupo = None
        self.el = None

    def setText(self, t):
        self._texto = t
        if self.el is not None:
            self.el.textContent = t

    def text(self):
        return self._texto

    def setCheckable(self, b):
        self._checkable = bool(b)

    def setChecked(self, b):
        self._checked = bool(b)
        if self.el is not None:
            self.el.classList.toggle('on', self._checked)

    def isChecked(self):
        return self._checked

    def setEnabled(self, b):
        pass

    def trigger(self):
        if self._checkable:
            self.setChecked(not self._checked if self._grupo is None else True)
            if self._grupo is not None:
                self._grupo._elegir(self)
        self.triggered.emit(self._checked)


class QActionGroup(QObject):
    def __init__(self, parent=None):
        super().__init__(parent)
        self._acc = []

    def addAction(self, a):
        a._grupo = self
        self._acc.append(a)
        return a

    def _elegir(self, a):
        for x in self._acc:
            x.setChecked(x is a)


class QMenu(QWidget):
    clase = 'qmenu'

    def __init__(self, titulo='', parent=None):
        if not isinstance(titulo, str):
            parent, titulo = titulo, ''
        super().__init__(parent)
        self._titulo = titulo
        self.el = E('div', 'qmenu')
        self._caja = E('div', 'qmenu-items')
        self._boton = E('button', 'qmenu-title', type='button')
        self._boton.textContent = titulo
        self.el.appendChild(self._boton)
        self.el.appendChild(self._caja)
        on(self._boton, 'click', lambda e: self.el.classList.toggle('open'))
        on(document, 'pointerdown', lambda e: self.el.classList.remove('open') if not self.el.contains(e.target) else None)

    def setTitle(self, t):
        self._boton.textContent = t

    def addAction(self, a):
        b = E('button', 'qmenu-item', type='button')
        b.textContent = a.text()
        a.el = b
        b.classList.toggle('on', a.isChecked())

        def click(e, a=a):
            self.el.classList.remove('open')
            a.trigger()

        on(b, 'click', click)
        self._caja.appendChild(b)
        return a

    def addSeparator(self):
        self._caja.appendChild(E('div', 'qmenu-sep'))

    def menuAction(self):
        return self


class QMenuBar(QWidget):
    clase = 'qw qmenubar'

    def addMenu(self, m):
        self.el.appendChild(m.el)
        return m

    def addAction(self, a):
        pass


class QStatusBar(QWidget):
    clase = 'qw qstatus'

    def __init__(self, parent=None):
        super().__init__(parent)
        self._t = 0

    def showMessage(self, texto, ms=0):
        self.el.textContent = texto
        if self._t:
            js.clearTimeout(self._t)
            self._t = 0
        if ms:
            p = create_proxy(lambda: self.clearMessage())
            self._t = js.setTimeout(p, ms)

    def clearMessage(self):
        self.el.textContent = ''


class QToolBar(QWidget):
    clase = 'qw qtoolbar'

    def setToolButtonStyle(self, s):
        pass

    def addAction(self, a):
        b = E('button', 'qtoolbar-btn', type='button')
        b.textContent = a.text()
        a.el = b
        b.classList.toggle('on', a.isChecked())
        on(b, 'click', lambda e, a=a: a.trigger())
        self.el.appendChild(b)
        return a

    def addSeparator(self):
        self.el.appendChild(E('span', 'qtoolbar-sep'))


class QDialogButtonBox(QWidget):
    clase = 'qw qbbox'
    Ok = 0x400
    Cancel = 0x400000
    accepted = pyqtSignal()
    rejected = pyqtSignal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._b = {}

    def setStandardButtons(self, flags):
        self.el.innerHTML = ''
        self._b = {}
        for flag, texto, señal in ((self.Ok, 'OK', 'accepted'), (self.Cancel, 'Cancel', 'rejected')):
            if flags & flag:
                b = QPushButton(texto)
                b.el.classList.add('qbbox-btn')
                self.el.appendChild(b.el)
                self._b[flag] = b
                b.clicked.connect(lambda s=señal: getattr(self, s).emit())

    def button(self, flag):
        return self._b.get(flag)

    def setOrientation(self, o):
        pass


# ---------------------------------------------------------------------------
# Ventanas
_raiz = None


def _montar():
    """Contenedor donde viven las ventanas flotantes (diálogos y ventanas aparte)."""
    global _raiz
    if _raiz is None:
        _raiz = E('div', 'qfloat')
        document.body.appendChild(_raiz)
    return _raiz


class QDialog(QWidget):
    clase = 'qdlg-content'
    accepted = pyqtSignal()
    rejected = pyqtSignal()
    finished = pyqtSignal(int)

    def __init__(self, parent=None):
        super().__init__(None)
        self._marco = None
        self._cuerpo = self.el

    def _construir(self):
        if self._marco is not None:
            return
        self._marco = E('div', 'qdlg-overlay')
        win = E('div', 'qdlg')
        barra = E('div', 'qdlg-bar')
        self._tit = E('span', '', self.windowTitle())
        x = E('button', 'qdlg-x', type='button')
        x.textContent = '×'
        on(x, 'click', lambda e: self.reject())
        barra.appendChild(self._tit)
        barra.appendChild(x)
        win.appendChild(barra)
        win.appendChild(self.el)
        self._marco.appendChild(win)
        _montar().appendChild(self._marco)
        on(self._marco, 'keydown', lambda e: self.reject() if e.key == 'Escape' else None)

    def setWindowTitle(self, t):
        self._titulo = t
        if self._marco is not None:
            self._tit.textContent = t

    def open(self):
        self._construir()
        self._tit.textContent = self.windowTitle()
        self._marco.classList.add('show')
        soon(lambda: self.setFocus())

    show = open

    def exec_(self):
        self.open()
        return 0

    exec = exec_

    def accept(self):
        self._cerrar()
        self.accepted.emit()
        self.finished.emit(1)

    def reject(self):
        self._cerrar()
        self.rejected.emit()
        self.finished.emit(0)

    def done(self, r):
        self.accept() if r else self.reject()

    def _cerrar(self):
        if self._marco is not None:
            self._marco.classList.remove('show')

    def hide(self):
        self._cerrar()

    def close(self):
        self._cerrar()


class QMainWindow(QWidget):
    clase = 'qmw'

    def __init__(self, parent=None):
        super().__init__(None)
        self._central = None
        self._menubar = None
        self._status = None

    def setCentralWidget(self, w):
        self._central = w
        self._armar()

    def setMenuBar(self, m):
        self._menubar = m
        self._armar()

    def setStatusBar(self, s):
        self._status = s
        self._armar()

    def _armar(self):
        self.el.innerHTML = ''
        if self._menubar is not None:
            self.el.appendChild(self._menubar.el)
        if self._central is not None:
            self._central.el.classList.add('qmw-central')
            self.el.appendChild(self._central.el)
        if self._status is not None:
            self.el.appendChild(self._status.el)

    def statusBar(self):
        return self._status

    def setWindowIcon(self, *a):
        pass

    def setAcceptDrops(self, b):
        if b and not getattr(self, '_drop', False):
            self._drop = True
            on(self.el, 'dragover', lambda e: e.preventDefault())
            on(self.el, 'drop', lambda e: self._soltar(e))

    def _soltar(self, e):
        e.preventDefault()
        from . import _archivos

        archivos = list(e.dataTransfer.files)
        if archivos:
            asyncio.ensure_future(_archivos.recibir(archivos, self._tras_soltar))

    def _tras_soltar(self, rutas):
        if hasattr(self, 'dropEvent'):
            self.dropEvent(_Soltar(rutas))

    def mount(self, destino):
        destino.appendChild(self.el)


def _abrir_ventana(w):
    """Muestra un widget suelto en una ventana flotante (se puede mover y cambiar de tamaño)."""
    if getattr(w, '_ventana', None) is None:
        marco = E('div', 'qdlg-overlay modeless')
        win = E('div', 'qdlg qwin')
        barra = E('div', 'qdlg-bar')
        titulo = E('span', '', w.windowTitle())
        x = E('button', 'qdlg-x', type='button')
        x.textContent = '\u00d7'
        barra.appendChild(titulo)
        barra.appendChild(x)
        cuerpo = E('div', 'qdlg-body qwin-body')
        cuerpo.appendChild(w.el)
        win.appendChild(barra)
        win.appendChild(cuerpo)
        marco.appendChild(win)
        _montar().appendChild(marco)
        w._ventana = marco
        w._titulo_el = titulo
        on(x, 'click', lambda e: marco.classList.remove('show'))
        # mover la ventana arrastrando la barra de título
        estado = {'dx': 0, 'dy': 0, 'x0': 0, 'y0': 0, 'on': False}

        def bajar(e):
            if x.contains(e.target):
                return
            estado.update(on=True, x0=e.clientX, y0=e.clientY)
            barra.setPointerCapture(e.pointerId)

        def mover(e):
            if estado['on']:
                win.style.transform = f"translate({estado['dx'] + e.clientX - estado['x0']}px, {estado['dy'] + e.clientY - estado['y0']}px)"

        def soltar(e):
            if estado['on']:
                estado.update(on=False, dx=estado['dx'] + e.clientX - estado['x0'], dy=estado['dy'] + e.clientY - estado['y0'])

        on(barra, 'pointerdown', bajar)
        on(barra, 'pointermove', mover)
        on(barra, 'pointerup', soltar)
    w._titulo_el.textContent = w.windowTitle()
    w.el.style.display = ''
    w._visible = True
    w._ventana.classList.add('show')


class _Soltar:
    def __init__(self, rutas):
        self._r = rutas

    def mimeData(self):
        return self

    def hasUrls(self):
        return True

    def urls(self):
        from .QtCore import QUrl

        return [QUrl(r) for r in self._r]

    def accept(self):
        pass

    def ignore(self):
        pass


class QColorDialog(QObject):
    ShowAlphaChannel = 1
    currentColorChanged = pyqtSignal(object)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._in = E('input', type='color')
        self._in.style.position = 'fixed'
        self._in.style.opacity = '0'
        self._in.style.pointerEvents = 'none'
        on(self._in, 'input', lambda e: self.currentColorChanged.emit(QColor(str(self._in.value))))

    def setCurrentColor(self, c):
        n = c.name() if hasattr(c, 'name') else str(c)
        if len(n) == 7:
            self._in.value = n

    def setOption(self, *a):
        pass

    def open(self):
        _montar().appendChild(self._in)
        try:
            self._in.showPicker()
        except Exception:
            self._in.click()


class QStyle:
    SP_TitleBarShadeButton = 'up'
    SP_TitleBarUnshadeButton = 'down'
    SP_ArrowUp = 'up'
    SP_ArrowDown = 'down'


class QApplication:
    pass


class QFileDialog:
    """En el navegador los archivos se eligen con PyQt5._archivos (es asíncrono)."""

    Options = int
    DontUseNativeDialog = 0


class QMessageBox:
    @staticmethod
    def warning(*a, **k):
        pass

    @staticmethod
    def information(*a, **k):
        pass


class QCheckableComboBox(QComboBox):
    """Desplegable con casillas: cada opción se tilda o destilda sin cerrar la lista."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._estado = []  # [tildado, habilitado]
        self.el.classList.add('qcheckcombo')
        self._sel.style.display = 'none'
        self._caja = E('button', 'qcheckcombo-btn', type='button')
        self._lista = E('div', 'qcheckcombo-pop')
        self.el.appendChild(self._caja)
        self.el.appendChild(self._lista)
        on(self._caja, 'click', lambda e: self._lista.classList.toggle('open'))
        on(document, 'pointerdown', lambda e: self._lista.classList.remove('open') if not self.el.contains(e.target) else None)

    def addItem(self, *args):
        super().addItem(*args)
        self._estado.append([0, True])
        self._pintar()

    def clear(self):
        super().clear()
        self._estado = []
        self._pintar()

    def setItemText(self, i, t):
        super().setItemText(i, t)
        self._pintar()

    def _habilitar(self, i, b):
        self._estado[i][1] = b
        self._pintar()

    def _habilitado(self, i):
        return self._estado[i][1]

    def _tildar(self, i, estado):
        self._estado[i][0] = 2 if estado else 0
        self._pintar()

    def _tildado(self, i):
        return self._estado[i][0]

    def _pintar(self):
        marcados = [self.itemText(i) for i, (c, h) in enumerate(self._estado) if c]
        self._caja.textContent = ', '.join(marcados) if marcados else '\u00a0'
        self._lista.innerHTML = ''
        for i, (c, h) in enumerate(self._estado):
            fila = E('label', 'qcheckcombo-fila')
            casilla = E('input', type='checkbox')
            casilla.checked = bool(c)
            casilla.disabled = not h
            fila.classList.toggle('off', not h)
            fila.appendChild(casilla)
            fila.appendChild(E('span', '', self.itemText(i)))
            on(casilla, 'change', lambda e, i=i, casilla=casilla: self._cambio_casilla(i, bool(casilla.checked)))
            self._lista.appendChild(fila)

    def _cambio_casilla(self, i, b):
        self._estado[i][0] = 2 if b else 0
        marcados = [self.itemText(k) for k, (c, h) in enumerate(self._estado) if c]
        self._caja.textContent = ', '.join(marcados) if marcados else '\u00a0'


class Line(QWidget):
    """Línea separadora (QFrame de tipo HLine / VLine)."""

    clase = 'qw qline'
    hp0, vp0 = QSizePolicy.Expanding, QSizePolicy.Minimum

    def __init__(self, parent=None, vertical=False):
        super().__init__(parent)
        self.el.classList.add('qline-v' if vertical else 'qline-h')

    def setVertical(self, b):
        self.el.classList.toggle('qline-v', b)
        self.el.classList.toggle('qline-h', not b)
