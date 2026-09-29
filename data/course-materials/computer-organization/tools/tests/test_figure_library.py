import sys
import unittest
from pathlib import Path

from PIL import Image, ImageDraw


TOOLS_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS_DIR))

from build_figure_library import (  # noqa: E402
    assign_concept_figures,
    compute_crop_box,
    crop_contains_multiple_captions,
    crop_contains_multiple_figure_labels,
    crop_has_body_text,
    deduplicate_asset_records,
    extract_source_caption,
    merge_displayable_assets,
    select_caption_line,
    validate_catalog,
)


class FigureLibraryTest(unittest.TestCase):
    def test_catalog_rejects_duplicate_labels_and_incomplete_provenance(self):
        valid = {
            "catalog_id": "co_catalog_1_1",
            "figure_label": "图1.1",
            "caption": "计算机的解题过程",
            "chapter": "1 计算机系统概论",
            "print_page": 4,
            "pdf_physical_page": 11,
            "source_pdf_sha256": "a" * 64,
            "tags": ["计算机系统"],
            "extraction_status": "displayable",
            "extraction_confidence": 0.99,
            "crop_box_pixels": {
                "render_dpi": 200,
                "x": 10,
                "y": 20,
                "width": 300,
                "height": 200,
            },
            "verification_status": "human_verified",
            "usage_scope": "local_demo_only",
            "license_status": "unverified",
        }

        validate_catalog([valid])
        with self.assertRaisesRegex(ValueError, "Duplicate figure label"):
            validate_catalog([valid, dict(valid, catalog_id="co_catalog_duplicate")])
        with self.assertRaisesRegex(ValueError, "tags"):
            validate_catalog([dict(valid, tags=[])])

    def test_existing_human_verified_assets_win_over_generated_records(self):
        existing = [{
            "asset_id": "co_figure_1_1",
            "figure_label": "图1.1",
            "caption": "计算机的解题过程",
            "verification_status": "human_verified",
            "sha256": "b" * 64,
        }]
        generated = [{
            "asset_id": "co_figure_1_1_auto",
            "figure_label": "图1.1",
            "caption": "自动候选",
            "verification_status": "coordinate_verified",
            "sha256": "c" * 64,
        }]

        merged = merge_displayable_assets(existing, generated)

        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["asset_id"], "co_figure_1_1")
        self.assertEqual(merged[0]["sha256"], "b" * 64)

    def test_direct_references_assign_one_primary_and_hide_low_confidence_assets(self):
        curriculum = {
            "chapters": [{
                "chapter_id": "co_ch01",
                "source_chapter": "1 计算机系统概论",
                "title": "计算机系统概论",
                "modules": [{
                    "module_id": "co_m01_01",
                    "title": "计算机系统与机器层次",
                    "concepts": [{
                        "concept_id": "co_c01_02",
                        "title": "程序翻译与机器层次",
                        "learning_objective": "说明源程序如何转为机器可识别的目标程序。",
                        "key_terms": ["源程序", "目标程序", "机器语言"],
                        "sources": [{"chunk_id": "co_chunk_k0013", "print_page": 4}],
                    }],
                }],
            }],
        }
        knowledge = {
            "co_chunk_k0013": {
                "id": "k0013",
                "chapter": "1 计算机系统概论",
                "page": 4,
                "text": "其过程如图1.1所示。实际机器如图1.2所示。",
            },
        }
        assets = [
            {
                "asset_id": "co_figure_1_1",
                "figure_label": "图1.1",
                "caption": "计算机的解题过程",
                "chapter": "1 计算机系统概论",
                "extraction_status": "displayable",
                "extraction_confidence": 0.99,
            },
            {
                "asset_id": "co_figure_1_2",
                "figure_label": "图1.2",
                "caption": "实际机器",
                "chapter": "1 计算机系统概论",
                "extraction_status": "rejected_low_confidence",
                "extraction_confidence": 0.7,
            },
        ]

        links = assign_concept_figures(curriculum, knowledge, assets)

        self.assertEqual(len(links), 1)
        self.assertEqual(links[0]["concept_id"], "co_c01_02")
        self.assertEqual(links[0]["asset_id"], "co_figure_1_1")
        self.assertEqual(links[0]["display_role"], "primary")
        self.assertEqual(links[0]["match_method"], "direct_reference")
        self.assertEqual(links[0]["match_confidence"], 1.0)

    def test_caption_selection_rejects_body_references(self):
        lines = [
            {
                "text": "由此可得出三级层次结构，如图 1.4 所示。",
                "words": [
                    {"text": "如", "x": 900, "y": 910, "width": 20, "height": 22},
                    {"text": "图", "x": 925, "y": 910, "width": 20, "height": 22},
                    {"text": "1.4", "x": 950, "y": 910, "width": 35, "height": 22},
                ],
            },
            {
                "text": "图 1.4 具有三级层次结构的计算机系统",
                "words": [
                    {"text": "图", "x": 500, "y": 1325, "width": 20, "height": 22},
                    {"text": "1.4", "x": 530, "y": 1325, "width": 35, "height": 22},
                    {"text": "具有", "x": 590, "y": 1325, "width": 40, "height": 22},
                ],
            },
        ]

        caption = select_caption_line("图1.4", lines)

        self.assertIsNotNone(caption)
        self.assertEqual(caption["text"], lines[1]["text"])
        self.assertEqual(caption["y"], 1325)

    def test_source_caption_confirms_a_real_caption_instead_of_a_body_reference(self):
        text = (
            "这种方式如图5.7所示。图5.7 示意了串行传送过程。"
            "下一段没有单独的教材图题。"
        )
        self.assertIsNone(extract_source_caption("图5.7", [text]))

        text_with_caption = (
            "其基本格式如图7.1所示。\n"
            "图7.1 指令的一般格式\n"
            "操作码用来指明该指令所要完成的操作。"
        )
        self.assertEqual(
            extract_source_caption("图7.1", [text_with_caption]),
            "指令的一般格式",
        )

    def test_crop_box_uses_caption_anchor_and_excludes_preceding_body_text(self):
        image = Image.new("L", (600, 800), 255)
        draw = ImageDraw.Draw(image)
        draw.rectangle((120, 160, 480, 420), outline=0, width=4)
        draw.line((300, 420, 300, 500), fill=0, width=4)
        draw.rectangle((190, 515, 410, 535), fill=0)

        crop = compute_crop_box(
            image,
            caption_rect={"x": 190, "y": 515, "width": 220, "height": 20},
            lower_bound=140,
            upper_bound=560,
            render_dpi=200,
        )

        self.assertLessEqual(crop["x"], 120)
        self.assertLessEqual(crop["y"], 160)
        self.assertGreaterEqual(crop["x"] + crop["width"], 480)
        self.assertGreaterEqual(crop["y"] + crop["height"], 535)
        self.assertGreater(crop["y"], 100)

    def test_rejects_body_text_inside_an_automatic_crop(self):
        crop = {"x": 80, "y": 300, "width": 1200, "height": 500}
        body_line = {
            "text": "操作码用来指明该指令所要完成的操作，包括加法、减法、传送和移位等。",
            "words": [
                {"x": 110 + index * 55, "y": 350, "width": 48, "height": 22}
                for index in range(14)
            ],
        }
        diagram_label = {
            "text": "CPU 主存 I/O",
            "words": [
                {"x": 500, "y": 480, "width": 42, "height": 20},
                {"x": 600, "y": 480, "width": 42, "height": 20},
                {"x": 700, "y": 480, "width": 42, "height": 20},
            ],
        }

        self.assertTrue(
            crop_has_body_text([body_line, diagram_label], crop, page_width=1400),
        )
        self.assertFalse(
            crop_has_body_text([diagram_label], crop, page_width=1400),
        )

    def test_duplicate_crop_hashes_keep_only_one_automatic_asset(self):
        assets = [
            {
                "asset_id": "co_figure_6_16",
                "figure_label": "图6.16",
                "sha256": "d" * 64,
                "verification_status": "coordinate_verified",
                "extraction_confidence": 0.98,
            },
            {
                "asset_id": "co_figure_6_17",
                "figure_label": "图6.17",
                "sha256": "d" * 64,
                "verification_status": "coordinate_verified",
                "extraction_confidence": 0.97,
            },
        ]

        kept, rejected = deduplicate_asset_records(assets)

        self.assertEqual([item["figure_label"] for item in kept], ["图6.16"])
        self.assertEqual(rejected, {"图6.17"})

    def test_rejects_a_crop_that_contains_multiple_figure_captions(self):
        crop = {"x": 50, "y": 600, "width": 1300, "height": 520}
        captions = [
            {"x": 250, "y": 900, "width": 220, "height": 22},
            {"x": 820, "y": 1050, "width": 260, "height": 22},
        ]

        self.assertTrue(crop_contains_multiple_captions(crop, captions))
        self.assertFalse(crop_contains_multiple_captions(crop, captions[:1]))

    def test_rejects_multiple_figure_labels_even_when_one_caption_was_not_anchored(self):
        crop = {"x": 50, "y": 300, "width": 1300, "height": 700}
        lines = [
            {
                "text": "图 5.39 中断向量地址形成部件框图",
                "words": [{"x": 180, "y": 760, "width": 280, "height": 22}],
            },
            {
                "text": "图 5.40 通过向量地址寻找入口地址",
                "words": [{"x": 760, "y": 890, "width": 300, "height": 22}],
            },
        ]

        self.assertTrue(crop_contains_multiple_figure_labels(lines, crop))
        self.assertFalse(crop_contains_multiple_figure_labels(lines[:1], crop))


if __name__ == "__main__":
    unittest.main()
