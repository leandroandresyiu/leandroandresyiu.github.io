"""Esquina de la ventana principal: en lugar de la barra de menú, un botón de ajustes (engranaje) y uno de información (i)."""
from ._dom import E, document, on

_SVG_ENGRANAJE = (
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="8.6" '
    'stroke-width="3.2" stroke-dasharray="3.37 3.37" transform="rotate(-11 12 12)"/><circle cx="12" cy="12" r="6.2" stroke-width="2"/>'
    '<circle cx="12" cy="12" r="2.4" stroke-width="2"/></svg>'
)


def _boton(clase, titulo):
    b = E('button', 'qcorner-btn ' + clase, type='button')
    b.title = titulo
    return b


def _ventana_info(ventana, modulo):
    """Ventana de ayuda: ocupa lo que entra en pantalla y el texto se desplaza con una barra vertical siempre visible."""
    previa = getattr(ventana, '_info_ov', None)
    if previa is not None:
        previa.classList.add('show')
        previa.querySelector('.qinfo-body').focus()
        return
    ov = E('div', 'qinfo-ov show')
    win = E('div', 'qinfo-win')
    win.setAttribute('role', 'dialog')
    win.setAttribute('aria-label', modulo.TITULO)
    barra = E('div', 'qinfo-bar')
    barra.appendChild(E('span', '', modulo.TITULO))
    x = E('button', 'qdlg-x', type='button')
    x.textContent = '×'
    x.title = 'Cerrar (Esc)'
    barra.appendChild(x)
    cuerpo = E('div', 'qinfo-body qinfo')
    cuerpo.setAttribute('tabindex', '0')
    cuerpo.innerHTML = modulo.HTML
    win.appendChild(barra)
    win.appendChild(cuerpo)
    ov.appendChild(win)
    document.body.appendChild(ov)
    ventana._info_ov = ov

    def cerrar(e=None):
        ov.classList.remove('show')

    on(x, 'click', cerrar)
    on(ov, 'pointerdown', lambda e: cerrar() if e.target.classList.contains('qinfo-ov') else None)
    on(document, 'keydown', lambda e: cerrar() if (e.key == 'Escape' and ov.classList.contains('show')) else None)
    cuerpo.focus()


def _popover_ajustes(ventana, ajustes, caja):
    pop = E('div', 'qpop')
    cierres = []

    def estado():
        for el, accion in cierres:
            a = getattr(ventana, accion, None)
            if a is not None:
                el.classList.toggle('on', bool(a.isChecked()))

    for titulo, tipo, items in ajustes:
        pop.appendChild(E('div', 'qpop-t', titulo))
        for texto, accion in items:
            b = E('button', 'qpop-i' + ('' if tipo == 'botones' else ' qpop-marca'), texto, type='button')
            if tipo != 'botones':
                cierres.append((b, accion))

            def click(e, accion=accion, tipo=tipo):
                a = getattr(ventana, accion, None)
                if a is None:
                    return
                if tipo == 'radio' and a.isChecked():
                    estado()
                    return
                a.trigger()
                if tipo == 'botones':
                    caja.classList.remove('abierto')
                estado()

            on(b, 'click', click)
            pop.appendChild(b)
    estado()
    return pop, estado


def _boton_ajustes(ventana, ajustes):
    caja = E('div', 'qcorner-caja')
    b = _boton('qcorner-ajustes', 'Ajustes')
    b.innerHTML = _SVG_ENGRANAJE
    pop, estado = _popover_ajustes(ventana, ajustes, caja)
    caja.appendChild(b)
    caja.appendChild(pop)

    def abrir(e):
        estado()
        caja.classList.toggle('abierto')

    on(b, 'click', abrir)
    on(document, 'pointerdown', lambda e: caja.classList.remove('abierto') if not caja.contains(e.target) else None)
    return caja


def instalar(ventana, modulo):
    """modulo trae TITULO y HTML (la ayuda) y, si hace falta, AJUSTES: [(título, 'radio'|'check'|'botones', [(texto, acción)])]."""
    ventana.el.classList.add('sin-menu')
    tab = getattr(ventana, 'tabWidget', None)
    fila = getattr(tab, '_fila', None)
    if fila is None:
        return
    esquina = E('div', 'qtabs-corner')
    ajustes = getattr(modulo, 'AJUSTES', None)
    if ajustes:
        esquina.appendChild(_boton_ajustes(ventana, ajustes))
    info = _boton('qcorner-info', 'Cómo se usa')
    info.textContent = 'i'
    on(info, 'click', lambda e: _ventana_info(ventana, modulo))
    esquina.appendChild(info)
    fila.appendChild(esquina)
