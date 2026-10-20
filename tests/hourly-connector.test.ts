import {test,expect} from 'bun:test';
import {hourlyRows} from '../connector/hourly';
const now=Date.parse('2026-10-20T13:00:00Z');
test('ConsumptionH wire case, Wh units and sparse absolute hour slots are retained without gaps',()=>{
 const rows=hourlyRows([{channel:0,total:0,data:[{timestamp:1792277944,value:595},{timestamp:1786636743,value:11}]}],now);
 expect(rows).toHaveLength(2);expect(rows[0]!.kwh).toBe(.011);expect(rows[1]!.kwh).toBe(.595);expect(rows[1]!.startAt%3600000).toBe(0);expect(rows[1]!.recordedAt).toBe(1792277944000);
});
test('hourly slots upsert latest timestamp, keep DST repeated hours separate, reject malformed',()=>{
 const a=Date.parse('2026-10-25T00:59:00Z')/1000,b=a+3600,futureNow=Date.parse('2026-10-26T00:00:00Z');
 const out=hourlyRows([{channel:0,data:[{timestamp:a,value:100},{timestamp:a+10,value:150},{timestamp:b,value:200},{timestamp:a-1,value:-3}]}],futureNow);
 expect(out).toHaveLength(2);expect(out[0]!.kwh).toBe(.15);expect(out[1]!.startAt-out[0]!.startAt).toBe(3600000);
 expect(()=>hourlyRows([{channel:1,data:[]}],now)).toThrow();expect(()=>hourlyRows([{channel:0,data:[{timestamp:Infinity,value:1}]}],now)).toThrow();expect(hourlyRows([{channel:0,data:[]}],now)).toEqual([]);
});
