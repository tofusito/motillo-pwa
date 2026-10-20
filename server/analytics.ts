import type {Analytics} from '../shared/analytics';
import type {Rates,Settings} from '../shared/model';
import {local,periodAt,split,price,unitPrice,fixedPrice} from './pricing';
export type AnalyticsRow={id:number;start:number;end:number|null;incomplete:number};
export type AnalyticsSegment={session:number;start:number;end:number;kwh:number};
type Basis=Analytics['stats']['taxBasis'];
const basis=(values:boolean[]):Basis=>!values.length?'unknown':values.every(Boolean)?'included':values.every(v=>!v)?'excluded':'mixed';
const sum=(xs:number[])=>xs.reduce((a,b)=>a+b,0);
function shifted(month:string,offset:number){const [y,m]=month.split('-').map(Number);return new Date(Date.UTC(y!,m!-1+offset,1)).toISOString().slice(0,7);}
export function tariffWindows(now:number,holidays:string[]):Analytics['tariff'] {
 const current=periodAt(now,holidays);let change:number|null=null,valle:number|null=current==='valle'?now:null,valleEnd:number|null=null;
 // Scan real UTC hours, then classify in Madrid: repeated and missing DST hours stay correct.
 for(let at=(Math.floor(now/3600000)+1)*3600000;at<=now+10*86400000;at+=3600000){const period=periodAt(at,holidays);if(change===null&&period!==current)change=at;if(valle===null&&period==='valle')valle=at;if(valle!==null&&at>valle&&period!=='valle'){valleEnd=at;break;}}
 return {nextChangeAt:new Date(change!).toISOString(),nextPeriod:periodAt(change!,holidays),nextValleAt:new Date(valle!).toISOString(),valleEndsAt:new Date(valleEnd!).toISOString()};
}
export function buildAnalytics(input:{month:string;now:number;settings:Settings;rates:Rates[];rows:AnalyticsRow[];segments:AnalyticsSegment[];dailyKwh:number[];activeId:number|null;fresh:boolean;powerW:number|null}):Analytics {
 const {month,now,settings,rates,rows,segments}=input;
 const rateFor=(m:string)=>rates.find(r=>r.month===m);
 const bySession=new Map<number,AnalyticsSegment[]>();for(const s of segments){const group=bySession.get(s.session)??[];group.push(s);bySession.set(s.session,group);}
 const facts=rows.map(row=>{
  const pieces=(bySession.get(row.id)??[]).flatMap(s=>split(s.start,s.end,s.kwh,settings.holidays));
  const energy=sum(pieces.map(p=>p.kwh));const months=[...new Set(pieces.map(p=>p.month))];
  const taxes=months.flatMap(m=>{const r=rateFor(m);return r?[r.taxIncluded]:[]});
  const taxBasis=taxes.length===months.length?basis(taxes):'unknown';
  const actual=pieces.map(p=>price(p,rates));const valley=pieces.map(p=>{const r=fixedPrice(rateFor(p.month),'valle');return r==null?null:p.kwh*r;});const punta=pieces.map(p=>{const r=fixedPrice(rateFor(p.month),'punta');return r==null?null:p.kwh*r;});
  const total=(xs:(number|null)[])=>!pieces.length||row.incomplete||taxBasis==='mixed'||taxBasis==='unknown'||xs.some(v=>v===null)?null:sum(xs as number[]);
  const cost=total(actual),valleyEur=total(valley),puntaEur=total(punta);
  return {row,energy,cost,valleyEur,puntaEur,taxes,taxBasis,duration:row.end===null?null:Math.max(0,row.end-row.start)/60000,usable:row.end!==null&&!row.incomplete&&energy>0};
 });
 const recent=facts.filter(f=>f.usable).sort((a,b)=>b.row.start-a.row.start).slice(0,30).map(f=>f.energy).sort((a,b)=>a-b);
 const daily=input.dailyKwh.filter(k=>Number.isFinite(k)&&k>0);
 const manual=settings.referenceChargeKwh;
 const reference:Analytics['reference']=manual!=null&&manual>0?{energyKwh:manual,source:'manual',sampleCount:1}:recent.length?{energyKwh:recent.length%2?recent[Math.floor(recent.length/2)]!:(recent[recent.length/2-1]!+recent[recent.length/2]!)/2,source:'sessions',sampleCount:recent.length}:daily.length?{energyKwh:sum(daily)/daily.length,source:'daily-history',sampleCount:daily.length}:{energyKwh:null,source:'unset',sampleCount:0};
 const selectedRate=rateFor(month);const amount=(period:'valle'|'llano'|'punta')=>reference.energyKwh===null||fixedPrice(selectedRate,period)===null?null:reference.energyKwh*fixedPrice(selectedRate,period)!;
 const valleEur=amount('valle'),llanoEur=amount('llano'),puntaEur=amount('punta');
 const selected=facts.filter(f=>local(f.row.start).month===month&&f.usable);
 const priced=selected.filter(f=>f.cost!==null);
 const selectedBasis=selected.some(f=>f.taxBasis==='mixed')?'mixed':selected.some(f=>f.taxBasis==='unknown')?'unknown':basis(selected.flatMap(f=>f.taxes));
 const comparable=selected.length>0&&selectedBasis!=='mixed'&&selectedBasis!=='unknown'&&selected.every(f=>f.cost!==null&&f.valleyEur!==null&&f.puntaEur!==null);
 const active=facts.find(f=>f.row.id===input.activeId);const currentMonth=local(now).month,currentRate=unitPrice(now,rates,settings.holidays);
 let reason:Analytics['live']['reason']=!active?'idle':!input.fresh?'stale':active.row.incomplete?'incomplete':reference.energyKwh===null?'missing-reference':active.energy>=reference.energyKwh?'reference-exceeded':currentRate===null||active.cost===null?'missing-rate':'available';
 if(reason==='available'&&active&&active.taxBasis!==(rateFor(currentMonth)?.taxIncluded?'included':'excluded'))reason='mixed-tax';
 const remaining=reason==='available'?Math.max(0,reference.energyKwh!-active!.energy):null;
 return {reference,comparison:{valleEur,llanoEur,puntaEur,differenceEur:valleEur===null||puntaEur===null?null:puntaEur-valleEur,nightSavingPercent:valleEur===null||puntaEur===null||puntaEur<=0?null:(puntaEur-valleEur)/puntaEur*100,taxIncluded:selectedRate?.taxIncluded??null},
 live:{activeCostEur:active?.cost??null,estimatedTotalEur:remaining===null?null:active!.cost!+remaining*currentRate!,remainingKwh:remaining,remainingMinutes:remaining===null||input.powerW===null||input.powerW<settings.thresholdW?null:remaining/input.powerW*60000,reason,rateMonth:currentMonth,scenario:'current-rate',taxIncluded:active?(active.taxBasis==='included'?true:active.taxBasis==='excluded'?false:null):(rateFor(currentMonth)?.taxIncluded??null)},
 stats:{completedSessionCount:selected.length,pricedSessionCount:priced.length,averageKwh:priced.length?sum(priced.map(f=>f.energy))/priced.length:null,averageCostEur:priced.length&&selectedBasis!=='mixed'?sum(priced.map(f=>f.cost!))/priced.length:null,averageDurationMinutes:priced.length?sum(priced.map(f=>f.duration!))/priced.length:null,averagePriceEurKwh:priced.length&&selectedBasis!=='mixed'?sum(priced.map(f=>f.cost!))/sum(priced.map(f=>f.energy)):null,savingVsPuntaEur:comparable?sum(selected.map(f=>f.puntaEur!-f.cost!)):null,avoidableCostVsValleEur:comparable?sum(selected.map(f=>f.cost!-f.valleyEur!)):null,taxBasis:selectedBasis},
 sessions:facts.map(f=>({id:f.row.id,valleyEur:f.valleyEur,puntaEur:f.puntaEur,avoidableEur:f.cost===null||f.valleyEur===null?null:f.cost-f.valleyEur,savedVsPuntaEur:f.cost===null||f.puntaEur===null?null:f.puntaEur-f.cost})),
 trend:Array.from({length:6},(_,i)=>{const m=shifted(month,i-5),fs=facts.filter(f=>local(f.row.start).month===m&&f.usable),taxBasis=basis(fs.flatMap(f=>f.taxes));return {month:m,sessionCount:fs.length,energyKwh:fs.length?sum(fs.map(f=>f.energy)):null,costEur:fs.length&&taxBasis!=='mixed'&&fs.every(f=>f.cost!==null)?sum(fs.map(f=>f.cost!)):null,taxBasis};}),tariff:tariffWindows(now,settings.holidays)};
}
