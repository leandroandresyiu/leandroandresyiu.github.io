"""Spinbox con prefijos del SI (k, m, u, n...), equivalente al ScienDSpinBox de qudi pero para el navegador.

Muestra el valor como el original: mantisa entre 1 y 1000 con la cantidad de decimales pedida, un espacio, el prefijo y
el sufijo ("5.00 Hz", "1.50 kHz", "250.00 mHz"). Los pasos de las flechas son proporcionales al valor."""
import math
import re

from PyQt5.QtWidgets import QDoubleSpinBox

_POSITIVOS = 'kMGTPEZY'
_NEGATIVOS = 'mµnpfazy'
_EXP = {c: 3 * (i + 1) for i, c in enumerate(_POSITIVOS)}
_EXP.update({c: -3 * (i + 1) for i, c in enumerate(_NEGATIVOS)})
_EXP.update({'u': -6, 'K': 3, 'meg': 6, 'Meg': 6})
_RE = re.compile(r'\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*(meg|Meg|[yzafpnuµmkKMGTPEZY])?\s*[A-Za-zΩ/]*\s*$')


class ScienDSpinBox(QDoubleSpinBox):
    def __init__(self, parent=None):
        super().__init__(parent)
        self._min, self._max = -1e300, 1e300
        self._dec = 2
        self._paso = 0.1
        self._mostrar()

    def _formato(self, v):
        if math.isinf(v):
            return '-inf ' if v < 0 else 'inf '
        signo = '-' if v < 0 else ''
        a = abs(v)
        d = max(0, int(self._dec))
        if a == 0:
            e3 = 0
        elif a >= 0.1:
            e3 = max(0, math.floor(math.log10(a) / 3))
        else:
            e3 = math.floor(math.log10(a) / 3)
        e3 = max(-8, min(8, e3))
        texto = f'{a / 10 ** (3 * e3):.{d}f}'
        if float(texto) >= 1000 and e3 < 8:  # el redondeo pasó de 999.99 a 1000.00
            e3 += 1
            texto = f'{a / 10 ** (3 * e3):.{d}f}'
        prefijo = '' if e3 == 0 else (_POSITIVOS[e3 - 1] if e3 > 0 else _NEGATIVOS[-e3 - 1])
        return f'{signo}{texto} {prefijo}'

    def _parsear(self, texto):
        m = _RE.match(texto.replace(',', '.'))
        if not m:
            raise ValueError(texto)
        return float(m.group(1)) * 10 ** _EXP.get(m.group(2) or '', 0)

    def _ancho_natural(self):
        self._in.style.width = '59px'  # sizeHint del original

    def _poner(self, v, emitir):
        v = min(max(float(v), self._min), self._max)
        cambio = v != self._v
        self._v = v
        self._mostrar()
        if cambio and emitir:
            self.valueChanged.emit(v)

    def _mover(self, d):
        # Qt-qudi: paso = singleStep * 10 ** floor(log10(|valor|)); desde cero no se mueve (paso mínimo 0).
        v = self._v
        if v == 0:
            return
        s = 1 if d >= 0 else -1
        vs = 1 if v >= 0 else -1
        exp = math.floor(math.log10(abs(v * 1.01 ** (s * vs))))
        self._poner(v + s * self._paso * 10 ** exp, True)

    def setDecimals(self, d):
        self._dec = max(0, min(20, int(d)))
        self._mostrar()
