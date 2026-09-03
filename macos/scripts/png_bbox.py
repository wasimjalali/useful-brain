#!/usr/bin/env python3
"""Measure bounding boxes in a rendered PNG using only the stdlib.

Usage: png_bbox.py <file.png> [--white|--dark]
Default: bbox of all pixels with alpha > 8.
--white: bbox of pixels with luminance > 150 and alpha > 200.
--dark: bbox of pixels with luminance < 100 and alpha > 200.
Prints: x0 x1 y0 y1 w h cx cy  (pixel coords, origin top-left)
"""
import struct
import sys
import zlib


def read_png(path):
    with open(path, "rb") as f:
        data = f.read()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    pos = 8
    idat = b""
    width = height = None
    bitdepth = colortype = None
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos:pos + 4])
        ctype = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + length]
        if ctype == b"IHDR":
            width, height, bitdepth, colortype = struct.unpack(">IIBB", chunk[:10])
        elif ctype == b"IDAT":
            idat += chunk
        pos += 12 + length
    assert bitdepth == 8 and colortype == 6, f"expected 8-bit RGBA, got {bitdepth}/{colortype}"
    raw = zlib.decompress(idat)
    stride = width * 4
    px = bytearray(width * height * 4)
    prev = bytearray(stride)
    pos = 0
    for y in range(height):
        ftype = raw[pos]
        pos += 1
        line = bytearray(raw[pos:pos + stride])
        pos += stride
        if ftype == 1:  # Sub
            for i in range(4, stride):
                line[i] = (line[i] + line[i - 4]) & 0xFF
        elif ftype == 2:  # Up
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ftype == 3:  # Average
            for i in range(stride):
                a = line[i - 4] if i >= 4 else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif ftype == 4:  # Paeth
            for i in range(stride):
                a = line[i - 4] if i >= 4 else 0
                b = prev[i]
                c = prev[i - 4] if i >= 4 else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        px[y * stride:(y + 1) * stride] = line
        prev = line
    return width, height, px


def bbox(width, height, px, mode):
    x0 = y0 = 10**9
    x1 = y1 = -1
    for y in range(height):
        base = y * width * 4
        for x in range(width):
            o = base + x * 4
            r, g, b, a = px[o], px[o + 1], px[o + 2], px[o + 3]
            lum = (r + g + b) / 3
            if mode == "white" and not (a > 200 and lum > 150):
                continue
            if mode == "dark" and not (a > 200 and lum < 100):
                continue
            if mode == "alpha" and a <= 8:
                continue
            if x < x0:
                x0 = x
            if x > x1:
                x1 = x
            if y < y0:
                y0 = y
            if y > y1:
                y1 = y
    if x1 < x0:
        print("EMPTY")
        return
    print(f"{x0} {x1} {y0} {y1} {x1 - x0 + 1} {y1 - y0 + 1} {(x0 + x1) / 2:.1f} {(y0 + y1) / 2:.1f}")


if __name__ == "__main__":
    path = sys.argv[1]
    mode = "dark" if "--dark" in sys.argv else ("white" if "--white" in sys.argv else "alpha")
    w, h, px = read_png(path)
    bbox(w, h, px, mode)
