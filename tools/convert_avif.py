r"""단일 PNG→AVIF 변환 (프롬프트 메타데이터 보존)

E:\Risuwork\convert_to_avif.py 의 단일 파일 변환 버전.
piexif.helper.UserComment.dump() 로 EXIF UserComment 를 박는다.
"""

import sys
import piexif
import piexif.helper
from PIL import Image
import pillow_heif

pillow_heif.register_heif_opener()


def convert_png_to_avif(png_path, avif_path, quality=75, comment_text=None):
    with Image.open(png_path) as img:
        info = img.info

        print("[convert_avif] PNG info keys:", list(info.keys()), flush=True)
        for k, v in info.items():
            if isinstance(v, str):
                print(f"[convert_avif]   {k}: {v[:120]}...", flush=True)
            else:
                print(f"[convert_avif]   {k}: <{type(v).__name__} len={len(v) if hasattr(v, '__len__') else '?'}>", flush=True)

        exif_dict = {"0th": {}, "Exif": {}, "GPS": {}, "1st": {}, "thumbnail": None}
        if "exif" in info:
            try:
                exif_dict = piexif.load(info["exif"])
                print("[convert_avif] loaded existing EXIF", flush=True)
            except Exception:
                print("[convert_avif] failed to load existing EXIF", flush=True)

        if comment_text is not None:
            meta_str = comment_text
        elif "Comment" in info:
            meta_str = info["Comment"]
        elif "parameters" in info:
            meta_str = info["parameters"]
        else:
            meta_str = "\n".join(
                [f"{k}: {v}" for k, v in info.items() if isinstance(v, str)]
            )

        if meta_str:
            print(f"[convert_avif] meta_str length={len(meta_str)}", flush=True)
            exif_dict["Exif"][piexif.ExifIFD.UserComment] = (
                piexif.helper.UserComment.dump(meta_str, encoding="unicode")
            )
        else:
            print("[convert_avif] meta_str is EMPTY, no UserComment will be written", flush=True)

        exif_bytes = piexif.dump(exif_dict)
        img.save(
            avif_path,
            "AVIF",
            quality=quality,
            speed=8,
            exif=exif_bytes,
            icc_profile=info.get("icc_profile"),
        )
        print(f"[convert_avif] saved {avif_path}", flush=True)

    # verify
    with Image.open(avif_path) as verify:
        vinfo = verify.info
        if "exif" in vinfo:
            try:
                vdict = piexif.load(vinfo["exif"])
                uc = vdict.get("Exif", {}).get(piexif.ExifIFD.UserComment)
                if uc:
                    try:
                        text = piexif.helper.UserComment.load(uc)
                        print(f"[convert_avif] VERIFY UserComment OK: {text[:120]}...", flush=True)
                    except Exception:
                        print(f"[convert_avif] VERIFY UserComment parse failed, raw: {uc[:80]}", flush=True)
                else:
                    print("[convert_avif] VERIFY no UserComment in output EXIF", flush=True)
            except Exception as e:
                print(f"[convert_avif] VERIFY piexif.load failed: {e}", flush=True)
        else:
            print("[convert_avif] VERIFY no EXIF in output", flush=True)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python convert_avif.py <input.png> <output.avif> [quality] [comment_text]")
        sys.exit(1)

    png_path = sys.argv[1]
    avif_path = sys.argv[2]
    quality = int(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3].isdigit() else 75
    comment_text = sys.argv[4] if len(sys.argv) > 4 else None

    convert_png_to_avif(png_path, avif_path, quality, comment_text)
