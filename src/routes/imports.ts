import { Router, Request, Response, NextFunction } from 'express'
import multer from 'multer'
import { requireApiKey, ApiScope } from '../middleware/auth.js'
import {
  previewImportFile,
  IMPORT_PREVIEW_MAX_FILE_BYTES,
} from '../services/importPreviewService.js'

const router = Router()

/** Accepted MIME types for CSV uploads. */
const ALLOWED_MIME_TYPES = new Set([
  'text/csv',
  'text/plain',
  'application/csv',
  'application/vnd.ms-excel', // some clients send this for .csv
])

/** Accepted file extensions (lower-cased). */
const ALLOWED_EXTENSIONS = new Set(['.csv'])

/**
 * multer fileFilter — rejects uploads whose MIME type or file extension is not
 * in the allow-list before any bytes are written to memory.
 */
function csvFileFilter(
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
): void {
  const ext = file.originalname.slice(file.originalname.lastIndexOf('.')).toLowerCase()
  if (ALLOWED_MIME_TYPES.has(file.mimetype) || ALLOWED_EXTENSIONS.has(ext)) {
    cb(null, true)
  } else {
    // Pass a typed error so handleUploadError can return a clean 415
    const err = Object.assign(new Error('Only CSV files are accepted.'), {
      code: 'INVALID_FILE_TYPE',
    }) as Error & { code: string }
    cb(err)
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: IMPORT_PREVIEW_MAX_FILE_BYTES,
    files: 1, // reject multi-file uploads
  },
  fileFilter: csvFileFilter,
})

function handleUploadError(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        error: 'PayloadTooLarge',
        code: 'FileTooLarge',
        message: 'Import file exceeds the maximum allowed size.',
      })
      return
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      res.status(400).json({
        error: 'InvalidRequest',
        code: 'TooManyFiles',
        message: 'Only one file may be uploaded per request.',
      })
      return
    }
    res.status(400).json({
      error: 'InvalidRequest',
      code: 'UploadError',
      message: 'File upload failed.',
    })
    return
  }

  // fileFilter rejection — non-CSV content type
  if (
    err instanceof Error &&
    (err as any).code === 'INVALID_FILE_TYPE'
  ) {
    res.status(415).json({
      error: 'UnsupportedMediaType',
      code: 'InvalidFileType',
      message: 'Only CSV files are accepted. Please upload a .csv file.',
    })
    return
  }

  next(err)
}

/**
 * POST /api/imports/preview
 *
 * Accepts multipart/form-data with field `file` (CSV). Validates schema and Stellar addresses;
 * returns summary counts and row-level errors without persisting data.
 */
router.post(
  '/preview',
  requireApiKey(ApiScope.ENTERPRISE),
  (req: Request, res: Response, next: NextFunction) => {
    upload.single('file')(req, res, (err: unknown) => {
      if (err !== undefined) {
        handleUploadError(err, req, res, next)
        return
      }
      next()
    })
  },
  async (req: Request, res: Response) => {
    // <-- Marked async
    const file = req.file
    if (!file?.buffer) {
      res.status(400).json({
        error: 'InvalidRequest',
        code: 'MissingFile',
        message: 'Multipart field "file" is required.',
      })
      return
    }

    const result = await previewImportFile(file.buffer) // <-- Added await
    if (!result.success) {
      res.status(result.status).json({
        error: result.error,
        code: result.code,
        message: result.message,
        ...(result.line !== undefined ? { line: result.line } : {}),
      })
      return
    }

    res.status(200).json({
      summary: result.summary,
      preview: result.preview,
      rowErrors: result.rowErrors,
    })
  }
)

export default router
