import unittest

from anonymize_image import classify_text_regions


class TextRegionClassificationTests(unittest.TestCase):
    def test_rejects_large_square_facade_pattern(self):
        accepted, rejected, accepted_ratio, rejected_ratio, suspected = classify_text_regions(
            [(388, 502, 618, 726)], 1536, 1024,
        )
        self.assertEqual(accepted, [])
        self.assertEqual(len(rejected), 1)
        self.assertEqual(accepted_ratio, 0)
        self.assertGreater(rejected_ratio, 0.03)
        self.assertFalse(suspected)

    def test_keeps_small_address_plate_and_horizontal_text(self):
        regions = [(100, 100, 220, 160), (300, 220, 800, 290)]
        accepted, rejected, _, _, suspected = classify_text_regions(regions, 1536, 1024)
        self.assertEqual(accepted, regions)
        self.assertEqual(rejected, [])
        self.assertFalse(suspected)

    def test_large_document_region_remains_fail_closed(self):
        accepted, rejected, _, rejected_ratio, suspected = classify_text_regions(
            [(200, 120, 1300, 900)], 1536, 1024,
        )
        self.assertEqual(accepted, [])
        self.assertEqual(len(rejected), 1)
        self.assertGreater(rejected_ratio, 0.12)
        self.assertTrue(suspected)


if __name__ == "__main__":
    unittest.main()
