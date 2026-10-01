"""The group window: a QDialog with the web UI (web/), and a QWebChannel
bridge to api.MultiAPI. Background syncs push fresh data to the page."""

import json
import traceback

from aqt.qt import QColor, QDialog, QObject, Qt, QUrl, QVBoxLayout, pyqtSlot

try:
    from aqt.qt import QWebChannel, QWebEngineView
except ImportError:  # pragma: no cover
    from PyQt6.QtWebChannel import QWebChannel
    from PyQt6.QtWebEngineWidgets import QWebEngineView

from .page import build_page

class _Bridge(QObject):
    def __init__(self, api, parent):
        super().__init__(parent)
        self._api = api

    @pyqtSlot(str, str, result=str)
    def call(self, name, payload):
        try:
            result = self._api.call(name, json.loads(payload or "{}"))
        except Exception as exc:  # a bug must never freeze the window
            traceback.print_exc()
            result = {"ok": False, "error": f"Erreur interne : {exc}"}
        return json.dumps(result, ensure_ascii=False, default=str)


class GroupWindow(QDialog):
    def __init__(self, parent, api):
        super().__init__(parent)
        self.api = api
        self.setWindowTitle("👥 Anki Multijoueur")
        self.setMinimumSize(720, 560)
        self.resize(980, 760)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        self.web = QWebEngineView(self)
        self.web.setContextMenuPolicy(Qt.ContextMenuPolicy.NoContextMenu)
        self.web.page().setBackgroundColor(QColor("#101523"))
        self.channel = QWebChannel(self.web.page())
        self.bridge = _Bridge(api, self)
        self.channel.registerObject("py", self.bridge)
        self.web.page().setWebChannel(self.channel)
        layout.addWidget(self.web)
        self.web.setHtml(build_page(api.snapshot()), QUrl("https://anki-multijoueur.local/"))
        api.listeners.append(self.push)

    def push(self, snapshot):
        data = json.dumps(snapshot, ensure_ascii=False, default=str)
        self.web.page().runJavaScript(f"window.MJ && window.MJ.update({data});")

    def done(self, result):
        if self.push in self.api.listeners:
            self.api.listeners.remove(self.push)
        super().done(result)
