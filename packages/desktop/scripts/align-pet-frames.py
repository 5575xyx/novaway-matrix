from collections import deque
from pathlib import Path
import argparse

from PIL import Image


def foreground_bounds(image):
    alpha = image.getchannel("A")
    width, height = alpha.size
    pixels = alpha.load()
    visited = bytearray(width * height)
    largest = None

    for y in range(height):
        for x in range(width):
            index = y * width + x
            if visited[index] or pixels[x, y] < 128:
                continue

            visited[index] = 1
            queue = deque([(x, y)])
            count = 0
            left = right = x
            top = bottom = y
            while queue:
                current_x, current_y = queue.popleft()
                count += 1
                left = min(left, current_x)
                right = max(right, current_x)
                top = min(top, current_y)
                bottom = max(bottom, current_y)
                for next_x, next_y in (
                    (current_x - 1, current_y),
                    (current_x + 1, current_y),
                    (current_x, current_y - 1),
                    (current_x, current_y + 1),
                ):
                    if not (0 <= next_x < width and 0 <= next_y < height):
                        continue
                    next_index = next_y * width + next_x
                    if visited[next_index] or pixels[next_x, next_y] < 128:
                        continue
                    visited[next_index] = 1
                    queue.append((next_x, next_y))

            candidate = (count, (left, top, right + 1, bottom + 1))
            if largest is None or candidate[0] > largest[0]:
                largest = candidate

    if largest is None:
        raise ValueError("找不到宠物主体")
    return largest[1]


def align_frame(path, baseline):
    image = Image.open(path).convert("RGBA")
    _, _, _, bottom = foreground_bounds(image)
    offset_y = baseline - bottom
    if offset_y == 0:
        return
    aligned = Image.new("RGBA", image.size)
    aligned.alpha_composite(image, (0, offset_y))
    aligned.save(path)


parser = argparse.ArgumentParser()
parser.add_argument("directories", type=Path, nargs="+")
parser.add_argument("--baseline", type=int, default=1168)
args = parser.parse_args()

for directory in args.directories:
    for frame in sorted(directory.glob("*.png"), key=lambda path: int(path.stem)):
        align_frame(frame, args.baseline)
