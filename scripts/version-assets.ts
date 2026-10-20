import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
const hash=(v:string)=>createHash('sha256').update(v).digest('hex').slice(0,12);
let js=readFileSync('dist/main.js','utf8');
const css=readFileSync('dist/main.css','utf8'),release=hash(js+css);
// A distinct worker URL also avoids an older CDN/browser script cache during upgrades.
js=js.replaceAll('"/sw.js"',JSON.stringify(`/sw.js?v=${release}`));
const jsName=`main.${hash(js)}.js`,cssName=`main.${hash(css)}.css`;
writeFileSync('dist/main.js',js);renameSync('dist/main.js',`dist/${jsName}`);renameSync('dist/main.css',`dist/${cssName}`);
writeFileSync('dist/index.html',readFileSync('dist/index.html','utf8').replaceAll('/main.js',`/${jsName}`).replaceAll('/main.css',`/${cssName}`));
writeFileSync('dist/sw.js',readFileSync('dist/sw.js','utf8').replace('motillo-shell-v3',`motillo-shell-${release}`).replaceAll('/main.js',`/${jsName}`).replaceAll('/main.css',`/${cssName}`));
console.log(`Versioned assets: ${jsName}, ${cssName}`);
