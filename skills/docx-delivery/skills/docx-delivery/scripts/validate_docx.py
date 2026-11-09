# -*- coding: utf-8 -*-
"""DOCX 成品验证器（只读）。

用法: python validate_docx.py <成品.docx> [probe词文件.txt] [--min-paras N] [--min-tables N] [--min-imgs N]
probe 词文件：每行一个必须出现在正文中的词；空行与 # 开头行忽略。
退出码: 0=全部通过; 1=验证失败; 2=用法/文件错误。
"""
import os, re, sys, zipfile
import xml.etree.ElementTree as ET

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8")
    except Exception: pass


def fail(msg):
    print("FAIL:", msg)
    sys.exit(1)


def main():
    args = [a for a in sys.argv[1:]]
    opts = {"--min-paras": 0, "--min-tables": 0, "--min-imgs": 0}
    probes_file = None
    positional = []
    i = 0
    while i < len(args):
        a = args[i]
        if a in opts:
            if i + 1 >= len(args):
                fail("missing value for " + a)
            opts[a] = int(args[i + 1]); i += 2
        elif a.startswith("--"):
            fail("unknown option " + a)
        else:
            positional.append(a); i += 1

    if not positional:
        print(__doc__)
        sys.exit(2)
    path = os.path.abspath(positional[0])
    if len(positional) > 1:
        probes_file = os.path.abspath(positional[1])
    if not os.path.isfile(path):
        fail("file not found: " + path)

    # 1) zip 完整性
    try:
        z = zipfile.ZipFile(path)
    except Exception as e:
        fail("not a valid zip/docx: %s" % e)
    bad = z.testzip()
    if bad is not None:
        fail("corrupt member: " + str(bad))

    # 2) 所有 XML 可解析
    for n in z.namelist():
        if n.endswith(".xml") or n.endswith(".rels"):
            try:
                ET.fromstring(z.read(n))
            except Exception as e:
                fail("XML parse error in %s: %s" % (n, e))

    # 3) 结构统计
    doc = z.read("word/document.xml").decode("utf-8", "replace")
    text = "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", doc))
    paras = doc.count("<w:p>") + doc.count("<w:p ")
    tables = doc.count("<w:tbl>")
    imgs = len([n for n in z.namelist() if n.startswith("word/media/")])
    print("zip test: OK | XML parse: all ok | parts:", len(z.namelist()))
    print("text chars:", len(text), "| paragraphs:", paras, "| tables:", tables, "| images:", imgs)

    # 4) 最小结构门槛
    if paras < opts["--min-paras"]:
        fail("paragraphs %d < required %d" % (paras, opts["--min-paras"]))
    if tables < opts["--min-tables"]:
        fail("tables %d < required %d" % (tables, opts["--min-tables"]))
    if imgs < opts["--min-imgs"]:
        fail("images %d < required %d" % (imgs, opts["--min-imgs"]))

    # 5) probe 词检查
    if probes_file:
        if not os.path.isfile(probes_file):
            fail("probe file not found: " + probes_file)
        probes = []
        for ln in open(probes_file, encoding="utf-8", errors="replace"):
            ln = ln.strip()
            if ln and not ln.startswith("#"):
                probes.append(ln)
        miss = [p for p in probes if p not in text]
        print("probes:", len(probes), "| missing:", miss if miss else "NONE")
        if miss:
            fail("probe words missing: %s" % ", ".join(miss[:8]))

    print("PASS", os.path.basename(path), os.path.getsize(path), "bytes")
    sys.exit(0)


if __name__ == "__main__":
    main()
