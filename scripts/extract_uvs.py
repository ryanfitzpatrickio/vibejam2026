"""
Extract UV layouts from GLB files to PNG using Blender + PIL.
Works in --background mode (no GPU needed).

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/extract_uvs.py
"""
import bpy
import os
import subprocess
import sys

GLB_FILES = [
    "/Users/personal/source/vibejam2026/assets/source/whitecat.glb",
    "/Users/personal/source/vibejam2026/assets/source/blackcat.glb",
]
OUTPUT_DIR = "/Users/personal/source/vibejam2026/assets/source"
UV_SIZE = 4096

# Ensure Pillow is available inside Blender's Python
_user_site = os.path.expanduser("~/.local/lib/python3.11/site-packages")
if os.path.isdir(_user_site) and _user_site not in sys.path:
    sys.path.append(_user_site)
try:
    from PIL import Image, ImageDraw
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "--user", "Pillow"])
    from PIL import Image, ImageDraw


def export_uv(glb_path, out_path, size=UV_SIZE):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb_path)

    img = Image.new("RGBA", (size, size), (0, 0, 0, 255))
    draw = ImageDraw.Draw(img)

    mesh_count = 0
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        mesh = obj.data
        if not mesh.uv_layers:
            continue
        mesh_count += 1
        uv_layer = mesh.uv_layers.active.data

        for poly in mesh.polygons:
            pts = []
            for li in poly.loop_indices:
                u, v = uv_layer[li].uv
                x = u * size
                y = (1.0 - v) * size
                pts.append((x, y))
            if len(pts) >= 3:
                draw.polygon(pts, fill=(255, 255, 255, 255))

    img.save(out_path)
    print(f"[OK] {mesh_count} mesh(es) -> {out_path}")


for glb in GLB_FILES:
    base = os.path.splitext(os.path.basename(glb))[0]
    out = os.path.join(OUTPUT_DIR, f"{base}_uv.png")
    export_uv(glb, out)

print("Done.")
