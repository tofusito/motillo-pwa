import {expect,test} from 'bun:test';
import {createHash} from 'node:crypto';
import {CloudError,listCloudDevices} from '../connector/cloud';

const password='discovery-password-secret',email='user@example.test';
const token='session-token-must-not-escape',key='session-key-must-not-escape';
const uuid='0123456789abcdef0123456789abcdef';
const env={MEROSS_EMAIL:email,MEROSS_PASSWORD:password,MEROSS_REGION:'eu'};
const md5=(s:string)=>createHash('md5').update(s).digest('hex');

function mockFetch(list:unknown,status=0){
 const calls:{path:string;authorization:string|null;payload:Record<string,unknown>}[]=[];
 const fetcher=(async(url:unknown,init?:RequestInit)=>{
  const target=new URL(String(url)),body=JSON.parse(String(init?.body));
  const payload=JSON.parse(Buffer.from(body.params,'base64').toString('utf8')) as Record<string,unknown>;
  const authorization=new Headers(init?.headers).get('Authorization');
  calls.push({path:target.pathname,authorization,payload});
  if(target.pathname.endsWith('/signIn')){
   expect(authorization).toBeNull();
   expect(payload).toMatchObject({email,password:md5(password),accountCountryCode:'eu'});
   if(status)return Response.json({apiStatus:status,data:{}});
   return Response.json({apiStatus:0,data:{userid:'user',email,key,token,domain:target.origin}});
  }
  expect(target.pathname).toBe('/v1/Device/devList');
  expect(authorization).toBe(`Basic ${token}`);
  return Response.json({apiStatus:status,data:list});
 }) as typeof fetch;
 return {fetcher,calls};
}

test('device discovery signs in and returns only UUID and bounded public labels without requiring a UUID',async()=>{
 const response=mockFetch([
  {uuid,devName:'Garage plug',deviceType:'mss310',token,password,key,raw:{secret:'raw-sensitive'}},
  {uuid:'fedcba9876543210fedcba9876543210',devName:'x'.repeat(150),model:'mss315'},
 ]);
 const devices=await listCloudDevices(env,response.fetcher);
 expect(response.calls.map(call=>call.path)).toEqual(['/v1/Auth/signIn','/v1/Device/devList']);
 expect(response.calls[1]!.payload).toEqual({});
 expect(devices).toEqual([
  {uuid,name:'Garage plug',model:'mss310'},
  {uuid:'fedcba9876543210fedcba9876543210',name:'x'.repeat(120),model:'mss315'},
 ]);
 const output=JSON.stringify(devices);
 for(const secret of [password,email,token,key,'raw-sensitive'])expect(output).not.toContain(secret);
 expect(devices.every(device=>Object.keys(device).every(field=>['uuid','name','model'].includes(field)))).toBe(true);
});

test('invalid device-list data returns only a sanitized typed error',async()=>{
 for(const list of [null,[{uuid:'not-a-uuid',devName:'private'}],new Array(5001).fill({uuid})]){
  const response=mockFetch(list);
  try{await listCloudDevices(env,response.fetcher);throw new Error('expected validation failure');}
  catch(error){
   expect(error).toBeInstanceOf(CloudError);
   expect((error as CloudError).code).toBe('INVALID_RESPONSE');
   expect(String(error)).not.toContain(password);
   expect(String(error)).not.toContain(token);
   expect(String(error)).not.toContain(key);
  }
 }
});

test('sign-in failures are sanitized and credentials are required without a device UUID',async()=>{
 const denied=mockFetch([],1004);
 try{await listCloudDevices(env,denied.fetcher);throw new Error('expected authentication failure');}
 catch(error){expect(error).toBeInstanceOf(CloudError);expect((error as CloudError).code).toBe('AUTH_FAILED');expect(String(error)).not.toContain(password);}
 expect(denied.calls).toHaveLength(1);
 for(const invalid of [{...env,MEROSS_EMAIL:''},{...env,MEROSS_PASSWORD:''},{...env,MEROSS_REGION:'unknown'}]){
  try{await listCloudDevices(invalid,mockFetch([]).fetcher);throw new Error('expected config failure');}
  catch(error){expect(error).toBeInstanceOf(CloudError);expect((error as CloudError).code).toBe('INVALID_CONFIG');}
 }
});
