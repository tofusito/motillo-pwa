import {test,expect} from 'bun:test';
import {buildAnalytics,tariffWindows,type AnalyticsRow,type AnalyticsSegment} from '../server/analytics';
import {Store,defaults} from '../server/store';
import {validSettings} from '../server/api';
const at=Date.parse;
const rates=[{month:'2026-10',valle:.086,llano:.124,punta:.203,taxIncluded:false,source:'test'},{month:'2026-11',valle:.2,llano:.3,punta:.4,taxIncluded:false,source:'test'}];
function fixture(options:Partial<Parameters<typeof buildAnalytics>[0]>={}){return buildAnalytics({month:'2026-10',now:at('2026-10-20T11:00:00+02:00'),settings:defaults,rates,rows:[],segments:[],dailyKwh:[],activeId:null,fresh:true,powerW:1000,...options});}
function session(id:number,start:string,end:string,kwh:number,incomplete=0):{row:AnalyticsRow;segment:AnalyticsSegment}{const s=at(start),e=at(end);return {row:{id,start:s,end:e,incomplete},segment:{session:id,start:s,end:e,kwh}};}
test('daily mean remains explicit reference, never fabricated sessions; no wrong-month tariffs',()=>{
 const a=fixture({dailyKwh:[0,2,4]});expect(a.reference).toEqual({source:'daily-history',energyKwh:3,sampleCount:2});expect(a.comparison.valleEur).toBeCloseTo(.258);expect(a.comparison.differenceEur).toBeCloseTo(.351);expect(a.stats.completedSessionCount).toBe(0);expect(a.trend.every(m=>m.energyKwh===null&&m.costEur===null)).toBe(true);expect(fixture({month:'2026-09',dailyKwh:[3]}).comparison.puntaEur).toBeNull();
});
test('session median excludes active incomplete and empty; manual optional override wins',()=>{
 const xs=[session(1,'2026-09-20T01:00:00Z','2026-09-20T02:00:00Z',2),session(2,'2026-10-20T01:00:00Z','2026-10-20T02:00:00Z',4),session(3,'2026-10-20T03:00:00Z','2026-10-20T04:00:00Z',90,1)];
 const opts={rows:xs.map(x=>x.row),segments:xs.map(x=>x.segment),dailyKwh:[20]};expect(fixture(opts).reference).toEqual({source:'sessions',energyKwh:3,sampleCount:2});expect(fixture({...opts,settings:{...defaults,referenceChargeKwh:8}}).reference.source).toBe('manual');expect(fixture(opts).stats.completedSessionCount).toBe(1);
});
test('active estimate uses current rate when viewing old month; no SOC claims and no stale duration',()=>{
 const s=session(1,'2026-11-03T10:00:00+01:00','2026-11-03T11:00:00+01:00',1);s.row.end=null;
 const options={month:'2026-10',now:at('2026-11-03T11:00:00+01:00'),rows:[s.row],segments:[s.segment],activeId:1,settings:{...defaults,referenceChargeKwh:3}};
 const a=fixture(options);expect(a.live.activeCostEur).toBeCloseTo(.4);expect(a.live.estimatedTotalEur).toBeCloseTo(1.2);expect(a.live.remainingMinutes).toBe(120);expect(a.live.scenario).toBe('current-rate');expect(a.live.taxIncluded).toBe(false);expect(fixture({...options,powerW:2}).live.remainingMinutes).toBeNull();expect(fixture({...options,fresh:false}).live.estimatedTotalEur).toBeNull();expect(fixture({...options,settings:{...defaults,referenceChargeKwh:.5}}).live.reason).toBe('reference-exceeded');
});
test('cross-month sessions compare each actual month and suppress mixed taxes',()=>{
 const s=session(1,'2026-10-31T23:30:00+01:00','2026-11-01T00:30:00+01:00',2);const options={rows:[s.row],segments:[s.segment]};
 const a=fixture(options);expect(a.sessions[0]!.valleyEur).toBeCloseTo(.286);expect(a.sessions[0]!.puntaEur).toBeCloseTo(.603);expect(a.stats.averageCostEur).toBeCloseTo(.286);expect(a.stats.savingVsPuntaEur).toBeCloseTo(.317);expect(fixture({...options,rates:[rates[0]!,{...rates[1]!,taxIncluded:true}]}).stats.taxBasis).toBe('mixed');expect(fixture({...options,rates:[rates[0]!,{...rates[1]!,taxIncluded:true}]}).sessions[0]!.puntaEur).toBeNull();expect(fixture({...options,rates:[rates[0]!]}).sessions[0]!.valleyEur).toBeNull();
});
test('averages exclude missing prices and incomplete, with distinct theoretical savings',()=>{
 const good=session(1,'2026-10-20T10:00:00+02:00','2026-10-20T11:00:00+02:00',2),bad=session(2,'2026-10-20T12:00:00+02:00','2026-10-20T13:00:00+02:00',8,1);
 const a=fixture({rows:[good.row,bad.row],segments:[good.segment,bad.segment]});expect(a.stats.completedSessionCount).toBe(1);expect(a.stats.averageKwh).toBe(2);expect(a.stats.averageDurationMinutes).toBe(60);expect(a.stats.averageCostEur).toBeCloseTo(.406);expect(a.stats.savingVsPuntaEur).toBeCloseTo(0);expect(a.stats.avoidableCostVsValleEur).toBeCloseTo(.234);
});
test('Madrid tariff windows handle DST weekend and holiday without fixed 24h assumption',()=>{
 const fall=tariffWindows(at('2026-10-24T22:00:00Z'),[]);expect(fall.nextValleAt).toBe('2026-10-24T22:00:00.000Z');expect(fall.valleEndsAt).toBe('2026-10-26T07:00:00.000Z');
 const spring=tariffWindows(at('2026-03-28T23:00:00Z'),[]);expect(spring.valleEndsAt).toBe('2026-03-30T06:00:00.000Z');
 const weekday=tariffWindows(at('2026-10-20T09:00:00+02:00'),[]);expect(weekday.nextChangeAt).toBe('2026-10-20T08:00:00.000Z');expect(weekday.nextPeriod).toBe('punta');expect(weekday.nextValleAt).toBe('2026-10-20T22:00:00.000Z');
});
test('old settings merge defaults; reference validation and editing preserve current capture',()=>{
 const s=new Store(':memory:');const old={...defaults,powerEntity:'sensor.bike'};delete old.referenceChargeKwh;s.db.query('INSERT INTO settings VALUES(1,?)').run(JSON.stringify(old));expect(s.settings().referenceChargeKwh).toBeNull();expect(validSettings(old)).toBe(true);for(const referenceChargeKwh of [0,-1,101,Infinity,NaN])expect(validSettings({...old,referenceChargeKwh})).toBe(false);expect(validSettings({...old,referenceChargeKwh:3})).toBe(true);
 const t=at('2026-10-20T10:00:00Z');s.ingest({at:t,power:500,energy:2,plug:true});const id=s.active;s.setSettings({...s.settings(),referenceChargeKwh:4});expect(s.active).toBe(id);expect(s.live?.at).toBe(t);s.close();
});

test('live current-rate estimate refuses to combine accumulated and current rates with different taxes',()=>{
 const s=session(1,'2026-10-31T23:00:00+01:00','2026-10-31T23:30:00+01:00',1);s.row.end=null;
 const a=fixture({now:at('2026-11-01T00:00:00+01:00'),rows:[s.row],segments:[s.segment],rates:[rates[0]!,{...rates[1]!,taxIncluded:true}],activeId:1,settings:{...defaults,referenceChargeKwh:3}});
 expect(a.live.activeCostEur).toBeCloseTo(.086);expect(a.live.reason).toBe('mixed-tax');expect(a.live.estimatedTotalEur).toBeNull();expect(a.live.remainingMinutes).toBeNull();
});
test('dashboard bounds interval loading to displayed trend and latest30 valid references',()=>{
 const s=new Store(':memory:');for(let i=1;i<=35;i++){const start=Date.UTC(2024,0,i);s.db.query('INSERT INTO sessions(id,start,end,peak,incomplete) VALUES(?,?,?,?,0)').run(i,start,start+3600000,1000);s.db.query('INSERT INTO intervals VALUES(?,?,?,?,0)').run(i,start,start+3600000,i);}
 const queries:string[]=[];const query=s.db.query.bind(s.db);s.db.query=((sql:string)=>{queries.push(sql);return query(sql);}) as typeof s.db.query;
 const d=s.dashboard('2026-10',at('2026-10-20T12:00:00Z'));expect(d.analytics.reference).toEqual({source:'sessions',energyKwh:20.5,sampleCount:30});expect(d.analytics.sessions).toHaveLength(30);expect(d.analytics.sessions.some(r=>r.id===1)).toBe(false);expect(d.sessions).toHaveLength(0);expect(queries.some(q=>q==='SELECT session,start,end,kwh FROM intervals')).toBe(false);expect(queries.some(q=>q.includes('SELECT session,start,end,kwh FROM intervals WHERE session IN'))).toBe(true);s.close();
});

test('automatic daily reference excludes the unfinished current day',()=>{
 const s=new Store(':memory:');s.db.query('INSERT INTO historical_daily VALUES(?,?,?,?)').run('2026-10-19',2,at('2026-10-19T22:00:00Z'),'test');s.db.query('INSERT INTO historical_daily VALUES(?,?,?,?)').run('2026-10-20',.2,at('2026-10-20T10:00:00Z'),'test');const a=s.dashboard('2026-10',at('2026-10-20T11:00:00Z')).analytics;expect(a.reference).toEqual({energyKwh:2,source:'daily-history',sampleCount:1});s.close();
});
