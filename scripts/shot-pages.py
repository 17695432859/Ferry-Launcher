"""启动 Ferry Launcher，逐页截图（JPEG，体积小），输出到 landing/assets。

用法: python scripts/shot-pages.py

- 用 demo-profile 作为数据目录，不动真实数据
- 下载页会等「找到 N 个结果」出现再截，避免拍到搜索中
- 设置页会点一次「自动搜索 Java」并滚动到 Java 区块，展示来源标签
"""
import base64
import os
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts", "promo"))
from cdp import CDP, launch  # noqa: E402

EXE = os.path.join(ROOT, "dist", "FerryLauncher-0.1.4.exe")
DATA = os.path.join(ROOT, "demo-profile")
OUT = os.path.join(ROOT, "landing", "assets")
QUALITY = 88

# name, route, 静置秒数, 路由内要点的标签, 额外动作
PAGES = [
    ("home", "#/", 2.5, None, None),
    ("accounts", "#/accounts", 3.5, None, None),
    ("download", "#/downloads", 2.5, "Mod / 资源", "wait_download"),
    ("multiplayer", "#/multiplayer", 2.5, None, None),
    ("settings", "#/settings", 2.0, None, "scan_java"),
]


def evaluate(cdp, expr):
    res = cdp.send("Runtime.evaluate", {"expression": expr, "returnByValue": True})
    return (res.get("result") or {}).get("value")


def click_tab(cdp):
    expr = (
        "(()=>{const b=[...document.querySelectorAll('button')]"
        ".find(x=>/Mod\\s*\\/\\s*资源/.test(x.textContent||''));"
        "if(b){b.click();return b.textContent.trim()}return null})()"
    )
    return evaluate(cdp, expr)


def wait_for(cdp, expr, timeout, label):
    for i in range(timeout):
        time.sleep(1)
        if evaluate(cdp, expr):
            print(f" [{label} {i + 1}s]", end="")
            return True
    print(f" [{label} 超时]", end="")
    return False


def run_action(cdp, action):
    if action == "wait_download":
        wait_for(
            cdp,
            "(()=>{const t=document.body.innerText;"
            "return /找到\\s*\\d+\\s*个结果/.test(t)||/下载并安装/.test(t)})()",
            30,
            "list",
        )
        time.sleep(2.5)

    elif action == "scan_java":
        # 点「自动搜索 Java」
        print(" scan=" + str(evaluate(
            cdp,
            "(()=>{const b=[...document.querySelectorAll('button')]"
            ".find(x=>/自动搜索\\s*Java/.test(x.textContent||''));"
            "if(b){b.click();return 'clicked'}return 'no-btn'})()",
        )), end="")
        # 等列表里出现来源标签（注册表 / 系统目录 / 启动器自带 …）
        wait_for(
            cdp,
            "(()=>{const t=document.body.innerText;"
            "return /(JAVA_HOME|注册表|系统目录|系统 PATH|MC 运行时|启动器自带)/.test(t)})()",
            35,
            "java",
        )
        time.sleep(1.5)
        # 滚动到 Java 区块
        evaluate(
            cdp,
            "(()=>{const s=[...document.querySelectorAll('section')]"
            ".find(x=>/Java 运行环境/.test(x.textContent||''));"
            "if(s){s.scrollIntoView({block:'center'});return 'scrolled'}return 'no-section'})()",
        )
        time.sleep(1.5)


def main():
    os.makedirs(OUT, exist_ok=True)
    proc = launch(EXE, DATA)
    print("启动中…")
    time.sleep(7)
    cdp = CDP()

    info = cdp.send("Browser.getWindowForTarget")
    cdp.send("Browser.setWindowBounds", {
        "windowId": info["windowId"],
        "bounds": {"width": 1280, "height": 820},
    })
    time.sleep(1.5)

    for name, route, wait, tab, action in PAGES:
        expr = (
            "(()=>{const a=document.querySelector('a[href=\"%s\"]');"
            "if(a){a.click();return 'ok'}return 'not-found'})()" % route
        )
        res = evaluate(cdp, expr)
        print(f"{name:12s} nav={res}", end="")
        if tab:
            time.sleep(1.5)
            print(f" tab={click_tab(cdp)}", end="")
        time.sleep(wait)
        if action:
            run_action(cdp, action)

        shot = cdp.send("Page.captureScreenshot", {
            "format": "jpeg", "quality": QUALITY,
            "fromSurface": True, "optimizeForSpeed": True,
        })
        path = os.path.join(OUT, name + ".jpg")
        with open(path, "wb") as fh:
            fh.write(base64.b64decode(shot["data"]))
        print(f" -> {os.path.getsize(path)//1024} KB")

    print("完成，关闭应用")
    try:
        proc.kill()
    except Exception:
        pass


if __name__ == "__main__":
    main()
