"""Ejecución de celdas para py snippets (dentro de Pyodide, en un worker).

ejecutar(codigo) corre el código en un espacio de nombres compartido entre celdas y devuelve una lista JSON de salidas:
    {"t": "texto" | "latex" | "png" | "aviso" | "error", "v": ...}
"""
import ast
import base64
import io
import json
import os
import re
import sys
import tokenize
import traceback
import warnings

os.environ.setdefault("MPLBACKEND", "agg")

_salidas: list = []
NS: dict = {}


class _Texto:
    """Reemplaza a sys.stdout / sys.stderr y junta lo que se imprime, en orden."""

    def __init__(self, tipo="texto"):
        self.tipo = tipo

    def write(self, s):
        if not s:
            return 0
        if _salidas and _salidas[-1]["t"] == self.tipo:
            _salidas[-1]["v"] += s
        else:
            _salidas.append({"t": self.tipo, "v": s})
        return len(s)

    def flush(self):
        pass

    def isatty(self):
        return False


def _aviso(message, category, filename, lineno, file=None, line=None):
    if filename != "<celda>" and category.__name__.endswith("DeprecationWarning"):
        return  # avisos internos de las bibliotecas: no le sirven a quien usa la herramienta
    texto = f"{category.__name__}: {message}"
    if not any(o["t"] == "aviso" and o["v"] == texto for o in _salidas):
        _salidas.append({"t": "aviso", "v": texto})


def _latex_de(x):
    import sympy as sp

    if "lcapy" in sys.modules:
        import lcapy

        if isinstance(x, lcapy.Expr):
            from kumolib import bonito

            x = bonito(x)
    if isinstance(x, (sp.Basic, sp.MatrixBase)):
        return sp.latex(x)
    return None


def mostrar_obj(x):
    """Agrega un objeto a la salida de la celda con el mejor formato que tenga."""
    import numpy as np

    if x is None:
        return
    try:
        import matplotlib.figure

        if isinstance(x, matplotlib.figure.Figure):
            _salidas.append({"t": "png", "v": _png(x)})
            import matplotlib.pyplot as plt

            plt.close(x)  # ya se mostró: que no salga de nuevo al juntar las figuras abiertas
            return
    except Exception:
        pass
    if hasattr(x, "_repr_resumen"):
        _salidas.append({"t": "texto", "v": x._repr_resumen() + "\n"})
        return
    try:
        tex = _latex_de(x)
    except Exception:
        tex = None
    if tex is not None:
        _salidas.append({"t": "latex", "v": tex})
        return
    if isinstance(x, (list, tuple)) and x and all(_latex_ok(i) for i in x) and len(x) <= 12:
        partes = [_latex_de(i) for i in x]
        _salidas.append({"t": "latex", "v": r",\ \ ".join(partes)})
        return
    if isinstance(x, np.ndarray) and x.dtype.kind in "fc":
        with np.printoptions(precision=6, suppress=False, linewidth=110):
            _salidas.append({"t": "texto", "v": repr(x) + "\n"})
        return
    _salidas.append({"t": "texto", "v": (x if isinstance(x, str) and False else repr(x)) + "\n"})


def _latex_ok(x):
    try:
        return _latex_de(x) is not None
    except Exception:
        return False


def _png(fig):
    b = io.BytesIO()
    fig.savefig(b, format="png", dpi=fig.dpi, bbox_inches="tight", facecolor="white")
    return base64.b64encode(b.getvalue()).decode()


def _recoger_figuras():
    if "matplotlib.pyplot" not in sys.modules:
        return
    import matplotlib.pyplot as plt

    for n in plt.get_fignums():
        _salidas.append({"t": "png", "v": _png(plt.figure(n))})
    plt.close("all")


def _huecos(codigo):
    try:
        for tok in tokenize.generate_tokens(io.StringIO(codigo).readline):
            if tok.type == tokenize.NAME and tok.string == "___":
                return tok.start[0]
    except Exception:
        pass
    return None


def reiniciar():
    NS.clear()
    NS.update({"__name__": "__main__"})
    exec(
        "import numpy as np\nimport sympy as sp\nimport matplotlib.pyplot as plt\nfrom scipy import signal\nfrom kumolib import *\n",
        NS,
    )
    import matplotlib.pyplot as plt

    plt.show = lambda *a, **k: None


def ejecutar(codigo: str) -> str:
    _salidas.clear()
    old = sys.stdout, sys.stderr
    sys.stdout, sys.stderr = _Texto("texto"), _Texto("aviso")
    viejo_aviso = warnings.showwarning
    warnings.showwarning = _aviso
    warnings.simplefilter("always")
    try:
        linea = _huecos(codigo)
        if linea:
            _salidas.append({"t": "error", "v": f"Falta completar un ___ (línea {linea}). Tocá el recuadro naranja y escribí el dato; con Tab saltás al siguiente."})
            return json.dumps(_salidas)
        try:
            arbol = ast.parse(codigo, "<celda>")
            ultimo = None
            if arbol.body and isinstance(arbol.body[-1], ast.Expr):
                ultimo = ast.Expression(arbol.body.pop().value)
            exec(compile(arbol, "<celda>", "exec"), NS)
            if ultimo is not None:
                mostrar_obj(eval(compile(ultimo, "<celda>", "eval"), NS))
        except BaseException as e:  # noqa: BLE001
            _salidas.append({"t": "error", "v": _error(e)})
        _recoger_figuras()
    finally:
        sys.stdout, sys.stderr = old
        warnings.showwarning = viejo_aviso
    return json.dumps(_salidas)


def _error(e):
    tb = traceback.extract_tb(e.__traceback__)
    propios = [f for f in tb if f.filename == "<celda>"]
    if isinstance(e, SyntaxError):
        return f"Error de sintaxis en la línea {e.lineno}: {e.msg}"
    cab = ""
    if propios:
        f = propios[-1]
        cab = f"Línea {f.lineno}: "
    return cab + "".join(traceback.format_exception_only(type(e), e)).strip()


reiniciar()
