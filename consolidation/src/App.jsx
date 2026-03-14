import Papa from "papaparse";
import React, { useState, useRef } from "react";
import "./App.css";

// Generic parser that can return either numerator or denominator
// Examples (numerator / denominator):
// "16/17" -> numerator=16, denominator=17
// "0/7"   -> numerator=0,  denominator=7
// "Apr-32" / "6-Jan" -> returns 32 or 6 as single number
const parseTotes = (value, { useDenominator = false } = {}) => {
  if (value == null) return 0;
  const str = String(value).trim();
  if (!str) return 0;

  // If it looks like "A/B" (possibly with spaces) use numerator/denominator
  const slashMatch = str.match(/(\d+)\s*\/\s*(\d+)/);
  if (slashMatch) {
    const numerator = Number(slashMatch[1]);
    const denominator = Number(slashMatch[2]);
    const n = useDenominator ? denominator : numerator;
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  // Otherwise: take the first positive integer in the string
  const match = str.match(/\d+/);
  if (!match) return 0;
  const n = Number(match[0]);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

// Helper: color based on totes
const getColorClass = (totes) => {
  if (totes < 20) return "green";
  if (totes < 30) return "orange";
  return "red";
};

const App = () => {
  const [consignments, setConsignments] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [routes, setRoutes] = useState([]);
  const [draggedSection, setDraggedSection] = useState(null);
  const [routesNeeded, setRoutesNeeded] = useState(0);
  const fileInputRef = useRef(null);

  const handleClear = () => {
    setConsignments([]);
    setSuggestions([]);
    setRoutes([]);
    setDraggedSection(null);
    setRoutesNeeded(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleDragStart = (consignmentId, sectionType, totes) => {
    setDraggedSection({ id: consignmentId, type: sectionType, totes });
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
    const { id, type, totes } = draggedSection;

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
              from: { consignmentId: id, type, totes },
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
    const { id, type, totes } = draggedSection;

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
              tos: [...sr.tos, { consignmentId: id, type, totes }],
            };
          }),
        };
      });
      return updated;
    });
    setDraggedSection(null);
  };

  const handleRemoveFromSubRoute = (
    routeId,
    subRouteId,
    consignmentId,
    type,
    role
  ) => {
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
                  (t) =>
                    !(t.consignmentId === consignmentId && t.type === type)
                ),
              };
            }
          }),
        };
      })
    );
  };

  const generateConsolidationSuggestions = (sectionsByShipment, routesNeeded) => {
    if (routesNeeded <= 0) return [];

    const MAX_CAPACITY = 40;
    const groupedSuggestions = [];
    const usedSectionIds = new Set();

    let allSections = [];
    Object.values(sectionsByShipment).forEach((sections) => {
      sections.forEach((section) => {
        if (section.totes > 0) {
          allSections.push({
            ...section,
            simulatedTotes: section.totes,
            id: section.sectionId,
            isSource: false,
          });
        }
      });
    });

    allSections.sort((a, b) => a.totes - b.totes);

    const countToEmpty = routesNeeded * 2;
    const sources = [];

    for (let i = 0; i < allSections.length && sources.length < countToEmpty; i++) {
      allSections[i].isSource = true;
      usedSectionIds.add(allSections[i].id);
      sources.push(allSections[i]);
    }

    sources.forEach((source) => {
      let totesToMove = source.totes;
      const moves = [];

      while (totesToMove > 0) {
        let candidates = allSections.filter(
          (s) =>
            !s.isSource &&
            !usedSectionIds.has(s.id) &&
            s.simulatedTotes < MAX_CAPACITY
        );

        if (candidates.length === 0) {
          moves.push({
            toConsignment: "NO AVAILABLE SECTION",
            toType: "N/A",
            qty: totesToMove,
          });
          totesToMove = 0;
          break;
        }

        candidates.forEach((c) => {
          c.spaceAvailable = MAX_CAPACITY - c.simulatedTotes;
        });

        let bestTarget = null;
        let candidatesThatFitAll = candidates.filter(
          (c) => c.spaceAvailable >= totesToMove
        );

        if (candidatesThatFitAll.length > 0) {
          candidatesThatFitAll.sort((a, b) => a.spaceAvailable - b.spaceAvailable);
          bestTarget = candidatesThatFitAll[0];
        } else {
          candidates.sort((a, b) => b.spaceAvailable - a.spaceAvailable);
          bestTarget = candidates[0];
        }

        if (bestTarget) {
          const moveAmount = Math.min(totesToMove, bestTarget.spaceAvailable);

          moves.push({
            toConsignment: bestTarget.consignment,
            toType: bestTarget.type,
            qty: moveAmount,
            newTotal: bestTarget.simulatedTotes + moveAmount,
          });

          usedSectionIds.add(bestTarget.id);
          bestTarget.simulatedTotes += moveAmount;
          totesToMove -= moveAmount;
        }
      }

      groupedSuggestions.push({
        sourceConsignment: source.consignment,
        sourceType: source.type,
        totalQty: source.totes,
        moves: moves,
      });
    });

    return groupedSuggestions;
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

        const uniqueConsignments = new Set(
          consignmentSummaries.map((c) => c.consignment)
        );
        const count = uniqueConsignments.size;
        let needed = 0;
        if (count > 9) {
          needed = count - 9;
        }

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

        const newSuggestions = generateConsolidationSuggestions(
          sectionsByShipment,
          needed
        );

        setConsignments(consignmentSummaries);
        setSuggestions(newSuggestions);
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

    // Ambient: now use denominator (total totes)
    const ambientTotes = parseTotes(row["Completed Totes - Ambient"], {
      useDenominator: true,
    });

    // Chill & Freezer: still denominator (total totes)
    const chilledTotes = parseTotes(row["Completed Totes - Chilled"], {
      useDenominator: true,
    });
    const freezerTotes = parseTotes(row["Completed Totes - Freezer"], {
      useDenominator: true,
    });
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
        sectionId: `${cons}_amb_${idx}`,
        consignment: cons,
        type: "ambient",
        totes: ambientTotes,
      });
    }

    if (chillTotal > 0) {
      sectionsByShipment[shipment].push({
        sectionId: `${cons}_chi_${idx}`,
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
                            handleDragStart(
                              c.consignment,
                              "ambient",
                              c.ambientTotes
                            )
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
                            handleDragStart(
                              c.consignment,
                              "chill",
                              c.chillTotes
                            )
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

            <div className="card card-right">
              <div className="right-columns">
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
                                            <strong>{sr.from.totes}</strong> Totes -{" "}
                                            {sr.from.consignmentId} ({sr.from.type})
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
                                                <strong>{t.totes}</strong> Totes -{" "}
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

                <div className="panel small-panel">
                  <h3>Consolidation Suggestions</h3>
                  {suggestions.length === 0 ? (
                    <p className="empty-text">No consolidation suggestions.</p>
                  ) : (
                    <table className="suggestion-table">
                      <thead>
                        <tr>
                          <th>Move From</th>
                          <th>To (Available Sections)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {suggestions.map((s, idx) => (
                          <tr key={idx}>
                            <td className="from-cell">
                              <div className="cons-name">{s.sourceConsignment}</div>
                              <div className="cons-meta">
                                {s.sourceType} • <strong>{s.totalQty}</strong> totes
                              </div>
                            </td>
                            <td className="to-cell">
                              {s.moves.map((m, mIdx) => (
                                <div key={mIdx} className="move-item">
                                  <span className="arrow">↳</span>
                                  <span className="qty-badge">{m.qty}</span>
                                  <span>
                                    {" "}
                                    to <strong>{m.toConsignment}</strong> ({m.toType})
                                  </span>
                                </div>
                              ))}
                            </td>
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
