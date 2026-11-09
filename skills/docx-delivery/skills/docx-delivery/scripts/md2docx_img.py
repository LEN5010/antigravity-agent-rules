# -*- coding: utf-8 -*-
"""把带 [[IMG:path|caption]] 标记的 Markdown 渲染成 .docx（含插图）。"""
import os, re, sys
from pathlib import Path
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from PIL import Image

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8")
    except Exception: pass

argv = [a for a in sys.argv[1:] if a != "--overwrite"]
OVERWRITE = "--overwrite" in sys.argv[1:]
if len(argv) < 2:
    print("用法: python md2docx_img.py <输入.md> <输出.docx> [--overwrite]")
    sys.exit(1)
MD = os.path.abspath(argv[0])
OUT = os.path.abspath(argv[1])
if not os.path.isfile(MD):
    print("找不到输入:", MD)
    sys.exit(1)
# 硬保护：默认拒绝覆盖既有文件，--overwrite 显式放行
if os.path.exists(OUT) and not OVERWRITE:
    print("ERROR: 目标输出已存在，拒绝覆盖:", OUT)
    print("提示: 换一个输出路径重新调用；确需覆盖时显式传 --overwrite。")
    sys.exit(1)
BASE = Path(MD).parent
FONT = "微软雅黑"

doc = Document()
st = doc.styles["Normal"]
st.font.name = FONT
st.font.size = Pt(10.5)
st.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
for sec in doc.sections:
    sec.left_margin = sec.right_margin = Cm(2.2)
    sec.top_margin = sec.bottom_margin = Cm(2.0)

def setfont(run, size=None, bold=None, color=None):
    run.font.name = FONT
    run._element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
    if size: run.font.size = Pt(size)
    if bold is not None: run.font.bold = bold
    if color: run.font.color.rgb = color

INLINE = re.compile(r"(\*\*.+?\*\*|`[^`]+`)")
def add_runs(p, text):
    for part in INLINE.split(text):
        if not part: continue
        if part.startswith("**") and part.endswith("**"):
            setfont(p.add_run(part[2:-2]), bold=True)
        elif part.startswith("`") and part.endswith("`"):
            r = p.add_run(part[1:-1]); setfont(r, size=9.5); r.font.color.rgb = RGBColor(0xB0, 0x30, 0x30)
        else:
            setfont(p.add_run(part))

def img_width_cm(path):
    with Image.open(path) as im:
        w = im.size[0]
    if w >= 400: return 12.0
    if w >= 250: return 9.0
    return 7.0

lines = Path(MD).read_text(encoding="utf-8").split("\n")
i = 0
first_h1 = True
while i < len(lines):
    ln = lines[i].rstrip()
    if not ln.strip():
        i += 1; continue

    m = re.match(r"^\[\[IMG:([^|\]]+)\|([^\]]*)\]\]$", ln.strip())
    if m:
        rel, cap = m.group(1).strip(), m.group(2).strip()
        p = BASE / rel
        if p.exists():
            doc.add_picture(str(p), width=Cm(img_width_cm(p)))
            doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
            cp = doc.add_paragraph(); cp.alignment = WD_ALIGN_PARAGRAPH.CENTER
            setfont(cp.add_run(cap), size=9, color=RGBColor(0x44, 0x44, 0x44))
        else:
            p2 = doc.add_paragraph(); setfont(p2.add_run("[缺图] " + cap), size=9)
        i += 1; continue

    if ln.startswith("|"):
        rows = []
        while i < len(lines) and lines[i].strip().startswith("|"):
            cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
            if not all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c):
                rows.append(cells)
            i += 1
        if rows:
            ncol = max(len(r) for r in rows)
            t = doc.add_table(rows=0, cols=ncol)
            t.style = "Table Grid"
            t.alignment = WD_TABLE_ALIGNMENT.CENTER
            for ri, r in enumerate(rows):
                cells = t.add_row().cells
                for ci in range(ncol):
                    txt = r[ci] if ci < len(r) else ""
                    para = cells[ci].paragraphs[0]
                    if ri == 0:
                        setfont(para.add_run(txt), size=9, bold=True)
                    else:
                        setfont(para.add_run(txt), size=9)
            doc.add_paragraph()
        continue

    if ln.startswith("### "):
        p = doc.add_paragraph(); p.paragraph_format.space_before = Pt(8)
        setfont(p.add_run(ln[4:]), size=12.5, bold=True, color=RGBColor(0x1F, 0x3B, 0x63))
    elif ln.startswith("## "):
        p = doc.add_paragraph(); p.paragraph_format.space_before = Pt(14)
        setfont(p.add_run(ln[3:]), size=15, bold=True, color=RGBColor(0x10, 0x2A, 0x4C))
    elif ln.startswith("# "):
        p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        setfont(p.add_run(ln[2:]), size=20, bold=True, color=RGBColor(0x10, 0x2A, 0x4C))
        first_h1 = False
    elif ln.startswith("- "):
        p = doc.add_paragraph(style="List Bullet"); add_runs(p, ln[2:])
    elif re.match(r"^\d+\.\s", ln):
        p = doc.add_paragraph(style="List Number"); add_runs(p, re.sub(r"^\d+\.\s", "", ln))
    elif ln.startswith("> "):
        p = doc.add_paragraph(); p.paragraph_format.left_indent = Cm(0.6)
        add_runs(p, ln[2:])
        for r in p.runs: r.font.size = Pt(9.5); r.font.color.rgb = RGBColor(0x55, 0x55, 0x55)
    elif ln.startswith("---"):
        doc.add_paragraph()
    else:
        p = doc.add_paragraph(); add_runs(p, ln)
    i += 1

doc.save(OUT)
print("OK", OUT, os.path.getsize(OUT), "bytes")
