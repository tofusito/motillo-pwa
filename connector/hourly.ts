export type HourlyRow={startAt:number;kwh:number;recordedAt:number};
// ConsumptionH retains hour-of-day slots from different dates. Never invent a continuous series.
export function hourlyRows(value:unknown,now=Date.now()):HourlyRow[]{
 if(!Array.isArray(value)||value.length>32)throw new Error('Invalid hourly channels');
 const channel=value.find((v:unknown)=>v&&typeof v==='object'&&(v as {channel?:unknown}).channel===0) as {data?:unknown}|undefined;
 if(!channel||!Array.isArray(channel.data)||channel.data.length>400)throw new Error('Invalid hourly history');
 const out=new Map<number,HourlyRow>();
 for(const raw of channel.data){
  if(!raw||typeof raw!=='object')continue;
  const {timestamp,value}=raw as {timestamp:unknown;value:unknown};
  if(typeof timestamp!=='number'||!Number.isSafeInteger(timestamp)||timestamp<946684800||timestamp*1000>now+300000||typeof value!=='number'||!Number.isFinite(value)||value<0)continue;
  const recordedAt=timestamp*1000,startAt=Math.floor(recordedAt/3600000)*3600000;
  const row={startAt,recordedAt,kwh:value/1000};
  if(!out.has(startAt)||out.get(startAt)!.recordedAt<recordedAt)out.set(startAt,row);
 }
 if(channel.data.length&&!out.size)throw new Error('Invalid hourly values');
 return [...out.values()].sort((a,b)=>a.startAt-b.startAt);
}
