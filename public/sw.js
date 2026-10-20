const CACHE='motillo-shell-v3';
const SHELL=['/','/index.html','/main.js','/main.css','/manifest.webmanifest','/icon.svg','/icon-192.png','/icon-512.png','/icon-maskable-512.png','/apple-touch-icon.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==location.origin||url.pathname.startsWith('/web/')||url.pathname.startsWith('/api/'))return;
 const key=event.request.mode==='navigate'?'/index.html':SHELL.includes(url.pathname)?event.request:null;
 if(!key)return;
 event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(key,copy)));}return response;}).catch(()=>caches.match(key)));
});
