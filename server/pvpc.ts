import type {Rates} from '../shared/model';
import {local} from './pricing';
const ENDPOINT='https://apidatos.ree.es/es/datos/mercados/precios-mercados-tiempo-real';
// REData: PVPC indicator 1001, EUR/MWh (not spot indicator 600). No tax multiplier.
export function parsePvpc(body:unknown,month:string):Record<string,number>{
 const d=body as {included?:{id:string;attributes?:{title?:string;values?:{datetime:string;value:number}[]}}[]};
 const indicator=d?.included?.find(x=>x.id==='1001'&&x.attributes?.title==='PVPC');
 if(!indicator?.attributes?.values?.length)throw Error('REE no ha publicado precios PVPC para este mes.');
 const hours:Record<string,number>={};
 for(const row of indicator.attributes.values){const at=Date.parse(row.datetime);if(!Number.isFinite(at)||at%3600000!==0||local(at).month!==month||typeof row.value!=='number'||!Number.isFinite(row.value)||row.value < -1000||row.value>100000)throw Error('Respuesta PVPC no válida.');const key=String(at);if(key in hours)throw Error('Horas PVPC duplicadas.');hours[key]=row.value/1000;}
 return hours;
}
export async function fetchPvpc(month:string,fetcher:typeof fetch=fetch):Promise<Record<string,number>>{
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Mes no válido.');
 const [y,m]=month.split('-').map(Number),last=new Date(Date.UTC(y!,m!,0)).getUTCDate();
 const url=new URL(ENDPOINT);url.searchParams.set('start_date',`${month}-01T00:00`);url.searchParams.set('end_date',`${month}-${last}T23:59`);url.searchParams.set('time_trunc','hour');
 const response=await fetcher(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(12000),redirect:'error'});
 if(!response.ok||!response.body)throw Error('REE no está disponible; se conservan los precios guardados.');
 const reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024)throw Error('Respuesta REE demasiado grande.');chunks.push(value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
 return parsePvpc(JSON.parse(Buffer.concat(chunks).toString()),month);
}
export function pvpcRate(month:string,hourly:Record<string,number>):Rates{return {month,mode:'pvpc',valle:null,llano:null,punta:null,taxIncluded:false,source:'REE REData · PVPC 1001 · EUR/MWh convertido a EUR/kWh · sin impuestos',hourly,updatedAt:new Date().toISOString()};}
