"""Synthetic structural review tests; no private files and no publisher."""
import tempfile
import unittest
from pathlib import Path
from PIL import Image
from docx import Document
import fitz
from audit_source_media import audit

class AuditTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name)
        pdf=fitz.open()
        page=pdf.new_page()
        page.insert_text((50,50),"synthetic text")
        page=pdf.new_page()
        page.draw_rect(fitz.Rect(30,30,130,130),color=(0,0,0))
        pdf.save(self.root/"sample.pdf")
        pdf.close()
        Image.new("RGB",(160,650),"white").save(self.root/"sample.jpg")
        doc=Document()
        doc.add_paragraph("Dashboard-temp-placeholder")
        doc.save(self.root/"sample.docx")
    def tearDown(self):
        self.temp.cleanup()
    def test_non_authorizing_and_pdf_render(self):
        r=audit(self.root)
        self.assertEqual(r["counts"],{"pdf":1,"docx":1,"image":1})
        self.assertEqual(r["pdf_pages"],2)
        self.assertEqual(r["pdf_pages_without_text"],1)
        self.assertEqual(r["pdf_render_failures"],0)
        self.assertFalse(r["approval_granted"])
        self.assertFalse(r["publication_authorized"])
    def test_private_names_hidden(self):
        r=audit(self.root)
        self.assertTrue(all("private_source_path" not in x for x in r["records"]))
        p=audit(self.root,include_names=True)
        self.assertTrue(all("private_source_path" in x for x in p["records"]))
    def test_placeholder_and_unusually_tall(self):
        r=audit(self.root)
        self.assertTrue(next(x for x in r["records"] if x["type"]=="image")["very_tall"])
        self.assertIn("PLACEHOLDER_COPY",next(x for x in r["records"] if x["type"]=="docx")["flags"])
    def test_budgets_and_source_directory(self):
        with self.assertRaisesRegex(ValueError,"FILE_COUNT_LIMIT"):audit(self.root,max_files=1)
        with self.assertRaisesRegex(ValueError,"INVALID_SOURCE_DIRECTORY"):audit(self.root/"missing")
        with self.assertRaisesRegex(ValueError,"INVALID_BUDGET"):audit(self.root,max_pages=0)
    def test_excessive_pdf_page_pixels_fail_before_raster(self):
        large=fitz.open()
        large.new_page(width=50000,height=50000)
        large.save(self.root/"oversized-page.pdf")
        large.close()
        result=audit(self.root)
        large_result=next(x for x in result["records"]
                          if x["type"]=="pdf" and x.get("render_failures",0)>0)
        self.assertEqual(large_result["render_failures"],1)
        self.assertEqual(large_result["page_checks"][0]["reason"],"PAGE_PIXEL_BUDGET")
        self.assertFalse(result["approval_granted"])

    def test_symlink_rejected(self):
        outside=self.root.parent/"audit-outside-fixture.txt"
        outside.write_text("Synthetic only",encoding="utf-8")
        try:
            (self.root/"escaped.jpg").symlink_to(outside)
            r=audit(self.root)
            item=next(x for x in r["records"] if x.get("asset_ref")=="local-0002")
            self.assertIn("QUARANTINED", [x["status"] for x in r["records"]])
        finally:
            outside.unlink(missing_ok=True)
if __name__=="__main__":
    unittest.main()
