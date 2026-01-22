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
  const [routes, setRoutes] = useState([]);
  const [draggedSection, setDraggedSection] = useState(null);
  const [routesNeeded, setRoutesNeeded] = useState(0);
  const fileInputRef = useRef(null);

  const handleClear = () => {
    setConsignments([]);
    setMoves([]);
    setRoutes([]);
    setDraggedSection(null);
    setRoutesNeeded(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleDragStart = (consignmentId, sectionType) => {
    setDraggedSection({ id: consignmentId, type: sectionType });
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const removeSectionFromRoutes = (routesState, consId, type) => {
    return routesState.map((r) => ({
      ...r,
      subRoutes: r.subRoutes.map((sr) => ({
        ...sr,
        from:
          sr.from && sr.from.consignmentId === consId && sr.from.type === type
            ? null
            : sr.from,
        tos: sr.tos.filter(
          (t) => !(t.consignmentId === consId && t.type === type)
        ),
      })),
    }));
  };

  const handleDropOnFrom = (routeId, subRouteId) => {
    if (!draggedSection) return;
    const { id, type } = draggedSection;

    setRoutes((prev) => {
      let updated = removeSectionFromRoutes(prev, id, type);
      updated = updated.map((route) => {
        if (route.id !== routeId) return route;
        return {
          ...route,
          subRoutes: route.subRoutes.map((sr) => {
            if (sr.id !== subRouteId) return sr;
            return {
              ...sr,
              from: { consignmentId: id, type },
            };
          }),
        };
      });
      return updated;
    });
    setDraggedSection(null);
  };

  const handleDropOnTo = (routeId, subRouteId) => {
    if (!draggedSection) return;
    const { id, type } = draggedSection;

    setRoutes((prev) => {
      let updated = removeSectionFromRoutes(prev, id, type);
      updated = updated.map((route) => {
        if (route.id !== routeId) return route;
        return {
          ...route,
          subRoutes: route.subRoutes.map((sr) => {
            if (sr.id !== subRouteId) return sr;
            return {
              ...sr,
              tos: [...sr.tos, { consignmentId: id, type }],
            };
          }),
        };
      });
      return updated;
    });
    setDraggedSection(null);
  };

  const handleRemoveFromSubRoute = (routeId, subRouteId, consignmentId, type, role) => {
    setRoutes((prev) =>
      prev.map((route) => {
        if (route.id !== routeId) return route;
        return {
          ...route,
          subRoutes: route.subRoutes.map((sr) => {
            if (sr.id !== subRouteId) return sr;
            if (role === "from") {
              if (
                sr.from &&
                sr.from.consignmentId === consignmentId &&
                sr.from.type === type
              ) {
                return { ...sr, from: null };
              }
              return sr;
            } else {
              return {
                ...sr,
                tos: sr.tos.filter(
                  (t) => !(t.consignmentId === consignmentId && t.type === type)
                ),
              };
            }
          }),
        };
      })
    );
  };

  // NEW CONSOLIDATION LOGIC
  const generateConsolidationSuggestions = (sectionsByShipment, routesNeeded) => {
    const suggestions = [];
    const maxPerSection = 40;

    // For each shipment, generate suggestions based on routes needed
    Object.entries(sectionsByShipment).forEach(([shipment, sections]) => {
      // Separate by type
      const ambientSections = sections
        .filter((s) => s.type === "ambient" && s.totes > 0)
        .map((s) => ({ ...s, shipment }));
      const chillSections = sections
        .filter((s) => s.type === "chill" && s.totes > 0)
        .map((s) => ({ ...s, shipment }));

      // Generate suggestions for ambient
      if (routesNeeded > 0) {
        const ambientSuggestions = generateTypeSuggestions(
          ambientSections,
          routesNeeded,
          maxPerSection,
          "ambient"
        );
        suggestions.push(...ambientSuggestions);
      }

      // Generate suggestions for chill
      if (routesNeeded > 0) {
        const chillSuggestions = generateTypeSuggestions(
          chillSections,
          routesNeeded,
          maxPerSection,
          "chill"
        );
        suggestions.push(...chillSuggestions);
      }
    });

    return suggestions;
  };

  const generateTypeSuggestions = (sections, routesNeeded, maxTotes, type) => {
    const suggestions = [];
    
    // Step 1: Find 2N lowest tote sections (N = routes needed)
    const sortedSections = [...sections].sort((a, b) => a.totes - b.totes);
    const numLowestNeeded = Math.min(routesNeeded * 2, sortedSections.length);
    const lowestSections = sortedSections.slice(0, numLowestNeeded);

    // Step 2: For each lowest section, find suitable target
    for (let i = 0; i < lowestSections.length; i++) {
      const sourceSection = lowestSections[i];
      
      // Available space after adding source = 40 - source.totes
      const availableSpace = maxTotes - sourceSection.totes;
      
      // Find target: sections with totes <= availableSpace OR exactly source.totes
      const potentialTargets = sections.filter((target) => 
        target.consignment !== sourceSection.consignment &&
        (target.totes <= availableSpace || target.totes === sourceSection.totes)
      );

      if (potentialTargets.length > 0) {
        // Pick the largest suitable target (best fit)
        const bestTarget = potentialTargets.reduce((best, current) => 
          current.totes > best.totes ? current : best
        );

        suggestions.push({
          shipment: sourceSection.shipment,
          type,
          fromConsignment: sourceSection.consignment,
          toConsignment: bestTarget.consignment,
          fromSectionTotes: sourceSection.totes,
          toSectionTotesBefore: bestTarget.totes,
          toSectionTotesAfter: sourceSection.totes + bestTarget.totes,
        });

        // Remove used sections to avoid duplicates
        sections = sections.filter(s => 
          s.consignment !== sourceSection.consignment && 
          s.consignment !== bestTarget.consignment
        );
      }
    }

    return suggestions;
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

        // Calculate routes needed
        const uniqueConsignments = new Set(
          consignmentSummaries.map((c) => c.consignment)
        );
        const count = uniqueConsignments.size;
        let needed = 0;
        if (count > 9) {
          needed = count - 9;
        }

        // Create routes structure
        const newRoutes = [];
        for (let i = 1; i <= needed; i++) {
          newRoutes.push({
            id: i,
            subRoutes: [
              { id: 1, from: null, tos: [] },
              { id: 2, from: null, tos: [] },
            ],
          });
        }

        // NEW: Generate consolidation suggestions based on routes needed
        const consolidationSuggestions = generateConsolidationSuggestions(
          sectionsByShipment,
          needed
        );

        setConsignments(consignmentSummaries);
        setMoves(consolidationSuggestions);
        setRoutes(newRoutes);
        setRoutesNeeded(needed);
        setDraggedSection(null);
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

  const ambientMoves = moves.filter((m) => m.type === "ambient");
  const chillMoves = moves.filter((m) => m.type === "chill");

  const isSectionUsedAnywhere = (consignmentId, sectionType) => {
    return routes.some((route) =>
      route.subRoutes.some((sr) => {
        const fromUsed =
          sr.from &&
          sr.from.consignmentId === consignmentId &&
          sr.from.type === sectionType;
        const toUsed = sr.tos.some(
          (t) => t.consignmentId === consignmentId && t.type === sectionType
        );
        return fromUsed || toUsed;
      })
    );
  };

  return (
    <div className="app">
      <div className="app-inner">
        <header className="app-header">
          <h1>Consignment Consolidation Tool</h1>
          <p className="app-subtitle">
            Upload a CSV file to view consignment loads, consolidation suggestions, and routes.
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
                          title="Drag ambient section to a route"
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
                          title="Drag chill section to a route"
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

            {/* 2nd card: Routes + Ambient + Chill */}
            <div className="card card-right">
              <div className="right-columns">
                {/* Routes column */}
                <div className="panel routes-panel">
                  <h3>
                    Routes{" "}
                    {routesNeeded > 0
                      ? `(needed: ${routesNeeded})`
                      : "(no consolidation routes needed)"}
                  </h3>
                  {routesNeeded === 0 ? (
                    <p className="empty-text">
                      Total consignments ≤ 9. No additional consolidation routes are required.
                    </p>
                  ) : (
                    <>
                      <p className="grouping-subtitle">
                        Each route has 2 sub‑routes. Drag one section into <strong>From</strong> and one or more into <strong>To</strong>.
                      </p>
                      <div className="routes-column">
                        {routes.map((route) => (
                          <div key={route.id} className="route-card">
                            <div className="route-header">Route {route.id}</div>
                            <div className="route-subroutes">
                              {route.subRoutes.map((sr) => (
                                <div key={sr.id} className="subroute-card">
                                  <div className="subroute-title">
                                    Sub‑route {sr.id}
                                  </div>
                                  <div className="from-to-row">
                                    <div
                                      className="subroute-slot from-slot"
                                      onDrop={() =>
                                        handleDropOnFrom(route.id, sr.id)
                                      }
                                      onDragOver={handleDragOver}
                                    >
                                      <div className="slot-label">From</div>
                                      {sr.from ? (
                                        <div className="slot-item from">
                                          <span>
                                            {sr.from.consignmentId} (
                                            {sr.from.type})
                                          </span>
                                          <button
                                            className="remove-btn"
                                            onClick={() =>
                                              handleRemoveFromSubRoute(
                                                route.id,
                                                sr.id,
                                                sr.from.consignmentId,
                                                sr.from.type,
                                                "from"
                                              )
                                            }
                                            title="Remove from"
                                          >
                                            ✕
                                          </button>
                                        </div>
                                      ) : (
                                        <div className="slot-empty">
                                          Drop a section here
                                        </div>
                                      )}
                                    </div>

                                    <div className="from-to-arrow">─────&gt;</div>

                                    <div
                                      className="subroute-slot to-slot"
                                      onDrop={() =>
                                        handleDropOnTo(route.id, sr.id)
                                      }
                                      onDragOver={handleDragOver}
                                    >
                                      <div className="slot-label">To</div>
                                      {sr.tos.length === 0 ? (
                                        <div className="slot-empty">
                                          Drop sections here (multiple allowed)
                                        </div>
                                      ) : (
                                        <ul className="slot-list">
                                          {sr.tos.map((t, idx) => (
                                            <li
                                              key={`${t.consignmentId}-${t.type}-${idx}`}
                                              className={`slot-item ${t.type}`}
                                            >
                                              <span>
                                                {t.consignmentId} ({t.type})
                                              </span>
                                              <button
                                                className="remove-btn"
                                                onClick={() =>
                                                  handleRemoveFromSubRoute(
                                                    route.id,
                                                    sr.id,
                                                    t.consignmentId,
                                                    t.type,
                                                    "to"
                                                  )
                                                }
                                                title="Remove to"
                                              >
                                                ✕
                                              </button>
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {/* Ambient and Chill columns */}
                <div className="panel small-panel">
                  <h3>Ambient consolidation</h3>
                  {ambientMoves.length === 0 ? (
                    <p className="empty-text">
                      No ambient consolidation suggestions.
                    </p>
                  ) : (
                    <table>
                      <thead>
                        <tr>
                          <th>Move</th>
                          <th>To</th>
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

                <div className="panel small-panel">
                  <h3>Chill consolidation</h3>
                  {chillMoves.length === 0 ? (
                    <p className="empty-text">
                      No chill consolidation suggestions.
                    </p>
                  ) : (
                    <table>
                      <thead>
                        <tr>
                          <th>Move</th>
                          <th>To</th>
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
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
