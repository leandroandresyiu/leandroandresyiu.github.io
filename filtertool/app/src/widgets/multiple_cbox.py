"""Desplegable con casillas (varias opciones tildables), versión para el navegador.
Mismo uso que el original: model().item(i).setEnabled / setCheckState, currentIndexes(), setCurrentIndexes()."""
from PyQt5 import QtWidgets


class CheckableComboBox(QtWidgets.QCheckableComboBox):
    def __init__(self, arg=None):
        super().__init__(arg if not isinstance(arg, bool) else None)

    def item_checked(self, index):
        return self.model().item(index, 0).checkState() == 2

    def get_checked_items(self):
        return [i for i in range(self.count()) if self.item_checked(i)]

    def currentIndexes(self):
        return self.get_checked_items()

    def setCurrentIndexes(self, indexes):
        for i in range(self.count()):
            self.model().item(i, 0).setCheckState(2 if i in indexes else 0)
