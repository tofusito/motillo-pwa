import {hourlyRows,type HourlyRow} from './hourly';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';

export const POWER_INTERVAL=15_000, HISTORY_INTERVAL=60_000, STALE_AFTER=45_000;
const MAX_BYTES=128*1024, TIMEOUT=4_000;
const NS={power:'Appliance.Control.Electricity',history:'Appliance.Control.ConsumptionX',hourly:'Appliance.Control.ConsumptionH',toggle:'Appliance.Control.ToggleX',all:'Appliance.System.All'} as const;
type Namespace=typeof NS[keyof typeof NS];
type Obj=Record<string,unknown>;
export type DailyRow={date:string;kwh:number;recordedAt:number};
export type Reading={at:number;power:number;energy:number|null;plug:boolean|null};
export type Config={host:string;key:string;deviceId:string;token:string};
const object=(v:unknown):v is Obj=>!!v&&typeof v==='object'&&!Array.isArray(v);
const number=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
export function privateHost(host:string):boolean {
 if(!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host))return false;
 const p=host.split('.').map(Number);
 if(p.some(n=>n>255)||p.map(String).join('.')!==host)return false;
 return p[0]===10||(p[0]===172&&p[1]!>=16&&p[1]!<=31)||(p[0]===192&&p[1]===168);
}
export function configFromEnv(env:Record<string,string|undefined>):Config|null {
 const {MEROSS_HOST:host,MEROSS_KEY:key,MEROSS_DEVICE_ID:deviceId,CONNECTOR_TOKEN:token}=env;
 if(!host||!key||!deviceId||!token)return null;
 if(!privateHost(host)||!/^[a-fA-F0-9]{32}$/.test(deviceId)||key.length>256||token.length<32||token.length>512)throw new Error('Invalid connector configuration');
 return {host,key,deviceId,token};
}
export const signature=(id:string,key:string,timestamp:number)=>createHash('md5').update(id+key+timestamp).digest('hex');
function equal(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
const day=(at:number)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
function validDate(value:unknown):value is string{return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;}
export function dailyRows(value:unknown,now:number):DailyRow[]{
 if(!Array.isArray(value)||value.length>400)throw new Error('Invalid consumption data');
 const rows=new Map<string,DailyRow>();
 for(const raw of value){
  if(!object(raw)||!validDate(raw.date)||raw.date>day(now)||!number(raw.value)||!number(raw.time)||!Number.isSafeInteger(raw.time)||raw.time<946684800||raw.time*1000>now+300_000)throw new Error('Invalid consumption row');
  const row={date:raw.date,kwh:raw.value/1000,recordedAt:raw.time*1000};
  if(!rows.has(row.date)||rows.get(row.date)!.recordedAt<=row.recordedAt)rows.set(row.date,row);
 }
 return [...rows.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
export class MerossClient {
 constructor(private config:Config,private fetcher:typeof fetch=fetch,private now:()=>number=Date.now){}
 async get(namespace:Namespace):Promise<Obj>{
  const payloads:Record<Namespace,Obj>={[NS.power]:{electricity:{}},[NS.history]:{consumptionx:[]},[NS.hourly]:{consumptionH:[{channel:0}]},[NS.toggle]:{togglex:[{channel:0}]},[NS.all]:{all:{}}};
  if(!Object.hasOwn(payloads,namespace))throw new Error('Unsupported namespace');
  const messageId=randomBytes(16).toString('hex'),timestamp=Math.floor(this.now()/1000);
  const header={messageId,namespace,method:'GET',payloadVersion:1,from:'http://localhost/subscribe',timestamp,timestampMs:0,sign:signature(messageId,this.config.key,timestamp)};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),TIMEOUT);
  try{
   const response=await this.fetcher(`http://${this.config.host}/config`,{method:'POST',redirect:'error',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({header,payload:payloads[namespace]})});
   if(!response.ok||!response.body)throw new Error('Device unavailable');
   const length=response.headers.get('content-length');if(length&&Number(length)>MAX_BYTES)throw new Error('Oversize device response');
   const reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
   try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BYTES)throw new Error('Oversize device response');chunks.push(value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
   const message:unknown=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(!object(message)||!object(message.header)||!object(message.payload))throw new Error('Invalid device response');
   const h=message.header;
   if(h.messageId!==messageId||h.namespace!==namespace||h.method!=='GETACK'||!Number.isSafeInteger(h.timestamp)||typeof h.sign!=='string'||!equal(signature(messageId,this.config.key,h.timestamp as number),h.sign))throw new Error('Unverified device response');
   if(typeof h.uuid==='string'&&h.uuid!==this.config.deviceId)throw new Error('Unexpected device');
   return message.payload;
  }finally{clearTimeout(timer);}
 }
}
function plug(payload:Obj):boolean|null {
 const values=Array.isArray(payload.togglex)?payload.togglex:[payload.togglex??payload.toggle];
 const v=values.find(v=>object(v)&&(v.channel===0||v.channel===undefined));
 return object(v)&&v.onoff===1?true:object(v)&&v.onoff===0?false:null;
}
export class Connector {
 private client:MerossClient|null;
 private reading:Reading|null=null;
 private rows:DailyRow[]|null=null;
 private historyAt:number|null=null;
 private hours:HourlyRow[]|null=null;
 private hoursAt:number|null=null;
 private hoursAttempt:number|null=null;
 private identityAt:number|null=null;
 private powerAttempt:number|null=null;
 private historyAttempt:number|null=null;
 private identityAttempt:number|null=null;
 private verified=false;
 private inFlight:Promise<void>|null=null;
 private timer:ReturnType<typeof setInterval>|null=null;
 constructor(private config:Config|null,private options:{fetcher?:typeof fetch;now?:()=>number;timers?:boolean}={}){this.client=config?new MerossClient(config,options.fetcher,()=>this.now()):null;}
 private now(){return (this.options.now??Date.now)();}
 private fresh(){return this.verified&&!!this.reading&&this.now()-this.reading.at<=STALE_AFTER;}
 private start(){if(!this.timer&&this.options.timers!==false){this.timer=setInterval(()=>{void this.poll();},POWER_INTERVAL);this.timer.unref();}}
 stop(){if(this.timer)clearInterval(this.timer);this.timer=null;}
 async poll():Promise<void>{
  if(!this.client)return;
  if(this.inFlight)return this.inFlight;
  this.inFlight=this.collect().finally(()=>{this.inFlight=null;});return this.inFlight;
 }
 private async collect(){
  const now=this.now(),client=this.client!;
  if(this.identityAt!==null&&now-this.identityAt>=15*60_000)this.verified=false;
  if(!this.verified){
   if(this.identityAttempt!==null&&now-this.identityAttempt<POWER_INTERVAL)return;
   this.identityAttempt=now;
   try{const p=await client.get(NS.all);if(!object(p.all)||!object(p.all.system)||!object(p.all.system.hardware)||p.all.system.hardware.uuid!==this.config!.deviceId)return;this.verified=true;this.identityAt=now;}catch{return;}
  }
  if(this.powerAttempt===null||now-this.powerAttempt>=POWER_INTERVAL){
   this.powerAttempt=now;
   try{
    const p=await client.get(NS.power),e=p.electricity;
    if(!object(e)||!number(e.power))throw new Error('Invalid electricity');
    let state:boolean|null=null;
    try{state=plug(await client.get(NS.toggle));}catch{}
    if(state===null)try{const all=await client.get(NS.all);if(object(all.all)){const a=all.all;if(object(a.system)&&object(a.system.hardware)&&a.system.hardware.uuid!==this.config!.deviceId)throw new Error('Unexpected device');if(object(a.digest))state=plug(a.digest);if(state===null&&object(a.control))state=plug(a.control);}}catch{}
    this.reading={at:this.now(),power:e.power/1000,energy:null,plug:state};
   }catch{/* Keep timestamp of last successful sample; never log credentials or raw responses. */}
  }
  if(this.historyAttempt===null||now-this.historyAttempt>=HISTORY_INTERVAL){
   this.historyAttempt=now;
   try{this.rows=dailyRows((await client.get(NS.history)).consumptionx,this.now());this.historyAt=this.now();}catch{}
  }
  if(this.hoursAttempt===null||now-this.hoursAttempt>=5*60_000){this.hoursAttempt=now;try{this.hours=hourlyRows((await client.get(NS.hourly)).consumptionH,this.now());this.hoursAt=this.now();}catch{}}
 }
 async handle(request:Request):Promise<Response>{
  const url=new URL(request.url),json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
  if(url.pathname==='/health'&&request.method==='GET')return json({configured:!!this.config,ready:this.fresh()});
  if(!['/v1/reading','/v1/history','/v1/hourly'].includes(url.pathname))return json({error:'not_found'},404);
  if(!this.config)return json({error:'not_configured'},503);
  const auth=request.headers.get('authorization')??'';
  if(!equal(auth,'Bearer '+this.config.token))return json({error:'unauthorized'},401);
  if(request.method!=='GET')return json({error:'method_not_allowed'},405);
  if(url.search)return json({error:'query_not_supported'},400);
  this.start();await this.poll();
  if(!this.verified)return json({error:'device_unverified'},503);
  if(url.pathname==='/v1/hourly')return this.hours&&this.hoursAt!==null&&this.now()-this.hoursAt<=10*60_000?json(this.hours):json({error:'hourly_unavailable'},503);
  if(url.pathname==='/v1/history')return this.rows&&this.historyAt!==null&&this.now()-this.historyAt<=HISTORY_INTERVAL?json(this.rows):json({error:'history_unavailable'},503);
  if(!this.fresh())return json({error:'reading_unavailable'},503);
  const today=this.rows?.find(r=>r.date===day(this.now()));
  return json({...this.reading!,energy:today&&this.historyAt!==null&&this.now()-this.historyAt<=HISTORY_INTERVAL+15_000?today.kwh:null});
 }
}
