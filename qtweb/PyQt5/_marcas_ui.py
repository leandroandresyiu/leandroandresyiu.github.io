"""Diálogo para agregar cursores, puntos y textos a un gráfico (ver _marcas.py para el motor)."""
from ._dom import E, on
from ._marcas import (ESTILOS, MARCAS, RASGOS_H, RASGOS_P, RASGOS_V, _ax, estado, nombres_curvas, nuevo_cursor, nuevo_punto,
                      nuevo_texto, num, refrescar)
from .QtWidgets import QWidget, _abrir_ventana


def _info_cursor(c, v):
    if v is not None:
        return ('→ y = ' if c['dir'] == 'H' else '→ x = ') + f'{v:.6g}'
    if c['modo'] == 'abs':
        return 'Valor no válido'
    return 'Sin datos: elegí una curva y, si hace falta, un valor dentro de su rango'


def _info_punto(p, xy):
    if xy is not None:
        return f'→ x = {xy[0]:.6g}, y = {xy[1]:.6g}'
    if p['modo'] == 'abs':
        return 'Valores no válidos'
    return 'Sin datos: elegí una curva y, si hace falta, un valor dentro de su rango'


def elegir_en_grafico(canvas, ventana, alcoger):
    """Esconde el diálogo hasta que se hace clic en el gráfico; llama a alcoger(x, y, fx, fy) con los datos y la fracción de ejes."""
    ax = _ax(canvas)
    aviso = E('div', 'kaviso')
    aviso.appendChild(E('span', '', 'Hacé clic en el gráfico donde quieras la marca '))
    cancelar = E('button', 'qbtn', 'Cancelar', type='button')
    aviso.appendChild(cancelar)
    canvas.el.appendChild(aviso)
    ventana.classList.remove('show')
    previo = canvas._cv.style.cursor
    canvas._cv.style.cursor = 'crosshair'
    est = {'cid': None}

    def terminar(e=None):
        if est['cid'] is not None:
            canvas.mpl_disconnect(est['cid'])
            est['cid'] = None
        canvas._cv.style.cursor = previo
        aviso.remove()
        ventana.classList.add('show')

    def clic(ev):
        if ev.inaxes is None or int(ev.button) != 1:
            return
        fx, fy = ax.transAxes.inverted().transform((ev.x, ev.y))
        x, y = ev.xdata, ev.ydata
        terminar()
        alcoger(float(x), float(y), float(fx), float(fy))

    est['cid'] = canvas.mpl_connect('button_press_event', clic)
    on(cancelar, 'click', terminar)


def abrir_dialogo(canvas):
    w = getattr(canvas, '_kum_dlg', None)
    if w is None:
        w = QWidget()
        w.setWindowTitle('Cursores, puntos y textos')
        w.el.classList.add('kmarcas-w')
        canvas._kum_dlg = w
    w.el.innerHTML = ''
    raiz = E('div', 'kmarcas')
    w.el.appendChild(raiz)
    est = estado(canvas)
    infos = {}

    def ventana_el():
        return getattr(w, '_ventana', None)

    def actualizar_info():
        res = est.get('_res', {})
        for clave, fn in (('cursores', _info_cursor), ('puntos', _info_punto)):
            for s in est[clave]:
                el = infos.get(id(s))
                if el is not None:
                    el.textContent = fn(s, res.get(id(s)))
        for s in est['textos']:
            el = infos.get(id(s))
            if el is not None:
                el.textContent = '' if res.get(id(s)) is not None else 'Valores no válidos'

    def cambio(estructural=None):
        refrescar(canvas)
        if estructural:
            estructural()
        actualizar_info()

    # ---- controles ----
    def campo(titulo, control, ancho=False):
        l = E('label', 'kc ancho' if ancho else 'kc')
        l.appendChild(E('span', '', titulo))
        l.appendChild(control)
        return l

    def entrada(s, clave, tipo='text', paso=None, numerico=False):
        i = E('input')
        i.type = tipo
        if paso:
            i.step = paso
        i.value = str(s[clave])

        def f(e):
            if numerico:
                v = num(i.value)
                if v is None or v <= 0:
                    return
                s[clave] = v
            else:
                s[clave] = str(i.value)
            cambio()

        on(i, 'input', f)
        return i

    def seleccion(s, clave, opciones, estructural=None):
        sel = E('select')
        for k, t in opciones.items():
            o = E('option', '', t)
            o.value = k
            sel.appendChild(o)
        sel.value = s[clave] if s[clave] in opciones else next(iter(opciones))

        def f(e):
            s[clave] = str(sel.value)
            cambio(estructural)

        on(sel, 'change', f)
        return sel

    def casilla(s, clave, texto):
        l = E('label', 'kchk')
        i = E('input')
        i.type = 'checkbox'
        i.checked = bool(s[clave])

        def f(e):
            s[clave] = bool(i.checked)
            cambio()

        on(i, 'change', f)
        l.appendChild(i)
        l.appendChild(E('span', '', texto))
        return l

    def selector_curva(s):
        ax = _ax(canvas)
        nombres = nombres_curvas(ax) if ax is not None else []
        sel = E('select')
        if not nombres:
            o = E('option', '', '(no hay curvas en este gráfico)')
            o.value = ''
            sel.appendChild(o)
            s['curva'] = ''
        else:
            for n in nombres:
                o = E('option', '', n)
                o.value = n
                sel.appendChild(o)
            if s.get('curva') not in nombres:
                s['curva'] = nombres[0]
            sel.value = s['curva']

        def f(e):
            s['curva'] = str(sel.value)
            cambio()

        on(sel, 'change', f)
        return sel

    def boton_elegir(fn):
        b = E('button', 'qbtn kpick', 'Elegir en el gráfico', type='button')
        on(b, 'click', lambda e: elegir_en_grafico(canvas, ventana_el(), fn))
        return b

    def card_base(clave, s, titulo):
        card = E('div', 'kcard')
        card.appendChild(E('div', 'ktitulo', titulo))
        x = E('button', 'kquitar', '×', type='button')
        x.title = 'Quitar'

        def quitar(e):
            est[clave].remove(s)
            infos.pop(id(s), None)
            dibujar(clave)
            refrescar(canvas)

        on(x, 'click', quitar)
        card.appendChild(x)
        return card

    def pie_info(card, s):
        el = E('div', 'kinfo')
        infos[id(s)] = el
        card.appendChild(el)

    # ---- tarjetas ----
    def card_cursor(s):
        card = card_base('cursores', s, 'Cursor')

        def again():
            dibujar('cursores')

        def cambia_dir():
            if s['rasgo'] not in (RASGOS_H if s['dir'] == 'H' else RASGOS_V):
                s['rasgo'] = 'min'
            again()

        card.appendChild(campo('Dirección', seleccion(s, 'dir', {'H': 'Horizontal (y = …)', 'V': 'Vertical (x = …)'}, cambia_dir)))
        card.appendChild(campo('Posición', seleccion(s, 'modo', {'abs': 'Absoluta (en los ejes)', 'rel': 'Relativa a los datos'}, again)))
        if s['modo'] == 'abs':
            def poner(x, y, fx, fy):
                s['valor'] = f'{(y if s["dir"] == "H" else x):.6g}'
                again()
                refrescar(canvas)
                actualizar_info()

            card.appendChild(campo('Valor', entrada(s, 'valor')))
            card.appendChild(campo(' ', boton_elegir(poner)))
        else:
            card.appendChild(campo('Curva', selector_curva(s)))
            card.appendChild(campo('Dónde', seleccion(s, 'rasgo', RASGOS_H if s['dir'] == 'H' else RASGOS_V, again)))
            if s['rasgo'] == 'en':
                card.appendChild(campo('x =' if s['dir'] == 'H' else 'y =', entrada(s, 'arg')))
        card.appendChild(campo('Color', entrada(s, 'color', 'color')))
        card.appendChild(campo('Estilo', seleccion(s, 'estilo', ESTILOS)))
        card.appendChild(campo('Grosor', entrada(s, 'ancho', 'number', '0.2', True)))
        card.appendChild(campo('Nombre en la leyenda', entrada(s, 'etiqueta'), True))
        card.appendChild(casilla(s, 'leyenda', 'Mostrar en la leyenda'))
        card.appendChild(casilla(s, 'mostrar', 'Escribir el valor'))
        pie_info(card, s)
        return card

    def card_punto(s):
        card = card_base('puntos', s, 'Punto')

        def again():
            dibujar('puntos')

        card.appendChild(campo('Posición', seleccion(s, 'modo', {'abs': 'Absoluta (en los ejes)', 'rel': 'Relativa a los datos'}, again)))
        if s['modo'] == 'abs':
            def poner(x, y, fx, fy):
                s['x'], s['y'] = f'{x:.6g}', f'{y:.6g}'
                again()
                refrescar(canvas)
                actualizar_info()

            card.appendChild(campo('x', entrada(s, 'x')))
            card.appendChild(campo('y', entrada(s, 'y')))
            card.appendChild(campo(' ', boton_elegir(poner)))
        else:
            card.appendChild(campo('Curva', selector_curva(s)))
            card.appendChild(campo('Dónde', seleccion(s, 'rasgo', RASGOS_P, again)))
            if s['rasgo'] in ('en_x', 'en_y'):
                card.appendChild(campo('x =' if s['rasgo'] == 'en_x' else 'y =', entrada(s, 'arg')))
        card.appendChild(campo('Forma', seleccion(s, 'marca', MARCAS)))
        card.appendChild(campo('Tamaño', entrada(s, 'tam', 'number', '1', True)))
        card.appendChild(campo('Color', entrada(s, 'color', 'color')))
        card.appendChild(campo('Nombre en la leyenda', entrada(s, 'etiqueta'), True))
        card.appendChild(casilla(s, 'leyenda', 'Mostrar en la leyenda'))
        card.appendChild(casilla(s, 'mostrar', 'Escribir (x, y)'))
        pie_info(card, s)
        return card

    def card_texto(s):
        card = card_base('textos', s, 'Texto')

        def again():
            dibujar('textos')

        t = E('textarea')
        t.rows = 2
        t.value = str(s['texto'])

        def f(e):
            s['texto'] = str(t.value)
            cambio()

        on(t, 'input', f)
        card.appendChild(campo('Texto (se pueden usar fórmulas como $f_0$)', t, True))
        card.appendChild(campo('Coordenadas', seleccion(s, 'coord', {'datos': 'De los datos', 'ejes': 'Del gráfico (0 a 1)'})))
        card.appendChild(campo('x', entrada(s, 'x')))
        card.appendChild(campo('y', entrada(s, 'y')))

        def poner(x, y, fx, fy):
            if s['coord'] == 'ejes':
                s['x'], s['y'] = f'{fx:.4g}', f'{fy:.4g}'
            else:
                s['x'], s['y'] = f'{x:.6g}', f'{y:.6g}'
            again()
            refrescar(canvas)
            actualizar_info()

        card.appendChild(campo(' ', boton_elegir(poner)))
        card.appendChild(campo('Tamaño', entrada(s, 'tam', 'number', '1', True)))
        card.appendChild(campo('Color', entrada(s, 'color', 'color')))
        pie_info(card, s)
        return card

    listas = {}
    CARDS = {'cursores': (card_cursor, nuevo_cursor), 'puntos': (card_punto, nuevo_punto), 'textos': (card_texto, nuevo_texto)}

    def dibujar(clave):
        lista = listas[clave]
        lista.innerHTML = ''
        for s in est[clave]:
            lista.appendChild(CARDS[clave][0](s))
        if not est[clave]:
            lista.appendChild(E('div', 'kvacio', 'Todavía no hay ninguno.'))
        actualizar_info()

    ayuda = E('div', 'kayuda')
    ayuda.textContent = ('Las marcas se dibujan sobre el gráfico y salen en la imagen cuando apretás el botón de guardar. '
                         '"Absoluta" las pone en un valor de los ejes; "Relativa a los datos" las pega a una curva (su mínimo, su máximo...) y se mueven si los datos cambian.')
    raiz.appendChild(ayuda)
    for clave, titulo, boton in (('cursores', 'Cursores', '+ Cursor'), ('puntos', 'Puntos', '+ Punto'), ('textos', 'Textos', '+ Texto')):
        sec = E('section', 'ksec')
        cab = E('div', 'khead')
        cab.appendChild(E('h4', '', titulo))
        b = E('button', 'qbtn', boton, type='button')

        def agregar(e, clave=clave):
            est[clave].append(CARDS[clave][1](canvas))
            dibujar(clave)
            refrescar(canvas)
            actualizar_info()

        on(b, 'click', agregar)
        cab.appendChild(b)
        sec.appendChild(cab)
        lista = E('div', 'klista')
        listas[clave] = lista
        sec.appendChild(lista)
        raiz.appendChild(sec)
        dibujar(clave)
    pie = E('div', 'kpie')
    recargar = E('button', 'qbtn', 'Actualizar la lista de curvas', type='button')
    on(recargar, 'click', lambda e: abrir_dialogo(canvas))
    borrar = E('button', 'qbtn', 'Quitar todo', type='button')

    def todo(e):
        for k in ('cursores', 'puntos', 'textos'):
            est[k].clear()
        abrir_dialogo(canvas)
        refrescar(canvas)

    on(borrar, 'click', todo)
    pie.appendChild(recargar)
    pie.appendChild(borrar)
    raiz.appendChild(pie)
    _abrir_ventana(w)
    refrescar(canvas)
    actualizar_info()
