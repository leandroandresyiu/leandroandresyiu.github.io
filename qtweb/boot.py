"""Arranque de PlotTool dentro del navegador."""
import os
import sys

os.environ['MPLBACKEND'] = 'agg'
os.environ.setdefault('HOME', '/home/pyodide')
if '/app' not in sys.path:
    sys.path.insert(0, '/app')

import warnings  # noqa: E402

# El código original trae textos con barras invertidas sin "r" (por ejemplo '$\sigma$'): Python 3.14 avisa en cada arranque.
warnings.filterwarnings('ignore', category=SyntaxWarning)

import matplotlib  # noqa: E402

matplotlib.use('Agg')

# El canvas de Qt de matplotlib se reemplaza por uno que dibuja en el navegador.
from PyQt5 import _mplqt  # noqa: E402

sys.modules['matplotlib.backends.backend_qt5agg'] = _mplqt


def main():
    import js

    from PyQt5 import QtWidgets

    cfg = getattr(js.window, 'QTWEB', None)
    pad = getattr(cfg, 'pad', None) if cfg is not None else None
    if pad is not None:
        QtWidgets.PAD_ETIQUETAS[:] = [float(x) for x in pad]

    from src.mainwindow import MainWindow

    global ventana
    ventana = MainWindow()
    ventana.mount(js.document.getElementById('app'))
    try:
        import src.info as info
    except ImportError:
        info = None
    if info is not None:
        from PyQt5 import _info

        _info.instalar(ventana, info)  # sin barra de menú: botones de ajustes e información en la esquina
    return ventana


ventana = None
