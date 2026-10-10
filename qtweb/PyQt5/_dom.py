"""Atajos para crear y escuchar elementos del navegador desde Python."""
import js
from pyodide.ffi import create_proxy

document = js.document
_vivos = []  # los callbacks tienen que seguir vivos mientras exista la página


def E(tag, cls='', texto=None, **attrs):
    e = document.createElement(tag)
    if cls:
        e.className = cls
    if texto is not None:
        e.textContent = texto
    for k, v in attrs.items():
        e.setAttribute(k.replace('_', '-'), str(v))
    return e


def on(el, evento, f, **opciones):
    p = create_proxy(f)
    _vivos.append(p)
    if opciones:
        el.addEventListener(evento, p, js.Object.fromEntries([[k, v] for k, v in opciones.items()]))
    else:
        el.addEventListener(evento, p)
    return p


def soon(f):
    """Ejecuta f en el próximo ciclo (después de que el navegador termine lo que está haciendo)."""
    p = create_proxy(f)
    _vivos.append(p)
    js.setTimeout(p, 0)


def frame(f):
    p = create_proxy(f)
    _vivos.append(p)
    js.requestAnimationFrame(p)
