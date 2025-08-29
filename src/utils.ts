export const entitlementsToCSV = (entitlements: Array<{address: string, amount: string}>): string => {
    const lines = ['address,amount'];
    lines.push(...entitlements.map(e => `${e.address},${e.amount}`));
    return lines.join('\n');
  };