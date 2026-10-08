"""Fabrique les versions « un seul fichier » du jeu, dans jeu/dist/ :
  - arene.html          : à envoyer à ses amis ; on l'ouvre d'un double-clic (passe par Supabase) ;
  - arene-artifact.html : la page publiée sur claude.ai (passe par le « room » de claude.ai).
Lancer : python3 jeu/construire.py  (à refaire après chaque changement du jeu)."""
import pathlib
import re

ICI = pathlib.Path(__file__).parent
DIST = ICI / "dist"


def lire(nom):
    return (ICI / nom).read_text(encoding="utf-8")


def script(nom):
    code = lire(nom)
    assert "</script" not in code, nom
    return f"<script>\n{code}\n</script>"


def main():
    page = lire("index.html")
    page = page.replace('<link rel="stylesheet" href="style.css">', f"<style>\n{lire('style.css')}\n</style>")
    for nom in ("sim.js", "net.js", "main.js"):
        page = page.replace(f'<script src="{nom}"></script>', script(nom))
    assert 'src="sim.js"' not in page and 'href="style.css"' not in page
    DIST.mkdir(exist_ok=True)
    (DIST / "arene.html").write_text(page, encoding="utf-8")

    # Pour claude.ai : la page est enveloppée à la publication, donc ni <html>, ni <head>, ni <body>,
    # et pas de Supabase (le « room » de claude.ai le remplace).
    tete = re.search(r"<head>(.*?)</head>", page, re.S).group(1)
    corps = re.search(r"<body>(.*?)</body>", page, re.S).group(1)
    tete = re.sub(r'<meta[^>]*>\s*', "", tete)
    tete = re.sub(r'<script src="https://cdn.jsdelivr.net/npm/@supabase[^"]*"></script>\s*', "", tete)
    (DIST / "arene-artifact.html").write_text(tete.strip() + "\n" + corps.strip() + "\n", encoding="utf-8")
    print("ok :", ", ".join(p.name for p in sorted(DIST.iterdir())))


if __name__ == "__main__":
    main()
