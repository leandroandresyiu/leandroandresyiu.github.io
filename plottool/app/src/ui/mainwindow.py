"""Interfaz armada a partir de designer/mainwindow.ui (en el original la generaba pyuic5)."""
import os

from PyQt5._loader import hacer_ui

Ui_MainWindow = hacer_ui(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'designer', 'mainwindow.ui'), hints={'scrollArea': 335, 'scrollArea_2': 372})
