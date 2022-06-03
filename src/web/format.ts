export function formatAmount(amount: string, decimals: number, minimumDecimals = decimals): string {
  if (!decimals) return amount;
  const digits = amount.padStart(decimals + 1, "0");
  const integer = digits.slice(0, -decimals);
  const fraction = digits.slice(-decimals).replace(/0+$/, "").padEnd(minimumDecimals, "0");
  return fraction ? `${integer}.${fraction}` : integer;
}

export function parseAmount(value: string, decimals: number): string | null {
  if (!/^\d+(\.\d+)?$/.test(value) || value.length > 100) return null;
  const [integer, fraction = ""] = value.split(".");
  if (fraction.length > decimals) return null;
  const amount = BigInt(integer + fraction.padEnd(decimals, "0"));
  return amount > 0n ? amount.toString() : null;
}

export function formatTime(value: string): string {
  return new Date(value).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

export function badgeClass(status: string): string {
  switch (status) {
    case "SETTLED":
    case "OVERPAID":
      return "bg-success";
    case "DETECTED":
    case "CONFIRMING":
    case "UNDERPAID":
    case "LATE_PAYMENT":
      return "bg-warning text-dark";
    case "REORGED":
      return "bg-danger";
    default:
      return "bg-secondary";
  }
}
