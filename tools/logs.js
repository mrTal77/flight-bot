// Prints the search-log summary: node tools/logs.js [hours]   (default 24)
const { summarize } = require('../lib/logs');
console.log(summarize(Number(process.argv[2]) || 24).replace(/<\/?b>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
