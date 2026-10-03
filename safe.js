"use strict"; // strict mode, does not allow undeclared variables
if (process.argv.length < 3){
    console.error("ERROR: Por favor, ejecutame con un primer argumento que especifique el fichero de logs con el que quieres trabajar.");
    return;
}
    
const lineReader = require('readline').createInterface({
    input: require('fs').createReadStream(process.argv[2]),
    output: process.stdout,
    terminal: false
});
let ignored = new Set();
let reads = new Set();
let nw = 0;
let writes = {}; //writes is and object, not a set.
lineReader.on('line', function (line) {
    let event = JSON.parse(line);
    let result = "good";
    let id = event.id + "_" + event.n;
    if (event.op == "put" && event.tipo_e == "inv") {
        nw++;
        ignored = new Set([...ignored, ...reads]);
        writes[event.valor] = [];
        writes[event.valor].s = event.t;
    }
    else if (event.op == "put" && event.tipo_e == "res") {
        nw--;
        writes[event.valor].t = event.t;
        for (let key in writes) {
            if (writes[key].t < writes[event.valor].s)
                delete writes[key];
        }
    }
    else if (event.op == "get" && event.tipo_e == "inv") {
        reads.add(id);
        if (nw > 0)
            ignored.add(id);
    }
    else if (event.op == "get" && event.tipo_e == "res") {
        let read_id = id;
        reads.delete(read_id);
        if (ignored.has(read_id))
            ignored.delete(read_id);
        else {
            if (writes[event.valor] != undefined && writes[event.valor].t != undefined) { //check if the write of the value exists and if it's finished
                for (let key in writes) {
                    if ( (key != event.valor) && (writes[key].t != undefined) ) //we have to check .f is not undefined because we created unfinished events on  line 18
                        delete writes[key];
                }
            }
            else
                result = "bad";
        }
        console.log('Result for event:', id, 'is: ', result);
    }
});
