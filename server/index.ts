import {mkdirSync,chmodSync} from 'node:fs';
import {Store} from './store';
import {History} from './history';
import {Connector,connectorEntities} from './connector';
import {fetchPvpc,pvpcRate} from './pvpc';
import {local} from './pricing';
import {createHandler} from './api';
const dir=process.env.DATA_DIR??'./data';mkdirSync(dir,{recursive:true});
const store=new Store(`${dir}/motillo.sqlite`,process.env.DAILY_ENERGY_RESET==='true'),source=new Connector(process.env.MEROSS_CONNECTOR_URL??'',process.env.CONNECTOR_TOKEN??'');let polling=false;chmodSync(`${dir}/motillo.sqlite`,0o600);
// A new installation uses the connector's stable aliases; existing capture settings remain intact.
if(!store.settings().powerEntity&&process.env.MEROSS_DEVICE_ID)store.setSettings({...store.settings(),powerEntity:connectorEntities[0]!.id,energyEntity:connectorEntities[1]!.id,plugEntity:connectorEntities[2]!.id});
let pricingPolling=false;async function pollPricing(){if(pricingPolling)return;pricingPolling=true;try{for(const rate of store.rates().filter(r=>r.mode==='pvpc'&&r.month===local(Date.now()).month)){try{const hourly=await fetchPvpc(rate.month);if(store.rates().find(r=>r.month===rate.month)?.mode==='pvpc')store.setRate(pvpcRate(rate.month,{...rate.hourly,...hourly}));}catch{console.warn('PVPC refresh unavailable; saved prices retained');}}}finally{pricingPolling=false;}}
async function poll(){if(polling||!store.settings().powerEntity)return;polling=true;const settings=store.settings();try{const reading=await source.read(settings);if(JSON.stringify(settings)===JSON.stringify(store.settings()))store.ingest(reading);}catch{store.offline();}finally{polling=false;}}
const history=new History(store.db,!!process.env.MEROSS_DEVICE_ID);let historyPolling=false;
async function pollHistory(){if(historyPolling||!process.env.MEROSS_DEVICE_ID)return;historyPolling=true;try{history.save(await source.dailyHistory(process.env.MEROSS_DEVICE_ID),Date.now(),'Meross ConsumptionX direct connector');}catch{history.failed();}try{history.saveHourly(await source.hourlyHistory(),Date.now());}catch{history.failedHourly();}finally{historyPolling=false;}}
const server=Bun.serve({port:Number(process.env.PORT??3060),hostname:process.env.HOST??'127.0.0.1',fetch:createHandler(store,source,process.env.APP_ORIGIN,history)});
setInterval(pollPricing,3600000);void pollPricing();
setInterval(poll,15000);void poll();setInterval(pollHistory,5*60*1000);void pollHistory();
console.log(`Motillo listening on port ${server.port}`);
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{server.stop();store.close();process.exit(0);});
