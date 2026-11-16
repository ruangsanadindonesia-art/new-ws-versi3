"""Migrasi Strategi lama (BSC/OKR/KPI) -> modul Sasaran. Idempoten (pakai field migrated_from).

Jalankan:  venv/bin/python migrate_sasaran.py            (dry run, tidak mengubah apa pun)
           venv/bin/python migrate_sasaran.py --apply

Keputusan (disetujui pemilik, 16 Nov 2026):
- Periode aktif = Nov–Des 2026 ("Siklus 4"). Periode lama Sept 2026–Sept 2027 dirapikan jadi Sep–Okt 2026 lalu diarsipkan.
- KR/indikator/KPI bertuliskan "minimal/meningkat/mencapai" = arah NAIK (sebelumnya salah diset "MIN").
- Goal BSC -> sasaran LEMBAGA di periode aktif, perspektif sebagai label; indikatornya -> ukuran.
- OKR -> sasaran TIM di periodenya; KR -> ukuran; KPI individu -> ukuran di sasaran lembaga perspektif SANTRI.
- Koleksi lama TIDAK dihapus.
"""
import os
import sys
import uuid
from datetime import datetime, timezone

from dotenv import load_dotenv
from pymongo import MongoClient

sys.path.insert(0, os.path.dirname(__file__))
from sasaran import parse_angka  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
APPLY = "--apply" in sys.argv
NOW = datetime.now(timezone.utc).isoformat()
log = lambda *a: print(("APPLY " if APPLY else "DRY   ") + " ".join(str(x) for x in a))

ASPEK = {"FINANCIAL": "KEUANGAN", "CUSTOMER": "SANTRI", "INTERNAL": "OPERASIONAL", "LEARNING": "SDM"}


def unit_for(nama, unit):
    if unit:
        return unit
    n = nama.lower()
    for w in ("santri", "kelas", "guru", "lead"):
        if w in n:
            return w
    return ""


def upsert(coll, key, doc):
    ex = db[coll].find_one({"migrated_from": key})
    if ex:
        return ex["id"], False
    doc = {**doc, "id": str(uuid.uuid4()), "migrated_from": key, "created_at": NOW}
    if APPLY:
        db[coll].insert_one(doc)
    return doc["id"], True


# ---- 1. Periode
periods = list(db.strategy_periods.find({}))
p_old = next((p for p in periods if p["nama"].startswith("Periode Sept")), None)
p_new = next((p for p in periods if "Siklus 4" in p["nama"]), None)
if p_old and p_old.get("end") != "2026-10-31":
    log("periode", p_old["nama"], "-> Sep–Okt 2026, end 2026-10-31, diarsipkan")
    if APPLY:
        db.strategy_periods.update_one({"_id": p_old["_id"]}, {"$set": {"nama": "Siklus 3 · Sep–Okt 2026", "end": "2026-10-31",
                                                                       "siklus_bulan": 2, "active": False, "archived": True}})
if p_new and not (p_new.get("active") and p_new.get("nama", "").startswith("Siklus 4 ·")):
    log("periode", p_new["nama"], "-> aktif, nama 'Siklus 4 · Nov–Des 2026'")
    if APPLY:
        db.strategy_periods.update_many({}, {"$set": {"active": False}})
        db.strategy_periods.update_one({"_id": p_new["_id"]}, {"$set": {"nama": "Siklus 4 · Nov–Des 2026", "active": True, "archived": False}})
active_id = p_new["id"] if p_new else None

# ---- 2. Visi -> GLOBAL
v = db.strategy_vision.find_one({"period_id": {"$ne": "GLOBAL"}})
if v and not db.strategy_vision.find_one({"period_id": "GLOBAL"}):
    log("visi -> GLOBAL")
    if APPLY:
        db.strategy_vision.insert_one({"period_id": "GLOBAL", "visi": v.get("visi", ""), "misi": v.get("misi", []),
                                       "nilai": v.get("nilai", []), "updated_at": NOW})

# ---- 3. BSC -> sasaran LEMBAGA (periode aktif)
bsc_map = {}
if active_id:
    for i, b in enumerate(db.bsc_goals.find({}).sort([("aspek", 1)]), 1):
        sid, new = upsert("sasaran", f"bsc:{b['id']}", {"period_id": active_id, "judul": b.get("judul") or b["aspek"], "level": "LEMBAGA",
                                                       "divisi_id": None, "pj_id": None, "tim_ids": [], "perspektif": ASPEK.get(b["aspek"]),
                                                       "parent_id": None, "urutan": i})
        bsc_map[b["id"]] = sid
        if new:
            log("sasaran LEMBAGA", ASPEK.get(b["aspek"]), "|", b.get("judul", "")[:60])
        for j, ind in enumerate(b.get("indikators") or [], 1):
            tgt, un = parse_angka(ind.get("target"))
            cap, _ = parse_angka(ind.get("realisasi"))
            if tgt is None:
                log("  LEWATI indikator tanpa target angka:", ind.get("nama")); continue
            _, new = upsert("ukuran", f"bsc_ind:{ind.get('id')}", {"sasaran_id": sid, "period_id": active_id, "nama": ind.get("nama") or "-",
                                                                  "pic_id": None, "arah": "NAIK", "satuan": unit_for(ind.get("nama", ""), un),
                                                                  "awal": None, "target": tgt, "capaian": cap, "confidence": None,
                                                                  "last_checkin_at": None, "urutan": j})
            if new:
                log("  ukuran", ind.get("nama"), "| target", tgt, unit_for(ind.get("nama", ""), un))

# ---- 4. OKR -> sasaran TIM; KR -> ukuran
for o in db.okr_objectives.find({}).sort([("created_at", 1)]):
    lvl = "LEMBAGA" if o.get("level") == "COMPANY" else "TIM"
    parent = bsc_map.get(o.get("bsc_target_id")) if o.get("period_id") == active_id else None
    persp = None
    if o.get("bsc_target_id"):
        bg = db.bsc_goals.find_one({"id": o["bsc_target_id"]})
        persp = ASPEK.get(bg["aspek"]) if bg else None
    sid, new = upsert("sasaran", f"okr:{o['id']}", {"period_id": o["period_id"], "judul": o["objective"], "level": lvl,
                                                   "divisi_id": o.get("divisi_id") if lvl == "TIM" else None, "pj_id": o.get("owner_id"),
                                                   "tim_ids": o.get("supporter_ids") or [], "perspektif": persp, "parent_id": parent,
                                                   "urutan": o.get("urutan", 0)})
    if new:
        log("sasaran TIM", "|", o["objective"][:60])
    for j, kr in enumerate(db.okr_keyresults.find({"objective_id": o["id"]}).sort("urutan", 1), 1):
        tgt, un = parse_angka(kr.get("target"))
        awal, _ = parse_angka(kr.get("baseline"))
        cap, _ = parse_angka(kr.get("actual"))
        if tgt is None:
            log("  LEWATI KR tanpa target angka:", kr.get("nama")); continue
        satuan = unit_for(kr.get("nama", ""), un)
        _, new = upsert("ukuran", f"kr:{kr['id']}", {"sasaran_id": sid, "period_id": o["period_id"], "nama": kr["nama"],
                                                     "pic_id": o.get("owner_id"), "arah": "NAIK", "satuan": satuan, "awal": awal,
                                                     "target": tgt, "capaian": cap, "confidence": None, "last_checkin_at": None, "urutan": j})
        if new:
            log("  ukuran", kr["nama"][:70], "| awal", awal, "| target", tgt, satuan, "| arah NAIK (dulu", kr.get("polaritas"), ")")

# ---- 5. KPI -> ukuran di sasaran lembaga SANTRI (periode aktif), dengan check-in dari nilai aktual lama
santri_sid = next((sid for bid, sid in bsc_map.items() if (db.bsc_goals.find_one({"id": bid}) or {}).get("aspek") == "CUSTOMER"), None)
for k in db.kpi_items.find({}):
    if not santri_sid:
        log("  LEWATI KPI (tidak ada sasaran SANTRI):", k.get("indikator")); continue
    uid, new = upsert("ukuran", f"kpi:{k['id']}", {"sasaran_id": santri_sid, "period_id": active_id, "nama": k["indikator"].strip().capitalize(),
                                                   "pic_id": k.get("anggota_id"), "arah": "NAIK", "satuan": "%", "awal": None,
                                                   "target": float(k.get("target") or 0), "capaian": float(k.get("aktual") or 0),
                                                   "confidence": None, "last_checkin_at": k.get("created_at"), "urutan": 99})
    if new:
        log("  ukuran KPI", k["indikator"], "| target", k.get("target"), "| capaian", k.get("aktual"), "| arah NAIK (dulu", k.get("polaritas"), ")")
        if APPLY:
            db.ukuran_checkins.insert_one({"id": str(uuid.uuid4()), "ukuran_id": uid, "nilai": float(k.get("aktual") or 0), "confidence": "RAGU",
                                           "catatan": "Nilai awal dari KPI lama (dimigrasikan).", "user_id": None,
                                           "actor_name": "Migrasi data", "at": k.get("created_at") or NOW, "migrated_from": f"kpi:{k['id']}"})

print("selesai", "(diterapkan)" if APPLY else "(dry run — tidak ada yang diubah)")
print("catatan: Action Plan (1 proyek, tertaut 2 tugas uji) tidak dimigrasikan; tautkan tugas ke sasaran lewat form Tugas.")
