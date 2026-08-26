from __future__ import annotations

import hashlib
import json
import re
import unittest
from datetime import date, datetime
from pathlib import Path
from unittest.mock import patch

from ingest import main

ROOT = Path(__file__).resolve().parents[1]
WORKBOOK = ROOT / "Norautron_syntetiske_data.xlsx"
SCHEMA = ROOT / "data" / "schema.json"
SQL_SCHEMA = ROOT / "db" / "schema.sql"
SQL_GRANTS = ROOT / "db" / "grants.sql"
POSTPROVISION = ROOT / "scripts" / "postprovision.ps1"
POSTDEPLOY = ROOT / "scripts" / "postdeploy.ps1"
DOCKERFILE = ROOT / "ingest" / "Dockerfile"
REQUIREMENTS = ROOT / "ingest" / "requirements.txt"


def small_source() -> dict:
    return {
        "sheet": "Test",
        "table": "test",
        "primaryColumn": 0,
        "expectedRows": 2,
        "headers": ["ID", "Occurred", "Amount", "Note"],
        "columns": ["id", "occurred", "amount", "note"],
        "types": ["string", "datetime", "decimal", "string"],
        "nullableColumns": ["note"],
    }


class WorkbookContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.schema = main.load_schema(SCHEMA)

    def test_actual_workbook_matches_complete_contract(self) -> None:
        self.assertTrue(WORKBOOK.is_file(), f"Missing contract workbook: {WORKBOOK}")
        counts = main.process_workbook(WORKBOOK, self.schema)
        self.assertEqual(
            counts,
            {
                "Produksjon": 18000,
                "ERP_Salg": 20000,
                "CRM_Pipeline": 5000,
                "Kvalitet": 15000,
                "Forsyning": 12000,
            },
        )
        self.assertEqual(sum(counts.values()), 70000)
        digest = hashlib.sha256(WORKBOOK.read_bytes()).hexdigest()
        self.assertRegex(digest, r"^[0-9a-f]{64}$")

    def test_schema_has_five_unique_versioned_sources(self) -> None:
        sources = self.schema["sources"]
        self.assertEqual(len(sources), 5)
        self.assertEqual(sum(item["expectedRows"] for item in sources), 70000)
        self.assertEqual(len({item["sheet"] for item in sources}), 5)
        self.assertEqual(len({item["table"] for item in sources}), 5)

    def test_default_schema_path_works_from_repository_layout(self) -> None:
        self.assertEqual(main.SCHEMA_PATH, SCHEMA)


class ObservabilityTests(unittest.TestCase):
    def test_structured_logs_redact_sensitive_fields(self) -> None:
        with self.assertLogs(main.LOGGER_NAME, level="INFO") as logs:
            main.log_event(
                "privacy_check",
                raw_ip="192.0.2.1",
                chat_text="full chat text",
                rows=12,
            )
        payload = json.loads(logs.records[-1].getMessage())
        self.assertEqual(payload["event"], "privacy_check")
        self.assertEqual(payload["raw_ip"], "[redacted]")
        self.assertEqual(payload["chat_text"], "[redacted]")
        self.assertEqual(payload["rows"], 12)

    def test_stage_logs_latency_and_outcome(self) -> None:
        with self.assertLogs(main.LOGGER_NAME, level="INFO") as logs:
            with main.observed_stage("test_stage", run_id="run-1"):
                pass
        payloads = [json.loads(record.getMessage()) for record in logs.records]
        self.assertEqual(
            [payload["event"] for payload in payloads],
            ["etl_stage_started", "etl_stage_completed"],
        )
        self.assertEqual(payloads[-1]["outcome"], "success")
        self.assertGreaterEqual(payloads[-1]["duration_ms"], 0)


class RowValidationTests(unittest.TestCase):
    def valid_rows(self):
        return [
            ("A", datetime(2026, 1, 1, 8), 1.25, None),
            ("B", datetime(2026, 1, 2, 8), 2, "ok"),
        ]

    def test_normalizes_valid_values(self) -> None:
        rows = main.validate_source_rows(
            small_source(), small_source()["headers"], self.valid_rows()
        )
        self.assertEqual(str(rows[0][2]), "1.25")
        self.assertIsNone(rows[0][3])

    def test_rejects_header_order_mismatch(self) -> None:
        with self.assertRaisesRegex(ValueError, "headers differ"):
            main.validate_source_rows(
                small_source(), ["ID", "Amount", "Occurred", "Note"], self.valid_rows()
            )

    def test_rejects_wrong_type_with_cell_location(self) -> None:
        rows = self.valid_rows()
        rows[0] = ("A", date(2026, 1, 1), 1.25, None)
        with self.assertRaisesRegex(
            ValueError, r"Test row 2 column Occurred expected datetime"
        ):
            main.validate_source_rows(
                small_source(), small_source()["headers"], rows
            )

    def test_rejects_missing_required_value(self) -> None:
        rows = self.valid_rows()
        rows[1] = ("B", None, 2, "ok")
        with self.assertRaisesRegex(ValueError, r"Occurred is required"):
            main.validate_source_rows(
                small_source(), small_source()["headers"], rows
            )

    def test_primary_identifier_uniqueness_matches_sql_collation(self) -> None:
        rows = self.valid_rows()
        rows[1] = ("a ", datetime(2026, 1, 2, 8), 2, "ok")
        with self.assertRaisesRegex(ValueError, "duplicate primary identifier"):
            main.validate_source_rows(
                small_source(), small_source()["headers"], rows
            )

    def test_rejects_exact_row_count_mismatch(self) -> None:
        with self.assertRaisesRegex(ValueError, r"has 1 rows; expected 2"):
            main.validate_source_rows(
                small_source(), small_source()["headers"], self.valid_rows()[:1]
            )


class AzureBoundaryTests(unittest.TestCase):
    def test_access_token_is_odbc_length_prefixed_utf16(self) -> None:
        packed = main.pack_access_token("abc")
        self.assertEqual(packed[:4], (6).to_bytes(4, "little"))
        self.assertEqual(packed[4:], "abc".encode("utf-16-le"))

    def test_blob_download_streams_and_records_etag_hash_and_size(self) -> None:
        target = ROOT / "ingest" / ".test-download.xlsx"
        target.unlink(missing_ok=True)
        self.addCleanup(target.unlink, missing_ok=True)
        chunks = [b"first", b"-second"]
        supplied_credential = object()

        class Downloader:
            def chunks(self):
                return iter(chunks)

        class Blob:
            kwargs = {}

            def get_blob_properties(self):
                return type("Properties", (), {"etag": '"etag-1"'})()

            def download_blob(self, **kwargs):
                self.kwargs = kwargs
                return Downloader()

        blob = Blob()

        def factory(url, *, credential):
            self.assertEqual(
                url,
                "https://example.blob.core.windows.net/private/source.xlsx",
            )
            self.assertIs(credential, supplied_credential)
            return blob

        with patch.dict(
            "os.environ",
            {
                "DATA_BLOB_URL": (
                    "https://example.blob.core.windows.net/private/source.xlsx"
                )
            },
            clear=False,
        ):
            etag, digest, size = main.download_workbook(
                target,
                blob_factory=factory,
                token_credential=supplied_credential,
            )

        content = b"".join(chunks)
        self.assertEqual(etag, '"etag-1"')
        self.assertEqual(digest, hashlib.sha256(content).hexdigest())
        self.assertEqual(size, len(content))
        self.assertEqual(target.read_bytes(), content)
        self.assertEqual(blob.kwargs["etag"], '"etag-1"')
        self.assertEqual(
            blob.kwargs["match_condition"], main.MatchConditions.IfNotModified
        )

    def test_blob_url_must_be_https(self) -> None:
        with self.assertRaisesRegex(ValueError, "HTTPS blob URL"):
            main.blob_name("http://example.test/source.xlsx")


class AtomicActivationTests(unittest.TestCase):
    def test_bad_staging_count_rolls_back_before_active_version_changes(self) -> None:
        schema = main.load_schema(SCHEMA)

        class Cursor:
            rowcount = 0

            def __init__(self):
                self.statement = ""
                self.statements: list[str] = []

            def execute(self, statement, *params):
                self.statement = statement
                self.statements.append(statement)
                return self

            def fetchone(self):
                if "sp_getapplock" in self.statement:
                    return (0,)
                if "WITH (UPDLOCK, HOLDLOCK)" in self.statement:
                    return ("staged", 70000)
                if "COUNT_BIG" in self.statement:
                    return (0,)
                raise AssertionError(f"Unexpected fetch for {self.statement}")

        class Connection:
            def __init__(self):
                self.the_cursor = Cursor()
                self.commits = 0
                self.rollbacks = 0

            def cursor(self):
                return self.the_cursor

            def commit(self):
                self.commits += 1

            def rollback(self):
                self.rollbacks += 1

        connection = Connection()
        with self.assertRaisesRegex(RuntimeError, r"staging.production has 0 rows"):
            main.activate(connection, schema, "version-id")
        self.assertEqual(connection.rollbacks, 1)
        self.assertEqual(connection.commits, 0)
        self.assertFalse(
            any(
                "SET status = N'archived'" in statement
                for statement in connection.the_cursor.statements
            )
        )


class SqlContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
        cls.sql = SQL_SCHEMA.read_text(encoding="utf-8")
        cls.grants = SQL_GRANTS.read_text(encoding="utf-8")

    def test_raw_and_staging_tables_match_json_contract(self) -> None:
        type_patterns = {
            "string": r"nvarchar\(",
            "integer": r"int\b",
            "decimal": r"decimal\(",
            "date": r"date\b",
            "datetime": r"datetime2\(",
        }
        for source in self.schema["sources"]:
            table = source["table"]
            match = re.search(
                rf"CREATE TABLE raw\.{table} \((.*?)\n\);",
                self.sql,
                flags=re.DOTALL,
            )
            self.assertIsNotNone(match, f"raw.{table} is missing")
            definition = match.group(1)
            for column, expected_type in zip(
                source["columns"], source["types"], strict=True
            ):
                self.assertRegex(
                    definition,
                    rf"(?mi)^\s*{re.escape(column)}\s+{type_patterns[expected_type]}",
                )
            primary = source["columns"][source["primaryColumn"]]
            self.assertIn(f"PRIMARY KEY (dataset_version, {primary})", definition)
            self.assertIn(
                f"SELECT TOP (0) * INTO staging.{table} FROM raw.{table}",
                self.sql,
            )

    def test_atomic_versioning_and_views_are_declared(self) -> None:
        self.assertIn("N'staged'", self.sql)
        self.assertIn("UX_dataset_version_active", self.sql)
        self.assertIn("source_row_counts", self.sql)
        for source in self.schema["sources"]:
            self.assertIn(
                f"CREATE OR ALTER VIEW analytics.{source['table']}", self.sql
            )
        for view in (
            "executive_kpis",
            "sales_monthly",
            "production_daily",
            "pipeline_summary",
            "quality_summary",
            "supply_summary",
        ):
            self.assertIn(f"CREATE OR ALTER VIEW metrics.{view}", self.sql)

    def test_identity_grants_are_least_privilege_by_role(self) -> None:
        self.assertIn("GRANT SELECT ON SCHEMA::analytics", self.grants)
        self.assertIn("GRANT SELECT ON SCHEMA::metrics", self.grants)
        self.assertIn(
            "GRANT SELECT, INSERT, DELETE ON SCHEMA::staging", self.grants
        )
        self.assertIn("GRANT INSERT ON SCHEMA::raw", self.grants)
        self.assertNotIn(
            "GRANT SELECT ON SCHEMA::raw TO [$(WebIdentityName)]", self.grants
        )


class IntegrationContractTests(unittest.TestCase):
    def test_upload_is_validated_before_private_blob_write(self) -> None:
        script = POSTPROVISION.read_text(encoding="utf-8")
        validation = script.index("'--validate-only'")
        upload = script.index("'storage', 'blob', 'upload'")
        self.assertLess(validation, upload)
        self.assertIn("'--auth-mode', 'login'", script)
        self.assertIn("db\\schema.sql", script)
        self.assertIn("db\\grants.sql", script)

    def test_postdeploy_waits_for_ingestion_success(self) -> None:
        script = POSTDEPLOY.read_text(encoding="utf-8")
        self.assertIn("'containerapp', 'job', 'start'", script)
        self.assertIn("'containerapp', 'job', 'execution', 'list'", script)
        self.assertIn("$status -eq 'Succeeded'", script)
        self.assertIn("$status -in @('Failed', 'Stopped')", script)
        self.assertIn("Timed out waiting for ingestion execution", script)

    def test_container_is_non_root_and_has_pinned_runtime_dependencies(self) -> None:
        dockerfile = DOCKERFILE.read_text(encoding="utf-8")
        requirements = REQUIREMENTS.read_text(encoding="utf-8").splitlines()
        self.assertIn("USER appuser", dockerfile)
        self.assertIn("INGEST_WORK_DIR=/app/work", dockerfile)
        self.assertTrue(requirements)
        self.assertTrue(all(re.fullmatch(r"[a-z0-9-]+==[0-9.]+", line) for line in requirements))
        self.assertEqual(
            {line.split("==", 1)[0] for line in requirements},
            {
                "azure-core",
                "azure-identity",
                "azure-monitor-opentelemetry",
                "azure-storage-blob",
                "openpyxl",
                "pyodbc",
            },
        )


if __name__ == "__main__":
    unittest.main()
