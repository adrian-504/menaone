"""A small, dependency-free PowerPoint (OOXML) writer for the MENA BIG proposal master.

It writes exactly what the master needs: one slide master with named layouts,
a theme (colours and Aptos fonts), slides built from rectangles, text boxes,
pictures and real tables, speaker notes (used for generator tags) and a notes
master. Coordinates are given in design pixels on a 1920 × 1080 canvas
(1 px = 9525 EMU), the grid the 2026 redesign was drawn on.
"""

from __future__ import annotations

import hashlib
import zipfile
from dataclasses import dataclass, field
from xml.sax.saxutils import escape

EMU = 9525
W, H = 1920, 1080


def emu(v: float) -> int:
    return int(round(v * EMU))


def esc(s: str) -> str:
    return escape(s, {'"': "&quot;"})


# ── Text ─────────────────────────────────────────────────────────────────────

@dataclass
class Run:
    text: str
    size: float = 18          # points
    color: str = "676A6C"
    bold: bool = False
    italic: bool = False
    spacing: int = 0          # character spacing, hundredths of a point
    font: str = "+mn-lt"      # +mn-lt (Aptos) or +mj-lt (Aptos Display)
    caps: bool = False
    underline: bool = False

    def xml(self) -> str:
        attrs = [f'lang="en-US"', f'sz="{int(self.size * 100)}"']
        if self.bold:
            attrs.append('b="1"')
        if self.italic:
            attrs.append('i="1"')
        if self.underline:
            attrs.append('u="sng"')
        if self.spacing:
            attrs.append(f'spc="{self.spacing}"')
        if self.caps:
            attrs.append('cap="all"')
        attrs.append('dirty="0"')
        font = f'<a:latin typeface="{self.font}"/><a:cs typeface="{self.font}"/>'
        return f'<a:r><a:rPr {" ".join(attrs)}><a:solidFill><a:srgbClr val="{self.color}"/></a:solidFill>{font}</a:rPr><a:t>{esc(self.text)}</a:t></a:r>'


@dataclass
class Para:
    runs: list
    align: str = "l"          # l | ctr | r
    space_before: float = 0   # points
    space_after: float = 0
    line: float = 1.0         # line spacing multiple
    bullet: str | None = None  # bullet character
    bullet_color: str = "F07058"
    indent: float = 0         # px hanging indent for bullets
    level_margin: float = 0   # px left margin

    def xml(self) -> str:
        ppr = [f'algn="{self.align}"']
        if self.bullet:
            ppr.append(f'marL="{emu(self.level_margin + self.indent)}" indent="{-emu(self.indent)}"')
        elif self.level_margin:
            ppr.append(f'marL="{emu(self.level_margin)}"')
        inner = f'<a:lnSpc><a:spcPct val="{int(self.line * 100000)}"/></a:lnSpc>'
        inner += f'<a:spcBef><a:spcPts val="{int(self.space_before * 100)}"/></a:spcBef><a:spcAft><a:spcPts val="{int(self.space_after * 100)}"/></a:spcAft>'
        if self.bullet:
            inner += f'<a:buClr><a:srgbClr val="{self.bullet_color}"/></a:buClr><a:buSzPct val="100000"/><a:buFont typeface="Arial"/><a:buChar char="{esc(self.bullet)}"/>'
        else:
            inner += "<a:buNone/>"
        size = self.runs[0].size if self.runs else 12
        return f'<a:p><a:pPr {" ".join(ppr)}>{inner}</a:pPr>{"".join(r.xml() for r in self.runs)}<a:endParaRPr lang="en-US" sz="{int(size * 100)}" dirty="0"/></a:p>'


# ── Slides ───────────────────────────────────────────────────────────────────

@dataclass
class Slide:
    layout: str
    notes: str = ""
    background: str | None = None
    shapes: list = field(default_factory=list)
    images: list = field(default_factory=list)   # (rId, media name)
    _next_id: int = 2

    def _id(self) -> int:
        self._next_id += 1
        return self._next_id

    def rect(self, x, y, w, h, fill=None, line=None, line_w=1, radius=0.0, alpha=None, gradient=None, name="Shape"):
        sid = self._id()
        adj = '<a:gd name="adj" fmla="val %d"/>' % int(radius) if radius else ""
        geom = f'<a:prstGeom prst="{"roundRect" if radius else "rect"}"><a:avLst>{adj}</a:avLst></a:prstGeom>'
        if gradient:
            *stops, angle = gradient
            if len(stops) == 2 and len(stops[0]) == 2:
                stops = [(0, stops[0][0], stops[0][1]), (100, stops[1][0], stops[1][1])]
            gs = "".join(f'<a:gs pos="{int(p * 1000)}"><a:srgbClr val="{c}"><a:alpha val="{int(a * 1000)}"/></a:srgbClr></a:gs>' for p, c, a in stops)
            fill_xml = f'<a:gradFill rotWithShape="1"><a:gsLst>{gs}</a:gsLst><a:lin ang="{int(angle * 60000)}" scaled="0"/></a:gradFill>'
        elif fill:
            alpha_xml = '<a:alpha val="%d"/>' % int(alpha * 1000) if alpha is not None else ""
            fill_xml = f'<a:solidFill><a:srgbClr val="{fill}">{alpha_xml}</a:srgbClr></a:solidFill>'
        else:
            fill_xml = "<a:noFill/>"
        line_xml = f'<a:ln w="{emu(line_w)}"><a:solidFill><a:srgbClr val="{line}"/></a:solidFill></a:ln>' if line else "<a:ln><a:noFill/></a:ln>"
        self.shapes.append(
            f'<p:sp><p:nvSpPr><p:cNvPr id="{sid}" name="{name} {sid}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>'
            f'<p:spPr><a:xfrm><a:off x="{emu(x)}" y="{emu(y)}"/><a:ext cx="{emu(w)}" cy="{emu(h)}"/></a:xfrm>{geom}{fill_xml}{line_xml}</p:spPr>'
            f'<p:txBody><a:bodyPr rtlCol="0" anchor="ctr"/><a:lstStyle/><a:p><a:endParaRPr lang="en-US" dirty="0"/></a:p></p:txBody></p:sp>'
        )

    def text(self, x, y, w, h, paras, anchor="t", inset=(0, 0, 0, 0), fill=None, name="Text", wrap=True, autofit=False, title=False):
        sid = self._id()
        l, t, r, b = inset
        fill_xml = f'<a:solidFill><a:srgbClr val="{fill}"/></a:solidFill>' if fill else "<a:noFill/>"
        ph = '<p:nvPr><p:ph type="title"/></p:nvPr>' if title else "<p:nvPr/>"
        fit = "<a:normAutofit/>" if autofit else "<a:noAutofit/>"
        body = "".join(p.xml() for p in paras)
        self.shapes.append(
            f'<p:sp><p:nvSpPr><p:cNvPr id="{sid}" name="{name} {sid}"/><p:cNvSpPr txBox="{0 if title else 1}"/>{ph}</p:nvSpPr>'
            f'<p:spPr><a:xfrm><a:off x="{emu(x)}" y="{emu(y)}"/><a:ext cx="{emu(w)}" cy="{emu(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>{fill_xml}<a:ln><a:noFill/></a:ln></p:spPr>'
            f'<p:txBody><a:bodyPr wrap="{"square" if wrap else "none"}" lIns="{emu(l)}" tIns="{emu(t)}" rIns="{emu(r)}" bIns="{emu(b)}" rtlCol="0" anchor="{anchor}">{fit}</a:bodyPr><a:lstStyle/>{body}</p:txBody></p:sp>'
        )

    def image(self, media: str, x, y, w, h, name="Picture", alpha=None):
        sid = self._id()
        rid = f"rIdImg{len(self.images) + 1}"
        self.images.append((rid, media))
        fade = '<a:alphaModFix amt="%d"/>' % int(alpha * 1000) if alpha is not None else ""
        self.shapes.append(
            f'<p:pic><p:nvPicPr><p:cNvPr id="{sid}" name="{name} {sid}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>'
            f'<p:blipFill><a:blip r:embed="{rid}">{fade}</a:blip><a:stretch><a:fillRect/></a:stretch></p:blipFill>'
            f'<p:spPr><a:xfrm><a:off x="{emu(x)}" y="{emu(y)}"/><a:ext cx="{emu(w)}" cy="{emu(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>'
        )

    def raw_picture(self, xml_with_rid: str, media: str):
        """A picture copied from another deck; its r:embed is rewritten."""
        rid = f"rIdImg{len(self.images) + 1}"
        self.images.append((rid, media))
        import re
        self.shapes.append(re.sub(r'r:embed="[^"]+"', f'r:embed="{rid}"', xml_with_rid, count=1))

    def raw_group(self, xml: str, media_by_rid: dict, box=None):
        """A group copied from another deck; every r:embed is rewritten to this slide's images."""
        import re
        mapping = {}
        for old_rid, media in media_by_rid.items():
            rid = f"rIdImg{len(self.images) + 1}"
            self.images.append((rid, media))
            mapping[old_rid] = rid
        xml = re.sub(r'r:embed="([^"]+)"', lambda m: f'r:embed="{mapping.get(m.group(1), m.group(1))}"', xml)
        # Drop extension ids that could clash, and renumber shape ids.
        # Keep picture extensions (SVG versions of logos); drop only the creation ids.
        xml = re.sub(r'<a:extLst><a:ext uri="\{FF2B5EF4-FFF2-40B4-BE49-F238E27FC236\}">.*?</a:ext></a:extLst>', "", xml, flags=re.S)
        if box:
            bx, by, bw, bh = box
            m = re.search(r'<p:grpSpPr><a:xfrm><a:off x="(\d+)" y="(\d+)"/><a:ext cx="(\d+)" cy="(\d+)"/>', xml)
            if m:
                cx, cy = int(m.group(3)), int(m.group(4))
                scale = min(emu(bw) / cx, emu(bh) / cy)
                nw, nh = int(cx * scale), int(cy * scale)
                nx = emu(bx) + (emu(bw) - nw) // 2
                xml = xml[:m.start()] + f'<p:grpSpPr><a:xfrm><a:off x="{nx}" y="{emu(by)}"/><a:ext cx="{nw}" cy="{nh}"/>' + xml[m.end():]
        counter = iter(range(500, 5000))
        xml = re.sub(r'<p:cNvPr id="\d+"', lambda m: f'<p:cNvPr id="{next(counter)}"', xml)
        self.shapes.append(xml)

    def table(self, x, y, col_widths, rows, name="Table"):
        """rows: list of dicts {cells: [Cell], height: px}."""
        sid = self._id()
        grid = "".join(f'<a:gridCol w="{emu(c)}"/>' for c in col_widths)
        body = ""
        total = 0
        for row in rows:
            total += row["height"]
            body += f'<a:tr h="{emu(row["height"])}">' + "".join(c.xml() for c in row["cells"]) + "</a:tr>"
        self.shapes.append(
            f'<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="{sid}" name="{name} {sid}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>'
            f'<p:xfrm><a:off x="{emu(x)}" y="{emu(y)}"/><a:ext cx="{emu(sum(col_widths))}" cy="{emu(total)}"/></p:xfrm>'
            f'<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="0"/><a:tblGrid>{grid}</a:tblGrid>{body}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>'
        )
        return total

    def xml(self, layout_rid: str = "rId1") -> str:
        bg = f'<p:bg><p:bgPr><a:solidFill><a:srgbClr val="{self.background}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>' if self.background else ""
        return (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
            f'<p:cSld>{bg}<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'
            f'{"".join(self.shapes)}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>'
        )


@dataclass
class Cell:
    paras: list
    fill: str | None = None
    border_bottom: str | None = "E1E3E5"
    border_top: str | None = None
    anchor: str = "ctr"
    margin: tuple = (18, 8, 18, 8)
    row_span: int = 1
    v_merge: bool = False

    def xml(self) -> str:
        l, t, r, b = self.margin
        def ln(tag, color, width=1):
            if color:
                return f'<a:{tag} w="{emu(width)}"><a:solidFill><a:srgbClr val="{color}"/></a:solidFill></a:{tag}>'
            return f'<a:{tag} w="0"><a:noFill/></a:{tag}>'
        props = ln("lnL", None) + ln("lnR", None) + ln("lnT", self.border_top) + ln("lnB", self.border_bottom)
        props += f'<a:solidFill><a:srgbClr val="{self.fill}"/></a:solidFill>' if self.fill else "<a:noFill/>"
        span = f' rowSpan="{self.row_span}"' if self.row_span > 1 else (' vMerge="1"' if self.v_merge else "")
        return (f'<a:tc{span}><a:txBody><a:bodyPr/><a:lstStyle/>{"".join(p.xml() for p in self.paras)}</a:txBody>'
                f'<a:tcPr marL="{emu(l)}" marR="{emu(r)}" marT="{emu(t)}" marB="{emu(b)}" anchor="{self.anchor}">{props}</a:tcPr></a:tc>')


# ── Package ──────────────────────────────────────────────────────────────────

NS = ('xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
      'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"')
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
HDR = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'


def theme_xml(name: str, colors: dict) -> str:
    c = colors
    def clr(tag, val):
        return f'<a:{tag}><a:srgbClr val="{val}"/></a:{tag}>'
    fonts = ('<a:fontScheme name="Aptos"><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>'
             '<a:minorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>')
    fmt = ('<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>'
           '<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>'
           '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>'
           '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>')
    scheme = (f'<a:clrScheme name="MENA BIG">{clr("dk1", c["dk1"])}{clr("lt1", c["lt1"])}{clr("dk2", c["dk2"])}{clr("lt2", c["lt2"])}'
              f'{clr("accent1", c["accent1"])}{clr("accent2", c["accent2"])}{clr("accent3", c["accent3"])}{clr("accent4", c["accent4"])}{clr("accent5", c["accent5"])}{clr("accent6", c["accent6"])}'
              f'{clr("hlink", c["accent1"])}{clr("folHlink", c["accent3"])}</a:clrScheme>')
    return f'{HDR}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="{name}"><a:themeElements>{scheme}{fonts}{fmt}</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>'


def master_xml(layout_count: int) -> str:
    ids = "".join(f'<p:sldLayoutId id="{2147483649 + i}" r:id="rId{i + 1}"/>' for i in range(layout_count))
    text_style = ('<p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="4200" b="1"><a:solidFill><a:srgbClr val="014B8C"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle>'
                  '<p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:srgbClr val="676A6C"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:bodyStyle>'
                  '<p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles>')
    return (f'{HDR}<p:sldMaster {NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>'
            '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>'
            f'<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="{emu(104)}" y="{emu(118)}"/><a:ext cx="{emu(1712)}" cy="{emu(70)}"/></a:xfrm></p:spPr><p:txBody><a:bodyPr lIns="0" tIns="0" rIns="0" bIns="0" anchor="t"/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Title</a:t></a:r></a:p></p:txBody></p:sp>'
            '</p:spTree></p:cSld>'
            '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
            f'<p:sldLayoutIdLst>{ids}</p:sldLayoutIdLst>{text_style}</p:sldMaster>')


def layout_xml(name: str, slide: Slide) -> str:
    bg = f'<p:bg><p:bgPr><a:solidFill><a:srgbClr val="{slide.background}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>' if slide.background else ""
    return (f'{HDR}<p:sldLayout {NS} preserve="1" userDrawn="1"><p:cSld name="{esc(name)}">{bg}<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>'
            f'{"".join(slide.shapes)}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>')


def notes_master_xml() -> str:
    return (f'{HDR}<p:notesMaster {NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>'
            '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="381000" y="685800"/><a:ext cx="6096000" cy="3429000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:sp>'
            '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="4343400"/><a:ext cx="5486400" cy="4114800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>'
            '</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
            '<p:notesStyle><a:lvl1pPr marL="0" algn="l"><a:defRPr sz="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:notesStyle></p:notesMaster>')


def notes_xml(text: str) -> str:
    paras = "".join(f'<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>{esc(line)}</a:t></a:r></a:p>' for line in text.split("\n")) or '<a:p><a:endParaRPr lang="en-US"/></a:p>'
    return (f'{HDR}<p:notes {NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>'
            '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>'
            f'<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>{paras}</p:txBody></p:sp>'
            '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>')


def write(path: str, layouts: list, slides: list, media: dict, colors: dict, title: str):
    """layouts: [(name, Slide)]; slides: [Slide] whose .layout names a layout; media: name -> bytes."""
    z = zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED)
    types = [('<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'),
             '<Default Extension="xml" ContentType="application/xml"/>',
             '<Default Extension="png" ContentType="image/png"/>',
             '<Default Extension="jpeg" ContentType="image/jpeg"/>',
             '<Default Extension="jpg" ContentType="image/jpeg"/>',
             '<Default Extension="gif" ContentType="image/gif"/>',
             '<Default Extension="svg" ContentType="image/svg+xml"/>',
             '<Default Extension="emf" ContentType="image/x-emf"/>',
             '<Default Extension="wmf" ContentType="image/x-wmf"/>',
             '<Default Extension="tif" ContentType="image/tiff"/>',
             '<Default Extension="tiff" ContentType="image/tiff"/>',
             '<Default Extension="bmp" ContentType="image/bmp"/>',
             '<Default Extension="wdp" ContentType="image/vnd.ms-photo"/>']
    over = lambda part, ct: types.append(f'<Override PartName="/{part}" ContentType="application/vnd.openxmlformats-officedocument.{ct}"/>')
    over("ppt/presentation.xml", "presentationml.presentation.main+xml")
    over("ppt/slideMasters/slideMaster1.xml", "presentationml.slideMaster+xml")
    over("ppt/theme/theme1.xml", "theme+xml")
    over("ppt/theme/theme2.xml", "theme+xml")
    over("ppt/notesMasters/notesMaster1.xml", "presentationml.notesMaster+xml")
    over("ppt/presProps.xml", "presentationml.presProps+xml")
    over("ppt/viewProps.xml", "presentationml.viewProps+xml")
    over("ppt/tableStyles.xml", "presentationml.tableStyles+xml")
    over("docProps/app.xml", "extended-properties+xml")
    types.append('<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>')

    z.writestr("_rels/.rels", f'{HDR}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{REL}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="{REL}/extended-properties" Target="docProps/app.xml"/></Relationships>')
    z.writestr("docProps/core.xml", f'{HDR}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>{esc(title)}</dc:title><dc:creator>MENA BIG</dc:creator></cp:coreProperties>')
    z.writestr("docProps/app.xml", f'{HDR}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Office PowerPoint</Application><Slides>{len(slides)}</Slides></Properties>')
    z.writestr("ppt/presProps.xml", f'{HDR}<p:presentationPr {NS}/>')
    z.writestr("ppt/viewProps.xml", f'{HDR}<p:viewPr {NS}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>')
    z.writestr("ppt/tableStyles.xml", f'{HDR}<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}}"/>')
    z.writestr("ppt/theme/theme1.xml", theme_xml("MENA BIG 2026", colors))
    z.writestr("ppt/theme/theme2.xml", theme_xml("MENA BIG Notes", colors))
    z.writestr("ppt/slideMasters/slideMaster1.xml", master_xml(len(layouts)))
    mrels = "".join(f'<Relationship Id="rId{i + 1}" Type="{REL}/slideLayout" Target="../slideLayouts/slideLayout{i + 1}.xml"/>' for i in range(len(layouts)))
    mrels += f'<Relationship Id="rId{len(layouts) + 1}" Type="{REL}/theme" Target="../theme/theme1.xml"/>'
    z.writestr("ppt/slideMasters/_rels/slideMaster1.xml.rels", f'{HDR}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{mrels}</Relationships>')
    z.writestr("ppt/notesMasters/notesMaster1.xml", notes_master_xml())
    z.writestr("ppt/notesMasters/_rels/notesMaster1.xml.rels", f'{HDR}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{REL}/theme" Target="../theme/theme2.xml"/></Relationships>')

    media_names = {}
    def media_part(name):
        data = media[name]
        if name not in media_names:
            ext = name.rsplit(".", 1)[-1].lower()
            media_names[name] = f"ppt/media/m{hashlib.sha1(data).hexdigest()[:12]}.{ext}"
            if media_names[name] not in z.namelist():
                z.writestr(media_names[name], data)
        return media_names[name]

    layout_index = {}
    for i, (name, lay) in enumerate(layouts):
        n = i + 1
        layout_index[name] = n
        over(f"ppt/slideLayouts/slideLayout{n}.xml", "presentationml.slideLayout+xml")
        z.writestr(f"ppt/slideLayouts/slideLayout{n}.xml", layout_xml(name, lay))
        rels = f'<Relationship Id="rIdMaster" Type="{REL}/slideMaster" Target="../slideMasters/slideMaster1.xml"/>'
        rels += "".join(f'<Relationship Id="{rid}" Type="{REL}/image" Target="../media/{media_part(m).split("/")[-1]}"/>' for rid, m in lay.images)
        z.writestr(f"ppt/slideLayouts/_rels/slideLayout{n}.xml.rels", f'{HDR}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{rels}</Relationships>')

    sld_ids = ""
    prels = f'<Relationship Id="rId1" Type="{REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/>'
    prels += f'<Relationship Id="rId2" Type="{REL}/notesMaster" Target="notesMasters/notesMaster1.xml"/>'
    prels += f'<Relationship Id="rId3" Type="{REL}/presProps" Target="presProps.xml"/><Relationship Id="rId4" Type="{REL}/viewProps" Target="viewProps.xml"/>'
    prels += f'<Relationship Id="rId5" Type="{REL}/theme" Target="theme/theme1.xml"/><Relationship Id="rId6" Type="{REL}/tableStyles" Target="tableStyles.xml"/>'
    for i, s in enumerate(slides):
        n = i + 1
        over(f"ppt/slides/slide{n}.xml", "presentationml.slide+xml")
        over(f"ppt/notesSlides/notesSlide{n}.xml", "presentationml.notesSlide+xml")
        z.writestr(f"ppt/slides/slide{n}.xml", s.xml())
        rels = f'<Relationship Id="rId1" Type="{REL}/slideLayout" Target="../slideLayouts/slideLayout{layout_index[s.layout]}.xml"/>'
        rels += f'<Relationship Id="rIdNotes" Type="{REL}/notesSlide" Target="../notesSlides/notesSlide{n}.xml"/>'
        rels += "".join(f'<Relationship Id="{rid}" Type="{REL}/image" Target="../media/{media_part(m).split("/")[-1]}"/>' for rid, m in s.images)
        z.writestr(f"ppt/slides/_rels/slide{n}.xml.rels", f'{HDR}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{rels}</Relationships>')
        z.writestr(f"ppt/notesSlides/notesSlide{n}.xml", notes_xml(s.notes))
        z.writestr(f"ppt/notesSlides/_rels/notesSlide{n}.xml.rels", f'{HDR}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{REL}/notesMaster" Target="../notesMasters/notesMaster1.xml"/><Relationship Id="rId2" Type="{REL}/slide" Target="../slides/slide{n}.xml"/></Relationships>')
        sld_ids += f'<p:sldId id="{256 + i}" r:id="rId{100 + n}"/>'
        prels += f'<Relationship Id="rId{100 + n}" Type="{REL}/slide" Target="slides/slide{n}.xml"/>'
    pres = (f'{HDR}<p:presentation {NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>'
            f'<p:notesMasterIdLst><p:notesMasterId r:id="rId2"/></p:notesMasterIdLst><p:sldIdLst>{sld_ids}</p:sldIdLst>'
            f'<p:sldSz cx="{emu(W)}" cy="{emu(H)}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:lvl1pPr><a:defRPr lang="en-US"><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:defaultTextStyle></p:presentation>')
    z.writestr("ppt/presentation.xml", pres)
    z.writestr("ppt/_rels/presentation.xml.rels", f'{HDR}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{prels}</Relationships>')
    z.writestr("[Content_Types].xml", f'{HDR}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">{"".join(types)}</Types>')
    z.close()
