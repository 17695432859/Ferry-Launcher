"""从 msys2 镜像拉取最小 mingw-w64 gcc 工具链（供 windows-gnu 目标链接使用）。

只做一件事：解析包索引 → 递归解析依赖 → 下载 → 解压到 %USERPROFILE%/.mingw64。
"""
import os
import re
import subprocess
import sys
import tarfile
import urllib.request
from pathlib import Path

MIRROR = "https://mirror.nju.edu.cn/msys2/mingw/mingw64"
ROOT = Path(os.environ["USERPROFILE"]) / ".mingw64"
CACHE = ROOT / "_pkg"
SEVENZ = r"C:\Program Files\7-Zip\7z.exe"


def read_db() -> dict:
    db = CACHE / "db.tar"
    if not db.exists():
        zst = CACHE / "db.tar.zst"
        CACHE.mkdir(parents=True, exist_ok=True)
        if not zst.exists():
            urllib.request.urlretrieve(f"{MIRROR}/mingw64.db.tar.zst", zst)
        subprocess.run([SEVENZ, "x", "-y", f"-o{CACHE}", str(zst)], check=True,
                       stdout=subprocess.DEVNULL)
    index = {}
    with tarfile.open(db) as tf:
        for member in tf.getmembers():
            if member.name.endswith("/desc"):
                raw = tf.extractfile(member).read().decode("utf-8", "replace")
                fields = {}
                key = None
                for line in raw.splitlines():
                    if line.startswith("%") and line.endswith("%"):
                        key = line.strip("%")
                        fields[key] = []
                    elif key and line.strip():
                        fields[key].append(line.strip())
                name = fields.get("NAME", [""])[0]
                if name:
                    index[name] = {
                        "file": fields.get("FILENAME", [""])[0],
                        "deps": fields.get("DEPENDS", []),
                    }
    return index


def resolve(index: dict, root: str) -> list:
    order, seen = [], set()

    def walk(name: str):
        if name in seen or name not in index:
            return
        seen.add(name)
        for dep in index[name]["deps"]:
            walk(re.split(r"[<>=]", dep)[0])
        order.append(name)

    walk(root)
    return order


def fetch(index: dict, name: str):
    entry = index[name]
    zst = CACHE / entry["file"]
    if not zst.exists():
        print(f"  下载 {entry['file']}")
        urllib.request.urlretrieve(f"{MIRROR}/{entry['file']}", zst)
    tar_path = zst.with_suffix("")  # xxx.pkg.tar.zst -> xxx.pkg.tar
    if not tar_path.exists():
        subprocess.run([SEVENZ, "x", "-y", f"-o{CACHE}", str(zst)], check=True,
                       stdout=subprocess.DEVNULL)
    with tarfile.open(tar_path) as tf:
        tf.extractall(ROOT)
    tar_path.unlink(missing_ok=True)


def main():
    index = read_db()
    for pkg in resolve(index, "mingw-w64-x86_64-gcc"):
        print(f"[{pkg}]")
        fetch(index, pkg)
    bin_dir = ROOT / "mingw64" / "bin"
    print(f"\n完成: {bin_dir}")
    print(f"gcc: {(bin_dir / 'gcc.exe').exists()}  dlltool: {(bin_dir / 'dlltool.exe').exists()}")


if __name__ == "__main__":
    sys.exit(main())
