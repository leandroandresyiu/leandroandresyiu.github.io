"""Interfaz armada a partir de designer/case_window.ui (en el original la generaba pyuic5)."""
import os

from PyQt5._loader import hacer_ui

Ui_case_dialog = hacer_ui(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'designer', 'case_window.ui'))
