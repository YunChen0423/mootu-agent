"""Export MuJoCo's compiled, exact mesh buffers into a compact web archive."""

from __future__ import annotations

import gzip
from pathlib import Path
import re
import struct

import mujoco
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent / "mootu" / "interaction_demo.xml"
OUTPUT = ROOT / "public" / "mujoco" / "visuals-exact-v4.bin.gz"
XML_OUTPUT = ROOT / "public" / "mujoco" / "exact-physics-model.xml"


def expand_xml(path: Path) -> str:
    text = path.read_text(encoding="utf-8")

    def include(match: re.Match[str]) -> str:
        included = expand_xml(SOURCE.parent / match.group(1))
        included = re.sub(r"^\s*<mujocoinclude>\s*", "", included)
        included = re.sub(r"\s*</mujocoinclude>\s*$", "", included)
        return included

    return re.sub(r'<include\s+file="([^"]+)"\s*/>', include, text)


model = mujoco.MjModel.from_xml_path(str(SOURCE))
parts: list[bytes] = [struct.pack("<I", model.nmesh)]

for mesh_id in range(model.nmesh):
    name = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_MESH, mesh_id).encode("utf-8")
    geom_ids = np.flatnonzero(
        (model.geom_type == mujoco.mjtGeom.mjGEOM_MESH)
        & (model.geom_dataid == mesh_id)
    )
    if len(geom_ids) != 1:
        raise RuntimeError(f"Expected one visual geom for mesh {name!r}, found {len(geom_ids)}")
    geom_id = int(geom_ids[0])
    body_id = int(model.geom_bodyid[geom_id])
    body_name = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_BODY, body_id).encode("utf-8")
    # MuJoCo recenters and rotates imported OBJ data during compilation.  The
    # compensating transform is folded into geom_pos/geom_quat, so exporting it
    # is required to reproduce the native viewer assembly exactly.
    local_position = np.asarray(model.geom_pos[geom_id], dtype="<f4")
    local_quaternion = np.asarray(model.geom_quat[geom_id], dtype="<f4")
    vert_start = int(model.mesh_vertadr[mesh_id])
    vert_count = int(model.mesh_vertnum[mesh_id])
    face_start = int(model.mesh_faceadr[mesh_id])
    face_count = int(model.mesh_facenum[mesh_id])
    source_vertices = np.asarray(model.mesh_vert[vert_start : vert_start + vert_count], dtype=np.float32)
    source_faces = np.asarray(model.mesh_face[face_start : face_start + face_count], dtype=np.int32)
    lower = source_vertices.min(axis=0).astype("<f4")
    upper = source_vertices.max(axis=0).astype("<f4")
    span = np.maximum(upper - lower, np.float32(1e-12))
    vertices = np.rint((source_vertices - lower) / span * 65535.0).astype("<u2").tobytes()
    index_width = 2 if vert_count <= 65535 else 4
    index_dtype = "<u2" if index_width == 2 else "<u4"
    faces = np.asarray(source_faces, dtype=index_dtype).tobytes()
    parts.extend((
        struct.pack("<HHIIB", len(name), len(body_name), vert_count, face_count, index_width),
        name,
        body_name,
        local_position.tobytes(),
        local_quaternion.tobytes(),
        lower.tobytes(),
        upper.tobytes(),
        vertices,
        faces,
    ))

raw = b"".join(parts)
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
with gzip.open(OUTPUT, "wb", compresslevel=9) as stream:
    stream.write(raw)

xml = expand_xml(SOURCE)
xml = re.sub(r"\s*<asset>.*?</asset>", "", xml, flags=re.DOTALL)
xml = re.sub(r"\s*<geom\b[^>]*\btype=\"mesh\"[^>]*/>", "", xml, flags=re.DOTALL)
XML_OUTPUT.write_text(xml, encoding="utf-8")

print(f"Packed {model.nmesh} full-topology meshes: {len(raw) / 1048576:.1f} MB -> {OUTPUT.stat().st_size / 1048576:.1f} MB")
