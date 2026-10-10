"""Interfaz armada a partir de designer/response_window.ui (en el original la generaba pyuic5)."""
import os

from PyQt5._loader import hacer_ui

Ui_ResponseDialog = hacer_ui(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'designer', 'response_window.ui'))
