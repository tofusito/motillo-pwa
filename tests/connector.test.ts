import {describe,expect,test} from 'bun:test';
import {Connector,MerossClient,configFromEnv,dailyRows,privateHost,signature,HISTORY_INTERVAL,STALE_AFTER} from '../connector/meross';
const now=Date.parse('2026-10-20T12:00:00Z');
const config={host:'192.168.1.50',key:'mock-key',deviceId:'a'.repeat(32),token:'connector-test-token-at-least-32-chars'};
function fixture(options:{change?:(v:any)=>void;fail?:()=>boolean}={}){
 const calls:any[]=[];
 const fetcher=(async(url:unknown,init?:RequestInit)=>{
  expect(String(url)).toBe('http://192.168.1.50/config');expect(init?.redirect).toBe('error');expect(init?.method).toBe('POST');
  const message=JSON.parse(String(init?.body));calls.push(message);expect(message.header.method).toBe('GET');expect(message.header.sign).toBe(signature(message.header.messageId,config.key,message.header.timestamp));
  if(options.fail?.())throw new Error('mock device failure with private content');
  const ns=message.header.namespace;
  const payload=ns.endsWith('.ConsumptionH')?{consumptionH:[{channel:0,total:0,data:[{timestamp:now/1000-60,value:123}]}]}:ns.endsWith('.Electricity')?{electricity:{channel:0,power:1234000}}:ns.endsWith('.ToggleX')?{togglex:[{channel:0,onoff:1}]}:ns.endsWith('.All')?{all:{system:{hardware:{uuid:config.deviceId}},digest:{togglex:[{channel:0,onoff:0}]}}}:{consumptionx:[{date:'2026-10-19',time:(now-86400000)/1000,value:3456},{date:'2026-10-20',time:now/1000,value:1234}]};
  const response={header:{...message.header,method:'GETACK'},payload};options.change?.(response);return Response.json(response);
 }) as typeof fetch;
 return {calls,fetcher};
}
const req=(path:string,token=config.token,method='GET')=>new Request('http://connector'+path,{method,headers:{Authorization:'Bearer '+token}});
describe('Meross connector',()=>{
 test('strict private IP and configuration validation',()=>{
  for(const host of ['192.168.1.1','10.0.0.2','172.16.0.1','172.31.255.255'])expect(privateHost(host)).toBe(true);
  for(const host of ['localhost','plug.local','127.0.0.1','169.254.1.1','8.8.8.8','172.32.0.1','192.168.1.1:80','192.168.1.1/path','192.168.01.1','http://10.0.0.1','::1','10.0.0.999'])expect(privateHost(host)).toBe(false);
  expect(configFromEnv({})).toBeNull();expect(()=>configFromEnv({MEROSS_HOST:'8.8.8.8',MEROSS_KEY:'key',MEROSS_DEVICE_ID:'a'.repeat(32),CONNECTOR_TOKEN:config.token})).toThrow();
 });
 test('auth and method/query limits never trigger device polling; health is sanitized',async()=>{
  const f=fixture(),c=new Connector(config,{fetcher:f.fetcher,now:()=>now,timers:false});
  expect(await (await c.handle(req('/health'))).json()).toEqual({configured:true,ready:false});
  expect((await c.handle(req('/v1/reading','wrong'))).status).toBe(401);
  expect((await c.handle(req('/v1/reading',config.token,'POST'))).status).toBe(405);
  expect((await c.handle(req('/v1/reading?host=evil'))).status).toBe(400);
  expect((await c.handle(req('/proxy'))).status).toBe(404);expect(f.calls).toHaveLength(0);
 });
 test('signed GETs convert mW and Wh; date is authoritative; cache and overlapping polls',async()=>{
  const f=fixture(),c=new Connector(config,{fetcher:f.fetcher,now:()=>now,timers:false});
  const [a,b]=await Promise.all([c.handle(req('/v1/reading')),c.handle(req('/v1/reading'))]);
  expect(await a.json()).toEqual({at:now,power:1234,energy:1.234,plug:true});expect(b.status).toBe(200);expect(f.calls).toHaveLength(5);
  const h=await (await c.handle(req('/v1/history'))).json();expect(h).toEqual([{date:'2026-10-19',kwh:3.456,recordedAt:now-86400000},{date:'2026-10-20',kwh:1.234,recordedAt:now}]);expect(f.calls).toHaveLength(5);
  expect(await (await c.handle(req('/health'))).json()).toEqual({configured:true,ready:true});
 });
 test('response signature, request id, namespace, method and identity mismatches refused',async()=>{
  for(const change of [(v:any)=>v.header.sign='0'.repeat(32),(v:any)=>v.header.messageId='b'.repeat(32),(v:any)=>v.header.namespace='Appliance.System.All',(v:any)=>v.header.method='SETACK',(v:any)=>v.header.method='ERROR',(v:any)=>v.header.uuid='b'.repeat(32)]){
   const f=fixture({change});await expect(new MerossClient(config,f.fetcher,()=>now).get('Appliance.Control.Electricity')).rejects.toThrow();
  }
 });
 test('power staleness returns 503 without raw errors; cached daily counter never presented fresh',async()=>{
  let time=now,fail=false;const f=fixture({fail:()=>fail}),c=new Connector(config,{fetcher:f.fetcher,now:()=>time,timers:false});
  expect((await c.handle(req('/v1/reading'))).status).toBe(200);
  time+=STALE_AFTER+1;
  expect(await (await c.handle(req('/v1/reading'))).json()).toMatchObject({power:1234,energy:1.234});
  fail=true;time+=STALE_AFTER+1;const r=await c.handle(req('/v1/reading'));expect(r.status).toBe(503);expect(await r.json()).toEqual({error:'reading_unavailable'});
  expect(await (await c.handle(req('/health'))).json()).toEqual({configured:true,ready:false});
  time+=HISTORY_INTERVAL;expect((await c.handle(req('/v1/history'))).status).toBe(503);
 });
 test('ToggleX failure falls back to System.All; optional state never becomes false by default',async()=>{
  const f=fixture({change:v=>{if(v.header.namespace.endsWith('ToggleX'))v.header.method='ERROR';}}),c=new Connector(config,{fetcher:f.fetcher,now:()=>now,timers:false});
  expect(await (await c.handle(req('/v1/reading'))).json()).toMatchObject({plug:false});
  const g=fixture({change:v=>{if(v.header.namespace.endsWith('ToggleX'))v.header.method='ERROR';if(v.header.namespace.endsWith('.All'))delete v.payload.all.digest;}});
  expect(await (await new Connector(config,{fetcher:g.fetcher,now:()=>now,timers:false}).handle(req('/v1/reading'))).json()).toMatchObject({plug:null});
 });
 test('LAN identity must match configured cloud UUID before power or energy is accepted',async()=>{
  const f=fixture({change:v=>{if(v.header.namespace.endsWith('.All'))v.payload.all.system.hardware.uuid='b'.repeat(32);}}),c=new Connector(config,{fetcher:f.fetcher,now:()=>now,timers:false});
  expect((await c.handle(req('/v1/reading'))).status).toBe(503);expect((await c.handle(req('/v1/history'))).status).toBe(503);expect(f.calls).toHaveLength(1);expect(f.calls[0].header.namespace).toBe('Appliance.System.All');
 });
 test('hourly endpoint uses exact consumptionH field and exposes normalized data only',async()=>{
  const f=fixture(),c=new Connector(config,{fetcher:f.fetcher,now:()=>now,timers:false});
  const r=await c.handle(req('/v1/hourly'));expect(r.status).toBe(200);expect(await r.json()).toEqual([{startAt:now-3600000,recordedAt:now-60000,kwh:.123}]);
  const query=f.calls.find(x=>x.header.namespace==='Appliance.Control.ConsumptionH');expect(query.payload).toEqual({consumptionH:[{channel:0}]});expect((await c.handle(req('/v1/hourly','wrong'))).status).toBe(401);
 });
 test('periodic identity recheck refuses a reassigned LAN device before returning cached data',async()=>{
  let time=now,wrong=false;const f=fixture({change:v=>{if(wrong&&v.header.namespace.endsWith('.All'))v.payload.all.system.hardware.uuid='b'.repeat(32);}}),c=new Connector(config,{fetcher:f.fetcher,now:()=>time,timers:false});
  expect((await c.handle(req('/v1/reading'))).status).toBe(200);time+=15*60000;wrong=true;expect((await c.handle(req('/v1/reading'))).status).toBe(503);expect((await c.handle(req('/v1/hourly'))).status).toBe(503);
 });
 test('oversized and failed transport bounded and refused' ,async()=>{
  for(const fetcher of [(async()=>new Response('x'.repeat(128*1024+1))) as unknown as typeof fetch,(async()=>new Response('',{status:302,headers:{Location:'http://evil'}})) as unknown as typeof fetch])await expect(new MerossClient(config,fetcher,()=>now).get('Appliance.Control.Electricity')).rejects.toThrow();
 });
 test('device requests abort after bounded timeout',async()=>{
  const fetcher=((_url:unknown,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>{init?.signal?.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});})) as typeof fetch;
  const start=Date.now();await expect(new MerossClient(config,fetcher,()=>now).get('Appliance.Control.Electricity')).rejects.toThrow('aborted');expect(Date.now()-start).toBeLessThan(5000);
 });
 test('history requires valid values, preserves row date over timestamp and deduplicates',()=>{
  const row={date:'2026-10-19',time:now/1000,value:1000};expect(dailyRows([row,{...row,time:now/1000-1,value:2}],now)).toEqual([{date:'2026-10-19',recordedAt:now,kwh:1}]);
  for(const row of [{date:'2026-02-30',time:now/1000,value:1},{date:'2026-10-21',time:now/1000,value:1},{date:'2026-10-20',time:now/1000,value:-1},{date:'2026-10-20',time:'bad',value:1}])expect(()=>dailyRows([row],now)).toThrow();
  expect(dailyRows([],now)).toEqual([]);
 });
});
