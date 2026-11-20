"""Migrasi v3 (idempoten). Pakai: venv/bin/python migrate_tugas_v3.py [--apply]
1. Label "priotas"/"Prioritas" -> tasks.prioritas=TINGGI; "Tidak Prioritas" -> RENDAH; label dihapus.
2. Tugas SELESAI tanpa selesai_at -> isi dari approved_at / updated_at.
3. Item amaliyah shalat/puasa (mis. Tahajud) -> gugur_haid=True bila belum diatur.
"""
import asyncio, os, re, sys
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
APPLY = "--apply" in sys.argv

async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    async for l in db.task_labels.find({}, {"_id": 0}):
        nama = (l.get("nama") or "").strip().lower()
        p = "RENDAH" if re.search(r"tidak\s*prior", nama) else ("TINGGI" if re.match(r"prio", nama) else None)
        if not p:
            continue
        n = await db.tasks.count_documents({"label_ids": l["id"]})
        print(f"label '{l['nama']}' -> prioritas {p} ({n} tugas), label dihapus")
        if APPLY:
            await db.tasks.update_many({"label_ids": l["id"], "prioritas": {"$in": [None, ""]}}, {"$set": {"prioritas": p}})
            await db.tasks.update_many({"label_ids": l["id"]}, {"$pull": {"label_ids": l["id"]}})
            await db.task_labels.delete_one({"id": l["id"]})
    n = 0
    async for t in db.tasks.find({"status": "SELESAI", "selesai_at": {"$in": [None]}}, {"_id": 0, "id": 1, "approved_at": 1, "updated_at": 1}):
        n += 1
        if APPLY:
            await db.tasks.update_one({"id": t["id"]}, {"$set": {"selesai_at": t.get("approved_at") or t.get("updated_at")}})
    print(f"selesai_at diisi untuk {n} tugas selesai")
    async for i in db.amaliyah_items.find({"gugur_haid": {"$exists": False}}, {"_id": 0, "id": 1, "nama": 1}):
        g = bool(re.search(r"tahajud|shalat|sholat|salat|dhuha|puasa|shaum|witir|rawatib", i["nama"], re.I))
        print(f"amaliyah '{i['nama']}' gugur_haid={g}")
        if APPLY:
            await db.amaliyah_items.update_one({"id": i["id"]}, {"$set": {"gugur_haid": g}})
    print("SELESAI" if APPLY else "DRY-RUN")

asyncio.run(main())
