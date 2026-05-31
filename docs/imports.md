# Import Preview API

The import preview endpoint lets you validate a CSV file of Stellar addresses before committing a bulk import. It returns a summary of valid/invalid rows and per-row error details without persisting any data.

---

## Endpoint

```
POST /api/imports/preview
```

**Auth:** `X-API-Key` header with an Enterprise-scoped key (or `Authorization: Bearer <key>`).

**Content-Type:** `multipart/form-data`

**Field:** `file` — the CSV file to validate.

---

## Limits

| Constraint | Value |
|---|---|
| Maximum file size | 512 KB |
| Maximum rows scanned | 10 000 |
| Maximum cell size | 1 024 bytes |
| Parse timeout | 5 000 ms |
| Files per request | 1 |

Files exceeding the size limit are rejected by multer before any bytes are parsed. Rows beyond the row limit are still consumed to report an accurate `totalDataRowsInFile`, but are not included in the scan results.

---

## Accepted file types

The endpoint accepts only CSV files. Both MIME type and file extension are checked:

| MIME type | Notes |
|---|---|
| `text/csv` | Standard CSV MIME type |
| `text/plain` | Accepted when extension is `.csv` |
| `application/csv` | Alternative CSV MIME type |
| `application/vnd.ms-excel` | Sent by some Excel CSV exports |

Any other MIME type or non-`.csv` extension returns `415 Unsupported Media Type`.

---

## CSV format

- The first row must be a header row containing an `address` column (case-insensitive).
- Additional columns are allowed and ignored.
- The file must be valid UTF-8 (BOM is stripped automatically).
- Empty lines are skipped.

**Minimal example:**

```csv
address
GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN
GBCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC
```

**With extra columns:**

```csv
name,address,notes
Alice,GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN,primary
Bob,GBCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC,secondary
```

---

## Request example

```bash
curl -X POST https://api.credence.org/api/imports/preview \
  -H "X-API-Key: your-enterprise-key" \
  -F "file=@addresses.csv"
```

---

## Response — success (200)

```json
{
  "summary": {
    "totalRowsScanned": 3,
    "validRows": 2,
    "invalidRows": 1,
    "truncated": false,
    "truncatedReason": null
  },
  "preview": {
    "validSample": [
      { "line": 2, "data": { "address": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN" } }
    ],
    "invalidSample": [
      {
        "line": 3,
        "data": { "address": "not-a-stellar-address" },
        "errors": ["Invalid Stellar address"]
      }
    ]
  },
  "rowErrors": [
    {
      "line": 3,
      "column": "address",
      "code": "INVALID_ADDRESS",
      "message": "Invalid Stellar address"
    }
  ]
}
```

When the file contains more rows than the limit, `truncated` is `true` and `totalDataRowsInFile` is included:

```json
{
  "summary": {
    "totalRowsScanned": 10000,
    "validRows": 9800,
    "invalidRows": 200,
    "truncated": true,
    "truncatedReason": "row_limit",
    "totalDataRowsInFile": 15000
  },
  ...
}
```

---

## Error responses

| Status | `code` | Cause |
|---|---|---|
| `400` | `MissingFile` | No `file` field in the multipart body |
| `400` | `SchemaError` | CSV header does not contain an `address` column |
| `400` | `MalformedCsv` | File cannot be parsed as CSV |
| `400` | `InvalidEncoding` | File is not valid UTF-8 |
| `400` | `CellTooLarge` | A cell value exceeds 1 024 bytes |
| `400` | `TooManyFiles` | More than one file attached |
| `401` | `Unauthorized` | Missing or invalid API key |
| `403` | `Forbidden` | API key lacks Enterprise scope |
| `408` | `ParseTimeout` | Parsing exceeded the 5 000 ms timeout |
| `413` | `FileTooLarge` | File exceeds 512 KB |
| `415` | `InvalidFileType` | File is not a CSV (wrong MIME type or extension) |

All error responses follow this shape:

```json
{
  "error": "InvalidRequest",
  "code": "SchemaError",
  "message": "CSV header must include an \"address\" column.",
  "line": 1
}
```

`line` is only present for errors that can be attributed to a specific row.

---

## Security

### Formula injection

Cell values in the `preview` output that begin with `=`, `+`, `-`, or `@` are prefixed with a tab character (`\t`). This prevents spreadsheet applications from interpreting them as formulas if the response is exported to a file.

### File-type enforcement

Both the MIME type reported by the client and the file extension are checked. A file named `malware.exe` with `Content-Type: text/csv` is rejected because the extension is not `.csv`. A file named `data.csv` with `Content-Type: application/json` is also rejected.

### Memory safety

multer is configured with `memoryStorage()` and a hard `fileSize` limit. Files over 512 KB are rejected before any bytes reach the parser, preventing memory exhaustion from large uploads.

---

## Row error codes

| Code | Column | Meaning |
|---|---|---|
| `MISSING_ADDRESS` | `address` | The address cell is empty |
| `INVALID_ADDRESS` | `address` | The value is not a valid Stellar public key or federation address |
