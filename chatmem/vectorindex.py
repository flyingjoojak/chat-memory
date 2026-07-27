"""벡터 인덱스 = 재생성 가능한 파생물. numpy 브루트포스(정확·현 규모 최적).

vectors.npy(2D float32, L2정규화됨) + vector_ids.json(행 순서 chunk_key).
정규화 벡터라 코사인 = 내적 → 검색은 matrix @ query 한 번.
수십만 넘어가면 hnswlib로 승격(아카이브에서 재색인, 무손실).
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import numpy as np

from .config import VECTOR_IDS_PATH, VECTORS_PATH


class VectorIndex:
    def __init__(self, vectors_path: str | Path = VECTORS_PATH, ids_path: str | Path = VECTOR_IDS_PATH):
        self.vectors_path = Path(vectors_path)
        self.ids_path = Path(ids_path)
        self.ids: list[str] = []
        self.matrix: np.ndarray | None = None
        self._pos: dict[str, int] = {}
        self._load()

    def _load(self) -> None:
        if self.vectors_path.exists() and self.ids_path.exists():
            self.matrix = np.load(self.vectors_path)
            self.ids = json.loads(self.ids_path.read_text(encoding="utf-8"))
            self._pos = {k: i for i, k in enumerate(self.ids)}

    def __len__(self) -> int:
        return len(self.ids)

    def add(self, keys: list[str], matrix: np.ndarray) -> None:
        """키-벡터 추가. 이미 있는 키는 벡터를 교체(멱등 재임베딩)."""
        if len(keys) == 0:
            return
        matrix = np.asarray(matrix, dtype=np.float32)
        if self.matrix is None:
            self.matrix = np.zeros((0, matrix.shape[1]), dtype=np.float32)

        new_keys, new_rows = [], []
        for key, vec in zip(keys, matrix):
            if key in self._pos:
                self.matrix[self._pos[key]] = vec
            else:
                new_keys.append(key)
                new_rows.append(vec)
        if new_rows:
            start = self.matrix.shape[0]
            self.matrix = np.vstack([self.matrix, np.asarray(new_rows, dtype=np.float32)])
            for off, key in enumerate(new_keys):
                self._pos[key] = start + off
                self.ids.append(key)

    def search(self, query_vec: np.ndarray, k: int = 5) -> list[tuple[str, float]]:
        if self.matrix is None or self.matrix.shape[0] == 0:
            return []
        scores = self.matrix @ np.asarray(query_vec, dtype=np.float32)
        k = min(k, scores.shape[0])
        top = np.argpartition(-scores, k - 1)[:k]
        top = top[np.argsort(-scores[top])]
        return [(self.ids[i], float(scores[i])) for i in top]

    def save(self) -> None:
        """원자적 저장: temp에 쓰고 rename → kill 중에도 파일 손상 없음."""
        self.vectors_path.parent.mkdir(parents=True, exist_ok=True)
        mat = self.matrix if self.matrix is not None else np.zeros((0, 0), dtype=np.float32)

        tmp_v = self.vectors_path.with_name(self.vectors_path.name + ".tmp")
        with open(tmp_v, "wb") as f:
            np.save(f, mat)
        os.replace(tmp_v, self.vectors_path)

        tmp_i = self.ids_path.with_name(self.ids_path.name + ".tmp")
        tmp_i.write_text(json.dumps(self.ids, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp_i, self.ids_path)
