"""PDF Komitmen (awal periode) dan Evaluasi (akhir periode) untuk modul Sasaran."""
import io
from datetime import datetime

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether

from komitmen_pdf import EMERALD_DARK, EMERALD_TINT, MUTED, BORDER, INK, CONTENT_W, PAGE_W, _get_logo

STATUS_LABEL = {"SESUAI": "On track", "PERHATIAN": "At risk", "TERTINGGAL": "Off track", "BELUM_ADA_DATA": "No data"}
ARAH = {"NAIK": "Naik", "TURUN": "Turun", "JAGA": "Jaga"}
KESIMPULAN = {"REWARD": "Layak apresiasi", "EVALUASI": "Perlu evaluasi", "NETRAL": "Netral"}


def _fmt(v, satuan=""):
    if v is None:
        return "–"
    if satuan == "Rp":
        return "Rp " + f"{v:,.0f}".replace(",", ".")
    s = f"{v:,.2f}".rstrip("0").rstrip(".").replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{s}{'%' if satuan == '%' else (' ' + satuan if satuan else '')}"


def build_sasaran_pdf(jenis: str, data: dict, visi: dict, divisi_nama=None) -> bytes:
    buf = io.BytesIO()
    period = data["period"]
    title = "Surat Kesepakatan Target (OKR & KPI)" if jenis == "komitmen" else "Evaluasi OKR & KPI Periode"

    def footer(c, doc):
        c.saveState(); c.setFont("Helvetica", 8); c.setFillColor(MUTED)
        c.drawString(1.8 * cm, 1 * cm, f"Workspace Ruang Sanad · {title} · {period['nama']}")
        c.drawRightString(PAGE_W - 1.8 * cm, 1 * cm, f"Halaman {doc.page}")
        c.setStrokeColor(BORDER); c.line(1.8 * cm, 1.35 * cm, PAGE_W - 1.8 * cm, 1.35 * cm); c.restoreState()

    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=1.8 * cm, rightMargin=1.8 * cm, topMargin=1.6 * cm, bottomMargin=1.8 * cm)
    ss = getSampleStyleSheet()
    H1 = ParagraphStyle("h1", parent=ss["Title"], fontSize=17, textColor=EMERALD_DARK, alignment=0, spaceAfter=2)
    H2 = ParagraphStyle("h2", parent=ss["Heading2"], fontSize=12, textColor=EMERALD_DARK, spaceBefore=10, spaceAfter=4)
    B = ParagraphStyle("b", parent=ss["BodyText"], fontSize=9.5, leading=13, textColor=INK)
    S = ParagraphStyle("s", parent=B, fontSize=8.5, textColor=MUTED)
    story = []
    logo = _get_logo()
    head = [[logo or "", Paragraph(f"{title}<br/><font size=10 color='#64748B'>{period['nama']} · {period['start']} s.d. {period['end']}"
                                   f"{' · Tim ' + divisi_nama if divisi_nama else ''}</font>", H1)]]
    t = Table(head, colWidths=[2.6 * cm, CONTENT_W - 2.6 * cm]); t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    story += [t, Spacer(1, 8)]
    if visi.get("visi"):
        story += [Paragraph(f"<i>Visi:</i> {visi['visi']}", B)]
        for i, m in enumerate(visi.get("misi") or [], 1):
            story.append(Paragraph(f"{i}. {m}", S))
        story.append(Spacer(1, 6))

    if jenis == "evaluasi":
        st = data.get("stats", {})
        story.append(Paragraph(f"Ringkasan: {st.get('sasaran', 0)} objective, {st.get('ukuran', 0)} key result — "
                               f"{st.get('sesuai', 0)} on track, {st.get('perhatian', 0)} at risk, "
                               f"{st.get('tertinggal', 0)} off track, {st.get('belum_data', 0)} no data.", B))

    for s in data["sasaran"]:
        lvl = "Lembaga" if s.get("level") == "LEMBAGA" else ("Tim " + (s.get("divisi") or {}).get("nama", "-"))
        meta = f"Objective {lvl} · Owner: {(s.get('pj') or {}).get('nama', '–')}"
        if s.get("perspektif_label"):
            meta += f" · BSC {s['perspektif_label']}"
        if jenis == "evaluasi":
            meta += f" · {STATUS_LABEL.get(s['status'], s['status'])}" + (f" ({s['pct']}%)" if s.get("pct") is not None else "")
        rows = [["Key Result / KPI", "PIC", "Polaritas", "Baseline", "Target"] + (["Realisasi", "Status"] if jenis == "evaluasi" else [])]
        for u in s["ukuran"]:
            r = [Paragraph(u["nama"], S), (u.get("pic") or {}).get("nama", "–"), ARAH.get(u.get("arah"), "-"),
                 _fmt(u.get("awal"), u.get("satuan")), _fmt(u.get("target"), u.get("satuan"))]
            if jenis == "evaluasi":
                r += [_fmt(u.get("capaian"), u.get("satuan")), STATUS_LABEL.get(u["status"], u["status"])]
            rows.append(r)
        widths = [7.2 * cm, 2.6 * cm, 2 * cm, 2.2 * cm, 2.2 * cm] if jenis == "komitmen" else [5.4 * cm, 2.2 * cm, 1.7 * cm, 1.8 * cm, 1.8 * cm, 1.9 * cm, 2.6 * cm]
        tb = Table(rows, colWidths=widths, repeatRows=1)
        tb.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), EMERALD_TINT), ("TEXTCOLOR", (0, 0), (-1, 0), EMERALD_DARK),
                                ("FONTSIZE", (0, 0), (-1, -1), 8), ("GRID", (0, 0), (-1, -1), 0.4, BORDER),
                                ("VALIGN", (0, 0), (-1, -1), "TOP")]))
        block = [Paragraph(s["judul"], H2), Paragraph(meta, S), Spacer(1, 3), tb if s["ukuran"] else Paragraph("Belum ada key result.", S)]
        if jenis == "evaluasi" and s.get("tugas_summary", {}).get("total"):
            ts = s["tugas_summary"]
            block.append(Paragraph(f"Tugas pendukung: {ts['selesai']} dari {ts['total']} selesai.", S))
        story.append(KeepTogether(block))

    if jenis == "evaluasi":
        n = data.get("catatan") or {}
        story.append(Paragraph("Catatan & kesimpulan SPV", H2))
        story.append(Paragraph(f"Kesimpulan: <b>{KESIMPULAN.get(n.get('kesimpulan'), n.get('kesimpulan') or '–')}</b>", B))
        if n.get("summary"):
            story.append(Paragraph(n["summary"], B))
        for label, key in (("Yang berjalan baik", "highlights"), ("Yang perlu diperbaiki", "improvements"), ("Fokus berikutnya", "next_focus")):
            items = n.get(key) or []
            if items:
                story.append(Paragraph(f"<b>{label}:</b> " + "; ".join(items), B))
    else:
        story.append(Spacer(1, 14))
        story.append(Paragraph("Dengan ini kami menyepakati objective, key result, dan KPI di atas, serta berkomitmen melakukan check-in realisasi setiap pekan.", B))
        orang = {}
        for s in data["sasaran"]:
            for p in [s.get("pj")] + [u.get("pic") for u in s["ukuran"]]:
                if p:
                    orang[p["id"]] = p["nama"]
        names = list(orang.values()) or ["……………"]
        cells = [[Paragraph(f"<br/><br/><br/>( {n} )", S) for n in names[i:i + 3]] for i in range(0, len(names), 3)]
        for row in cells:
            row += [""] * (3 - len(row))
        sig = Table(cells, colWidths=[CONTENT_W / 3] * 3)
        sig.setStyle(TableStyle([("ALIGN", (0, 0), (-1, -1), "CENTER")]))
        story += [Spacer(1, 10), sig, Spacer(1, 10), Paragraph(f"Dicetak {datetime.now().strftime('%d-%m-%Y')}", S)]

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()
