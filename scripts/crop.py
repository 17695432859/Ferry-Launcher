"""把截图裁一块并放大，方便人眼检查像素图标。

用法: py scripts/crop.py in.png out.png x y w h [scale]
只支持本仓库 shot.py 生成的 8bit RGB PNG，够用就好。
"""
import struct
import sys
import zlib
from pathlib import Path


def decode_png(path):
    data = Path(path).read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "不是 PNG"
    pos = 8
    width = height = 0
    idat = bytearray()
    while pos < len(data):
        length = struct.unpack(">I", data[pos:pos + 4])[0]
        tag = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if tag == b"IHDR":
            width, height, depth, color = struct.unpack(">IIBB", body[:10])
            assert depth == 8 and color == 2, "只支持 8bit RGB"
        elif tag == b"IDAT":
            idat += body
        elif tag == b"IEND":
            break
    raw = zlib.decompress(bytes(idat))
    stride = width * 3
    out = bytearray(stride * height)
    prev = bytearray(stride)
    offset = 0
    for y in range(height):
        ftype = raw[offset]
        offset += 1
        line = bytearray(raw[offset:offset + stride])
        offset += stride
        for i in range(stride):
            a = line[i - 3] if i >= 3 else 0
            b = prev[i]
            c = prev[i - 3] if i >= 3 else 0
            if ftype == 1:
                line[i] = (line[i] + a) & 0xFF
            elif ftype == 2:
                line[i] = (line[i] + b) & 0xFF
            elif ftype == 3:
                line[i] = (line[i] + ((a + b) >> 1)) & 0xFF
            elif ftype == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return width, height, bytes(out)


def encode_png(width, height, rgb):
    def chunk(tag, payload):
        body = tag + payload
        return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    rows = bytearray()
    stride = width * 3
    for y in range(height):
        rows.append(0)
        rows += rgb[y * stride:(y + 1) * stride]
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(bytes(rows), 6))
        + chunk(b"IEND", b"")
    )


def main():
    src, dst = sys.argv[1], sys.argv[2]
    x, y, w, h = (int(v) for v in sys.argv[3:7])
    scale = int(sys.argv[7]) if len(sys.argv) > 7 else 4
    width, height, rgb = decode_png(src)
    x = max(0, min(x, width - 1))
    y = max(0, min(y, height - 1))
    w = min(w, width - x)
    h = min(h, height - y)
    out = bytearray(w * scale * h * scale * 3)
    for row in range(h * scale):
        sy = y + row // scale
        for col in range(w * scale):
            sx = x + col // scale
            si = (sy * width + sx) * 3
            di = (row * w * scale + col) * 3
            out[di:di + 3] = rgb[si:si + 3]
    Path(dst).write_bytes(encode_png(w * scale, h * scale, bytes(out)))
    print(f"{dst} {w * scale}x{h * scale}")


if __name__ == "__main__":
    main()
