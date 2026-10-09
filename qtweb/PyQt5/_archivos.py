"""Archivos del navegador <-> sistema de archivos virtual de Python."""
import os

import js
from pyodide.ffi import create_proxy

from ._dom import E, document, on

CARPETA = '/work'


async def recibir(archivos, callback):
    """Copia archivos del navegador (File) al sistema de archivos de Python y llama a callback(rutas)."""
    os.makedirs(CARPETA, exist_ok=True)
    rutas = []
    for f in archivos:
        datos = (await f.arrayBuffer()).to_py()
        ruta = os.path.join(CARPETA, str(f.name))
        with open(ruta, 'wb') as h:
            h.write(bytes(datos))
        rutas.append(ruta)
    callback(rutas)


def elegir(callback, multiple=True, accept=''):
    """Abre el selector de archivos del navegador. callback(rutas) recibe las rutas ya copiadas."""
    import asyncio

    entrada = E('input', type='file')
    entrada.multiple = multiple
    if accept:
        entrada.accept = accept
    entrada.style.display = 'none'
    document.body.appendChild(entrada)

    def listo(e):
        archivos = list(entrada.files)
        entrada.remove()
        if archivos:
            asyncio.ensure_future(recibir(archivos, callback))

    on(entrada, 'change', listo)
    entrada.click()


def descargar(nombre, datos, mime='application/octet-stream'):
    """Hace que el navegador baje un archivo con esos bytes."""
    from pyodide.ffi import to_js

    blob = js.Blob.new([to_js(bytes(datos))], js.Object.fromEntries([['type', mime]]))
    url = js.URL.createObjectURL(blob)
    a = E('a')
    a.href = url
    a.download = nombre
    document.body.appendChild(a)
    a.click()
    a.remove()
    p = create_proxy(lambda: js.URL.revokeObjectURL(url))
    js.setTimeout(p, 2000)
