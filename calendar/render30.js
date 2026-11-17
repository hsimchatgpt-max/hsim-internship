const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('file://' + process.cwd() + '/calendar_30day.html');
  await p.pdf({ path: 'HSIM_30_Day_YouTube_Calendar.pdf', format: 'A4', landscape: true, printBackground: true, margin: {top:'10mm',bottom:'10mm',left:'10mm',right:'10mm'} });
  await b.close(); })();
