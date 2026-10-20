import type {EntityOption,Settings} from '../shared/model';
import type {DailyReading} from './history';
import type {Reading} from './store';
export interface Source {
 entities():Promise<EntityOption[]>;
 read(settings:Settings):Promise<Reading>;
 dailyHistory(deviceId:string):Promise<DailyReading[]>;
}
// Stable logical aliases are independent of the selected physical device.
export const connectorEntities:EntityOption[]=[
 {id:'sensor.meross_power',name:'Meross · potencia',unit:'W',kind:'power'},
 {id:'sensor.meross_energy',name:'Meross · energía diaria',unit:'kWh',kind:'energy'},
 {id:'switch.meross_plug',name:'Meross · estado',unit:'',kind:'plug'},
];
export class Connector implements Source {
 constructor(private url:string,private token:string,private request:typeof fetch=fetch){}
 async get(path:string):Promise<unknown>{
  if(!this.url||this.token.length<32)throw new Error('Connector not configured');
  const response=await this.request(`${this.url.replace(/\/$/,'')}${path}`,{headers:{Authorization:`Bearer ${this.token}`},signal:AbortSignal.timeout(30000),redirect:'error'});
  if(!response.ok)throw new Error('Connector unavailable');
  const body=await response.text();if(body.length>262144)throw new Error('Connector response too large');return JSON.parse(body);
 }
 async entities(){await this.get('/health');return connectorEntities.map(x=>({...x}));}
 async read(settings:Settings):Promise<Reading>{
  const raw=await this.get('/v1/reading') as Reading;const now=Date.now();
  const valid=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
  if(!raw||!valid(raw.at)||raw.at>now+5000||now-raw.at>45000||!valid(raw.power)||!(raw.energy===null||valid(raw.energy))||!(raw.plug===null||typeof raw.plug==='boolean'))throw new Error('Invalid connector reading');
  if(settings.powerEntity!==connectorEntities[0]!.id)throw new Error('Unknown connector sensor');
  return {at:raw.at,power:raw.power,energy:settings.energyEntity===connectorEntities[1]!.id?raw.energy:null,plug:settings.plugEntity===connectorEntities[2]!.id?raw.plug:null};
 }
 async hourlyHistory():Promise<{startAt:number;kwh:number;recordedAt:number}[]>{
  const rows=await this.get('/v1/hourly');if(!Array.isArray(rows)||rows.length>4000)throw new Error('Invalid connector hours');
  const now=Date.now();for(const r of rows){if(!r||!Number.isSafeInteger(r.startAt)||r.startAt<946684800000||r.startAt%3600000!==0||r.startAt>now+300000||typeof r.kwh!=='number'||!Number.isFinite(r.kwh)||r.kwh<0||!Number.isSafeInteger(r.recordedAt)||r.recordedAt<r.startAt||r.recordedAt>=r.startAt+3600000||r.recordedAt>now+300000)throw new Error('Invalid connector hour');}
  return rows.map(r=>({startAt:r.startAt,kwh:r.kwh,recordedAt:r.recordedAt}));
 }
 async dailyHistory(_deviceId:string):Promise<DailyReading[]>{
  const rows=await this.get('/v1/history');if(!Array.isArray(rows)||rows.length>4000)throw new Error('Invalid connector history');
  const now=Date.now();for(const r of rows){if(!r||typeof r.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||!Number.isFinite(Date.parse(r.date))||new Date(r.date).toISOString().slice(0,10)!==r.date||typeof r.kwh!=='number'||!Number.isFinite(r.kwh)||r.kwh<0||typeof r.recordedAt!=='number'||!Number.isFinite(r.recordedAt)||r.recordedAt<=0||r.recordedAt>now+300000)throw new Error('Invalid connector history');}
  return rows.map(r=>({date:r.date,kwh:r.kwh,recordedAt:r.recordedAt}));
 }
}
