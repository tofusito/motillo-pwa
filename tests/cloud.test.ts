import {afterEach,describe,expect,test} from 'bun:test';
import {createHash} from 'node:crypto';
import {chmod,mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {bootstrapCloud,CloudError,type CloudErrorCode} from '../connector/cloud';
const id='a'.repeat(32),other='b'.repeat(32),secret='private-password-do-not-log';
const env={MEROSS_EMAIL:'private-user@example.test',MEROSS_PASSWORD:secret,MEROSS_DEVICE_ID:id};
const md5=(s:string)=>createHash('md5').update(s).digest('hex');
const folders:string[]=[];
async function path(){const p=await mkdtemp(join(tmpdir(),'meross-cloud-test-'));folders.push(p);return join(p,'state.json');}
afterEach(async()=>{await Promise.all(folders.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
function fixture(handle?:(path:string,data:any,call:number)=>unknown){
 const calls:{url:string;data:any;authorization:string|null}[]=[];
 const fetcher=(async(url:unknown,init?:RequestInit)=>{
  const u=new URL(String(url)),body=JSON.parse(String(init?.body));
  expect(['https://iotx-eu.meross.com','https://iotx-ap.meross.com','https://iotx-us.meross.com']).toContain(u.origin);
  expect(init?.redirect).toBe('error');expect(init?.method).toBe('POST');expect(init?.signal).toBeInstanceOf(AbortSignal);
  expect(body.nonce).toMatch(/^[0-9a-f]{32}$/);expect(body.timestamp).toBeInteger();
  expect(body.sign).toBe(md5('23x17ahWarFH6w29'+body.timestamp+body.nonce+body.params));
  const data=JSON.parse(Buffer.from(body.params,'base64').toString('utf8'));
  const authorization=new Headers(init?.headers).get('Authorization');calls.push({url:String(url),data,authorization});
  if(u.pathname==='/v1/Auth/signIn'){
   expect(authorization).toBeNull();expect(data).toMatchObject({email:env.MEROSS_EMAIL,password:md5(secret),accountCountryCode:'eu',encryption:1,agree:0});
   expect(String(init?.body)).not.toContain(secret);
  }else expect(authorization).toBe('Basic mock-session-token');
  const custom=handle?.(u.pathname,data,calls.length);
  if(custom instanceof Response)return custom;
  return Response.json(custom??{apiStatus:0,data:u.pathname.endsWith('signIn')?{userid:'user-id',email:env.MEROSS_EMAIL,key:'mock-account-key',token:'mock-session-token',domain:u.origin}:u.pathname.endsWith('devList')?[{uuid:other,devName:'never persist me'},{uuid:id}]:{uuid:id,lanIp:'192.168.1.50'}});
 }) as typeof fetch;
 return {fetcher,calls};
}
async function errorCode(work:Promise<unknown>,code:CloudErrorCode){try{await work;throw new Error('Expected cloud error');}catch(error){expect(error).toBeInstanceOf(CloudError);expect((error as CloudError).code).toBe(code);expect(String(error)).not.toContain(secret);expect(String(error)).not.toContain(env.MEROSS_EMAIL);expect(String(error)).not.toContain('mock-session-token');}}
describe('Meross cloud bootstrap',()=>{
 test('signed app signin and Basic token; only selected metadata cached privately and reused offline',async()=>{
  const p=await path(),f=fixture();expect(await bootstrapCloud(env,p,f.fetcher)).toEqual({key:'mock-account-key',deviceId:id,host:'192.168.1.50'});
  expect(f.calls.map(c=>new URL(c.url).pathname)).toEqual(['/v1/Auth/signIn','/v1/Device/devList','/v1/Device/devInfo']);expect(f.calls[2]!.data).toEqual({uuid:id});
  expect((await stat(p)).mode&0o777).toBe(0o600);const raw=await readFile(p,'utf8');
  for(const forbidden of [secret,env.MEROSS_EMAIL,other,'never persist me'])expect(raw).not.toContain(forbidden);
  const offline=(async()=>{throw new Error('must not call');}) as unknown as typeof fetch;
  expect(await bootstrapCloud(env,p,offline)).toEqual({key:'mock-account-key',deviceId:id,host:'192.168.1.50'});
 });
 test('explicit host skips devInfo, overrides cached host and empty optional MFA is omitted',async()=>{
  const p=await path(),f=fixture();await bootstrapCloud(env,p,f.fetcher);
  expect(await bootstrapCloud({...env,MEROSS_HOST:'192.168.1.90'},p,f.fetcher)).toEqual({key:'mock-account-key',deviceId:id,host:'192.168.1.90'});expect(f.calls).toHaveLength(3);
  const g=fixture(p=>p.endsWith('devInfo')?new Response('',{status:500}):undefined);
  expect(await bootstrapCloud({...env,MEROSS_HOST:'192.168.1.90',MEROSS_MFA_CODE:''},await path(),g.fetcher)).toEqual({key:'mock-account-key',deviceId:id,host:'192.168.1.90'});
  expect(g.calls).toHaveLength(2);expect(g.calls[0]!.data.mfaCode).toBeUndefined();
 });
 test('stale metadata refreshes with cached auth and does not sign in again',async()=>{
  const p=await path(),f=fixture();await bootstrapCloud(env,p,f.fetcher);const cache=JSON.parse(await readFile(p,'utf8'));cache.checkedAt=Date.now()-25*3600_000;await writeFile(p,JSON.stringify(cache),{mode:0o600});
  const g=fixture();await bootstrapCloud(env,p,g.fetcher);expect(g.calls.map(c=>new URL(c.url).pathname)).toEqual(['/v1/Device/devList','/v1/Device/devInfo']);
 });
 test('known invalid cached token permits exactly one fresh signin',async()=>{
  const p=await path(),f=fixture();await bootstrapCloud(env,p,f.fetcher);const cache=JSON.parse(await readFile(p,'utf8'));cache.checkedAt=1;await writeFile(p,JSON.stringify(cache));
  const g=fixture((_path,_data,n)=>n===1?{apiStatus:1200,data:{}}:undefined);await bootstrapCloud(env,p,g.fetcher);expect(g.calls.filter(c=>c.url.endsWith('signIn'))).toHaveLength(1);
  cache.checkedAt=1;await writeFile(p,JSON.stringify(cache));const h=fixture((url)=>url.endsWith('devList')?{apiStatus:1019,data:{}}:undefined);await errorCode(bootstrapCloud(env,p,h.fetcher),'TOKEN_INVALID');expect(h.calls).toHaveLength(3);
 });
 test('token/top limits never trigger another signin from cached credentials',async()=>{
  for(const apiStatus of [1301,1042]){
   const p=await path(),f=fixture();await bootstrapCloud(env,p,f.fetcher);
   const cache=JSON.parse(await readFile(p,'utf8'));cache.checkedAt=1;await writeFile(p,JSON.stringify(cache));
   const g=fixture(()=>({apiStatus,data:{}}));await errorCode(bootstrapCloud(env,p,g.fetcher),'RATE_LIMITED');
   expect(g.calls).toHaveLength(1);expect(g.calls[0]!.url).toEndWith('/v1/Device/devList');
  }
 });
 test('literal upstream apiStatus wire envelope is parsed case sensitively',async()=>{
  const f=fixture(()=>new Response('{"apiStatus":1033,"data":{}}',{headers:{'Content-Type':'application/json'}}));
  await errorCode(bootstrapCloud(env,await path(),f.fetcher),'MFA_REQUIRED');expect(f.calls).toHaveLength(1);
 });
 test('bad, missing, or insecure cache permits one fresh signin',async()=>{
  for(const value of ['{broken','{}']){const p=await path();await writeFile(p,value,{mode:0o600});const f=fixture();await bootstrapCloud(env,p,f.fetcher);expect(f.calls.filter(c=>c.url.endsWith('signIn'))).toHaveLength(1);}
  const p=await path(),f=fixture();await bootstrapCloud(env,p,f.fetcher);await chmod(p,0o644);const g=fixture();await bootstrapCloud(env,p,g.fetcher);expect(g.calls).toHaveLength(3);expect((await stat(p)).mode&0o777).toBe(0o600);
 });
 test('only explicit 1030 allowlisted region redirect is followed once',async()=>{
  const p=await path(),f=fixture((_path,_data,n)=>n===1?{apiStatus:1030,data:{domain:'https://iotx-us.meross.com'}}:undefined);await bootstrapCloud(env,p,f.fetcher);expect(f.calls[1]!.url).toBe('https://iotx-us.meross.com/v1/Auth/signIn');
  for(const domain of ['http://iotx-eu.meross.com','https://evil.test','https://iotx-eu.meross.com/','https://iotx-eu.meross.com.evil.test']){const g=fixture(()=>({apiStatus:1030,data:{domain}}));await errorCode(bootstrapCloud(env,await path(),g.fetcher),'REGION_REJECTED');expect(g.calls).toHaveLength(1);}
  const g=fixture(()=>new Response('',{status:302,headers:{Location:'https://iotx-us.meross.com'}}));await errorCode(bootstrapCloud(env,await path(),g.fetcher),'CLOUD_UNAVAILABLE');expect(g.calls).toHaveLength(1);
 });
 test('MFA, credentials and rate limits produce sanitized typed errors without retries',async()=>{
  for(const [status,code] of [[1033,'MFA_REQUIRED'],[1032,'MFA_INVALID'],[1004,'AUTH_FAILED'],[1028,'RATE_LIMITED']] as const){const f=fixture(()=>({apiStatus:status,data:{},info:secret+env.MEROSS_EMAIL}));await errorCode(bootstrapCloud({...env,MEROSS_MFA_CODE:'123456'},await path(),f.fetcher),code);expect(f.calls).toHaveLength(1);expect(f.calls[0]!.data.mfaCode).toBe('123456');}
  const f=fixture(()=>new Response(secret,{status:429}));await errorCode(bootstrapCloud(env,await path(),f.fetcher),'RATE_LIMITED');expect(f.calls).toHaveLength(1);
 });
 test('selected UUID must exist; public IP discarded; manual private IP fallback',async()=>{
  const f=fixture(p=>p.endsWith('devList')?{apiStatus:0,data:[{uuid:other}]}:undefined);await errorCode(bootstrapCloud(env,await path(),f.fetcher),'DEVICE_NOT_FOUND');expect(f.calls).toHaveLength(2);
  const g=fixture(p=>p.endsWith('devInfo')?{apiStatus:0,data:{uuid:id,lanIp:'8.8.8.8'}}:undefined);
  expect(await bootstrapCloud({...env,MEROSS_HOST:'10.0.0.9'},await path(),g.fetcher)).toEqual({key:'mock-account-key',deviceId:id,host:'10.0.0.9'});
  expect(await bootstrapCloud(env,await path(),g.fetcher)).toEqual({key:'mock-account-key',deviceId:id});
  await errorCode(bootstrapCloud({...env,MEROSS_HOST:'https://evil.test'},await path(),g.fetcher),'INVALID_CONFIG');
 });
 test('transport timeout is finite and sanitized even if a fetcher ignores abort',async()=>{
  const fetcher=(()=>new Promise<Response>(()=>{})) as unknown as typeof fetch;
  const start=Date.now();await errorCode(bootstrapCloud(env,await path(),fetcher),'CLOUD_UNAVAILABLE');expect(Date.now()-start).toBeLessThan(11_000);
 },12_000);
 test('response bounds, unsafe domain and raw transport errors never expose secrets',async()=>{
  for(const handle of [()=>new Response('x'.repeat(512*1024+1)),()=>new Response(secret),()=>({apiStatus:0,data:{userid:'a',email:env.MEROSS_EMAIL,key:'key',token:'mock-session-token',domain:'https://evil.test'}})]){const f=fixture(handle);await expect(bootstrapCloud(env,await path(),f.fetcher)).rejects.toBeInstanceOf(CloudError);expect(f.calls).toHaveLength(1);}
  const fetcher=(async()=>{throw new Error(secret+env.MEROSS_EMAIL);}) as unknown as typeof fetch;await errorCode(bootstrapCloud(env,await path(),fetcher),'CLOUD_UNAVAILABLE');
 });
});
