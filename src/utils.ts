import { ValidationUtils } from './validation';
import { ValidationError } from './errors';

/**
 * Convert entitlements array to CSV format
 */
export const entitlementsToCSV = (entitlements: Array<{address: string, amount: string}>): string => {
  if (!Array.isArray(entitlements)) {
    throw new ValidationError('Entitlements must be an array');
  }

  if (entitlements.length === 0) {
    throw new ValidationError('Entitlements array cannot be empty');
  }

  // Validate each entitlement before conversion
  const validatedEntitlements = entitlements.map((e, index) => 
    ValidationUtils.validateEntitlementEntry(e, index + 2) // +2 because line 1 is header
  );

  const lines = ['address,amount'];
  lines.push(...validatedEntitlements.map(e => `${e.address},${e.amount}`));
  return lines.join('\n');
};

/**
 * Parse CSV data into entitlements array with validation
 */
export const parseCSVToEntitlements = (csvData: string): Array<{address: string, amount: string}> => {
  ValidationUtils.validateCsvData(csvData);
  
  const lines = csvData.trim().split('\n');
  const entitlements: Array<{address: string, amount: string}> = [];
  
  // Skip header if it exists (check if first line contains 'address' and 'amount')
  const startIndex = lines[0] && lines[0].toLowerCase().includes('address') ? 1 : 0;
  
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const [address, amount] = line.split(',').map(field => field.trim());
    
    if (!address || !amount) {
      throw new ValidationError(`Invalid CSV format at line ${i + 1}: missing address or amount`);
    }
    
    const validatedEntry = ValidationUtils.validateEntitlementEntry(
      { address, amount }, 
      i + 1
    );
    
    entitlements.push(validatedEntry);
  }
  
  if (entitlements.length === 0) {
    throw new ValidationError('No valid entitlements found in CSV data');
  }
  
  return entitlements;
};

/**
 * Check for duplicate addresses in entitlements
 */
export const checkForDuplicateAddresses = (entitlements: Array<{address: string, amount: string}>): void => {
  const addresses = entitlements.map(e => e.address.toLowerCase());
  const uniqueAddresses = new Set(addresses);
  
  if (uniqueAddresses.size !== addresses.length) {
    const duplicates = addresses.filter((addr, index) => addresses.indexOf(addr) !== index);
    const uniqueDuplicates = [...new Set(duplicates)];
    throw new ValidationError(
      `Duplicate addresses found: ${uniqueDuplicates.join(', ')}`
    );
  }
};

/**
 * Calculate total claim value from entitlements
 */
export const calculateTotalClaimValue = (entitlements: Array<{address: string, amount: string}>): string => {
  return entitlements
    .reduce((sum, e) => {
      const cleanAmount = ValidationUtils.validateAmount(e.amount);
      return sum + BigInt(cleanAmount);
    }, 0n)
    .toString();
};