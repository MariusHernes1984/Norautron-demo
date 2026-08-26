from __future__ import annotations

import os
import re
import struct
import sys
from pathlib import Path

import pyodbc
from azure.identity import AzureCliCredential

ACCESS_TOKEN_ATTRIBUTE = 1256


def connect() -> pyodbc.Connection:
    token = AzureCliCredential().get_token(
        "https://database.windows.net/.default"
    ).token
    token_bytes = token.encode("utf-16-le")
    packed = struct.pack(f"<I{len(token_bytes)}s", len(token_bytes), token_bytes)
    connection_string = (
        "Driver={ODBC Driver 18 for SQL Server};"
        f"Server=tcp:{os.environ['SQL_SERVER']},1433;"
        f"Database={os.environ['SQL_DATABASE']};"
        "Encrypt=yes;TrustServerCertificate=no;Connection Timeout=30;"
    )
    return pyodbc.connect(
        connection_string,
        attrs_before={ACCESS_TOKEN_ATTRIBUTE: packed},
        autocommit=True,
    )


def batches(sql_text: str):
    return [
        batch.strip()
        for batch in re.split(r"^\s*GO\s*$", sql_text, flags=re.MULTILINE | re.IGNORECASE)
        if batch.strip()
    ]


def execute_file(connection: pyodbc.Connection, path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    if path.name == "grants.sql":
        text = re.sub(r"^:setvar.*$", "", text, flags=re.MULTILINE)
        text = text.replace(
            "$(WebIdentityName)", os.environ["AZURE_CONTAINER_APP_NAME"]
        )
        text = text.replace(
            "$(IngestIdentityName)", os.environ["AZURE_INGEST_JOB_NAME"]
        )
        text = text.replace(
            "$(WebIdentityClientId)",
            os.environ["AZURE_CONTAINER_APP_CLIENT_ID"],
        )
        text = text.replace(
            "$(IngestIdentityClientId)",
            os.environ["AZURE_INGEST_JOB_CLIENT_ID"],
        )
    for index, batch in enumerate(batches(text), start=1):
        try:
            connection.cursor().execute(batch)
        except Exception as error:
            raise RuntimeError(f"{path} batch {index} failed") from error


def main() -> None:
    paths = [Path(argument) for argument in sys.argv[1:]]
    if not paths:
        raise SystemExit("Usage: bootstrap_db.py <sql-file> [<sql-file>...]")
    with connect() as connection:
        for path in paths:
            execute_file(connection, path)
            print(f"Applied {path}")


if __name__ == "__main__":
    main()
