"""Spinbox con prefijos del SI (k, m, u, n...), equivalente al ScienDSpinBox de pyqt-labutils pero para el navegador."""
import math
import re

from PyQt5.QtWidgets import QDoubleSpinBox

_PREFIJOS = {-24: 'y', -21: 'z', -18: 'a', -15: 'f', -12: 'p', -9: 'n', -6: 'u', -3: 'm', 0: '', 3: 'k', 6: 'M', 9: 'G', 12: 'T', 15: 'P'}
_EXP = {v: k for k, v in _PREFIJOS.items() if v}
_EXP.update({'µ': -6, 'K': 3, 'meg': 6, 'Meg': 6})
_RE = re.compile(r'\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*(meg|Meg|[yzafpnuµmkKMGTP])?\s*[A-Za-zΩ]*\s*$')


class ScienDSpinBox(QDoubleSpinBox):
    def __init__(self, parent=None):
        super().__init__(parent)
        self._min, self._max = -1e300, 1e300
        self._dec = 6
        self._mostrar()

    def _formato(self, v):
        if v == 0:
            return '0.0'
        a = abs(v)
        if 1e-3 <= a < 1e3:
            s = f'{v:.6g}'
            return s if ('.' in s or 'e' in s) else s + '.0'
        e = int(math.floor(math.log10(a) / 3) * 3)
        e = max(-24, min(15, e))
        s = f'{v / 10 ** e:.6g}'
        if '.' not in s and 'e' not in s:
            s += '.0'
        return s + _PREFIJOS[e]

    def _parsear(self, texto):
        m = _RE.match(texto.replace(',', '.'))
        if not m:
            raise ValueError(texto)
        return float(m.group(1)) * 10 ** _EXP.get(m.group(2) or '', 0)

    def _poner(self, v, emitir):
        v = min(max(float(v), self._min), self._max)
        cambio = v != self._v
        self._v = v
        self._mostrar()
        if cambio and emitir:
            self.valueChanged.emit(v)

    def _mover(self, d):
        v = self._v
        paso = 0.1 if v == 0 else 10 ** (math.floor(math.log10(abs(v))) - 1)
        self._poner(v + d * paso * 10 if abs(v) >= 1e-300 else d * 0.1, True)

    def setDecimals(self, d):
        pass
