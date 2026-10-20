import {expect,test} from 'bun:test';
import {LatestRequest} from '../src/latest-request';
test('a slower previous month cannot replace the current selection or finish its loader',async()=>{
 const requests=new LatestRequest(),applied:string[]=[];let firstResolve!:(v:string)=>void,secondResolve!:(v:string)=>void;
 const first=requests.start(),a=new Promise<string>(r=>firstResolve=r).then(value=>{if(first.current())applied.push(value)});
 const second=requests.start(),b=new Promise<string>(r=>secondResolve=r).then(value=>{if(second.current())applied.push(value)});
 secondResolve('september');await b;firstResolve('october');await a;expect(applied).toEqual(['september']);expect(first.signal.aborted).toBe(true);expect(first.current()).toBe(false);expect(second.current()).toBe(true);
});
test('October -> September -> October and unmount invalidate every obsolete response',()=>{
 const requests=new LatestRequest(),october=requests.start(),september=requests.start(),back=requests.start();
 expect(october.current()).toBe(false);expect(september.current()).toBe(false);expect(back.current()).toBe(true);requests.cancel();expect(back.current()).toBe(false);expect(back.signal.aborted).toBe(true);
});
