"""The window's single self-contained HTML page (CSS, JS and the first
snapshot inlined). Qt-free, so tools/dev_server.py serves the same page."""

import json
import os

WEB_DIR = os.path.join(os.path.dirname(__file__), "web")


def _read(name):
    with open(os.path.join(WEB_DIR, name), encoding="utf-8") as f:
        return f.read()


def build_page(snapshot):
    boot = json.dumps(snapshot, ensure_ascii=False, default=str).replace("</", "<\\/")
    return (_read("page.html").replace("/*__CSS__*/", _read("page.css"))
            .replace("/*__BOOT__*/null", boot).replace("/*__JS__*/", _read("page.js")))
