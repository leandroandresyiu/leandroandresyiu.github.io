"""Reemplazo mínimo de la biblioteca svgwrite (para kumOS).

El programa original (Spice-a-PDF) arma el dibujo con svgwrite. Acá se incluye solamente lo que usa, para no tener que
instalar nada en el navegador: Drawing (add, line, circle, text, viewbox, tostring), rgb y un nodo "crudo" para pegar
los símbolos ya incrustados. No es la biblioteca real (esa es de Manfred Moitzi, licencia MIT).
"""
from xml.sax.saxutils import escape, quoteattr


def rgb(r=0, g=0, b=0, mode='RGB'):
    if mode == '%':
        return f'rgb({r}%,{g}%,{b}%)'
    return f'rgb({r},{g},{b})'


def _num(v):
    if isinstance(v, float):
        s = f'{v:.6f}'.rstrip('0').rstrip('.')
        return s if s not in ('', '-0') else '0'
    return str(v)


class Element:
    def __init__(self, tag, atributos=None, texto=None):
        self.tag = tag
        self.atributos = dict(atributos or {})
        self.texto = texto
        self.hijos = []

    def __setitem__(self, clave, valor):
        self.atributos[clave] = valor

    def add(self, hijo):
        self.hijos.append(hijo)
        return hijo

    def rotate(self, angulo, center=None):
        """Agrega una rotación (en grados) alrededor de un punto, como en svgwrite."""
        t = f'rotate({_num(angulo)}' + (f',{_num(center[0])},{_num(center[1])}' if center else '') + ')'
        previo = self.atributos.get('transform')
        self.atributos['transform'] = f'{previo} {t}' if previo else t

    def tostring(self):
        if self.tag == 'text' and self.texto is not None and not self.texto.strip():
            return ''  # un texto vacío no se dibuja
        attrs = ''.join(f' {k}={quoteattr(_num(v))}' for k, v in sorted(self.atributos.items()))
        if self.texto is None and not self.hijos:
            return f'<{self.tag}{attrs} />'
        interior = escape(self.texto) if self.texto is not None else ''
        interior += ''.join(h.tostring() if hasattr(h, 'tostring') else str(h) for h in self.hijos)
        return f'<{self.tag}{attrs}>{interior}</{self.tag}>'


class Crudo:
    """Trozo de SVG ya escrito (los símbolos incrustados)."""

    def __init__(self, xml):
        self.xml = xml

    def tostring(self):
        return self.xml


def _attrs(kw):
    r = {}
    for k, v in kw.items():
        if v is None:
            continue
        k = k.rstrip('_').replace('_', '-')
        if k == 'font-size' and isinstance(v, str) and v.endswith('px'):
            v = v[:-2]  # tamaños sin unidad: 1 unidad del dibujo = 1 punto del PDF
        if k == 'font-family' and isinstance(v, str) and ' ' in v and not v.startswith(("'", '"')):
            v = f"'{v}'"  # "LM Roman 10" sin comillas no es un nombre de fuente válido en CSS (por el 10)
        r[k] = v
    return r


class Drawing:
    def __init__(self, filename=None, size=None, profile='tiny', **kw):
        self.size = size
        self.hijos = []
        self._viewbox = None

    # --- elementos que usa el programa ---
    def line(self, start=None, end=None, **kw):
        return Element('line', {'x1': start[0], 'y1': start[1], 'x2': end[0], 'y2': end[1], **_attrs(kw)})

    def circle(self, center=None, r=None, **kw):
        return Element('circle', {'cx': center[0], 'cy': center[1], 'r': r, **_attrs(kw)})

    def text(self, texto, insert=None, **kw):
        a = {'x': insert[0], 'y': insert[1], **_attrs(kw)}
        return Element('text', a, texto)

    def add(self, elemento):
        self.hijos.append(elemento)
        return elemento

    def viewbox(self, minx=0, miny=0, width=0, height=0):
        self._viewbox = (minx, miny, width, height)

    def tostring(self):
        a = {'xmlns': 'http://www.w3.org/2000/svg', 'version': '1.1'}
        if self.size:
            a['width'], a['height'] = self.size
        if self._viewbox:
            a['viewBox'] = ' '.join(_num(v) for v in self._viewbox)
        cuerpo = ''.join(h.tostring() for h in self.hijos)
        attrs = ''.join(f' {k}={quoteattr(_num(v))}' for k, v in a.items())
        return f'<svg{attrs}>{cuerpo}</svg>'
