"use strict";
// Verificador de consistencia atomica (offline) basado en el algoritmo GK (Gibbons y Korach).
// Uso: node atomic.js fichero_de_eventos.txt
const fs = require("fs");

if (process.argv.length < 3) {
    console.error("ERROR: indica el fichero de eventos. Ejemplo: node atomic.js pruebaA1.txt");
    process.exit(1);
}

// 1. Leer eventos (un JSON por linea, se ignoran lineas vacias)
const lines = fs.readFileSync(process.argv[2], "utf8").split(/\r?\n/).filter(l => l.trim() !== "");
const events = lines.map(l => JSON.parse(l));

// 2. Emparejar inv/res por (id, n) y construir operaciones, agrupadas por clave
const opsByKey = {};      // clave -> { "id_n": op }
for (const e of events) {
    const opId = e.id + "_" + e.n;
    const k = e.clave;
    if (!opsByKey[k]) opsByKey[k] = {};
    if (!opsByKey[k][opId]) opsByKey[k][opId] = { id: opId, tipo: e.op, s: Infinity, f: Infinity, valor: null };
    const op = opsByKey[k][opId];
    if (e.tipo_e === "inv") {
        op.s = e.t;
        if (e.op === "put") op.valor = e.valor;   // el valor de un put se conoce en la invocacion
    } else {
        op.f = e.t;
        if (e.op === "get") op.valor = e.valor;   // el valor de un get se conoce en la respuesta
    }
}

// 3. Verificar cada clave por separado
let historiaAtomica = true;
for (const clave of Object.keys(opsByKey)) {
    const ops = Object.values(opsByKey[clave]);
    const writes = {};   // valor -> op de escritura
    for (const op of ops) if (op.tipo === "put") writes[op.valor] = op;

    const problemas = [];

    // Condiciones (1) y (2): cada lectura tiene escritura dictadora y no la precede en el tiempo
    for (const op of ops) {
        if (op.tipo !== "get") continue;
        const w = writes[op.valor];
        if (!w) problemas.push("La lectura " + op.id + " devuelve '" + op.valor + "' y no existe su escritura dictadora");
        else if (op.f < w.s) problemas.push("La lectura " + op.id + " precede a su escritura dictadora " + w.id);
    }

    // Clusters y zonas (solo de valores con escritura dictadora)
    const zonas = [];
    for (const v of Object.keys(writes)) {
        const cluster = ops.filter(op => op.valor === v);   // la escritura + sus lecturas
        const f = Math.min(...cluster.map(op => op.f));      // minimo tiempo de fin
        const sMax = Math.max(...cluster.map(op => op.s));   // maximo tiempo de inicio
        const forward = f < sMax;
        zonas.push({ valor: v, forward, l: forward ? f : sMax, r: forward ? sMax : f });
    }

    // Condicion (3): todos los pares de zonas deben ser compatibles
    for (let i = 0; i < zonas.length; i++) {
        for (let j = i + 1; j < zonas.length; j++) {
            const A = zonas[i], B = zonas[j];
            if (A.forward && B.forward && A.l < B.r && B.l < A.r)
                problemas.push("Conflicto: zonas forward solapadas (" + A.valor + " y " + B.valor + ")");
            else if (A.forward && !B.forward && A.l < B.l && B.r < A.r)
                problemas.push("Conflicto: la zona backward de " + B.valor + " esta contenida en la forward de " + A.valor);
            else if (B.forward && !A.forward && B.l < A.l && A.r < B.r)
                problemas.push("Conflicto: la zona backward de " + A.valor + " esta contenida en la forward de " + B.valor);
        }
    }

    console.log("Clave '" + clave + "':");
    for (const z of zonas)
        console.log("  Zona(" + z.valor + ") = " + (z.forward ? "forward " : "backward") + " [" + z.l + ", " + z.r + "]");
    if (problemas.length === 0) console.log("  Resultado: good (historia atomica)");
    else {
        historiaAtomica = false;
        problemas.forEach(p => console.log("  - " + p));
        console.log("  Resultado: bad (NO es atomica)");
    }
}
process.exitCode = historiaAtomica ? 0 : 2;