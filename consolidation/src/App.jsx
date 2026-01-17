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
  const [groups, setGroups] = useState({
    1: [],
    2: [],
    3: [],
    4: [],
    5: [],
  });
  const [draggedConsignment, setDraggedConsignment] = useState(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingGroup, setPendingGroup] = useState(null);
  const [assignedTypes, setAssignedTypes] = useState({}); // { "consignment-group": "ambient|chill" }
  const fileInputRef = useRef(null);

  const handleClear = () => {
    setConsignments([]);
    setMoves([]);
    setGroups({ 1: [], 2: [], 3: [], 4: [], 5: [] });
    setDraggedConsignment(null);
    setShowConfirmDialog(false);
    setPendingGroup(null);
    setAssignedTypes({});
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleDragStart = (consignmentId, sectionType) => {
    // FIXED: Check section-specific assignment, not consignment-level
    const isSectionAssigned = Object.entries(groups).some(([groupNum, group]) => {
      const key = `${consignmentId}-${groupNum}`;
      const assignmentType = assignedTypes[key];
      return group.includes(consignmentId) && assignmentType === sectionType;
    });
    
    if (isSectionAssigned) return;
    setDraggedConsignment({ id: consignmentId, type: sectionType });
  };

  const handleDropOnGroup = (groupNumber) => {
    if (!draggedConsignment) return;
    setPendingGroup(groupNumber);
    setShowConfirmDialog(true);
  };

  const handleConfirmAssignment = (type) => {
    if (!draggedConsignment || !pendingGroup) return;

    const { id: consignmentId } = draggedConsignment;

    setGroups((prev) => {
      if (prev[pendingGroup].includes(consignmentId)) return prev;
      const updated = { ...prev };
      updated[pendingGroup] = [...updated[pendingGroup], consignmentId];
      return updated;
    });

    setAssignedTypes((prev) => ({
      ...prev,
      [`${consignmentId}-${pendingGroup}`]: type,
    }));

    setShowConfirmDialog(false);
    setPendingGroup(null);
    setDraggedConsignment(null);
  };

  const handleRemoveFromGroup = (consignmentId, groupNumber) => {
    setGroups((prev) => {
      const updated = { ...prev };
      updated[groupNumber] = updated[groupNumber].filter(id => id !== consignmentId);
      return updated;
    });

    setAssignedTypes((prev) => {
      const updated = { ...prev };
      delete updated[`${consignmentId}-${groupNumber}`];
      return updated;
    });
  };

  const handleDragOver = (e) => {
    e.preventDefault();
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
        setAssignedTypes({});
      },
    });
  };

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

  const getAssignmentStatus = (consignment, groupNum) => {
    const key = `${consignment}-${groupNum}`;
    return assignedTypes[key];
  };

  // FIXED: Check section-specific assignment
  const isSectionAssigned = (consignment, sectionType) => {
    return Object.entries(groups).some(([groupNum, group]) => {
      const key = `${consignment}-${groupNum}`;
      const assignmentType = assignedTypes[key];
      return group.includes(consignment) && assignmentType === sectionType;
    });
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
          <div className="main-content">
            {/* TOP ROW: Consignment Summary + Consolidation Groups */}
            <div className="top-row">
              <div className="panel summary-group">
                <div className="panel-content">
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
                        const hasAmbientAssignment = [1,2,3,4,5].some(g => getAssignmentStatus(c.consignment, g) === 'ambient');
                        const hasChillAssignment = [1,2,3,4,5].some(g => getAssignmentStatus(c.consignment, g) === 'chill');
                        const ambientAssigned = isSectionAssigned(c.consignment, 'ambient');
                        const chillAssigned = isSectionAssigned(c.consignment, 'chill');
                        
                        return (
                          <tr key={c.id}>
                            <td>{c.shipment}</td>
                            <td className="consignment-cell">
                              {c.consignment}
                              {(ambientAssigned || chillAssigned) && <span className="assigned-badge">✓</span>}
                            </td>
                            <td 
                              className={`tote ${getColorClass(c.ambientTotes)} ${hasAmbientAssignment ? 'assigned' : ''}`}
                              draggable={!ambientAssigned}
                              onDragStart={!ambientAssigned ? () => handleDragStart(c.consignment, 'ambient') : undefined}
                              title={!ambientAssigned ? "Drag ambient section to group" : "Ambient section assigned"}
                              style={{ cursor: ambientAssigned ? 'default' : 'grab' }}
                            >
                              {c.ambientTotes}
                              {hasAmbientAssignment && <span className="tick-mark">✓</span>}
                            </td>
                            <td 
                              className={`tote ${getColorClass(c.chillTotes)} ${hasChillAssignment ? 'assigned' : ''}`}
                              draggable={!chillAssigned}
                              onDragStart={!chillAssigned ? () => handleDragStart(c.consignment, 'chill') : undefined}
                              title={!chillAssigned ? "Drag chill section to group" : "Chill section assigned"}
                              style={{ cursor: chillAssigned ? 'default' : 'grab' }}
                            >
                              {c.chillTotes}
                              {hasChillAssignment && <span className="tick-mark">✓</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="panel grouping-panel">
                <h3>Consolidation Groups (Max 5)</h3>
                <p className="grouping-subtitle">
                  Drag consignment sections above into groups. Click ✕ to remove.
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
                          {groups[num].map((consId, idx) => {
                            const type = getAssignmentStatus(consId, num);
                            return (
                              <li key={`${consId}-${idx}`} className={`group-item ${type || ''}`}>
                                <span className="group-item-content">
                                  {consId} {type && <span className="group-type">({type})</span>}
                                </span>
                                <button
                                  className="remove-btn"
                                  onClick={() => handleRemoveFromGroup(consId, num)}
                                  title="Remove from group"
                                >
                                  ✕
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* BOTTOM ROW: Ambient + Chill sections */}
            <div className="bottom-row">
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
          </div>
        )}

        {/* CONFIRMATION DIALOG */}
        {showConfirmDialog && draggedConsignment && pendingGroup && (
          <div className="confirm-dialog-overlay">
            <div className="confirm-dialog">
              <h4>Assign to Group {pendingGroup}</h4>
              <p>Consignment: <strong>{draggedConsignment.id}</strong></p>
              <p>Section: <strong>{draggedConsignment.type}</strong></p>
              <p>Confirm assignment?</p>
              <div className="confirm-buttons">
                <button 
                  className="btn btn-primary" 
                  onClick={() => handleConfirmAssignment(draggedConsignment.type)}
                >
                  Assign ✓
                </button>
                <button 
                  className="btn btn-cancel" 
                  onClick={() => {
                    setShowConfirmDialog(false);
                    setPendingGroup(null);
                    setDraggedConsignment(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
