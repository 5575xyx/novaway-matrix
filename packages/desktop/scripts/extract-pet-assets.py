from collections import Counter, deque
from pathlib import Path
import argparse

from PIL import Image


def color_distance(left, right):
    return max(abs(left[index] - right[index]) for index in range(3))


def background_colors(image):
    width, height = image.size
    pixels = image.load()
    border = []
    for x in range(width):
        border.extend((pixels[x, 0][:3], pixels[x, height - 1][:3]))
    for y in range(1, height - 1):
        border.extend((pixels[0, y][:3], pixels[width - 1, y][:3]))
    return [color for color, _ in Counter(border).most_common(8)]


def extract(source, target, tolerance):
    image = Image.open(source).convert("RGBA")
    width, height = image.size
    pixels = image.load()
    palette = background_colors(image)

    def is_background(x, y):
        color = pixels[x, y][:3]
        return any(color_distance(color, candidate) <= tolerance for candidate in palette)

    visited = bytearray(width * height)
    queue = deque()

    def enqueue(x, y):
        offset = y * width + x
        if visited[offset] or not is_background(x, y):
            return
        visited[offset] = 1
        queue.append((x, y))

    for x in range(width):
        enqueue(x, 0)
        enqueue(x, height - 1)
    for y in range(1, height - 1):
        enqueue(0, y)
        enqueue(width - 1, y)

    while queue:
        x, y = queue.popleft()
        for next_x, next_y in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= next_x < width and 0 <= next_y < height:
                enqueue(next_x, next_y)

    for y in range(height):
        for x in range(width):
            if visited[y * width + x]:
                pixels[x, y] = (0, 0, 0, 0)

    target.parent.mkdir(parents=True, exist_ok=True)
    image.save(target)


parser = argparse.ArgumentParser()
parser.add_argument("source", type=Path)
parser.add_argument("target", type=Path)
parser.add_argument("--tolerance", type=int, default=4)
args = parser.parse_args()
extract(args.source, args.target, args.tolerance)
