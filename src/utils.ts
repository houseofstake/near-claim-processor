import { ValidationUtils } from "./validation";
import { ValidationError } from "./errors";
import { EntitlementEntry } from "./types";

/**
 * Convert entitlements array to CSV format
 */
export const entitlementsToCSV = (entitlements: EntitlementEntry[]): string => {
  if (!Array.isArray(entitlements)) {
    throw new ValidationError("Entitlements must be an array");
  }

  if (entitlements.length === 0) {
    throw new ValidationError("Entitlements array cannot be empty");
  }

  const newEntitlements = entitlements as EntitlementEntry[];
  const validatedEntitlements = newEntitlements.map(
    (e, index) => ValidationUtils.validateEntitlementEntry(e, index + 2) // +2 because line 1 is header
  );

  const lines = ["address,lockup,amount"];
  lines.push(
    ...validatedEntitlements.map((e) => `${e.address},${e.lockup},${e.amount}`)
  );
  return lines.join("\n");
};

/**
 * Parse CSV data into entitlements array with validation
 */
export const parseCSVToEntitlements = (csvData: string): EntitlementEntry[] => {
  ValidationUtils.validateCsvData(csvData);

  const lines = csvData.trim().split("\n");
  const entitlements: EntitlementEntry[] = [];

  // Skip header if it exists (check if first line contains 'address', 'lockup', and 'amount')
  const startIndex =
    lines[0] &&
    lines[0].toLowerCase().includes("address") &&
    lines[0].toLowerCase().includes("lockup")
      ? 1
      : 0;

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const fields = line.split(",").map((field) => field.trim());

    const [address, lockup, amount] = fields;

    if (!address || !lockup || !amount) {
      throw new ValidationError(
        `Invalid CSV format at line ${
          i + 1
        }: missing address, lockup, or amount`
      );
    }

    if (fields.length !== 3) {
      throw new ValidationError(
        `Invalid CSV format at line ${
          i + 1
        }: expected 3 columns (address,lockup,amount), got ${fields.length}`
      );
    }

    const validatedEntry = ValidationUtils.validateEntitlementEntry(
      { address, lockup, amount },
      i + 1
    );

    entitlements.push(validatedEntry);
  }

  if (entitlements.length === 0) {
    throw new ValidationError("No valid entitlements found in CSV data");
  }

  return entitlements;
};

/**
 * Check for duplicate addresses in entitlements
 */
export const checkForDuplicateAddresses = (
  entitlements: EntitlementEntry[]
): void => {
  const addresses = entitlements.map((e) => e.address.toLowerCase());
  const uniqueAddresses = new Set(addresses);

  if (uniqueAddresses.size !== addresses.length) {
    const duplicates = addresses.filter(
      (addr, index) => addresses.indexOf(addr) !== index
    );
    const uniqueDuplicates = [...new Set(duplicates)];
    throw new ValidationError(
      `Duplicate addresses found: ${uniqueDuplicates.join(", ")}`
    );
  }
};

/**
 * Calculate total claim value from entitlements
 */
export const calculateTotalClaimValue = (
  entitlements: EntitlementEntry[]
): string => {
  return entitlements
    .reduce((sum, e) => {
      const cleanAmount = ValidationUtils.validateAmount(e.amount);
      return sum + BigInt(cleanAmount);
    }, 0n)
    .toString();
};
