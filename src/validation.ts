import { REGEX_PATTERNS } from "./constants";
import { ValidationError } from "./errors";
import { EntitlementEntry } from "./types";

/**
 * Validation utilities for input data
 */
export class ValidationUtils {
  /**
   * Validate a NEAR address format
   */
  static validateNearAddress(address: string): void {
    if (!address || typeof address !== "string") {
      throw new ValidationError("Address is required and must be a string");
    }

    const trimmedAddress = address.trim().toLowerCase();

    // Check if it's a named account or implicit account
    const isNamedAccount =
      REGEX_PATTERNS.NEAR_ACCOUNT.test(trimmedAddress) ||
      trimmedAddress.endsWith(".testnet") ||
      (trimmedAddress.includes(".") && trimmedAddress.length > 2);
    const isImplicitAccount = REGEX_PATTERNS.HEX_64_CHAR.test(trimmedAddress);
    const isImplicitWithPrefix =
      trimmedAddress.startsWith("0x") &&
      REGEX_PATTERNS.HEX_64_CHAR.test(trimmedAddress.substring(2));

    if (!isNamedAccount && !isImplicitAccount && !isImplicitWithPrefix) {
      throw new ValidationError(
        `Invalid NEAR address format: ${address}. Must be a valid NEAR account ID or 64-character hex string`
      );
    }
  }

  /**
   * Validate and normalize an amount string
   */
  static validateAmount(amount: string): string {
    if (!amount || typeof amount !== "string") {
      throw new ValidationError("Amount is required and must be a string");
    }

    const trimmedAmount = amount.trim();

    if (!REGEX_PATTERNS.AMOUNT_VALIDATION.test(trimmedAmount)) {
      throw new ValidationError(
        `Invalid amount format: ${amount}. Must be a positive number (decimal allowed)`
      );
    }

    const numericAmount = parseFloat(trimmedAmount);
    if (numericAmount < 0) {
      throw new ValidationError(`Amount cannot be negative: ${amount}`);
    }

    if (numericAmount === 0) {
      throw new ValidationError(`Amount cannot be zero: ${amount}`);
    }

    // Return the integer part for compatibility
    return trimmedAmount.includes(".")
      ? trimmedAmount.split(".")[0]
      : trimmedAmount;
  }

  /**
   * Validate a project ID
   */
  static validateProjectId(projectId: string): void {
    if (!projectId || typeof projectId !== "string") {
      throw new ValidationError("Project ID is required and must be a string");
    }

    const trimmedId = projectId.trim();

    if (trimmedId.length === 0) {
      throw new ValidationError("Project ID cannot be empty");
    }

    if (trimmedId.length > 100) {
      throw new ValidationError("Project ID cannot exceed 100 characters");
    }

    // Allow alphanumeric, hyphens, and underscores
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmedId)) {
      throw new ValidationError(
        "Project ID can only contain letters, numbers, hyphens, and underscores"
      );
    }
  }

  /**
   * Validate CSV data structure
   */
  static validateCsvData(csvData: string): void {
    if (!csvData || typeof csvData !== "string") {
      throw new ValidationError("CSV data is required and must be a string");
    }

    const trimmedData = csvData.trim();
    if (trimmedData.length === 0) {
      throw new ValidationError("CSV data cannot be empty");
    }

    const lines = trimmedData.split("\n");
    if (lines.length < 1) {
      throw new ValidationError("CSV must contain at least one data row");
    }

    // Check if we have too many lines (simple DOS protection)
    if (lines.length > 1000000) {
      throw new ValidationError("CSV data too large (maximum 1M lines)");
    }
  }

  /**
   * Validate an individual entitlement entry
   */
  static validateEntitlementEntry(
    entry: EntitlementEntry,
    lineNumber: number
  ): EntitlementEntry {
    try {
      if (!entry || typeof entry !== "object") {
        throw new ValidationError(`Invalid entry format at line ${lineNumber}`);
      }

      this.validateNearAddress(entry.address);
      this.validateNearAddress(entry.lockup);
      const normalizedAmount = this.validateAmount(entry.amount);

      return {
        address: entry.address.trim().toLowerCase(),
        lockup: entry.lockup.trim().toLowerCase(),
        amount: normalizedAmount,
      };
    } catch (error) {
      if (error instanceof ValidationError) {
        throw new ValidationError(`Line ${lineNumber}: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Validate transaction hash format
   */
  static validateTxHash(txHash: string): void {
    if (!txHash || typeof txHash !== "string") {
      throw new ValidationError(
        "Transaction hash is required and must be a string"
      );
    }

    const trimmedHash = txHash.trim();

    // NEAR transaction hashes are base58 encoded and typically 44 characters
    if (trimmedHash.length < 40 || trimmedHash.length > 50) {
      throw new ValidationError("Invalid transaction hash length");
    }

    // Basic character validation for base58
    if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(trimmedHash)) {
      throw new ValidationError("Transaction hash contains invalid characters");
    }
  }

  /**
   * Validate API key
   */
  static validateApiKey(apiKey: string): void {
    if (!apiKey || typeof apiKey !== "string") {
      throw new ValidationError("API key is required and must be a string");
    }
  }

  /**
   * Sanitize and validate file path components
   */
  static validatePathComponent(component: string): string {
    if (!component || typeof component !== "string") {
      throw new ValidationError("Path component must be a non-empty string");
    }

    const sanitized = component.trim();

    // Prevent path traversal attacks
    if (
      sanitized.includes("..") ||
      sanitized.includes("/") ||
      sanitized.includes("\\")
    ) {
      throw new ValidationError("Path component contains invalid characters");
    }

    if (sanitized.length === 0) {
      throw new ValidationError("Path component cannot be empty");
    }

    return sanitized;
  }
}
