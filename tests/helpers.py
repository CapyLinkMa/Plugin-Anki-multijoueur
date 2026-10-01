"""Imports the add-on modules without Anki's GUI (the package __init__
needs aqt): each module is loaded under a stand-in package."""
import importlib.util
import os
import sys
import types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PKG = os.path.join(ROOT, "multijoueur")


def load():
    if "multijoueur" not in sys.modules:
        pkg = types.ModuleType("multijoueur")
        pkg.__path__ = [PKG]
        sys.modules["multijoueur"] = pkg
    mods = {}
    for name in ("server", "metrics", "group", "api", "page", "updater"):
        full = f"multijoueur.{name}"
        if full not in sys.modules:
            spec = importlib.util.spec_from_file_location(full, os.path.join(PKG, f"{name}.py"))
            mod = importlib.util.module_from_spec(spec)
            sys.modules[full] = mod
            spec.loader.exec_module(mod)
        mods[name] = sys.modules[full]
    return mods
