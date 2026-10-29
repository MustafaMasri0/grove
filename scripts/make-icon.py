"""Draws the app icon (a G drawn as a git line, with commit dots at both ends)
as a 1024x1024 PNG without any imaging library.
Run: python3 scripts/make-icon.py app-icon.png"""
import math
import struct
import sys
import zlib

N = 1024
BG = (30, 36, 48)
LINE = (122, 162, 247)
DOT = (158, 206, 106)
GAP = 16  # dark ring around each dot


def inside_rounded(x, y, r=200):
    cx = min(max(x, r), N - r)
    cy = min(max(y, r), N - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def dist_seg(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


# The G: an arc open at the top right (angles counter-clockwise from 3 o'clock),
# a bar from 3 o'clock towards the centre, and a commit dot at each end.
C, R, W = 512, 290, 36
ARC_FROM = 40
bar = (C + R, C, 600, C)
top = (C + R * math.cos(math.radians(ARC_FROM)), C - R * math.sin(math.radians(ARC_FROM)))
dots = [(*top, 74, DOT), (600, C, 56, LINE)]


def colour(x, y):
    if not inside_rounded(x, y):
        return None
    c = BG
    if dist_seg(x, y, *bar) <= W:
        c = LINE
    if abs(math.hypot(x - C, y - C) - R) <= W and math.degrees(math.atan2(C - y, x - C)) % 360 >= ARC_FROM:
        c = LINE
    for dx, dy, r, col in dots:
        d = math.hypot(x - dx, y - dy)
        if d <= r + GAP:
            c = col if d <= r else BG
    return c


# 2x2 samples per pixel for smooth edges.
SUBS = [(0.25, 0.25), (0.75, 0.25), (0.25, 0.75), (0.75, 0.75)]
rows = []
for y in range(N):
    row = bytearray([0])
    for x in range(N):
        hits = [c for c in (colour(x + sx, y + sy) for sx, sy in SUBS) if c]
        n = len(hits)
        if n:
            row += bytes((*(sum(c[i] for c in hits) // n for i in range(3)), 255 * n // 4))
        else:
            row += bytes((0, 0, 0, 0))
    rows.append(bytes(row))


def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", N, N, 8, 6, 0, 0, 0))
png += chunk(b"IDAT", zlib.compress(b"".join(rows), 9)) + chunk(b"IEND", b"")
open(sys.argv[1], "wb").write(png)
