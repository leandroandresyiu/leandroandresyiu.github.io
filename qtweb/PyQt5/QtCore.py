"""Parte de QtCore que usa PlotTool."""
import os

from ._sig import Signal, pyqtSignal, pyqtSlot  # noqa: F401


class _Color:
    def __init__(self, nombre):
        self._n = nombre

    def name(self):
        return self._n


class _ItemFlag:
    NoItemFlags = 0
    ItemIsSelectable = 1
    ItemIsEditable = 2
    ItemIsDragEnabled = 4
    ItemIsDropEnabled = 8
    ItemIsUserCheckable = 16
    ItemIsEnabled = 32
    ItemIsAutoTristate = 64
    ItemNeverHasChildren = 128
    ItemIsUserTristate = 256


class Qt(_ItemFlag):
    ItemFlag = _ItemFlag
    UserRole = 256
    Checked = 2
    Unchecked = 0
    PartiallyChecked = 1
    Horizontal = 1
    Vertical = 2
    ToolButtonTextOnly = 1
    AlignCenter = 132
    AlignLeft = 1
    AlignRight = 2
    red = _Color('#ff0000')
    black = _Color('#000000')
    white = _Color('#ffffff')


class QObject:
    def __init__(self, parent=None):
        self._parent = parent
        self._bloqueado = False
        self._nombre = ''

    def blockSignals(self, b):
        previo = self._bloqueado
        self._bloqueado = bool(b)
        return previo

    def signalsBlocked(self):
        return self._bloqueado

    def setObjectName(self, n):
        self._nombre = n

    def objectName(self):
        return self._nombre

    def parent(self):
        return self._parent


class _Portapapeles:
    _ultimo = ''

    def text(self):
        return _Portapapeles._ultimo

    def setText(self, texto):
        import js

        _Portapapeles._ultimo = str(texto)

        try:
            js.navigator.clipboard.writeText(str(texto))
        except Exception:
            ta = js.document.createElement('textarea')
            ta.value = str(texto)
            js.document.body.appendChild(ta)
            ta.select()
            js.document.execCommand('copy')
            ta.remove()


class _Aplicacion:
    def clipboard(self):
        return _Portapapeles()


class QCoreApplication:
    @staticmethod
    def translate(ctx, texto, *a, **k):
        return texto

    @staticmethod
    def instance():
        return _Aplicacion()


class QFileInfo:
    def __init__(self, path=''):
        self._p = path or ''

    def fileName(self):
        return os.path.basename(self._p)

    def suffix(self):
        n = os.path.basename(self._p)
        return n.rsplit('.', 1)[1] if '.' in n else ''

    def filePath(self):
        return self._p


class QSize:
    def __init__(self, w=0, h=0):
        self._w, self._h = w, h

    def width(self):
        return self._w

    def height(self):
        return self._h


class QRect:
    def __init__(self, x=0, y=0, w=0, h=0):
        self._r = (x, y, w, h)

    def width(self):
        return self._r[2]

    def height(self):
        return self._r[3]


class QMetaObject:
    @staticmethod
    def connectSlotsByName(obj):
        pass


class QUrl:
    def __init__(self, ruta=''):
        self._r = ruta

    def toLocalFile(self):
        return self._r


class QTimer:
    @staticmethod
    def singleShot(ms, f):
        import js
        from pyodide.ffi import create_once_callable

        js.setTimeout(create_once_callable(f), ms)
