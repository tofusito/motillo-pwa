import {createHash,randomBytes} from 'node:crypto';
import {constants} from 'node:fs';
import {mkdir,open,rename,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {privateHost} from './meross';

// Protocol source: https://github.com/krahabb/meross_lan/blob/master/custom_components/meross_lan/merossclient/cloudapi.py
// Wire keys verified against merossclient/protocol/const.py (apiStatus is case sensitive).
// This is the public app signing salt, not an account credential.
const APP_SALT='23x17ahWarFH6w29';
const ENDPOINTS={eu:'https://iotx-eu.meross.com',ap:'https://iotx-ap.meross.com',us:'https://iotx-us.meross.com'} as const;
const TTL=24*60*60_000, TIMEOUT=10_000, MAX_BYTES=512*1024;
type Obj=Record<string,unknown>;
type Env=Record<string,string|undefined>;
export type CloudBootstrap={key:string;deviceId:string;host?:string};
export type CloudDevice={uuid:string;name?:string;model?:string};
export type CloudErrorCode='INVALID_CONFIG'|'AUTH_FAILED'|'MFA_REQUIRED'|'MFA_INVALID'|'RATE_LIMITED'|'TOKEN_INVALID'|'DEVICE_NOT_FOUND'|'CLOUD_UNAVAILABLE'|'INVALID_RESPONSE'|'REGION_REJECTED'|'CACHE_FAILED';
export class CloudError extends Error {
 constructor(public readonly code:CloudErrorCode){super(code);this.name='CloudError';}
}
type Session={token:string;key:string;domain:string};
type Cache=Session&{version:1;account:string;deviceId:string;checkedAt:number;host?:string};
const obj=(v:unknown):v is Obj=>!!v&&typeof v==='object'&&!Array.isArray(v);
const str=(v:unknown,max=4096):v is string=>typeof v==='string'&&v.length>0&&v.length<=max;
const md5=(v:string)=>createHash('md5').update(v).digest('hex');
const allowed=(v:unknown):v is string=>typeof v==='string'&&Object.values(ENDPOINTS).includes(v as typeof ENDPOINTS.eu);
function statusError(status:unknown):CloudError {
 if(status===1033)return new CloudError('MFA_REQUIRED');
 if(status===1032)return new CloudError('MFA_INVALID');
 if([1028,1042,1301].includes(status as number))return new CloudError('RATE_LIMITED');
 if([1019,1022,1200].includes(status as number))return new CloudError('TOKEN_INVALID');
 if([1001,1002,1003,1004,1005,1006,1008,1031,1035,1043].includes(status as number))return new CloudError('AUTH_FAILED');
 return new CloudError('INVALID_RESPONSE');
}
async function post(domain:string,path:string,data:Obj,fetcher:typeof fetch,token?:string):Promise<Obj>{
 if(!allowed(domain))throw new CloudError('REGION_REJECTED');
 const timestamp=Date.now(),nonce=randomBytes(16).toString('hex');
 const params=Buffer.from(JSON.stringify(data),'utf8').toString('base64');
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 const operation=async()=>{
  const response=await fetcher(domain+path,{method:'POST',redirect:'error',signal:controller.signal,headers:{'Content-Type':'application/json',...(token?{Authorization:'Basic '+token}:{})},body:JSON.stringify({timestamp,nonce,params,sign:md5(APP_SALT+timestamp+nonce+params)})});
  if(response.status===429)throw new CloudError('RATE_LIMITED');
  if(response.status===401||response.status===403)throw new CloudError(token?'TOKEN_INVALID':'AUTH_FAILED');
  if(!response.ok||!response.body)throw new CloudError('CLOUD_UNAVAILABLE');
  const length=response.headers.get('content-length');if(length&&(!/^\d+$/.test(length)||Number(length)>MAX_BYTES))throw new CloudError('INVALID_RESPONSE');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>MAX_BYTES)throw new CloudError('INVALID_RESPONSE');chunks.push(value);}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  let result:unknown;try{result=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new CloudError('INVALID_RESPONSE');}
  if(!obj(result)||!Number.isInteger(result.apiStatus)||!Object.hasOwn(result,'data'))throw new CloudError('INVALID_RESPONSE');
  return result;
 };
 try{return await Promise.race([operation(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new CloudError('CLOUD_UNAVAILABLE'));},TIMEOUT);})]);}
 catch(error){throw error instanceof CloudError?error:new CloudError('CLOUD_UNAVAILABLE');}
 finally{if(timer)clearTimeout(timer);}
}
async function request(session:Session,path:string,data:Obj,fetcher:typeof fetch):Promise<unknown>{
 const result=await post(session.domain,path,data,fetcher,session.token);
 if(result.apiStatus!==0)throw statusError(result.apiStatus);
 return result.data;
}
async function signin(env:Env,domain:string,region:string,fetcher:typeof fetch):Promise<Session>{
 const data:Obj={email:env.MEROSS_EMAIL!,password:md5(env.MEROSS_PASSWORD!),accountCountryCode:region,encryption:1,agree:0};
 if(env.MEROSS_MFA_CODE)data.mfaCode=env.MEROSS_MFA_CODE;
 let result=await post(domain,'/v1/Auth/signIn',data,fetcher);
 if(result.apiStatus===1030){
  if(!obj(result.data)||!allowed(result.data.domain))throw new CloudError('REGION_REJECTED');
  domain=result.data.domain;result=await post(domain,'/v1/Auth/signIn',data,fetcher);
 }
 if(result.apiStatus===1030)throw new CloudError('REGION_REJECTED');
 if(result.apiStatus!==0)throw statusError(result.apiStatus);
 const v=result.data;
 if(!obj(v)||!str(v.userid)||!str(v.email)||!str(v.token)||!str(v.key,256))throw new CloudError('INVALID_RESPONSE');
 if(v.domain!==undefined&&!allowed(v.domain))throw new CloudError('REGION_REJECTED');
 return {token:v.token,key:v.key,domain:v.domain??domain} as Session;
}
/** Lists only safe identifiers and labels. The session, key and raw cloud response never leave this function. */
export async function listCloudDevices(env:Env,fetcher:typeof fetch=fetch):Promise<CloudDevice[]>{
 const region=env.MEROSS_REGION??'eu';
 if(!Object.hasOwn(ENDPOINTS,region)||!str(env.MEROSS_EMAIL,320)||!str(env.MEROSS_PASSWORD)||!!env.MEROSS_MFA_CODE&&!/^\d{6}$/.test(env.MEROSS_MFA_CODE))throw new CloudError('INVALID_CONFIG');
 const session=await signin(env,ENDPOINTS[region as keyof typeof ENDPOINTS],region,fetcher);
 const value=await request(session,'/v1/Device/devList',{},fetcher);
 if(!Array.isArray(value)||value.length>5000||value.some(v=>!obj(v)))throw new CloudError('INVALID_RESPONSE');
 const forbidden=[env.MEROSS_PASSWORD,session.token,session.key].filter((v):v is string=>!!v);
 const label=(value:unknown,max:number):string|undefined=>{
  if(typeof value!=='string')return undefined;
  const cleaned=value.replace(/[\u0000-\u001f\u007f-\u009f]/g,'').trim().slice(0,max);
  return cleaned&&!forbidden.some(secret=>cleaned.includes(secret))?cleaned:undefined;
 };
 return value.map(device=>{
  if(!str(device.uuid,32)||!/^[a-fA-F0-9]{32}$/.test(device.uuid))throw new CloudError('INVALID_RESPONSE');
  const name=label(device.devName,120),model=label(device.deviceType??device.model,64);
  return {uuid:device.uuid,...(name?{name}:{}),...(model?{model}:{})};
 });
}
async function readCache(path:string,account:string,deviceId:string):Promise<Cache|null>{
 let file;
 try{
  file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  const stat=await file.stat();if(!stat.isFile()||stat.size>16*1024||(stat.mode&0o077)!==0)return null;
  const v:unknown=JSON.parse(await file.readFile('utf8'));
  if(!obj(v)||v.version!==1||v.account!==account||v.deviceId!==deviceId||!str(v.key,256)||!str(v.token)||!allowed(v.domain)||typeof v.checkedAt!=='number'||!Number.isFinite(v.checkedAt)||v.checkedAt>Date.now()||v.checkedAt<=0||(v.host!==undefined&&(typeof v.host!=='string'||!privateHost(v.host))))return null;
  return {version:1,account,deviceId,key:v.key,token:v.token,domain:v.domain,checkedAt:v.checkedAt,...(v.host?{host:v.host as string}:{})};
 }catch{return null;}finally{await file?.close();}
}
async function writeCache(path:string,value:Cache):Promise<void>{
 const temp=path+'.'+randomBytes(8).toString('hex')+'.tmp';let file;
 try{await mkdir(dirname(path),{recursive:true,mode:0o700});file=await open(temp,'wx',0o600);await file.writeFile(JSON.stringify(value)+'\n');await file.sync();await file.close();file=undefined;await rename(temp,path);}
 catch{throw new CloudError('CACHE_FAILED');}
 finally{await file?.close().catch(()=>{});await unlink(temp).catch(()=>{});}
}
/** Only the explicitly selected device leaves bootstrap. Never called by the LAN poller. */
export async function bootstrapCloud(env:Env,statePath:string,fetcher:typeof fetch=fetch):Promise<CloudBootstrap>{
 const deviceId=env.MEROSS_DEVICE_ID,region=env.MEROSS_REGION??'eu',host=env.MEROSS_HOST;
 if(!deviceId||!/^[a-fA-F0-9]{32}$/.test(deviceId)||!Object.hasOwn(ENDPOINTS,region)||!str(env.MEROSS_EMAIL,320)||!str(env.MEROSS_PASSWORD)||!str(statePath)||host!==undefined&&!privateHost(host)||!!env.MEROSS_MFA_CODE&&!/^\d{6}$/.test(env.MEROSS_MFA_CODE))throw new CloudError('INVALID_CONFIG');
 const account=createHash('sha256').update(env.MEROSS_EMAIL+'\0'+region).digest('hex');
 let cache=await readCache(statePath,account,deviceId);
 const output=(v:Cache):CloudBootstrap=>({key:v.key,deviceId,...(host||v.host?{host:host||v.host}:{})});
 if(cache&&Date.now()-cache.checkedAt<TTL)return output(cache);
 let session:Session=cache??await signin(env,ENDPOINTS[region as keyof typeof ENDPOINTS],region,fetcher);
 const metadata=async()=>{
  const list=await request(session,'/v1/Device/devList',{},fetcher);
  if(!Array.isArray(list)||list.length>5000||list.some(v=>!obj(v)))throw new CloudError('INVALID_RESPONSE');
  if(!list.some(v=>obj(v)&&v.uuid===deviceId))throw new CloudError('DEVICE_NOT_FOUND');
  if(host)return undefined;
  const info=await request(session,'/v1/Device/devInfo',{uuid:deviceId},fetcher);
  if(!obj(info)||(info.uuid!==undefined&&info.uuid!==deviceId))throw new CloudError('INVALID_RESPONSE');
  return typeof info.lanIp==='string'&&privateHost(info.lanIp)?info.lanIp:undefined;
 };
 let detectedHost:string|undefined;
 try{detectedHost=await metadata();}catch(error){
  if(!cache||!(error instanceof CloudError)||error.code!=='TOKEN_INVALID')throw error;
  cache=null;session=await signin(env,ENDPOINTS[region as keyof typeof ENDPOINTS],region,fetcher);detectedHost=await metadata();
 }
 const next:Cache={version:1,account,deviceId,...session,checkedAt:Date.now(),...(detectedHost?{host:detectedHost}:{})};
 await writeCache(statePath,next);return output(next);
}
