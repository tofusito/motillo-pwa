import {expect,test} from 'bun:test';
import {Connector,connectorEntities} from '../server/connector';
import {defaults} from '../server/store';
const settings={...defaults,powerEntity:connectorEntities[0]!.id,energyEntity:connectorEntities[1]!.id,plugEntity:connectorEntities[2]!.id};
test('private connector credentials stay in server requests and readings are normalized',async()=>{
 let seen:RequestInit|undefined;const reader=new Connector('http://meross-connector:3062','a'.repeat(32),(async(_url:RequestInfo|URL,init?:RequestInit)=>{seen=init;return Response.json({at:Date.now(),power:1200,energy:.25,plug:true,secret:'discarded'});}) as unknown as typeof fetch);
 const value=await reader.read(settings);expect(value.power).toBe(1200);expect(value.energy).toBe(.25);expect(Object.keys(value).sort()).toEqual(['at','energy','plug','power']);expect((seen?.headers as Record<string,string>).Authorization).toBe('Bearer '+'a'.repeat(32));expect(seen?.redirect).toBe('error');
});
test('stale or malformed connector readings fail rather than inventing zero',async()=>{
 for(const value of [{at:Date.now()-60000,power:0,energy:0,plug:true},{at:Date.now(),power:-1,energy:0,plug:true},{at:Date.now(),power:0,energy:'0',plug:true}]){
  const reader=new Connector('http://meross-connector:3062','a'.repeat(32),(async()=>Response.json(value)) as unknown as typeof fetch);await expect(reader.read(settings)).rejects.toThrow();
 }
});
test('connector history validates dates and strips extra fields',async()=>{
 const reader=new Connector('http://meross-connector:3062','a'.repeat(32),(async()=>Response.json([{date:'2026-10-19',kwh:2,recordedAt:Date.now(),secret:'hidden'}])) as unknown as typeof fetch);const rows=await reader.dailyHistory('');expect(rows[0]!.kwh).toBe(2);expect(Object.keys(rows[0]!).sort()).toEqual(['date','kwh','recordedAt']);
 const bad=new Connector('http://meross-connector:3062','a'.repeat(32),(async()=>Response.json([{date:'2026-02-30',kwh:2,recordedAt:Date.now()}])) as unknown as typeof fetch);await expect(bad.dailyHistory('')).rejects.toThrow();
});
