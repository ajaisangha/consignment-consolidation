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
  // groups: { 1: [{consignmentId, type}], ... }
  const [groups, setGroups] = useState({
    1: [],
    2: [],
    3: [],
    4: [],
    5: [],
  });
  // draggedSection: { id, type } where type = 'ambient' | 'chill'
  const [draggedSection, setDraggedSection] = useState(null);
  const fileInputRef = useRef(null);

  const handleClear = () => {
    setConsignments([]);
    setMoves([]);
    setGroups({ 1: [], 2: [], 3: [], 4: [], 5: [] });
    setDraggedSection(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Start dragging a specific section of a consignment
  const handleDragStart = (consignmentId, sectionType) => {
    setDraggedSection({ id: consignmentId, type: sectionType });
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  // Drop into group: auto-assign; each section type can only belong to ONE group
  const handleDropOnGroup = (groupNumber) => {
    if (!draggedSection) return;
    const { id, type } = draggedSection;

    setGroups((prev) => {
      // Remove this section type from any existing group first
      const cleaned = Object.fromEntries(
        Object.entries(prev).map(([gNum, items]) => [
          gNum,
          items.filter(
            (item) => !(item.consignmentId === id && item.type === type)
          ),
        ])
      );

      // Add to target group (if not already there with same type)
      const targetItems = cleaned[groupNumber];
      const alreadyThere = targetItems.some(
        (item) => item.consignmentId === id && item.type === type
      );
      if (!alreadyThere) {
        cleaned[groupNumber] = [
          ...targetItems,
          { consignmentId: id, type },
        ];
      }

      return cleaned;
    });

    setDraggedSection(null);
  };

  const handleRemoveFromGroup = (consignmentId, groupNumber) => {
    setGroups((prev) => {
      const updated = { ...prev };
      updated[groupNumber] = updated[groupNumber].filter(
        (item) => item.consignmentId !== consignmentId
      );
      return updated;
    });
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
        setGroups({ 1: [], 2: [], 3: [], 4: [], 5: [] });
        setDraggedSection(null);
      },
    });
  };

  // Build consignments and sections
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

  // Moves suggestion (unchanged)
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
              type: source.type,
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

  const ambientMoves = moves.filter((m) => m.type === "ambient");
  const chillMoves = moves.filter((m) => m.type === "chill");

  // Check if a consignment has its ambient/chill used in ANY group
  const isSectionUsedAnywhere = (consignmentId, sectionType) => {
    return Object.values(groups).some((items) =>
      items.some(
        (item) =>
          item.consignmentId === consignmentId && item.type === sectionType
      )
    );
  };

  // For groups UI: get type for a consignment in a specific group
  const getTypeInGroup = (consignmentId, groupNum) => {
    const entry = groups[groupNum].find(
      (item) => item.consignmentId === consignmentId
    );
    return entry ? entry.type : null;
  };

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
          <div className="layout-row">
            {/* 1st card: Consignment Summary */}
            <div className="card card-summary">
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
                  {consignments.map((c) => {
                    const ambientUsed = isSectionUsedAnywhere(
                      c.consignment,
                      "ambient"
                    );
                    const chillUsed = isSectionUsedAnywhere(
                      c.consignment,
                      "chill"
                    );

                    return (
                      <tr key={c.id}>
                        <td>{c.shipment}</td>
                        <td className="consignment-cell">
                          {c.consignment}
                          {(ambientUsed || chillUsed) && (
                            <span className="assigned-badge">✓</span>
                          )}
                        </td>

                        <td
                          className={`tote ${getColorClass(
                            c.ambientTotes
                          )} ${ambientUsed ? "assigned" : ""}`}
                          draggable
                          onDragStart={() =>
                            handleDragStart(c.consignment, "ambient")
                          }
                          title="Drag ambient section to a group"
                          style={{ cursor: "grab" }}
                        >
                          {c.ambientTotes}
                          {ambientUsed && <span className="tick-mark">✓</span>}
                        </td>

                        <td
                          className={`tote ${getColorClass(
                            c.chillTotes
                          )} ${chillUsed ? "assigned" : ""}`}
                          draggable
                          onDragStart={() =>
                            handleDragStart(c.consignment, "chill")
                          }
                          title="Drag chill section to a group"
                          style={{ cursor: "grab" }}
                        >
                          {c.chillTotes}
                          {chillUsed && <span className="tick-mark">✓</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 2nd card: Ambient + Chill + Groups */}
            <div className="card card-right">
              <div className="top-two">
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

              <div className="panel groups-panel">
                <h3>Consolidation Groups (Max 5)</h3>
                <p className="grouping-subtitle">
                  Drag ambient/chill sections from the summary into groups. Each
                  section can be in only one group. Click ✕ to remove.
                </p>
                <div className="groups-row">
                  {[1, 2, 3, 4, 5].map((num) => (
                    <div
                      key={num}
                      className="group-card"
                      onDrop={() => handleDropOnGroup(num)}
                      onDragOver={handleDragOver}
                    >
                      <div className="group-header">Group {num}</div>
                      {groups[num].length === 0 ? (
                        <div className="group-empty">Drop here</div>
                      ) : (
                        <ul className="group-list">
                          {groups[num].map((item, idx) => (
                            <li
                              key={`${item.consignmentId}-${item.type}-${idx}`}
                              className={`group-item ${item.type}`}
                            >
                              <span className="group-item-content">
                                {item.consignmentId}{" "}
                                <span className="group-type">
                                  ({item.type})
                                </span>
                              </span>
                              <button
                                className="remove-btn"
                                onClick={() =>
                                  handleRemoveFromGroup(
                                    item.consignmentId,
                                    num
                                  )
                                }
                                title="Remove from group"
                              >
                                ✕
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
