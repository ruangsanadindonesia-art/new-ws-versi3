"""Media Tim: pustaka link & file kecil per tim (SOP, template, desain, laporan, dll).

- Link (Drive, Canva, Figma, dll) adalah jalur utama; file <= 10 MB disimpan di disk VPS.
- Akses: anggota melihat media timnya + media "Lembaga" (divisi_id = None); SPV melihat semua.
- Ubah/hapus: pembuat item, kepala tim pemilik item, atau SPV. Item Lembaga hanya dibuat SPV.
- File diunduh lewat endpoint ber-autentikasi (bukan folder publik).
"""
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field

MAX_BYTES = 10 * 1024 * 1024
EKSTENSI = {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".csv", ".txt",
            ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".zip", ".mp3", ".m4a"}
KATEGORI = ["SOP & Panduan", "Template", "Desain & Brand", "Laporan", "Materi", "Lainnya"]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_media_router(srv) -> APIRouter:
    db = srv.db
    get_current_user, user_scope = srv.get_current_user, srv.user_scope
    root = Path(os.environ.get("MEDIA_DIR", str(Path(srv.ROOT_DIR).parent / "uploads" / "media")))
    root.mkdir(parents=True, exist_ok=True)
    router = APIRouter(prefix="/media", tags=["media"])

    class LinkIn(BaseModel):
        model_config = ConfigDict(extra="ignore")
        judul: str = Field(min_length=2, max_length=200)
        url: str = Field(min_length=8, max_length=2000)
        kategori: str = "Lainnya"
        catatan: str = Field(default="", max_length=1000)
        divisi_id: Optional[str] = None  # None = Lembaga (semua tim)

    class MediaUpd(BaseModel):
        model_config = ConfigDict(extra="ignore")
        judul: Optional[str] = None
        url: Optional[str] = None
        kategori: Optional[str] = None
        catatan: Optional[str] = None
        disematkan: Optional[bool] = None

    async def _target_divisi(scope: dict, divisi_id: Optional[str]) -> Optional[str]:
        if scope["is_spv"]:
            if divisi_id and not await db.divisi.find_one({"id": divisi_id}, {"_id": 1}):
                raise HTTPException(400, "Tim tidak ditemukan.")
            return divisi_id or None
        if not scope["divisi_id"]:
            raise HTTPException(403, "Akun Anda belum terhubung ke tim.")
        if divisi_id and divisi_id != scope["divisi_id"]:
            raise HTTPException(403, "Hanya bisa menambah media untuk tim Anda.")
        return scope["divisi_id"]  # anggota: selalu ke timnya; Lembaga hanya SPV

    def _boleh_lihat(scope: dict, m: dict) -> bool:
        return scope["is_spv"] or m.get("divisi_id") in (None, scope["divisi_id"])

    def _boleh_ubah(scope: dict, m: dict, user: dict) -> bool:
        return (scope["is_spv"] or m.get("dibuat_oleh_id") == user["user_id"]
                or (scope["head_divisi_id"] and m.get("divisi_id") == scope["head_divisi_id"]))

    def _kategori(k: str) -> str:
        return k if k in KATEGORI else "Lainnya"

    @router.get("")
    async def daftar(divisi_id: Optional[str] = None, q: Optional[str] = None, kategori: Optional[str] = None,
                     user: dict = Depends(get_current_user)):
        scope = await user_scope(user)
        if scope["is_spv"]:
            filt: dict = {} if not divisi_id else ({"divisi_id": None} if divisi_id == "LEMBAGA" else {"divisi_id": divisi_id})
        else:
            filt = {"divisi_id": {"$in": [None, scope["divisi_id"]]}}
        if kategori:
            filt["kategori"] = kategori
        if q:
            rx = {"$regex": re.escape(q), "$options": "i"}
            filt["$or"] = [{"judul": rx}, {"catatan": rx}, {"nama_file": rx}]
        rows = await db.media_items.find(filt, {"_id": 0, "path": 0}).sort([("disematkan", -1), ("created_at", -1)]).to_list(1000)
        for r in rows:
            r["bisa_ubah"] = _boleh_ubah(scope, r, user)
        return {"items": rows, "kategori": KATEGORI, "is_spv": scope["is_spv"], "divisi_id": scope["divisi_id"]}

    @router.post("/link")
    async def tambah_link(payload: LinkIn, user: dict = Depends(get_current_user)):
        scope = await user_scope(user)
        url = payload.url.strip()
        if not re.match(r"^https?://", url, re.I):
            raise HTTPException(400, "Link harus diawali http:// atau https://")
        doc = {"id": str(uuid.uuid4()), "tipe": "LINK", "judul": payload.judul.strip(), "url": url,
               "kategori": _kategori(payload.kategori), "catatan": payload.catatan.strip(),
               "divisi_id": await _target_divisi(scope, payload.divisi_id), "disematkan": False,
               "dibuat_oleh_id": user["user_id"], "dibuat_oleh": user.get("name"), "created_at": _now()}
        await db.media_items.insert_one(doc)
        doc.pop("_id", None)
        return doc

    @router.post("/file")
    async def unggah(file: UploadFile = File(...), judul: str = Form(""), kategori: str = Form("Lainnya"),
                     catatan: str = Form(""), divisi_id: Optional[str] = Form(None), user: dict = Depends(get_current_user)):
        scope = await user_scope(user)
        target = await _target_divisi(scope, divisi_id or None)
        nama = os.path.basename(file.filename or "file")
        ext = os.path.splitext(nama)[1].lower()
        if ext not in EKSTENSI:
            raise HTTPException(400, f"Jenis file {ext or '(tanpa ekstensi)'} tidak didukung. Simpan sebagai link Google Drive.")
        data = await file.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise HTTPException(400, "File lebih dari 10 MB. Upload ke Google Drive lalu simpan link-nya.")
        if not data:
            raise HTTPException(400, "File kosong.")
        mid = str(uuid.uuid4())
        folder = root / (target or "lembaga")
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"{mid}{ext}"
        path.write_bytes(data)
        doc = {"id": mid, "tipe": "FILE", "judul": (judul or nama).strip()[:200], "nama_file": nama, "ukuran": len(data),
               "mime": file.content_type or "application/octet-stream", "path": str(path),
               "kategori": _kategori(kategori), "catatan": catatan.strip()[:1000], "divisi_id": target, "disematkan": False,
               "dibuat_oleh_id": user["user_id"], "dibuat_oleh": user.get("name"), "created_at": _now()}
        await db.media_items.insert_one(doc)
        doc.pop("_id", None)
        doc.pop("path", None)
        return doc

    @router.get("/{mid}/unduh")
    async def unduh(mid: str, user: dict = Depends(get_current_user)):
        scope = await user_scope(user)
        m = await db.media_items.find_one({"id": mid, "tipe": "FILE"}, {"_id": 0})
        if not m or not _boleh_lihat(scope, m):
            raise HTTPException(404, "File tidak ditemukan.")
        p = Path(m["path"]).resolve()
        if root.resolve() not in p.parents or not p.exists():
            raise HTTPException(404, "File tidak ditemukan.")
        inline = (m.get("mime") or "").startswith("image/") or m.get("mime") == "application/pdf"
        return FileResponse(p, media_type=m.get("mime"), filename=m.get("nama_file"),
                            content_disposition_type="inline" if inline else "attachment")

    @router.put("/{mid}")
    async def ubah(mid: str, payload: MediaUpd, user: dict = Depends(get_current_user)):
        scope = await user_scope(user)
        m = await db.media_items.find_one({"id": mid}, {"_id": 0})
        if not m or not _boleh_lihat(scope, m):
            raise HTTPException(404, "Media tidak ditemukan.")
        if not _boleh_ubah(scope, m, user):
            raise HTTPException(403, "Hanya pembuat, kepala tim, atau SPV yang bisa mengubah.")
        upd = payload.model_dump(exclude_unset=True)
        if "kategori" in upd:
            upd["kategori"] = _kategori(upd["kategori"])
        if "url" in upd:
            if m["tipe"] != "LINK" or not re.match(r"^https?://", upd["url"] or "", re.I):
                raise HTTPException(400, "Link tidak valid.")
        upd["updated_at"] = _now()
        return await db.media_items.find_one_and_update({"id": mid}, {"$set": upd}, return_document=True, projection={"_id": 0, "path": 0})

    @router.delete("/{mid}")
    async def hapus(mid: str, user: dict = Depends(get_current_user)):
        scope = await user_scope(user)
        m = await db.media_items.find_one({"id": mid}, {"_id": 0})
        if not m or not _boleh_lihat(scope, m):
            raise HTTPException(404, "Media tidak ditemukan.")
        if not _boleh_ubah(scope, m, user):
            raise HTTPException(403, "Hanya pembuat, kepala tim, atau SPV yang bisa menghapus.")
        await db.media_items.delete_one({"id": mid})
        if m.get("path"):
            try:
                Path(m["path"]).unlink(missing_ok=True)
            except OSError:
                pass
        return {"ok": True}

    return router
