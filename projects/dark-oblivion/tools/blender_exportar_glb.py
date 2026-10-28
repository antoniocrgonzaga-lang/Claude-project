# =============================================================
# blender_exportar_glb.py — leva um modelo do Blender para o jogo, sem abrir a janela do Blender.
#
# Uso (dentro da pasta do projeto, no terminal):
#   "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b "C:/caminho/Modelo.blend" ^
#       --factory-startup --python tools/blender_exportar_glb.py -- assets/models/modelo.glb
#
# O que ele faz (o .blend original NÃO é alterado — nada é salvo nele):
#   1. apaga, só na memória, o que não é malha visível (luzes, câmeras, objetos ocultos);
#   2. aplica posição/rotação/escala e junta todas as peças num objeto só;
#   3. exporta .glb com as texturas em WEBP (arquivo bem menor que PNG).
#
# Se o modelo tiver esqueleto (Armature) e animações, use o exportador do Blender direto
# (File > Export > glTF 2.0) para não perder os ossos. Este script é para modelos "estátua",
# que ganham o esqueleto dentro do jogo (autoRig em js/data/models.js, como o lobisomem).
#
# Atenção: texturas PROCEDURAIS do Blender (nós Noise, Voronoi...) não vão para o .glb.
# Ou "asse" (Bake) a textura numa imagem no Blender, ou corrija a cor no jogo com
# materialOverrides em js/data/models.js.
# =============================================================
import bpy, sys

out_glb = sys.argv[sys.argv.index('--') + 1]

for ob in list(bpy.data.objects):
    if ob.type != 'MESH' or not ob.visible_get():
        bpy.data.objects.remove(ob, do_unlink=True)

meshes = [ob for ob in bpy.context.scene.objects if ob.type == 'MESH']
if not meshes:
    raise SystemExit('Nenhuma malha visível no arquivo.')
bpy.ops.object.select_all(action='DESELECT')
for ob in meshes:
    ob.select_set(True)
bpy.context.view_layer.objects.active = max(meshes, key=lambda o: len(o.data.polygons))
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.join()

bpy.ops.export_scene.gltf(
    filepath=out_glb, export_format='GLB', use_selection=True,
    export_apply=True, export_animations=False, export_yup=True,
    export_image_format='WEBP', export_image_quality=88,
)
print(f'Pronto: {out_glb}')
