"""Parte de QtGui que usa PlotTool."""


class QIcon:
    def __init__(self, *a, **k):
        pass


class QColor:
    def __init__(self, nombre='#000000'):
        self._n = nombre

    def name(self):
        return self._n


class QFont:
    def __init__(self, *a, **k):
        pass


class QStandardItemModel:
    def __init__(self, *a, **k):
        pass
