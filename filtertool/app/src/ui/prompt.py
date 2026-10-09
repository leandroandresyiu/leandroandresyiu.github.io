"""Interfaz armada a partir de designer/prompt.ui (en el original la generaba pyuic5)."""
import os

from PyQt5._loader import hacer_ui

Ui_PromptDialog = hacer_ui(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'designer', 'prompt.ui'))
