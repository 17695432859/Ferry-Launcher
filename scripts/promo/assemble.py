"""把内录素材剪成宣传片：缩放、字幕、片头片尾、配乐。

素材是 1600x900 的实机内录（30fps），正好 1.2 倍放大到 1920x1080，不用裁切。
"""
import json
import os
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
PROMO = os.path.join(ROOT, "promo")
PROMO_DIR = os.path.join(ROOT, "scripts", "promo")
FFMPEG = r"C:\tools\ffmpeg-master-latest-win64-gpl\bin\ffmpeg.exe"
FFPROBE = r"C:\tools\ffmpeg-master-latest-win64-gpl\bin\ffprobe.exe"
FONT_BOLD = "C\\:/Windows/Fonts/msyhbd.ttc"
FONT = "C\\:/Windows/Fonts/msyh.ttc"

TAKE = os.path.join(PROMO, "take.mp4")
MUSIC = os.path.join(PROMO, "music.wav")
MAIN = os.path.join(PROMO, "main.mp4")
OUTRO = os.path.join(PROMO, "outro.mp4")
JOINED = os.path.join(PROMO, "joined.mp4")
FINAL = os.path.join(PROMO, "FerryLauncher-promo.mp4")

ACCENT = "0x5B7CFF"
W, H = 1920, 1080

# (开始, 结束, 主标题, 副标题)
CAPTIONS = [
    (5.2, 14.2, "多实例并存", "版本隔离，mod、存档、日志各归各的"),
    (15.6, 22.2, "Mod 一目了然", "预览、启用、检查更新、删除，都在一个列表里"),
    (26.6, 32.6, "一个账户，多个角色", "LittleSkin 外置登录，切角色不用重新登录"),
    (33.8, 39.2, "房间码联机", "陶瓦 / EasyTier 双通道，不需要公网 IP"),
    (40.4, 51.0, "外观实时可调", "主题、强调色、模糊强度、界面缩放"),
    (52.4, 58.8, "一键装版本", "原版到 NeoForge，加载器随便挑"),
    (60.2, 65.0, "5.7 MB 单文件", "免安装，不依赖任何运行库"),
]

TITLE = "Ferry Launcher"
SUBTITLE = "轻量 · 好看的 Minecraft 启动器"


def take_offset():
    """录制时 ffmpeg 比演出脚本早启动的那一段，剪辑要剪掉。"""
    path = os.path.join(PROMO, "marks.json")
    if not os.path.exists(path):
        return 0.0
    data = json.load(open(path, encoding="utf-8"))
    return float(data.get("offset", 0.0))


def probe_duration(path):
    result = subprocess.run(
        [FFPROBE, "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", path],
        capture_output=True, text=True)
    try:
        return float(result.stdout.strip())
    except ValueError:
        return 0.0


def run(command):
    result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="ignore")
    if result.returncode != 0:
        print("命令失败:", " ".join(command)[:300])
        print(result.stderr[-2500:])
        sys.exit(1)
    return result


def make_scrims():
    """底部渐变蒙版（保证字幕可读）+ 片头整屏压暗蒙版。"""
    bottom = os.path.join(PROMO, "scrim-bottom.png")
    run([FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
         "-f", "lavfi", "-i", f"color=c=black:s={W}x320",
         "-vf", "format=rgba,geq=r=0:g=0:b=0:a='185*pow(Y/320,1.7)'",
         "-frames:v", "1", bottom])
    full = os.path.join(PROMO, "scrim-full.png")
    run([FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
         "-f", "lavfi", "-i", f"color=c=black:s={W}x{H}",
         "-vf", "format=rgba,geq=r=0:g=0:b=0:a=145",
         "-frames:v", "1", full])
    return bottom, full


def fade_expr(start, end, fade_in=0.45, fade_out=0.45):
    """drawtext 的 alpha 表达式：淡入淡出。"""
    return (f"if(lt(t,{start}),0,"
            f"if(lt(t,{start + fade_in}),(t-{start})/{fade_in},"
            f"if(lt(t,{end - fade_out}),1,"
            f"if(lt(t,{end}),({end}-t)/{fade_out},0))))")


def build_main(bottom_scrim, full_scrim):
    chain = []
    chain.append("[0:v]scale=1920:1080:flags=lanczos,setsar=1,fps=30,format=yuv420p[base]")
    chain.append("[base][1:v]overlay=0:780:eof_action=repeat[grad]")

    # 片头整屏压暗 + 标题
    chain.append("[2:v]format=rgba,fade=t=in:st=0:d=0.5:alpha=1,"
                 "fade=t=out:st=3.4:d=1.1:alpha=1[intro]")
    chain.append("[grad][intro]overlay=0:0[dim]")

    title_alpha = ("if(lt(t,0.6),0,if(lt(t,1.5),(t-0.6)/0.9,"
                   "if(lt(t,3.3),1,if(lt(t,4.3),(4.3-t)/1.0,0))))")
    sub_alpha = ("if(lt(t,0.9),0,if(lt(t,1.8),(t-0.9)/0.9,"
                 "if(lt(t,3.3),1,if(lt(t,4.3),(4.3-t)/1.0,0))))")

    previous = "dim"
    index = 0
    steps = [
        f"drawtext=fontfile='{FONT_BOLD}':text='{TITLE}':fontsize=104:fontcolor=white:"
        f"x=(w-tw)/2:y=(h/2)-120:alpha='{title_alpha}':shadowcolor=black@0.5:shadowx=0:shadowy=6",
        f"drawtext=fontfile='{FONT}':text='{SUBTITLE}':fontsize=36:fontcolor=white@0.86:"
        f"x=(w-tw)/2:y=(h/2)+10:alpha='{sub_alpha}':shadowcolor=black@0.5:shadowx=0:shadowy=4",
        # 标题下的强调色短线
        f"drawbox=x=(iw-140)/2:y=(ih/2)+72:w=140:h=4:color={ACCENT}@0.95:t=fill:"
        f"enable='between(t,1.0,4.2)'",
    ]
    for step in steps:
        name = f"t{index}"
        chain.append(f"[{previous}]{step}[{name}]")
        previous = name
        index += 1

    # 分镜字幕
    for start, end, title, sub in CAPTIONS:
        alpha = fade_expr(start, end)
        steps = [
            f"drawbox=x=120:y=920:w=6:h=70:color={ACCENT}@0.95:t=fill:enable='between(t,{start},{end})'",
            f"drawtext=fontfile='{FONT_BOLD}':text='{title}':fontsize=44:fontcolor=white:"
            f"x=156:y=916:alpha='{alpha}':shadowcolor=black@0.6:shadowx=0:shadowy=3",
            f"drawtext=fontfile='{FONT}':text='{sub}':fontsize=26:fontcolor=white@0.78:"
            f"x=158:y=972:alpha='{alpha}':shadowcolor=black@0.6:shadowx=0:shadowy=2",
        ]
        for step in steps:
            name = f"t{index}"
            chain.append(f"[{previous}]{step}[{name}]")
            previous = name
            index += 1

    chain.append(f"[{previous}]fade=t=out:st=65.3:d=0.7[out]")
    script = os.path.join(PROMO, "filter-main.txt")
    with open(script, "w", encoding="utf-8") as handle:
        handle.write(";\n".join(chain))

    offset = take_offset()
    print(f"剪掉片头空转 {offset:.2f}s")
    run([FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
         "-ss", f"{offset:.3f}", "-i", TAKE,
         "-loop", "1", "-i", bottom_scrim,
         "-loop", "1", "-i", full_scrim,
         "-filter_complex", open(script, encoding="utf-8").read(),
         "-map", "[out]", "-t", f"{66 - offset:.2f}",
         "-c:v", "libx264", "-preset", "slow", "-crf", "17",
         "-pix_fmt", "yuv420p", "-r", "30", MAIN])
    print("主片完成", MAIN)


def build_outro():
    lines = [
        ("Ferry Launcher", FONT_BOLD, 92, "white", 300, 0.9),
        ("轻量 · 好看的 Minecraft 启动器", FONT, 34, "white@0.82", 420, 0.7),
        ("单文件 5.7 MB，免安装", FONT, 30, "white@0.66", 560, 1.0),
        ("Tauri 2 + WebView2，渲染层不碰系统文件", FONT, 30, "white@0.66", 616, 1.1),
        ("LittleSkin 外置登录 · 多角色切换", FONT, 30, "white@0.66", 672, 1.2),
        ("陶瓦 / EasyTier 联机 · 房间码即开即玩", FONT, 30, "white@0.66", 728, 1.3),
        ("v0.1.0", FONT, 24, "white@0.45", 900, 1.6),
        ("https\\://github.com/17695432859/Ferry-Launcher", FONT, 30, "0x8FA6FF", 986, 1.8),
    ]
    filters = []
    for text, font, size, color, y, delay in lines:
        alpha = f"if(lt(t,{delay}),0,if(lt(t,{delay + 0.6}),(t-{delay})/0.6,1))"
        filters.append(
            f"drawtext=fontfile='{font}':text='{text}':fontsize={size}:fontcolor={color}:"
            f"x=(w-tw)/2:y={y}:alpha='{alpha}'"
        )
    graph = (f"color=c=0x0B0E14:s={W}x{H}:d=6:r=30[bg];"
             f"[bg]" + ",".join(filters) + ",format=yuv420p[out]")
    script = os.path.join(PROMO, "filter-outro.txt")
    with open(script, "w", encoding="utf-8") as handle:
        handle.write(graph)
    run([FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
         "-filter_complex", open(script, encoding="utf-8").read(), "-map", "[out]",
         "-c:v", "libx264", "-preset", "slow", "-crf", "17",
         "-pix_fmt", "yuv420p", "-r", "30", OUTRO])
    print("片尾完成", OUTRO)


def join_and_mix():
    listing = os.path.join(PROMO, "concat.txt")
    with open(listing, "w", encoding="utf-8") as handle:
        handle.write(f"file '{MAIN.replace(os.sep, '/')}'\n")
        handle.write(f"file '{OUTRO.replace(os.sep, '/')}'\n")
    run([FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
         "-f", "concat", "-safe", "0", "-i", listing,
         "-c", "copy", JOINED])
    total = probe_duration(JOINED)
    print(f"画面总长 {total:.2f}s，按这个长度生成配乐")
    subprocess.run([sys.executable, os.path.join(PROMO_DIR, "music.py"), f"{total:.2f}"],
                   check=True)
    run([FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
         "-i", JOINED, "-i", MUSIC,
         "-map", "0:v:0", "-map", "1:a:0",
         "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
         "-shortest", "-movflags", "+faststart", FINAL])
    print("成片:", FINAL)


def main():
    bottom, full = make_scrims()
    build_main(bottom, full)
    build_outro()
    join_and_mix()
    size = os.path.getsize(FINAL) / 1024 / 1024
    print(f"{FINAL}  {size:.1f} MB")


if __name__ == "__main__":
    main()
