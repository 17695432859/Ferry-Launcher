"""先摸清界面结构：把导航项和主要按钮的文本、坐标打出来。"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp import CDP, launch  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
EXE = os.path.join(ROOT, "src-tauri", "target", "release", "ferry-launcher.exe")
DATA = os.path.join(ROOT, "demo-profile")

PROBE = """
(() => {
  const out = [];
  const nodes = document.querySelectorAll('button, a, [role="button"], input, [data-action]');
  for (const el of nodes) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const text = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 28);
    out.push({
      tag: el.tagName.toLowerCase(),
      text,
      action: el.getAttribute('data-action'),
      x: Math.round(r.left + r.width / 2),
      y: Math.round(r.top + r.height / 2),
      w: Math.round(r.width),
      h: Math.round(r.height)
    });
  }
  return { size: [innerWidth, innerHeight], items: out };
})()
"""


def main():
    proc = launch(EXE, DATA)
    time.sleep(6)
    cdp = CDP()
    print("视口", cdp.js("JSON.stringify([innerWidth, innerHeight])"))
    data = cdp.js(PROBE)
    print("视口", data["size"])
    for item in data["items"]:
        print(f'{item["x"]:5d},{item["y"]:4d}  {item["w"]:4d}x{item["h"]:<4d} {item["tag"]:6s} '
              f'[{item["action"]}] {item["text"]!r}')
    cdp.close()
    proc.terminate()


if __name__ == "__main__":
    main()
