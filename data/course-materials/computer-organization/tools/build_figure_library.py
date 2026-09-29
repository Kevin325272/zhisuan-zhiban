from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
from collections import defaultdict
from pathlib import Path
from typing import Any

from PIL import Image, ImageStat


FIGURE_PATTERN = re.compile(r"图\s*(\d{1,2})\s*[.．]\s*(\d{1,3})")
DISPLAYABLE_CONFIDENCE = 0.92
SEMANTIC_MATCH_THRESHOLD = 0.92
DEFAULT_RENDER_DPI = 200
SOURCE_PDF = Path(
    r"C:\Users\Administrator\Desktop\挑战杯\课程资料\计算机组成原理"
    r"\计算机组成原理第3版 唐朔飞.pdf"
)
TEXTBOOK = {
    "textbook_title": "计算机组成原理",
    "author_name": "唐朔飞",
    "edition": "第3版",
    "publisher": "高等教育出版社",
    "publication_year": 2020,
    "isbn": "978-7-04-054518-0",
}


def figure_sort_key(label: str) -> tuple[int, int]:
    match = FIGURE_PATTERN.fullmatch(label)
    if not match:
        raise ValueError(f"Invalid figure label: {label}")
    return int(match.group(1)), int(match.group(2))


def validate_catalog(catalog: list[dict[str, Any]]) -> None:
    labels: set[str] = set()
    required = {
        "catalog_id",
        "figure_label",
        "caption",
        "chapter",
        "print_page",
        "pdf_physical_page",
        "source_pdf_sha256",
        "tags",
        "extraction_status",
        "extraction_confidence",
        "verification_status",
        "usage_scope",
        "license_status",
    }
    for item in catalog:
        missing = required - item.keys()
        if missing:
            raise ValueError(f"Missing catalog fields: {sorted(missing)}")
        label = item["figure_label"]
        figure_sort_key(label)
        if label in labels:
            raise ValueError(f"Duplicate figure label: {label}")
        labels.add(label)
        if not item["tags"]:
            raise ValueError(f"Figure {label} tags must not be empty")
        if len(item["source_pdf_sha256"]) != 64:
            raise ValueError(f"Figure {label} source hash is invalid")
        confidence = item["extraction_confidence"]
        if not isinstance(confidence, (int, float)) or not 0 <= confidence <= 1:
            raise ValueError(f"Figure {label} extraction confidence is invalid")
        if item["pdf_physical_page"] != item["print_page"] + 7:
            raise ValueError(f"Figure {label} page mapping is inconsistent")
        if item["extraction_status"] == "displayable" and not item.get("crop_box_pixels"):
            raise ValueError(f"Figure {label} displayable asset needs a crop box")


def merge_displayable_assets(
    existing: list[dict[str, Any]],
    generated: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    merged = {item["figure_label"]: item for item in generated}
    for item in existing:
        if item.get("verification_status") == "human_verified":
            merged[item["figure_label"]] = item
    return sorted(merged.values(), key=lambda item: figure_sort_key(item["figure_label"]))


def deduplicate_asset_records(
    assets: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], set[str]]:
    ordered = sorted(
        assets,
        key=lambda item: (
            item.get("verification_status") != "human_verified",
            -float(item.get("extraction_confidence", 0)),
            figure_sort_key(item["figure_label"]),
        ),
    )
    kept: list[dict[str, Any]] = []
    seen_hashes: set[str] = set()
    rejected: set[str] = set()
    for asset in ordered:
        asset_hash = asset["sha256"]
        if asset_hash in seen_hashes:
            rejected.add(asset["figure_label"])
            continue
        seen_hashes.add(asset_hash)
        kept.append(asset)
    return (
        sorted(kept, key=lambda item: figure_sort_key(item["figure_label"])),
        rejected,
    )


def normalize_chunk_id(chunk_id: str) -> str:
    return chunk_id if chunk_id.startswith("co_chunk_") else f"co_chunk_{chunk_id}"


def direct_labels(text: str) -> list[str]:
    seen: set[str] = set()
    labels: list[str] = []
    for match in FIGURE_PATTERN.finditer(text):
        label = f"图{int(match.group(1))}.{int(match.group(2))}"
        if label not in seen:
            seen.add(label)
            labels.append(label)
    return labels


def normalize_ocr_text(text: str) -> str:
    return re.sub(r"\s+", "", text).replace("．", ".")


def select_caption_line(
    figure_label: str,
    lines: list[dict[str, Any]],
) -> dict[str, Any] | None:
    expected = normalize_ocr_text(figure_label)
    matches: list[dict[str, Any]] = []
    for line in lines:
        normalized = normalize_ocr_text(line.get("text", ""))
        if not normalized.startswith(expected) or normalized == expected:
            continue
        words = line.get("words") or []
        if not words:
            continue
        left = min(float(word["x"]) for word in words)
        top = min(float(word["y"]) for word in words)
        right = max(float(word["x"]) + float(word["width"]) for word in words)
        bottom = max(float(word["y"]) + float(word["height"]) for word in words)
        matches.append({
            "text": line["text"],
            "x": round(left),
            "y": round(top),
            "width": round(right - left),
            "height": round(bottom - top),
        })
    if not matches:
        return None
    return min(matches, key=lambda item: item["y"])


def compute_crop_box(
    image: Image.Image,
    *,
    caption_rect: dict[str, int],
    lower_bound: int,
    upper_bound: int,
    render_dpi: int,
) -> dict[str, int]:
    grayscale = image.convert("L")
    page_width, page_height = grayscale.size
    top = max(0, min(lower_bound, page_height - 1))
    bottom = max(top + 1, min(upper_bound, page_height))
    region = grayscale.crop((0, top, page_width, bottom))
    ink = region.point(lambda pixel: 255 if pixel < 245 else 0)
    bounds = ink.getbbox()
    if bounds is None:
        raise ValueError("Crop region contains no visible figure ink")

    scale = render_dpi / 200
    margin_x = max(12, round(18 * scale))
    margin_y = max(10, round(12 * scale))
    left = max(0, bounds[0] - margin_x)
    crop_top = max(top, top + bounds[1] - margin_y)
    right = min(page_width, bounds[2] + margin_x)
    crop_bottom = min(page_height, top + bounds[3] + margin_y)

    caption_right = caption_rect["x"] + caption_rect["width"]
    caption_bottom = caption_rect["y"] + caption_rect["height"]
    left = min(left, max(0, caption_rect["x"] - margin_x))
    right = max(right, min(page_width, caption_right + margin_x))
    crop_bottom = max(crop_bottom, min(page_height, caption_bottom + margin_y))
    if right - left < 120 or crop_bottom - crop_top < 80:
        raise ValueError("Crop region is too small to be a teaching figure")
    return {
        "render_dpi": render_dpi,
        "x": int(left),
        "y": int(crop_top),
        "width": int(right - left),
        "height": int(crop_bottom - crop_top),
    }


def assign_concept_figures(
    curriculum: dict[str, Any],
    knowledge_by_chunk: dict[str, dict[str, Any]],
    assets: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    displayable = {
        asset["figure_label"]: asset
        for asset in assets
        if asset.get("extraction_status") == "displayable"
        and asset.get("extraction_confidence", 0) >= DISPLAYABLE_CONFIDENCE
    }
    links: list[dict[str, Any]] = []
    for chapter in curriculum["chapters"]:
        for module in chapter["modules"]:
            for concept in module["concepts"]:
                labels: list[tuple[str, str]] = []
                source_ids: list[str] = []
                for source in concept["sources"]:
                    chunk_id = normalize_chunk_id(source["chunk_id"])
                    source_ids.append(chunk_id)
                    chunk = knowledge_by_chunk.get(chunk_id)
                    if not chunk:
                        continue
                    labels.extend((label, chunk_id) for label in direct_labels(chunk["text"]))
                accepted: list[tuple[dict[str, Any], str]] = []
                seen: set[str] = set()
                for label, chunk_id in labels:
                    asset = displayable.get(label)
                    if asset and label not in seen:
                        seen.add(label)
                        accepted.append((asset, chunk_id))
                match_method = "direct_reference"
                match_confidence = 1.0
                if not accepted:
                    semantic: list[tuple[float, dict[str, Any]]] = []
                    terms = [
                        term
                        for term in concept.get("key_terms", [])
                        if len(normalize_ocr_text(term)) >= 2
                    ]
                    title = normalize_ocr_text(concept.get("title", ""))
                    for asset in displayable.values():
                        if asset.get("chapter") != chapter["source_chapter"]:
                            continue
                        caption = normalize_ocr_text(asset.get("caption", ""))
                        matched_terms = [
                            term for term in terms
                            if normalize_ocr_text(term) in caption
                        ]
                        title_overlap = bool(title and (title in caption or caption in title))
                        score = min(
                            0.97,
                            0.8 + 0.07 * len(matched_terms) + (0.08 if title_overlap else 0),
                        )
                        if score >= SEMANTIC_MATCH_THRESHOLD:
                            semantic.append((score, asset))
                    semantic.sort(
                        key=lambda item: (
                            -item[0],
                            figure_sort_key(item[1]["figure_label"]),
                        )
                    )
                    if semantic:
                        match_method = "semantic_candidate"
                        match_confidence = semantic[0][0]
                        accepted = [(semantic[0][1], source_ids[0] if source_ids else "")]
                for ordinal, (asset, chunk_id) in enumerate(accepted):
                    links.append({
                        "link_id": f"co_link_{concept['concept_id']}_{asset['figure_label'][1:].replace('.', '_')}",
                        "concept_id": concept["concept_id"],
                        "asset_id": asset["asset_id"],
                        "figure_label": asset["figure_label"],
                        "display_role": "primary" if ordinal == 0 else "related",
                        "match_method": match_method,
                        "match_confidence": match_confidence,
                        "source_chunk_ids": [chunk_id],
                        "evidence_text": (
                            f"{chunk_id} directly references {asset['figure_label']}"
                            if match_method == "direct_reference"
                            else f"same chapter and high-threshold term match for {asset['figure_label']}"
                        ),
                        "display_enabled": True,
                        "ordinal": ordinal,
                    })
    return links


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def line_bounds(line: dict[str, Any]) -> dict[str, int] | None:
    words = line.get("words") or []
    if not words:
        return None
    left = min(float(word["x"]) for word in words)
    top = min(float(word["y"]) for word in words)
    right = max(float(word["x"]) + float(word["width"]) for word in words)
    bottom = max(float(word["y"]) + float(word["height"]) for word in words)
    return {
        "x": round(left),
        "y": round(top),
        "width": max(1, round(right - left)),
        "height": max(1, round(bottom - top)),
    }


def chapter_number(chapter: str) -> int | None:
    match = re.match(r"\s*(\d{1,2})\b", chapter)
    return int(match.group(1)) if match else None


def occurrence_context(text: str, start: int, end: int) -> str:
    return re.sub(r"\s+", " ", text[max(0, start - 60):min(len(text), end + 100)]).strip()


def derive_figure_mentions(
    knowledge: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    mentions: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in knowledge:
        row_chapter = chapter_number(str(row.get("chapter", "")))
        for match in FIGURE_PATTERN.finditer(str(row.get("text", ""))):
            label = f"图{int(match.group(1))}.{int(match.group(2))}"
            if row_chapter != int(match.group(1)):
                continue
            mentions[label].append({
                "source_item_id": str(row["id"]),
                "chunk_id": normalize_chunk_id(str(row["id"])),
                "chapter": row["chapter"],
                "print_page": int(row["page"]),
                "context": occurrence_context(row["text"], match.start(), match.end()),
                "ordinal": len(mentions[label]),
            })
    return dict(sorted(mentions.items(), key=lambda item: figure_sort_key(item[0])))


def render_candidate_pages(
    pdf_path: Path,
    physical_pages: set[int],
    image_dir: Path,
    poppler_path: Path,
    render_dpi: int,
) -> dict[int, Path]:
    image_dir.mkdir(parents=True, exist_ok=True)
    images: dict[int, Path] = {}
    for page in sorted(physical_pages):
        output = image_dir / f"page-{page:03d}.png"
        images[page] = output
        if output.exists() and output.stat().st_size > 1_000:
            continue
        prefix = output.with_suffix("")
        subprocess.run(
            [
                str(poppler_path),
                "-f", str(page),
                "-l", str(page),
                "-r", str(render_dpi),
                "-png",
                "-singlefile",
                str(pdf_path),
                str(prefix),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
    return images


def run_windows_ocr(
    images: dict[int, Path],
    work_dir: Path,
    ocr_script: Path,
) -> dict[int, dict[str, Any]]:
    manifest_path = work_dir / "ocr-pages.json"
    output_path = work_dir / "ocr-pages.jsonl"
    write_json(manifest_path, [
        {"physical_page": page, "image_path": str(path.resolve())}
        for page, path in sorted(images.items())
    ])
    subprocess.run(
        [
            "powershell.exe",
            "-NoProfile",
            "-ExecutionPolicy", "Bypass",
            "-File", str(ocr_script.resolve()),
            "-InputManifest", str(manifest_path.resolve()),
            "-OutputJsonl", str(output_path.resolve()),
        ],
        check=True,
    )
    records: dict[int, dict[str, Any]] = {}
    for line in output_path.read_text(encoding="utf-8-sig").splitlines():
        if line.strip():
            record = json.loads(line)
            records[int(record["physical_page"])] = record
    return records


def caption_likelihood(
    figure_label: str,
    line: dict[str, Any],
    page_width: int,
) -> tuple[float, dict[str, int] | None]:
    bounds = line_bounds(line)
    if not bounds:
        return 0, None
    normalized = normalize_ocr_text(line.get("text", ""))
    expected = normalize_ocr_text(figure_label)
    if not normalized.startswith(expected) or len(normalized) <= len(expected) + 1:
        return 0, bounds
    remainder = normalized[len(expected):]
    score = 0.62
    if bounds["x"] >= page_width * 0.18:
        score += 0.14
    if bounds["width"] <= page_width * 0.72:
        score += 0.08
    if 2 <= len(remainder) <= 70:
        score += 0.08
    if not re.match(r"^(所示|中|为|是|表示|显示|可见|给出|说明)", remainder):
        score += 0.07
    if len(line.get("words") or []) <= 28:
        score += 0.03
    return min(score, 1.0), bounds


def clean_caption(figure_label: str, ocr_text: str) -> str:
    normalized = normalize_ocr_text(ocr_text)
    expected = normalize_ocr_text(figure_label)
    caption = normalized[len(expected):].strip("：:，,。.;；")
    return caption[:300] or figure_label


def extract_source_caption(
    figure_label: str,
    source_texts: list[str],
) -> str | None:
    body_reference_prefix = re.compile(
        r"^(所示|中|为|是|表示|显示|可见|给出|说明|示意了|示意出|表明|可知)"
    )
    candidates: list[str] = []
    for text in source_texts:
        for match in FIGURE_PATTERN.finditer(text):
            label = f"图{int(match.group(1))}.{int(match.group(2))}"
            if label != figure_label:
                continue
            tail = text[match.end():match.end() + 180].lstrip(" \t\r\n：:")
            segment = re.split(r"[\r\n。；;]", tail, maxsplit=1)[0]
            caption = re.sub(r"\s+", "", segment).strip("：:，,。.;；")
            if (
                2 <= len(caption) <= 80
                and not body_reference_prefix.match(caption)
                and not FIGURE_PATTERN.search(caption)
            ):
                candidates.append(caption)
    if not candidates:
        return None
    return min(candidates, key=lambda item: (len(item), item))


def find_caption_anchor(
    figure_label: str,
    candidate_pages: list[int],
    ocr_records: dict[int, dict[str, Any]],
    image_paths: dict[int, Path],
) -> dict[str, Any] | None:
    candidates: list[dict[str, Any]] = []
    for physical_page in candidate_pages:
        record = ocr_records.get(physical_page)
        image_path = image_paths.get(physical_page)
        if not record or record.get("status") != "ok" or not image_path:
            continue
        with Image.open(image_path) as image:
            page_width = image.width
        for line in record.get("lines", []):
            score, bounds = caption_likelihood(figure_label, line, page_width)
            if score >= 0.82 and bounds:
                candidates.append({
                    "physical_page": physical_page,
                    "line": line,
                    "bounds": bounds,
                    "score": score,
                })
    if not candidates:
        return None
    candidates.sort(key=lambda item: (-item["score"], item["physical_page"], item["bounds"]["y"]))
    return candidates[0]


def crop_bounds_for_anchor(
    image: Image.Image,
    lines: list[dict[str, Any]],
    caption_bounds: dict[str, int],
    other_caption_bounds: list[dict[str, int]],
    render_dpi: int,
) -> dict[str, int]:
    page_width, page_height = image.size
    caption_y = caption_bounds["y"]
    previous_caption_bottom = max(
        (
            item["y"] + item["height"]
            for item in other_caption_bounds
            if item["y"] < caption_y
        ),
        default=round(page_height * 0.11),
    )
    full_lines: list[dict[str, int]] = []
    for line in lines:
        bounds = line_bounds(line)
        if not bounds:
            continue
        bottom = bounds["y"] + bounds["height"]
        if not (previous_caption_bottom <= bottom < caption_y):
            continue
        if (
            bounds["x"] <= page_width * 0.15
            and bounds["width"] >= page_width * 0.58
            and len(line.get("words") or []) >= 14
        ):
            full_lines.append(bounds)
    lower_bound = max(
        previous_caption_bottom + 8,
        max((item["y"] + item["height"] + 8 for item in full_lines), default=0),
        round(page_height * 0.1),
    )
    upper_bound = min(
        page_height,
        caption_bounds["y"] + caption_bounds["height"] + round(18 * render_dpi / 200),
    )
    return compute_crop_box(
        image,
        caption_rect=caption_bounds,
        lower_bound=lower_bound,
        upper_bound=upper_bound,
        render_dpi=render_dpi,
    )


def crop_quality(
    image: Image.Image,
    crop: dict[str, int],
    caption_score: float,
) -> tuple[float, str]:
    page_width, page_height = image.size
    width_ratio = crop["width"] / page_width
    height_ratio = crop["height"] / page_height
    region = image.convert("L").crop((
        crop["x"],
        crop["y"],
        crop["x"] + crop["width"],
        crop["y"] + crop["height"],
    ))
    mean = ImageStat.Stat(region).mean[0]
    if width_ratio < 0.16 or height_ratio < 0.045:
        return 0.7, "rejected_too_small"
    if height_ratio > 0.58:
        return 0.72, "rejected_oversized"
    if mean > 253.5:
        return 0.68, "rejected_too_blank"
    confidence = min(
        0.99,
        0.72 + caption_score * 0.23 + (0.02 if 0.08 <= height_ratio <= 0.48 else 0),
    )
    return round(confidence, 3), (
        "displayable" if confidence >= DISPLAYABLE_CONFIDENCE else "rejected_low_confidence"
    )


def crop_has_body_text(
    lines: list[dict[str, Any]],
    crop: dict[str, int],
    *,
    page_width: int,
) -> bool:
    crop_right = crop["x"] + crop["width"]
    crop_bottom = crop["y"] + crop["height"]
    body_limit = crop["y"] + round(crop["height"] * 0.82)
    for line in lines:
        bounds = line_bounds(line)
        if not bounds:
            continue
        line_right = bounds["x"] + bounds["width"]
        line_bottom = bounds["y"] + bounds["height"]
        if (
            bounds["x"] < crop_right
            and line_right > crop["x"]
            and bounds["y"] >= crop["y"]
            and line_bottom <= min(crop_bottom, body_limit)
            and bounds["x"] <= page_width * 0.28
            and bounds["width"] >= page_width * 0.32
            and len(line.get("words") or []) >= 10
            and len(normalize_ocr_text(line.get("text", ""))) >= 24
        ):
            return True
    return False


def crop_contains_multiple_captions(
    crop: dict[str, int],
    caption_bounds: list[dict[str, int]],
) -> bool:
    crop_right = crop["x"] + crop["width"]
    crop_bottom = crop["y"] + crop["height"]
    contained = 0
    for bounds in caption_bounds:
        center_x = bounds["x"] + bounds["width"] / 2
        center_y = bounds["y"] + bounds["height"] / 2
        if (
            crop["x"] <= center_x <= crop_right
            and crop["y"] <= center_y <= crop_bottom
        ):
            contained += 1
    return contained > 1


def crop_contains_multiple_figure_labels(
    lines: list[dict[str, Any]],
    crop: dict[str, int],
) -> bool:
    crop_right = crop["x"] + crop["width"]
    crop_bottom = crop["y"] + crop["height"]
    labels: set[str] = set()
    for line in lines:
        bounds = line_bounds(line)
        if not bounds:
            continue
        center_x = bounds["x"] + bounds["width"] / 2
        center_y = bounds["y"] + bounds["height"] / 2
        if not (
            crop["x"] <= center_x <= crop_right
            and crop["y"] <= center_y <= crop_bottom
        ):
            continue
        for match in FIGURE_PATTERN.finditer(line.get("text", "")):
            labels.add(f"图{int(match.group(1))}.{int(match.group(2))}")
    return len(labels) > 1


def concept_terms_for_label(
    figure_label: str,
    curriculum: dict[str, Any],
    knowledge_by_chunk: dict[str, dict[str, Any]],
) -> list[str]:
    terms: list[str] = []
    for chapter in curriculum["chapters"]:
        for module in chapter["modules"]:
            for concept in module["concepts"]:
                if any(
                    figure_label in direct_labels(
                        knowledge_by_chunk.get(normalize_chunk_id(source["chunk_id"]), {}).get("text", "")
                    )
                    for source in concept["sources"]
                ):
                    terms.extend(concept.get("key_terms", []))
    return list(dict.fromkeys(term for term in terms if term))[:12]


def first_reference(
    figure_label: str,
    mentions: list[dict[str, Any]],
) -> dict[str, Any]:
    mention = sorted(
        mentions,
        key=lambda item: (item["print_page"], item["ordinal"]),
    )[0]
    return {
        "reference_id": (
            f"co_reference_{mention['source_item_id']}_"
            f"{figure_label[1:].replace('.', '_')}"
        ),
        "source_item_id": mention["source_item_id"],
        "reference_text": mention["context"][:500],
        "ordinal": mention["ordinal"],
    }


def enrich_existing_asset(
    asset: dict[str, Any],
    chapter: str,
    tags: list[str],
) -> dict[str, Any]:
    return {
        **asset,
        "chapter": chapter,
        "tags": tags or [chapter],
        "extraction_status": "displayable",
        "extraction_method": "manual_pdf_crop",
        "extraction_confidence": 1.0,
    }


def build_library(
    *,
    project_root: Path,
    pdf_path: Path,
    render_dpi: int,
) -> dict[str, Any]:
    course_root = project_root / "data/course-materials/computer-organization"
    manifest_path = course_root / "manifest.json"
    manifest = read_json(manifest_path)
    knowledge_path = Path(manifest["files"]["knowledge"]["original_path"])
    knowledge = read_json(knowledge_path)
    curriculum_path = course_root / "curated/curriculum-map.json"
    curriculum = read_json(curriculum_path)
    existing_assets_path = course_root / "assets/figure-assets.json"
    existing_assets = read_json(existing_assets_path)
    source_hash = sha256_file(pdf_path)
    if source_hash != "10c4fdaf44ec2d7f433924c70a31de1073d7214fbc747afaa885b8c3c6cf2651":
        raise ValueError("Source PDF SHA256 does not match the audited textbook.")

    mentions = derive_figure_mentions(knowledge)
    if len(mentions) != 293:
        raise ValueError(f"Expected 293 unique figure labels, found {len(mentions)}.")
    physical_pages = {
        mention["print_page"] + 7
        for items in mentions.values()
        for mention in items
    }
    work_dir = project_root / "tmp/pdfs/computer-organization-figure-library"
    image_dir = work_dir / f"pages-{render_dpi}dpi"
    pdftotext = shutil.which("pdftotext")
    if not pdftotext:
        raise RuntimeError("Poppler pdftotext was not found.")
    poppler = Path(pdftotext).with_name("pdftoppm.exe")
    if not poppler.exists():
        raise RuntimeError(f"Poppler pdftoppm was not found beside {pdftotext}.")
    images = render_candidate_pages(
        pdf_path,
        physical_pages,
        image_dir,
        poppler,
        render_dpi,
    )
    ocr_records = run_windows_ocr(
        images,
        work_dir,
        Path(__file__).with_name("windows_ocr_pages.ps1"),
    )

    knowledge_by_chunk = {
        normalize_chunk_id(str(item["id"])): {
            **item,
            "id": str(item["id"]),
        }
        for item in knowledge
    }
    existing_by_label = {
        item["figure_label"]: item
        for item in existing_assets
        if item.get("verification_status") == "human_verified"
    }
    chapter_by_number = {
        chapter["ordinal"]: chapter["source_chapter"]
        for chapter in curriculum["chapters"]
    }
    captions_by_page: dict[int, list[dict[str, int]]] = defaultdict(list)
    anchors: dict[str, dict[str, Any]] = {}
    for label, items in mentions.items():
        pages = sorted({item["print_page"] + 7 for item in items})
        anchor = find_caption_anchor(label, pages, ocr_records, images)
        if anchor:
            anchors[label] = anchor
            captions_by_page[anchor["physical_page"]].append(anchor["bounds"])

    catalog: list[dict[str, Any]] = []
    generated_assets: list[dict[str, Any]] = []
    data_asset_root = course_root / "assets/library"
    web_asset_root = (
        project_root
        / "apps/web/public/course-assets/computer-organization/library"
    )
    for label, items in mentions.items():
        number, sequence = figure_sort_key(label)
        chapter = chapter_by_number[number]
        tags = [chapter, *concept_terms_for_label(label, curriculum, knowledge_by_chunk)]
        tags = list(dict.fromkeys(tags))[:12]
        existing = existing_by_label.get(label)
        if existing:
            enriched = enrich_existing_asset(existing, chapter, tags)
            generated_assets.append(enriched)
            catalog.append({
                "catalog_id": f"co_catalog_{number}_{sequence}",
                "figure_label": label,
                "caption": existing["caption"],
                "chapter": chapter,
                "print_page": existing["print_page"],
                "pdf_physical_page": existing["pdf_physical_page"],
                "source_pdf_sha256": source_hash,
                "tags": tags,
                "extraction_status": "displayable",
                "extraction_confidence": 1.0,
                "crop_box_pixels": existing["crop_box_pixels"],
                "verification_status": "human_verified",
                "usage_scope": "local_demo_only",
                "license_status": "unverified",
                "asset_id": existing["asset_id"],
                "candidate_print_pages": sorted({item["print_page"] for item in items}),
            })
            continue

        anchor = anchors.get(label)
        base = {
            "catalog_id": f"co_catalog_{number}_{sequence}",
            "figure_label": label,
            "caption": label,
            "chapter": chapter,
            "print_page": min(item["print_page"] for item in items),
            "pdf_physical_page": min(item["print_page"] for item in items) + 7,
            "source_pdf_sha256": source_hash,
            "tags": tags,
        "extraction_status": "caption_not_located",
            "extraction_confidence": 0.0,
            "crop_box_pixels": None,
            "verification_status": "detected_only",
            "usage_scope": "local_demo_only",
            "license_status": "unverified",
            "asset_id": None,
            "candidate_print_pages": sorted({item["print_page"] for item in items}),
        }
        if not anchor:
            catalog.append(base)
            continue
        source_caption = extract_source_caption(
            label,
            [
                knowledge_by_chunk[normalize_chunk_id(item["source_item_id"])]["text"]
                for item in items
                if normalize_chunk_id(item["source_item_id"]) in knowledge_by_chunk
            ],
        )
        if not source_caption:
            catalog.append({
                **base,
                "extraction_status": "caption_unconfirmed",
            })
            continue
        physical_page = anchor["physical_page"]
        image_path = images[physical_page]
        record = ocr_records[physical_page]
        caption = clean_caption(label, anchor["line"]["text"])
        crop: dict[str, int] | None = None
        try:
            with Image.open(image_path) as image:
                crop = crop_bounds_for_anchor(
                    image,
                    record.get("lines", []),
                    anchor["bounds"],
                    captions_by_page[physical_page],
                    render_dpi,
                )
                confidence, status = crop_quality(image, crop, anchor["score"])
                if status == "displayable" and crop_has_body_text(
                    record.get("lines", []),
                    crop,
                    page_width=image.width,
                ):
                    confidence, status = 0.78, "rejected_text_contamination"
                if status == "displayable" and crop_contains_multiple_captions(
                    crop,
                    captions_by_page[physical_page],
                ):
                    confidence, status = 0.76, "rejected_multi_figure_crop"
                if status == "displayable" and crop_contains_multiple_figure_labels(
                    record.get("lines", []),
                    crop,
                ):
                    confidence, status = 0.76, "rejected_multi_figure_crop"
                crop_image = image.crop((
                    crop["x"],
                    crop["y"],
                    crop["x"] + crop["width"],
                    crop["y"] + crop["height"],
                )).convert("RGB")
                if status == "displayable":
                    relative = Path(f"ch{number:02d}") / f"figure-{number}-{sequence}.png"
                    data_path = data_asset_root / relative
                    web_path = web_asset_root / relative
                    data_path.parent.mkdir(parents=True, exist_ok=True)
                    web_path.parent.mkdir(parents=True, exist_ok=True)
                    crop_image.save(data_path, format="PNG", optimize=True)
                    shutil.copyfile(data_path, web_path)
                    asset = {
                        "asset_id": f"co_figure_{number}_{sequence}",
                        "figure_label": label,
                        "caption": caption,
                        **TEXTBOOK,
                        "chapter": chapter,
                        "print_page": physical_page - 7,
                        "pdf_physical_page": physical_page,
                        "source_pdf_sha256": source_hash,
                        "original_path": str(pdf_path),
                        "file": f"library/{relative.as_posix()}",
                        "sha256": sha256_file(data_path),
                        "storage_ref": (
                            "/course-assets/computer-organization/library/"
                            f"{relative.as_posix()}"
                        ),
                        "mime_type": "image/png",
                        "pixel_width": crop["width"],
                        "pixel_height": crop["height"],
                        "crop_box_pixels": crop,
                        "tags": tags,
                        "extraction_status": "displayable",
                        "extraction_method": "windows_ocr_caption_anchor",
                        "extraction_confidence": confidence,
                        "verification_status": "coordinate_verified",
                        "usage_scope": "local_demo_only",
                        "license_status": "unverified",
                        "reference": first_reference(label, items),
                    }
                    generated_assets.append(asset)
                    base["asset_id"] = asset["asset_id"]
        except (OSError, ValueError):
            confidence, status = 0.65, "crop_failed"
        catalog.append({
            **base,
            "caption": caption,
            "print_page": physical_page - 7,
            "pdf_physical_page": physical_page,
            "extraction_status": status,
            "extraction_confidence": confidence,
            "crop_box_pixels": crop,
            "verification_status": (
                "coordinate_verified" if status == "displayable" else "detected_only"
            ),
        })

    deduplicated_assets, duplicate_labels = deduplicate_asset_records(generated_assets)
    if duplicate_labels:
        catalog = [
            {
                **item,
                "asset_id": None,
                "extraction_status": "duplicate_crop",
                "extraction_confidence": min(item["extraction_confidence"], 0.7),
            }
            if item["figure_label"] in duplicate_labels
            else item
            for item in catalog
        ]
    assets = merge_displayable_assets(
        [item for item in deduplicated_assets if item["figure_label"] in existing_by_label],
        [item for item in deduplicated_assets if item["figure_label"] not in existing_by_label],
    )
    links = assign_concept_figures(curriculum, knowledge_by_chunk, assets)
    validate_catalog(catalog)

    catalog_path = course_root / "assets/figure-catalog.json"
    links_path = course_root / "assets/concept-figure-links.json"
    write_json(catalog_path, catalog)
    write_json(existing_assets_path, assets)
    write_json(links_path, links)
    manifest["files"]["figure_assets"] = {
        "file": "figure-assets.json",
        "sha256": sha256_file(existing_assets_path),
        "record_count": len(assets),
    }
    manifest["files"]["figure_catalog"] = {
        "file": "figure-catalog.json",
        "sha256": sha256_file(catalog_path),
        "record_count": len(catalog),
    }
    manifest["files"]["concept_figure_links"] = {
        "file": "concept-figure-links.json",
        "sha256": sha256_file(links_path),
        "record_count": len(links),
    }
    write_json(manifest_path, manifest)
    return {
        "catalog_count": len(catalog),
        "displayable_asset_count": len(assets),
        "concept_link_count": len(links),
        "assigned_concept_count": len({item["concept_id"] for item in links}),
        "direct_link_count": sum(
            item["match_method"] == "direct_reference" for item in links
        ),
        "semantic_link_count": sum(
            item["match_method"] == "semantic_candidate" for item in links
        ),
        "status_counts": {
            status: sum(item["extraction_status"] == status for item in catalog)
            for status in sorted({item["extraction_status"] for item in catalog})
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-root", type=Path)
    parser.add_argument("--source-pdf", type=Path, default=SOURCE_PDF)
    parser.add_argument("--render-dpi", type=int, default=DEFAULT_RENDER_DPI)
    args = parser.parse_args()
    project_root = (
        args.project_root.resolve()
        if args.project_root
        else Path(__file__).resolve().parents[3]
    )
    result = build_library(
        project_root=project_root,
        pdf_path=args.source_pdf.resolve(),
        render_dpi=args.render_dpi,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
