import React, { useState } from "react";
import Papa from "papaparse"; // npm install papaparse

// Helper: parse "0/30" -> 30
const parseTotes = (value) => {
  if (!value) return 0;
  const parts = String(value).split("/");
  const denom = parts[1] ?? parts[0];
  const n = parseInt(denom, 10);
  return Number.isNaN(n) ? 0 : n;
};

// Helper: color based on totes
const getColor = (totes) => {
  if (totes < 20) return "lightgreen";
  if (totes < 30) return "orange";
  return "lightcoral";
};

const App = () => {
  const [consignments, setConsignments] = useState([]);
  const [moves, setMoves] = useState([]);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const data = results.data.filter(
          (r) => r["Consignment"] && r["Consignment"].trim() !== ""
        );
        const { consignmentSummaries, sectionsByShipment } =
          buildConsignmentsAndSections(data);
        setConsignments(consignmentSummaries);
        const moveSuggestions = suggestSectionMoves(sectionsByShipment);
        setMoves(moveSuggestions);
      },
    });
  };

  // Build:
  // 1) consignment summary per Shipment + Consignment (for display)
  // 2) sections per shipment and consignment, per row
  const buildConsignmentsAndSections = (data) => {
    const consMap = {};
    const sectionsByShipment = {};

    data.forEach((row, idx) => {
      const shipment = row["Shipment"] || "";
      const cons = row["Consignment"] || "";
      const key = `${shipment}::${cons}`;

      const ambientTotes = parseTotes(row["Completed Totes - Ambient"]);
      const chilledTotes = parseTotes(row["Completed Totes - Chilled"]);
      const freezerTotes = parseTotes(row["Completed Totes - Freezer"]);
      const chillTotal = chilledTotes + freezerTotes;

      // consignment totals
      if (!consMap[key]) {
        consMap[key] = {
          id: key,
          shipment,
          consignment: cons,
          ambientTotes: 0,
          chillTotes: 0,
        };
      }
      consMap[key].ambientTotes += ambientTotes;
      consMap[key].chillTotes += chillTotal;

      // sections per row: treat each CSV row as one "section"
      if (!sectionsByShipment[shipment]) {
        sectionsByShipment[shipment] = [];
      }

      if (ambientTotes > 0) {
        sectionsByShipment[shipment].push({
          sectionId: `${cons}::row-${idx}::ambient`,
          consignment: cons,
          type: "ambient",
          totes: ambientTotes,
        });
      }

      if (chillTotal > 0) {
        sectionsByShipment[shipment].push({
          sectionId: `${cons}::row-${idx}::chill`,
          consignment: cons,
          type: "chill",
          totes: chillTotal,
        });
      }
    });

    return {
      consignmentSummaries: Object.values(consMap),
      sectionsByShipment,
    };
  };

  // Suggest moves: move one section completely into another section
  // Rule: each section can hold at most 40 totes; after move, target section totes <= 40.
  const suggestSectionMoves = (sectionsByShipment) => {
    const suggestions = [];
    const maxPerSection = 40;

    Object.entries(sectionsByShipment).forEach(([shipment, sections]) => {
      if (sections.length === 0) return;

      // Work with a shallow copy
      const active = sections.map((s) => ({ ...s }));

      // Try to reduce number of distinct consignments, but obey per-section ≤ 40
      // Sort source sections by totes ascending (move smaller ones first)
      active.sort((a, b) => a.totes - b.totes);

      const usedSource = new Set();

      for (let i = 0; i < active.length; i++) {
        const source = active[i];
        if (usedSource.has(source.sectionId)) continue;

        // Only consider moves that change consignment
        for (let j = 0; j < active.length; j++) {
          if (i === j) continue;
          const target = active[j];

          if (target.consignment === source.consignment) continue;

          // Section type must match (both ambient or both chill+freezer)
          if (target.type !== source.type) continue;

          const combined = target.totes + source.totes;
          if (combined <= maxPerSection) {
            // valid move: section fits into target section without exceeding 40
            suggestions.push({
              shipment,
              type: source.type,
              fromConsignment: source.consignment,
              toConsignment: target.consignment,
              fromSectionTotes: source.totes,
              toSectionTotesBefore: target.totes,
              toSectionTotesAfter: combined,
            });

            // apply merge in memory
            target.totes = combined;
            usedSource.add(source.sectionId);
            break;
          }
        }
      }
    });

    return suggestions;
  };

  return (
    <div style={{ padding: "16px", fontFamily: "sans-serif" }}>
      <h2>Consignment Consolidation Tool</h2>

      <input
        type="file"
        accept=".csv"
        onChange={handleFileChange}
        style={{ marginBottom: "16px" }}
      />

      {consignments.length > 0 && (
        <>
          <h3>Consignment Summary</h3>
          <table
            border="1"
            cellPadding="4"
            cellSpacing="0"
            style={{ borderCollapse: "collapse", marginBottom: "16px" }}
          >
            <thead>
              <tr>
                <th>Shipment</th>
                <th>Consignment</th>
                <th>Ambient totes</th>
                <th>Chill+Freezer totes</th>
              </tr>
            </thead>
            <tbody>
              {consignments.map((c) => (
                <tr key={c.id}>
                  <td>{c.shipment}</td>
                  <td>{c.consignment}</td>
                  <td
                    style={{
                      backgroundColor: getColor(c.ambientTotes),
                    }}
                  >
                    {c.ambientTotes}
                  </td>
                  <td
                    style={{
                      backgroundColor: getColor(c.chillTotes),
                    }}
                  >
                    {c.chillTotes}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Section Move Suggestions</h3>
          {moves.length === 0 ? (
            <p>
              No valid section moves found that keep each section at or below 40
              totes.
            </p>
          ) : (
            <ul>
              {moves.map((m, idx) => (
                <li key={idx}>
                  Shipment {m.shipment}: move {m.type} section with{" "}
                  {m.fromSectionTotes} totes from consignment{" "}
                  {m.fromConsignment} to consignment {m.toConsignment} (target
                  section {m.toSectionTotesBefore} → {m.toSectionTotesAfter} totes,
                  max 40).
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
};

export default App;
