const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('file://' + process.cwd() + '/calendar.html');
  await p.pdf({ path: 'HSIM_YouTube_Calendar.pdf', format: 'A4', printBackground: true, margin: {top:'14mm',bottom:'14mm',left:'12mm',right:'12mm'} });
  await b.close();
})();
