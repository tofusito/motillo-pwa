// Run with the bundled dependency runtime or install sharp locally.
const fs=require('node:fs/promises');
const sharp=require(process.env.SHARP_MODULE || 'sharp');
(async()=>{const src=await fs.readFile('assets/motillo-icon.svg');for(const [file,size] of [['apple-touch-icon.png',180],['icon-192.png',192],['icon-512.png',512],['icon-maskable-512.png',512]])await sharp(src).resize(size,size).png().toFile('public/'+file);await fs.copyFile('assets/motillo-icon.svg','public/icon.svg');})();
