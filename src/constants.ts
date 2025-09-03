export const CHUNK_SIZES = {
  SMALL: 1000,
  MEDIUM: 5000,
  LARGE: 10000,
  EXTRA_LARGE: 50000,
} as const;

export const DATASET_THRESHOLDS = {
  SMALL: 10000,
  MEDIUM: 50000,
  LARGE: 100000,
} as const;

export const MEMORY_LIMITS = {
  WARNING_MB: 1000,
  GC_TRIGGER_MB: 2000,
} as const;

export const TIMEOUTS = {
  PROCESSOR_CLEANUP_MS: 300000, // 5 minutes
} as const;

export const FORMATS = {
  MERKLE_TREE_VERSION: 'near-v1',
  NEAR_ACCOUNT_HEX_LENGTH: 64,
} as const;

export const HTTP_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_SERVER_ERROR: 500,
} as const;

export const DATABASE = {
  BATCH_SIZE: 1000,
} as const;

export const REGEX_PATTERNS = {
  AMOUNT_VALIDATION: /^\d+(\.\d*)?$/,
  NEAR_ACCOUNT: /\.near$/,
  HEX_64_CHAR: /^[a-f0-9]{64}$/,
  HEX_HASH: /^0x[a-fA-F0-9]{64}$/,
} as const;

export const HTTP_LIMITS = {
  JSON_LIMIT: '500mb',
  URL_ENCODED_LIMIT: '500mb',
  TEXT_LIMIT: '500mb',
} as const;