import { readFile, writeFile } from 'node:fs/promises';

const logicPath = new URL('./app.logic.mjs', import.meta.url);
const bankPath = new URL('./saa_c03_tutor_bank.json', import.meta.url);
const logicOutputPath = new URL('./app.logic.browser.js', import.meta.url);
const bankOutputPath = new URL('./saa_c03_tutor_bank.browser.js', import.meta.url);

const logicSource = await readFile(logicPath, 'utf8');
const bankSource = await readFile(bankPath, 'utf8');
const exportedFunctions = [...logicSource.matchAll(/^export function (\w+)/gm)].map((match) => match[1]);

const browserLogic = `(() => {\n${logicSource.replace(/^export /gm, '')}\n\nglobalThis.SaaTutorLogic = {\n  ${exportedFunctions.join(',\n  ')},\n};\n})();\n`;
const browserBank = `globalThis.SAA_C03_TUTOR_BANK = ${bankSource.trim()};\n`;

await Promise.all([
  writeFile(logicOutputPath, browserLogic, 'utf8'),
  writeFile(bankOutputPath, browserBank, 'utf8'),
]);

console.log(`Built browser assets with ${exportedFunctions.length} logic exports.`);
