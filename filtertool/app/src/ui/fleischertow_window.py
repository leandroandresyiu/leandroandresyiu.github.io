"""Interfaz armada a partir de designer/fleischertow_window.ui (en el original la generaba pyuic5)."""
import os

from PyQt5._loader import hacer_ui

Ui_fleischertow_dialog = hacer_ui(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'designer', 'fleischertow_window.ui'))
