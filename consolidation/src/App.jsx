import Papa from "papaparse";
import React, { useState, useRef } from "react";
import "./App.css";

// Helper: parse "0/30" -> 30
const parseTotes = (value) => {
  if (!value) return 0;
  const parts = String(value).split("/");
  const denom = parts[1] ?? parts[0];
  const n = parseInt(denom, 10);
  return Number.isNaN(n) ? 0 : n;
};

// Helper: color based on totes
const getColorClass = (totes) => {
  if (totes < 20) return "green";
  if (totes < 30) return "orange";
  return "red";
};

const App = () => {
  const [consignments, setConsignments] = useState([]);
  const [moves, setMoves] = useState([]);
  const fileInputRef = useRef(null);

  const handleClear = () => {
    setConsignments([]);
    setMoves([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

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

      const active = sections.map((s) => ({ ...s }));
      active.sort((a, b) => a.totes - b.totes);

      const usedSource = new Set();

      for (let i = 0; i < active.length; i++) {
        const source = active[i];
        if (usedSource.has(source.sectionId)) continue;

        for (let j = 0; j < active.length; j++) {
          if (i === j) continue;
          const target = active[j];

          if (target.consignment === source.consignment) continue;
          if (target.type !== source.type) continue;

          const combined = target.totes + source.totes;
          if (combined <= maxPerSection) {
            suggestions.push({
              shipment,
              type: source.type, // "ambient" or "chill"
              fromConsignment: source.consignment,
              toConsignment: target.consignment,
              fromSectionTotes: source.totes,
              toSectionTotesBefore: target.totes,
              toSectionTotesAfter: combined,
            });

            target.totes = combined;
            usedSource.add(source.sectionId);
            break;
          }
        }
      }
    });

    return suggestions;
  };

  // Split moves for display
  const ambientMoves = moves.filter((m) => m.type === "ambient");
  const chillMoves = moves.filter((m) => m.type === "chill");

  return (
    <div className="app">
      <div className="app-inner">
        <header className="app-header">
          <h1>Consignment Consolidation Tool</h1>
          <p className="app-subtitle">
            Upload a CSV file to view consignment loads and suggested section moves.
          </p>
        </header>

        <div className="controls">
          <input
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            ref={fileInputRef}
          />
          <button className="btn btn-secondary" onClick={handleClear}>
            Clear
          </button>
        </div>

        {consignments.length > 0 && (
          <div className="panels">
            {/* Consignment summary */}
            <div className="panel">
              <h3>Consignment Summary</h3>
              <table>
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
                      <td className={`tote ${getColorClass(c.ambientTotes)}`}>
                        {c.ambientTotes}
                      </td>
                      <td className={`tote ${getColorClass(c.chillTotes)}`}>
                        {c.chillTotes}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Ambient moves table */}
            <div className="panel">
              <h3>Ambient section</h3>
              {ambientMoves.length === 0 ? (
                <p className="empty-text">
                  No ambient section moves that keep each section ≤ 40 totes.
                </p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Source consignment</th>
                      <th>Destination consignment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ambientMoves.map((m, idx) => (
                      <tr key={idx}>
                        <td>{m.fromConsignment}</td>
                        <td>{m.toConsignment}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Chill moves table */}
            <div className="panel">
              <h3>Chill section</h3>
              {chillMoves.length === 0 ? (
                <p className="empty-text">
                  No chill section moves that keep each section ≤ 40 totes.
                </p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Source consignment</th>
                      <th>Destination consignment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chillMoves.map((m, idx) => (
                      <tr key={idx}>
                        <td>{m.fromConsignment}</td>
                        <td>{m.toConsignment}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
