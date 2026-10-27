# =============================================================
# optimize_vrm.py — deixa um modelo do VRoid (.vrm) leve para o jogo.
#
# Uso (dentro da pasta do projeto):
#     python tools/optimize_vrm.py "C:/caminho/Witch.vrm" assets/models/witch.vrm
#     python tools/optimize_vrm.py entrada.vrm saida.vrm --max 512   (texturas menores)
#
# O que ele faz (o arquivo original NÃO é alterado):
#   1. reduz as texturas para no máximo 1024 px (na câmera isométrica a
#      personagem aparece pequena; 2048 px é desperdício);
#   2. reduz a miniatura (Thumbnail) do VRoid para 128 px;
#   3. remove as expressões faciais (blendshapes), que o jogo não usa;
#   4. reorganiza o arquivo, jogando fora os dados que sobraram.
#
# Por que: um .vrm de 18 MB demora para carregar, e alguns antivírus
# (ex.: Avast) inspecionam o tráfego do servidor local e chegam a cortar
# o download de arquivos grandes.
#
# Precisa do Pillow:  python -m pip install pillow
# =============================================================
import io
import json
import struct
import sys

from PIL import Image


def read_glb(path):
    with open(path, 'rb') as f:
        magic, version, _length = struct.unpack('<4sII', f.read(12))
        if magic != b'glTF':
            sys.exit('Isso não parece um .vrm/.glb (cabeçalho glTF não encontrado).')
        json_len, _ = struct.unpack('<I4s', f.read(8))
        doc = json.loads(f.read(json_len))
        bin_len, _ = struct.unpack('<I4s', f.read(8))
        blob = f.read(bin_len)
    return doc, blob


def write_glb(path, doc, blob):
    json_bytes = json.dumps(doc, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    json_bytes += b' ' * (-len(json_bytes) % 4)  # blocos precisam ter tamanho múltiplo de 4
    blob += b'\0' * (-len(blob) % 4)
    total = 12 + 8 + len(json_bytes) + 8 + len(blob)
    with open(path, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, total))
        f.write(struct.pack('<I4s', len(json_bytes), b'JSON'))
        f.write(json_bytes)
        f.write(struct.pack('<I4s', len(blob), b'BIN\0'))
        f.write(blob)


def shrink_image(data, mime, max_size):
    img = Image.open(io.BytesIO(data))
    if max(img.size) <= max_size:
        return data
    img.thumbnail((max_size, max_size), Image.LANCZOS)
    out = io.BytesIO()
    if mime == 'image/jpeg':
        img.convert('RGB').save(out, 'JPEG', quality=90)
    else:
        img.save(out, 'PNG', optimize=True)
    return out.getvalue()


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) != 2:
        sys.exit(__doc__ or 'Uso: python tools/optimize_vrm.py entrada.vrm saida.vrm [--max 1024]')
    max_size = 1024
    if '--max' in sys.argv:
        max_size = int(sys.argv[sys.argv.index('--max') + 1])
    src, dst = args
    doc, blob = read_glb(src)

    # ---- 1) tira as expressões faciais (morph targets) ----
    for mesh in doc.get('meshes', []):
        mesh.pop('weights', None)
        if isinstance(mesh.get('extras'), dict):
            mesh['extras'].pop('targetNames', None)
        for prim in mesh['primitives']:
            prim.pop('targets', None)
            if isinstance(prim.get('extras'), dict):
                prim['extras'].pop('targetNames', None)
    vrm = doc.get('extensions', {}).get('VRMC_vrm')
    if vrm and 'expressions' in vrm:  # as expressões apontavam para os morph targets removidos
        vrm['expressions'] = {'preset': {}, 'custom': {}}
    vrm0 = doc.get('extensions', {}).get('VRM')  # VRM 0.x
    if vrm0 and 'blendShapeMaster' in vrm0:
        vrm0['blendShapeMaster'] = {'blendShapeGroups': []}

    # ---- 2) quais accessors e bufferViews ainda são usados ----
    used_acc = set()
    for mesh in doc.get('meshes', []):
        for prim in mesh['primitives']:
            used_acc.update(prim['attributes'].values())
            if 'indices' in prim:
                used_acc.add(prim['indices'])
    for skin in doc.get('skins', []):
        if 'inverseBindMatrices' in skin:
            used_acc.add(skin['inverseBindMatrices'])
    for anim in doc.get('animations', []):
        for s in anim['samplers']:
            used_acc.update([s['input'], s['output']])

    acc_map = {old: new for new, old in enumerate(sorted(used_acc))}
    accessors = [doc['accessors'][old] for old in sorted(used_acc)]

    def remap(i):
        return acc_map[i]
    for mesh in doc.get('meshes', []):
        for prim in mesh['primitives']:
            prim['attributes'] = {k: remap(v) for k, v in prim['attributes'].items()}
            if 'indices' in prim:
                prim['indices'] = remap(prim['indices'])
    for skin in doc.get('skins', []):
        if 'inverseBindMatrices' in skin:
            skin['inverseBindMatrices'] = remap(skin['inverseBindMatrices'])
    for anim in doc.get('animations', []):
        for s in anim['samplers']:
            s['input'], s['output'] = remap(s['input']), remap(s['output'])

    used_bv = set()
    for acc in accessors:
        if 'bufferView' in acc:
            used_bv.add(acc['bufferView'])
        if 'sparse' in acc:
            used_bv.add(acc['sparse']['indices']['bufferView'])
            used_bv.add(acc['sparse']['values']['bufferView'])
    for img in doc.get('images', []):
        if 'bufferView' in img:
            used_bv.add(img['bufferView'])

    # ---- 3) texturas menores ----
    thumb = vrm.get('meta', {}).get('thumbnailImage') if vrm else None
    new_image_data = {}
    for i, img in enumerate(doc.get('images', [])):
        if 'bufferView' not in img:
            continue
        bv = doc['bufferViews'][img['bufferView']]
        start = bv.get('byteOffset', 0)
        data = blob[start:start + bv['byteLength']]
        limit = 128 if i == thumb or img.get('name') == 'Thumbnail' else max_size
        new_image_data[img['bufferView']] = shrink_image(data, img.get('mimeType', 'image/png'), limit)

    # ---- 4) monta o novo bloco binário só com o que é usado ----
    bv_map = {}
    buffer_views = []
    out = bytearray()
    for old in sorted(used_bv):
        bv = dict(doc['bufferViews'][old])
        if old in new_image_data:
            data = new_image_data[old]
        else:
            start = bv.get('byteOffset', 0)
            data = blob[start:start + bv['byteLength']]
        out += b'\0' * (-len(out) % 4)  # alinhamento de 4 bytes
        bv['byteOffset'] = len(out)
        bv['byteLength'] = len(data)
        bv['buffer'] = 0
        out += data
        bv_map[old] = len(buffer_views)
        buffer_views.append(bv)

    for acc in accessors:
        if 'bufferView' in acc:
            acc['bufferView'] = bv_map[acc['bufferView']]
        if 'sparse' in acc:
            acc['sparse']['indices']['bufferView'] = bv_map[acc['sparse']['indices']['bufferView']]
            acc['sparse']['values']['bufferView'] = bv_map[acc['sparse']['values']['bufferView']]
    for img in doc.get('images', []):
        if 'bufferView' in img:
            img['bufferView'] = bv_map[img['bufferView']]

    doc['accessors'] = accessors
    doc['bufferViews'] = buffer_views
    doc['buffers'] = [{'byteLength': len(out)}]
    write_glb(dst, doc, bytes(out))

    before = len(blob) / 1048576
    after = len(out) / 1048576
    print(f'Pronto: {dst}  ({before:.1f} MB -> {after:.1f} MB de dados)')


if __name__ == '__main__':
    main()
