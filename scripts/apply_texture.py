"""
Apply a texture image to a GLB's baseColor and export a new GLB.

Usage:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python \
    scripts/apply_texture.py -- <input.glb> <texture.png|jpg> <output.glb>
"""
import bpy
import os
import sys


def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    if len(argv) != 3:
        print("Usage: -- <input.glb> <texture> <output.glb>")
        sys.exit(1)
    return argv[0], argv[1], argv[2]


def main():
    in_glb, tex_path, out_glb = parse_args()

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=in_glb)

    img = bpy.data.images.load(tex_path, check_existing=False)
    img.pack()

    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        print("[ERR] no mesh in GLB")
        sys.exit(1)

    # Build a single material with the image on Principled baseColor
    mat = bpy.data.materials.new(name="AppliedTexture")
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out_node = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(bsdf.outputs["BSDF"], out_node.inputs["Surface"])

    for obj in meshes:
        obj.data.materials.clear()
        obj.data.materials.append(mat)

    bpy.ops.export_scene.gltf(
        filepath=out_glb,
        export_format="GLB",
        export_image_format="AUTO",
    )
    print(f"[OK] wrote {out_glb}")


main()
