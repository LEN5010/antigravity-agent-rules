# -*- coding: utf-8 -*-
import os, re, sys, zipfile, datetime
for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8")
    except Exception: pass

FENCE = chr(96)*3
TICK = chr(96)

def esc(t):
    return (t.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;"))

def runs(text, base_bold=False, mono=False):
    """把内联 **粗体** 与 反引号代码 转成 w:r 序列"""
    out = []
    parts = re.split(r"(\*\*[^*]+\*\*|" + TICK + r"[^" + TICK + r"]+" + TICK + r")", text)
    for p in parts:
        if not p: continue
        bold = base_bold
        mn = mono
        s = p
        if p.startswith("**") and p.endswith("**") and len(p) > 4:
            bold = True; s = p[2:-2]
        elif p.startswith(TICK) and p.endswith(TICK) and len(p) > 2:
            mn = True; s = p[1:-1]
        rpr = "<w:rPr>"
        if bold: rpr += "<w:b/>"
        if mn: rpr += '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="SimSun"/>'
        rpr += "</w:rPr>"
        out.append('<w:r>' + rpr + '<w:t xml:space="preserve">' + esc(s) + '</w:t></w:r>')
    return "".join(out) if out else '<w:r><w:t xml:space="preserve"></w:t></w:r>'

def para(text, style=None, bold=False, ind=0):
    ppr = "<w:pPr>"
    if style: ppr += '<w:pStyle w:val="%s"/>' % style
    if ind: ppr += '<w:ind w:left="%d"/>' % ind
    ppr += "</w:pPr>"
    return "<w:p>" + ppr + runs(text, base_bold=bold) + "</w:p>"

def code_para(text):
    ppr = ('<w:pPr><w:pStyle w:val="CodeBlk"/></w:pPr>')
    r = ('<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="SimSun"/>'
         '<w:sz w:val="15"/><w:szCs w:val="15"/></w:rPr>'
         '<w:t xml:space="preserve">' + esc(text) + '</w:t></w:r>')
    return "<w:p>" + ppr + r + "</w:p>"

def pagebreak():
    return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'

def table(rows):
    n = max(len(r) for r in rows)
    total = 9300
    w = int(total / n)
    xml = ['<w:tbl><w:tblPr><w:tblStyle w:val="TblGrid"/><w:tblW w:w="%d" w:type="dxa"/>' % total,
           '<w:tblBorders>']
    for side in ("top","left","bottom","right","insideH","insideV"):
        xml.append('<w:%s w:val="single" w:sz="4" w:space="0" w:color="808080"/>' % side)
    xml.append('</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>')
    for i in range(n): xml.append('<w:gridCol w:w="%d"/>' % w)
    xml.append('</w:tblGrid>')
    for ri, row in enumerate(rows):
        xml.append('<w:tr>')
        for ci in range(n):
            cell = row[ci] if ci < len(row) else ""
            shd = '<w:shd w:val="clear" w:color="auto" w:fill="EAEFF5"/>' if ri == 0 else ''
            xml.append('<w:tc><w:tcPr><w:tcW w:w="%d" w:type="dxa"/>%s</w:tcPr>' % (w, shd))
            xml.append('<w:p><w:pPr><w:pStyle w:val="TblCell"/></w:pPr>' + runs(cell, base_bold=(ri==0)) + '</w:p>')
            xml.append('</w:tc>')
        xml.append('</w:tr>')
    xml.append('</w:tbl><w:p><w:pPr><w:pStyle w:val="Tiny"/></w:pPr></w:p>')
    return "".join(xml)

def md_to_body(md):
    body = []
    lines = md.split("\n")
    i = 0
    in_code = False
    while i < len(lines):
        ln = lines[i].rstrip("\r")
        if ln.strip().startswith(FENCE):
            in_code = not in_code
            i += 1
            continue
        if in_code:
            body.append(code_para(ln))
            i += 1
            continue
        s = ln.strip()
        if not s:
            i += 1; continue
        m = re.match(r"^(#{1,6})\s+(.*)$", s)
        if m:
            lvl = min(len(m.group(1)), 3)
            body.append(para(m.group(2), style="Heading%d" % lvl))
            i += 1; continue
        if s.startswith("|") and s.endswith("|"):
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                if not re.match(r"^:?-{2,}:?$", cells[0].replace(" ","")) :
                    rows.append(cells)
                i += 1
            if rows: body.append(table(rows))
            continue
        if re.match(r"^-{3,}$", s):
            body.append('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="BFBFBF"/></w:pBdr></w:pPr></w:p>')
            i += 1; continue
        if s.startswith(">"):
            body.append(para(s.lstrip("> ").strip(), style="Quote"))
            i += 1; continue
        m = re.match(r"^[-*]\s+(.*)$", s)
        if m:
            body.append(para("• " + m.group(1), ind=360))
            i += 1; continue
        m = re.match(r"^(\d+)[.、]\s+(.*)$", s)
        if m:
            body.append(para(m.group(1) + ". " + m.group(2), ind=360))
            i += 1; continue
        body.append(para(s))
        i += 1
    return "".join(body)

STYLES = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>
<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="SimSun"/><w:sz w:val="21"/><w:szCs w:val="21"/>
</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="60" w:line="288" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title0"><w:name w:val="Title0"/><w:pPr><w:jc w:val="center"/><w:spacing w:before="240" w:after="180"/></w:pPr>
<w:rPr><w:rFonts w:eastAsia="SimHei" w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:sz w:val="52"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Sub0"><w:name w:val="Sub0"/><w:pPr><w:jc w:val="center"/><w:spacing w:after="120"/></w:pPr>
<w:rPr><w:sz w:val="24"/><w:color w:val="555555"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/><w:spacing w:before="320" w:after="140"/>
<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="2" w:color="2E5A88"/></w:pBdr></w:pPr>
<w:rPr><w:rFonts w:eastAsia="SimHei"/><w:b/><w:sz w:val="34"/><w:color w:val="1F3F66"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/><w:spacing w:before="240" w:after="100"/></w:pPr>
<w:rPr><w:rFonts w:eastAsia="SimHei"/><w:b/><w:sz w:val="27"/><w:color w:val="2E5A88"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:pPr><w:outlineLvl w:val="2"/><w:spacing w:before="180" w:after="80"/></w:pPr>
<w:rPr><w:rFonts w:eastAsia="SimHei"/><w:b/><w:sz w:val="23"/><w:color w:val="3C6E9F"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:pPr><w:ind w:left="360"/><w:spacing w:before="60" w:after="60"/>
<w:pBdr><w:left w:val="single" w:sz="18" w:space="6" w:color="9BB7D4"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="F4F7FB"/></w:pPr>
<w:rPr><w:color w:val="333333"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="CodeBlk"><w:name w:val="CodeBlk"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/>
<w:shd w:val="clear" w:color="auto" w:fill="F6F6F6"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="SimSun"/><w:sz w:val="15"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TblCell"><w:name w:val="TblCell"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="19"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Tiny"><w:name w:val="Tiny"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:sz w:val="10"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TblGrid"><w:name w:val="Table Grid"/></w:style>
</w:styles>'''

CT = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>'''

RELS = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>'''

DOCRELS = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>'''

CORE = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title></dc:title><dc:creator></dc:creator>
<cp:lastModifiedBy>docx-delivery</cp:lastModifiedBy></cp:coreProperties>'''

SECTPR = ('<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
          '<w:pgMar w:top="1134" w:right="1021" w:bottom="1134" w:left="1021" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>')

def build(files, out, title, subtitle):
    body = []
    body.append('<w:p><w:pPr><w:spacing w:before="2200"/></w:pPr></w:p>')
    body.append(para(title, style="Title0"))
    for s in subtitle:
        body.append(para(s, style="Sub0"))
    body.append(pagebreak())
    # 总目
    body.append(para("总目", style="Heading1"))
    rows = [["篇", "文件", "内容"]]
    for idx, (p, name, desc) in enumerate(files, 1):
        rows.append([str(idx), name, desc])
    body.append(table(rows))
    body.append(pagebreak())
    for idx, (p, name, desc) in enumerate(files, 1):
        md = open(p, encoding="utf-8").read()
        body.append(md_to_body(md))
        if idx < len(files):
            body.append(pagebreak())
    doc = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
           '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
           '<w:body>' + "".join(body) + SECTPR + '</w:body></w:document>')
    z = zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED)
    z.writestr("[Content_Types].xml", CT)
    z.writestr("_rels/.rels", RELS)
    z.writestr("word/document.xml", doc)
    z.writestr("word/styles.xml", STYLES)
    z.writestr("word/_rels/document.xml.rels", DOCRELS)
    z.writestr("docProps/core.xml", CORE)
    z.close()
    return len(doc)

# (通用库：无演示入口；单文件转换见 md2docx_one.py)