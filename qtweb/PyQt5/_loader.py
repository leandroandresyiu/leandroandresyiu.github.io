"""Lee los archivos de diseño de Qt Designer (.ui) y arma los widgets, igual que hacía pyuic5."""
import importlib
import xml.etree.ElementTree as ET

from . import QtWidgets as W

LIBRE = 16777215

_CLASES = {
    'QWidget': W.QWidget,
    'QFrame': W.QFrame,
    'QGroupBox': W.QGroupBox,
    'QTabWidget': W.QTabWidget,
    'QScrollArea': W.QScrollArea,
    'QPushButton': W.QPushButton,
    'QToolButton': W.QToolButton,
    'QLabel': W.QLabel,
    'QLineEdit': W.QLineEdit,
    'QListWidget': W.QListWidget,
    'QComboBox': W.QComboBox,
    'QDoubleSpinBox': W.QDoubleSpinBox,
    'QSpinBox': W.QSpinBox,
    'QCheckBox': W.QCheckBox,
    'QRadioButton': W.QRadioButton,
    'QTextBrowser': W.QTextBrowser,
    'QDialogButtonBox': W.QDialogButtonBox,
    'Line': W.Line,
    'QMenuBar': W.QMenuBar,
    'QMenu': W.QMenu,
    'QStatusBar': W.QStatusBar,
}
_LAYOUTS = {'QGridLayout': W.QGridLayout, 'QHBoxLayout': W.QHBoxLayout, 'QVBoxLayout': W.QVBoxLayout, 'QFormLayout': W.QFormLayout}

_POLITICAS = {
    'Fixed': 0,
    'Minimum': 1,
    'Maximum': 4,
    'Preferred': 5,
    'MinimumExpanding': 3,
    'Expanding': 7,
    'Ignored': 13,
}


def _valor(p):
    c = p[0]
    t = c.tag
    if t == 'string':
        return c.text or ''
    if t == 'number':
        return int(c.text)
    if t == 'double':
        return float(c.text)
    if t == 'bool':
        return c.text == 'true'
    if t == 'enum' or t == 'set':
        return c.text or ''
    if t in ('size', 'rect'):
        return {x.tag: int(x.text) for x in c}
    if t == 'font':
        return {x.tag: (x.text or '') for x in c}
    if t == 'sizepolicy':
        return {'h': _POLITICAS.get(c.get('hsizetype'), 5), 'v': _POLITICAS.get(c.get('vsizetype'), 5)}
    return None


def _props(e):
    return {p.get('name'): _valor(p) for p in e.findall('property') if len(p)}


class Cargador:
    def __init__(self, ventana, ruta_ui, cabeceras, hints=None):
        self.hints = hints or {}
        self.v = ventana
        self.raiz = ET.fromstring(open(ruta_ui, encoding='utf-8').read())
        self.personalizados = {c.findtext('class'): c.findtext('header') for c in self.raiz.iter('customwidget')}
        self.acciones = {}
        self.cabeceras = cabeceras

    # -------- widgets --------
    def clase(self, nombre):
        if nombre in _CLASES:
            return _CLASES[nombre]
        hdr = self.personalizados.get(nombre)
        if hdr:
            return getattr(importlib.import_module(hdr), nombre)
        raise KeyError(nombre)

    def widget(self, e, padre, es_raiz=False):
        nombre = e.get('name')
        cn = e.get('class')
        props = _props(e)
        if es_raiz:
            w = self.v
        elif cn in ('QMenuBar', 'QStatusBar'):
            w = self.clase(cn)()
        else:
            w = self.clase(cn)(padre)
        w.setObjectName(nombre)
        setattr(self.v, nombre, w)
        if cn == 'QScrollArea':
            # sizeHint de cada área con scroll (Qt reparte el alto sobrante en proporción a estos valores)
            w._hint_h = self.hints.get(nombre, 335)
        self.aplicar(w, cn, props)
        f = props.get('font')
        if f and f.get('family'):
            # Qt: la fuente de un widget la heredan todos los de adentro
            w.el.style.fontFamily = f"'{f['family']}', 'Liberation Sans', Helvetica, sans-serif"
            if f.get('pointsize'):
                w.el.style.fontSize = f"{float(f['pointsize']) * 4 / 3:g}px"

        for h in e:
            if h.tag == 'widget':
                self.hijo(w, cn, h)
            elif h.tag == 'layout':
                w.setLayout(self.layout(h, w))
            elif h.tag == 'item' and isinstance(w, W.QComboBox):
                w.addItem(_props(h).get('text', ''))
            elif h.tag == 'action':
                self.accion(h)
            elif h.tag == 'addaction' and h.get('name') == 'separator':
                if cn == 'QMenu':
                    w.addSeparator()
            elif h.tag == 'addaction':
                a = self.acciones.get(h.get('name'))
                if a is not None and cn == 'QMenu':
                    w.addAction(a)
                elif h.get('name') in self.menus and cn == 'QMenuBar':
                    w.addMenu(self.menus[h.get('name')])
        if isinstance(w, W.QComboBox):
            if 'currentIndex' in props:
                w.setCurrentIndex(props['currentIndex'])
            elif 'currentText' in props:
                w.setCurrentText(props['currentText'])
        if cn == 'QDialogButtonBox' and 'standardButtons' in props:
            flags = 0
            if 'Ok' in props['standardButtons']:
                flags |= W.QDialogButtonBox.Ok
            if 'Cancel' in props['standardButtons']:
                flags |= W.QDialogButtonBox.Cancel
            w.setStandardButtons(flags)
        return w

    menus = {}

    def hijo(self, padre, cn_padre, h):
        cn = h.get('class')
        if cn_padre == 'QMainWindow':
            w = self.widget(h, padre)
            if cn == 'QMenuBar':
                padre.setMenuBar(w)
            elif cn == 'QStatusBar':
                padre.setStatusBar(w)
            elif cn == 'QMenu':
                self.menus[h.get('name')] = w
            else:
                padre.setCentralWidget(w)
            return
        w = self.widget(h, padre)
        if cn == 'QMenu':
            self.menus[h.get('name')] = w
        if cn_padre == 'QTabWidget':
            titulo = ''
            for a in h.findall('attribute'):
                if a.get('name') == 'title':
                    titulo = a[0].text or ''
            padre.addTab(w, titulo)
        elif cn_padre == 'QScrollArea':
            padre.setWidget(w)
        elif cn_padre == 'QMenuBar':
            pass

    def aplicar(self, w, cn, p):
        if 'text' in p and hasattr(w, 'setText'):
            w.setText(p['text'])
        if 'title' in p and cn in ('QGroupBox', 'QMenu'):
            w.setTitle(p['title'])
        if 'windowTitle' in p:
            w.setWindowTitle(p['windowTitle'])
        if 'enabled' in p:
            w.setEnabled(p['enabled'])
        if 'checked' in p and hasattr(w, 'setChecked'):
            w.setChecked(p['checked'])
        if 'wordWrap' in p and hasattr(w, 'setWordWrap'):
            w.setWordWrap(p['wordWrap'])
        if 'placeholderText' in p and hasattr(w, 'setPlaceholderText'):
            w.setPlaceholderText(p['placeholderText'])
        if 'readOnly' in p and hasattr(w, 'setReadOnly'):
            w.setReadOnly(p['readOnly'])
        if 'html' in p and hasattr(w, 'setHtml'):
            w.setHtml(p['html'])
        if cn in ('QDoubleSpinBox', 'ScienDSpinBox', 'QSpinBox'):
            if 'decimals' in p:
                w.setDecimals(p['decimals'])
            if 'minimum' in p:
                w.setMinimum(p['minimum'])
            if 'maximum' in p:
                w.setMaximum(p['maximum'])
            if 'singleStep' in p:
                w.setSingleStep(p['singleStep'])
            if 'suffix' in p:
                w.setSuffix(p['suffix'])
            if 'buttonSymbols' in p:
                w.setButtonSymbols(0 if 'NoButtons' in p['buttonSymbols'] else 1)
            if 'value' in p:
                w.setValue(p['value'])
        if 'sizePolicy' in p:
            w.setSizePolicy(p['sizePolicy']['h'], p['sizePolicy']['v'])
        if 'minimumSize' in p:
            w.setMinimumSize(p['minimumSize']['width'], p['minimumSize']['height'])
        if 'maximumSize' in p:
            w.setMaximumSize(p['maximumSize']['width'], p['maximumSize']['height'])
        if 'acceptDrops' in p and hasattr(w, 'setAcceptDrops'):
            w.setAcceptDrops(p['acceptDrops'])
        if cn == 'QScrollArea':
            w.el.classList.add('noframe') if 'NoFrame' in str(p.get('frameShape', '')) else None
        if cn == 'QListWidget':
            w.setAlternatingRowColors(bool(p.get('alternatingRowColors')))
            modo = str(p.get('selectionMode', ''))
            w.setSelectionMode({'SingleSelection': 1, 'MultiSelection': 2, 'ExtendedSelection': 3, 'ContiguousSelection': 3, 'NoSelection': 0}.get(modo.split('::')[-1], 1))
        if cn == 'Line':
            w.setVertical('Vertical' in str(p.get('orientation', '')))
        if 'toolTip' in p and hasattr(w, 'setToolTip'):
            w.setToolTip(p['toolTip'])
        if 'prefix' in p and hasattr(w, 'setPrefix'):
            w.setPrefix(p['prefix'])

    def accion(self, e):
        a = W.QAction(self.v)
        a.setObjectName(e.get('name'))
        p = _props(e)
        if 'text' in p:
            a.setText(p['text'])
        if p.get('checkable'):
            a.setCheckable(True)
        if p.get('checked'):
            a.setChecked(True)
        self.acciones[e.get('name')] = a
        setattr(self.v, e.get('name'), a)

    # -------- layouts --------
    def layout(self, e, duenio):
        L = _LAYOUTS[e.get('class')]()
        L.setObjectName(e.get('name'))
        setattr(self.v, e.get('name'), L)
        p = _props(e)
        m = [p.get('leftMargin'), p.get('topMargin'), p.get('rightMargin'), p.get('bottomMargin')]
        # Dentro de un grupo, Qt suma 2 px de marco a los márgenes de la capa.
        base = 9
        extra = 2 if isinstance(duenio, W.QGroupBox) else 0
        if any(x is not None for x in m):
            L.setContentsMargins(*[(base if x is None or x < 0 else x) + extra for x in m])
        for nombre, metodo in (('spacing', L.setSpacing), ('horizontalSpacing', L.setHorizontalSpacing), ('verticalSpacing', L.setVerticalSpacing)):
            if p.get(nombre) is not None and int(p[nombre]) >= 0:
                metodo(int(p[nombre]))
        for it in e.findall('item'):
            hijo = next((k for k in it if k.tag in ('widget', 'layout', 'spacer')), None)
            if hijo is None:
                continue
            pos = [int(it.get(k, d)) for k, d in (('row', 0), ('column', 0), ('rowspan', 1), ('colspan', 1))]
            if hijo.tag == 'widget':
                w = self.widget(hijo, duenio)
                if e.get('class') == 'QGridLayout':
                    L.addWidget(w, *pos)
                else:
                    L.addWidget(w)
            elif hijo.tag == 'layout':
                sub = self.layout(hijo, duenio)
                if e.get('class') == 'QGridLayout':
                    L.addLayout(sub, *pos)
                else:
                    L.addLayout(sub)
            else:
                pr = _props(hijo)
                vertical = 'Vertical' in str(pr.get('orientation', ''))
                sp = W.QSpacerItem(0, 0, W.QSizePolicy.Minimum if vertical else W.QSizePolicy.Expanding, W.QSizePolicy.Expanding if vertical else W.QSizePolicy.Minimum)
                if e.get('class') == 'QGridLayout':
                    L.addItem(sp, *pos)
                else:
                    L.addItem(sp)
        return L

    def cargar(self):
        top = self.raiz.find('widget')
        self.menus = {}
        for a in self.raiz.iter('action'):
            self.accion(a)
        self.widget(top, None, es_raiz=True)
        # Las acciones de menú se conectan por nombre (como connectSlotsByName).
        return self.v


def hacer_ui(ruta_ui, hints=None):
    """Devuelve una clase con setupUi(ventana), como las que genera pyuic5.
    `hints`: sizeHint (alto) de cada QScrollArea por nombre, calibrado contra el programa original."""

    class Ui:
        def setupUi(self, ventana):
            Cargador(ventana, ruta_ui, None, hints).cargar()

        def retranslateUi(self, ventana):
            pass

    return Ui
