"""逐页 dump 结构，顺便试一下能不能把窗口改成 1600x900（16:9，导出 1080p 更清晰）。"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp import CDP, launch  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
EXE = os.path.join(ROOT, "src-tauri", "target", "release", "ferry-launcher.exe")
DATA = os.path.join(ROOT, "demo-profile")

DUMP = """
(() => {
  const out = [];
  const nodes = document.querySelectorAll('button, a, [role="button"], input, [data-action], h1, h2, h3');
  for (const el of nodes) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const text = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 40);
    if (!text && !el.getAttribute('data-action')) continue;
    out.push({ t: el.tagName.toLowerCase(), x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2),
               w: Math.round(r.width), h: Math.round(r.height), text });
  }
  return out;
})()
"""


def click(cdp, x, y):
    cdp.send("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y, "button": "none"})
    time.sleep(0.05)
    cdp.send("Input.dispatchMouseEvent", {"type": "mousePressed", "x": x, "y": y,
                                          "button": "left", "clickCount": 1})
    time.sleep(0.05)
    cdp.send("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": x, "y": y,
                                          "button": "left", "clickCount": 1})


def main():
    proc = launch(EXE, DATA)
    time.sleep(6)
    cdp = CDP()

    # 试试改窗口尺寸
    try:
        info = cdp.send("Browser.getWindowForTarget")
        window_id = info["windowId"]
        cdp.send("Browser.setWindowBounds", {"windowId": window_id,
                                             "bounds": {"width": 1600, "height": 941}})
        time.sleep(1.5)
        print("改窗口后视口:", cdp.js("JSON.stringify([innerWidth, innerHeight])"))
    except Exception as error:
        print("改窗口失败:", error)

    nav = [("启动", 84, 68), ("账户", 84, 110), ("下载", 84, 153), ("联机", 84, 195), ("设置", 84, 237)]
    for name, x, y in nav:
        click(cdp, x, y)
        time.sleep(1.2)
        items = cdp.js(DUMP) or []
        print(f"\n===== {name} ({len(items)} 个可点元素) =====")
        for item in items:
            print(f'{item["x"]:5d},{item["y"]:4d} {item["w"]:4d}x{item["h"]:<4d} {item["t"]:6s} {item["text"]!r}')

    cdp.close()
    proc.terminate()


if __name__ == "__main__":
    main()
