# -*- coding: utf-8 -*-
"""单个 Markdown 文件转 .docx（本地回退方案，不依赖 Codex）。
用法: python tools/md2docx_one.py <输入.md> [输出.docx]
若省略输出，输出到同目录同名 .docx。
"""
import os, re, sys, zipfile, datetime, io

# 复用 tools/md2docx.py 的样式与转换函数
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import md2docx  # noqa: E402

if __name__ == "__main__":
    argv = sys.argv[1:]
    overwrite = "--overwrite" in argv
    args = [a for a in argv if a != "--overwrite"]
    if len(args) < 1:
        print("用法: python tools/md2docx_one.py <输入.md> [输出.docx] [--overwrite]")
        sys.exit(1)
    md_path = os.path.abspath(args[0])
    if not os.path.isfile(md_path):
        print("找不到输入:", md_path)
        sys.exit(1)
    out_path = os.path.abspath(args[1]) if len(args) > 1 else os.path.splitext(md_path)[0] + ".docx"

    # 硬保护：默认拒绝覆盖既有文件，--overwrite 显式放行
    if os.path.exists(out_path) and not overwrite:
        print("ERROR: 目标输出已存在，拒绝覆盖:", out_path)
        print("提示: 换一个输出路径重新调用；确需覆盖时显式传 --overwrite。")
        sys.exit(1)

    # 取 md 内第一个一级标题作为文档标题，否则用文件名
    title = os.path.splitext(os.path.basename(md_path))[0]
    try:
        with io.open(md_path, encoding="utf-8") as f:
            head = f.read(4096)
        m = re.search(r"^#\s+(.+)$", head, re.M)
        if m:
            title = m.group(1).strip()
    except Exception:
        pass

    body = md2docx.md_to_body(open(md_path, encoding="utf-8").read())

    title_para = md2docx.para(title, style="Title0")
    # 文档主体直接接标题，不插入总目/封面
    all_body = [title_para, md2docx.pagebreak(), body]

    doc = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
           '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
           '<w:body>' + "".join(all_body) + md2docx.SECTPR + '</w:body></w:document>')

    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", md2docx.CT)
        z.writestr("_rels/.rels", md2docx.RELS)
        z.writestr("word/document.xml", doc)
        z.writestr("word/styles.xml", md2docx.STYLES)
        z.writestr("word/_rels/document.xml.rels", md2docx.DOCRELS)
        z.writestr("docProps/core.xml", md2docx.CORE)

    print("OK", out_path, "bytes", os.path.getsize(out_path))
