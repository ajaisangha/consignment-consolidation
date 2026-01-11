// src/utils.js

export function parseDenominator(value) {
  if (!value) return 0;
  const parts = String(value).split("/");
  const last = parts[parts.length - 1];
  const n = parseInt(last, 10);
  return Number.isNaN(n) ? 0 : n;
}

export function enrichRows(rows) {
  const byShipment = {};
  rows.forEach((r) => {
    const key = r["Shipment"];
    if (!byShipment[key]) byShipment[key] = [];
    byShipment[key].push(r);
  });

  const result = [];

  Object.values(byShipment).forEach((shipmentRows) => {
    const base = shipmentRows.map((r) => {
      const ambientTotes = parseDenominator(r["Completed Totes - Ambient"]);
      const chilledTotes = parseDenominator(r["Completed Totes - Chilled"]);
      const freezerTotes = parseDenominator(r["Completed Totes - Freezer"]);
      const chillTotes = chilledTotes + freezerTotes;

      return {
        ...r,
        ambientTotes,
        chillTotes,
        ambientTrollies: 2,
        chillTrollies: 2,
      };
    });

    const consignmentCount = base.length;
    if (consignmentCount <= 9) {
      result.push(...base);
    } else {
      const scale = 9 / consignmentCount;
      base.forEach((r) => {
        result.push({
          ...r,
          ambientTrollies: Math.max(0, Math.round(r.ambientTrollies * scale)),
          chillTrollies: Math.max(0, Math.round(r.chillTrollies * scale)),
        });
      });
    }
  });

  return result;
}
