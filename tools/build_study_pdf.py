#!/usr/bin/env python3
"""Build the printable companion to the seven-day Part 107 study guide.

Run from anywhere with the bundled Python runtime (reportlab and pypdf).
Content remains in data/study.json; this file owns presentation only.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import unicodedata
from collections import OrderedDict
from pathlib import Path

import reportlab
from reportlab import rl_config
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    CondPageBreak,
    Flowable,
    Frame,
    Image,
    KeepTogether,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
PAGE_W, PAGE_H = letter
MARGIN_X = 48
TOP_MARGIN = 47
BOTTOM_MARGIN = 45
WIDTH = PAGE_W - 2 * MARGIN_X
HEIGHT = PAGE_H - TOP_MARGIN - BOTTOM_MARGIN
INK = colors.HexColor("#182638")
MUTED = colors.HexColor("#516171")
BLUE = colors.HexColor("#2457B8")
PALE = colors.HexColor("#EEF4FD")
GRID = colors.HexColor("#D7DFE8")
FAINT = colors.HexColor("#F5F7FA")


def norm(value) -> str:
    """Keep the PDF's glyph repertoire predictable and punctuation printable."""
    if value is None:
        return ""
    value = str(value)
    replacements = {
        "\u2010": "-", "\u2011": "-", "\u2012": "-", "\u2013": "-",
        "\u2014": " - ", "\u2212": "-", "\u2018": "'", "\u2019": "'",
        "\u201c": '"', "\u201d": '"', "\u00a0": " ", "\u202f": " ",
        "\u2264": "<=", "\u2265": ">=", "\u2192": " -> ",
        "\u00d7": " x ", "\u2022": "-", "\u2713": "correct",
    }
    for original, replacement in replacements.items():
        value = value.replace(original, replacement)
    return unicodedata.normalize("NFC", value)


def esc(value) -> str:
    return html.escape(norm(value), quote=False).replace("\n", "<br/>")


def register_fonts():
    font_dir = Path(reportlab.__file__).resolve().parent / "fonts"
    fonts = {
        "Guide": "Vera.ttf",
        "Guide-Bold": "VeraBd.ttf",
        "Guide-Italic": "VeraIt.ttf",
        "Guide-BoldItalic": "VeraBI.ttf",
    }
    for name, filename in fonts.items():
        pdfmetrics.registerFont(TTFont(name, str(font_dir / filename)))
    pdfmetrics.registerFontFamily(
        "Guide", normal="Guide", bold="Guide-Bold", italic="Guide-Italic",
        boldItalic="Guide-BoldItalic",
    )


def make_styles(body_size=10.0):
    styles = getSampleStyleSheet()
    definitions = {
        "body": dict(fontName="Guide", fontSize=body_size,
                     leading=body_size * 1.375, textColor=INK,
                     spaceAfter=5.2, allowWidows=0, allowOrphans=0),
        "small": dict(fontName="Guide", fontSize=8.4, leading=11.7,
                      textColor=MUTED, spaceAfter=3.5, allowWidows=0,
                      allowOrphans=0),
        "source": dict(fontName="Guide", fontSize=7.6, leading=10.3,
                       textColor=MUTED, spaceBefore=1, spaceAfter=5),
        "eyebrow": dict(fontName="Guide-Bold", fontSize=9, leading=12,
                        textColor=BLUE, spaceAfter=7, keepWithNext=True),
        "title": dict(fontName="Guide-Bold", fontSize=33, leading=38,
                      textColor=INK, spaceAfter=17, keepWithNext=True),
        "h1": dict(fontName="Guide-Bold", fontSize=22, leading=27,
                   textColor=INK, spaceAfter=8, keepWithNext=True),
        "h2": dict(fontName="Guide-Bold", fontSize=12.2, leading=16.4,
                   textColor=INK, spaceBefore=7, spaceAfter=5,
                   keepWithNext=True),
        "h3": dict(fontName="Guide-Bold", fontSize=10, leading=14,
                   textColor=INK, spaceBefore=6, spaceAfter=4,
                   keepWithNext=True),
        "point": dict(fontName="Guide", fontSize=body_size,
                      leading=body_size * 1.37, textColor=INK,
                      leftIndent=10, firstLineIndent=-8, spaceAfter=3.2,
                      allowWidows=0, allowOrphans=0),
        "cell": dict(fontName="Guide", fontSize=9.2, leading=12.3,
                     textColor=INK, spaceAfter=0, allowWidows=0,
                     allowOrphans=0),
        "cellhead": dict(fontName="Guide-Bold", fontSize=9.2, leading=12.3,
                         textColor=INK, spaceAfter=0),
        "question": dict(fontName="Guide-Bold", fontSize=10.0, leading=13.5,
                         textColor=INK, spaceBefore=2, spaceAfter=3.3,
                         keepWithNext=True),
        "choice": dict(fontName="Guide", fontSize=10.0, leading=13.2,
                       textColor=INK, leftIndent=12, firstLineIndent=-12,
                       spaceAfter=1.7),
        "answer": dict(fontName="Guide", fontSize=10.0, leading=13.5,
                       textColor=INK, spaceAfter=5, allowWidows=0,
                       allowOrphans=0),
        "caption": dict(fontName="Guide", fontSize=8.2, leading=11.5,
                        textColor=MUTED, spaceBefore=5, spaceAfter=6),
        "chartref": dict(fontName="Guide-Bold", fontSize=9.1, leading=12.8,
                         textColor=BLUE, spaceBefore=4, spaceAfter=6),
        "center": dict(fontName="Guide", fontSize=9, leading=12,
                       textColor=MUTED, alignment=TA_CENTER),
    }
    for key, kwargs in definitions.items():
        styles.add(ParagraphStyle("guide_" + key, **kwargs))
    return {key: styles["guide_" + key] for key in definitions}


class Rule(Flowable):
    def __init__(self, width=WIDTH, color=GRID, thickness=.7, height=8):
        Flowable.__init__(self)
        self.width, self.height = width, height
        self.color, self.thickness = color, thickness

    def draw(self):
        self.canv.setStrokeColor(self.color)
        self.canv.setLineWidth(self.thickness)
        self.canv.line(0, self.height / 2, self.width, self.height / 2)


class CroppedChart(Flowable):
    """Clip the source PDF page's white margins, preserving every chart pixel."""

    def __init__(self, path, crop, max_width, max_height):
        Flowable.__init__(self)
        self.path = str(path)
        self.iw, self.ih = ImageReader(self.path).getSize()
        self.left, self.top, self.right, self.bottom = crop
        visible_w = self.iw * (self.right - self.left)
        visible_h = self.ih * (self.bottom - self.top)
        self.scale = min(max_width / visible_w, max_height / visible_h)
        self.width = visible_w * self.scale
        self.height = visible_h * self.scale
        self.hAlign = "CENTER"

    def draw(self):
        self.canv.saveState()
        boundary = self.canv.beginPath()
        boundary.rect(0, 0, self.width, self.height)
        self.canv.clipPath(boundary, stroke=0, fill=0)
        self.canv.drawImage(
            self.path, -self.left * self.iw * self.scale,
            -(1 - self.bottom) * self.ih * self.scale,
            width=self.iw * self.scale, height=self.ih * self.scale,
            mask="auto",
        )
        self.canv.restoreState()


class GuideDoc(BaseDocTemplate):
    def __init__(self, filename, **kwargs):
        BaseDocTemplate.__init__(
            self, str(filename), pagesize=letter, leftMargin=MARGIN_X,
            rightMargin=MARGIN_X, topMargin=TOP_MARGIN,
            bottomMargin=BOTTOM_MARGIN, pageCompression=1, **kwargs,
        )
        frame = Frame(MARGIN_X, BOTTOM_MARGIN, WIDTH, HEIGHT,
                      leftPadding=0, rightPadding=0, bottomPadding=0,
                      topPadding=0)
        self.addPageTemplates([
            PageTemplate(id="cover", frames=[frame], onPage=self.cover_footer),
            PageTemplate(id="normal", frames=[frame], onPage=self.header_footer),
        ])
        self.bookmark_pages = {}

    def afterFlowable(self, flowable):
        bookmark = getattr(flowable, "bookmark_name", None)
        if bookmark:
            self.canv.bookmarkPage(bookmark)
            self.bookmark_pages[bookmark] = self.page
            label = getattr(flowable, "bookmark_title", bookmark)
            level = getattr(flowable, "outline_level", 0)
            self.canv.addOutlineEntry(norm(label), bookmark, level=level,
                                     closed=False)

    @staticmethod
    def cover_footer(canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(BLUE)
        canvas.setLineWidth(4)
        canvas.line(MARGIN_X, PAGE_H - 31, PAGE_W - MARGIN_X, PAGE_H - 31)
        canvas.setFont("Guide", 8)
        canvas.setFillColor(MUTED)
        canvas.drawString(MARGIN_X, 25,
                          "Independent practice companion | October 19, 2026")
        canvas.restoreState()

    @staticmethod
    def header_footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("Guide-Bold", 7.4)
        canvas.setFillColor(MUTED)
        canvas.drawString(MARGIN_X, PAGE_H - 26,
                          "PART 107  /  SEVEN-DAY STUDY GUIDE")
        canvas.setStrokeColor(GRID)
        canvas.setLineWidth(.55)
        canvas.line(MARGIN_X, PAGE_H - 33, PAGE_W - MARGIN_X, PAGE_H - 33)
        canvas.line(MARGIN_X, 34, PAGE_W - MARGIN_X, 34)
        canvas.setFont("Guide", 7.5)
        canvas.drawString(MARGIN_X, 22,
                          "Original instruction and practice; public FAA figures are attributed.")
        canvas.drawRightString(PAGE_W - MARGIN_X, 22, str(doc.page))
        canvas.restoreState()


class Builder:
    def __init__(self, data, sources, figures, body_size=10.0):
        self.data = data
        self.lessons = data["lessons"]
        self.sources = {s["id"]: s for s in sources}
        self.figures = {f["id"]: f for f in figures}
        self.styles = make_styles(body_size)
        self.story = []
        self.used_sources = OrderedDict()
        self.used_figures = OrderedDict()
        self.all_questions = []
        for lesson in self.lessons:
            for drill in lesson.get("drills", []):
                self.all_questions.append((lesson, drill))
            for section in lesson.get("sections", []):
                if section.get("figureId"):
                    self.require_figure(section["figureId"])
            for drill in lesson.get("drills", []):
                if drill.get("figureId"):
                    self.require_figure(drill["figureId"])

    def p(self, text, style="body"):
        return Paragraph(esc(text), self.styles[style])

    def rich(self, text, style="body"):
        return Paragraph(text, self.styles[style])

    def add(self, *flowables):
        self.story.extend(flowables)

    def heading(self, title, bookmark, level=0, style="h1"):
        p = self.p(title, style)
        p.bookmark_name = bookmark
        p.bookmark_title = title
        p.outline_level = level
        return p

    def require_source(self, source_id):
        if source_id not in self.sources:
            raise ValueError(f"Unknown source id: {source_id}")
        self.used_sources.setdefault(source_id, len(self.used_sources) + 1)
        return self.sources[source_id]

    def require_figure(self, figure_id):
        if figure_id not in self.figures:
            raise ValueError(f"Unknown figure id: {figure_id}")
        self.used_figures.setdefault(figure_id, len(self.used_figures) + 1)
        figure = self.figures[figure_id]
        if figure.get("sourceId"):
            self.require_source(figure["sourceId"])
        return figure

    def refs(self, source_ids, sections=None):
        if not source_ids:
            return None
        refs = []
        for source_id in dict.fromkeys(source_ids):
            source = self.require_source(source_id)
            n = self.used_sources[source_id]
            url = html.escape(source["url"], quote=True)
            refs.append(f'<link href="{url}" color="#2457B8">[S{n}]</link>')
        note = ""
        if sections:
            if isinstance(sections, dict):
                note = "; ".join(
                    f"{key}: {', '.join(map(str, value)) if isinstance(value, list) else value}"
                    for key, value in sections.items()
                )
            elif isinstance(sections, list):
                note = "; ".join(map(str, sections))
            else:
                note = str(sections)
        return self.rich("Sources: " + " ".join(refs) +
                         (". " + esc(note) if note else ""), "source")

    def figure_ref(self, figure_id, note=None, compact=False):
        figure = self.require_figure(figure_id)
        n = self.used_figures[figure_id]
        if compact:
            return self.rich(f'<link href="#figure-{esc(figure_id)}" color="#2457B8">'
                             f'Use Chart F{n} in the chart appendix.</link>', "chartref")
        link = f'<link href="#figure-{esc(figure_id)}" color="#2457B8">Chart F{n}: {esc(figure["title"])}</link>'
        return self.rich(link + ". Full-page image in the chart appendix." +
                         (" " + esc(note) if note else ""), "chartref")

    def table(self, headers, rows, widths=None):
        data = [[self.p(c, "cellhead") for c in headers]]
        data += [[self.p(c, "cell") for c in row] for row in rows]
        if widths is None:
            if len(headers) == 2:
                widths = [WIDTH * .30, WIDTH * .70]
            elif len(headers) == 3:
                widths = [WIDTH * .18, WIDTH * .28, WIDTH * .54]
            else:
                widths = [WIDTH / len(headers)] * len(headers)
        table = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), PALE),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 5.5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5.5),
            ("LINEBELOW", (0, 0), (-1, 0), .7, GRID),
            ("LINEBELOW", (0, 1), (-1, -1), .35, GRID),
        ]))
        return table

    def box(self, paragraphs, tint=PALE):
        table = Table([[paragraphs]], colWidths=[WIDTH], hAlign="LEFT")
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), tint),
            ("BOX", (0, 0), (-1, -1), .5, GRID),
            ("LEFTPADDING", (0, 0), (-1, -1), 12),
            ("RIGHTPADDING", (0, 0), (-1, -1), 12),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        return table

    def cover(self):
        self.add(Spacer(1, 32), self.p("SEVEN DAYS / 60 MINUTES A DAY", "eyebrow"),
                 self.p("Part 107\nStudy Guide", "title"),
                 self.p(self.data.get("subtitle") or
                        "Learn the rules. Read the charts. Explain your answer.", "h2"),
                 Spacer(1, 10),
                 self.p("A complete first pass through the FAA Remote Pilot knowledge areas, "
                        "with worked examples, daily retrieval practice and a mixed final checkpoint."),
                 Spacer(1, 14))
        rows = [
            ["65 questions", "60 scored + 5 unscored"],
            ["2-hour limit", "70% passes: 42 of 60 scored"],
            ["Your preparation", "Seven one-hour sessions, plus a separate two-hour mock exam"],
        ]
        self.add(self.table(["Real UAG exam", "What it means"], rows,
                            [WIDTH * .30, WIDTH * .70]), Spacer(1, 20))
        self.add(self.box([
            self.p("Use this actively", "h3"),
            self.p("Read a short section, cover it, and say the answer out loud. "
                   "Then solve a new example. A correct guess still goes on your review list."),
            self.p("The daily drills and answer key are separated so you can practice without "
                   "seeing the explanation first. The chart appendix provides full-page FAA images.", "small"),
        ]), Spacer(1, 18))
        self.add(self.p("Current references checked October 19, 2026. This is independent instruction "
                        "and original practice, with clearly attributed public FAA examples. It is "
                        "not an FAA publication, an official test bank or a guarantee of passing.", "small"))
        self.add(self.p("Official exam details: PSI UAG Applicant Information Bulletin. The current "
                        "PSI weighting supersedes the older ranges printed in ACS Appendix 1.", "small"))
        source = self.require_source("psi")
        self.add(self.rich(f'<link href="{html.escape(source["url"], quote=True)}" '
                           'color="#2457B8">Open the current PSI exam bulletin</link>', "small"))
        self.add(NextPageTemplate("normal"), PageBreak())

    def plan(self):
        self.add(self.heading("Your seven-day plan", "plan"),
                 self.p("Seven one-hour lessons are a first pass. Reserve another uninterrupted "
                        "two hours for a fresh full exam, and add review wherever you cannot "
                        "explain an answer."))
        rows = [[str(lesson["day"]), lesson["title"] + "\n" + lesson.get("focus", "")]
                for lesson in self.lessons]
        self.add(self.table(["Day", "Lesson and focus"], rows,
                            [WIDTH * .08, WIDTH * .92]), Spacer(1, 10))
        self.add(self.p("The one-hour routine", "h2"),
                 self.p("Each lesson begins with its own timed tasks. Start with recall, read the "
                        "short sections, apply the rules without notes, and finish by correcting "
                        "mistakes in plain language. A correct guess still needs review."),
                 self.p("Readiness check", "h2"),
                 self.p("After Day 7, take a fresh 65-question exam with the full two-hour timer. "
                        "Aim for 85% or more and explain your answers. This is a study target, "
                        "not an FAA requirement. Repeating memorized questions does not demonstrate readiness."),
                 self.p("Current exam emphasis", "h2"),
                 self.p("Regulations 48% | Airspace 20% | Operations 25% | Weather 5% | "
                        "Loading and performance 2%. Study every area; give the largest blocks "
                        "to rules, chart use and operating decisions."))
        self.add(self.refs(["psi", "acs"]))
        self.add(self.p("Flashcards and full mock exams", "h2"),
                 self.rich('The companion site includes the daily flashcards and importable card file, '
                           'plus two full practice forms: '
                           '<link href="https://hondrospj.github.io/part107-practice/" '
                           'color="#2457B8">hondrospj.github.io/part107-practice</link>.'),
                 self.p("October 26 chart update", "h2"),
                 self.p("From October 26, 2026, UAG image questions may use charts absent from the "
                        "printed testing supplement. Learn how to read an unfamiliar chart rather "
                        "than memorizing a location or an answer letter. Printed supplements have "
                        "not yet been assigned a removal date."))
        self.add(self.refs(["advisory2026"], "September 2026 advisory, pages 5-6"))

    def lesson(self, lesson):
        day = lesson["day"]
        if day == 1:
            self.add(PageBreak())
        else:
            self.add(Spacer(1, 14), CondPageBreak(180), Rule(), Spacer(1, 12))
        self.add(self.p(f"DAY {day} / 60 MINUTES", "eyebrow"),
                 self.heading(lesson["title"], f"day-{day}"),
                 self.p(lesson.get("focus", "")))
        schedule = lesson.get("schedule", [])
        if schedule:
            line = " | ".join(f'{item["minutes"]} min {item["label"]}' for item in schedule)
            self.add(self.p(line, "small"))
            for item in schedule:
                if item.get("task"):
                    self.add(self.rich(f'<b>{item["minutes"]} min - {esc(item["label"])}.</b> '
                                       + esc(item["task"]), "small"))
            self.add(Rule(), Spacer(1, 4))
        for section in lesson.get("sections", []):
            self.add(self.p(section["title"], "h2"))
            for paragraph in section.get("paragraphs", []):
                self.add(self.p(paragraph))
            for point in section.get("points", []):
                self.add(self.p("- " + norm(point), "point"))
            table = section.get("table")
            if table:
                self.add(self.table(table["headers"], table["rows"]), Spacer(1, 8))
            if section.get("figureId"):
                self.add(self.figure_ref(section["figureId"], section.get("figureNote")))
            worked = section.get("worked")
            if worked:
                content = [self.p("WORKED EXAMPLE", "eyebrow"),
                           self.p(worked["prompt"])]
                for i, step in enumerate(worked.get("steps", []), 1):
                    content.append(self.p(f"{i}. {norm(step)}", "point"))
                content.append(self.rich("<b>Answer:</b> " + esc(worked.get("answer", ""))))
                if worked.get("trap"):
                    content.append(self.rich("<b>Watch for:</b> " + esc(worked["trap"]), "small"))
                self.add(KeepTogether([Spacer(1, 3), self.box(content), Spacer(1, 6)]))
            ref = self.refs(section.get("sourceIds", []), section.get("sourceSections"))
            if ref:
                self.add(ref)
        drill_count = len(lesson.get("drills", []))
        self.add(self.p(f"Next: answer the {drill_count} Day {day} practice questions without "
                        "notes, then check the separate key and retrieve the day's cards.", "small"))

    def atlas(self):
        if not self.used_figures:
            return
        for figure_id, n in self.used_figures.items():
            f = self.figures[figure_id]
            image_path = ROOT / f["src"]
            if not image_path.is_file():
                raise FileNotFoundError(f"Missing figure: {image_path}")
            self.add(PageBreak())
            if n == 1:
                self.add(self.heading("FAA chart appendix", "charts"),
                         self.p("Public FAA training figures and published samples. Historical charts "
                                "are for study, not navigation. Zoom in when reading digitally.", "small"))
            self.add(self.heading(f"Chart F{n}. {f['title']}", f"figure-{figure_id}",
                                  level=1, style="h2" if n == 1 else "h1"))
            iw, ih = ImageReader(str(image_path)).getSize()
            max_h = HEIGHT - (175 if n == 1 else 144)
            scale = min(WIDTH / iw, max_h / ih)
            if figure_id in {"faa-figure20", "faa-figure22", "faa-figure26"}:
                graphic = CroppedChart(image_path, (.134, .067, .926, .877), WIDTH, max_h)
            else:
                graphic = Image(str(image_path), width=iw * scale, height=ih * scale,
                                hAlign="CENTER")
            self.add(graphic, self.p(f.get("caption", ""), "caption"))
            if f.get("fullUrl"):
                self.add(self.rich(f'<link href="{html.escape(f["fullUrl"], quote=True)}" '
                                   'color="#2457B8">Open the official FAA source page</link>', "small"))
            ref = self.refs([f["sourceId"]] if f.get("sourceId") else [])
            if ref:
                self.add(ref)

    def practices(self):
        self.add(PageBreak(), self.heading("Daily practice", "practice"),
                 self.p("Answer without notes. Choose one answer for each question and mark any "
                        "guess. Explanations and source links are in the separate answer key. "
                        "These are original practice questions unless a prompt explicitly identifies "
                        "a public FAA sample."))
        for lesson in self.lessons:
            day = lesson["day"]
            title = "Mixed checkpoint" if day == 7 else lesson["title"]
            self.add(self.heading(f"Day {day}: {title}", f"practice-day-{day}",
                                  level=1, style="h2"))
            for i, drill in enumerate(lesson.get("drills", []), 1):
                qid = f"{day}.{i}"
                content = [self.p(f"{qid}  {drill['prompt']}", "question")]
                if drill.get("figureId"):
                    content.append(self.figure_ref(drill["figureId"], compact=True))
                for letter_, choice in zip("ABC", drill["choices"]):
                    content.append(self.p(f"{letter_}. {choice}", "choice"))
                content += [Spacer(1, 5)]
                self.add(KeepTogether(content))

    def answers(self):
        self.add(PageBreak(), self.heading("Answer key and explanations", "answers"),
                 self.p("Score one point per correct answer. Count an unanswered question as wrong. "
                        "A correct guess earns a point but still needs review. These short practice "
                        "scores are diagnostic; they do not predict an official result."))
        for lesson in self.lessons:
            day = lesson["day"]
            drills = lesson.get("drills", [])
            self.add(self.heading(f"Day {day} / {len(drills)} questions", f"answers-day-{day}",
                                  level=1, style="h2"))
            # A quick letter key makes marking the printed questions straightforward.
            summary = "   ".join(f"{i}. {'ABC'[d['answer']]}" for i, d in enumerate(drills, 1))
            self.add(self.p(summary, "small"))
            for i, drill in enumerate(drills, 1):
                label = f"{day}.{i}  Answer {'ABC'[drill['answer']]}"
                ref = self.refs(drill.get("sourceIds", []), drill.get("sourceSections"))
                ref_markup = ('<br/><font size="7.3" color="#516171">' + ref.text +
                              '</font>') if ref else ""
                explanation = self.rich("<b>" + esc(label) + "</b><br/>" +
                                        esc(drill["explanation"]) + ref_markup, "answer")
                self.add(KeepTogether([explanation, Spacer(1, 2)]))

    def references(self):
        self.add(PageBreak(), self.heading("Primary references", "references"),
                 self.p("Source numbers match the linked citations throughout this guide. "
                        "References were checked October 19, 2026. Current regulations control "
                        "when an older handbook conflicts with a later rule. Use the PSI bulletin "
                        "for the current exam weighting and the ACS for topic coverage."))
        for source_id, n in self.used_sources.items():
            s = self.sources[source_id]
            title = esc(s["title"])
            url = html.escape(s["url"], quote=True)
            self.add(KeepTogether([
                self.rich(f'<b>[S{n}] {title}</b><br/>'
                          f'<link href="{url}" color="#2457B8">Open primary source</link>', "answer"),
                Spacer(1, 6),
            ]))
        self.add(self.p("Public examples and original material", "h2"),
                 self.p("Lesson text, worked examples and original practice questions are an "
                        "independent learning aid. Public FAA sample questions and training "
                        "figures retain their attribution. Neither the sample questions nor this "
                        "guide disclose or guarantee the questions on a future FAA exam."),
                 self.p("Before booking", "h2"),
                 self.p("Obtain an FAA Tracking Number through IACRA, book the UAG examination "
                        "through PSI, check the identification requirements in your confirmation, "
                        "and verify the location and appointment time. Passing the knowledge "
                        "test is one step; certificate application and TSA processing follow."))

    def build(self, path):
        self.cover()
        self.plan()
        for lesson in self.lessons:
            self.lesson(lesson)
        self.atlas()
        self.practices()
        self.answers()
        self.references()
        doc = GuideDoc(path, title="Part 107 Seven-Day Study Guide",
                       author="Part 107 Practice", subject="Independent UAG study companion")
        doc.build(self.story)
        return doc


def validate(data, sources, figures):
    lessons = data.get("lessons", [])
    if [l.get("day") for l in lessons] != list(range(1, 8)):
        raise ValueError("The study guide must contain Days 1-7 exactly once, in order")
    for lesson in lessons:
        schedule = lesson.get("schedule", [])
        if schedule and sum(item["minutes"] for item in schedule) != 60:
            raise ValueError(f"Day {lesson['day']} schedule does not sum to 60 minutes")
        if not lesson.get("sections") or not lesson.get("drills"):
            raise ValueError(f"Day {lesson['day']} lacks instruction or questions")
        for drill in lesson["drills"]:
            if (len(drill.get("choices", [])) != 3 or
                    type(drill.get("answer")) is not int or drill["answer"] not in range(3)):
                raise ValueError(f"Invalid question choices/key: {drill.get('id')}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=ROOT / "data/study.json")
    parser.add_argument("--output", type=Path,
                        default=ROOT / "downloads/part107-study-guide.pdf")
    parser.add_argument("--body-size", type=float, default=10.0)
    parser.add_argument("--max-pages", type=int, default=48)
    args = parser.parse_args()
    data = json.loads(args.input.read_text())
    sources = json.loads((ROOT / "data/sources.json").read_text())
    figures = json.loads((ROOT / "data/figures.json").read_text())
    validate(data, sources, figures)
    register_fonts()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    builder = Builder(data, sources, figures, args.body_size)
    doc = builder.build(args.output)
    from pypdf import PdfReader
    reader = PdfReader(args.output)
    page_count = len(reader.pages)
    result = {
        "output": str(args.output.resolve()), "pages": page_count,
        "questions": len(builder.all_questions),
        "figures": len(builder.used_figures), "sources": len(builder.used_sources),
        "bytes": args.output.stat().st_size, "bookmarks": doc.bookmark_pages,
    }
    print(json.dumps(result, indent=2))
    if page_count > args.max_pages:
        raise SystemExit(f"Guide exceeds {args.max_pages} pages; revise before delivery")


if __name__ == "__main__":
    main()
