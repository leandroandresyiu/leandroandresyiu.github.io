"""Señales al estilo PyQt: connect / emit, con la regla de PyQt de pasarle al slot solo los argumentos que acepta."""
import inspect


def _aridad(f):
    """Cantidad máxima de argumentos posicionales que acepta `f` (None si acepta cualquier cantidad)."""
    try:
        sig = inspect.signature(f)
    except (TypeError, ValueError):
        return None
    n = 0
    for p in sig.parameters.values():
        if p.kind == p.VAR_POSITIONAL:
            return None
        if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD):
            n += 1
    return n


class Signal:
    def __init__(self, owner=None):
        self._slots = []
        self._owner = owner

    def connect(self, f):
        self._slots.append((f, _aridad(f)))

    def disconnect(self, f=None):
        if f is None:
            self._slots = []
        else:
            self._slots = [s for s in self._slots if s[0] != f]

    def emit(self, *args):
        o = self._owner
        if o is not None and getattr(o, '_bloqueado', False):
            return
        for f, n in list(self._slots):
            f(*(args if n is None else args[:n]))


class pyqtSignal:
    """Descriptor: cada objeto tiene sus propias señales."""

    def __init__(self, *tipos):
        self.tipos = tipos
        self.nombre = None

    def __set_name__(self, owner, name):
        self.nombre = '_sig_' + name

    def __get__(self, obj, tipo=None):
        if obj is None:
            return self
        s = obj.__dict__.get(self.nombre)
        if s is None:
            s = obj.__dict__[self.nombre] = Signal(obj)
        return s


def pyqtSlot(*a, **k):
    def deco(f):
        return f

    return deco
