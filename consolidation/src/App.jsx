import { useState } from "react";
import Papa from "papaparse";
import "./App.css";
import { enrichRows } from "./utils"; // if you already have this
import { consolidateConsignmentsForShipment } from "./consolidation"; // <-- new import

function App() {
  const [rows, setRows] = useState([]);
  const [moves, setMoves] = useState([]);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const raw = results.data;

        // 1) Enrich rows with ambientTotes / chillTotes, etc.
        const enriched = enrichRows(raw);

        // 2) Group by Shipment
        const byShipment = {};
        enriched.forEach((r) => {
          const key = r.Shipment;
          if (!byShipment[key]) byShipment[key] = [];
          byShipment[key].push({
            id: r.Consignment,
            ambientTotes: r.ambientTotes,
            chillTotes: r.chillTotes,
          });
        });

        // 3) Run consolidation per shipment
        const finalRows = [];
        const allMoves = [];

        Object.entries(byShipment).forEach(([shipmentId, consList]) => {
          const { consignments, moves } =
            consolidateConsignmentsForShipment(consList);

          // Save moves with shipment info
          moves.forEach((m) =>
            allMoves.push({ shipmentId, ...m })
          );

          // Map back to display rows
          consignments.forEach((c) => {
            const original = enriched.find(
              (r) => r.Consignment === c.id && r.Shipment === shipmentId
            );
            if (!original) return;
            finalRows.push({
              ...original,
              ambientTotes: c.ambientTotes,
              chillTotes: c.chillTotes,
            });
          });
        });

        setRows(finalRows);
        setMoves(allMoves);
      },
    });
  };

  return (
    <div className="app">
      <h1>Consignments Consolidator</h1>
      <input type="file" accept=".csv" onChange={handleFile} />

      {/* main table of remaining consignments */}
      {rows.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Shipment</th>
              <th>Consignment</th>
              <th>Ambient totes</th>
              <th>Chill totes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={idx}>
                <td>{r.Shipment}</td>
                <td>{r.Consignment}</td>
                <td>{r.ambientTotes}</td>
                <td>{r.chillTotes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* move list table */}
      {moves.length > 0 && (
        <>
          <h2>Move plan</h2>
          <table>
            <thead>
              <tr>
                <th>Shipment</th>
                <th>From consignment</th>
                <th>To consignment</th>
                <th>Section</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {moves.map((m, idx) => (
                <tr key={idx}>
                  <td>{m.shipmentId}</td>
                  <td>{m.fromId}</td>
                  <td>{m.toId}</td>
                  <td>{m.section}</td>
                  <td>{m.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

export default App;
