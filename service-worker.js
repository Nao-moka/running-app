const CACHE='run-pwa-v0.2';
const ASSETS=['./','./index.html','./style.css','./app.js','./manifest.json'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;const u=new URL(e.request.url);if(u.hostname==='tile.openstreetmap.org'||u.hostname==='unpkg.com')return;e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request)))});
