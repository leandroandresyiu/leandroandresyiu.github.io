"""Interfaz armada a partir de designer/tf_window.ui (en el original la generaba pyuic5)."""
import os

from PyQt5._loader import hacer_ui

Ui_tf_window = hacer_ui(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'designer', 'tf_window.ui'))
