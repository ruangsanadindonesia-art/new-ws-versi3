"""Migrasi Fase 2 (idempoten): rapikan field dobel di tasks. Jalankan: venv/bin/python migrate_fase2.py [--apply]"""
import os, re, sys
from dotenv import load_dotenv
from pymongo import MongoClient
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
APPLY = "--apply" in sys.argv
URL = re.compile(r"^\s*https?://\S+\s*$")
names = {a["id"]: a["nama"].strip().lower() for a in db.anggota.find({}, {"id": 1, "nama": 1})}
by_name = {v: k for k, v in names.items()}
for t in db.tasks.find({}):
    upd, notes = {}, []
    brief = (t.get("brief_link") or "").strip()
    cat = (t.get("catatan_tim") or "").strip()
    lo = (t.get("link_output") or "").strip()
    if cat and URL.match(cat) and not brief:
        brief = cat; upd["brief_link"] = cat; upd["catatan_tim"] = ""; notes.append("catatan_tim(URL)->brief_link")
    elif cat and URL.match(cat) and cat == brief:
        upd["catatan_tim"] = ""; notes.append("catatan_tim duplikat brief dihapus")
    if lo:
        if lo == brief or lo == cat:
            pass
        elif not brief and not t.get("hasil_link"):
            upd["brief_link"] = lo; notes.append("link_output->brief_link")
        elif not t.get("hasil_link"):
            upd["hasil_link"] = lo; notes.append("link_output->hasil_link")
        else:
            upd["hasil_catatan"] = ((t.get("hasil_catatan") or "") + f"\nLink output (lama): {lo}").strip(); notes.append("link_output->hasil_catatan")
        upd["link_output"] = ""
    for txt_key, id_key in (("pemberi_tugas", "pemberi_id"), ("penerima_tugas", "penerima_tugas_id")):
        txt = (t.get(txt_key) or "").strip()
        if not txt:
            continue
        cur = names.get(t.get(id_key))
        if cur and cur == txt.lower():
            notes.append(f"{txt_key} sama dengan {id_key}")
        elif not t.get(id_key) and txt.lower() in by_name:
            upd[id_key] = by_name[txt.lower()]; notes.append(f"{txt_key}->{id_key}")
        else:
            base = upd.get("catatan_tim", t.get("catatan_tim") or "")
            upd["catatan_tim"] = (base + f"\n{txt_key.replace('_', ' ').title()} (lama): {txt}").strip(); notes.append(f"{txt_key}->catatan_tim")
        upd[txt_key] = ""
    if upd:
        print(("APPLY " if APPLY else "DRY   ") + t.get("nama", "")[:40], "|", "; ".join(notes))
        if APPLY:
            db.tasks.update_one({"_id": t["_id"]}, {"$set": upd})
print("selesai", "(diterapkan)" if APPLY else "(dry run)")
