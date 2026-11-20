"""SPV/Head Monitoring endpoints: deadline radar, workload, compliance, stagnation, division progress."""
from datetime import datetime, timezone, timedelta, date
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from motor.motor_asyncio import AsyncIOMotorDatabase


def build_monitoring_router(db: AsyncIOMotorDatabase, get_current_user, user_scope) -> APIRouter:
    router = APIRouter(prefix="/monitoring", tags=["monitoring"])

    def _today():
        return date.today().isoformat()

    def _days_from_today(n):
        return (date.today() + timedelta(days=n)).isoformat()

    async def _guard(user, divisi_id=None):
        """SPV → full access. Head → restricted to own divisi. Else → 403."""
        scope = await user_scope(user)
        if scope["is_spv"]:
            return {"is_spv": True, "divisi": divisi_id}
        if scope.get("head_divisi_id"):
            return {"is_spv": False, "divisi": scope["head_divisi_id"]}
        raise HTTPException(403, "Hanya SPV atau Head Divisi yang bisa mengakses monitoring.")

    # ================= PUSAT KENDALI (satu panggilan untuk layar Monitoring) =================
    WIB = timezone(timedelta(hours=7))
    RUTIN = ["HARIAN", "MINGGUAN", "BULANAN"]

    def _batas(t: dict):
        dl = t.get("deadline")
        if not dl:
            return None
        try:
            d = date.fromisoformat(str(dl)[:10])
        except ValueError:
            return None
        hh, mm = (t.get("deadline_jam") or "23:59").split(":")
        return datetime(d.year, d.month, d.day, int(hh), int(mm), tzinfo=WIB)

    def _iso(v):
        if not v:
            return None
        try:
            x = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        except ValueError:
            return None
        return x if x.tzinfo else x.replace(tzinfo=timezone.utc)

    @router.get("/kendali")
    async def kendali(divisi_id: Optional[str] = None, user: dict = Depends(get_current_user)):
        """Daftar tugas yang perlu tindakan + ringkasan per tim & per orang.
        Bucket (urutan prioritas): TERLAMBAT, HARI_INI, SEGERA (<=3 hari), REVIEW_LAMA (menunggu review >2 hari),
        MACET (tidak ada perubahan >=3 hari), TANPA_DEADLINE. Tugas rutin tidak dihitung."""
        g = await _guard(user, divisi_id)
        if not g["is_spv"]:
            divisi_id = g["divisi"]
        anggota = await db.anggota.find({}, {"_id": 0, "id": 1, "nama": 1, "divisi_id": 1, "warna": 1}).to_list(1000)
        amap = {a["id"]: a for a in anggota}
        divisi = await db.divisi.find({}, {"_id": 0, "id": 1, "nama": 1, "warna": 1, "head_anggota_id": 1}).sort("urutan", 1).to_list(200)
        dmap = {d["id"]: d for d in divisi}

        def tim_of(t):  # tim tugas = tim R (fallback: divisi tempat tugas disimpan)
            r = amap.get(t.get("penerima_tugas_id"))
            return (r or {}).get("divisi_id") or t.get("divisi_id")

        q = {"archived": {"$ne": True}, "kategori": {"$nin": RUTIN}}
        if divisi_id:
            members = [a["id"] for a in anggota if a.get("divisi_id") == divisi_id]
            q["$or"] = [{"divisi_id": divisi_id}, {"penerima_tugas_id": {"$in": members}}]
        rows = await db.tasks.find(q, {"_id": 0, "id": 1, "nama": 1, "status": 1, "deadline": 1, "deadline_jam": 1, "prioritas": 1,
                                       "penerima_tugas_id": 1, "pemberi_id": 1, "divisi_id": 1, "updated_at": 1, "review_at": 1,
                                       "selesai_at": 1, "approved_at": 1}).to_list(5000)
        now = datetime.now(WIB)
        today = now.date()
        items, per_tim, per_orang = [], {}, {}
        for t in rows:
            tim = tim_of(t)
            pt = per_tim.setdefault(tim, {"aktif": 0, "terlambat": 0, "hari_ini": 0, "segera": 0, "macet": 0, "dinilai_30": 0, "tepat_30": 0})
            batas = _batas(t)
            if t.get("status") == "SELESAI":
                # Ketepatan 30 hari terakhir: tugas berdeadline yang jatuh tempo dalam 30 hari
                if batas and (now - batas).days <= 30 and batas <= now + timedelta(days=0):
                    pt["dinilai_30"] += 1
                    sel = _iso(t.get("selesai_at") or t.get("approved_at") or t.get("updated_at"))
                    if sel is None or sel <= batas:
                        pt["tepat_30"] += 1
                continue
            r_id = t.get("penerima_tugas_id")
            po = per_orang.setdefault(r_id or "_", {"aktif": 0, "terlambat": 0, "segera": 0, "macet": 0})
            pt["aktif"] += 1
            po["aktif"] += 1
            upd = _iso(t.get("updated_at"))
            diam = (now - upd).days if upd else 0
            bucket, telat, sisa = None, None, None
            if batas and batas < now:
                bucket, telat = "TERLAMBAT", max(1, (today - batas.date()).days) if batas.date() < today else 0
                pt["terlambat"] += 1
                po["terlambat"] += 1
                pt["dinilai_30"] += 1 if (now - batas).days <= 30 else 0
            elif batas and batas.date() == today:
                bucket = "HARI_INI"
                pt["hari_ini"] += 1
                po["segera"] += 1
            elif batas and (batas.date() - today).days <= 3:
                bucket, sisa = "SEGERA", (batas.date() - today).days
                pt["segera"] += 1
                po["segera"] += 1
            elif t.get("status") == "MENUNGGU_REVIEW" and (now - (_iso(t.get("review_at")) or upd or now)).days >= 2:
                bucket = "REVIEW_LAMA"
            elif diam >= 3:
                bucket = "MACET"
                pt["macet"] += 1
                po["macet"] += 1
            elif not batas:
                bucket = "TANPA_DEADLINE"
            if not bucket:
                continue
            r = amap.get(r_id) or {}
            items.append({"id": t["id"], "nama": t["nama"], "status": t.get("status"), "prioritas": t.get("prioritas"),
                          "deadline": t.get("deadline"), "deadline_jam": t.get("deadline_jam"), "bucket": bucket,
                          "telat_hari": telat, "sisa_hari": sisa, "diam_hari": diam,
                          "r_id": r_id, "r_nama": r.get("nama") or "Belum ada R", "a_nama": (amap.get(t.get("pemberi_id")) or {}).get("nama"),
                          "tim_id": tim, "tim_nama": (dmap.get(tim) or {}).get("nama") or "-"})
        urut = {"TERLAMBAT": 0, "HARI_INI": 1, "SEGERA": 2, "REVIEW_LAMA": 3, "MACET": 4, "TANPA_DEADLINE": 5}
        prio = {"TINGGI": 0, "SEDANG": 1, "RENDAH": 2}
        items.sort(key=lambda x: (urut[x["bucket"]], -(x["telat_hari"] or 0), x["deadline"] or "9999", x.get("deadline_jam") or "23:59", prio.get(x.get("prioritas"), 3)))
        summary = {b: sum(1 for i in items if i["bucket"] == b) for b in urut}
        tim_rows = []
        for d in divisi:
            if divisi_id and d["id"] != divisi_id:
                continue
            v = per_tim.get(d["id"], {"aktif": 0, "terlambat": 0, "hari_ini": 0, "segera": 0, "macet": 0, "dinilai_30": 0, "tepat_30": 0})
            tim_rows.append({"id": d["id"], "nama": d["nama"], "warna": d.get("warna"), "kepala": (amap.get(d.get("head_anggota_id")) or {}).get("nama"),
                             **{k: v[k] for k in ("aktif", "terlambat", "hari_ini", "segera", "macet")},
                             "tepat_waktu_pct": round(v["tepat_30"] / v["dinilai_30"] * 100) if v["dinilai_30"] else None})
        orang_rows = []
        for a_id, v in per_orang.items():
            a = amap.get(a_id) or {}
            if divisi_id and a.get("divisi_id") != divisi_id and a_id != "_":
                continue
            orang_rows.append({"id": a_id, "nama": a.get("nama") or "Belum ada R", "warna": a.get("warna"),
                               "tim_nama": (dmap.get(a.get("divisi_id")) or {}).get("nama") or "-", **v})
        orang_rows.sort(key=lambda x: (-x["terlambat"], -x["segera"], -x["aktif"]))
        return {"items": items, "summary": summary, "per_tim": tim_rows, "per_orang": orang_rows,
                "is_spv": g["is_spv"], "divisi_id": divisi_id, "dihitung_at": now.isoformat()}

    @router.get("/deadline-radar")
    async def deadline_radar(divisi_id: Optional[str] = None, user: dict = Depends(get_current_user)):
        g = await _guard(user, divisi_id)
        if not g["is_spv"]:
            divisi_id = g["divisi"]
        base = {"archived": {"$ne": True}, "status": {"$ne": "SELESAI"}}
        if divisi_id:
            base["divisi_id"] = divisi_id
        today = _today()
        d3 = _days_from_today(3)

        overdue = await db.tasks.find({**base, "deadline": {"$lt": today, "$ne": None}}, {"_id": 0}).sort("deadline", 1).to_list(500)
        today_tasks = await db.tasks.find({**base, "deadline": today}, {"_id": 0}).to_list(500)
        upcoming = await db.tasks.find({**base, "deadline": {"$gt": today, "$lte": d3}}, {"_id": 0}).sort("deadline", 1).to_list(500)

        anggota = await db.anggota.find({}, {"_id": 0}).to_list(500)
        anggota_map = {a["id"]: a["nama"] for a in anggota}
        divisi = await db.divisi.find({}, {"_id": 0}).to_list(200)
        divisi_map = {d["id"]: d["nama"] for d in divisi}

        def _decorate(rows):
            return [{
                **r,
                "penerima_nama": anggota_map.get(r.get("penerima_tugas_id"), r.get("penerima_tugas") or "-"),
                "divisi_nama": divisi_map.get(r.get("divisi_id"), "-"),
            } for r in rows]

        return {
            "overdue": _decorate(overdue),
            "today": _decorate(today_tasks),
            "upcoming": _decorate(upcoming),
            "summary": {
                "overdue": len(overdue),
                "today": len(today_tasks),
                "upcoming": len(upcoming),
            },
        }

    @router.get("/workload")
    async def workload(divisi_id: Optional[str] = None, user: dict = Depends(get_current_user)):
        g = await _guard(user, divisi_id)
        if not g["is_spv"]:
            divisi_id = g["divisi"]
        anggota_q = {}
        if divisi_id:
            anggota_q["divisi_id"] = divisi_id
        anggota = await db.anggota.find(anggota_q, {"_id": 0}).sort("urutan", 1).to_list(500)
        divisi = await db.divisi.find({}, {"_id": 0}).to_list(200)
        divisi_map = {d["id"]: d["nama"] for d in divisi}
        rows = []
        for a in anggota:
            base = {"penerima_tugas_id": a["id"], "archived": {"$ne": True}}
            active = await db.tasks.count_documents({**base, "status": {"$ne": "SELESAI"}})
            proses = await db.tasks.count_documents({**base, "status": {"$in": ["DALAM_PROSES", "MENUNGGU_REVIEW", "REVISI"]}})
            kendala = await db.tasks.count_documents({**base, "status": "TERKENDALA"})
            belum = await db.tasks.count_documents({**base, "status": "BELUM_MULAI"})
            overdue = await db.tasks.count_documents({**base, "status": {"$ne": "SELESAI"}, "deadline": {"$lt": _today(), "$ne": None}})
            rows.append({
                **a,
                "divisi_nama": divisi_map.get(a.get("divisi_id"), "-"),
                "aktif": active,
                "proses": proses,
                "kendala": kendala,
                "belum": belum,
                "overdue": overdue,
            })
        rows.sort(key=lambda x: x["aktif"], reverse=True)
        max_val = max([r["aktif"] for r in rows] + [1])
        return {"anggota": rows, "max": max_val}

    @router.get("/amaliyah-compliance")
    async def amaliyah_compliance(days: int = 7, user: dict = Depends(get_current_user)):
        g = await _guard(user)
        if not g["is_spv"]:
            raise HTTPException(403, "Data kepatuhan amaliyah hanya untuk SPV.")
        end = date.today()
        start = end - timedelta(days=days - 1)
        start_s, end_s = start.isoformat(), end.isoformat()
        items = await db.amaliyah_items.find({}, {"_id": 0}).sort("urutan", 1).to_list(500)
        entries = await db.amaliyah_entries.find(
            {"tanggal": {"$gte": start_s, "$lte": end_s}, "checked": True},
            {"_id": 0},
        ).to_list(20000)
        by_item = {}
        for e in entries:
            by_item[e["item_id"]] = by_item.get(e["item_id"], 0) + 1

        result = []
        for it in items:
            done = by_item.get(it["id"], 0)
            target = days
            pct = round(done / target * 100, 1) if target else 0
            result.append({**it, "done": done, "target": target, "pct": pct})
        result.sort(key=lambda x: x["pct"], reverse=True)
        total_target = sum(r["target"] for r in result) or 1
        total_done = sum(r["done"] for r in result)
        return {
            "days": days,
            "start": start_s,
            "end": end_s,
            "items": result,
            "overall_pct": round(total_done / total_target * 100, 1),
        }

    @router.get("/stagnant-tasks")
    async def stagnant_tasks(days: int = 3, user: dict = Depends(get_current_user)):
        g = await _guard(user)
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        stg_q = {
            "archived": {"$ne": True},
            "status": {"$in": ["BELUM_MULAI", "DALAM_PROSES", "TERKENDALA", "REVISI", "MENUNGGU_REVIEW"]},
            "updated_at": {"$lt": cutoff},
        }
        if not g["is_spv"]:
            stg_q["divisi_id"] = g["divisi"]
        rows = await db.tasks.find(stg_q, {"_id": 0}).sort("updated_at", 1).to_list(500)

        anggota = await db.anggota.find({}, {"_id": 0}).to_list(500)
        anggota_map = {a["id"]: a["nama"] for a in anggota}
        divisi = await db.divisi.find({}, {"_id": 0}).to_list(200)
        divisi_map = {d["id"]: d["nama"] for d in divisi}
        out = [{
            **r,
            "penerima_nama": anggota_map.get(r.get("penerima_tugas_id"), r.get("penerima_tugas") or "-"),
            "divisi_nama": divisi_map.get(r.get("divisi_id"), "-"),
            "hari_diam": (datetime.now(timezone.utc) - datetime.fromisoformat(r["updated_at"].replace("Z", "+00:00") if "Z" in r["updated_at"] else r["updated_at"])).days if r.get("updated_at") else 0,
        } for r in rows]
        return {"days_threshold": days, "tasks": out}

    @router.get("/division-progress")
    async def division_progress(user: dict = Depends(get_current_user)):
        g = await _guard(user)
        div_q = {} if g["is_spv"] else {"id": g["divisi"]}
        divisi = await db.divisi.find(div_q, {"_id": 0}).sort("urutan", 1).to_list(200)
        rows = []
        for d in divisi:
            base = {"divisi_id": d["id"], "archived": {"$ne": True}}
            total = await db.tasks.count_documents(base)
            selesai = await db.tasks.count_documents({**base, "status": "SELESAI"})
            terkendala = await db.tasks.count_documents({**base, "status": "TERKENDALA"})
            overdue = await db.tasks.count_documents({**base, "status": {"$ne": "SELESAI"}, "deadline": {"$lt": _today(), "$ne": None}})
            pct = round(selesai / total * 100, 1) if total else 0
            rows.append({**d, "total": total, "selesai": selesai, "terkendala": terkendala, "overdue": overdue, "pct": pct})
        return {"divisi": rows}

    @router.get("/workload-heatmap")
    async def workload_heatmap(user: dict = Depends(get_current_user)):
        """Matrix divisi × status untuk peta beban tim (heatmap)."""
        g = await _guard(user)
        statuses = ["BELUM_MULAI", "DALAM_PROSES", "TERKENDALA", "SELESAI", "OVERDUE"]
        div_q = {} if g["is_spv"] else {"id": g["divisi"]}
        divisi = await db.divisi.find(div_q, {"_id": 0}).sort("urutan", 1).to_list(200)
        today = _today()
        rows = []
        max_cell = 1
        for d in divisi:
            base = {"divisi_id": d["id"], "archived": {"$ne": True}}
            cells = {
                "BELUM_MULAI": await db.tasks.count_documents({**base, "status": "BELUM_MULAI"}),
                "DALAM_PROSES": await db.tasks.count_documents({**base, "status": {"$in": ["DALAM_PROSES", "MENUNGGU_REVIEW", "REVISI"]}}),
                "TERKENDALA": await db.tasks.count_documents({**base, "status": "TERKENDALA"}),
                "SELESAI": await db.tasks.count_documents({**base, "status": "SELESAI"}),
                "OVERDUE": await db.tasks.count_documents({**base, "status": {"$ne": "SELESAI"}, "deadline": {"$lt": today, "$ne": None}}),
            }
            total = await db.tasks.count_documents(base)
            active = cells["BELUM_MULAI"] + cells["DALAM_PROSES"] + cells["TERKENDALA"]
            for v in cells.values():
                max_cell = max(max_cell, v)
            rows.append({**d, "cells": cells, "total": total, "aktif": active})
        totals = {s: sum(r["cells"][s] for r in rows) for s in statuses}
        totals["total"] = sum(r["total"] for r in rows)
        return {"statuses": statuses, "divisi": rows, "max": max_cell, "totals": totals}

    @router.get("/user/{anggota_id}")
    async def user_monitoring(anggota_id: str, days: int = 7, user: dict = Depends(get_current_user)):
        """Combined per-anggota monitoring: deadline radar, workload, amaliyah compliance, stagnant tasks."""
        g = await _guard(user)
        ang = await db.anggota.find_one({"id": anggota_id}, {"_id": 0})
        if not ang:
            return {"error": "anggota_not_found"}
        if not g["is_spv"] and ang.get("divisi_id") != g["divisi"]:
            raise HTTPException(403, "Anggota ini di luar divisi Anda.")
        div = await db.divisi.find_one({"id": ang.get("divisi_id")}, {"_id": 0}) if ang.get("divisi_id") else None
        ang["divisi_nama"] = div.get("nama") if div else "-"
        ang["divisi_warna"] = div.get("warna") if div else "#059669"

        base = {"penerima_tugas_id": anggota_id, "archived": {"$ne": True}}
        today = _today()
        d3 = _days_from_today(3)

        overdue = await db.tasks.find({**base, "status": {"$ne": "SELESAI"}, "deadline": {"$lt": today, "$ne": None}}, {"_id": 0}).sort("deadline", 1).to_list(200)
        today_tasks = await db.tasks.find({**base, "status": {"$ne": "SELESAI"}, "deadline": today}, {"_id": 0}).to_list(200)
        upcoming = await db.tasks.find({**base, "status": {"$ne": "SELESAI"}, "deadline": {"$gt": today, "$lte": d3}}, {"_id": 0}).sort("deadline", 1).to_list(200)

        # Workload
        aktif = await db.tasks.count_documents({**base, "status": {"$ne": "SELESAI"}})
        selesai = await db.tasks.count_documents({**base, "status": "SELESAI"})
        proses = await db.tasks.count_documents({**base, "status": {"$in": ["DALAM_PROSES", "MENUNGGU_REVIEW", "REVISI"]}})
        kendala = await db.tasks.count_documents({**base, "status": "TERKENDALA"})
        belum = await db.tasks.count_documents({**base, "status": "BELUM_MULAI"})
        total = aktif + selesai
        pct = round(selesai / total * 100, 1) if total else 0

        # Stagnant tasks (user-scoped)
        cutoff = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
        stg = await db.tasks.find({**base, "status": {"$in": ["BELUM_MULAI", "DALAM_PROSES", "TERKENDALA", "REVISI", "MENUNGGU_REVIEW"]}, "updated_at": {"$lt": cutoff}}, {"_id": 0}).sort("updated_at", 1).to_list(100)
        stg_out = []
        for r in stg:
            try:
                iso = r["updated_at"].replace("Z", "+00:00") if "Z" in (r.get("updated_at") or "") else r.get("updated_at")
                hari = (datetime.now(timezone.utc) - datetime.fromisoformat(iso)).days if iso else 0
            except Exception:
                hari = 0
            stg_out.append({**r, "hari_diam": hari})

        # Amaliyah compliance (only if linked to user)
        amal = {"overall_pct": 0, "items": [], "days": days, "start": "-", "end": "-", "linked": False}
        if ang.get("user_id"):
            end_d = date.today()
            start_d = end_d - timedelta(days=days - 1)
            items = await db.amaliyah_items.find({}, {"_id": 0}).sort("urutan", 1).to_list(500)
            entries = await db.amaliyah_entries.find({
                "tanggal": {"$gte": start_d.isoformat(), "$lte": end_d.isoformat()},
                "checked": True,
                "user_id": ang["user_id"],
            }, {"_id": 0}).to_list(20000)
            by_item = {}
            for e in entries:
                by_item[e["item_id"]] = by_item.get(e["item_id"], 0) + 1
            arr = []
            for it in items:
                done = by_item.get(it["id"], 0)
                pct_a = round(done / days * 100, 1) if days else 0
                arr.append({**it, "done": done, "target": days, "pct": pct_a})
            arr.sort(key=lambda x: x["pct"], reverse=True)
            total_target = len(items) * days or 1
            total_done = sum(a["done"] for a in arr)
            amal = {
                "overall_pct": round(total_done / total_target * 100, 1),
                "items": arr,
                "days": days,
                "start": start_d.isoformat(),
                "end": end_d.isoformat(),
                "linked": True,
            }

        return {
            "anggota": ang,
            "deadline": {
                "overdue": overdue, "today": today_tasks, "upcoming": upcoming,
                "summary": {"overdue": len(overdue), "today": len(today_tasks), "upcoming": len(upcoming)},
            },
            "workload": {
                "aktif": aktif, "selesai": selesai, "proses": proses, "kendala": kendala,
                "belum": belum, "total": total, "pct": pct,
            },
            "stagnant": stg_out,
            "amaliyah": amal,
        }

    return router
