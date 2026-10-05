export type MarkupErrorCode =
  /** The document was written by a newer version (`schemaVersion` above 1). */
  | 'unsupportedSchemaVersion'
  /** The document is not valid JSON or a required document-level field is malformed. */
  | 'invalidDocument'
  /** The editor received no image, several kinds of input, or an input of an unsupported type. */
  | 'invalidInput'
  /** An image could not be read or decoded by this browser (e.g. HEIC outside Safari). */
  | 'unreadableImage'
  /** The document refers to an asset that was not provided. */
  | 'missingAsset'
  /** A cross-origin image without CORS made the export canvas unreadable. */
  | 'taintedImage'
  /** The browser could not allocate a canvas of the required size. */
  | 'canvasAllocationFailed'
  /** The browser could not encode the image. */
  | 'encodingFailed'
  /** The export failed for another reason (see `detail`). */
  | 'exportFailed'
  /** The operation was cancelled. */
  | 'aborted';

/** Errors reported by this package. Check `code` (or use `isMarkupError`) rather than the message. */
export class MarkupError extends Error {
  readonly code: MarkupErrorCode;
  readonly assetID?: string;
  readonly schemaVersion?: number;
  readonly detail?: unknown;

  constructor(
    code: MarkupErrorCode,
    message: string,
    options: { assetID?: string; schemaVersion?: number; detail?: unknown } = {},
  ) {
    super(message);
    this.name = 'MarkupError';
    this.code = code;
    if (options.assetID !== undefined) this.assetID = options.assetID;
    if (options.schemaVersion !== undefined) this.schemaVersion = options.schemaVersion;
    if (options.detail !== undefined) this.detail = options.detail;
  }
}

/** Whether `value` is a `MarkupError` (also across bundle copies, by its name and code). */
export function isMarkupError(value: unknown): value is MarkupError {
  return (
    value instanceof MarkupError ||
    (value instanceof Error && value.name === 'MarkupError' && typeof (value as { code?: unknown }).code === 'string')
  );
}
