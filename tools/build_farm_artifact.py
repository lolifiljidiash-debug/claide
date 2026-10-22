"""Готовит farm/index.html для публикации ссылкой (Artifact): убирает doctype/html/head/body,
их подставляет площадка. Использование: python3 tools/build_farm_artifact.py <выходной файл>"""
import re, sys
t = open('farm/index.html', encoding='utf-8').read()
t = t.replace('<!doctype html>\n<html lang="ru">\n<head>\n', '')
t = re.sub(r'<meta charset="utf-8">\n<meta name="viewport"[^>]*>\n', '', t)
t = t.replace('</head>\n<body>\n', '').replace('</body>\n</html>\n', '')
open(sys.argv[1], 'w', encoding='utf-8').write(t)
